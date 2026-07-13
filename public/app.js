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
  S.token = d.token; S.usuario = d.usuario;
  sessionStorage.setItem("ia_token", d.token);
  iniciarApp();
}
async function restaurarSessao() {
  try { const me = await api("/me"); S.usuario = me.usuario; iniciarApp(me); }
  catch { logout(); }
}
function logout() {
  sessionStorage.removeItem("ia_token"); S.token = ""; S.usuario = null; limparTimers();
  $("#app").classList.remove("visible"); $("#gate").style.display = "grid";
}
function iniciarApp(me) {
  $("#gate").style.display = "none"; $("#app").classList.add("visible");
  $("#uAvatar").textContent = iniciais(S.usuario.nome);
  $("#uNome").textContent = S.usuario.nome;
  $("#uRole").textContent = S.usuario.role === "admin" ? "administrador" : "usuário";
  $("#greeting").textContent = "Olá, " + String(S.usuario.nome || "").split(/\s+/)[0];
  montarNav();
  irPara("agentes");
}

function montarNav() {
  const admin = S.usuario.role === "admin";
  const itens = [
    { v: "agentes", ico: "◆", txt: "Agentes" },
    { v: "conversas", ico: "▤", txt: "Conversas" },
    ...(admin ? [{ v: "usuarios", ico: "◕", txt: "Usuários" }, { v: "config", ico: "⚙", txt: "Configurações" }] : []),
  ];
  const nav = $("#nav"); nav.innerHTML = "";
  itens.forEach((it) => {
    const b = el(`<button class="navbtn" data-view="${it.v}"><span class="ico">${it.ico}</span> ${it.txt}</button>`);
    b.onclick = () => irPara(it.v);
    nav.appendChild(b);
  });
}

function irPara(view) {
  S.view = view; limparTimers();
  document.querySelectorAll(".navbtn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#overlay").classList.remove("open");
  const T = {
    agentes: ["Agentes", "Cada agente é um número de WhatsApp com sua própria IA."],
    conversas: ["Conversas", "Acompanhe e assuma quando precisar."],
    usuarios: ["Usuários", "Quem tem acesso à central."],
    config: ["Configurações", "Chaves e conexões do sistema."],
  };
  $("#viewTitle").textContent = T[view][0];
  $("#viewSub").textContent = T[view][1];
  $("#topActions").innerHTML = "";
  ({ agentes: viewAgentes, conversas: viewConversas, usuarios: viewUsuarios, config: viewConfig }[view])();
}

// ───────── Agentes ─────────
async function viewAgentes() {
  const btn = el(`<button class="btn primary">+ Novo agente</button>`);
  btn.onclick = () => modalAgente();
  $("#topActions").appendChild(btn);
  const content = $("#content");
  content.innerHTML = `<div style="color:var(--muted)">Carregando…</div>`;
  try { S.agentes = await api("/agentes"); }
  catch (e) { content.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
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
  const c = el(`<div class="card ${a.ativo ? "" : "inativo"}">
    <div class="strip"></div>
    <div class="pad">
      <div class="head">
        <div class="headleft">
          <div class="tile">${esc(iniciais(a.nome))}</div>
          <div style="min-width:0">
            <h3>${esc(a.nome)} ${a.ativo ? "" : '<span class="tag-off">inativo</span>'}</h3>
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
  add("Editar", "ghost", () => modalAgente(a));
  add("Webhook", "ghost", () => modalWebhook(a));
  add("Excluir", "danger ghost", () => excluirAgente(a));
  return c;
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

// ───────── Conversas (chat WhatsApp) ─────────
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
  $("#convFiltro").onchange = (e) => { S.agenteFiltro = e.target.value; carregarConversas(); };
  carregarConversas();
  S.timers.push(setInterval(() => { carregarConversas(true); if (S.convAtual) abrirConversa(S.convAtual, true); }, 6000));
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
  // preserva scroll se só atualizando
  const msgsAntigo = view.querySelector(".msgs");
  const perto = msgsAntigo ? (msgsAntigo.scrollHeight - msgsAntigo.scrollTop - msgsAntigo.clientHeight < 80) : true;

  view.innerHTML = `
    <div class="vhead">
      <div class="who"><div class="av">${esc(iniciais(conv.nome||"?"))}</div>
        <div><div class="nm">${esc(conv.nome||"Sem nome")}</div><div class="num">${esc(conv.numero)} · ${esc(agente?.nome||"—")}</div></div></div>
      <label class="switch"><input type="checkbox" id="iaToggle" ${conv.iaAtiva?"checked":""} /><span style="font-size:12.5px;color:var(--muted)">IA respondendo</span></label>
    </div>
    <div class="msgs" id="msgs"></div>
    <div class="composer"><textarea id="msgInput" placeholder="Escreva pra assumir a conversa…" rows="1"></textarea><button class="btn wa" id="msgSend">Enviar</button></div>`;

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
  $("#msgInput").onkeydown = (e) => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } };
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
    <td><span class="pill ${u.role}">${u.role}</span></td>
    <td style="text-align:right"><button class="btn small ghost" data-edit="${u.id}">Editar</button> ${u.id===S.usuario.id?"":`<button class="btn small danger ghost" data-del="${u.id}">Excluir</button>`}</td>
  </tr>`).join("");
  content.innerHTML = `<table class="tbl"><thead><tr><th>Nome</th><th>Login</th><th>Papel</th><th></th></tr></thead><tbody>${linhas}</tbody></table>`;
  content.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>modalUsuario(us.find(u=>u.id===b.dataset.edit)));
  content.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{ if(!confirm("Excluir esse usuário? Os agentes dele continuam, mas sem dono.")) return; try{ await api(`/usuarios/${b.dataset.del}`,{method:"DELETE"}); toast("Usuário excluído.","ok"); viewUsuarios(); }catch(e){ toast(e.message,"err"); } });
}
function modalUsuario(u=null) {
  const ed = Boolean(u);
  abrirModal(`<button class="close" data-close>×</button><h3>${ed?"Editar usuário":"Novo usuário"}</h3>
    <div class="desc">${ed?"Deixe a senha vazia pra manter a atual.":"A pessoa entra com esse login e senha."}</div>
    <label>Nome</label><input id="u-nome" value="${esc(u?.nome||"")}" placeholder="Bruno" />
    ${ed?"":`<label>Login</label><input id="u-login" class="mono-in" placeholder="bruno" />`}
    <label>Senha ${ed?'<span class="hint">(opcional)</span>':""}</label><input id="u-senha" type="password" placeholder="${ed?"••••••":"defina uma senha"}" />
    <label>Papel</label><select id="u-role"><option value="user" ${u?.role!=="admin"?"selected":""}>Usuário (só os agentes dele)</option><option value="admin" ${u?.role==="admin"?"selected":""}>Admin (vê tudo + configurações)</option></select>
    <div class="footer"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="u-salvar">${ed?"Salvar":"Criar"}</button></div>`);
  $("#u-salvar").onclick = async () => {
    const p = { nome: $("#u-nome").value.trim(), role: $("#u-role").value };
    const senha = $("#u-senha").value; if (senha) p.senha = senha;
    if (!ed) { p.login = $("#u-login").value.trim(); if (!p.login || !senha) return toast("Login e senha são obrigatórios.","err"); }
    try { if (ed) await api(`/usuarios/${u.id}`,{method:"PATCH",body:JSON.stringify(p)}); else await api("/usuarios",{method:"POST",body:JSON.stringify(p)}); toast(ed?"Usuário atualizado.":"Usuário criado.","ok"); fecharModal(); viewUsuarios(); }
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
function abrirModal(html) { const m = $("#modal"); m.innerHTML = html; $("#overlay").classList.add("open"); m.querySelectorAll("[data-close]").forEach(b=>b.onclick=fecharModal); const inp = m.querySelector("input,textarea"); if (inp) setTimeout(()=>inp.focus(),50); }
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
