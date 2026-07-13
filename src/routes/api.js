import express from "express";
import fs from "fs";
import { config } from "../config.js";
import { db } from "../db.js";
import { evolution } from "../evolution.js";
import {
  listarAgentesDoUsuario,
  acharAgente,
  criarAgente,
  atualizarAgente,
  removerAgente,
  podeAcessarAgente,
} from "../agents.js";
import {
  listarConversas,
  acharConversaPorId,
  salvarConversa,
  enviarManual,
} from "../conversations.js";
import {
  autenticar,
  gerarToken,
  validarToken,
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  removerUsuario,
} from "../users.js";
import { caminhoAbsoluto } from "../media.js";

export const api = express.Router();

// ── Login (sem auth) ──
api.post("/login", (req, res) => {
  const { login, senha } = req.body || {};
  const u = autenticar(login, senha);
  if (!u) return res.status(401).json({ ok: false, erro: "Login ou senha incorretos." });
  res.json({ ok: true, token: gerarToken(u.id), usuario: { id: u.id, nome: u.nome, login: u.login, role: u.role } });
});

// ── Mídia (token via query, pois <audio>/<img> não mandam header) ──
api.get("/media/*", (req, res) => {
  const usuario = validarToken(req.query.token);
  if (!usuario) return res.status(401).end();
  try {
    const rel = req.params[0];
    const abs = caminhoAbsoluto(rel);
    if (!fs.existsSync(abs)) return res.status(404).end();
    res.sendFile(abs);
  } catch {
    res.status(400).end();
  }
});

// ── Auth em todas as rotas abaixo (token Bearer) ──
api.use((req, res, next) => {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.headers["x-token"] || "");
  const usuario = validarToken(token);
  if (!usuario) return res.status(401).json({ ok: false, erro: "Sessão expirada. Entre de novo." });
  req.usuario = usuario;
  next();
});

const soAdmin = (req, res, next) => {
  if (req.usuario.role !== "admin") return res.status(403).json({ ok: false, erro: "Só o admin pode fazer isso." });
  next();
};

// ── Eu / status ──
api.get("/me", (req, res) => {
  const c = config();
  const s = db.getSettings();
  res.json({
    usuario: { id: req.usuario.id, nome: req.usuario.nome, login: req.usuario.login, role: req.usuario.role },
    iaGlobalAtiva: s.iaGlobalAtiva !== false,
    config: {
      evolutionConfigurado: Boolean(c.evolutionUrl && c.evolutionApiKey),
      openaiConfigurado: Boolean(c.openaiApiKey),
      groqConfigurado: Boolean(c.groqApiKey),
      publicUrl: c.publicUrl,
      modelo: c.openaiModel,
    },
  });
});

// ── Liga/desliga a IA no sistema inteiro (admin) ──
api.post("/ia-global", soAdmin, (req, res) => {
  const s = db.getSettings();
  s.iaGlobalAtiva = Boolean(req.body?.ativa);
  db.saveSettings(s);
  res.json({ ok: true, iaGlobalAtiva: s.iaGlobalAtiva });
});

// ── Usuários (admin) ──
api.get("/usuarios", soAdmin, (req, res) => res.json(listarUsuarios()));
api.post("/usuarios", soAdmin, (req, res) => {
  try { res.json(criarUsuario(req.body || {})); }
  catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});
api.patch("/usuarios/:id", soAdmin, (req, res) => {
  try { res.json(atualizarUsuario(req.params.id, req.body || {})); }
  catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});
api.delete("/usuarios/:id", soAdmin, (req, res) => {
  if (req.params.id === req.usuario.id) return res.status(400).json({ ok: false, erro: "Você não pode se excluir." });
  removerUsuario(req.params.id);
  res.json({ ok: true });
});

// ── Settings (admin) — chaves globais ──
api.get("/settings", soAdmin, (req, res) => {
  const c = config();
  res.json({
    publicUrl: c.publicUrl,
    evolutionUrl: c.evolutionUrl,
    openaiModel: c.openaiModel,
    evolutionApiKeyDefinida: Boolean(c.evolutionApiKey),
    openaiApiKeyDefinida: Boolean(c.openaiApiKey),
    groqApiKeyDefinida: Boolean(c.groqApiKey),
  });
});
api.post("/settings", soAdmin, (req, res) => {
  const atual = db.getSettings();
  const b = req.body || {};
  const novo = { ...atual };
  if (b.publicUrl !== undefined) novo.publicUrl = b.publicUrl.trim();
  if (b.evolutionUrl !== undefined) novo.evolutionUrl = b.evolutionUrl.trim();
  if (b.openaiModel !== undefined) novo.openaiModel = b.openaiModel.trim();
  if (b.evolutionApiKey) novo.evolutionApiKey = b.evolutionApiKey.trim();
  if (b.openaiApiKey) novo.openaiApiKey = b.openaiApiKey.trim();
  if (b.groqApiKey) novo.groqApiKey = b.groqApiKey.trim();
  db.saveSettings(novo);
  res.json({ ok: true });
});

// ── Agentes (escopados ao usuário) ──
api.get("/agentes", (req, res) => {
  res.json(listarAgentesDoUsuario(req.usuario));
});

api.post("/agentes", (req, res) => {
  try {
    const dados = { ...(req.body || {}), usuarioId: req.usuario.id };
    res.json(criarAgente(dados));
  } catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});

// Helper: pega o agente e confere dono.
function agenteAutorizado(req, res) {
  const agente = acharAgente(req.params.id);
  if (!agente) { res.status(404).json({ ok: false, erro: "Agente não encontrado." }); return null; }
  if (!podeAcessarAgente(req.usuario, agente)) { res.status(403).json({ ok: false, erro: "Sem acesso a este agente." }); return null; }
  return agente;
}

api.patch("/agentes/:id", (req, res) => {
  if (!agenteAutorizado(req, res)) return;
  try { res.json(atualizarAgente(req.params.id, req.body || {})); }
  catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});

api.delete("/agentes/:id", (req, res) => {
  if (!agenteAutorizado(req, res)) return;
  removerAgente(req.params.id);
  res.json({ ok: true });
});

// ── Instância / conexão ──
api.post("/agentes/:id/instancia", async (req, res) => {
  const agente = agenteAutorizado(req, res); if (!agente) return;
  try {
    let criacao;
    try { criacao = await evolution.criarInstancia(agente.instancia); }
    catch (e) {
      if (!/already|exists|in use/i.test(e.message)) throw e;
      criacao = { jaExistia: true };
    }
    const pub = config().publicUrl;
    const url = `${pub}/webhook/evolution`;
    let webhookInfo;
    if (!pub) webhookInfo = { ok: false, erro: "PUBLIC_URL não configurada." };
    else {
      try { const r = await evolution.setWebhook(agente.instancia, url); webhookInfo = { ok: true, formato: r.formato, url }; }
      catch (e) { webhookInfo = { ok: false, erro: e.message, url }; }
    }
    res.json({ ok: true, instancia: agente.instancia, criacao, webhook: webhookInfo });
  } catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});

api.get("/agentes/:id/qr", async (req, res) => {
  const agente = agenteAutorizado(req, res); if (!agente) return;
  try {
    const r = await evolution.conectar(agente.instancia);
    res.json({
      ok: true,
      base64: r.base64 || r.qrcode?.base64 || null,
      code: r.code || r.qrcode?.code || null,
      pairingCode: r.pairingCode || null,
    });
  } catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});

api.get("/agentes/:id/webhook", async (req, res) => {
  const agente = agenteAutorizado(req, res); if (!agente) return;
  try {
    const atual = await evolution.getWebhook(agente.instancia);
    const esperado = `${config().publicUrl}/webhook/evolution`;
    const urlRegistrada = atual?.url || atual?.webhook?.url || null;
    res.json({ ok: true, esperado, registrado: urlRegistrada, confere: Boolean(urlRegistrada) && urlRegistrada === esperado, cru: atual });
  } catch (e) { res.status(200).json({ ok: false, erro: e.message }); }
});

api.post("/agentes/:id/webhook", async (req, res) => {
  const agente = agenteAutorizado(req, res); if (!agente) return;
  try {
    const pub = config().publicUrl;
    if (!pub) return res.status(400).json({ ok: false, erro: "PUBLIC_URL não configurada." });
    const r = await evolution.setWebhook(agente.instancia, `${pub}/webhook/evolution`);
    res.json({ ok: true, formato: r.formato });
  } catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});

api.get("/agentes/:id/estado", async (req, res) => {
  const agente = agenteAutorizado(req, res); if (!agente) return;
  try {
    const r = await evolution.estado(agente.instancia);
    res.json({ ok: true, estado: r.instance?.state || r.state || "desconhecido" });
  } catch (e) { res.status(200).json({ ok: false, estado: "erro", erro: e.message }); }
});

api.post("/agentes/:id/logout", async (req, res) => {
  const agente = agenteAutorizado(req, res); if (!agente) return;
  try { await evolution.logout(agente.instancia); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});

// ── Conversas (só as dos agentes do usuário) ──
function idsAgentesDoUsuario(req) {
  return new Set(listarAgentesDoUsuario(req.usuario).map((a) => a.id));
}

api.get("/conversas", (req, res) => {
  const meus = idsAgentesDoUsuario(req);
  const lista = listarConversas({ agenteId: req.query.agente })
    .filter((c) => meus.has(c.agenteId))
    .map((c) => ({
      id: c.id, agenteId: c.agenteId, nome: c.nome, numero: c.numero, origem: c.origem,
      status: c.status, iaAtiva: c.iaAtiva, atualizadaEm: c.atualizadaEm,
      ultima: c.historico.filter((m) => m.role !== "system-note").slice(-1)[0]?.content || "",
      qtd: c.historico.length,
    }));
  res.json(lista);
});

function conversaAutorizada(req, res) {
  const conv = acharConversaPorId(req.params.id);
  if (!conv) { res.status(404).json({ ok: false, erro: "Conversa não encontrada." }); return null; }
  const agente = acharAgente(conv.agenteId);
  if (!podeAcessarAgente(req.usuario, agente)) { res.status(403).json({ ok: false, erro: "Sem acesso." }); return null; }
  return { conv, agente };
}

api.get("/conversas/:id", (req, res) => {
  const r = conversaAutorizada(req, res); if (!r) return;
  res.json(r.conv);
});

api.post("/conversas/:id/ia", (req, res) => {
  const r = conversaAutorizada(req, res); if (!r) return;
  r.conv.iaAtiva = Boolean(req.body?.ativa);
  salvarConversa(r.conv);
  res.json({ ok: true, iaAtiva: r.conv.iaAtiva });
});

api.post("/conversas/:id/mensagem", async (req, res) => {
  const r = conversaAutorizada(req, res); if (!r) return;
  try {
    const texto = (req.body?.texto || "").trim();
    if (!texto) return res.status(400).json({ ok: false, erro: "Texto vazio." });
    if (!r.agente) return res.status(400).json({ ok: false, erro: "Agente da conversa não existe." });
    await enviarManual(r.agente, r.conv, texto);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, erro: e.message }); }
});
