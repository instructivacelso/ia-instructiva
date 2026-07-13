import express from "express";
import { config } from "../config.js";
import { db } from "../db.js";
import { evolution } from "../evolution.js";
import {
  listarAgentes,
  acharAgente,
  criarAgente,
  atualizarAgente,
  removerAgente,
} from "../agents.js";
import {
  listarConversas,
  acharConversaPorId,
  salvarConversa,
  enviarManual,
} from "../conversations.js";

export const api = express.Router();

// ── Autenticação simples por senha (header x-admin-password) ──
api.use((req, res, next) => {
  const senha = req.headers["x-admin-password"] || req.query.senha;
  if (senha !== config().adminPassword) {
    return res.status(401).json({ ok: false, erro: "Senha incorreta." });
  }
  next();
});

// ── Status geral / config ──
api.get("/status", (req, res) => {
  const c = config();
  res.json({
    ok: true,
    config: {
      evolutionConfigurado: Boolean(c.evolutionUrl && c.evolutionApiKey),
      openaiConfigurado: Boolean(c.openaiApiKey),
      publicUrl: c.publicUrl,
      modelo: c.openaiModel,
    },
  });
});

api.get("/settings", (req, res) => {
  const c = config();
  res.json({
    publicUrl: c.publicUrl,
    evolutionUrl: c.evolutionUrl,
    openaiModel: c.openaiModel,
    // Nunca devolve as chaves em texto — só informa se estão setadas.
    evolutionApiKeyDefinida: Boolean(c.evolutionApiKey),
    openaiApiKeyDefinida: Boolean(c.openaiApiKey),
  });
});

api.post("/settings", (req, res) => {
  const atual = db.getSettings();
  const b = req.body || {};
  const novo = { ...atual };
  if (b.publicUrl !== undefined) novo.publicUrl = b.publicUrl.trim();
  if (b.evolutionUrl !== undefined) novo.evolutionUrl = b.evolutionUrl.trim();
  if (b.openaiModel !== undefined) novo.openaiModel = b.openaiModel.trim();
  // Só sobrescreve chave se veio algo não-vazio (pra não apagar sem querer).
  if (b.evolutionApiKey) novo.evolutionApiKey = b.evolutionApiKey.trim();
  if (b.openaiApiKey) novo.openaiApiKey = b.openaiApiKey.trim();
  db.saveSettings(novo);
  res.json({ ok: true });
});

// ── Agentes ──
api.get("/agentes", (req, res) => {
  res.json(listarAgentes());
});

api.post("/agentes", (req, res) => {
  try {
    res.json(criarAgente(req.body || {}));
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

api.patch("/agentes/:id", (req, res) => {
  try {
    res.json(atualizarAgente(req.params.id, req.body || {}));
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

api.delete("/agentes/:id", (req, res) => {
  removerAgente(req.params.id);
  res.json({ ok: true });
});

// ── Instância (WhatsApp) do agente ──
// Cria a instância no Evolution e já registra o webhook do sistema.
api.post("/agentes/:id/instancia", async (req, res) => {
  try {
    const agente = acharAgente(req.params.id);
    if (!agente) return res.status(404).json({ ok: false, erro: "Agente não encontrado." });

    let criacao;
    try {
      criacao = await evolution.criarInstancia(agente.instancia);
    } catch (e) {
      // Se já existir, seguimos pra conectar/registrar webhook mesmo assim.
      if (!/already|exists|in use/i.test(e.message)) throw e;
      criacao = { jaExistia: true };
    }

    const pub = config().publicUrl;
    const url = `${pub}/webhook/evolution`;
    let webhookInfo;
    if (!pub) {
      webhookInfo = { ok: false, erro: "PUBLIC_URL não configurada — webhook NÃO registrado. Preencha em Configurações e conecte de novo." };
    } else {
      try {
        const r = await evolution.setWebhook(agente.instancia, url);
        webhookInfo = { ok: true, formato: r.formato, url };
      } catch (e) {
        webhookInfo = { ok: false, erro: e.message, url };
      }
    }

    res.json({ ok: true, instancia: agente.instancia, criacao, webhook: webhookInfo });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

// QR code / pairing pra conectar o número.
api.get("/agentes/:id/qr", async (req, res) => {
  try {
    const agente = acharAgente(req.params.id);
    if (!agente) return res.status(404).json({ ok: false, erro: "Agente não encontrado." });
    const r = await evolution.conectar(agente.instancia);
    // Evolution devolve base64 e/ou pairingCode dependendo da versão.
    res.json({
      ok: true,
      base64: r.base64 || r.qrcode?.base64 || null,
      code: r.code || r.qrcode?.code || null,
      pairingCode: r.pairingCode || null,
    });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

// Diagnóstico: mostra o webhook que o Evolution tem registrado pra essa instância.
api.get("/agentes/:id/webhook", async (req, res) => {
  try {
    const agente = acharAgente(req.params.id);
    if (!agente) return res.status(404).json({ ok: false, erro: "Agente não encontrado." });
    const atual = await evolution.getWebhook(agente.instancia);
    const esperado = `${config().publicUrl}/webhook/evolution`;
    const urlRegistrada = atual?.url || atual?.webhook?.url || null;
    res.json({
      ok: true,
      esperado,
      registrado: urlRegistrada,
      confere: Boolean(urlRegistrada) && urlRegistrada === esperado,
      cru: atual,
    });
  } catch (e) {
    res.status(200).json({ ok: false, erro: e.message });
  }
});

// Re-registra o webhook manualmente (botão no painel).
api.post("/agentes/:id/webhook", async (req, res) => {
  try {
    const agente = acharAgente(req.params.id);
    if (!agente) return res.status(404).json({ ok: false, erro: "Agente não encontrado." });
    const pub = config().publicUrl;
    if (!pub) return res.status(400).json({ ok: false, erro: "PUBLIC_URL não configurada." });
    const r = await evolution.setWebhook(agente.instancia, `${pub}/webhook/evolution`);
    res.json({ ok: true, formato: r.formato });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

api.get("/agentes/:id/estado", async (req, res) => {
  try {
    const agente = acharAgente(req.params.id);
    if (!agente) return res.status(404).json({ ok: false, erro: "Agente não encontrado." });
    const r = await evolution.estado(agente.instancia);
    const estado = r.instance?.state || r.state || "desconhecido";
    res.json({ ok: true, estado });
  } catch (e) {
    res.status(200).json({ ok: false, estado: "erro", erro: e.message });
  }
});

api.post("/agentes/:id/logout", async (req, res) => {
  try {
    const agente = acharAgente(req.params.id);
    if (!agente) return res.status(404).json({ ok: false, erro: "Agente não encontrado." });
    await evolution.logout(agente.instancia);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});

// ── Conversas ──
api.get("/conversas", (req, res) => {
  const lista = listarConversas({ agenteId: req.query.agente }).map((c) => ({
    id: c.id,
    agenteId: c.agenteId,
    nome: c.nome,
    numero: c.numero,
    origem: c.origem,
    status: c.status,
    iaAtiva: c.iaAtiva,
    atualizadaEm: c.atualizadaEm,
    ultima: c.historico.filter((m) => m.role !== "system-note").slice(-1)[0]?.content || "",
    qtd: c.historico.length,
  }));
  res.json(lista);
});

api.get("/conversas/:id", (req, res) => {
  const conv = acharConversaPorId(req.params.id);
  if (!conv) return res.status(404).json({ ok: false, erro: "Conversa não encontrada." });
  res.json(conv);
});

// Liga/desliga a IA (humano assume).
api.post("/conversas/:id/ia", (req, res) => {
  const conv = acharConversaPorId(req.params.id);
  if (!conv) return res.status(404).json({ ok: false, erro: "Conversa não encontrada." });
  conv.iaAtiva = Boolean(req.body?.ativa);
  salvarConversa(conv);
  res.json({ ok: true, iaAtiva: conv.iaAtiva });
});

// Mensagem manual (humano digitando pelo painel).
api.post("/conversas/:id/mensagem", async (req, res) => {
  try {
    const conv = acharConversaPorId(req.params.id);
    if (!conv) return res.status(404).json({ ok: false, erro: "Conversa não encontrada." });
    const agente = acharAgente(conv.agenteId);
    if (!agente) return res.status(400).json({ ok: false, erro: "Agente da conversa não existe." });
    const texto = (req.body?.texto || "").trim();
    if (!texto) return res.status(400).json({ ok: false, erro: "Texto vazio." });
    await enviarManual(agente, conv, texto);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, erro: e.message });
  }
});
