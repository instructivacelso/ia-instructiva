// Base de conhecimento por agente com busca semântica (RAG).
// Cada item (texto, bloco, Q&A, arquivo) é quebrado em pedaços e indexado
// com embeddings. Na hora de responder, buscamos só os trechos relevantes.
import crypto from "crypto";
import { db } from "./db.js";
import { config } from "./config.js";

const EMB_MODEL = "text-embedding-3-small";
const MAX_CHARS = 1200;   // tamanho de cada pedaço
const OVERLAP = 150;      // sobreposição entre pedaços
const TOP_K = 6;          // quantos trechos injetar por resposta

// ── Embeddings (OpenAI) ──
export async function embed(textos) {
  const { openaiApiKey } = config();
  if (!openaiApiKey) throw new Error("OPENAI_API_KEY não configurada (embeddings).");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
    body: JSON.stringify({ model: EMB_MODEL, input: textos }),
  });
  const dados = await res.json();
  if (!res.ok) throw new Error(`Embeddings: ${dados?.error?.message || res.statusText}`);
  return dados.data.map((d) => d.embedding);
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Quebra texto em pedaços por parágrafo, respeitando um tamanho máximo.
function chunk(texto) {
  const limpo = String(texto || "").replace(/\r/g, "").trim();
  if (!limpo) return [];
  const paras = limpo.split(/\n\s*\n/);
  const pedacos = [];
  let atual = "";
  for (const p of paras) {
    if ((atual + "\n\n" + p).length > MAX_CHARS && atual) {
      pedacos.push(atual.trim());
      atual = atual.slice(-OVERLAP) + "\n\n" + p;
    } else {
      atual = atual ? atual + "\n\n" + p : p;
    }
    // parágrafo gigante sozinho: corta no braço
    while (atual.length > MAX_CHARS * 1.4) {
      pedacos.push(atual.slice(0, MAX_CHARS).trim());
      atual = atual.slice(MAX_CHARS - OVERLAP);
    }
  }
  if (atual.trim()) pedacos.push(atual.trim());
  return pedacos;
}

// Texto que representa um item pra indexação.
function textoDoItem(item) {
  if (item.tipo === "qa") return `Pergunta: ${item.pergunta}\nResposta: ${item.conteudo}`;
  if (item.titulo) return `${item.titulo}\n${item.conteudo}`;
  return item.conteudo || "";
}

// ── CRUD de itens ──
export function listarItens(agenteId) {
  return db.getConhecimento().filter((i) => i.agenteId === agenteId)
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
}

export async function criarItem(agenteId, dados) {
  const itens = db.getConhecimento();
  const item = {
    id: crypto.randomUUID(),
    agenteId,
    tipo: dados.tipo || "texto", // texto | bloco | qa | arquivo
    titulo: dados.titulo || "",
    pergunta: dados.pergunta || "",
    conteudo: dados.conteudo || "",
    fonte: dados.fonte || "",
    indexado: false,
    criadoEm: new Date().toISOString(),
  };
  itens.push(item);
  db.saveConhecimento(itens);
  await reindexItem(item).catch((e) => console.warn("[kb] indexação adiada:", e.message));
  return item;
}

export async function atualizarItem(id, patch) {
  const itens = db.getConhecimento();
  const i = itens.findIndex((x) => x.id === id);
  if (i === -1) throw new Error("Item não encontrado.");
  const { id: _i, agenteId: _a, ...resto } = patch;
  itens[i] = { ...itens[i], ...resto };
  db.saveConhecimento(itens);
  await reindexItem(itens[i]).catch((e) => console.warn("[kb] indexação adiada:", e.message));
  return itens[i];
}

export function removerItem(id) {
  db.saveConhecimento(db.getConhecimento().filter((i) => i.id !== id));
  db.saveChunks(db.getChunks().filter((c) => c.itemId !== id));
}

export function acharItem(id) {
  return db.getConhecimento().find((i) => i.id === id) || null;
}

// (Re)indexa um item: quebra em pedaços, gera embeddings e salva os chunks.
export async function reindexItem(item) {
  const pedacos = chunk(textoDoItem(item));
  // remove chunks antigos desse item
  let chunks = db.getChunks().filter((c) => c.itemId !== item.id);
  if (pedacos.length) {
    const vetores = await embed(pedacos);
    pedacos.forEach((texto, idx) => {
      chunks.push({ id: crypto.randomUUID(), agenteId: item.agenteId, itemId: item.id, texto, embedding: vetores[idx] });
    });
  }
  db.saveChunks(chunks);
  // marca como indexado
  const itens = db.getConhecimento();
  const i = itens.findIndex((x) => x.id === item.id);
  if (i !== -1) { itens[i].indexado = true; itens[i].qtdChunks = pedacos.length; db.saveConhecimento(itens); }
  return pedacos.length;
}

// Reindexa tudo de um agente (útil quando a chave da OpenAI é configurada depois).
export async function reindexAgente(agenteId) {
  let total = 0;
  for (const item of listarItens(agenteId)) total += await reindexItem(item);
  return total;
}

// ── Busca: retorna os trechos mais relevantes pra uma consulta ──
export async function buscarContexto(agenteId, consulta, k = TOP_K) {
  const chunks = db.getChunks().filter((c) => c.agenteId === agenteId && Array.isArray(c.embedding));
  if (!chunks.length || !consulta.trim()) return "";
  let vetor;
  try { [vetor] = await embed([consulta]); }
  catch { return ""; }
  const rank = chunks
    .map((c) => ({ texto: c.texto, score: cosine(vetor, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((r) => r.score > 0.2); // corta trechos irrelevantes
  if (!rank.length) return "";
  return rank.map((r, i) => `[${i + 1}] ${r.texto}`).join("\n\n");
}

// ── Extração de texto de arquivos ──
export async function extrairTextoArquivo(base64, mimetype, fileName = "") {
  const buf = Buffer.from(base64, "base64");
  const nome = (fileName || "").toLowerCase();
  const ehPdf = mimetype === "application/pdf" || nome.endsWith(".pdf");
  if (ehPdf) {
    const { default: pdfParse } = await import("pdf-parse");
    const r = await pdfParse(buf);
    return r.text || "";
  }
  // txt / md / csv / outros textos
  return buf.toString("utf-8");
}
