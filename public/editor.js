// ───────── Construtor de agente (tela cheia) ─────────
const E = { agente: null, novo: false, secao: "identidade", kb: { curso: [], objecao: [], faq: [] }, preview: [] };

const TONS = ["Amigável e próximo", "Profissional e direto", "Consultivo e educado", "Descontraído e informal", "Empático e acolhedor"];
const OQUEFAZ = ["Fecha a venda sozinha (não passa pro vendedor)", "Qualifica e passa pro vendedor humano", "Só tira dúvidas e agenda"];

const SECOES = [
  { grp: "Geral" },
  { id: "identidade", ic: "★", nome: "Identidade" },
  { id: "persona", ic: "◉", nome: "Persona" },
  { grp: "Conhecimento" },
  { id: "cursos", ic: "▦", nome: "Cursos" },
  { id: "objecoes", ic: "◈", nome: "Objeções" },
  { id: "faq", ic: "💬", nome: "FAQ" },
  { grp: "Fluxo" },
  { id: "playbook", ic: "➤", nome: "Playbook" },
  { id: "escalacao", ic: "⏻", nome: "Escalação" },
];

function novoAgenteVazio() {
  return { nome: "", instancia: "", ativo: true, modelo: "", identidade: {}, persona: {}, playbook: {}, escalacao: {} };
}

async function abrirEditor(agente = null) {
  E.novo = !agente;
  E.agente = agente ? JSON.parse(JSON.stringify(agente)) : novoAgenteVazio();
  E.agente.identidade = E.agente.identidade || {}; E.agente.persona = E.agente.persona || {};
  E.agente.playbook = E.agente.playbook || {}; E.agente.escalacao = E.agente.escalacao || {};
  E.secao = "identidade"; E.preview = [];
  E.kb = { curso: [], objecao: [], faq: [] };
  document.body.style.overflow = "hidden";
  $("#editor").classList.add("open");
  $("#editor").onclick = (e) => { if (e.target.id === "editor") fecharEditor(); };
  renderEditor();
  if (E.agente.id) carregarKbEditor();
}
function fecharEditor() { $("#editor").classList.remove("open"); document.body.style.overflow = ""; }

function completude() {
  const a = E.agente;
  const checks = {
    identidade: Boolean(a.nome && a.identidade.objetivo),
    persona: Boolean(a.persona.quemEla || a.persona.comoEscreve),
    cursos: E.kb.curso.length > 0,
    objecoes: E.kb.objecao.length > 0,
    faq: E.kb.faq.length > 0,
    playbook: Boolean(a.playbook.abertura || a.playbook.qualificacao || a.playbook.apresentacao || a.playbook.quandoPreco || a.playbook.fechamento || a.playbook.recuperacao),
    escalacao: Boolean(a.escalacao.criterios),
  };
  const feitas = Object.values(checks).filter(Boolean).length;
  return { checks, feitas, total: 7, pct: Math.round((feitas / 7) * 100) };
}

function renderEditor() {
  const a = E.agente;
  const c = completude();
  $("#editor").innerHTML = `<div class="ed-box">
    <div class="ed-top">
      <div class="ic">${esc(iniciais(a.nome || "IA"))}</div>
      <div><h2>${E.novo ? "Criar agente" : "Editar agente"}</h2><div class="sub">${c.feitas}/7 seções preenchidas</div></div>
      <div class="sp"></div>
      <button class="btn ghost" id="ed-export">↓ Exportar</button>
      <button class="btn primary" id="ed-save">✓ Salvar agente</button>
      <button class="ed-close" id="ed-x">×</button>
    </div>
    <div class="ed-prog"><span>Completude</span><div class="track"><div class="fill" style="width:${c.pct}%"></div></div><b>${c.pct}%</b></div>
    <div class="ed-body">
      <div class="ed-nav" id="ed-nav"></div>
      <div class="ed-main" id="ed-main"></div>
      <div class="ed-preview" id="ed-preview"></div>
    </div></div>`;
  $("#editor").onclick = (e) => { if (e.target.id === "editor") fecharEditor(); };
  $("#ed-x").onclick = fecharEditor;
  $("#ed-save").onclick = salvarEditor;
  $("#ed-export").onclick = exportarAgente;
  const nav = $("#ed-nav");
  SECOES.forEach((s) => {
    if (s.grp) { nav.appendChild(el(`<div class="grp">${s.grp}</div>`)); return; }
    const done = c.checks[s.id];
    const item = el(`<div class="item ${E.secao === s.id ? "active" : ""} ${done ? "done" : ""}"><span>${s.ic}</span> ${s.nome} <span class="dot2">${done ? "✓" : "–"}</span></div>`);
    item.onclick = () => { E.secao = s.id; renderEditor(); };
    nav.appendChild(item);
  });
  renderSecao();
  renderPreview();
}

// Liga um input a E.agente[grupo][campo]
function bind(sel, grupo, campo) {
  const n = document.querySelector(sel); if (!n) return;
  n.oninput = () => { E.agente[grupo][campo] = n.value; agendarProgresso(); };
}
let progT;
function agendarProgresso() { clearTimeout(progT); progT = setTimeout(() => { const c = completude(); const f = document.querySelector(".ed-prog .fill"); const b = document.querySelector(".ed-prog b"); if (f) f.style.width = c.pct + "%"; if (b) b.textContent = c.pct + "%"; }, 300); }

function renderSecao() {
  const a = E.agente, m = $("#ed-main");
  if (E.secao === "identidade") {
    m.innerHTML = `<h3>Identificação</h3><div class="secdesc">O básico do agente.</div>
      <div class="row"><div><label>Nome do agente *</label><input id="i-nome" value="${esc(a.nome || "")}" placeholder="Ex: Clara — Inversor Solar" /></div>
        <div><label>Tom de voz</label><select id="i-tom">${TONS.map((t) => `<option ${a.identidade.tomVoz === t ? "selected" : ""}>${t}</option>`).join("")}</select></div></div>
      ${E.novo ? `<label>Instância <span class="hint">(nome técnico no Evolution, sem espaços)</span></label><input id="i-inst" class="mono-in" value="${esc(a.instancia || "")}" placeholder="solar" />` : `<label>Instância</label><input class="mono-in" value="${esc(a.instancia || "")}" disabled />`}
      <label>Objetivo principal *</label><input id="i-obj" value="${esc(a.identidade.objetivo || "")}" placeholder="Ex: Conduzir o lead até a matrícula no curso de Reparo de Inversor" />
      <label>O que ela faz</label><select id="i-faz">${OQUEFAZ.map((t) => `<option ${a.identidade.oQueFaz === t ? "selected" : ""}>${t}</option>`).join("")}</select>`;
    $("#i-nome").oninput = (e) => { a.nome = e.target.value; agendarProgresso(); };
    if (E.novo) $("#i-inst").oninput = (e) => { a.instancia = e.target.value; };
    $("#i-tom").onchange = (e) => { a.identidade.tomVoz = e.target.value; };
    $("#i-obj").oninput = (e) => { a.identidade.objetivo = e.target.value; agendarProgresso(); };
    $("#i-faz").onchange = (e) => { a.identidade.oQueFaz = e.target.value; };
  }
  else if (E.secao === "persona") {
    m.innerHTML = `<h3>Personalidade</h3><div class="secdesc">Quem é a IA e como ela fala.</div>
      <label>Quem ela é</label><textarea id="p-quem" placeholder="Ex: Você é a Clara, consultora de vendas da Escola Instructiva...">${esc(a.persona.quemEla || "")}</textarea>
      <label>Como escreve</label><textarea id="p-como" placeholder="Ex: Mensagens curtas, máx 3 linhas. Usa você. Sem formalidade.">${esc(a.persona.comoEscreve || "")}</textarea>
      <h4>Regras</h4>
      <div class="row"><div><label>SEMPRE faz</label><textarea id="p-sempre" placeholder="- Pergunta o nome no começo\n- Confirma interesse antes do preço">${esc(a.persona.sempre || "")}</textarea></div>
        <div><label>NUNCA faz</label><textarea id="p-nunca" placeholder="- Inventa preço ou informação\n- Promete o que não está no material">${esc(a.persona.nunca || "")}</textarea></div></div>`;
    bind("#p-quem", "persona", "quemEla"); bind("#p-como", "persona", "comoEscreve"); bind("#p-sempre", "persona", "sempre"); bind("#p-nunca", "persona", "nunca");
  }
  else if (E.secao === "playbook") {
    m.innerHTML = `<h3>Script de vendas</h3><div class="secdesc">Como conduzir a venda do começo ao fim.</div>
      ${dropzoneHtml("playbook")}
      <div class="orsep">ou preencha as etapas</div>
      <label>1. Primeira mensagem (abertura)</label><textarea id="pb-1" placeholder="Como puxar a conversa...">${esc(a.playbook.abertura || "")}</textarea>
      <label>2. Qualificação (perguntas-chave)</label><textarea id="pb-2">${esc(a.playbook.qualificacao || "")}</textarea>
      <label>3. Apresentação do curso</label><textarea id="pb-3">${esc(a.playbook.apresentacao || "")}</textarea>
      <label>4. Quando soltar o preço</label><textarea id="pb-4">${esc(a.playbook.quandoPreco || "")}</textarea>
      <label>5. Fechamento</label><textarea id="pb-5">${esc(a.playbook.fechamento || "")}</textarea>
      <label>6. Recuperação (se ele sumir)</label><textarea id="pb-6">${esc(a.playbook.recuperacao || "")}</textarea>`;
    bind("#pb-1", "playbook", "abertura"); bind("#pb-2", "playbook", "qualificacao"); bind("#pb-3", "playbook", "apresentacao");
    bind("#pb-4", "playbook", "quandoPreco"); bind("#pb-5", "playbook", "fechamento"); bind("#pb-6", "playbook", "recuperacao");
    ligarDropzone("playbook");
  }
  else if (E.secao === "escalacao") {
    m.innerHTML = `<h3>Escalação e encerramento</h3><div class="secdesc">Quando a IA deve passar para um humano ou encerrar.</div>
      <label>Critérios de encerramento / passar pra humano</label>
      <textarea id="e-crit" style="min-height:160px" placeholder="Ex: encerra quando o lead comprar, disser que não tem interesse, ou ficar 2 dias sem responder após o follow-up. Passa pro humano se pedir nota fiscal ou reclamar.">${esc(a.escalacao.criterios || "")}</textarea>`;
    bind("#e-crit", "escalacao", "criterios");
  }
  else { renderSecaoKb(); }
}

// Seções de base (cursos, objeções, faq)
const KBMETA = {
  cursos: { cat: "curso", titulo: "Cursos e ofertas", desc: "Anexe materiais (PDF, DOC, TXT) ou cadastre manualmente.", addLabel: "+ Adicionar Curso", tipo: "bloco" },
  objecoes: { cat: "objecao", titulo: "Contorno de objeções", desc: "Ensine a IA a responder as objeções mais comuns.", addLabel: "+ Adicionar Objeção", tipo: "qa" },
  faq: { cat: "faq", titulo: "Perguntas frequentes", desc: "Perguntas que sempre aparecem nos atendimentos.", addLabel: "+ Adicionar Pergunta", tipo: "qa" },
};
function renderSecaoKb() {
  const meta = KBMETA[E.secao]; const m = $("#ed-main");
  if (!E.agente.id) { m.innerHTML = `<h3>${meta.titulo}</h3><div class="secdesc">${meta.desc}</div><div class="empty" style="padding:34px">Salve o agente primeiro (aba Identidade) pra começar a alimentar a base.</div>`; return; }
  const itens = E.kb[meta.cat] || [];
  m.innerHTML = `<h3>${meta.titulo}</h3><div class="secdesc">${meta.desc}</div>
    ${dropzoneHtml(E.secao)}
    <div class="orsep">ou adicione manualmente</div>
    <div id="kb-itens"></div>
    <div class="additem" id="kb-add">${meta.addLabel}</div>`;
  const cont = $("#kb-itens");
  itens.forEach((it) => {
    const titulo = it.tipo === "qa" ? it.pergunta : (it.titulo || "Item");
    const row = el(`<div class="kbrow"><div style="display:flex;gap:8px;align-items:center"><b style="flex:1;font-size:13.5px">${esc(titulo)}</b>
      <span class="kbstatus">${it.indexado ? `✓ ${it.qtdChunks}` : "…"}</span></div>
      <div class="kbsnip" style="margin:6px 0">${esc((it.conteudo || "").slice(0, 130))}</div>
      <div style="display:flex;gap:7px"></div></div>`);
    const acts = row.querySelector("div:last-child");
    if (it.tipo !== "arquivo") { const e1 = el(`<button class="btn small ghost">Editar</button>`); e1.onclick = () => kbEditorForm(meta, it); acts.appendChild(e1); }
    const e2 = el(`<button class="btn small danger ghost">Excluir</button>`); e2.onclick = () => kbExcluir(it.id); acts.appendChild(e2);
    cont.appendChild(row);
  });
  $("#kb-add").onclick = () => kbEditorForm(meta, null);
  ligarDropzone(E.secao);
}
function dropzoneHtml(secao) {
  return `<div class="dropzone" id="dz-${secao}"><div>⬆</div><div class="big">Anexar PDF, DOC ou TXT</div><div style="font-size:12px">Clique para selecionar</div></div>
    <input type="file" id="dzf-${secao}" accept=".pdf,.txt,.md,.csv,.doc,.docx" hidden />`;
}
function ligarDropzone(secao) {
  const dz = $(`#dz-${secao}`), f = $(`#dzf-${secao}`); if (!dz || !f) return;
  const cat = KBMETA[secao]?.cat;
  dz.onclick = () => { if (!E.agente.id) return toast("Salve o agente primeiro.", "err"); f.click(); };
  f.onchange = async () => {
    const file = f.files[0]; if (!file) return;
    toast("Lendo e indexando o arquivo…");
    try {
      const base64 = await fileToBase64(file);
      await api(`/agentes/${E.agente.id}/kb/arquivo`, { method: "POST", body: JSON.stringify({ base64, mimetype: file.type, fileName: file.name, categoria: cat || "geral" }) });
      toast("Arquivo adicionado.", "ok"); await carregarKbEditor(); renderEditor();
    } catch (e) { toast(e.message, "err"); }
    f.value = "";
  };
}
function kbEditorForm(meta, item) {
  const ed = Boolean(item);
  const campos = meta.tipo === "qa"
    ? `<label>${meta.cat === "objecao" ? "Objeção do lead" : "Pergunta"}</label><input id="k-p" value="${esc(item?.pergunta || "")}" placeholder="${meta.cat === "objecao" ? "Tá caro..." : "Tem certificado?"}" />
       <label>Resposta</label><textarea id="k-c">${esc(item?.conteudo || "")}</textarea>`
    : `<label>Nome do curso/oferta</label><input id="k-t" value="${esc(item?.titulo || "")}" placeholder="Curso de Inversor Solar" />
       <label>Detalhes (preço, o que inclui, link, garantia...)</label><textarea id="k-c" style="min-height:150px">${esc(item?.conteudo || "")}</textarea>`;
  abrirModal(`<button class="close" data-close>×</button><h3>${ed ? "Editar" : "Adicionar"}</h3>
    <div class="desc">Depois de salvar, o sistema indexa pra IA usar.</div>${campos}
    <div class="footer"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="k-save">${ed ? "Salvar" : "Adicionar"}</button></div>`);
  $("#k-save").onclick = async () => {
    const payload = { tipo: meta.tipo, categoria: meta.cat, conteudo: $("#k-c").value.trim() };
    if (meta.tipo === "qa") payload.pergunta = $("#k-p").value.trim();
    else payload.titulo = $("#k-t").value.trim();
    if (!payload.conteudo || (meta.tipo === "qa" && !payload.pergunta)) return toast("Preencha os campos.", "err");
    toast("Salvando e indexando…");
    try {
      if (ed) await api(`/kb/${item.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api(`/agentes/${E.agente.id}/kb`, { method: "POST", body: JSON.stringify(payload) });
      fecharModal(); toast("Salvo.", "ok"); await carregarKbEditor(); renderEditor();
    } catch (e) { toast(e.message, "err"); }
  };
}
async function kbExcluir(id) {
  if (!confirm("Excluir esse item?")) return;
  try { await api(`/kb/${id}`, { method: "DELETE" }); toast("Removido.", "ok"); await carregarKbEditor(); renderEditor(); }
  catch (e) { toast(e.message, "err"); }
}
async function carregarKbEditor() {
  if (!E.agente.id) return;
  try {
    const itens = await api(`/agentes/${E.agente.id}/kb`);
    E.kb = { curso: [], objecao: [], faq: [] };
    itens.forEach((it) => { const c = it.categoria || "geral"; if (E.kb[c]) E.kb[c].push(it); });
  } catch {}
}

// Preview ao vivo
function renderPreview() {
  const box = $("#ed-preview"); if (!box) return;
  box.innerHTML = `<div class="ph"><b>▷ Preview ao vivo</b><button class="btn small ghost" id="pv-reset">↺ Resetar</button></div>
    <div class="pmsgs" id="pv-msgs"></div>
    <div class="pcomp"><textarea id="pv-in" rows="1" placeholder="Digite como o lead..." style="border-radius:22px"></textarea><button class="btn wa" id="pv-send" style="border-radius:22px">➤</button></div>`;
  const msgs = $("#pv-msgs");
  if (!E.preview.length) msgs.innerHTML = `<div class="empty2">Mande uma mensagem como se fosse o lead e veja a IA responder em tempo real, usando tudo que você configurou.</div>`;
  else E.preview.forEach((m) => msgs.appendChild(el(`<div class="msg ${m.role === "assistant" ? "assistant" : "user"}">${esc(m.content)}</div>`)));
  msgs.scrollTop = msgs.scrollHeight;
  $("#pv-reset").onclick = () => { E.preview = []; renderPreview(); };
  const enviar = async () => {
    const inp = $("#pv-in"); const t = inp.value.trim(); if (!t) return;
    if (!E.agente.id) return toast("Salve o agente primeiro pra testar.", "err");
    E.preview.push({ role: "user", content: t }); inp.value = ""; renderPreview();
    const pending = el(`<div class="msg assistant" style="opacity:.6">digitando…</div>`); $("#pv-msgs").appendChild(pending); $("#pv-msgs").scrollTop = 1e6;
    try {
      const prompt = window.montarPromptClient ? window.montarPromptClient(E.agente) : E.agente.promptSistema;
      const r = await api(`/agentes/${E.agente.id}/preview`, { method: "POST", body: JSON.stringify({ mensagem: t, historico: E.preview.slice(0, -1), promptSistema: prompt }) });
      E.preview.push({ role: "assistant", content: r.resposta }); renderPreview();
    } catch (e) { pending.remove(); toast(e.message, "err"); }
  };
  $("#pv-send").onclick = enviar;
  $("#pv-in").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } };
}

// Monta o prompt no cliente (pra preview refletir edições não salvas)
window.montarPromptClient = function (a) {
  const id = a.identidade || {}, p = a.persona || {}, pb = a.playbook || {}, esc2 = a.escalacao || {};
  const L = [`Você é ${a.nome}, atendente de vendas da Escola Instructiva no WhatsApp.`];
  if (p.quemEla) L.push(p.quemEla);
  if (id.objetivo) L.push(`Seu objetivo: ${id.objetivo}`);
  if (id.tomVoz) L.push(`Tom de voz: ${id.tomVoz}.`);
  if (id.oQueFaz) L.push(`Modo: ${id.oQueFaz}.`);
  if (p.comoEscreve) L.push(`Como escreve: ${p.comoEscreve}`);
  if (p.sempre) L.push(`SEMPRE:\n${p.sempre}`);
  if (p.nunca) L.push(`NUNCA:\n${p.nunca}`);
  const et = [["Abertura", pb.abertura], ["Qualificação", pb.qualificacao], ["Apresentação", pb.apresentacao], ["Preço", pb.quandoPreco], ["Fechamento", pb.fechamento], ["Recuperação", pb.recuperacao]].filter(([, v]) => v && v.trim());
  if (et.length) { L.push("SCRIPT DE VENDAS (guia, adapte):"); et.forEach(([t, v], i) => L.push(`${i + 1}. ${t}: ${v}`)); }
  if (esc2.criterios) L.push(`ENCERRAMENTO: ${esc2.criterios}`);
  L.push("Responda em português, natural e humano, como no WhatsApp.");
  return L.join("\n\n");
};

async function salvarEditor() {
  const a = E.agente;
  if (!a.nome.trim()) { E.secao = "identidade"; renderEditor(); return toast("Dá um nome pro agente.", "err"); }
  const payload = {
    nome: a.nome.trim(), ativo: a.ativo !== false, modelo: a.modelo || "",
    identidade: a.identidade, persona: a.persona, playbook: a.playbook, escalacao: a.escalacao,
  };
  try {
    if (E.novo) {
      if (!a.instancia.trim()) { E.secao = "identidade"; renderEditor(); return toast("Defina a instância (nome técnico).", "err"); }
      payload.instancia = a.instancia.trim();
      const novo = await api("/agentes", { method: "POST", body: JSON.stringify(payload) });
      E.agente = { ...novo, identidade: novo.identidade || {}, persona: novo.persona || {}, playbook: novo.playbook || {}, escalacao: novo.escalacao || {} };
      E.novo = false;
      toast("Agente criado! Agora você já pode alimentar a base.", "ok");
    } else {
      const upd = await api(`/agentes/${a.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      E.agente = { ...E.agente, ...upd };
      toast("Agente salvo.", "ok");
    }
    renderEditor();
    if (typeof viewAgentes === "function" && S.view === "agentes") viewAgentes();
  } catch (e) { toast(e.message, "err"); }
}

function exportarAgente() {
  const dados = { agente: E.agente, base: E.kb };
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = `agente-${(E.agente.nome || "novo").toLowerCase().replace(/\s+/g, "-")}.json`;
  link.click(); URL.revokeObjectURL(url);
}
