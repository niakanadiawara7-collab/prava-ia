// Serveur Prava IA : interface web + API + webhook téléphonique Twilio. Sans framework.
import "./lib/env.js";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, save, reset, applySector, findClient, quoteTotals, withTenant, currentTenantId, findTenantOf, findTenantWhere, tenantExists, listTenantIds, flushAll } from "./lib/db.js";
import * as auth from "./lib/auth.js";
import { mailEnabled, sendEmail } from "./lib/mailer.js";
import { sectorList } from "./lib/sectors.js";
import { demoList } from "./lib/demos.js";
import * as ops from "./lib/ops.js";
import { chat, aiEnabled } from "./lib/agent.js";
import { renderPdf, renderPdfBuffer } from "./lib/pdf.js";
import * as aides from "./lib/aides.js";
import * as renta from "./lib/rentabilite.js";
import * as einvoice from "./lib/einvoice.js";
import * as integ from "./lib/integrations.js";
import * as importer from "./lib/importer.js";
import * as market from "./lib/market.js";
import * as billing from "./lib/billing.js";
import { PLANS, planFeatures } from "./lib/plans.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_PAGES = { "/q/": "quote.html", "/rdv/": "rdv.html", "/chantier/": "chantier.html", "/f/": "pay.html" };

const json = (res, data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
const xml = (res, body) => { res.writeHead(200, { "Content-Type": "text/xml" }); res.end(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`); };
const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

async function readRaw(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 20e6) throw new Error("Requête trop grosse"); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}
async function readBody(req) {
  if (req.preBody) return req.preBody;
  const raw = await readRaw(req);
  if (!raw) return {};
  if ((req.headers["content-type"] || "").includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  return JSON.parse(raw);
}

function serveStatic(res, file) {
  const p = path.join(ROOT, "public", file);
  if (!p.startsWith(path.join(ROOT, "public")) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("Introuvable"); }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
}

const BASE_URL = () => process.env.PUBLIC_URL || `http://localhost:${PORT}`;
const ip = (req) => String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
const isHttps = (req) => req.headers["x-forwarded-proto"] === "https" || BASE_URL().startsWith("https");
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };

// À quelle entreprise s'adresse la requête ?
// - pages et API client (devis, facture, chantier, RDV) : l'entreprise qui possède l'objet ;
// - réservation / téléphone / Vapi : paramètre ?b=<id de l'entreprise> (ou numéro Twilio appelé) ;
// - espace patron : l'entreprise du compte connecté.
const OBJ = { quotes: "quotes", appointments: "appointments", projects: "projects", invoices: "invoices", "purchase-orders": "purchaseOrders" };
function publicTenant(url, m, body) {
  const p = url.pathname;
  let r;
  if ((r = /^\/api\/public\/(quotes|appointments|projects|invoices)\/([^/]+)/.exec(p))) return { tenant: findTenantOf(OBJ[r[1]], r[2]) };
  if (m === "GET" && (r = /^\/api\/(quotes|invoices|purchase-orders)\/([^/]+)\/pdf$/.exec(p))) return { tenant: findTenantOf(OBJ[r[1]], r[2]) };
  if (/^\/api\/public\/(chat|business|match|leads|trades)$/.test(p) || /^\/(twilio|vapi)\//.test(p)) {
    const b = url.searchParams.get("b") || body?.b;
    if (b && tenantExists(b)) return { tenant: b };
    if (p.startsWith("/twilio/") && body?.To) {
      const to = String(body.To).replace(/\D/g, "").slice(-9);
      const t = findTenantWhere((d) => [d.business.twilioNumber, d.business.phone].some((n) => n && String(n).replace(/\D/g, "").slice(-9) === to));
      if (t) return { tenant: t };
    }
    const ids = listTenantIds();
    if (ids.length === 1) return { tenant: ids[0] }; // une seule entreprise sur ce serveur
    return { tenant: null };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  const m = req.method;
  try {
    // ---------- Pages et fichiers statiques (sans compte) ----------
    if (m === "GET" && (p === "/" || p === "/index.html")) return auth.sessionFrom(req) ? serveStatic(res, "index.html") : redirect(res, "/connexion");
    if (m === "GET" && p === "/connexion") return serveStatic(res, "login.html");
    if (m === "GET" && p === "/reserver") return serveStatic(res, "reserver.html");
    if (m === "GET" && p === "/trouver") return serveStatic(res, "trouver.html");
    if (m === "GET" && p === "/sante") return json(res, { ok: true });
    for (const [prefix, file] of Object.entries(PUBLIC_PAGES)) if (m === "GET" && p.startsWith(prefix)) return serveStatic(res, file);
    if (m === "GET" && !p.startsWith("/api/") && !/^\/(twilio|stripe|yousign|vapi)\//.test(p)) return serveStatic(res, p.replace(/^\/(public\/)?/, ""));
    let r;
    if ((r = /^\/api\/public\/tts\/([\w]+)\.mp3$/.exec(p)) && m === "GET") { const a = integ.ttsAudio(r[1]); if (!a) { res.writeHead(404); return res.end(); } res.writeHead(200, { "Content-Type": "audio/mpeg" }); return res.end(a); }

    // ---------- Comptes ----------
    if (p.startsWith("/api/auth/")) return await authRoutes(req, res, p, m);

    // ---------- Webhooks Stripe et Yousign : l'entreprise est retrouvée via la facture / le devis ----------
    if (p === "/stripe/webhook" && m === "POST") {
      const raw = await readRaw(req);
      let invId = null; try { invId = JSON.parse(raw)?.data?.object?.metadata?.invoice_id; } catch {}
      const t = invId && findTenantOf("invoices", invId);
      if (!t) return json(res, { ok: true, ignored: true });
      const out = withTenant(t, () => integ.stripeWebhook(raw, req.headers["stripe-signature"]));
      return json(res, out, out.status || 200);
    }
    if (p === "/yousign/webhook" && m === "POST") {
      const body = await readBody(req);
      const sr = body?.data?.signature_request;
      const t = (sr?.external_id && findTenantOf("quotes", sr.external_id)) || findTenantWhere((d) => d.quotes.some((q) => q.yousign?.id && q.yousign.id === sr?.id));
      return json(res, t ? withTenant(t, () => integ.yousignWebhook(body)) : { ok: false });
    }

    // ---------- Pages client, réservation, téléphone ----------
    // Le corps des webhooks Twilio / Vapi sert à trouver l'entreprise (numéro appelé) : on le lit une seule fois
    if (/^\/(twilio|vapi)\//.test(p) && m === "POST") req.preBody = await readBody(req);
    const pub = publicTenant(url, m, req.preBody);
    if (pub) {
      if (!pub.tenant) return json(res, { error: "Introuvable" }, 404);
      return await withTenant(pub.tenant, () => handle(req, res, url, p, m));
    }

    // ---------- Espace patron : compte connecté obligatoire ----------
    const acc = auth.sessionFrom(req);
    if (!acc) return json(res, { error: "Connexion requise", login: true }, 401);
    req.account = acc;
    return await withTenant(acc.tenantId, () => handle(req, res, url, p, m));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, { error: e.message }, 500);
  }
});

async function authRoutes(req, res, p, m) {
  if (p === "/api/auth/me" && m === "GET") { const a = auth.sessionFrom(req); return json(res, a ? { email: a.email } : { error: "Non connecté" }, a ? 200 : 401); }
  if (p === "/api/auth/logout" && m === "POST") { res.setHeader("Set-Cookie", auth.clearCookie()); return json(res, { ok: true }); }
  if (p === "/api/auth/config" && m === "GET") return json(res, { inviteOnly: Boolean(process.env.SIGNUP_CODE), mail: mailEnabled(), sectors: sectorList(), demos: demoList() });
  if (m !== "POST") return json(res, { error: "Route inconnue" }, 404);
  const body = await readBody(req);
  if (["/api/auth/login", "/api/auth/signup", "/api/auth/forgot", "/api/auth/reset"].includes(p) && auth.rateLimited(ip(req))) return json(res, { error: "Trop d'essais, réessayez dans un quart d'heure." }, 429);
  if (p === "/api/auth/signup") {
    const out = auth.signup(body);
    if (out.error) return json(res, out, 400);
    res.setHeader("Set-Cookie", auth.sessionCookie(out.account, isHttps(req)));
    return json(res, { ok: true });
  }
  if (p === "/api/auth/login") {
    const out = auth.login(body);
    if (out.error) return json(res, out, 400);
    res.setHeader("Set-Cookie", auth.sessionCookie(out.account, isHttps(req)));
    return json(res, { ok: true });
  }
  if (p === "/api/auth/forgot") {
    const t = auth.resetToken(body.email);
    if (t) {
      const link = `${BASE_URL()}/connexion#reset=${t.token}`;
      if (mailEnabled()) await sendEmail({ to: t.account.email, subject: "Prava IA · Réinitialiser votre mot de passe", text: `Bonjour,\n\nPour choisir un nouveau mot de passe, cliquez sur ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.` }).catch((e) => console.error(e.message));
      else console.log(`Lien de réinitialisation pour ${t.account.email} (e-mail non configuré) : ${link}`);
    }
    return json(res, { ok: true, mail: mailEnabled() });
  }
  if (p === "/api/auth/reset") {
    const out = auth.resetPassword(body.token, body.password);
    if (out.error) return json(res, out, 400);
    res.setHeader("Set-Cookie", auth.sessionCookie(out.account, isHttps(req)));
    return json(res, { ok: true });
  }
  if (p === "/api/auth/password") {
    const a = auth.sessionFrom(req);
    if (!a) return json(res, { error: "Connexion requise" }, 401);
    const out = auth.changePassword(a.id, body);
    if (out.error) return json(res, out, 400);
    res.setHeader("Set-Cookie", auth.sessionCookie(auth.findAccount(a.id), isHttps(req)));
    return json(res, { ok: true });
  }
  return json(res, { error: "Route inconnue" }, 404);
}

async function handle(req, res, url, p, m) {
    const db = load();
    let r;

    // ---------- API publique (pages client) ----------
    if ((r = /^\/api\/public\/quotes\/([^/]+)$/.exec(p)) && m === "GET") {
      const q = db.quotes.find((x) => x.id === r[1]);
      if (!q) return json(res, { error: "Introuvable" }, 404);
      const c = findClient(q.clientId);
      const acompte = db.invoices.find((i) => i.quoteId === q.id && i.kind === "acompte");
      const { otp, ...pub } = q;
      return json(res, { quote: { ...pub, totals: quoteTotals(q) }, client: { name: c?.name, phone: c?.phone ? c.phone.replace(/\d(?=(?:\D*\d){2})/g, "•") : "" }, business: pick(db.business, ["name", "phone", "email", "address", "depositPercent"]), docLabel: ops.docLabel(), acompte: acompte ? { id: acompte.id, status: acompte.status } : null, aids: aides.computeAids(q), vatMention: aides.vatMention(q), yousign: Boolean(process.env.YOUSIGN_API_KEY), sms: Boolean(process.env.TWILIO_ACCOUNT_SID) });
    }
    if ((r = /^\/api\/public\/quotes\/([^/]+)\/otp$/.exec(p)) && m === "POST") return json(res, integ.sendSignatureCode(r[1]));
    if ((r = /^\/api\/public\/quotes\/([^/]+)\/sign$/.exec(p)) && m === "POST") { const body = await readBody(req); return json(res, integ.signWithCode(r[1], body, req)); }
    if ((r = /^\/api\/public\/quotes\/([^/]+)\/yousign$/.exec(p)) && m === "POST") {
      const q = db.quotes.find((x) => x.id === r[1]);
      if (!q || !process.env.YOUSIGN_API_KEY) return json(res, { error: "Yousign n'est pas configuré" }, 400);
      return json(res, await integ.yousignStart(q.id, await renderPdfBuffer(q, "quote")));
    }
    if ((r = /^\/api\/public\/quotes\/([^/]+)\/deposit$/.exec(p)) && m === "POST") return json(res, ops.payDeposit(r[1]));
    if ((r = /^\/api\/public\/appointments\/([^/]+)$/.exec(p))) {
      const a = db.appointments.find((x) => x.id === r[1]);
      if (!a) return json(res, { error: "Introuvable" }, 404);
      if (m === "GET") return json(res, { appointment: a, business: pick(db.business, ["name", "phone"]), slots: ops.availableSlots({ date_from: a.start.slice(0, 10), days: 7, duration_minutes: a.duration }) });
      const body = await readBody(req);
      if (body.confirm) { a.clientConfirmed = true; save(); return json(res, { ok: true }); }
      return json(res, ops.moveAppointment({ appointment_id: a.id, new_start: body.new_start, cancel: body.cancel }));
    }
    if (p === "/api/public/chat" && m === "POST") {
      const body = await readBody(req);
      return json(res, await chat({ conversationId: body.conversationId, mode: "accueil", channel: "site web", text: String(body.text || "").slice(0, 4000), images: body.images || [] }));
    }
    // Espace client : chantier, photos, factures, messages
    if ((r = /^\/api\/public\/projects\/([^/]+)$/.exec(p)) && m === "GET") { const v = billing.portal(r[1]); return v ? json(res, v) : json(res, { error: "Introuvable" }, 404); }
    if ((r = /^\/api\/public\/projects\/([^/]+)\/messages$/.exec(p)) && m === "POST") { const b = await readBody(req); return json(res, await billing.clientMessage(r[1], String(b.text || "").slice(0, 2000))); }
    if ((r = /^\/api\/public\/projects\/([^/]+)\/visits\/([^/]+)$/.exec(p)) && m === "POST") { const b = await readBody(req); return json(res, billing.answerVisit(r[1], r[2], b.present !== false)); }
    // Paiement d'une facture par carte (simulé tant que Stripe n'est pas branché)
    if ((r = /^\/api\/public\/invoices\/([^/]+)$/.exec(p)) && m === "GET") {
      const inv = db.invoices.find((x) => x.id === r[1]);
      if (!inv) return json(res, { error: "Introuvable" }, 404);
      const v = billing.invoiceView(inv);
      const prj = inv.quoteId && db.projects.find((x) => x.quoteId === inv.quoteId);
      return json(res, { invoice: { ...v, kindLabel: billing.STAGES[v.kind] }, client: { name: findClient(inv.clientId)?.name }, business: pick(db.business, ["name", "phone", "email", "address", "siret", "iban", "bic"]), projectId: prj?.id || null, stripe: Boolean(process.env.STRIPE_SECRET_KEY), demo: Boolean(db.business.demoProfile) });
    }
    if ((r = /^\/api\/public\/invoices\/([^/]+)\/checkout$/.exec(p)) && m === "POST") return json(res, process.env.STRIPE_SECRET_KEY ? await integ.stripeCheckout(r[1]) : { simulated: true });
    if ((r = /^\/api\/public\/invoices\/([^/]+)\/stripe-confirm$/.exec(p)) && m === "POST") return json(res, await integ.stripeConfirm(r[1], (await readBody(req)).session_id));
    // ---------- Vapi ----------
    if (p.startsWith("/vapi/")) {
      if (process.env.VAPI_SECRET && req.headers["x-vapi-secret"] !== process.env.VAPI_SECRET && req.headers.authorization !== `Bearer ${process.env.VAPI_SECRET}`) return json(res, { error: "Non autorisé" }, 401);
      if (/\/chat\/completions$/.test(p) && m === "POST") {
        const body = await readBody(req);
        const out = await integ.vapiCompletion(body);
        if (!body.stream) return json(res, out);
        // Vapi demande souvent une réponse en flux (SSE) : on envoie la réponse en un seul morceau
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id: out.id, object: "chat.completion.chunk", created: out.created, model: "prava", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        res.write(chunk({ role: "assistant", content: out.choices[0].message.content }));
        res.write(chunk({}, "stop"));
        return res.end("data: [DONE]\n\n");
      }
      if (m === "POST") return json(res, integ.vapiEvent(await readBody(req)));
    }
    // Paiement simulé : uniquement sur un compte de démonstration
    if ((r = /^\/api\/public\/invoices\/([^/]+)\/pay$/.exec(p)) && m === "POST") return db.business.demoProfile ? json(res, billing.payInvoice(r[1])) : json(res, { error: "Paiement en ligne non disponible" }, 400);
    // Espace public : trouver le bon artisan
    if (p === "/api/public/match" && m === "POST") { const b = await readBody(req); return json(res, await market.searchProviders({ text: String(b.text || "").slice(0, 2000), location: String(b.location || "").slice(0, 100), urgency: b.urgency, trade: b.trade, photo: b.photo })); }
    if (p === "/api/public/leads" && m === "POST") return json(res, market.sendLeads(await readBody(req)));
    if (p === "/api/public/trades" && m === "GET") return json(res, Object.keys(market.TRADES));
    if (p === "/api/public/business" && m === "GET") return json(res, { ...pick(db.business, ["name", "phone", "address"]), aiEnabled: aiEnabled() });

    // ---------- Téléphonie Twilio (appels entrants) ----------
    if (p === "/twilio/voice" && m === "POST") {
      const body = await readBody(req);
      const conv = "tw_" + (body.CallSid || Date.now());
      // Relais de la secrétaire : on fait d'abord sonner le bureau, Prava décroche si personne ne répond (ou hors horaires)
      if (shouldRingOfficeFirst(db.business)) {
        return xml(res, `<Dial timeout="15" action="/twilio/after-dial?b=${currentTenantId()}&amp;c=${encodeURIComponent(conv)}&amp;from=${encodeURIComponent(body.From || "")}" method="POST">${esc(e164(db.business.forwardNumber))}</Dial>`);
      }
      return xml(res, await gather(conv, body.From, greetingText(db.business)));
    }
    if (p === "/twilio/after-dial" && m === "POST") {
      const body = await readBody(req);
      if (body.DialCallStatus === "completed") return xml(res, "<Hangup/>");
      return xml(res, await gather(url.searchParams.get("c"), url.searchParams.get("from") || "", greetingText(db.business)));
    }
    if (p === "/twilio/gather" && m === "POST") {
      const body = await readBody(req);
      const conv = url.searchParams.get("c");
      const from = url.searchParams.get("from") || "";
      if (!body.SpeechResult) return xml(res, await gather(conv, from, "Je ne vous ai pas entendu. Pouvez-vous répéter ?"));
      const out = await chat({ conversationId: conv, mode: "accueil", channel: "téléphone", text: `${body.SpeechResult}\n[numéro de l'appelant : ${from}]` });
      return xml(res, await gather(conv, from, out.reply));
    }
    if (p === "/twilio/status" && m === "POST") {
      const body = await readBody(req);
      if (["no-answer", "busy", "failed"].includes(body.CallStatus) && body.From) ops.logMissedCall(body.From);
      return xml(res, "");
    }

    // ---------- API patron ----------
    if (p === "/api/state" && m === "GET") return json(res, { account: { email: req.account?.email }, tenantId: currentTenantId(), bookingUrl: `${BASE_URL()}/reserver?b=${currentTenantId()}`, mail: mailEnabled(), stripe: Boolean(process.env.STRIPE_SECRET_KEY), business: db.business, services: db.services, staff: db.staff, hours: db.hours, sectors: sectorList(), demos: demoList(), aiEnabled: aiEnabled(), docLabel: ops.docLabel(), projectLabel: ops.projectLabel(), twilio: Boolean(process.env.TWILIO_ACCOUNT_SID), plans: PLANS, features: planFeatures(db.business), expenseCategories: billing.EXPENSE_CATEGORIES, mailCategories: billing.MAIL_CATEGORIES, integrations: integ.integrationsStatus(), aides: aides.aidesInfo() });
    if (p === "/api/business" && m === "PUT") { const { demoProfile, ...b } = await readBody(req); Object.assign(db.business, b); save(); return json(res, db.business); }
    if (p === "/api/sector" && m === "POST") { const b = await readBody(req); applySector(b.sector); save(); return json(res, { ok: true }); }
    if (p === "/api/services" && m === "PUT") { db.services = (await readBody(req)).services; save(); return json(res, { ok: true }); }
    if (p === "/api/staff" && m === "PUT") { db.staff = (await readBody(req)).staff; save(); return json(res, { ok: true }); }
    if (p === "/api/hours" && m === "PUT") { db.hours = (await readBody(req)).hours; save(); return json(res, { ok: true }); }
    if (p === "/api/reset" && m === "POST") { reset(); return json(res, { ok: true }); }
    if (p === "/api/demo" && m === "POST") { const b = await readBody(req); const fresh = reset(b.profile); return json(res, { ok: true, profile: fresh.business.demoProfile }); }

    if (p === "/api/clients" && m === "GET") return json(res, db.clients.map((c) => ({ ...c, quotes: db.quotes.filter((q) => q.clientId === c.id).length, appointments: db.appointments.filter((a) => a.clientId === c.id).length })));
    if (p === "/api/clients" && m === "POST") return json(res, ops.upsertClient(await readBody(req)));
    if ((r = /^\/api\/clients\/([^/]+)$/.exec(p)) && m === "GET") return json(res, ops.clientHistory(r[1]));
    if ((r = /^\/api\/clients\/([^/]+)$/.exec(p)) && m === "PUT") { const c = findClient(r[1]); Object.assign(c, await readBody(req)); save(); return json(res, c); }

    if (p === "/api/appointments" && m === "GET") return json(res, ops.agenda({ date_from: url.searchParams.get("from"), date_to: url.searchParams.get("to") }));
    if (p === "/api/appointments" && m === "POST") return json(res, ops.bookAppointment(await readBody(req)));
    if ((r = /^\/api\/appointments\/([^/]+)$/.exec(p)) && m === "POST") return json(res, ops.moveAppointment({ appointment_id: r[1], ...(await readBody(req)) }));
    if (p === "/api/slots" && m === "GET") return json(res, ops.availableSlots({ date_from: url.searchParams.get("date"), days: Number(url.searchParams.get("days") || 3), duration_minutes: Number(url.searchParams.get("duration") || 60) }));

    if (p === "/api/quotes" && m === "GET") return json(res, db.quotes.slice().reverse().map(({ otp, signature, ...q }) => ({ ...q, signed: Boolean(signature), totals: quoteTotals(q), client: findClient(q.clientId)?.name, aids: aides.computeAids(q) })));
    if (p === "/api/quotes" && m === "POST") return json(res, ops.createQuote(await readBody(req)));
    if ((r = /^\/api\/quotes\/([^/]+)\/pdf$/.exec(p))) {
      const q = db.quotes.find((x) => x.id === r[1]);
      if (!q) return json(res, { error: "Introuvable" }, 404);
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${q.number}.pdf"` });
      return renderPdf(q, "quote", res);
    }
    if ((r = /^\/api\/quotes\/([^/]+)\/invoice$/.exec(p)) && m === "POST") return json(res, ops.convertQuoteToInvoice(r[1]));
    if ((r = /^\/api\/quotes\/([^/]+)\/sign$/.exec(p)) && m === "POST") return json(res, ops.signQuote(r[1], (await readBody(req)).name || db.business.owner));

    if (p === "/api/invoices" && m === "GET") return json(res, db.invoices.slice().reverse().map((i) => ({ ...billing.invoiceView(i), kindLabel: billing.STAGES[i.kind || "facture"] })));
    if (p === "/api/invoices" && m === "POST") { const b = await readBody(req); return json(res, billing.createInvoice({ quote: b.quote_id, kind: b.kind, percent: b.percent })); }
    if ((r = /^\/api\/invoices\/([^/]+)\/pdf$/.exec(p))) {
      const inv = db.invoices.find((x) => x.id === r[1]);
      if (!inv) return json(res, { error: "Introuvable" }, 404);
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${inv.number}.pdf"` });
      return renderPdf(inv, "invoice", res);
    }
    if ((r = /^\/api\/invoices\/([^/]+)\/paid$/.exec(p)) && m === "POST") { const b = await readBody(req); return json(res, ops.markInvoicePaid(r[1], { amount: b.amount, method: b.method })); }

    // Suivi de chantier
    if (p === "/api/projects" && m === "GET") return json(res, ops.listProjects().reverse().map((x) => ({ ...x, journal: undefined, notes: x.journal.length })));
    if (p === "/api/projects" && m === "POST") return json(res, ops.createProject(await readBody(req)));
    if ((r = /^\/api\/projects\/([^/]+)$/.exec(p)) && m === "GET") { const x = db.projects.find((y) => y.id === r[1]); return x ? json(res, ops.projectView(x)) : json(res, { error: "Introuvable" }, 404); }
    if ((r = /^\/api\/projects\/([^/]+)$/.exec(p)) && m === "PUT") return json(res, ops.updateProject(r[1], await readBody(req)));
    if ((r = /^\/api\/projects\/([^/]+)\/steps$/.exec(p)) && m === "POST") { const b = await readBody(req); return json(res, ops.completeStep({ project: r[1], step: Number(b.index), done: b.done !== false })); }
    if ((r = /^\/api\/projects\/([^/]+)\/journal$/.exec(p)) && m === "POST") { const b = await readBody(req); return json(res, ops.addJournal({ project: r[1], text: b.text, photo: b.photo, share: b.share, author: b.author, notify: b.notify !== false, count: Number(b.count) || 1, phase: b.phase })); }
    if ((r = /^\/api\/projects\/([^/]+)\/visits$/.exec(p)) && m === "POST") return json(res, billing.addVisit(r[1], await readBody(req)));
    if ((r = /^\/api\/projects\/([^/]+)\/messages$/.exec(p)) && m === "POST") return json(res, billing.artisanMessage(r[1], (await readBody(req)).text || ""));
    if ((r = /^\/api\/projects\/([^/]+)\/ai$/.exec(p)) && m === "POST") return json(res, billing.setAiPaused(r[1], (await readBody(req)).paused));

    // Compta : dépenses, synthèse, dossier pour l'expert-comptable
    if (p === "/api/expenses" && m === "GET") return json(res, (db.expenses || []).slice().sort((a, b) => b.date.localeCompare(a.date)));
    if (p === "/api/expenses" && m === "POST") return json(res, billing.addExpense(await readBody(req)));
    if (p === "/api/expenses/scan" && m === "POST") return json(res, await billing.scanReceipt((await readBody(req)).photo));
    if ((r = /^\/api\/expenses\/([^/]+)$/.exec(p)) && m === "DELETE") { db.expenses = db.expenses.filter((e) => e.id !== r[1]); save(); return json(res, { ok: true }); }
    if (p === "/api/compta" && m === "GET") return json(res, billing.accountingSummary({ from: url.searchParams.get("from"), to: url.searchParams.get("to") }));
    if (p === "/api/compta/send" && m === "POST") return json(res, billing.sendToAccountant(await readBody(req)));

    // Mails : boîte triée par l'IA, réponses préparées
    if (p === "/api/mails" && m === "GET") return json(res, db.mails || []);
    if (p === "/api/mails" && m === "POST") return json(res, await billing.receiveMail(await readBody(req)));
    if ((r = /^\/api\/mails\/([^/]+)\/reply$/.exec(p)) && m === "POST") return json(res, billing.replyMail(r[1], (await readBody(req)).text));
    if ((r = /^\/api\/mails\/([^/]+)\/expense$/.exec(p)) && m === "POST") return json(res, billing.mailToExpense(r[1]));
    if ((r = /^\/api\/mails\/([^/]+)\/status$/.exec(p)) && m === "POST") return json(res, billing.setMailStatus(r[1], (await readBody(req)).status));

    // Voix naturelle pour la démo d'appel (ElevenLabs si la clé est là, sinon le navigateur parle)
    if (p === "/api/tts" && m === "POST") {
      const b = await readBody(req);
      const a = await integ.tts(String(b.text || "")).catch((e) => ({ error: e.message }));
      if (!a || a.error) return json(res, { browser: true, error: a?.error });
      res.writeHead(200, { "Content-Type": "audio/mpeg" }); return res.end(a.buf);
    }
    if (p === "/api/integrations" && m === "GET") return json(res, integ.integrationsStatus());

    // Aides à la rénovation énergétique
    if (p === "/api/aides/estimate" && m === "POST") { const b = await readBody(req); return json(res, aides.computeAids({ lines: b.lines || [], tva: b.tva ?? 5.5 }, b.profile) || { error: "Aucun geste éligible dans ces lignes" }); }
    if ((r = /^\/api\/quotes\/([^/]+)\/aids$/.exec(p)) && m === "PUT") { const q = db.quotes.find((x) => x.id === r[1]); if (!q) return json(res, { error: "Introuvable" }, 404); const b = await readBody(req); q.aidProfile = b.aidProfile; if (b.tva != null) q.tva = Number(b.tva); save(); return json(res, { ok: true, aids: aides.computeAids(q) }); }

    // Rentabilité des chantiers et commandes fournisseurs
    if (p === "/api/margins" && m === "GET") return json(res, renta.marginOverview());
    if ((r = /^\/api\/projects\/([^/]+)\/margin$/.exec(p)) && m === "GET") { const x = db.projects.find((y) => y.id === r[1]); return x ? json(res, { ...renta.projectMargin(x), timeEntries: x.timeEntries || [], orders: renta.listPurchaseOrders(x.id) }) : json(res, { error: "Introuvable" }, 404); }
    if ((r = /^\/api\/projects\/([^/]+)\/time$/.exec(p)) && m === "POST") return json(res, renta.addTime(r[1], await readBody(req)));
    if ((r = /^\/api\/projects\/([^/]+)\/materials$/.exec(p)) && m === "GET") return json(res, renta.materialsFor(r[1]));
    if (p === "/api/purchase-orders" && m === "GET") return json(res, renta.listPurchaseOrders(url.searchParams.get("project")));
    if (p === "/api/purchase-orders" && m === "POST") return json(res, renta.createPurchaseOrder(await readBody(req)));
    if ((r = /^\/api\/purchase-orders\/([^/]+)\/status$/.exec(p)) && m === "POST") return json(res, renta.setPoStatus(r[1], (await readBody(req)).status));
    if ((r = /^\/api\/purchase-orders\/([^/]+)\/pdf$/.exec(p)) && m === "GET") { const o = (db.purchaseOrders || []).find((x) => x.id === r[1]); if (!o) return json(res, { error: "Introuvable" }, 404); res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${o.number}.pdf"` }); return renta.renderPoPdf(o, res); }
    if ((r = /^\/api\/expenses\/([^/]+)\/project$/.exec(p)) && m === "POST") return json(res, renta.linkExpense(r[1], (await readBody(req)).projectId));

    // Facture électronique
    if (p === "/api/einvoice" && m === "GET") return json(res, einvoice.einvoiceStats());
    if ((r = /^\/api\/invoices\/([^/]+)\/transmit$/.exec(p)) && m === "POST") return json(res, await einvoice.transmit(r[1]));
    if ((r = /^\/api\/invoices\/([^/]+)\/facturx\.xml$/.exec(p)) && m === "GET") { const inv = db.invoices.find((x) => x.id === r[1]); if (!inv) return json(res, { error: "Introuvable" }, 404); res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": `inline; filename="${inv.number}-factur-x.xml"` }); return res.end(einvoice.facturxXml(inv)); }
    if (p === "/api/einbox" && m === "GET") return json(res, einvoice.inbox());
    if (p === "/api/einbox/simulate" && m === "POST") return json(res, einvoice.simulateIncoming());
    if ((r = /^\/api\/einbox\/([^/]+)\/accept$/.exec(p)) && m === "POST") return json(res, einvoice.acceptIncoming(r[1], await readBody(req)));

    // Import du catalogue et des clients (Excel, CSV, exports Obat / Batappli)
    if (p === "/api/import/preview" && m === "POST") return json(res, importer.preview(await readBody(req)));
    if (p === "/api/import" && m === "POST") return json(res, importer.runImport(await readBody(req)));
    if (p === "/api/import/sample" && m === "GET") {
      const kind = url.searchParams.get("kind") === "clients" ? "clients" : "catalogue";
      const fmt = url.searchParams.get("format") || "obat";
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${kind === "clients" ? "clients-export" : `bibliotheque-${fmt}`}.csv"` });
      return res.end("\ufeff" + importer.sampleCsv(kind, db.business.demoProfile, fmt));
    }

    if (p === "/api/leads" && m === "GET") return json(res, market.leadsForSelf());
    if (p === "/api/calls" && m === "GET") return json(res, db.calls.slice().reverse().map((c) => ({ ...c, client: findClient(c.clientId)?.name })));
    if ((r = /^\/api\/calls\/([^/]+)\/handled$/.exec(p)) && m === "POST") { const c = db.calls.find((x) => x.id === r[1]); if (c) { c.handled = true; save(); } return json(res, { ok: Boolean(c) }); }
    if (p === "/api/calls/missed" && m === "POST") return json(res, ops.logMissedCall((await readBody(req)).phone || ""));
    if (p === "/api/outbox" && m === "GET") return json(res, db.outbox.map((x) => ({ ...x, client: findClient(x.clientId)?.name })));
    if (p === "/api/stats" && m === "GET") return json(res, ops.stats());
    if (p === "/api/automations" && m === "POST") return json(res, { done: [...ops.runAutomations(), ...(await einvoice.autoTransmit())] });
    if (p === "/api/campaign" && m === "POST") return json(res, ops.runCampaign(await readBody(req)));
    if ((r = /^\/api\/conversations\/([^/]+)$/.exec(p)) && m === "GET") return json(res, db.conversations[r[1]] || null);

    if (p === "/api/chat" && m === "POST") {
      const body = await readBody(req);
      return json(res, await chat({ conversationId: body.conversationId, mode: body.mode === "patron" ? "patron" : "accueil", channel: body.channel || "chat", text: String(body.text || "").slice(0, 8000), images: body.images || [] }));
    }

    // Export comptable (CSV compatible tableur, à importer dans Pennylane / Indy / votre expert-comptable)
    if (p === "/api/export/compta.csv" && m === "GET") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="compta-prava.csv"' });
      return res.end(billing.accountingCsv({ from: url.searchParams.get("from"), to: url.searchParams.get("to") }));
    }

    json(res, { error: "Route inconnue" }, 404);
}

async function gather(conv, from, sayText) {
  const action = `/twilio/gather?b=${currentTenantId()}&amp;c=${encodeURIComponent(conv)}&amp;from=${encodeURIComponent(from || "")}`;
  // Voix naturelle ElevenLabs si la clé est configurée (et PUBLIC_URL pour que Twilio puisse lire l'audio), sinon voix Amazon Polly neuronale
  let voice = `<Say language="fr-FR" voice="Polly.Lea-Neural">${esc(sayText)}</Say>`;
  if (process.env.ELEVENLABS_API_KEY && process.env.PUBLIC_URL) {
    try { const a = await integ.tts(sayText); voice = `<Play>${esc(a.url)}</Play>`; } catch (e) { console.error(e.message); }
  }
  return `<Gather input="speech" language="fr-FR" speechTimeout="auto" action="${action}" method="POST">${voice}</Gather><Redirect method="POST">${action}</Redirect>`;
}

function e164(n) {
  const d = String(n).replace(/[^\d+]/g, "");
  return d.startsWith("0") ? "+33" + d.slice(1) : d;
}

function greetingText(b) {
  return `Bonjour, ${b.name}, je suis l'assistant virtuel. Que puis-je faire pour vous ?`;
}

// "toujours" : Prava répond à tous les appels ; "debordement" : le bureau sonne d'abord ;
// "hors_horaires" : le bureau sonne pendant les horaires, Prava répond le soir et le week-end
function shouldRingOfficeFirst(b) {
  if (!b.forwardNumber || b.answerMode === "toujours") return false;
  if (b.answerMode === "debordement") return true;
  return ops.isOpenNow();
}

function pick(o, keys) {
  return Object.fromEntries(keys.map((k) => [k, o[k]]));
}

// Automatisations (relances, rappels, factures…) : chaque minute, pour chaque entreprise
setInterval(async () => {
  for (const id of listTenantIds()) {
    await withTenant(id, async () => {
      try {
        const d = ops.runAutomations();
        d.push(...(await einvoice.autoTransmit()));
        if (d.length) console.log(`[${id}] Automatisations :`, d.join(", "));
      } catch (e) { console.error(`[${id}]`, e); }
    });
  }
}, 60e3);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { flushAll(); process.exit(0); });
server.listen(PORT, () => {
  console.log(`Prava IA démarré : ${BASE_URL()}`);
  console.log(aiEnabled() ? "IA : activée" : "IA : désactivée (ajoutez ANTHROPIC_API_KEY dans .env)");
  console.log(mailEnabled() ? "E-mails : activés" : "E-mails : non configurés (SMTP_HOST), les messages sont seulement enregistrés");
  console.log(process.env.TWILIO_ACCOUNT_SID ? "SMS / téléphone : activés" : "SMS / téléphone : non configurés (TWILIO_*)");
});
