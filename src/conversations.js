import crypto from "crypto";
import { db } from "./db.js";
import { evolution } from "./evolution.js";
import { gerarResposta } from "./ai.js";
import { chaveConversa, normalizarBR } from "./phone.js";
import { salvarMidia } from "./media.js";

// Acha a conversa por (agente + telefone), tolerante ao 9º dígito.
export function acharConversa(agenteId, numeroOuJid) {
  const chave = chaveConversa(numeroOuJid);
  return db
    .getConversas()
    .find((c) => c.agenteId === agenteId && chaveConversa(c.numero) === chave) || null;
}

export function acharConversaPorId(id) {
  return db.getConversas().find((c) => c.id === id) || null;
}

export function listarConversas({ agenteId } = {}) {
  let lista = db.getConversas();
  if (agenteId) lista = lista.filter((c) => c.agenteId === agenteId);
  return lista.sort((a, b) => (b.atualizadaEm || "").localeCompare(a.atualizadaEm || ""));
}

export function criarConversa({ agenteId, numero, nome, origem, dadosExtras }) {
  const conversas = db.getConversas();
  const nova = {
    id: crypto.randomUUID(),
    agenteId,
    numero: normalizarBR(numero),
    remoteJid: null, // preenchido quando o lead responder (fonte da verdade pro envio)
    nome: nome || "",
    origem: origem || "manual",
    dadosExtras: dadosExtras || {},
    iaAtiva: true, // desligue pra um humano assumir
    status: "aberta",
    historico: [],
    criadaEm: new Date().toISOString(),
    atualizadaEm: new Date().toISOString(),
  };
  conversas.push(nova);
  db.saveConversas(conversas);
  return nova;
}

export function salvarConversa(conv) {
  const conversas = db.getConversas();
  const i = conversas.findIndex((c) => c.id === conv.id);
  conv.atualizadaEm = new Date().toISOString();
  if (i === -1) conversas.push(conv);
  else conversas[i] = conv;
  db.saveConversas(conversas);
  return conv;
}

export function adicionarMensagem(conv, role, content, meta = {}) {
  conv.historico.push({
    role, // "user" | "assistant" | "system-note"
    content,
    ts: new Date().toISOString(),
    ...meta,
  });
  return salvarConversa(conv);
}

// Destino de envio: prioriza o JID exato do WhatsApp (evita bug do 9º dígito),
// senão usa o número normalizado.
function destino(conv) {
  if (conv.remoteJid) return conv.remoteJid.split("@")[0].split(":")[0];
  return conv.numero;
}

// PRIMEIRO CONTATO: dispara a abertura assim que o lead entra.
export async function iniciarContato(agente, conv) {
  let texto;
  if (agente.mensagemInicial && agente.mensagemInicial.trim()) {
    texto = interpolar(agente.mensagemInicial, conv);
  } else {
    // IA gera a abertura com base nos dados do lead.
    const contexto = montarContextoLead(conv);
    texto = await gerarResposta({
      promptSistema:
        agente.promptSistema +
        "\n\n[SITUAÇÃO] Este lead ACABOU de se cadastrar. " +
        "Escreva a PRIMEIRA mensagem do WhatsApp: se apresente, seja natural e caloroso, " +
        "puxe o assunto do interesse dele e faça UMA pergunta pra iniciar a conversa. " +
        "Não use saudação genérica repetida, vá direto ao ponto de forma humana.\n" +
        contexto,
      historico: [],
      modelo: agente.modelo,
    });
  }

  await evolution.presenca(agente.instancia, destino(conv));
  await evolution.enviarTexto(agente.instancia, destino(conv), texto);
  adicionarMensagem(conv, "assistant", texto, { primeiroContato: true });
  return texto;
}

// RESPOSTA a uma mensagem recebida.
export async function responderMensagem(agente, conv) {
  const contexto = montarContextoLead(conv);
  const texto = await gerarResposta({
    promptSistema: agente.promptSistema + (contexto ? "\n\n" + contexto : ""),
    historico: conv.historico.filter((m) => m.role === "user" || m.role === "assistant"),
    modelo: agente.modelo,
  });

  await evolution.presenca(agente.instancia, destino(conv));
  await evolution.enviarTexto(agente.instancia, destino(conv), texto);
  adicionarMensagem(conv, "assistant", texto);
  return texto;
}

// Envio manual (humano assumiu a conversa pelo painel).
export async function enviarManual(agente, conv, texto) {
  await evolution.enviarTexto(agente.instancia, destino(conv), texto);
  adicionarMensagem(conv, "assistant", texto, { manual: true });
  return texto;
}

// Envio manual de mídia (imagem / áudio / documento) pelo painel.
export async function enviarMidiaManual(agente, conv, { base64, mimetype, tipo, fileName, caption }) {
  const rel = salvarMidia(conv.id, base64, mimetype);
  const dest = destino(conv);
  if (tipo === "audio") {
    await evolution.enviarAudio(agente.instancia, dest, base64);
  } else {
    const mediatype = tipo === "image" ? "image" : tipo === "video" ? "video" : "document";
    await evolution.enviarMidia(agente.instancia, dest, { mediatype, mimetype, media: base64, caption, fileName });
  }
  const mtipo = tipo === "image" ? "imagem" : tipo === "audio" ? "audio" : "documento";
  const conteudo = caption || (mtipo === "documento" ? `[${fileName || "arquivo"}]` : "");
  adicionarMensagem(conv, "assistant", conteudo, { manual: true, mediaTipo: mtipo, mediaPath: rel, mimetype, fileName });
  return rel;
}

function interpolar(template, conv) {
  const d = conv.dadosExtras || {};
  return template
    .replace(/\{nome\}/gi, conv.nome || d.nome || "")
    .replace(/\{(\w+)\}/g, (_, k) => (d[k] != null ? String(d[k]) : ""));
}

function montarContextoLead(conv) {
  const linhas = [];
  if (conv.nome) linhas.push(`Nome: ${conv.nome}`);
  if (conv.origem) linhas.push(`Origem/interesse: ${conv.origem}`);
  const d = conv.dadosExtras || {};
  for (const [k, v] of Object.entries(d)) {
    if (k === "nome") continue;
    if (v == null || v === "") continue;
    linhas.push(`${k}: ${v}`);
  }
  if (!linhas.length) return "";
  return "[DADOS DO LEAD]\n" + linhas.join("\n");
}
