// Tratamento de mídia recebida: salva o arquivo (pro painel tocar/ver),
// transcreve áudio e descreve imagem (pra IA "entender" sem mudar o prompt).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MEDIA_DIR = path.join(__dirname, "..", "data", "media");
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

const EXT = {
  "audio/ogg": "ogg", "audio/ogg; codecs=opus": "ogg", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "application/pdf": "pdf",
};

function extDe(mimetype) {
  if (!mimetype) return "bin";
  const base = mimetype.split(";")[0].trim();
  return EXT[mimetype] || EXT[base] || base.split("/")[1] || "bin";
}

// Salva o base64 em disco e devolve o caminho relativo (convId/arquivo.ext).
export function salvarMidia(convId, base64, mimetype) {
  const dir = path.join(MEDIA_DIR, convId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const nome = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extDe(mimetype)}`;
  fs.writeFileSync(path.join(dir, nome), Buffer.from(base64, "base64"));
  return `${convId}/${nome}`;
}

export function caminhoAbsoluto(rel) {
  const abs = path.join(MEDIA_DIR, rel);
  if (!abs.startsWith(MEDIA_DIR)) throw new Error("caminho inválido");
  return abs;
}

// Transcreve áudio. Usa Groq se tiver a chave (rápido/barato), senão OpenAI.
export async function transcreverAudio(base64, mimetype) {
  const { groqApiKey, openaiApiKey } = config();
  const usarGroq = Boolean(groqApiKey);
  const apiKey = usarGroq ? groqApiKey : openaiApiKey;
  if (!apiKey) throw new Error("Sem chave pra transcrição (Groq ou OpenAI).");

  const url = usarGroq
    ? "https://api.groq.com/openai/v1/audio/transcriptions"
    : "https://api.openai.com/v1/audio/transcriptions";
  const modelo = usarGroq ? "whisper-large-v3" : "whisper-1";

  const form = new FormData();
  const blob = new Blob([Buffer.from(base64, "base64")], { type: mimetype || "audio/ogg" });
  form.append("file", blob, `audio.${extDe(mimetype)}`);
  form.append("model", modelo);
  form.append("language", "pt");

  const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Transcrição (${usarGroq ? "Groq" : "OpenAI"}): ${dados?.error?.message || res.statusText}`);
  return (dados.text || "").trim();
}

// "Lê" a imagem com o modelo de visão e devolve uma descrição/dados.
export async function lerImagem(base64, mimetype, contexto = "") {
  const { openaiApiKey, openaiModel } = config();
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY não configurada (visão).");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({
      model: openaiModel || "gpt-4o-mini",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Descreva de forma objetiva e útil o que aparece nesta imagem enviada por um cliente no WhatsApp. " +
                "Se houver texto, números, placa, modelo de equipamento, comprovante ou print, transcreva o que for relevante. " +
                (contexto ? `Contexto da conversa: ${contexto}` : ""),
            },
            { type: "image_url", image_url: { url: `data:${mimetype || "image/jpeg"};base64,${base64}` } },
          ],
        },
      ],
    }),
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Visão: ${dados?.error?.message || res.statusText}`);
  return (dados.choices?.[0]?.message?.content || "").trim();
}

// Detecta o tipo de mídia numa mensagem do Evolution.
export function tipoMidia(message) {
  if (!message) return null;
  if (message.audioMessage) return { tipo: "audio", mimetype: message.audioMessage.mimetype || "audio/ogg" };
  if (message.imageMessage) return { tipo: "imagem", mimetype: message.imageMessage.mimetype || "image/jpeg", legenda: message.imageMessage.caption || "" };
  if (message.videoMessage) return { tipo: "video", mimetype: message.videoMessage.mimetype || "video/mp4", legenda: message.videoMessage.caption || "" };
  if (message.documentMessage) return { tipo: "documento", mimetype: message.documentMessage.mimetype || "application/pdf", nome: message.documentMessage.fileName || "" };
  if (message.stickerMessage) return { tipo: "sticker", mimetype: message.stickerMessage.mimetype || "image/webp" };
  return null;
}
