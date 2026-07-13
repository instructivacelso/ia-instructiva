// Cliente da Evolution API — robusto a v1 e v2.
// Onde os formatos divergem, tentamos v2 e caímos pra v1 automaticamente.
import { config } from "./config.js";

async function call(method, endpoint, body) {
  const { evolutionUrl, evolutionApiKey } = config();
  if (!evolutionUrl || !evolutionApiKey) {
    throw new Error("Evolution não configurado (URL / API Key ausentes).");
  }
  const res = await fetch(`${evolutionUrl}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: evolutionApiKey },
    body: body ? JSON.stringify(body) : undefined,
  });
  const texto = await res.text();
  let dados;
  try { dados = texto ? JSON.parse(texto) : {}; } catch { dados = { raw: texto }; }
  if (!res.ok) {
    const msg = dados?.response?.message || dados?.message || texto || res.statusText;
    const err = new Error(`Evolution ${res.status}: ${Array.isArray(msg) ? msg.join("; ") : msg}`);
    err.status = res.status;
    throw err;
  }
  return dados;
}

export const evolution = {
  async criarInstancia(instanceName) {
    return call("POST", "/instance/create", {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    });
  },

  async conectar(instanceName) {
    return call("GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
  },

  async estado(instanceName) {
    return call("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  },

  async deletar(instanceName) {
    return call("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  },

  async logout(instanceName) {
    return call("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  },

  // Registra o webhook. Tenta o formato v2 (aninhado) e, se falhar, o v1 (flat).
  async setWebhook(instanceName, url) {
    const ep = `/webhook/set/${encodeURIComponent(instanceName)}`;
    const eventos = ["MESSAGES_UPSERT"];
    // v2: body aninhado sob "webhook"
    const v2 = {
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhook_by_events: false,
        byEvents: false,
        base64: false,
        events: eventos,
      },
    };
    // v1: body flat
    const v1 = {
      enabled: true,
      url,
      webhookByEvents: false,
      webhook_by_events: false,
      events: eventos,
    };
    try {
      const r = await call("POST", ep, v2);
      console.log(`[webhook] registrado (v2) em ${instanceName} -> ${url}`);
      return { ok: true, formato: "v2", r };
    } catch (e2) {
      console.warn(`[webhook] v2 falhou (${e2.message}); tentando v1...`);
      const r = await call("POST", ep, v1);
      console.log(`[webhook] registrado (v1) em ${instanceName} -> ${url}`);
      return { ok: true, formato: "v1", r };
    }
  },

  // Lê o webhook atual da instância (diagnóstico).
  async getWebhook(instanceName) {
    try {
      return await call("GET", `/webhook/find/${encodeURIComponent(instanceName)}`);
    } catch {
      return null;
    }
  },

  // Envia texto. Tenta v2 (flat) e cai pra v1 (textMessage) se precisar.
  async enviarTexto(instanceName, number, text) {
    const ep = `/message/sendText/${encodeURIComponent(instanceName)}`;
    try {
      return await call("POST", ep, { number, text }); // v2
    } catch (e2) {
      console.warn(`[enviar] v2 falhou (${e2.message}); tentando v1...`);
      return await call("POST", ep, { number, textMessage: { text }, options: { delay: 800 } }); // v1
    }
  },

  async presenca(instanceName, number, presence = "composing") {
    try {
      await call("POST", `/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
        number, presence, delay: 1200,
      });
    } catch { /* best-effort */ }
  },
};
