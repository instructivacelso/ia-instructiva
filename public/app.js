// ───────────────────────── Estado + helpers ─────────────────────────
const S = {
  senha: sessionStorage.getItem("ia_senha") || "",
  view: "agentes",
  agentes: [],
  convAtual: null,
  agenteFiltro: "",
  timers: [],
};

const $ = (sel) => document.querySelector(sel);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function limparTimers() { S.timers.forEach(clearInterval); S.timers = []; }

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-admin-password": S.senha, ...(opts.headers || {}) },
  });
  const dados = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error("Sessão expirada."); }
  if (!res.ok) throw new Error(dados.erro || `Erro ${res.status}`);
  return dados;
}

let toastT;
function toast(msg, tipo = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show " + tipo;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.className = "toast " + tipo), 3200);
}

// ───────────────────────── Login ─────────────────────────
async function tentarLogin(senha) {
  S.senha = senha;
  const r = await api("/status");
  sessionStorage.setItem("ia_senha", senha);
  $("#gate").style.display = "none";
  $("#app").classList.add("visible");
  atualizarStatusSistema(r.config);
  irPara("agentes");
}

function logout() {
  sessionStorage.removeItem("ia_senha");
  S.senha = "";
  limparTimers();
  $("#app").classList.remove("visible");
  $("#gate").style.display = "grid";
}

function atualizarStatusSistema(cfg) {
  const partes = [];
  partes.push(cfg.evolutionConfigurado ? "evolution ✓" : "evolution ✗");
  partes.push(cfg.openaiConfigurado ? "openai ✓" : "openai ✗");
  $("#sysStatus").textContent = partes.join("  ·  ");
}

// ───────────────────────── Navegação ─────────────────────────
function irPara(view) {
  S.view = view;
  limparTimers();
  document.querySelectorAll(".navbtn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("#overlay").classList.remove("open");
  const titulos = {
    agentes: ["Agentes", "Cada agente controla um número de WhatsApp com sua própria IA."],
    conversas: ["Conversas", "Acompanhe e assuma o controle quando precisar."],
    config: ["Configurações", "Chaves e conexões do sistema."],
  };
  $("#viewTitle").textContent = titulos[view][0];
  $("#viewSub").textContent = titulos[view][1];
  $("#topActions").innerHTML = "";
  if (view === "agentes") viewAgentes();
  if (view === "conversas") viewConversas();
  if (view === "config") viewConfig();
}

// ───────────────────────── View: Agentes ─────────────────────────
async function viewAgentes() {
  const btn = el(`<button class="btn primary">+ Novo agente</button>`);
  btn.onclick = () => modalAgente();
  $("#topActions").appendChild(btn);

  const content = $("#content");
  content.innerHTML = `<div style="color:var(--muted)">Carregando…</div>`;
  try {
    S.agentes = await api("/agentes");
  } catch (e) { content.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  if (!S.agentes.length) {
    content.innerHTML = `<div class="empty"><div class="big">Nenhum agente ainda</div>
      Crie o primeiro agente pra conectar um número e começar a atender.</div>`;
    return;
  }

  const grid = el(`<div class="grid"></div>`);
  S.agentes.forEach((a) => grid.appendChild(cardAgente(a)));
  content.innerHTML = "";
  content.appendChild(grid);

  // Poll de estado de conexão de cada instância.
  const atualizarEstados = async () => {
    for (const a of S.agentes) {
      try {
        const r = await api(`/agentes/${a.id}/estado`);
        pintarEstado(a.id, r.estado || "desconhecido");
      } catch { pintarEstado(a.id, "erro"); }
    }
  };
  atualizarEstados();
  S.timers.push(setInterval(atualizarEstados, 8000));
}

function cardAgente(a) {
  const c = el(`
    <div class="card ${a.ativo ? "" : "inativo"}">
      <div class="head">
        <div>
          <h3>${esc(a.nome)} ${a.ativo ? "" : '<span class="tag-off">inativo</span>'}</h3>
          <div class="inst">instância: ${esc(a.instancia)}</div>
        </div>
        <div class="state" data-state="${a.id}"><span class="led"></span> ···</div>
      </div>
      <div class="prompt">${esc(a.promptSistema)}</div>
      <div class="meta">
        <span><b>modelo</b> ${esc(a.modelo || "padrão")}</span>
        <span><b>abertura</b> ${a.mensagemInicial ? "fixa" : "por IA"}</span>
      </div>
      <div class="actions"></div>
    </div>`);
  const act = c.querySelector(".actions");
  const add = (txt, cls, fn) => { const b = el(`<button class="btn small ${cls}">${txt}</button>`); b.onclick = fn; act.appendChild(b); };
  add("Conectar", "", () => modalConexao(a));
  add("Editar", "ghost", () => modalAgente(a));
  add("Webhook", "ghost", () => modalWebhook(a));
  add("Excluir", "danger ghost", () => excluirAgente(a));
  return c;
}

function pintarEstado(id, estado) {
  const node = document.querySelector(`.state[data-state="${id}"]`);
  if (!node) return;
  const mapa = {
    open: ["open", "conectado"], connecting: ["connecting", "conectando"],
    close: ["close", "desconectado"], erro: ["erro", "sem resposta"],
  };
  const [cls, txt] = mapa[estado] || ["", estado];
  node.className = "state " + cls;
  node.innerHTML = `<span class="led"></span> ${txt}`;
}

async function excluirAgente(a) {
  if (!confirm(`Excluir o agente "${a.nome}"? As conversas ficam no histórico, mas o agente some.`)) return;
  try { await api(`/agentes/${a.id}`, { method: "DELETE" }); toast("Agente excluído.", "ok"); viewAgentes(); }
  catch (e) { toast(e.message, "err"); }
}

// ── Modal criar/editar agente ──
function modalAgente(a = null) {
  const ed = Boolean(a);
  abrirModal(`
    <button class="close" data-close>×</button>
    <h3>${ed ? "Editar agente" : "Novo agente"}</h3>
    <div class="desc">Defina o comportamento da IA e a que número ela responde.</div>

    <label>Nome do agente</label>
    <input id="f-nome" value="${esc(a?.nome || "")}" placeholder="Ex: IA Inversor Solar" />

    ${ed ? "" : `
    <label>Instância <span class="hint">(nome técnico no Evolution — sem espaços)</span></label>
    <input id="f-inst" class="mono-in" placeholder="solar" />`}

    <label>Prompt / treinamento da IA</label>
    <textarea id="f-prompt" placeholder="Você é o atendente da Escola Instructiva especialista em curso de inversores solares...">${esc(a?.promptSistema || "")}</textarea>

    <label>Mensagem de abertura <span class="hint">(deixe vazio pra IA criar sozinha. Use {nome} pra personalizar)</span></label>
    <textarea id="f-abertura" placeholder="Oi {nome}! Vi que você se interessou pelo curso de inversor solar 👋">${esc(a?.mensagemInicial || "")}</textarea>

    <div class="row">
      <div>
        <label>Modelo <span class="hint">(opcional)</span></label>
        <input id="f-modelo" class="mono-in" value="${esc(a?.modelo || "")}" placeholder="gpt-4o-mini" />
      </div>
      <div>
        <label>Status</label>
        <select id="f-ativo">
          <option value="true" ${a?.ativo !== false ? "selected" : ""}>Ativo</option>
          <option value="false" ${a?.ativo === false ? "selected" : ""}>Inativo</option>
        </select>
      </div>
    </div>

    <div class="footer">
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn primary" id="f-salvar">${ed ? "Salvar" : "Criar agente"}</button>
    </div>
  `);

  $("#f-salvar").onclick = async () => {
    const payload = {
      nome: $("#f-nome").value.trim(),
      promptSistema: $("#f-prompt").value.trim(),
      mensagemInicial: $("#f-abertura").value.trim(),
      modelo: $("#f-modelo").value.trim(),
      ativo: $("#f-ativo").value === "true",
    };
    if (!ed) payload.instancia = $("#f-inst").value.trim();
    if (!payload.nome) return toast("Dá um nome pro agente.", "err");
    try {
      if (ed) await api(`/agentes/${a.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      else await api("/agentes", { method: "POST", body: JSON.stringify(payload) });
      toast(ed ? "Agente atualizado." : "Agente criado.", "ok");
      fecharModal(); viewAgentes();
    } catch (e) { toast(e.message, "err"); }
  };
}

// ── Modal conexão (criar instância + QR) ──
function modalConexao(a) {
  abrirModal(`
    <button class="close" data-close>×</button>
    <h3>Conectar ${esc(a.nome)}</h3>
    <div class="desc">Escaneie o QR code com o WhatsApp que vai atender por esse agente.</div>
    <div id="conx"><div style="text-align:center; padding:30px"><span class="spin"></span></div></div>
  `);
  iniciarConexao(a);
}

async function iniciarConexao(a) {
  const box = $("#conx");
  try {
    box.innerHTML = `<div style="text-align:center; padding:24px"><span class="spin"></span><div style="color:var(--muted); margin-top:10px; font-size:12.5px">preparando instância…</div></div>`;
    await api(`/agentes/${a.id}/instancia`, { method: "POST" }); // cria (se preciso) + registra webhook
    await carregarQR(a);
  } catch (e) {
    box.innerHTML = `<div style="color:var(--danger); text-align:center; padding:20px">${esc(e.message)}</div>`;
  }
}

async function carregarQR(a) {
  const box = $("#conx");
  const desenhar = async () => {
    // Se já conectou, mostra sucesso e para.
    try {
      const est = await api(`/agentes/${a.id}/estado`);
      if (est.estado === "open") {
        box.innerHTML = `<div class="qrwrap"><div style="font-size:44px">✅</div>
          <div class="hint" style="color:var(--ok)">Conectado! O agente já está atendendo.</div></div>`;
        pintarEstado(a.id, "open");
        return true;
      }
    } catch {}
    try {
      const r = await api(`/agentes/${a.id}/qr`);
      if (r.base64) {
        const src = r.base64.startsWith("data:") ? r.base64 : `data:image/png;base64,${r.base64}`;
        box.innerHTML = `<div class="qrwrap">
          <img src="${src}" alt="QR code" />
          ${r.pairingCode ? `<div class="code">${esc(r.pairingCode)}</div>` : ""}
          <div class="hint">WhatsApp → Aparelhos conectados → Conectar aparelho</div></div>`;
      } else if (r.pairingCode || r.code) {
        box.innerHTML = `<div class="qrwrap"><div class="code">${esc(r.pairingCode || r.code)}</div>
          <div class="hint">Digite esse código no WhatsApp pra parear.</div></div>`;
      } else {
        box.innerHTML = `<div style="color:var(--muted); text-align:center; padding:20px">Aguardando QR do Evolution…</div>`;
      }
    } catch (e) {
      box.innerHTML = `<div style="color:var(--danger); text-align:center; padding:20px">${esc(e.message)}</div>`;
    }
    return false;
  };

  if (await desenhar()) return;
  // Repete até conectar ou fechar modal (QR expira; recarregamos).
  const t = setInterval(async () => {
    if (!$("#overlay").classList.contains("open")) { clearInterval(t); return; }
    if (await desenhar()) clearInterval(t);
  }, 6000);
  S.timers.push(t);
}

// ── Modal webhook (URLs pra plugar nas landing pages) ──
function modalWebhook(a) {
  const base = location.origin;
  const urlLead = `${base}/webhook/lead/${a.instancia}`;
  const urlEvo = `${base}/webhook/evolution`;
  abrirModal(`
    <button class="close" data-close>×</button>
    <h3>Webhooks · ${esc(a.nome)}</h3>
    <div class="desc">A landing page desse produto deve enviar o lead pra URL abaixo (POST em JSON).</div>

    <label>Receber lead (cole na sua página)</label>
    <div class="readout"><span data-copy="${esc(urlLead)}">${esc(urlLead)}</span>
      <button class="btn small ghost" onclick="copiar('${esc(urlLead)}')">copiar</button></div>

    <label>Exemplo de corpo (JSON)</label>
    <div class="readout" style="color:var(--muted); display:block">${esc('{ "nome": "João", "telefone": "5511998877665", "interesse": "curso solar" }')}</div>

    <label>Webhook do Evolution <span class="hint">(o Evolution manda as mensagens recebidas pra cá)</span></label>
    <div class="readout"><span>${esc(urlEvo)}</span>
      <button class="btn small ghost" onclick="copiar('${esc(urlEvo)}')">copiar</button></div>

    <div id="whStatus" style="margin-top:12px; font-size:12.5px; color:var(--muted); min-height:18px"></div>

    <div class="footer">
      <button class="btn ghost" id="whCheck">Verificar registro</button>
      <button class="btn primary" id="whReg">Registrar webhook agora</button>
    </div>
  `);

  const status = (msg, cor) => { const n = $("#whStatus"); n.textContent = msg; n.style.color = cor || "var(--muted)"; };
  $("#whReg").onclick = async () => {
    status("registrando…");
    try {
      const r = await api(`/agentes/${a.id}/webhook`, { method: "POST" });
      status(`✓ Registrado (formato ${r.formato}). Mande uma mensagem de outro número pra testar.`, "var(--ok)");
    } catch (e) { status("✗ " + e.message, "var(--danger)"); }
  };
  $("#whCheck").onclick = async () => {
    status("consultando o Evolution…");
    try {
      const r = await api(`/agentes/${a.id}/webhook`);
      if (r.erro) return status("✗ " + r.erro, "var(--danger)");
      if (r.confere) status("✓ Webhook certo e registrado.", "var(--ok)");
      else if (r.registrado) status(`⚠ Registrado, mas apontando pra: ${r.registrado}`, "var(--signal)");
      else status("✗ Nenhum webhook registrado nessa instância. Clique em Registrar.", "var(--danger)");
    } catch (e) { status("✗ " + e.message, "var(--danger)"); }
  };
}
window.copiar = (t) => { navigator.clipboard.writeText(t).then(() => toast("Copiado.", "ok")); };

// ───────────────────────── View: Conversas ─────────────────────────
async function viewConversas() {
  try { if (!S.agentes.length) S.agentes = await api("/agentes"); } catch {}
  const content = $("#content");
  content.innerHTML = `
    <div style="margin-bottom:16px">
      <select id="convFiltro" style="max-width:280px">
        <option value="">Todos os agentes</option>
        ${S.agentes.map((a) => `<option value="${a.id}" ${S.agenteFiltro === a.id ? "selected" : ""}>${esc(a.nome)}</option>`).join("")}
      </select>
    </div>
    <div class="convlayout">
      <div class="convlist" id="convlist"><div style="padding:16px; color:var(--muted)">Carregando…</div></div>
      <div class="convview" id="convview"><div class="placeholder">Selecione uma conversa</div></div>
    </div>`;
  $("#convFiltro").onchange = (e) => { S.agenteFiltro = e.target.value; carregarConversas(); };
  carregarConversas();
  S.timers.push(setInterval(() => { carregarConversas(true); if (S.convAtual) abrirConversa(S.convAtual, true); }, 7000));
}

async function carregarConversas(silencioso = false) {
  const lista = $("#convlist");
  if (!lista) return;
  let convs;
  try { convs = await api("/conversas" + (S.agenteFiltro ? `?agente=${S.agenteFiltro}` : "")); }
  catch (e) { if (!silencioso) lista.innerHTML = `<div style="padding:16px; color:var(--danger)">${esc(e.message)}</div>`; return; }

  if (!convs.length) { lista.innerHTML = `<div style="padding:24px; color:var(--muted); font-size:13px">Nenhuma conversa ainda.</div>`; return; }
  lista.innerHTML = "";
  convs.forEach((c) => {
    const item = el(`
      <div class="convitem ${S.convAtual === c.id ? "active" : ""}">
        <div class="r1">
          <span class="nome">${esc(c.nome || "Sem nome")}</span>
          <span class="badge ${c.iaAtiva ? "ia" : "humano"}">${c.iaAtiva ? "IA" : "HUMANO"}</span>
        </div>
        <div class="num">${esc(c.numero)}</div>
        <div class="prev">${esc(c.ultima || "—")}</div>
      </div>`);
    item.onclick = () => { S.convAtual = c.id; document.querySelectorAll(".convitem").forEach((n) => n.classList.remove("active")); item.classList.add("active"); abrirConversa(c.id); };
    lista.appendChild(item);
  });
}

async function abrirConversa(id, silencioso = false) {
  const view = $("#convview");
  if (!view) return;
  let conv;
  try { conv = await api(`/conversas/${id}`); }
  catch (e) { if (!silencioso) view.innerHTML = `<div class="placeholder">${esc(e.message)}</div>`; return; }
  const agente = S.agentes.find((a) => a.id === conv.agenteId);

  view.innerHTML = `
    <div class="vhead">
      <div>
        <div style="font-weight:600">${esc(conv.nome || "Sem nome")}</div>
        <div class="num">${esc(conv.numero)} · ${esc(agente?.nome || "agente removido")}</div>
      </div>
      <label class="switch" style="margin:0">
        <input type="checkbox" id="iaToggle" ${conv.iaAtiva ? "checked" : ""} />
        <span style="font-size:12.5px; color:var(--muted)">IA respondendo</span>
      </label>
    </div>
    <div class="msgs" id="msgs"></div>
    <div class="composer">
      <textarea id="msgInput" placeholder="Escreva pra assumir a conversa…" rows="1"></textarea>
      <button class="btn primary" id="msgSend">Enviar</button>
    </div>`;

  const msgs = $("#msgs");
  conv.historico.forEach((m) => {
    if (m.role === "system-note") { msgs.appendChild(el(`<div class="msg note">${esc(m.content)}</div>`)); return; }
    const cls = m.role === "assistant" ? "assistant" : "user";
    const hora = m.ts ? new Date(m.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    msgs.appendChild(el(`<div class="msg ${cls}">${esc(m.content)}<div class="t">${esc(hora)}${m.manual ? " · manual" : ""}</div></div>`));
  });
  msgs.scrollTop = msgs.scrollHeight;

  $("#iaToggle").onchange = async (e) => {
    try { await api(`/conversas/${id}/ia`, { method: "POST", body: JSON.stringify({ ativa: e.target.checked }) }); toast(e.target.checked ? "IA reativada." : "IA pausada — você assumiu.", "ok"); carregarConversas(true); }
    catch (err) { toast(err.message, "err"); }
  };
  const enviar = async () => {
    const inp = $("#msgInput"); const texto = inp.value.trim();
    if (!texto) return;
    $("#msgSend").disabled = true;
    try { await api(`/conversas/${id}/mensagem`, { method: "POST", body: JSON.stringify({ texto }) }); inp.value = ""; abrirConversa(id); carregarConversas(true); }
    catch (e) { toast(e.message, "err"); }
    finally { $("#msgSend").disabled = false; }
  };
  $("#msgSend").onclick = enviar;
  $("#msgInput").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } };
}

// ───────────────────────── View: Config ─────────────────────────
async function viewConfig() {
  const content = $("#content");
  content.innerHTML = `<div style="color:var(--muted)">Carregando…</div>`;
  let s;
  try { s = await api("/settings"); } catch (e) { content.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }

  content.innerHTML = `
    <div style="max-width:620px">
      <div class="card">
        <h3 style="margin-bottom:4px">Evolution API</h3>
        <div class="prompt" style="-webkit-line-clamp:none">Servidor onde suas instâncias de WhatsApp rodam.</div>
        <label>URL do servidor</label>
        <input id="c-evoUrl" class="mono-in" value="${esc(s.evolutionUrl || "")}" placeholder="https://sua-evolution.up.railway.app" />
        <label>API Key ${s.evolutionApiKeyDefinida ? '<span class="hint">(definida — deixe vazio pra manter)</span>' : ""}</label>
        <input id="c-evoKey" class="mono-in" type="password" placeholder="${s.evolutionApiKeyDefinida ? "••••••••" : "cole a apikey"}" />
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin-bottom:4px">OpenAI</h3>
        <div class="prompt" style="-webkit-line-clamp:none">Cérebro dos agentes.</div>
        <label>API Key ${s.openaiApiKeyDefinida ? '<span class="hint">(definida — deixe vazio pra manter)</span>' : ""}</label>
        <input id="c-oaKey" class="mono-in" type="password" placeholder="${s.openaiApiKeyDefinida ? "••••••••" : "sk-..."}" />
        <label>Modelo padrão</label>
        <input id="c-oaModel" class="mono-in" value="${esc(s.openaiModel || "gpt-4o-mini")}" />
      </div>

      <div class="card" style="margin-top:16px">
        <h3 style="margin-bottom:4px">Sistema</h3>
        <label>URL pública deste sistema <span class="hint">(pra registrar o webhook no Evolution)</span></label>
        <input id="c-pub" class="mono-in" value="${esc(s.publicUrl || "")}" placeholder="https://ia-instructiva-production.up.railway.app" />
      </div>

      <div style="margin-top:20px; display:flex; justify-content:flex-end">
        <button class="btn primary" id="c-salvar">Salvar configurações</button>
      </div>
    </div>`;

  $("#c-salvar").onclick = async () => {
    const payload = {
      evolutionUrl: $("#c-evoUrl").value.trim(),
      openaiModel: $("#c-oaModel").value.trim(),
      publicUrl: $("#c-pub").value.trim(),
    };
    const ek = $("#c-evoKey").value.trim(); if (ek) payload.evolutionApiKey = ek;
    const ok = $("#c-oaKey").value.trim(); if (ok) payload.openaiApiKey = ok;
    try {
      await api("/settings", { method: "POST", body: JSON.stringify(payload) });
      toast("Configurações salvas.", "ok");
      const st = await api("/status"); atualizarStatusSistema(st.config);
      viewConfig();
    } catch (e) { toast(e.message, "err"); }
  };
}

// ───────────────────────── Modal infra ─────────────────────────
function abrirModal(html) {
  const m = $("#modal");
  m.className = "modal" + (html.includes("data-wide") ? " wide" : "");
  m.innerHTML = html;
  $("#overlay").classList.add("open");
  m.querySelectorAll("[data-close]").forEach((b) => (b.onclick = fecharModal));
  const inp = m.querySelector("input, textarea"); if (inp) setTimeout(() => inp.focus(), 50);
}
function fecharModal() { $("#overlay").classList.remove("open"); }
$("#overlay").onclick = (e) => { if (e.target.id === "overlay") fecharModal(); };

// ───────────────────────── Boot ─────────────────────────
$("#btnLogin").onclick = async () => {
  const senha = $("#senha").value;
  $("#gateErr").textContent = "";
  try { await tentarLogin(senha); }
  catch (e) { $("#gateErr").textContent = e.message.includes("incorreta") || e.message.includes("401") ? "Senha incorreta." : e.message; }
};
$("#senha").onkeydown = (e) => { if (e.key === "Enter") $("#btnLogin").click(); };
$("#btnSair").onclick = logout;
document.querySelectorAll(".navbtn[data-view]").forEach((b) => (b.onclick = () => irPara(b.dataset.view)));

// Auto-login se já tem senha na sessão.
if (S.senha) tentarLogin(S.senha).catch(() => logout());
