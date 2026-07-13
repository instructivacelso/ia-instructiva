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
  const L = [];

  L.push(`# QUEM VOCÊ É`);
  L.push(`Você é ${a.nome}, atendente de vendas da Escola Instructiva, conversando com um lead pelo WhatsApp.` + (p.quemEla ? ` ${p.quemEla}` : ""));
  if (id.objetivo) L.push(`Seu objetivo em toda conversa: ${id.objetivo}.`);

  L.push(`\n# COMO VOCÊ FALA`);
  if (id.tomVoz) L.push(`- Tom: ${id.tomVoz}.`);
  if (p.comoEscreve) L.push(`- Estilo: ${p.comoEscreve}`);
  L.push(`- Escreva como uma pessoa de verdade no WhatsApp: natural, direto, sem parecer robô ou vendedor decorado.`);
  L.push(`- Mensagens curtas. Responda em UMA mensagem só por vez. Nada de textão.`);
  L.push(`- Use o nome do lead quando souber. Uma pergunta por vez.`);

  if (p.sempre || p.nunca) {
    L.push(`\n# REGRAS INVIOLÁVEIS (siga SEMPRE, sem exceção)`);
    if (p.sempre) L.push(`SEMPRE:\n${p.sempre}`);
    if (p.nunca) L.push(`NUNCA:\n${p.nunca}`);
  }
  L.push(`\n# REGRAS DE OURO`);
  L.push(`- NUNCA invente preço, link, prazo, condição ou qualquer informação. Só afirme o que estiver na BASE DE CONHECIMENTO ou no que você configurou. Se não souber, diga que vai confirmar — não chute.`);
  L.push(`- Responda EXATAMENTE o que o lead perguntou antes de puxar o assunto de volta pra venda.`);
  L.push(`- Leia TODAS as mensagens recentes do lead antes de responder (ele costuma mandar em pedaços). Junte o sentido e responda uma vez só.`);
  L.push(`- Não repita o que já disse. Não mande saudação de novo no meio da conversa.`);

  const etapas = [
    ["Abertura", pb.abertura],
    ["Qualificação (o que perguntar)", pb.qualificacao],
    ["Apresentação do curso", pb.apresentacao],
    ["Quando e como falar o preço", pb.quandoPreco],
    ["Fechamento", pb.fechamento],
    ["Recuperação (se o lead sumir)", pb.recuperacao],
  ].filter(([, v]) => v && v.trim());
  if (etapas.length) {
    L.push(`\n# SCRIPT DE VENDAS (seu roteiro — siga a ordem, mas soe natural e adapte ao lead)`);
    etapas.forEach(([t, v], i) => L.push(`${i + 1}. ${t}: ${v}`));
  }
  if (esc.criterios) { L.push(`\n# QUANDO ENCERRAR OU CHAMAR UM HUMANO`); L.push(esc.criterios); }

  L.push(`\nResponda agora à última fala do lead, em português, seguindo tudo acima.`);
  return L.join("\n");
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
