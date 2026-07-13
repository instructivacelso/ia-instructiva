import express from "express";
import { acharAgente, acharAgentePorInstancia, listarAgentes } from "../agents.js";
import {
  acharConversa,
  criarConversa,
  adicionarMensagem,
  salvarConversa,
  iniciarContato,
  responderMensagem,
} from "../conversations.js";
import { evolution } from "../evolution.js";
import { tipoMidia, salvarMidia, transcreverAudio, lerImagem } from "../media.js";
import { db } from "../db.js";

// IA está ligada? (global + agente). A conversa tem o próprio toggle à parte.
function iaLigadaPara(agente) {
  const s = db.getSettings();
  const globalOn = s.iaGlobalAtiva !== false;
  return globalOn && agente.iaAtiva !== false;
}

export const webhooks = express.Router();

// ─────────────────────────────────────────────────────────────
// 1) LEAD — a landing page dispara isso quando alguém se cadastra.
//    A URL identifica o agente:  POST /webhook/lead/:agente
//    Body (JSON): { nome, telefone, ...qualquer_dado_extra }
//    O :agente pode ser o ID do agente OU o nome da instância.
// ─────────────────────────────────────────────────────────────
webhooks.post("/lead/:agente", async (req, res) => {
  try {
    const chave = req.params.agente;
    const agente =
      acharAgente(chave) || listarAgentes().find((a) => a.instancia === chave);

    if (!agente) {
      return res.status(404).json({ ok: false, erro: `Agente "${chave}" não encontrado.` });
    }
    if (!agente.ativo) {
      return res.status(200).json({ ok: true, ignorado: "agente inativo" });
    }

    const body = req.body || {};
    const telefone = body.telefone || body.phone || body.whatsapp || body.numero;
    if (!telefone) {
      return res.status(400).json({ ok: false, erro: "Campo telefone/phone/whatsapp obrigatório." });
    }

    const nome = body.nome || body.name || "";
    const { telefone: _t, phone: _p, whatsapp: _w, numero: _n, nome: _nm, name: _na, ...extras } = body;

    // Evita disparar de novo se já existe conversa recente com esse lead.
    let conv = acharConversa(agente.id, telefone);
    if (conv && conv.historico.length > 0) {
      return res.status(200).json({ ok: true, jaExistia: true, conversaId: conv.id });
    }
    if (!conv) {
      conv = criarConversa({
        agenteId: agente.id,
        numero: telefone,
        nome,
        origem: body.origem || agente.nome,
        dadosExtras: extras,
      });
    }

    // Responde rápido pra landing page e dispara o contato em background.
    res.status(200).json({ ok: true, conversaId: conv.id });

    if (!iaLigadaPara(agente)) {
      adicionarMensagem(conv, "system-note", "IA pausada — lead registrado, sem contato automático.");
      return;
    }
    iniciarContato(agente, conv).catch((e) => {
      console.error("[lead] falha no primeiro contato:", e.message);
      adicionarMensagem(conv, "system-note", `Falha ao iniciar contato: ${e.message}`);
    });
  } catch (e) {
    console.error("[webhook lead]", e);
    if (!res.headersSent) res.status(500).json({ ok: false, erro: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 2) EVOLUTION — mensagens recebidas do WhatsApp chegam aqui.
//    POST /webhook/evolution   (registrado automaticamente por instância)
// ─────────────────────────────────────────────────────────────
// Aceita /webhook/evolution E /webhook/evolution/qualquer-evento
// (algumas versões, com webhookByEvents=true, anexam o nome do evento na URL).
webhooks.post(["/evolution", "/evolution/*"], async (req, res) => {
  // Sempre 200 rápido: o Evolution reenvia se demorar/der erro.
  res.status(200).json({ ok: true });

  try {
    const payload = req.body || {};
    const evento = (payload.event || "").toLowerCase();

    // LOG de diagnóstico: mostra tudo que chega (aparece nos logs do Railway).
    const instancia = payload.instance || payload.instanceName;
    const dataPreview = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    console.log(
      `[webhook<-] evento="${evento || "?"}" instancia="${instancia || "?"}" ` +
      `path="${req.originalUrl}" fromMe=${dataPreview?.key?.fromMe} jid=${dataPreview?.key?.remoteJid || "-"}`
    );

    if (evento && !evento.includes("messages.upsert") && !evento.includes("messages_upsert")) {
      return; // só nos interessa mensagem recebida
    }

    const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    if (!data || !data.key) {
      console.log("[webhook<-] ignorado: payload sem data.key");
      return;
    }

    // Ignora o que eu mesmo enviei e mensagens de grupo.
    if (data.key.fromMe) return;
    const remoteJid = data.key.remoteJid || "";
    if (remoteJid.endsWith("@g.us")) return;
    if (remoteJid.includes("status@broadcast")) return;

    const agente = acharAgentePorInstancia(instancia);
    if (!agente) {
      console.log(`[webhook<-] nenhum agente com instancia="${instancia}". Confira se o nome bate.`);
      return;
    }
    if (!agente.ativo) {
      console.log(`[webhook<-] agente "${agente.nome}" está inativo; ignorando.`);
      return;
    }

    let texto = extrairTexto(data.message);
    let meta = {};
    const pushName = data.pushName || "";

    let conv = acharConversa(agente.id, remoteJid);
    if (!conv) {
      conv = criarConversa({
        agenteId: agente.id,
        numero: remoteJid,
        nome: pushName,
        origem: "whatsapp",
      });
    }
    // Guarda o JID exato — fonte da verdade pro envio (mata o bug do 9º dígito).
    conv.remoteJid = remoteJid;
    if (!conv.nome && pushName) conv.nome = pushName;

    // Sem texto = provavelmente mídia. Baixa, salva e "entende".
    if (!texto) {
      const mid = tipoMidia(data.message);
      if (!mid) {
        adicionarMensagem(conv, "system-note", "[mensagem sem texto e sem mídia reconhecida]");
        salvarConversa(conv);
        return;
      }
      try {
        const baixado = await evolution.baixarMidiaBase64(agente.instancia, data);
        const mimeFinal = baixado.mimetype || mid.mimetype;
        const rel = salvarMidia(conv.id, baixado.base64, mimeFinal);
        meta = { mediaTipo: mid.tipo, mediaPath: rel, mimetype: mimeFinal };

        if (mid.tipo === "audio") {
          const t = await transcreverAudio(baixado.base64, mimeFinal);
          texto = t || "[áudio sem fala reconhecida]";
          meta.transcricao = t;
          console.log(`[midia] áudio transcrito (${texto.length} chars)`);
        } else if (mid.tipo === "imagem" || mid.tipo === "sticker") {
          const desc = await lerImagem(baixado.base64, mimeFinal, conv.origem || "");
          texto = (mid.legenda ? mid.legenda + "\n\n" : "") + "[imagem recebida] " + desc;
          meta.transcricao = desc;
          console.log(`[midia] imagem lida (${desc.length} chars)`);
        } else {
          // vídeo / documento: guarda o arquivo, usa legenda/nome como texto.
          texto = mid.legenda || `[${mid.tipo} recebido${mid.nome ? ": " + mid.nome : ""}]`;
        }
      } catch (e) {
        console.error("[midia] falha:", e.message);
        adicionarMensagem(conv, "user", `[${mid.tipo} recebido]`, { mediaTipo: mid.tipo, erro: e.message });
        adicionarMensagem(conv, "system-note", `Não consegui processar a mídia: ${e.message}`);
        salvarConversa(conv);
        return;
      }
    }

    adicionarMensagem(conv, "user", texto, meta);

    // IA responde só se: ligada globalmente, ligada no agente e ligada na conversa.
    if (!iaLigadaPara(agente) || !conv.iaAtiva) return;

    await responderMensagem(agente, conv).catch((e) => {
      console.error("[evolution] falha ao responder:", e.message);
      adicionarMensagem(conv, "system-note", `Falha ao responder: ${e.message}`);
    });
  } catch (e) {
    console.error("[webhook evolution]", e);
  }
});

function extrairTexto(message) {
  if (!message) return "";
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ""
  ).trim();
}
