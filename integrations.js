// Branchements externes : Stripe (paiement), Yousign (signature électronique), ElevenLabs (voix naturelle),
// Vapi (téléphonie vocale temps réel). Chaque brique fonctionne en mode démo tant que sa clé n'est pas dans .env.
import crypto from "node:crypto";
import { load, save, findClient, quoteTotals, uid } from "./db.js";
import { currentTenantId } from "./db.js";
import { sendMessage, signQuote, logCall } from "./ops.js";
import { payInvoice, invoiceView, STAGES } from "./billing.js";
import { chat } from "./agent.js";
import { mailEnabled } from "./mailer.js";

const BASE_URL = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

export function integrationsStatus() {
  return {
    telephone: { connected: Boolean(process.env.TWILIO_ACCOUNT_SID), label: "Numéro de téléphone (Twilio)", env: "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM", number: process.env.TWILIO_FROM || "" },
    vapi: { connected: Boolean(process.env.VAPI_SECRET), label: "Voix temps réel (Vapi)", env: "VAPI_SECRET", url: `${BASE_URL()}/vapi/chat/completions?b=${currentTenantId()}`, voiceUrl: `${BASE_URL()}/twilio/voice?b=${currentTenantId()}` },
    voix: { connected: Boolean(process.env.ELEVENLABS_API_KEY), label: "Voix naturelle (ElevenLabs)", env: "ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID" },
    signature: { connected: Boolean(process.env.YOUSIGN_API_KEY), label: "Signature électronique (Yousign)", env: "YOUSIGN_API_KEY, YOUSIGN_ENV" },
    paiement: { connected: Boolean(process.env.STRIPE_SECRET_KEY), label: "Paiement par carte (Stripe)", env: "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET" },
    efacture: { connected: Boolean(process.env.PA_API_URL), label: "Facture électronique (plateforme agréée)", env: "PA_API_URL, PA_API_KEY, PA_NAME" },
  };
}

// ---------- Signature du devis : code SMS + signature manuscrite + dossier de preuve ----------
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function quoteFingerprint(q) {
  return hash(JSON.stringify({ number: q.number, title: q.title, lines: q.lines, tva: q.tva, totals: quoteTotals(q) }));
}

export function sendSignatureCode(quoteId) {
  const db = load();
  const q = db.quotes.find((x) => x.id === quoteId);
  if (!q) return { error: "Devis introuvable" };
  const c = findClient(q.clientId);
  const code = String(crypto.randomInt(100000, 1000000));
  q.otp = { hash: hash(code + q.id), expires: Date.now() + 10 * 60e3, tries: 0 };
  save();
  const sms = Boolean(c?.phone && process.env.TWILIO_ACCOUNT_SID);
  const viaEmail = !sms && c?.email && mailEnabled();
  const demo = Boolean(db.business.demoProfile);
  if (!sms && !viaEmail && !demo) return { error: `La signature en ligne n'est pas encore disponible (envoi du code impossible). Contactez ${db.business.name}${db.business.phone ? " au " + db.business.phone : ""}.` };
  sendMessage({ clientId: q.clientId, channel: sms || (!viaEmail && c?.phone) ? "sms" : "email", kind: "code de signature", text: `${db.business.name} : votre code pour signer le devis ${q.number} est ${code}. Il est valable 10 minutes. Ne le communiquez à personne.` });
  const masked = sms ? c.phone.replace(/\d(?=(?:\D*\d){2})/g, "•") : viaEmail ? c.email.replace(/^(.).*?@/, "$1•••@") : c?.phone || c?.email || "";
  // Compte de démonstration sans SMS ni e-mail : le code est affiché à l'écran
  return { ok: true, to: masked, channel: sms ? "sms" : "email", demoCode: !sms && !viaEmail && demo ? code : undefined };
}

export function signWithCode(quoteId, { name, code, signature, vatCertified }, req) {
  const db = load();
  const q = db.quotes.find((x) => x.id === quoteId);
  if (!q) return { error: "Devis introuvable" };
  if (q.status === "signé") return { ok: true, quote: q };
  if (!q.otp || Date.now() > q.otp.expires) return { error: "Code expiré : demandez un nouveau code." };
  if (q.otp.tries >= 5) return { error: "Trop d'essais : demandez un nouveau code." };
  if (hash(String(code).trim() + q.id) !== q.otp.hash) { q.otp.tries++; save(); return { error: "Code incorrect." }; }
  if (!/^data:image\/png;base64,/.test(signature || "") || signature.length > 400e3) return { error: "Merci de signer dans le cadre." };
  q.signature = {
    image: signature, method: "Signature électronique simple (code SMS + signature manuscrite)",
    otpVerified: true, ip: (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim(), userAgent: String(req.headers["user-agent"] || "").slice(0, 200),
    fingerprint: quoteFingerprint(q), at: new Date().toISOString(), vatCertified: Boolean(vatCertified),
  };
  delete q.otp;
  save();
  return signQuote(q.id, String(name || "").slice(0, 100));
}

// ---------- Yousign (signature à valeur probante renforcée) ----------
const ysBase = () => (process.env.YOUSIGN_ENV === "production" ? "https://api.yousign.app/v3" : "https://api-sandbox.yousign.app/v3");
async function ys(path, opts = {}) {
  const r = await fetch(ysBase() + path, { ...opts, headers: { Authorization: `Bearer ${process.env.YOUSIGN_API_KEY}`, ...(opts.json ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) }, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Yousign ${r.status} : ${j.detail || j.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

export async function yousignStart(quoteId, pdfBuffer) {
  const db = load();
  const q = db.quotes.find((x) => x.id === quoteId);
  const c = findClient(q?.clientId);
  if (!q) return { error: "Devis introuvable" };
  if (q.yousign?.link) return { ok: true, url: q.yousign.link };
  const sr = await ys("/signature_requests", { method: "POST", json: { name: `${db.business.name} · Devis ${q.number}`, delivery_mode: "none", timezone: "Europe/Paris", external_id: q.id } });
  const fd = new FormData();
  fd.append("file", new Blob([pdfBuffer], { type: "application/pdf" }), `${q.number}.pdf`);
  fd.append("nature", "signable_document");
  const doc = await ys(`/signature_requests/${sr.id}/documents`, { method: "POST", body: fd });
  const [first, ...rest] = String(c?.name || "Client").split(" ");
  await ys(`/signature_requests/${sr.id}/signers`, { method: "POST", json: {
    info: { first_name: first, last_name: rest.join(" ") || first, email: c?.email || db.business.email, phone_number: e164(c?.phone), locale: "fr" },
    signature_level: "electronic_signature", signature_authentication_mode: c?.phone ? "otp_sms" : "otp_email",
    redirect_urls: { success: `${BASE_URL()}/q/${q.id}?signed=1`, error: `${BASE_URL()}/q/${q.id}` },
    fields: [{ document_id: doc.id, type: "signature", page: 1, x: 330, y: 700, width: 200, height: 60 }],
  } });
  const act = await ys(`/signature_requests/${sr.id}/activate`, { method: "POST" });
  q.yousign = { id: sr.id, link: act.signers?.[0]?.signature_link, status: "en attente" };
  save();
  return { ok: true, url: q.yousign.link };
}

export function yousignWebhook(body) {
  const ev = body?.event_name;
  const srId = body?.data?.signature_request?.id;
  const db = load();
  const q = db.quotes.find((x) => x.yousign?.id === srId);
  if (!q) return { ok: false };
  if (ev === "signature_request.done" && q.status !== "signé") {
    q.yousign.status = "signé";
    q.signature = { method: "Yousign (signature électronique avancée, code SMS)", at: new Date().toISOString(), provider: "yousign", requestId: srId, fingerprint: quoteFingerprint(q) };
    save();
    signQuote(q.id, findClient(q.clientId)?.name || "Client");
  }
  return { ok: true };
}

// ---------- Stripe Checkout ----------
async function stripe(path, params, method = "POST") {
  const r = await fetch("https://api.stripe.com/v1" + path, { method, headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: method === "POST" ? new URLSearchParams(params) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`Stripe : ${j.error?.message || r.status}`);
  return j;
}

export async function stripeCheckout(invoiceId) {
  const db = load();
  const inv = db.invoices.find((x) => x.id === invoiceId);
  if (!inv) return { error: "Facture introuvable" };
  const v = invoiceView(inv);
  if (v.remaining <= 0) return { error: "Facture déjà réglée" };
  const c = findClient(inv.clientId);
  const s = await stripe("/checkout/sessions", {
    mode: "payment", locale: "fr", "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "eur", "line_items[0][price_data][unit_amount]": String(Math.round(v.remaining * 100)),
    "line_items[0][price_data][product_data][name]": `${STAGES[v.kind]} ${inv.number} · ${inv.title}`.slice(0, 200),
    ...(c?.email ? { customer_email: c.email } : {}),
    "metadata[invoice_id]": inv.id, client_reference_id: inv.id,
    success_url: `${BASE_URL()}/f/${inv.id}?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${BASE_URL()}/f/${inv.id}`,
  });
  inv.stripeSession = s.id;
  save();
  return { ok: true, url: s.url };
}

// Retour de Stripe : on vérifie la session (marche même sans webhook)
export async function stripeConfirm(invoiceId, sessionId) {
  const s = await stripe(`/checkout/sessions/${encodeURIComponent(sessionId)}`, null, "GET");
  if (s.metadata?.invoice_id !== invoiceId) return { error: "Session inconnue" };
  if (s.payment_status !== "paid") return { ok: false, status: s.payment_status };
  return markStripePaid(invoiceId, s);
}

function markStripePaid(invoiceId, s) {
  const inv = load().invoices.find((x) => x.id === invoiceId);
  if (!inv) return { error: "Facture introuvable" };
  if ((inv.payments || []).some((p) => p.ref === s.id)) return { ok: true, invoice: invoiceView(inv) };
  const r = payInvoice(invoiceId, { amount: s.amount_total / 100, method: "carte bancaire (Stripe)" });
  inv.payments.at(-1).ref = s.id;
  save();
  return r;
}

export function stripeWebhook(raw, sigHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    const parts = Object.fromEntries(String(sigHeader || "").split(",").map((p) => p.split("=")));
    const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw}`).digest("hex");
    if (!parts.v1 || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1.padEnd(expected.length).slice(0, expected.length)))) return { error: "Signature Stripe invalide", status: 400 };
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return { error: "Événement trop ancien", status: 400 };
  }
  const ev = JSON.parse(raw);
  if (ev.type === "checkout.session.completed" && ev.data?.object?.metadata?.invoice_id && ev.data.object.payment_status === "paid") return markStripePaid(ev.data.object.metadata.invoice_id, ev.data.object);
  return { ok: true };
}

// ---------- Voix naturelle (ElevenLabs) ----------
const ttsCache = new Map();
export async function tts(text) {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  const voice = process.env.ELEVENLABS_VOICE_ID || "XB0fDUnXU5powFXDhCwa"; // voix multilingue, à remplacer par une voix française choisie
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`, { method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" }, body: JSON.stringify({ text: String(text).slice(0, 1500), model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5", language_code: "fr" }) });
  if (!r.ok) throw new Error("ElevenLabs " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const id = uid("tts");
  ttsCache.set(id, buf);
  if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value);
  return { id, buf, url: `${BASE_URL()}/api/public/tts/${id}.mp3` };
}
export const ttsAudio = (id) => ttsCache.get(id);

// ---------- Vapi : Prava sert de « Custom LLM » (Vapi gère le numéro, la voix et l'écoute en temps réel) ----------
export async function vapiCompletion(body) {
  const call = body.call || {};
  const conv = "vapi_" + (call.id || body.metadata?.callId || uid("c"));
  const last = [...(body.messages || [])].reverse().find((m) => m.role === "user");
  const from = call.customer?.number || "";
  const text = typeof last?.content === "string" ? last.content : (last?.content || []).map((p) => p.text || "").join(" ");
  const out = await chat({ conversationId: conv, mode: "accueil", channel: "téléphone", text: `${text || "(silence)"}${from ? `\n[numéro de l'appelant : ${from}]` : ""}` });
  return { id: "chatcmpl-" + uid("v"), object: "chat.completion", created: Math.floor(Date.now() / 1000), model: "prava", choices: [{ index: 0, message: { role: "assistant", content: out.reply }, finish_reason: "stop" }] };
}

export function vapiEvent(body) {
  const m = body.message || body;
  if (m.type === "end-of-call-report") {
    const conv = "vapi_" + (m.call?.id || "");
    const db = load();
    const already = db.calls.some((c) => c.transcript === conv);
    if (!already) logCall({ phone: m.call?.customer?.number || "", summary: m.summary || m.analysis?.summary || "Appel traité par Prava (Vapi).", urgency: "normale", channel: "téléphone", transcript: conv });
  }
  return { ok: true };
}

function e164(n) {
  const d = String(n || "").replace(/[^\d+]/g, "");
  return d.startsWith("0") ? "+33" + d.slice(1) : d;
}
