import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Carrega .env sem dependência externa ──
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function carregarEnv() {
  try {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;
    for (const linha of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const l = linha.trim();
      if (!l || l.startsWith("#")) continue;
      const i = l.indexOf("=");
      if (i === -1) continue;
      const chave = l.slice(0, i).trim();
      const valor = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!(chave in process.env)) process.env[chave] = valor;
    }
  } catch { /* ignora */ }
})();

const { webhooks } = await import("./src/routes/webhooks.js");
const { api } = await import("./src/routes/api.js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// Healthcheck (Railway)
app.get("/health", (req, res) => res.json({ ok: true, servico: "IA Instructiva" }));

// Webhooks (leads das landing pages + mensagens do Evolution)
app.use("/webhook", webhooks);

// API do painel
app.use("/api", api);

// Painel de controle
app.use("/painel", express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.redirect("/painel"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🤖 IA Instructiva rodando na porta ${PORT}`);
  console.log(`   Painel:  http://localhost:${PORT}/painel`);
  console.log(`   Webhook lead:      POST /webhook/lead/:agente`);
  console.log(`   Webhook evolution: POST /webhook/evolution\n`);
});
