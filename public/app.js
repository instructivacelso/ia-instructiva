// ───────── Estado + helpers ─────────
const S = {
  token: sessionStorage.getItem("ia_token") || "",
  usuario: null,
  view: "agentes",
  agentes: [],
  convAtual: null,
  agenteFiltro: "",
  timers: [],
};
const $ = (s) => document.querySelector(s);
const el = (h) => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const iniciais = (n) => (String(n||"?").trim().split(/\s+/).map(p=>p[0]).slice(0,2).join("") || "?").toUpperCase();
const limparTimers = () => { S.timers.forEach(clearInterval); S.timers = []; };
const mediaUrl = (p) => `/api/media/${p}?token=${encodeURIComponent(S.token)}`;

// ── Tema claro/escuro ──
function aplicarTema(t) {
  const dark = t === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "";
  localStorage.setItem("ia_tema", dark ? "dark" : "light");
  const i = document.querySelector("#temaIco"), x = document.querySelector("#temaTxt");
  if (i) i.textContent = dark ? "☀" : "☾";
  if (x) x.textContent = dark ? "Modo claro" : "Modo escuro";
}
function toggleTema() { aplicarTema(localStorage.getItem("ia_tema") === "dark" ? "light" : "dark"); }
aplicarTema(localStorage.getItem("ia_tema") || "light");

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + S.token, ...(opts.headers || {}) },
  });
  const dados = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error("Sessão expirada."); }
  if (!res.ok) throw new Error(dados.erro || `Erro ${res.status}`);
  return dados;
}
let toastT;
function toast(msg, tipo = "") { const t = $("#toast"); t.textContent = msg; t.className = "toast show " + tipo; clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast " + tipo), 3200); }

// ───────── Login ─────────
async function entrar(login, senha) {
  const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, senha }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.erro || "Falha no login.");
  S.token = d.token; sessionStorage.setItem("ia_token", d.token);
  const me = await api("/me");
  S.usuario = me.usuario;
  iniciarApp();
}
async function restaurarSessao() {
  try { const me = await api("/me"); S.usuario = me.usuario; iniciarApp(); }
  catch { logout(); }
}
function logout() {
  sessionStorage.removeItem("ia_token"); S.token = ""; S.usuario = null; limparTimers();
  $("#app").classList.remove("visible"); $("#gate").style.display = "grid";
}
async function iniciarApp(me) {
  $("#gate").style.display = "none"; $("#app").classList.add("visible");
  $("#uAvatar").textContent = iniciais(S.usuario.nome);
  $("#uNome").textContent = S.usuario.nome;
  $("#uRole").textContent = S.usuario.role === "admin" ? "administrador" : "usuário";
  $("#greeting").textContent = "Olá, " + String(S.usuario.nome || "").split(/\s+/)[0];
  try { S.agentes = await api("/agentes"); } catch {}
  renderBulkIa();
  montarNav();
  irPara("dashboard");
}

// Botão que pausa/liga a IA de TODOS os MEUS números de uma vez.
function renderBulkIa() {
  const box = document.querySelector("#globalIa");
  if (!box) return;
  const meus = (S.agentes || []).filter((a) => a.usuarioId === S.usuario.id);
  if (!meus.length) { box.innerHTML = ""; return; }
  const algumLigado = meus.some((a) => a.iaAtiva !== false);
  box.innerHTML = `<div class="iaglobal ${algumLigado ? "" : "off"}">
    <span class="lbl"><span class="dotst"></span> minhas IAs: ${algumLigado ? "ligadas" : "pausadas"}</span>
    <button class="tgl">${algumLigado ? "Pausar minhas" : "Ligar minhas"}</button></div>`;
  box.querySelector(".tgl").onclick = async () => {
    const nova = !algumLigado;
    try {
      await api("/agentes/ia-bulk", { method: "POST", body: JSON.stringify({ ativa: nova }) });
      S.agentes = await api("/agentes");
      renderBulkIa();
      if (S.view === "agentes") viewAgentes();
      toast(nova ? "IA ligada nos seus números." : "IA pausada nos seus números.", "ok");
    } catch (e) { toast(e.message, "err"); }
  };
}

function montarNav() {
  const admin = S.usuario.role === "admin";
  const itens = [
    { v: "dashboard", txt: "Painel" },
    { v: "agentes", txt: "Agentes" },
    { v: "conversas", txt: "Conversas" },
    ...(admin ? [{ v: "usuarios", txt: "Usuários" }, { v: "config", txt: "Configurações" }] : []),
  ];
  const nav = $("#nav"); nav.innerHTML = "";
  itens.forEach((it) => {
    const b = el(`<button class="navbtn" data-view="${it.v}">${it.txt}</button>`);
    b.onclick = () => irPara(it.v);
    nav.appendChild(b);
  });
}

function irPara(view) {
  S.view = view; limparTimers();
  document.querySelectorAll(".navbtn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#overlay").classList.remove("open");
  $("#content").classList.remove("chatmode");
  document.body.classList.remove("chatview");
  const T = {
    dashboard: ["Painel", "Visão geral em tempo real."],
    agentes: ["Agentes", "Cada agente é um número de WhatsApp com sua própria IA."],
    conversas: ["Conversas", "Acompanhe e assuma quando precisar."],
    usuarios: ["Usuários", "Quem tem acesso à central."],
    config: ["Configurações", "Chaves e conexões do sistema."],
  };
  $("#viewTitle").textContent = T[view][0];
  $("#viewSub").textContent = T[view][1];
  $("#topActions").innerHTML = "";
  ({ dashboard: viewDashboard, agentes: viewAgentes, conversas: viewConversas, usuarios: viewUsuarios, config: viewConfig }[view])();
}

// ───────── Agentes ─────────
async function viewAgentes() {
  const btn = el(`<button class="btn primary">+ Novo agente</button>`);
  btn.onclick = () => abrirEditor();
  $("#topActions").appendChild(btn);
  const content = $("#content");
  content.innerHTML = `<div style="color:var(--muted)">Carregando…</div>`;
  try { S.agentes = await api("/agentes"); }
  catch (e) { content.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  renderBulkIa();
  if (!S.agentes.length) {
    content.innerHTML = `<div class="empty"><div class="big">Nenhum agente ainda</div>Crie o primeiro pra conectar um número e treinar sua IA.</div>`;
    return;
  }
  const grid = el(`<div class="grid"></div>`);
  S.agentes.forEach((a) => grid.appendChild(cardAgente(a)));
  content.innerHTML = ""; content.appendChild(grid);
  const upd = async () => { for (const a of S.agentes) { try { const r = await api(`/agentes/${a.id}/estado`); pintarEstado(a.id, r.estado); } catch { pintarEstado(a.id, "erro"); } } };
  upd(); S.timers.push(setInterval(upd, 8000));
}
function cardAgente(a) {
  const admin = S.usuario.role === "admin";
  const iaOff = a.iaAtiva === false;
  const c = el(`<div class="card ${a.ativo ? "" : "inativo"}">
    <div class="strip"></div>
    <div class="pad">
      <div class="head">
        <div class="headleft">
          <div class="tile">${esc(iniciais(a.nome))}</div>
          <div style="min-width:0">
            <h3>${esc(a.nome)} ${a.ativo ? "" : '<span class="tag-off">inativo</span>'} ${iaOff ? '<span class="badge-pausada">IA pausada</span>' : ""}</h3>
            <div class="inst">instância: ${esc(a.instancia)}</div>
            ${admin && a.usuarioId ? `<div class="owner">${esc((S._usuarios||{})[a.usuarioId] || "dono")}</div>` : ""}
          </div>
        </div>
        <div class="state" data-state="${a.id}"><span class="led"></span> ···</div>
      </div>
      <div class="prompt">${esc(a.promptSistema)}</div>
      <div class="meta"><span><b>modelo</b> ${esc(a.modelo || "padrão")}</span><span><b>abertura</b> ${a.mensagemInicial ? "fixa" : "por IA"}</span></div>
      <div class="actions"></div>
    </div></div>`);
  const act = c.querySelector(".actions");
  const add = (t, cls, fn) => { const b = el(`<button class="btn small ${cls}">${t}</button>`); b.onclick = fn; act.appendChild(b); };
  add("Conectar", "wa", () => modalConexao(a));
  add(iaOff ? "Ligar IA" : "Pausar IA", iaOff ? "" : "ghost", () => toggleIaAgente(a));
  add("Editar", "ghost", () => abrirEditor(a));
  add("Webhook", "ghost", () => modalWebhook(a));
  add("Excluir", "danger ghost", () => excluirAgente(a));
  return c;
}
async function toggleIaAgente(a) {
  const nova = a.iaAtiva === false; // se estava off, liga
  try {
    await api(`/agentes/${a.id}`, { method: "PATCH", body: JSON.stringify({ iaAtiva: nova }) });
    toast(nova ? `IA ligada no número "${a.nome}".` : `IA pausada no número "${a.nome}".`, "ok");
    viewAgentes();
  } catch (e) { toast(e.message, "err"); }
}
function pintarEstado(id, estado) {
  const n = document.querySelector(`.state[data-state="${id}"]`); if (!n) return;
  const m = { open:["open","conectado"], connecting:["connecting","conectando"], close:["close","desconectado"], erro:["erro","sem resposta"] };
  const [cls, txt] = m[estado] || ["", estado || "?"];
  n.className = "state " + cls; n.innerHTML = `<span class="led"></span> ${txt}`;
}
async function excluirAgente(a) {
  if (!confirm(`Excluir o agente "${a.nome}"?`)) return;
  try { await api(`/agentes/${a.id}`, { method: "DELETE" }); toast("Agente excluído.", "ok"); viewAgentes(); }
  catch (e) { toast(e.message, "err"); }
}
function modalAgente(a = null) {
  const ed = Boolean(a);
  abrirModal(`<button class="close" data-close>×</button>
    <h3>${ed ? "Editar agente" : "Novo agente"}</h3>
    <div class="desc">Defina o comportamento da IA e a que número ela responde.</div>
    <label>Nome do agente</label>
    <input id="f-nome" value="${esc(a?.nome || "")}" placeholder="Ex: IA Inversor Solar" />
    ${ed ? "" : `<label>Instância <span class="hint">(nome técnico no Evolution, sem espaços)</span></label><input id="f-inst" class="mono-in" placeholder="solar" />`}
    <label>Prompt / treinamento da IA</label>
    <textarea id="f-prompt" style="min-height:120px" placeholder="Você é o atendente da Escola Instructiva especialista em...">${esc(a?.promptSistema || "")}</textarea>
    <label>Mensagem de abertura <span class="hint">(vazio = IA cria sozinha; use {nome})</span></label>
    <textarea id="f-abertura" placeholder="Oi {nome}! Vi seu interesse no curso 👋">${esc(a?.mensagemInicial || "")}</textarea>
    <div class="row">
      <div><label>Modelo <span class="hint">(opcional)</span></label><input id="f-modelo" class="mono-in" value="${esc(a?.modelo || "")}" placeholder="gpt-4o-mini" /></div>
      <div><label>Status</label><select id="f-ativo"><option value="true" ${a?.ativo!==false?"selected":""}>Ativo</option><option value="false" ${a?.ativo===false?"selected":""}>Inativo</option></select></div>
    </div>
    <div class="footer"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="f-salvar">${ed ? "Salvar" : "Criar agente"}</button></div>`);
  $("#f-salvar").onclick = async () => {
    const p = { nome: $("#f-nome").value.trim(), promptSistema: $("#f-prompt").value.trim(), mensagemInicial: $("#f-abertura").value.trim(), modelo: $("#f-modelo").value.trim(), ativo: $("#f-ativo").value === "true" };
    if (!ed) p.instancia = $("#f-inst").value.trim();
    if (!p.nome) return toast("Dá um nome pro agente.", "err");
    try {
      if (ed) await api(`/agentes/${a.id}`, { method: "PATCH", body: JSON.stringify(p) });
      else await api("/agentes", { method: "POST", body: JSON.stringify(p) });
      toast(ed ? "Agente atualizado." : "Agente criado.", "ok"); fecharModal(); viewAgentes();
    } catch (e) { toast(e.message, "err"); }
  };
}
function modalConexao(a) {
  abrirModal(`<button class="close" data-close>×</button><h3>Conectar ${esc(a.nome)}</h3>
    <div class="desc">Escaneie o QR com o WhatsApp que vai atender por esse agente.</div>
    <div id="conx"><div style="text-align:center;padding:30px"><span class="spin"></span></div></div>`);
  iniciarConexao(a);
}
async function iniciarConexao(a) {
  const box = $("#conx");
  try {
    box.innerHTML = `<div style="text-align:center;padding:24px"><span class="spin"></span><div style="color:var(--muted);margin-top:10px;font-size:12.5px">preparando instância…</div></div>`;
    await api(`/agentes/${a.id}/instancia`, { method: "POST" });
    await carregarQR(a);
  } catch (e) { box.innerHTML = `<div style="color:var(--danger);text-align:center;padding:20px">${esc(e.message)}</div>`; }
}
async function carregarQR(a) {
  const box = $("#conx");
  const desenhar = async () => {
    try { const est = await api(`/agentes/${a.id}/estado`); if (est.estado === "open") { box.innerHTML = `<div class="qrwrap"><div style="font-size:44px">✅</div><div class="hint" style="color:var(--ok)">Conectado! O agente já está atendendo.</div></div>`; pintarEstado(a.id, "open"); return true; } } catch {}
    try {
      const r = await api(`/agentes/${a.id}/qr`);
      if (r.base64) { const src = r.base64.startsWith("data:") ? r.base64 : `data:image/png;base64,${r.base64}`; box.innerHTML = `<div class="qrwrap"><img src="${src}" alt="QR" />${r.pairingCode ? `<div class="code">${esc(r.pairingCode)}</div>` : ""}<div class="hint">WhatsApp → Aparelhos conectados → Conectar aparelho</div></div>`; }
      else if (r.pairingCode || r.code) box.innerHTML = `<div class="qrwrap"><div class="code">${esc(r.pairingCode || r.code)}</div><div class="hint">Digite esse código no WhatsApp.</div></div>`;
      else box.innerHTML = `<div style="color:var(--muted);text-align:center;padding:20px">Aguardando QR do Evolution…</div>`;
    } catch (e) { box.innerHTML = `<div style="color:var(--danger);text-align:center;padding:20px">${esc(e.message)}</div>`; }
    return false;
  };
  if (await desenhar()) return;
  const t = setInterval(async () => { if (!$("#overlay").classList.contains("open")) { clearInterval(t); return; } if (await desenhar()) clearInterval(t); }, 6000);
  S.timers.push(t);
}
function modalWebhook(a) {
  const base = location.origin;
  const urlLead = `${base}/webhook/lead/${a.instancia}`;
  abrirModal(`<button class="close" data-close>×</button><h3>Webhooks · ${esc(a.nome)}</h3>
    <div class="desc">A landing page desse produto manda o lead pra URL abaixo (POST JSON).</div>
    <label>Receber lead</label>
    <div class="readout"><span>${esc(urlLead)}</span><button class="btn small ghost" onclick="copiar('${esc(urlLead)}')">copiar</button></div>
    <label>Exemplo (JSON)</label>
    <div class="readout" style="color:var(--muted);display:block">${esc('{ "nome": "João", "telefone": "5511998877665", "interesse": "curso solar" }')}</div>
    <div id="whStatus" style="margin-top:14px;font-size:12.5px;color:var(--muted);min-height:18px"></div>
    <div class="footer"><button class="btn ghost" id="whCheck">Verificar registro</button><button class="btn primary" id="whReg">Registrar webhook agora</button></div>`);
  const status = (m, c) => { const n = $("#whStatus"); n.textContent = m; n.style.color = c || "var(--muted)"; };
  $("#whReg").onclick = async () => { status("registrando…"); try { const r = await api(`/agentes/${a.id}/webhook`, { method: "POST" }); status(`✓ Registrado (formato ${r.formato}). Mande uma mensagem de outro número.`, "var(--ok)"); } catch (e) { status("✗ " + e.message, "var(--danger)"); } };
  $("#whCheck").onclick = async () => { status("consultando…"); try { const r = await api(`/agentes/${a.id}/webhook`); if (r.erro) return status("✗ " + r.erro, "var(--danger)"); if (r.confere) status("✓ Webhook certo e registrado.", "var(--ok)"); else if (r.registrado) status(`⚠ Registrado, mas em: ${r.registrado}`, "var(--signal)"); else status("✗ Nenhum webhook. Clique em Registrar.", "var(--danger)"); } catch (e) { status("✗ " + e.message, "var(--danger)"); } };
}
window.copiar = (t) => navigator.clipboard.writeText(t).then(() => toast("Copiado.", "ok"));

// ── Base de conhecimento ──
const KB_TIPOS = { texto: "Texto", bloco: "Bloco", qa: "Pergunta", arquivo: "Arquivo" };
async function modalConhecimento(a) {
  abrirModal(`<button class="close" data-close>×</button>
    <h3>Base de conhecimento</h3>
    <div class="desc">${esc(a.nome)} · a IA usa isso pra responder com preços, links e respostas certas.</div>
    <div style="display:flex; gap:7px; flex-wrap:wrap; margin-bottom:16px">
      <button class="btn small" id="kb-texto">+ Texto</button>
      <button class="btn small" id="kb-bloco">+ Bloco</button>
      <button class="btn small" id="kb-qa">+ Pergunta/Resposta</button>
      <button class="btn small" id="kb-arquivo">+ Arquivo (PDF/txt)</button>
      <button class="btn small ghost" id="kb-reindex" style="margin-left:auto">Reindexar</button>
    </div>
    <input type="file" id="kb-file" accept=".pdf,.txt,.md,.csv" hidden />
    <div id="kb-lista"><div style="color:var(--muted)">Carregando…</div></div>`, true);
  $("#kb-texto").onclick = () => kbForm(a, "texto");
  $("#kb-bloco").onclick = () => kbForm(a, "bloco");
  $("#kb-qa").onclick = () => kbForm(a, "qa");
  $("#kb-arquivo").onclick = () => $("#kb-file").click();
  $("#kb-file").onchange = async () => {
    const f = $("#kb-file").files[0]; if (!f) return;
    toast("Lendo e indexando arquivo…");
    try {
      const base64 = await fileToBase64(f);
      await api(`/agentes/${a.id}/kb/arquivo`, { method: "POST", body: JSON.stringify({ base64, mimetype: f.type, fileName: f.name }) });
      toast("Arquivo adicionado à base.", "ok"); carregarKb(a);
    } catch (e) { toast(e.message, "err"); }
    $("#kb-file").value = "";
  };
  $("#kb-reindex").onclick = async () => {
    toast("Reindexando…");
    try { const r = await api(`/agentes/${a.id}/kb/reindex`, { method: "POST" }); toast(`Base reindexada (${r.pedacos} trechos).`, "ok"); carregarKb(a); }
    catch (e) { toast(e.message, "err"); }
  };
  carregarKb(a);
}
async function carregarKb(a) {
  const box = $("#kb-lista"); if (!box) return;
  let itens;
  try { itens = await api(`/agentes/${a.id}/kb`); }
  catch (e) { box.innerHTML = `<div style="color:var(--danger)">${esc(e.message)}</div>`; return; }
  if (!itens.length) { box.innerHTML = `<div class="empty" style="padding:28px">Nada na base ainda. Adicione textos, blocos, perguntas ou um PDF.</div>`; return; }
  box.innerHTML = "";
  itens.forEach((it) => {
    const titulo = it.tipo === "qa" ? it.pergunta : (it.titulo || (it.tipo === "texto" ? "Texto" : "Item"));
    const snippet = (it.conteudo || "").slice(0, 120);
    const el2 = el(`<div class="kbitem">
      <div class="kbtop"><span class="kbtag ${it.tipo}">${esc(KB_TIPOS[it.tipo] || it.tipo)}</span>
        <b>${esc(titulo)}</b>
        <span class="kbstatus">${it.indexado ? `✓ ${it.qtdChunks} trechos` : "não indexado"}</span></div>
      <div class="kbsnip">${esc(snippet)}${(it.conteudo || "").length > 120 ? "…" : ""}</div>
      <div class="kbacts"></div></div>`);
    const acts = el2.querySelector(".kbacts");
    if (it.tipo !== "arquivo") { const e1 = el(`<button class="btn small ghost">Editar</button>`); e1.onclick = () => kbForm(a, it.tipo, it); acts.appendChild(e1); }
    const e2 = el(`<button class="btn small danger ghost">Excluir</button>`); e2.onclick = async () => { if (!confirm("Excluir esse item da base?")) return; try { await api(`/kb/${it.id}`, { method: "DELETE" }); toast("Removido.", "ok"); carregarKb(a); } catch (e) { toast(e.message, "err"); } };
    acts.appendChild(e2);
    box.appendChild(el2);
  });
}
function kbForm(a, tipo, item = null) {
  const ed = Boolean(item);
  const campos = tipo === "qa"
    ? `<label>Pergunta do lead</label><input id="kb-p" value="${esc(item?.pergunta || "")}" placeholder="Quanto custa o curso?" />
       <label>Resposta oficial</label><textarea id="kb-c" placeholder="O curso sai por 12x de R$ 97...">${esc(item?.conteudo || "")}</textarea>`
    : tipo === "bloco"
    ? `<label>Título do bloco</label><input id="kb-t" value="${esc(item?.titulo || "")}" placeholder="Preços e formas de pagamento" />
       <label>Conteúdo</label><textarea id="kb-c" style="min-height:160px" placeholder="Escreva as informações...">${esc(item?.conteudo || "")}</textarea>`
    : `<label>Texto</label><textarea id="kb-c" style="min-height:200px" placeholder="Cole aqui qualquer informação que a IA deve saber...">${esc(item?.conteudo || "")}</textarea>`;
  abrirModal(`<button class="close" data-close>×</button>
    <h3>${ed ? "Editar" : "Novo"} · ${esc(KB_TIPOS[tipo])}</h3>
    <div class="desc">Depois de salvar, o sistema indexa automaticamente pra IA usar.</div>
    ${campos}
    <div class="footer"><button class="btn ghost" id="kb-voltar">Voltar</button><button class="btn primary" id="kb-salvar">${ed ? "Salvar" : "Adicionar"}</button></div>`, true);
  $("#kb-voltar").onclick = () => modalConhecimento(a);
  $("#kb-salvar").onclick = async () => {
    const payload = { tipo, conteudo: $("#kb-c")?.value.trim() || "" };
    if (tipo === "qa") payload.pergunta = $("#kb-p").value.trim();
    if (tipo === "bloco") payload.titulo = $("#kb-t").value.trim();
    if (!payload.conteudo || (tipo === "qa" && !payload.pergunta)) return toast("Preencha os campos.", "err");
    toast("Salvando e indexando…");
    try {
      if (ed) await api(`/kb/${item.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api(`/agentes/${a.id}/kb`, { method: "POST", body: JSON.stringify(payload) });
      toast("Salvo na base.", "ok"); modalConhecimento(a);
    } catch (e) { toast(e.message, "err"); }
  };
}

// ───────── Painel / Dashboard ─────────
async function viewDashboard() {
  const content = $("#content");
  content.innerHTML = `<div style="color:var(--muted)">Carregando…</div>`;
  let d;
  try { d = await api("/dashboard"); }
  catch (e) { content.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  const card = (grad, icone, label, num, sub) => `
    <div class="statcard"><div class="strip" style="background:${grad}"></div>
      <div class="pad"><div class="tile" style="background:${grad}">${icone}</div>
        <div class="lbl">${label}</div><div class="num">${num}</div><div class="subn">${sub}</div></div></div>`;

  const svg = (p) => `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICO = {
    conversas: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    ia: svg('<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8V4M8 3h8M8 13h.01M16 13h.01"/>'),
    humano: svg('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
    lead: svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M18 18l-2.5-2.5M6 18l2.5-2.5M18 6l-2.5 2.5"/>'),
    msg: svg('<path d="M4 4h16v12H5.2L4 17.2z"/><path d="M8 9h8M8 12h5"/>'),
    agente: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  };
  const gBrand = "var(--grad-brand)", gBlue = "var(--grad-blue)", gOrange = "var(--grad-orange)";
  const c = d.conversas, ag = d.agentes;

  const cards = [
    card(gBrand, ICO.conversas, "Conversas", c.total, `${c.iaAtiva} com IA · ${c.humano} com você`),
    card(gBlue, ICO.ia, "IA atendendo agora", c.iaAtiva, `de ${c.total} conversa(s)`),
    card(gOrange, ICO.humano, "Você assumiu", c.humano, "conversas em modo manual"),
    card(gBrand, ICO.lead, "Leads hoje", c.leadsHoje, "novos contatos hoje"),
    card(gBlue, ICO.msg, "Mensagens hoje", c.msgsHoje, "trocadas nas conversas"),
    card(gOrange, ICO.agente, "Agentes", ag.total, `${ag.iaLigada} com IA ligada`),
  ].join("");

  const linhas = d.porAgente.length
    ? d.porAgente.map((a) => `<tr>
        <td><b>${esc(a.nome)}</b> <span class="mono-in" style="color:var(--faint);font-size:11px">${esc(a.instancia)}</span></td>
        <td>${a.conversas} conversa(s)</td>
        <td><span class="pill ${a.iaAtiva ? "admin" : "user"}">${a.iaAtiva ? "IA ligada" : "IA pausada"}</span></td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="color:var(--muted)">Nenhum agente ainda.</td></tr>`;

  content.innerHTML = `
    <div class="dash">${cards}</div>
    <h4 style="margin:28px 0 12px;font-size:15px;font-weight:700">Por agente</h4>
    <table class="tbl"><thead><tr><th>Agente</th><th>Conversas</th><th>Status</th></tr></thead><tbody>${linhas}</tbody></table>`;
}
async function viewConversas() {
  try { S.agentes = await api("/agentes"); } catch {}
  const content = $("#content");
  content.innerHTML = `<div class="convlayout">
    <div class="convlist">
      <div class="filtro"><select id="convFiltro"><option value="">Todos os agentes</option>${S.agentes.map(a=>`<option value="${a.id}" ${S.agenteFiltro===a.id?"selected":""}>${esc(a.nome)}</option>`).join("")}</select></div>
      <div id="convitems"><div style="padding:16px;color:var(--muted)">Carregando…</div></div>
    </div>
    <div class="convview" id="convview"><div class="placeholder">Selecione uma conversa</div></div>
  </div>`;
  $("#content").classList.add("chatmode");
  document.body.classList.add("chatview");
  $("#convFiltro").onchange = (e) => { S.agenteFiltro = e.target.value; carregarConversas(); };
  carregarConversas();
  S.timers.push(setInterval(() => {
    if (S.gravando) return; // não recarrega enquanto grava
    carregarConversas(true);
    if (S.convAtual && !document.querySelector("#emojibar.open")) abrirConversa(S.convAtual, true);
  }, 6000));
}
async function carregarConversas(silencioso) {
  const lista = $("#convitems"); if (!lista) return;
  let convs;
  try { convs = await api("/conversas" + (S.agenteFiltro ? `?agente=${S.agenteFiltro}` : "")); }
  catch (e) { if (!silencioso) lista.innerHTML = `<div style="padding:16px;color:var(--danger)">${esc(e.message)}</div>`; return; }
  if (!convs.length) { lista.innerHTML = `<div style="padding:24px;color:var(--muted);font-size:13px">Nenhuma conversa ainda.</div>`; return; }
  lista.innerHTML = "";
  convs.forEach((c) => {
    const hora = c.atualizadaEm ? new Date(c.atualizadaEm).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "";
    const item = el(`<div class="convitem ${S.convAtual===c.id?"active":""}">
      <div class="av">${esc(iniciais(c.nome||"?"))}</div>
      <div class="body">
        <div class="r1"><span class="nome">${esc(c.nome||"Sem nome")}</span><span class="t">${esc(hora)}</span></div>
        <div class="prev"><span class="badge ${c.iaAtiva?"ia":"humano"}">${c.iaAtiva?"IA":"você"}</span> ${esc(c.ultima||"—")}</div>
      </div></div>`);
    item.onclick = () => { S.convAtual = c.id; document.querySelectorAll(".convitem").forEach(n=>n.classList.remove("active")); item.classList.add("active"); abrirConversa(c.id); };
    lista.appendChild(item);
  });
}
async function abrirConversa(id, silencioso) {
  const view = $("#convview"); if (!view) return;
  let conv;
  try { conv = await api(`/conversas/${id}`); }
  catch (e) { if (!silencioso) view.innerHTML = `<div class="placeholder">${esc(e.message)}</div>`; return; }
  const agente = S.agentes.find(a=>a.id===conv.agenteId);
  // preserva scroll e texto digitado se só atualizando
  const msgsAntigo = view.querySelector(".msgs");
  const perto = msgsAntigo ? (msgsAntigo.scrollHeight - msgsAntigo.scrollTop - msgsAntigo.clientHeight < 80) : true;
  const textoAntigo = view.querySelector("#msgInput")?.value || "";

  view.innerHTML = `
    <div class="vhead">
      <div class="who"><div class="av">${esc(iniciais(conv.nome||"?"))}</div>
        <div><div class="nm">${esc(conv.nome||"Sem nome")}</div><div class="num">${esc(conv.numero)} · ${esc(agente?.nome||"—")}</div></div></div>
      <label class="switch"><input type="checkbox" id="iaToggle" ${conv.iaAtiva?"checked":""} /><span style="font-size:12.5px;color:var(--muted)">IA respondendo</span></label>
    </div>
    <div class="msgs" id="msgs"></div>
    <div class="composer">
      <div class="emojibar" id="emojibar"></div>
      <button class="iconbtn" id="btnEmoji" title="Emoji">😊</button>
      <button class="iconbtn" id="btnAnexo" title="Anexar arquivo">📎</button>
      <button class="iconbtn" id="btnMic" title="Gravar áudio">🎤</button>
      <textarea id="msgInput" placeholder="Escreva pra assumir a conversa…" rows="1"></textarea>
      <button class="btn wa" id="msgSend">Enviar</button>
      <input type="file" id="fileInput" hidden />
    </div>`;

  const msgs = $("#msgs");
  let ultimoDia = "";
  conv.historico.forEach((m) => {
    const dia = m.ts ? new Date(m.ts).toLocaleDateString("pt-BR") : "";
    if (dia && dia !== ultimoDia) { ultimoDia = dia; msgs.appendChild(el(`<div class="daysep">${esc(dia===new Date().toLocaleDateString("pt-BR")?"Hoje":dia)}</div>`)); }
    msgs.appendChild(renderMsg(m));
  });
  if (perto) msgs.scrollTop = msgs.scrollHeight;

  $("#iaToggle").onchange = async (e) => { try { await api(`/conversas/${id}/ia`, { method:"POST", body: JSON.stringify({ ativa: e.target.checked }) }); toast(e.target.checked?"IA reativada.":"IA pausada — você assumiu.","ok"); carregarConversas(true); } catch (err) { toast(err.message,"err"); } };
  const enviar = async () => { const inp = $("#msgInput"); const texto = inp.value.trim(); if (!texto) return; $("#msgSend").disabled = true; try { await api(`/conversas/${id}/mensagem`, { method:"POST", body: JSON.stringify({ texto }) }); inp.value = ""; abrirConversa(id); carregarConversas(true); } catch (e) { toast(e.message,"err"); } finally { $("#msgSend").disabled = false; } };
  $("#msgSend").onclick = enviar;
  $("#msgInput").value = textoAntigo;
  $("#msgInput").onkeydown = (e) => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } };
  montarComposer(id);
}

// ── Emoji / anexo / áudio ──
const EMOJIS = "😀 😁 😂 🤣 😊 😍 😘 😅 😉 🙂 🤔 😎 😢 😭 😡 👍 👎 🙏 👏 🙌 💪 🔥 ✅ ❌ ❤️ 🎉 💰 📞 📎 📷 ⏰ 👀 🤝 😴 🥳 😱 🤷 💯 ✨ 👋".split(" ");
function fileToBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); }); }

function montarComposer(id) {
  // Emoji
  const bar = $("#emojibar");
  bar.innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join("");
  bar.querySelectorAll("button").forEach((b) => b.onclick = () => {
    const inp = $("#msgInput"); const p = inp.selectionStart ?? inp.value.length;
    inp.value = inp.value.slice(0, p) + b.textContent + inp.value.slice(inp.selectionEnd ?? p);
    inp.focus(); bar.classList.remove("open");
  });
  $("#btnEmoji").onclick = (e) => { e.stopPropagation(); bar.classList.toggle("open"); };
  document.addEventListener("click", (e) => { if (!bar.contains(e.target) && e.target.id !== "btnEmoji") bar.classList.remove("open"); }, { once: true });

  // Anexo (imagem / documento)
  const fin = $("#fileInput");
  $("#btnAnexo").onclick = () => fin.click();
  fin.onchange = async () => {
    const file = fin.files[0]; if (!file) return;
    const tipo = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "document";
    toast("Enviando arquivo…");
    try {
      const base64 = await fileToBase64(file);
      await api(`/conversas/${id}/midia`, { method: "POST", body: JSON.stringify({ base64, mimetype: file.type, tipo, fileName: file.name }) });
      fin.value = ""; abrirConversa(id); carregarConversas(true); toast("Enviado.", "ok");
    } catch (e) { toast(e.message, "err"); }
  };

  // Áudio (gravar e enviar)
  $("#btnMic").onclick = () => (S.gravando ? pararGravacao() : iniciarGravacao(id));
}

async function iniciarGravacao(id) {
  if (!navigator.mediaDevices?.getUserMedia) return toast("Seu navegador não permite gravar áudio.", "err");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ? "audio/ogg;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      const label = document.querySelector(".reclabel"); if (label) label.remove();
      $("#btnMic")?.classList.remove("rec");
      if (blob.size < 800) return; // muito curto, ignora
      toast("Enviando áudio…");
      try {
        const base64 = await fileToBase64(new File([blob], "audio", { type: blob.type }));
        await api(`/conversas/${id}/midia`, { method: "POST", body: JSON.stringify({ base64, mimetype: blob.type, tipo: "audio", fileName: "audio" }) });
        abrirConversa(id); carregarConversas(true); toast("Áudio enviado.", "ok");
      } catch (e) { toast(e.message, "err"); }
    };
    S.rec = rec; S.gravando = true;
    rec.start();
    $("#btnMic").classList.add("rec");
    const c = document.querySelector(".composer");
    c.appendChild(el(`<div class="reclabel">● gravando… toque no microfone pra enviar</div>`));
  } catch (e) { toast("Não consegui acessar o microfone.", "err"); }
}
function pararGravacao() {
  S.gravando = false;
  try { S.rec?.stop(); } catch {}
  S.rec = null;
}
function renderMsg(m) {
  const hora = m.ts ? new Date(m.ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"}) : "";
  if (m.role === "system-note") return el(`<div class="msg note">${esc(m.content)}</div>`);
  const cls = m.role === "assistant" ? "assistant" : "user";
  const node = el(`<div class="msg ${cls}"></div>`);
  // mídia
  if (m.mediaTipo === "audio" && m.mediaPath) {
    node.appendChild(el(`<span class="mediatag">🎤 áudio</span>`));
    node.appendChild(el(`<audio controls preload="none" src="${mediaUrl(m.mediaPath)}"></audio>`));
    if (m.transcricao) node.appendChild(el(`<div class="transcricao">“${esc(m.transcricao)}”</div>`));
  } else if ((m.mediaTipo === "imagem" || m.mediaTipo === "sticker") && m.mediaPath) {
    const img = el(`<img class="mediaimg" src="${mediaUrl(m.mediaPath)}" alt="imagem" />`);
    img.onclick = () => { $("#lightboxImg").src = mediaUrl(m.mediaPath); $("#lightbox").classList.add("open"); };
    node.appendChild(img);
    if (m.transcricao) node.appendChild(el(`<div class="transcricao">${esc(m.transcricao)}</div>`));
  } else if ((m.mediaTipo === "documento" || m.mediaTipo === "video") && m.mediaPath) {
    node.appendChild(el(`<a class="filechip" href="${mediaUrl(m.mediaPath)}" target="_blank" download><span class="fi">${m.mediaTipo === "video" ? "🎬" : "📄"}</span><span class="fn">${esc(m.fileName || m.content || "arquivo")}</span></a>`));
    if (m.content && m.content !== `[${m.fileName}]`) node.appendChild(document.createTextNode(m.content));
  } else {
    if (m.mediaTipo && !m.mediaPath) node.appendChild(el(`<span class="mediatag">${esc(m.mediaTipo)}${m.erro?" (falha)":""}</span>`));
    node.appendChild(document.createTextNode(m.content || ""));
  }
  const tick = (m.role === "assistant") ? `<span class="tick">✓✓</span>` : "";
  node.appendChild(el(`<span class="t">${esc(hora)}${m.manual?" ·man":""} ${tick}</span>`));
  return node;
}

// ───────── Usuários (admin) ─────────
async function viewUsuarios() {
  const btn = el(`<button class="btn primary">+ Novo usuário</button>`); btn.onclick = () => modalUsuario();
  $("#topActions").appendChild(btn);
  const content = $("#content");
  content.innerHTML = `<div style="color:var(--muted)">Carregando…</div>`;
  let us; try { us = await api("/usuarios"); } catch (e) { content.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  S._usuarios = Object.fromEntries(us.map(u=>[u.id,u.nome]));
  const linhas = us.map(u=>`<tr>
    <td><div style="display:flex;align-items:center;gap:10px"><div class="avatar" style="width:30px;height:30px;font-size:12px">${esc(iniciais(u.nome))}</div>${esc(u.nome)}</div></td>
    <td class="mono-in">${esc(u.login)}</td>
    <td><span class="pill ${u.role}">${u.role}</span> ${u.senhaDefinida===false?'<span class="pill user" style="color:var(--amber)">aguardando 1º acesso</span>':""}</td>
    <td style="text-align:right"><button class="btn small ghost" data-edit="${u.id}">Editar</button> ${u.id===S.usuario.id?"":`<button class="btn small danger ghost" data-del="${u.id}">Excluir</button>`}</td>
  </tr>`).join("");
  content.innerHTML = `<table class="tbl"><thead><tr><th>Nome</th><th>Login</th><th>Papel</th><th></th></tr></thead><tbody>${linhas}</tbody></table>`;
  content.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>modalUsuario(us.find(u=>u.id===b.dataset.edit)));
  content.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{ if(!confirm("Excluir esse usuário? Os agentes dele continuam, mas sem dono.")) return; try{ await api(`/usuarios/${b.dataset.del}`,{method:"DELETE"}); toast("Usuário excluído.","ok"); viewUsuarios(); }catch(e){ toast(e.message,"err"); } });
}
function modalUsuario(u=null) {
  const ed = Boolean(u);
  abrirModal(`<button class="close" data-close>×</button><h3>${ed?"Editar usuário":"Novo usuário"}</h3>
    <div class="desc">${ed?"Deixe a senha vazia pra manter a atual.":"A pessoa entra com o login e cria a própria senha no primeiro acesso."}</div>
    <label>Nome</label><input id="u-nome" value="${esc(u?.nome||"")}" placeholder="Bruno" />
    ${ed?"":`<label>Login</label><input id="u-login" class="mono-in" placeholder="bruno" />`}
    <label>Senha ${ed?'<span class="hint">(opcional)</span>':'<span class="hint">(opcional — deixe vazio pra pessoa criar no 1º acesso)</span>'}</label><input id="u-senha" type="password" placeholder="${ed?"••••••":"deixe vazio ou defina uma"}" />
    <label>Papel</label><select id="u-role"><option value="user" ${u?.role!=="admin"?"selected":""}>Usuário (só os agentes dele)</option><option value="admin" ${u?.role==="admin"?"selected":""}>Admin (vê tudo + configurações)</option></select>
    <div class="footer"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="u-salvar">${ed?"Salvar":"Criar"}</button></div>`);
  $("#u-salvar").onclick = async () => {
    const p = { nome: $("#u-nome").value.trim(), role: $("#u-role").value };
    const senha = $("#u-senha").value; if (senha) p.senha = senha;
    if (!ed) { p.login = $("#u-login").value.trim(); if (!p.login) return toast("O login é obrigatório.","err"); }
    try { if (ed) await api(`/usuarios/${u.id}`,{method:"PATCH",body:JSON.stringify(p)}); else await api("/usuarios",{method:"POST",body:JSON.stringify(p)}); toast(ed?"Usuário atualizado.":"Usuário criado. Passe o login pra pessoa — ela cria a senha no 1º acesso.","ok"); fecharModal(); viewUsuarios(); }
    catch (e) { toast(e.message,"err"); }
  };
}

// ───────── Config (admin) ─────────
async function viewConfig() {
  const content = $("#content");
  content.innerHTML = `<div style="color:var(--muted)">Carregando…</div>`;
  let s; try { s = await api("/settings"); } catch (e) { content.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  content.innerHTML = `<div style="max-width:620px">
    <div class="card"><h3 style="margin-bottom:4px">Evolution API</h3><div class="prompt" style="-webkit-line-clamp:none">Servidor onde as instâncias de WhatsApp rodam.</div>
      <label>URL do servidor</label><input id="c-evoUrl" class="mono-in" value="${esc(s.evolutionUrl||"")}" placeholder="https://sua-evolution.up.railway.app" />
      <label>API Key ${s.evolutionApiKeyDefinida?'<span class="hint">(definida — vazio mantém)</span>':""}</label><input id="c-evoKey" class="mono-in" type="password" placeholder="${s.evolutionApiKeyDefinida?"••••••••":"apikey"}" /></div>
    <div class="card" style="margin-top:16px"><h3 style="margin-bottom:4px">OpenAI</h3><div class="prompt" style="-webkit-line-clamp:none">Cérebro dos agentes + leitura de imagem.</div>
      <label>API Key ${s.openaiApiKeyDefinida?'<span class="hint">(definida — vazio mantém)</span>':""}</label><input id="c-oaKey" class="mono-in" type="password" placeholder="${s.openaiApiKeyDefinida?"••••••••":"sk-..."}" />
      <label>Modelo padrão</label><input id="c-oaModel" class="mono-in" value="${esc(s.openaiModel||"gpt-4o-mini")}" /></div>
    <div class="card" style="margin-top:16px"><h3 style="margin-bottom:4px">Groq <span class="hint" style="font-size:11px;font-weight:400">(transcrição de áudio — opcional)</span></h3><div class="prompt" style="-webkit-line-clamp:none">Se vazio, o áudio é transcrito pela OpenAI.</div>
      <label>API Key ${s.groqApiKeyDefinida?'<span class="hint">(definida — vazio mantém)</span>':""}</label><input id="c-grKey" class="mono-in" type="password" placeholder="${s.groqApiKeyDefinida?"••••••••":"gsk-..."}" /></div>
    <div class="card" style="margin-top:16px"><h3 style="margin-bottom:4px">Sistema</h3>
      <label>URL pública deste sistema <span class="hint">(pra registrar o webhook)</span></label><input id="c-pub" class="mono-in" value="${esc(s.publicUrl||"")}" placeholder="https://ia-instructiva-production.up.railway.app" /></div>
    <div style="margin-top:20px;display:flex;justify-content:flex-end"><button class="btn primary" id="c-salvar">Salvar configurações</button></div></div>`;
  $("#c-salvar").onclick = async () => {
    const p = { evolutionUrl: $("#c-evoUrl").value.trim(), openaiModel: $("#c-oaModel").value.trim(), publicUrl: $("#c-pub").value.trim() };
    const ek=$("#c-evoKey").value.trim(); if(ek)p.evolutionApiKey=ek;
    const ok=$("#c-oaKey").value.trim(); if(ok)p.openaiApiKey=ok;
    const gk=$("#c-grKey").value.trim(); if(gk)p.groqApiKey=gk;
    try { await api("/settings",{method:"POST",body:JSON.stringify(p)}); toast("Configurações salvas.","ok"); viewConfig(); } catch (e) { toast(e.message,"err"); }
  };
}

// ───────── Modal infra ─────────
function abrirModal(html, wide) { const m = $("#modal"); m.className = "modal" + (wide ? " wide" : ""); m.innerHTML = html; $("#overlay").classList.add("open"); m.querySelectorAll("[data-close]").forEach(b=>b.onclick=fecharModal); const inp = m.querySelector("input,textarea"); if (inp) setTimeout(()=>inp.focus(),50); }
function fecharModal() { $("#overlay").classList.remove("open"); }
$("#overlay").onclick = (e) => { if (e.target.id === "overlay") fecharModal(); };
$("#lightbox").onclick = () => $("#lightbox").classList.remove("open");

// ───────── Boot ─────────
$("#btnLogin").onclick = async () => { $("#gateErr").textContent = ""; try { await entrar($("#login").value.trim(), $("#senha").value); } catch (e) { $("#gateErr").textContent = e.message; } };
$("#senha").onkeydown = (e) => { if (e.key === "Enter") $("#btnLogin").click(); };
$("#login").onkeydown = (e) => { if (e.key === "Enter") $("#senha").focus(); };
$("#btnSair").onclick = logout;
$("#btnTema").onclick = toggleTema;

if (S.token) restaurarSessao();
