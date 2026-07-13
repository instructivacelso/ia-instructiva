// Camada de IA. Gera a resposta do agente a partir do prompt + histórico.
import { config } from "./config.js";

const LIMITE_HISTORICO = 24; // últimas N mensagens enviadas ao modelo

export async function gerarResposta({ promptSistema, historico, modelo }) {
  const { openaiApiKey, openaiModel } = config();
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY não configurada.");

  const mensagens = [
    { role: "system", content: promptSistema },
    ...historico.slice(-LIMITE_HISTORICO).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
  ];

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: modelo || openaiModel,
      messages: mensagens,
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  const dados = await res.json();
  if (!res.ok) {
    const msg = dados?.error?.message || res.statusText;
    throw new Error(`OpenAI: ${msg}`);
  }
  return (dados.choices?.[0]?.message?.content || "").trim();
}
