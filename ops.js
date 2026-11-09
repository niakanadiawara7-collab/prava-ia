// Opérations métier partagées par l'IA (outils) et l'interface (API REST).
import { load, save, uid, nextNumber, findClient, quoteTotals, localISO } from "./db.js";
import { currentTenantId } from "./db.js";
import { SECTORS, PROJECTS } from "./sectors.js";
import * as billing from "./billing.js";
import { allows } from "./plans.js";
import * as einvoice from "./einvoice.js";
import { sendEmail, mailEnabled } from "./mailer.js";
import { renderPdfBuffer } from "./pdf.js";

const DAYS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const BASE_URL = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

// ---------- Clients ----------
export function upsertClient({ name, phone, email, address }) {
  const db = load();
  const norm = (p) => (p || "").replace(/\D/g, "").replace(/^33/, "0");
  let c = null;
  if (phone) c = db.clients.find((x) => norm(x.phone) && norm(x.phone) === norm(phone));
  if (!c && name) c = db.clients.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!c) {
    c = { id: uid("cli"), name: name || "Client sans nom", phone: phone || "", email: email || "", address: address || "", notes: "", createdAt: new Date().toISOString() };
    db.clients.push(c);
  } else {
    if (name && c.name === "Client sans nom") c.name = name;
    if (phone && !c.phone) c.phone = phone;
    if (email) c.email = email;
    if (address) c.address = address;
  }
  save();
  return c;
}

export function clientHistory(clientId) {
  const db = load();
  return {
    client: findClient(clientId),
    calls: db.calls.filter((x) => x.clientId === clientId),
    appointments: db.appointments.filter((x) => x.clientId === clientId),
    quotes: db.quotes.filter((x) => x.clientId === clientId).map((q) => ({ ...q, totals: quoteTotals(q) })),
    invoices: db.invoices.filter((x) => x.clientId === clientId).map(billing.invoiceView),
    messages: db.outbox.filter((x) => x.clientId === clientId),
  };
}

export function lookupClient(query) {
  const db = load();
  const q = (query || "").toLowerCase();
  const digits = q.replace(/\D/g, "");
  const found = db.clients.filter((c) => (digits.length >= 6 && c.phone.replace(/\D/g, "").includes(digits)) || c.name.toLowerCase().includes(q));
  return found.slice(0, 5).map((c) => {
    const h = clientHistory(c.id);
    return {
      ...c,
      appointments: h.appointments.map((a) => `${a.start} ${a.title} (${a.status})`),
      quotes: h.quotes.map((x) => `${x.number} ${x.title} ${x.totals.ttc} € TTC (${x.status})`),
      lastCalls: h.calls.slice(-3).map((x) => `${x.at.slice(0, 10)} : ${x.summary}`),
    };
  });
}

// ---------- Agenda ----------
function parseRanges(ranges) {
  return (ranges || []).map((r) => r.split("-").map((t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; }));
}

export function availableSlots({ date_from, days = 3, duration_minutes = 60, staff }) {
  const db = load();
  const start = date_from ? new Date(date_from + "T00:00") : new Date();
  const now = new Date();
  const out = [];
  for (let i = 0; i < Math.min(days, 14); i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); d.setHours(0, 0, 0, 0);
    const ranges = parseRanges(db.hours[DAYS[d.getDay()]]);
    const daySlots = [];
    for (const [a, b] of ranges) {
      for (let m = a; m + duration_minutes <= b; m += 30) {
        const s = new Date(d); s.setMinutes(m);
        if (s < new Date(now.getTime() + 30 * 60e3)) continue;
        const e = new Date(s.getTime() + duration_minutes * 60e3);
        const freeStaff = db.staff.filter((st) => !staff || st.name === staff).filter((st) => isFree(st, s, e));
        if (freeStaff.length) daySlots.push(localISO(s).slice(11));
      }
    }
    if (daySlots.length) out.push({ date: localISO(d).slice(0, 10), jour: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }), creneaux: daySlots.slice(0, 12) });
  }
  return out;
}

// Un membre de l'équipe (ou une salle) est libre si le nombre de rendez-vous qui se chevauchent est sous sa capacité
function isFree(st, s, e) {
  const busy = load().appointments.filter((ap) => {
    if (ap.status === "annulé" || ap.staff !== st.name) return false;
    const as = new Date(ap.start), ae = new Date(as.getTime() + ap.duration * 60e3);
    return s < ae && e > as;
  }).length;
  return busy < (Number(st.capacity) || 1);
}

function withinHours(start, duration) {
  const d = new Date(start);
  const m = d.getHours() * 60 + d.getMinutes();
  return parseRanges(load().hours[DAYS[d.getDay()]]).some(([a, b]) => m >= a && m + duration <= b);
}

function pickStaff(start, duration, skill) {
  const db = load();
  const s = new Date(start), e = new Date(s.getTime() + duration * 60e3);
  const free = db.staff.filter((st) => isFree(st, s, e));
  if (!free.length) return null;
  const sk = (skill || "").toLowerCase();
  return free.find((st) => sk && st.skills.some((x) => sk.includes(x.toLowerCase()) || x.toLowerCase().includes(sk))) || free[0];
}

export function bookAppointment(input, channel = "sms") {
  const db = load();
  const client = upsertClient({ name: input.client_name, phone: input.phone, email: input.email, address: input.address });
  const duration = Number(input.duration_minutes) || 60;
  const start = input.start.slice(0, 16);
  if (!input.force && !withinHours(start, duration)) return { error: "Ce créneau est en dehors des horaires d'ouverture. Propose un créneau avec check_availability." };
  const staff = input.staff ? db.staff.find((s) => s.name === input.staff) : pickStaff(start, duration, input.skill || input.title);
  if (!staff) return { error: "Ce créneau n'est plus disponible. Propose un autre créneau avec check_availability." };
  const apt = { id: uid("apt"), clientId: client.id, title: input.title, start, duration, staff: staff.name, address: input.address || client.address, notes: input.notes || "", partySize: input.party_size || null, status: "confirmé", reminders: [], createdAt: new Date().toISOString() };
  db.appointments.push(apt);
  save();
  const label = SECTORS[db.business.sector]?.appointmentLabel || "Rendez-vous";
  sendMessage({ clientId: client.id, channel: client.phone ? channel : "email", kind: "confirmation", text: `${db.business.name} : votre ${label.toLowerCase()} « ${apt.title} » est confirmé(e) le ${fmtDate(start)}. Pour modifier ou annuler : ${BASE_URL()}/rdv/${apt.id}` });
  return { ok: true, appointment: apt, client };
}

export function moveAppointment({ appointment_id, new_start, cancel }) {
  const db = load();
  const apt = db.appointments.find((a) => a.id === appointment_id);
  if (!apt) return { error: "Rendez-vous introuvable" };
  if (cancel) apt.status = "annulé";
  else if (new_start) { apt.start = new_start.slice(0, 16); apt.status = "confirmé"; apt.reminders = []; }
  save();
  const client = findClient(apt.clientId);
  sendMessage({ clientId: apt.clientId, channel: client?.phone ? "sms" : "email", kind: "confirmation", text: cancel ? `${db.business.name} : votre rendez-vous du ${fmtDate(apt.start)} est annulé.` : `${db.business.name} : votre rendez-vous est déplacé au ${fmtDate(apt.start)}.` });
  return { ok: true, appointment: apt };
}

export function agenda({ date_from, date_to }) {
  const db = load();
  const from = date_from || localISO(new Date()).slice(0, 10);
  const to = date_to || from;
  return db.appointments
    .filter((a) => a.status !== "annulé" && a.start.slice(0, 10) >= from && a.start.slice(0, 10) <= to)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) => ({ ...a, client: findClient(a.clientId)?.name, phone: findClient(a.clientId)?.phone }));
}

// ---------- Devis / factures ----------
export function createQuote(input, channel = "sms") {
  const db = load();
  const client = upsertClient({ name: input.client_name, phone: input.phone, email: input.email, address: input.address });
  const lines = (input.lines || []).map((l) => {
    const svc = db.services.find((s) => (l.code && s.code === l.code) || s.label.toLowerCase() === (l.label || "").toLowerCase());
    const line = {
      label: l.label || svc?.label || "Prestation",
      qty: Number(l.qty) || 1,
      unit: l.unit || svc?.unit || "u",
      unitPrice: l.unit_price != null ? Number(l.unit_price) : svc ? svc.price : 0,
    };
    if (svc?.code) line.code = svc.code;
    if (l.aid || svc?.aid) line.aid = l.aid || svc.aid;
    return line;
  });
  const q = { id: uid("quo"), number: nextNumber("quote"), clientId: client.id, title: input.title, lines, tva: input.tva != null ? Number(input.tva) : lines.some((l) => l.aid) ? 5.5 : db.business.tva, notes: input.notes || "", status: "envoyé", createdAt: new Date().toISOString(), followups: [], source: input.source || "manuel" };
  if (input.aid_profile && lines.some((l) => l.aid)) q.aidProfile = { persons: Number(input.aid_profile.persons) || 1, income: Number(input.aid_profile.income) || null, idf: Boolean(input.aid_profile.idf), category: input.aid_profile.category || undefined };
  db.quotes.push(q);
  save();
  const t = quoteTotals(q);
  if (input.send !== false) {
    const text = `${db.business.name} : voici votre ${docLabel().toLowerCase()} ${q.number} (« ${q.title} », ${t.ttc.toFixed(2)} € TTC). Consultez-le et signez en ligne : ${BASE_URL()}/q/${q.id}`;
    if (client.email) sendMessage({ clientId: client.id, channel: "email", kind: "devis", text, attach: { type: "quote", id: q.id } });
    if (client.phone && (channel !== "email" || !client.email)) sendMessage({ clientId: client.id, channel: channel === "email" ? "sms" : channel, kind: "devis", text });
  }
  return { ok: true, quote: { ...q, totals: t, link: `${BASE_URL()}/q/${q.id}`, pdf: `${BASE_URL()}/api/quotes/${q.id}/pdf` } };
}

export function signQuote(id, signerName) {
  const db = load();
  const q = db.quotes.find((x) => x.id === id);
  if (!q) return { error: "Devis introuvable" };
  q.status = "signé";
  q.signedAt = new Date().toISOString();
  q.signedBy = signerName;
  save();
  notifyOwner(`✅ Devis ${q.number} signé par ${signerName} (${quoteTotals(q).ttc.toFixed(2)} € TTC).`);
  const deposit = billing.onQuoteSigned(q);
  return { ok: true, quote: q, deposit: deposit?.invoice || null };
}

// Acompte payé depuis la page du devis : on règle la facture d'acompte (créée si besoin)
export function payDeposit(id) {
  const db = load();
  const q = db.quotes.find((x) => x.id === id);
  if (!q) return { error: "Devis introuvable" };
  const inv = db.invoices.find((i) => i.quoteId === q.id && i.kind === "acompte") || billing.createInvoice({ quote: q, kind: "acompte", send: false }).invoice;
  if (!inv) return { error: "Impossible de créer la facture d'acompte" };
  // Vrai compte : on ne simule jamais un paiement, on envoie vers la page de règlement de la facture
  if (!db.business.demoProfile) return { ok: true, invoiceId: inv.id };
  return billing.payInvoice(inv.id);
}

export function convertQuoteToInvoice(idOrNumber) {
  return billing.createInvoice({ quote: idOrNumber, kind: "facture" });
}

export function createInvoiceFromReport(input) {
  const r = createQuote({ ...input, title: input.title || "Intervention", send: false, source: "rapport" });
  const db = load();
  const q = db.quotes.find((x) => x.id === r.quote.id);
  q.notes = input.report_text || "";
  q.status = "signé";
  save();
  return convertQuoteToInvoice(q.id);
}

export function markInvoicePaid(id, { amount, method } = {}) {
  return billing.payInvoice(id, { amount, method: method || "réglée hors ligne (virement, chèque ou espèces)" });
}

export function docLabel() {
  return SECTORS[load().business.sector]?.docLabel || "Devis";
}

// ---------- Appels ----------
export function logCall({ client_name, phone, summary, urgency = "normale", needs_callback = false, channel = "téléphone", transcript }) {
  const db = load();
  const client = client_name || phone ? upsertClient({ name: client_name, phone }) : null;
  const call = { id: uid("cal"), clientId: client?.id || null, phone: phone || client?.phone || "", channel, summary, urgency, needsCallback: needs_callback, missed: false, transcript: transcript || null, at: new Date().toISOString() };
  db.calls.push(call);
  save();
  const icon = { urgente: "🚨", haute: "⚠️" }[urgency] || "📞";
  notifyOwner(`${icon} Nouveau contact (${channel}) – ${client?.name || "inconnu"} ${call.phone} – urgence ${urgency}${needs_callback ? " – À RAPPELER" : ""}\n${summary}`);
  return { ok: true, call };
}

export function logMissedCall(phone) {
  const db = load();
  const client = db.clients.find((c) => c.phone.replace(/\D/g, "") === phone.replace(/\D/g, ""));
  const call = { id: uid("cal"), clientId: client?.id || null, phone, channel: "téléphone", summary: "Appel manqué", urgency: "inconnue", missed: true, smsSent: false, at: new Date().toISOString() };
  db.calls.push(call);
  save();
  return call;
}

// ---------- Messages sortants (simulés, ou Twilio si configuré) ----------
export function sendMessage({ clientId, to, channel = "sms", kind = "message", text, attach }) {
  const db = load();
  const client = clientId ? findClient(clientId) : null;
  const dest = to || (channel === "email" ? client?.email : client?.phone) || "";
  const smsReal = (channel === "sms" || channel === "whatsapp") && process.env.TWILIO_ACCOUNT_SID;
  const real = smsReal || (channel === "email" && mailEnabled());
  const msg = { id: uid("msg"), clientId: clientId || null, to: dest, channel, kind, text, status: !dest ? "pas de destinataire" : real ? "en cours" : "non envoyé (canal non configuré)", at: new Date().toISOString() };
  db.outbox.unshift(msg);
  if (db.outbox.length > 500) db.outbox.length = 500;
  save();
  if (!dest) return msg;
  if (smsReal) sendTwilio(msg).catch((e) => { msg.status = "erreur : " + e.message; save(); });
  if (channel === "email" && mailEnabled()) sendMail(msg, attach).catch((e) => { msg.status = "erreur : " + e.message; save(); });
  return msg;
}

const SUBJECTS = { devis: "Votre devis", facture: "Votre facture", "relance impayé": "Rappel : facture à régler", "rappel échéance": "Votre facture arrive à échéance", confirmation: "Confirmation de rendez-vous", "dossier comptable": "Dossier comptable", "bon de commande": "Bon de commande", "code de signature": "Votre code de signature", campagne: "Des nouvelles de votre artisan" };
async function sendMail(msg, attach) {
  const db = load();
  const attachments = [];
  if (attach) {
    const doc = attach.type === "quote" ? db.quotes.find((q) => q.id === attach.id) : db.invoices.find((i) => i.id === attach.id);
    if (doc) attachments.push({ filename: `${doc.number}.pdf`, content: await renderPdfBuffer(doc, attach.type), contentType: "application/pdf" });
  }
  await sendEmail({ to: msg.to, subject: `${db.business.name} · ${SUBJECTS[msg.kind] || "Message"}`, text: msg.text, fromName: db.business.name, replyTo: db.business.email, attachments });
  msg.status = "envoyé";
  save();
}

async function sendTwilio(msg) {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  let to = msg.to.replace(/[^\d+]/g, "");
  if (to.startsWith("0")) to = "+33" + to.slice(1);
  const prefix = msg.channel === "whatsapp" ? "whatsapp:" : "";
  const own = load().business.twilioNumber;
  if (own) { const d = own.replace(/[^\d+]/g, ""); if (d) msg.from = d.startsWith("0") ? "+33" + d.slice(1) : d; }
  const body = new URLSearchParams({ To: prefix + to, From: prefix + (msg.from || from), Body: msg.text });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: "POST", body, headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") } });
  msg.status = r.ok ? "envoyé" : "erreur Twilio " + r.status;
  save();
}

export function notifyOwner(text) {
  const db = load();
  return sendMessage({ to: db.business.ownerPhone || db.business.email, channel: "sms", kind: "résumé patron", text });
}

// ---------- Suivi de chantier (dossier, commande… selon le métier) ----------
export function projectLabel() {
  return (PROJECTS[load().business.sector] || PROJECTS.autre).label;
}

export function projectView(p) {
  const done = p.steps.filter((x) => x.done).length;
  const late = p.status !== "terminé" && p.endDate && p.endDate < localISO(new Date()).slice(0, 10);
  const next = p.steps.find((x) => !x.done);
  return { ...p, client: findClient(p.clientId)?.name, progress: p.steps.length ? Math.round((done / p.steps.length) * 100) : 0, nextStep: next?.label || null, late, link: `${BASE_URL()}/chantier/${p.id}` };
}

export function listProjects({ status } = {}) {
  return load().projects.filter((p) => !status || p.status === status).map(projectView);
}

export function findProject(query) {
  const db = load();
  const q = (query || "").toLowerCase();
  return db.projects.find((p) => p.id === query) || db.projects.find((p) => p.title.toLowerCase().includes(q) || (findClient(p.clientId)?.name || "").toLowerCase().includes(q) || (findClient(p.clientId)?.phone || "").replace(/\D/g, "").includes(q.replace(/\D/g, "") || "§"));
}

export function createProject(input) {
  const db = load();
  const quote = input.quote_id ? db.quotes.find((q) => q.id === input.quote_id || q.number === input.quote_id) : null;
  const client = quote ? findClient(quote.clientId) : upsertClient({ name: input.client_name, phone: input.phone, address: input.address });
  const steps = input.steps?.length ? input.steps : (PROJECTS[db.business.sector] || PROJECTS.autre).steps;
  const p = {
    id: uid("prj"), clientId: client.id, quoteId: quote?.id || null, title: input.title || quote?.title || projectLabel(), address: input.address || client.address || "",
    staff: input.staff || db.staff[0]?.name || "", startDate: input.start_date || localISO(new Date()).slice(0, 10), endDate: input.end_date || "", status: "en cours", notifyClient: input.notify_client !== false,
    steps: steps.map((label) => ({ label, done: false, doneAt: null })), journal: [], createdAt: new Date().toISOString(),
  };
  // Devis déjà signé : les étapes jusqu'à « devis signé » sont faites
  const signedIdx = quote?.status === "signé" ? p.steps.findIndex((x) => /devis/i.test(x.label)) : -1;
  p.steps.forEach((st, i) => { if (i <= signedIdx) { st.done = true; st.doneAt = new Date().toISOString(); } });
  db.projects.push(p);
  if (quote) quote.projectId = p.id;
  save();
  if (p.notifyClient) sendMessage({ clientId: client.id, channel: "sms", kind: "suivi chantier", text: `${db.business.name} : votre ${projectLabel().toLowerCase()} « ${p.title} » est ouvert. Suivez son avancement à tout moment ici : ${BASE_URL()}/chantier/${p.id}` });
  return { ok: true, project: projectView(p) };
}

// Coche une étape (par son nom ou son numéro) et prévient le client si demandé
export function completeStep({ project, step, done = true, notify }) {
  const db = load();
  const p = findProject(project);
  if (!p) return { error: "Chantier introuvable" };
  const st = typeof step === "number" ? p.steps[step] : p.steps.find((x) => x.label.toLowerCase() === String(step).toLowerCase()) || p.steps.find((x) => x.label.toLowerCase().includes(String(step).toLowerCase()));
  if (!st) return { error: "Étape introuvable. Étapes : " + p.steps.map((x) => x.label).join(", ") };
  st.done = done;
  st.doneAt = done ? new Date().toISOString() : null;
  if (p.steps.every((x) => x.done)) p.status = "terminé";
  else if (p.status === "terminé") p.status = "en cours";
  save();
  const v = projectView(p);
  if (done && (notify ?? p.notifyClient)) {
    sendMessage({ clientId: p.clientId, channel: "sms", kind: "suivi chantier", text: p.status === "terminé"
      ? `${db.business.name} : votre ${projectLabel().toLowerCase()} « ${p.title} » est terminé. Merci pour votre confiance ! Le détail : ${v.link}`
      : `${db.business.name} : bonne nouvelle, l'étape « ${st.label} » de votre ${projectLabel().toLowerCase()} est terminée (${v.progress} %).${v.nextStep ? ` Prochaine étape : ${v.nextStep}.` : ""} Suivi : ${v.link}` });
  }
  const inv = done ? billing.onStepDone(p, st) : null;
  if (p.status === "terminé") notifyOwner(`🏁 ${projectLabel()} « ${p.title} » (${v.client}) terminé.${inv?.invoice ? ` Facture de solde ${inv.invoice.number} envoyée au client.` : " Pensez à la facture."}`);
  return { ok: true, project: v, invoice: inv?.invoice || null };
}

export function addJournal({ project, text, photo, author, share, notify = true, count = 1, phase }) {
  const db = load();
  const p = findProject(project);
  if (!p) return { error: "Chantier introuvable" };
  const entry = { id: uid("jrn"), at: new Date().toISOString(), author: author || db.business.owner, text: text || "", photo: photo && /^data:image\//.test(photo) ? photo : null, phase: ["avant", "pendant", "après"].includes(phase) ? phase : billing.photoPhase(p), sharedWithClient: Boolean(share) };
  p.journal.push(entry);
  save();
  if (share && notify) {
    const what = entry.photo && !entry.text ? (count > 1 ? `${count} nouvelles photos` : "une nouvelle photo") : `${entry.text.slice(0, 120)}${entry.text.length > 120 ? "…" : ""}${entry.photo ? (count > 1 ? ` (avec ${count} photos)` : " (avec photo)") : ""}`;
    sendMessage({ clientId: p.clientId, channel: "sms", kind: "suivi chantier", text: `${db.business.name} : nouvelle info sur votre ${projectLabel().toLowerCase()} « ${p.title} » : ${what}. Voir : ${projectView(p).link}` });
  }
  return { ok: true, entry: { ...entry, photo: entry.photo ? "(photo)" : null } };
}

export function updateProject(id, fields) {
  const p = findProject(id);
  if (!p) return { error: "Chantier introuvable" };
  for (const k of ["title", "address", "staff", "startDate", "endDate", "status", "notifyClient"]) if (fields[k] !== undefined) p[k] = fields[k];
  if (fields.endDate !== undefined) p.lateAlert = false;
  if (Array.isArray(fields.steps)) p.steps = fields.steps.map((l) => (typeof l === "string" ? { label: l, done: false, doneAt: null } : l));
  save();
  return { ok: true, project: projectView(p) };
}

// Ce que le client voit sur sa page de suivi : uniquement les notes partagées
export function publicProject(id) {
  const db = load();
  const p = db.projects.find((x) => x.id === id);
  if (!p) return null;
  const v = projectView(p);
  return { title: p.title, client: v.client, address: p.address, staff: p.staff, startDate: p.startDate, endDate: p.endDate, status: p.status, progress: v.progress, nextStep: v.nextStep, steps: p.steps, journal: p.journal.filter((j) => j.sharedWithClient), label: projectLabel(), business: { name: db.business.name, phone: db.business.phone } };
}

// ---------- Tableau de bord ----------
export function stats() {
  const db = load();
  const since = Date.now() - 30 * 864e5;
  const recent = (x) => new Date(x.at || x.createdAt).getTime() >= since;
  const calls = db.calls.filter(recent);
  const quotes = db.quotes.filter(recent);
  const signed = quotes.filter((q) => q.status === "signé");
  const sum = (arr) => Math.round(arr.reduce((s, q) => s + quoteTotals(q).ttc, 0) * 100) / 100;
  const today = localISO(new Date()).slice(0, 10);
  return {
    periode: "30 derniers jours",
    appels_recus: calls.length,
    appels_manques: calls.filter((c) => c.missed).length,
    appels_urgents: calls.filter((c) => c.urgency === "urgente" || c.urgency === "haute").length,
    devis_envoyes: quotes.length,
    devis_signes: signed.length,
    taux_conversion: quotes.length ? Math.round((signed.length / quotes.length) * 100) + " %" : "–",
    ca_signe_ttc: sum(signed),
    devis_en_attente: db.quotes.filter((q) => q.status === "envoyé").map((q) => `${q.number} ${findClient(q.clientId)?.name} ${quoteTotals(q).ttc} €`),
    factures_impayees: db.invoices.filter((i) => i.status !== "payée").map(billing.invoiceView).map((i) => `${i.number} ${i.client} : ${i.remaining} € à payer (échéance ${i.dueDate}${i.followups.length ? `, ${i.followups.length} relance(s)` : ""})`),
    encaisse_30j: Math.round(db.invoices.flatMap((i) => i.payments || []).filter((x) => new Date(x.at).getTime() >= since).reduce((s, x) => s + x.amount, 0) * 100) / 100,
    urgences: calls.filter((c) => c.urgency === "urgente" && !c.handled).map((c) => `${fmtShort(c.at)} · ${findClient(c.clientId)?.name || c.phone} : ${c.summary}`),
    mails_a_traiter: (db.mails || []).filter((m) => m.status === "à traiter").length,
    rdv_aujourdhui: db.appointments.filter((a) => a.status !== "annulé" && a.start.startsWith(today)).length,
    rdv_a_venir: db.appointments.filter((a) => a.status === "confirmé" && a.start.slice(0, 10) >= today).length,
    chantiers_en_cours: db.projects.filter((p) => p.status === "en cours").map((p) => { const v = projectView(p); return `${p.title} (${v.client}) ${v.progress} %${v.late ? " – EN RETARD" : ""}${v.nextStep ? ` – prochaine étape : ${v.nextStep}` : ""}`; }),
    clients: db.clients.length,
  };
}

// ---------- Campagnes sortantes ----------
export function runCampaign({ text, inactive_days = 300, channel = "sms" }) {
  const db = load();
  const tpl = text || SECTORS[db.business.sector]?.campaign || "Bonjour {client}, {entreprise} prend de vos nouvelles.";
  const limit = Date.now() - inactive_days * 864e5;
  const targets = db.clients.filter((c) => {
    const last = Math.max(new Date(c.createdAt).getTime(), ...db.appointments.filter((a) => a.clientId === c.id).map((a) => new Date(a.start).getTime()));
    return last < limit;
  });
  for (const c of targets) sendMessage({ clientId: c.id, channel: c.phone ? channel : "email", kind: "campagne", text: tpl.replace("{client}", c.name.split(" ")[0]).replace("{entreprise}", db.business.name) + ` Réservez : ${BASE_URL()}/reserver?b=${currentTenantId()}` });
  return { ok: true, envoyes: targets.length, clients: targets.map((c) => c.name) };
}

// ---------- Automatisations (lancées chaque minute) ----------
export function runAutomations() {
  const db = load();
  const now = Date.now();
  const done = [];
  // 1. Relance des devis non signés à J+3 et J+7
  for (const q of db.quotes.filter((x) => x.status === "envoyé" && allows(db.business, "devis"))) {
    const age = (now - new Date(q.createdAt).getTime()) / 864e5;
    for (const d of [3, 7]) {
      if (age >= d && !q.followups.includes(d)) {
        q.followups.push(d);
        sendMessage({ clientId: q.clientId, channel: "sms", kind: `relance devis J+${d}`, text: `${db.business.name} : avez-vous pu regarder notre ${docLabel().toLowerCase()} ${q.number} ? Vous pouvez le signer en ligne ici : ${BASE_URL()}/q/${q.id}. Une question ? Répondez à ce message.` });
        done.push(`relance ${q.number} J+${d}`);
      }
    }
  }
  // 2. Rappel de rendez-vous la veille (confirmation ou report en un clic)
  for (const a of db.appointments.filter((x) => x.status === "confirmé")) {
    const t = new Date(a.start).getTime();
    if (t - now < 24 * 3600e3 && t > now && !a.reminders.includes("J-1")) {
      a.reminders.push("J-1");
      sendMessage({ clientId: a.clientId, channel: "sms", kind: "rappel RDV", text: `${db.business.name} : rappel de votre rendez-vous « ${a.title} » le ${fmtDate(a.start)}. Confirmer ou déplacer : ${BASE_URL()}/rdv/${a.id}` });
      done.push(`rappel ${a.id}`);
    }
    // 3. Après le rendez-vous : demande d'avis Google
    if (t + (a.duration + 60) * 60e3 < now) {
      a.status = "terminé";
      if (!a.reviewRequested && db.business.reviewUrl) {
        a.reviewRequested = true;
        sendMessage({ clientId: a.clientId, channel: "sms", kind: "demande d'avis", text: `Merci pour votre confiance ! ${db.business.name} serait ravi d'avoir votre avis (30 secondes) : ${db.business.reviewUrl}` });
        done.push(`avis ${a.id}`);
      }
    }
  }
  // 4. Appels manqués : SMS avec lien de réservation
  for (const c of db.calls.filter((x) => x.missed && !x.smsSent && x.phone)) {
    c.smsSent = true;
    sendMessage({ to: c.phone, clientId: c.clientId, channel: "sms", kind: "appel manqué", text: `${db.business.name} : nous avons bien reçu votre appel. Réservez directement un créneau ici : ${BASE_URL()}/reserver?b=${currentTenantId()} ou répondez à ce SMS, nous vous rappelons.` });
    done.push(`sms appel manqué ${c.phone}`);
  }
  // 6. Chantier en retard sur la date de fin prévue : alerte au patron (une fois)
  for (const p of db.projects.filter((x) => x.status === "en cours" && !x.lateAlert && allows(db.business, "chantiers"))) {
    if (projectView(p).late) {
      p.lateAlert = true;
      notifyOwner(`⏰ ${projectLabel()} « ${p.title} » (${findClient(p.clientId)?.name}) a dépassé la date de fin prévue (${p.endDate}). Prévenez le client ou décalez la date.`);
      done.push(`retard ${p.title}`);
    }
  }
  // 5. Factures : rappel avant échéance, puis relances SMS + mail
  done.push(...billing.invoiceReminders());
  // 7. Facture électronique : avancement des statuts et statut « encaissée » après paiement
  done.push(...einvoice.advanceLifecycle());
  if (done.length) save();
  return done;
}

function fmtShort(iso) {
  return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDate(local) {
  const d = new Date(local);
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + " à " + local.slice(11, 16).replace(":", "h");
}

// Ouvert en ce moment ? (pour le relais de la secrétaire pendant les horaires)
export function isOpenNow() {
  return withinHours(localISO(new Date()), 1);
}
