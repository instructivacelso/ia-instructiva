import { db } from "./db.js";
import crypto from "crypto";

export function slug(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function listarAgentes() {
  return db.getAgentes();
}

// Agentes de um usuário (admin vê todos).
export function listarAgentesDoUsuario(usuario) {
  const todos = db.getAgentes();
  if (usuario?.role === "admin") return todos;
  return todos.filter((a) => a.usuarioId === usuario?.id);
}

export function podeAcessarAgente(usuario, agente) {
  if (!agente) return false;
  if (usuario?.role === "admin") return true;
  return agente.usuarioId === usuario?.id;
}

export function acharAgente(id) {
  return db.getAgentes().find((a) => a.id === id) || null;
}

// Casa a instância que veio no webhook do Evolution com o agente dono dela.
export function acharAgentePorInstancia(instancia) {
  return db.getAgentes().find((a) => a.instancia === instancia) || null;
}

export function criarAgente(dados) {
  const agentes = db.getAgentes();
  const id = crypto.randomUUID();
  const instancia = slug(dados.instancia || dados.nome) || `agente-${id.slice(0, 6)}`;

  if (agentes.some((a) => a.instancia === instancia)) {
    throw new Error(`Já existe um agente usando a instância "${instancia}".`);
  }

  const novo = {
    id,
    usuarioId: dados.usuarioId || null,
    nome: dados.nome || "Novo agente",
    instancia,
    ativo: dados.ativo !== false,
    promptSistema: dados.promptSistema || "Você é um atendente da Escola Instructiva.",
    mensagemInicial: dados.mensagemInicial || "", // vazio = IA gera a abertura
    modelo: dados.modelo || "", // vazio = usa o modelo padrão global
    criadoEm: new Date().toISOString(),
  };
  agentes.push(novo);
  db.saveAgentes(agentes);
  return novo;
}

export function atualizarAgente(id, patch) {
  const agentes = db.getAgentes();
  const i = agentes.findIndex((a) => a.id === id);
  if (i === -1) throw new Error("Agente não encontrado.");
  // instancia é imutável depois de criada (evita quebrar o vínculo do webhook)
  const { instancia, id: _ignore, ...resto } = patch;
  agentes[i] = { ...agentes[i], ...resto };
  db.saveAgentes(agentes);
  return agentes[i];
}

export function removerAgente(id) {
  const agentes = db.getAgentes().filter((a) => a.id !== id);
  db.saveAgentes(agentes);
}
