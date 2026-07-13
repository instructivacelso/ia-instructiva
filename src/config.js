import { db } from "./db.js";

// Garante que a URL tenha esquema (https://) e não termine em barra.
// Evita o erro clássico de registrar webhook sem "https://".
function normalizarUrl(valor) {
  let u = String(valor || "").trim().replace(/\/+$/, "");
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// Config efetiva = .env como base, sobrescrito pelo que for salvo no painel.
// Assim dá pra configurar tudo pela interface sem redeploy.
export function config() {
  const s = db.getSettings();
  return {
    publicUrl: normalizarUrl(s.publicUrl || process.env.PUBLIC_URL || ""),
    adminPassword: process.env.ADMIN_PASSWORD || "troque-esta-senha",
    evolutionUrl: normalizarUrl(s.evolutionUrl || process.env.EVOLUTION_URL || ""),
    evolutionApiKey: s.evolutionApiKey || process.env.EVOLUTION_API_KEY || "",
    openaiApiKey: s.openaiApiKey || process.env.OPENAI_API_KEY || "",
    openaiModel: s.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
    groqApiKey: s.groqApiKey || process.env.GROQ_API_KEY || "",
  };
}
