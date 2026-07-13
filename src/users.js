// Usuários + autenticação. Cada usuário tem os próprios agentes/conversas.
// Senha com scrypt (salt + hash). Sessão via token HMAC stateless
// (sobrevive a redeploy enquanto o segredo for estável).
import crypto from "crypto";
import { db } from "./db.js";

function segredo() {
  // Estável entre deploys se SESSION_SECRET ou ADMIN_PASSWORD não mudarem.
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "ia-instructiva-secret";
}

function hashSenha(senha, salt = crypto.randomBytes(16).toString("hex")) {
  const h = crypto.scryptSync(String(senha), salt, 64).toString("hex");
  return `${salt}:${h}`;
}

function conferirSenha(senha, guardado) {
  if (!guardado || !guardado.includes(":")) return false;
  const [salt, h] = guardado.split(":");
  const teste = crypto.scryptSync(String(senha), salt, 64).toString("hex");
  const a = Buffer.from(h, "hex");
  const b = Buffer.from(teste, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

export function gerarToken(usuarioId, dias = 30) {
  const payload = b64u(JSON.stringify({ uid: usuarioId, exp: Date.now() + dias * 864e5 }));
  const sig = crypto.createHmac("sha256", segredo()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function validarToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const esperado = crypto.createHmac("sha256", segredo()).update(payload).digest("base64url");
  const a = Buffer.from(sig); const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > exp) return null;
    return acharUsuario(uid);
  } catch { return null; }
}

export function listarUsuarios() {
  return db.getUsuarios().map(publico);
}
export function acharUsuario(id) {
  return db.getUsuarios().find((u) => u.id === id) || null;
}
export function acharPorLogin(login) {
  const l = String(login || "").trim().toLowerCase();
  return db.getUsuarios().find((u) => u.login === l) || null;
}

export function autenticar(login, senha) {
  const u = acharPorLogin(login);
  if (!u) return null;
  // Primeiro acesso: se a senha ainda não foi definida, a que a pessoa digitar
  // agora vira a senha dela (ela cria no primeiro login).
  if (u.senhaDefinida === false) {
    if (!senha) return null;
    const usuarios = db.getUsuarios();
    const i = usuarios.findIndex((x) => x.id === u.id);
    usuarios[i].senha = hashSenha(senha);
    usuarios[i].senhaDefinida = true;
    db.saveUsuarios(usuarios);
    return usuarios[i];
  }
  if (!conferirSenha(senha, u.senha)) return null;
  return u;
}

export function criarUsuario({ nome, login, senha, role = "user" }) {
  const usuarios = db.getUsuarios();
  const l = String(login || "").trim().toLowerCase();
  if (!l) throw new Error("O login é obrigatório.");
  if (usuarios.some((u) => u.login === l)) throw new Error(`Já existe o login "${l}".`);
  const temSenha = Boolean(senha);
  const novo = {
    id: crypto.randomUUID(),
    nome: nome || login,
    login: l,
    senha: temSenha ? hashSenha(senha) : "",
    senhaDefinida: temSenha, // false = pessoa cria a senha no primeiro acesso
    role: role === "admin" ? "admin" : "user",
    criadoEm: new Date().toISOString(),
  };
  usuarios.push(novo);
  db.saveUsuarios(usuarios);
  return publico(novo);
}

export function atualizarUsuario(id, { nome, senha, role }) {
  const usuarios = db.getUsuarios();
  const i = usuarios.findIndex((u) => u.id === id);
  if (i === -1) throw new Error("Usuário não encontrado.");
  if (nome !== undefined) usuarios[i].nome = nome;
  if (role !== undefined) usuarios[i].role = role === "admin" ? "admin" : "user";
  if (senha) { usuarios[i].senha = hashSenha(senha); usuarios[i].senhaDefinida = true; }
  db.saveUsuarios(usuarios);
  return publico(usuarios[i]);
}

export function removerUsuario(id) {
  db.saveUsuarios(db.getUsuarios().filter((u) => u.id !== id));
}

// Cria o admin inicial a partir do ADMIN_PASSWORD, se não houver ninguém.
export function garantirAdmin() {
  const usuarios = db.getUsuarios();
  if (usuarios.length) return;
  const senha = process.env.ADMIN_PASSWORD || "admin";
  criarUsuario({ nome: "Administrador", login: "admin", senha, role: "admin" });
  console.log('[boot] usuário admin criado (login "admin", senha = ADMIN_PASSWORD).');
}

function publico(u) {
  return { id: u.id, nome: u.nome, login: u.login, role: u.role, senhaDefinida: u.senhaDefinida !== false, criadoEm: u.criadoEm };
}
