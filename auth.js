// Comptes utilisateurs : inscription, connexion, sessions par cookie signé, mot de passe oublié.
// Un compte = une entreprise (sa propre base dans data/tenants/<id>.json).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR, createTenant, uid } from "./db.js";

const FILE = path.join(DATA_DIR, "accounts.json");
let accounts = null;

function all() {
  if (!accounts) accounts = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : [];
  return accounts;
}
function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(all(), null, 2));
  fs.renameSync(FILE + ".tmp", FILE);
}

// Clé de signature des cookies : SESSION_SECRET, sinon générée une fois et gardée dans data/
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, ".session-secret");
  if (!fs.existsSync(f)) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"), { mode: 0o600 }); }
  return fs.readFileSync(f, "utf8").trim();
}

const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString("hex");
const normEmail = (e) => String(e || "").trim().toLowerCase();
const sign = (s) => crypto.createHmac("sha256", secret()).update(s).digest("base64url");

export const accountCount = () => all().length;
export const findAccount = (id) => all().find((a) => a.id === id);

export function signup({ email, password, name, owner, sector, phone, demo, code }) {
  email = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Adresse e-mail invalide" };
  if (String(password || "").length < 8) return { error: "Le mot de passe doit faire au moins 8 caractères" };
  if (!String(name || "").trim()) return { error: "Indiquez le nom de votre entreprise" };
  if (all().some((a) => a.email === email)) return { error: "Un compte existe déjà avec cet e-mail" };
  if (process.env.SIGNUP_CODE && code !== process.env.SIGNUP_CODE) return { error: "Code d'invitation incorrect" };
  const tenantId = uid("ent");
  createTenant(tenantId, { sector: sector || "btp", demo: demo || null, business: { name: String(name).trim(), owner: String(owner || "").trim(), email, phone: String(phone || ""), ownerPhone: String(phone || "") } });
  const salt = crypto.randomBytes(16).toString("hex");
  const acc = { id: uid("acc"), email, salt, hash: hashPw(password, salt), tenantId, createdAt: new Date().toISOString() };
  all().push(acc);
  persist();
  return { ok: true, account: acc };
}

export function login({ email, password }) {
  const acc = all().find((a) => a.email === normEmail(email));
  if (!acc) { hashPw(password, "x".repeat(32)); return { error: "E-mail ou mot de passe incorrect" }; }
  const ok = crypto.timingSafeEqual(Buffer.from(hashPw(password, acc.salt), "hex"), Buffer.from(acc.hash, "hex"));
  return ok ? { ok: true, account: acc } : { error: "E-mail ou mot de passe incorrect" };
}

export function changePassword(accountId, { current, password }) {
  const acc = findAccount(accountId);
  if (!acc) return { error: "Compte introuvable" };
  if (!login({ email: acc.email, password: current }).ok) return { error: "Mot de passe actuel incorrect" };
  if (String(password || "").length < 8) return { error: "Le nouveau mot de passe doit faire au moins 8 caractères" };
  acc.salt = crypto.randomBytes(16).toString("hex");
  acc.hash = hashPw(password, acc.salt);
  acc.sessionVersion = (acc.sessionVersion || 0) + 1; // déconnecte les autres appareils
  persist();
  return { ok: true };
}

// ---------- Mot de passe oublié : lien valable 1 heure ----------
export function resetToken(email) {
  const acc = all().find((a) => a.email === normEmail(email));
  if (!acc) return null;
  const exp = Date.now() + 3600e3;
  const payload = `${acc.id}.${exp}.${acc.hash.slice(0, 12)}`;
  return { account: acc, token: Buffer.from(payload).toString("base64url") + "." + sign("reset." + payload) };
}
export function resetPassword(token, password) {
  const [b64, sig] = String(token || "").split(".");
  const payload = Buffer.from(b64 || "", "base64url").toString();
  if (!sig || sign("reset." + payload) !== sig) return { error: "Lien invalide" };
  const [id, exp, h] = payload.split(".");
  const acc = findAccount(id);
  if (!acc || Date.now() > Number(exp) || acc.hash.slice(0, 12) !== h) return { error: "Lien expiré ou déjà utilisé" };
  if (String(password || "").length < 8) return { error: "Le mot de passe doit faire au moins 8 caractères" };
  acc.salt = crypto.randomBytes(16).toString("hex");
  acc.hash = hashPw(password, acc.salt);
  acc.sessionVersion = (acc.sessionVersion || 0) + 1;
  persist();
  return { ok: true, account: acc };
}

// ---------- Sessions ----------
const COOKIE = "prava_session";
export function sessionCookie(acc, secure) {
  const exp = Date.now() + 30 * 864e5;
  const payload = `${acc.id}.${exp}.${acc.sessionVersion || 0}`;
  const v = Buffer.from(payload).toString("base64url") + "." + sign(payload);
  return `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? "; Secure" : ""}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function sessionFrom(req) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [b64, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!b64 || !sig) return null;
  const payload = Buffer.from(b64, "base64url").toString();
  const expected = sign(payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  const [id, exp, ver] = payload.split(".");
  const acc = findAccount(id);
  if (!acc || Date.now() > Number(exp) || String(acc.sessionVersion || 0) !== ver) return null;
  return acc;
}

// Limite simple des tentatives de connexion (10 par quart d'heure et par IP)
const tries = new Map();
export function rateLimited(ip) {
  const now = Date.now();
  const t = (tries.get(ip) || []).filter((x) => now - x < 15 * 60e3);
  t.push(now);
  tries.set(ip, t);
  return t.length > 10;
}
