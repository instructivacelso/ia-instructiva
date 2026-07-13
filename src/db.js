// Banco de dados flat em JSON — mesmo padrão do Instructiva App.
// Simples, sem dependências, e fácil de inspecionar/versionar.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function arquivo(nome) {
  return path.join(DATA_DIR, `${nome}.json`);
}

function ler(nome, padrao) {
  try {
    const raw = fs.readFileSync(arquivo(nome), "utf-8");
    return JSON.parse(raw);
  } catch {
    return padrao;
  }
}

// Escrita atômica: grava em .tmp e renomeia, evitando corromper o arquivo
// se o processo cair no meio de uma escrita.
function gravar(nome, dados) {
  const alvo = arquivo(nome);
  const tmp = alvo + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
  fs.renameSync(tmp, alvo);
}

export const db = {
  getAgentes() {
    return ler("agentes", []);
  },
  saveAgentes(lista) {
    gravar("agentes", lista);
  },
  getConversas() {
    return ler("conversas", []);
  },
  saveConversas(lista) {
    gravar("conversas", lista);
  },
  getSettings() {
    // Prioridade: valores salvos no painel sobrescrevem o .env quando existirem.
    return ler("settings", {});
  },
  saveSettings(obj) {
    gravar("settings", obj);
  },
};
