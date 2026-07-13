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

// Monta o prompt do sistema a partir das seções estruturadas do construtor.
export function montarPromptSistema(a) {
  const id = a.identidade || {};
  const p = a.persona || {};
  const pb = a.playbook || {};
  const esc = a.escalacao || {};
  const linhas = [];
  linhas.push(`Você é ${a.nome}, atendente de vendas da Escola Instructiva no WhatsApp.`);
  if (p.quemEla) linhas.push(p.quemEla);
  if (id.objetivo) linhas.push(`Seu objetivo: ${id.objetivo}`);
  if (id.tomVoz) linhas.push(`Tom de voz: ${id.tomVoz}.`);
  if (id.oQueFaz) linhas.push(`Modo de atuação: ${id.oQueFaz}.`);
  if (p.comoEscreve) linhas.push(`Como você escreve: ${p.comoEscreve}`);
  if (p.sempre) linhas.push(`SEMPRE:\n${p.sempre}`);
  if (p.nunca) linhas.push(`NUNCA:\n${p.nunca}`);

  const etapas = [
    ["Abertura", pb.abertura],
    ["Qualificação (perguntas-chave)", pb.qualificacao],
    ["Apresentação do curso", pb.apresentacao],
    ["Quando falar o preço", pb.quandoPreco],
    ["Fechamento", pb.fechamento],
    ["Recuperação (se o lead sumir)", pb.recuperacao],
  ].filter(([, v]) => v && v.trim());
  if (etapas.length) {
    linhas.push("SCRIPT DE VENDAS (use como guia, adapte ao lead, não seja robótico):");
    etapas.forEach(([t, v], i) => linhas.push(`${i + 1}. ${t}: ${v}`));
  }
  if (esc.criterios) linhas.push(`ENCERRAMENTO/ESCALAÇÃO: ${esc.criterios}`);
  linhas.push("Responda sempre em português, de forma natural e humana, como no WhatsApp.");
  return linhas.join("\n\n");
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
    iaAtiva: dados.iaAtiva !== false,
    modelo: dados.modelo || "",
    mensagemInicial: dados.mensagemInicial || "",
    // seções do construtor
    identidade: dados.identidade || {},
    persona: dados.persona || {},
    playbook: dados.playbook || {},
    escalacao: dados.escalacao || {},
    criadoEm: new Date().toISOString(),
  };
  novo.promptSistema = dados.promptSistema || montarPromptSistema(novo);
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
  // Se mexeu em alguma seção estruturada, recompõe o prompt (a não ser que
  // o próprio patch tenha mandado um promptSistema explícito).
  const mexeuSecao = ["identidade", "persona", "playbook", "escalacao", "nome"].some((k) => k in patch);
  if (mexeuSecao && !("promptSistema" in patch)) {
    agentes[i].promptSistema = montarPromptSistema(agentes[i]);
  }
  db.saveAgentes(agentes);
  return agentes[i];
}

export function removerAgente(id) {
  const agentes = db.getAgentes().filter((a) => a.id !== id);
  db.saveAgentes(agentes);
}
