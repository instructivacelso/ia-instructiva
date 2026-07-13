import { db } from "./db.js";

// Config efetiva = .env como base, sobrescrito pelo que for salvo no painel.
// Assim dá pra configurar tudo pela interface sem redeploy.
export function config() {
  const s = db.getSettings();
  return {
    publicUrl: (s.publicUrl || process.env.PUBLIC_URL || "").replace(/\/$/, ""),
    adminPassword: process.env.ADMIN_PASSWORD || "troque-esta-senha",
    evolutionUrl: (s.evolutionUrl || process.env.EVOLUTION_URL || "").replace(/\/$/, ""),
    evolutionApiKey: s.evolutionApiKey || process.env.EVOLUTION_API_KEY || "",
    openaiApiKey: s.openaiApiKey || process.env.OPENAI_API_KEY || "",
    openaiModel: s.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
  };
}
