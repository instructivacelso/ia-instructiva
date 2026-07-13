// Cliente da Evolution API (v2). Centraliza todas as chamadas HTTP.
// Se o seu servidor for v1, os pontos que mudam estão comentados.
import { config } from "./config.js";

async function call(method, endpoint, body) {
  const { evolutionUrl, evolutionApiKey } = config();
  if (!evolutionUrl || !evolutionApiKey) {
    throw new Error("Evolution não configurado (URL / API Key ausentes).");
  }
  const res = await fetch(`${evolutionUrl}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: evolutionApiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const texto = await res.text();
  let dados;
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = { raw: texto };
  }
  if (!res.ok) {
    const msg = dados?.response?.message || dados?.message || texto || res.statusText;
    throw new Error(`Evolution ${res.status}: ${Array.isArray(msg) ? msg.join("; ") : msg}`);
  }
  return dados;
}

export const evolution = {
  // Cria a instância (um número/WhatsApp). Retorna QR na criação.
  async criarInstancia(instanceName) {
    return call("POST", "/instance/create", {
      instanceName,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    });
  },

  // Pega o QR code / pairing pra conectar o número.
  async conectar(instanceName) {
    return call("GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
  },

  // Estado da conexão: "open" (conectado), "connecting", "close".
  async estado(instanceName) {
    return call("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
  },

  async deletar(instanceName) {
    return call("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
  },

  async logout(instanceName) {
    return call("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
  },

  // Registra o webhook do sistema pra receber as mensagens dessa instância.
  async setWebhook(instanceName, url) {
    // Formato v2 (webhook aninhado). Em v1 use o body sem o wrapper "webhook".
    return call("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: false,
        events: ["MESSAGES_UPSERT"],
      },
    });
  },

  // Envia texto. number = 5511999999999 (sem @s.whatsapp.net).
  async enviarTexto(instanceName, number, text) {
    // Formato v2. Em v1: { number, options:{delay,presence}, textMessage:{ text } }
    return call("POST", `/message/sendText/${encodeURIComponent(instanceName)}`, {
      number,
      text,
    });
  },

  // Simula "digitando..." antes de responder (mais humano). Opcional.
  async presenca(instanceName, number, presence = "composing") {
    try {
      await call("POST", `/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
        number,
        presence,
        delay: 1200,
      });
    } catch {
      /* presença é best-effort, ignora erro */
    }
  },
};
