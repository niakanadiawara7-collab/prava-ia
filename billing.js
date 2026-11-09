// Factures (acompte, intermédiaire, solde), paiements, relances, dépenses, tri des mails et espace client.
import { load, save, uid, nextNumber, findClient, quoteTotals, localISO } from "./db.js";
import { currentTenantId } from "./db.js";
import { sendMessage, notifyOwner, docLabel, projectLabel, projectView, fmtDate, publicProject } from "./ops.js";
import { aiEnabled, aiJson, chat } from "./agent.js";
import { allows, EXPENSE_CATEGORIES } from "./plans.js";

export { EXPENSE_CATEGORIES };

const BASE_URL = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
const r2 = (n) => Math.round(n * 100) / 100;
const eur = (n) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const today = () => localISO(new Date()).slice(0, 10);
const inDays = (n) => localISO(new Date(Date.now() + n * 864e5)).slice(0, 10);

// ---------- Factures ----------
export const STAGES = { acompte: "Acompte", "intermédiaire": "Situation intermédiaire", solde: "Solde", facture: "Facture" };

export function invoiceView(inv) {
  const t = quoteTotals(inv);
  const paid = r2((inv.payments || []).reduce((s, p) => s + p.amount, 0) + (inv.depositPaid || 0));
  return { ...inv, kind: inv.kind || "facture", totals: t, paid, remaining: r2(Math.max(0, t.ttc - paid)), link: `${BASE_URL()}/f/${inv.id}`, client: findClient(inv.clientId)?.name };
}

export function createInvoice({ quote, kind = "facture", percent, send = true }) {
  const db = load();
  const q = typeof quote === "object" ? quote : db.quotes.find((x) => x.id === quote || x.number === quote);
  if (!q) return { error: "Devis introuvable" };
  const prev = db.invoices.filter((i) => i.quoteId === q.id);
  const same = prev.find((i) => (i.kind || "facture") === kind);
  if (same && kind !== "intermédiaire") return { ok: true, invoice: invoiceView(same), note: "Facture déjà créée" };
  if (prev.some((i) => ["solde", "facture", undefined].includes(i.kind))) return { error: "Ce devis est déjà entièrement facturé" };
  // Une facture complète après un acompte devient automatiquement la facture de solde
  if (kind === "facture" && prev.length) kind = "solde";
  const copy = q.lines.map((l) => ({ ...l }));
  let lines, days;
  if (kind === "solde") {
    lines = [...copy, ...prev.map((i) => ({ label: `Déjà facturé : ${STAGES[i.kind || "facture"].toLowerCase()} ${i.number}`, qty: 1, unit: "forfait", unitPrice: -quoteTotals(i).ht }))];
    days = 30;
  } else if (kind === "facture") {
    lines = copy; days = Number(db.business.paymentTerms) || 30;
  } else {
    const pct = Number(percent) || Number(kind === "acompte" ? db.business.depositPercent : db.business.intermediatePercent) || 30;
    lines = [{ label: `${STAGES[kind]} de ${pct} % sur le ${docLabel().toLowerCase()} ${q.number} (« ${q.title} »)`, qty: 1, unit: "forfait", unitPrice: r2((quoteTotals(q).ht * pct) / 100) }];
    days = kind === "acompte" ? 7 : 15;
  }
  const inv = {
    id: uid("inv"), number: nextNumber("invoice"), kind, quoteId: q.id, clientId: q.clientId, title: kind === "facture" ? q.title : `${STAGES[kind]} · ${q.title}`,
    lines, tva: q.tva, depositPaid: 0, payments: [], status: "à payer", createdAt: new Date().toISOString(), dueDate: inDays(days), followups: [],
  };
  db.invoices.push(inv);
  if (q.status !== "signé") q.status = "signé";
  if (kind === "solde" || kind === "facture") q.invoiced = true;
  save();
  if (send) sendInvoice(inv);
  return { ok: true, invoice: invoiceView(inv) };
}

function sendInvoice(inv) {
  const db = load();
  const c = findClient(inv.clientId);
  const v = invoiceView(inv);
  const how = process.env.STRIPE_SECRET_KEY || db.business.demoProfile ? "Payez en ligne par carte en un clic" : "Consultez-la et réglez-la ici";
  const text = `${db.business.name} : votre facture ${inv.number} (${STAGES[v.kind].toLowerCase()}, ${eur(v.remaining)} TTC) est disponible. ${how} : ${v.link}`;
  if (c?.phone) sendMessage({ clientId: inv.clientId, channel: "sms", kind: "facture", text });
  if (c?.email || !c?.phone) sendMessage({ clientId: inv.clientId, channel: "email", kind: "facture", text, attach: { type: "invoice", id: inv.id } });
}

export function payInvoice(id, { amount, method = "carte bancaire (paiement simulé)" } = {}) {
  const db = load();
  const inv = db.invoices.find((x) => x.id === id);
  if (!inv) return { error: "Facture introuvable" };
  const v = invoiceView(inv);
  if (v.remaining <= 0) return { ok: true, invoice: v, note: "Déjà réglée" };
  const amt = r2(Math.min(Number(amount) || v.remaining, v.remaining));
  (inv.payments ||= []).push({ amount: amt, at: new Date().toISOString(), method });
  if (amt >= v.remaining - 0.01) { inv.status = "payée"; inv.paidAt = new Date().toISOString(); }
  if (inv.kind === "acompte") {
    const q = db.quotes.find((x) => x.id === inv.quoteId);
    if (q) { q.depositPaid = r2((q.depositPaid || 0) + amt); q.depositAt = new Date().toISOString(); }
  }
  save();
  notifyOwner(`💳 Paiement reçu : ${eur(amt)} pour la facture ${inv.number} (${findClient(inv.clientId)?.name || "client"}), ${method}.`);
  return { ok: true, invoice: invoiceView(inv) };
}

// Le devis signé déclenche la facture d'acompte ; l'avancement du chantier déclenche la situation et le solde
export function onQuoteSigned(q) {
  const db = load();
  if (!allows(db.business, "factures") || !(Number(db.business.depositPercent) > 0)) return null;
  return createInvoice({ quote: q, kind: "acompte" });
}

export function onStepDone(p, step) {
  const db = load();
  if (!p.quoteId || !allows(db.business, "factures")) return null;
  if (p.status === "terminé") return createInvoice({ quote: p.quoteId, kind: "solde" });
  if (/travaux/i.test(step.label) && Number(db.business.intermediatePercent) > 0) {
    if (!db.invoices.some((i) => i.quoteId === p.quoteId && i.kind === "intermédiaire")) return createInvoice({ quote: p.quoteId, kind: "intermédiaire" });
  }
  return null;
}

// Relances : rappel par mail 2 jours avant l'échéance, puis SMS + mail à l'échéance et chaque semaine (4 fois maximum)
export function invoiceReminders() {
  const db = load();
  const done = [];
  if (!allows(db.business, "factures")) return done;
  const now = Date.now();
  for (const inv of db.invoices.filter((x) => x.status === "à payer")) {
    const v = invoiceView(inv);
    const late = (now - new Date(inv.dueDate + "T23:59").getTime()) / 864e5;
    let key = null, text = null;
    if (late >= -2 && late < 0) {
      key = "J-2";
      text = `${db.business.name} : petit rappel, la facture ${inv.number} (${eur(v.remaining)}) arrive à échéance le ${new Date(inv.dueDate).toLocaleDateString("fr-FR")}. Détail et règlement : ${v.link}`;
    } else if (late >= 0) {
      const n = Math.floor(late / 7);
      if (n > 3) {
        key = "patron";
        if (!inv.followups.includes(key)) notifyOwner(`⚠️ ${v.client} n'a toujours pas réglé la facture ${inv.number} (${eur(v.remaining)}) après 4 relances. À appeler.`);
      } else {
        key = "R" + n;
        text = `${db.business.name} : sauf erreur de notre part, la facture ${inv.number} (${eur(v.remaining)}) arrivée à échéance le ${new Date(inv.dueDate).toLocaleDateString("fr-FR")} n'est pas encore réglée. Détail et règlement ici : ${v.link}. Merci !`;
      }
    }
    if (!key || inv.followups.includes(key)) continue;
    inv.followups.push(key);
    if (text) {
      const c = findClient(inv.clientId);
      if (key !== "J-2" && c?.phone) sendMessage({ clientId: inv.clientId, channel: "sms", kind: "relance impayé", text });
      sendMessage({ clientId: inv.clientId, channel: "email", kind: key === "J-2" ? "rappel échéance" : "relance impayé", text });
    }
    done.push(`relance ${inv.number} (${key})`);
  }
  if (done.length) save();
  return done;
}

// ---------- Dépenses et compta ----------

export function addExpense({ date, supplier, label, category, ttc, tvaRate = 20, photo, source = "manuel" }) {
  const db = load();
  const amount = Number(String(ttc).replace(",", ".")) || 0;
  const rate = Number(tvaRate) || 0;
  const ht = r2(amount / (1 + rate / 100));
  const e = {
    id: uid("exp"), date: date || today(), supplier: supplier || "", label: label || "", category: EXPENSE_CATEGORIES.includes(category) ? category : "Autre",
    ttc: r2(amount), ht, tva: r2(amount - ht), tvaRate: rate, photo: photo && /^data:image\//.test(photo) ? photo : null, source, createdAt: new Date().toISOString(),
  };
  (db.expenses ||= []).push(e);
  save();
  return { ok: true, expense: { ...e, photo: e.photo ? "(photo)" : null } };
}

const RECEIPT_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    fournisseur: { type: "string" }, date: { type: "string", description: "AAAA-MM-JJ" }, description: { type: "string", description: "Ce qui a été acheté, en quelques mots" },
    categorie: { type: "string", enum: EXPENSE_CATEGORIES }, montant_ttc: { type: "number" }, taux_tva: { type: "number", description: "20, 10, 5.5 ou 0" },
  },
  required: ["fournisseur", "date", "description", "categorie", "montant_ttc", "taux_tva"],
};

// Lit un ticket ou une facture d'achat en photo (IA) et propose les champs à remplir
export async function scanReceipt(photo) {
  if (!aiEnabled()) return { error: "La lecture automatique des tickets demande l'IA (clé ANTHROPIC_API_KEY). Remplissez les champs à la main." };
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(photo || "");
  if (!m) return { error: "Photo illisible" };
  const out = await aiJson({ schema: RECEIPT_SCHEMA, content: [{ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }, { type: "text", text: `Voici un ticket de caisse ou une facture d'achat d'une petite entreprise française. Extrais les informations comptables. Aujourd'hui : ${today()}.` }] });
  return { ok: true, fields: { supplier: out.fournisseur, date: out.date, label: out.description, category: out.categorie, ttc: out.montant_ttc, tvaRate: out.taux_tva } };
}

export function accountingSummary({ from, to } = {}) {
  const db = load();
  const f = from || today().slice(0, 7) + "-01", t = to || today();
  const inP = (d) => d && d.slice(0, 10) >= f && d.slice(0, 10) <= t;
  const invoices = db.invoices.filter((i) => inP(i.createdAt)).map(invoiceView);
  const expenses = (db.expenses || []).filter((e) => inP(e.date));
  const payments = db.invoices.flatMap((i) => (i.payments || []).filter((p) => inP(p.at)));
  const sum = (arr, k) => r2(arr.reduce((s, x) => s + (typeof k === "function" ? k(x) : x[k]), 0));
  const byCat = {};
  for (const e of expenses) byCat[e.category] = r2((byCat[e.category] || 0) + e.ht);
  const tvaCollectee = sum(invoices, (i) => i.totals.tva), tvaDeductible = sum(expenses, "tva");
  return {
    from: f, to: t,
    ventes: { nombre: invoices.length, ht: sum(invoices, (i) => i.totals.ht), tva: tvaCollectee, ttc: sum(invoices, (i) => i.totals.ttc) },
    encaisse: sum(payments, "amount"),
    reste_a_encaisser: r2(db.invoices.filter((i) => i.status !== "payée").map(invoiceView).reduce((s, i) => s + i.remaining, 0)),
    depenses: { nombre: expenses.length, ht: sum(expenses, "ht"), tva: tvaDeductible, ttc: sum(expenses, "ttc"), par_categorie: byCat, sans_justificatif: expenses.filter((e) => !e.photo).length },
    tva_a_reverser: r2(tvaCollectee - tvaDeductible),
    resultat_ht: r2(sum(invoices, (i) => i.totals.ht) - sum(expenses, "ht")),
  };
}

// Un seul fichier pour l'expert-comptable : ventes et achats, compatible tableur
export function accountingCsv({ from, to } = {}) {
  const db = load();
  const s = accountingSummary({ from, to });
  const inP = (d) => d && d.slice(0, 10) >= s.from && d.slice(0, 10) <= s.to;
  const rows = [["Type", "Date", "Pièce", "Tiers", "Libellé", "Catégorie", "HT", "TVA", "TTC", "Statut", "Réglée le", "Justificatif"]];
  for (const i of db.invoices.filter((x) => inP(x.createdAt)).map(invoiceView)) rows.push(["Vente", i.createdAt.slice(0, 10), i.number, i.client || "", i.title, STAGES[i.kind], i.totals.ht, i.totals.tva, i.totals.ttc, i.status, i.paidAt?.slice(0, 10) || "", "PDF"]);
  for (const e of (db.expenses || []).filter((x) => inP(x.date))) rows.push(["Achat", e.date, e.id, e.supplier, e.label, e.category, e.ht, e.tva, e.ttc, "payée", e.date, e.photo ? "photo" : "manquant"]);
  const cell = (v) => `"${(typeof v === "number" ? String(v).replace(".", ",") : String(v)).replace(/"/g, '""')}"`;
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\n");
}

export function sendToAccountant({ from, to } = {}) {
  const db = load();
  const s = accountingSummary({ from, to });
  const dest = db.business.accountantEmail;
  if (!dest) return { error: "Ajoutez l'email de votre expert-comptable dans les paramètres." };
  const link = `${BASE_URL()}/api/export/compta.csv?from=${s.from}&to=${s.to}`;
  sendMessage({ to: dest, channel: "email", kind: "dossier comptable", text: `Bonjour, voici le dossier de ${db.business.name} du ${s.from} au ${s.to} : ${s.ventes.nombre} factures (${eur(s.ventes.ht)} HT), ${s.depenses.nombre} dépenses (${eur(s.depenses.ht)} HT), TVA estimée à reverser ${eur(s.tva_a_reverser)}. Fichier (ventes et achats) : ${link}. Justificatifs manquants : ${s.depenses.sans_justificatif}. Cordialement, ${db.business.owner}` });
  return { ok: true, summary: s };
}

// ---------- Tri des mails ----------
export const MAIL_CATEGORIES = ["Urgent", "Demande de devis", "Question client", "Facture fournisseur", "Administratif", "Publicité"];

const MAIL_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    categorie: { type: "string", enum: MAIL_CATEGORIES }, priorite: { type: "string", enum: ["haute", "normale", "basse"] },
    resume: { type: "string", description: "Une phrase" }, reponse: { type: "string", description: "Brouillon de réponse prêt à envoyer, signé par le patron ; vide pour une publicité" },
    montant_ttc: { type: "number", description: "Montant TTC si c'est une facture fournisseur, sinon 0" },
  },
  required: ["categorie", "priorite", "resume", "reponse", "montant_ttc"],
};

export async function classifyMail(mail) {
  const db = load();
  if (aiEnabled()) {
    try {
      const out = await aiJson({
        schema: MAIL_SCHEMA,
        content: [{ type: "text", text: `Tu tries la boîte mail de ${db.business.name} (${db.business.owner}). Infos : ${db.business.extraInfo || ""}. Téléphone : ${db.business.phone}.\nClasse ce mail, résume-le et prépare une réponse courte et polie en français (n'invente ni prix ni date : propose d'appeler ou de prendre rendez-vous sur ${BASE_URL()}/reserver?b=${currentTenantId()} si besoin).\n\nDe : ${mail.fromName} <${mail.from}>\nObjet : ${mail.subject}\n\n${mail.body}` }],
      });
      return { category: out.categorie, priority: out.priorite, summary: out.resume, draft: out.reponse, amount: out.montant_ttc || 0, sortedBy: "ia" };
    } catch (e) {
      console.error("Tri IA impossible, tri simple utilisé :", e.message);
    }
  }
  return classifySimple(mail, db.business);
}

function classifySimple(mail, b) {
  const t = `${mail.subject} ${mail.body}`.toLowerCase();
  const first = (mail.fromName || "").split(" ")[0] || "";
  const sign = `\n\nCordialement,\n${b.owner}\n${b.name} · ${b.phone}`;
  const amount = Number((/(\d[\d\s]*[.,]\d{2})\s?€/.exec(`${mail.subject} ${mail.body}`)?.[1] || "0").replace(/\s/g, "").replace(",", "."));
  if (/urgent|fuite|inond|panne|plus d'eau|plus de chauffage|dégât/.test(t)) return { category: "Urgent", priority: "haute", summary: `Demande urgente de ${mail.fromName}.`, draft: `Bonjour ${first},\n\nNous avons bien reçu votre message. Nous vous rappelons dans l'heure ; en cas d'urgence, appelez directement le ${b.phone}.${sign}`, amount: 0, sortedBy: "simple" };
  if (/facture|échéance|règlement/.test(t) && /fournisseur|commande|livraison|n° client|ht|ttc/.test(t)) return { category: "Facture fournisseur", priority: "normale", summary: `Facture de ${mail.fromName}${amount ? ` (${eur(amount)})` : ""}.`, draft: "", amount, sortedBy: "simple" };
  if (/urssaf|impots|impôts|dgfip|assurance|banque|cotisation|déclaration/.test(t)) return { category: "Administratif", priority: "normale", summary: `Courrier administratif : ${mail.subject}.`, draft: "", amount: 0, sortedBy: "simple" };
  if (/promo|offre spéciale|newsletter|désinscri|-\d+ ?%/.test(t)) return { category: "Publicité", priority: "basse", summary: "Publicité.", draft: "", amount: 0, sortedBy: "simple" };
  if (/devis|tarif|prix|combien|estimation|travaux/.test(t)) return { category: "Demande de devis", priority: "normale", summary: `${mail.fromName} demande un devis : ${mail.subject}.`, draft: `Bonjour ${first},\n\nMerci pour votre demande. Pour vous faire un devis précis, nous pouvons passer voir sur place : choisissez un créneau ici ${BASE_URL()}/reserver?b=${currentTenantId()} ou appelez-nous au ${b.phone}.${sign}`, amount: 0, sortedBy: "simple" };
  return { category: "Question client", priority: "normale", summary: `Question de ${mail.fromName} : ${mail.subject}.`, draft: `Bonjour ${first},\n\nMerci pour votre message, nous revenons vers vous rapidement. Vous pouvez aussi nous joindre au ${b.phone}.${sign}`, amount: 0, sortedBy: "simple" };
}

export async function receiveMail({ from, fromName, subject, body }) {
  const db = load();
  const mail = { id: uid("mail"), from: from || "", fromName: fromName || from || "", subject: subject || "(sans objet)", body: body || "", at: new Date().toISOString(), status: "à traiter" };
  Object.assign(mail, await classifyMail(mail));
  (db.mails ||= []).unshift(mail);
  save();
  if (mail.category === "Urgent") notifyOwner(`🚨 Mail urgent de ${mail.fromName} : ${mail.summary}`);
  return { ok: true, mail };
}

export function replyMail(id, text) {
  const db = load();
  const mail = (db.mails || []).find((x) => x.id === id);
  if (!mail) return { error: "Mail introuvable" };
  sendMessage({ to: mail.from, channel: "email", kind: "réponse mail", text: text || mail.draft });
  mail.status = "répondu"; mail.repliedAt = new Date().toISOString();
  save();
  return { ok: true };
}

export function mailToExpense(id) {
  const db = load();
  const mail = (db.mails || []).find((x) => x.id === id);
  if (!mail) return { error: "Mail introuvable" };
  const r = addExpense({ supplier: mail.fromName, label: mail.subject, category: "Matériaux et fournitures", ttc: mail.amount || 0, source: "mail" });
  mail.status = "rangé"; mail.expenseId = r.expense.id;
  save();
  return r;
}

export function setMailStatus(id, status) {
  const mail = (load().mails || []).find((x) => x.id === id);
  if (!mail) return { error: "Mail introuvable" };
  mail.status = status;
  save();
  return { ok: true };
}

// ---------- Espace client ----------
export function photoPhase(p) {
  if (p.status === "terminé") return "après";
  const firstUndone = p.steps.findIndex((s) => !s.done);
  const works = p.steps.findIndex((s) => /travaux|réparation|préparation|réalisation/i.test(s.label));
  if (works >= 0) return firstUndone >= 0 && firstUndone < works ? "avant" : "pendant";
  return firstUndone <= 0 ? "avant" : "pendant";
}

export function nextVisit(p) {
  const now = localISO(new Date());
  return (p.visits || []).filter((v) => v.start >= now).sort((a, b) => a.start.localeCompare(b.start))[0] || null;
}

export function addVisit(projectId, { start, label, staff }) {
  const db = load();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return { error: "Chantier introuvable" };
  const v = { id: uid("vis"), start: String(start).slice(0, 16), label: label || "Passage sur le chantier", staff: staff || p.staff, answer: null };
  (p.visits ||= []).push(v);
  save();
  sendMessage({ clientId: p.clientId, channel: "sms", kind: "prochain passage", text: `${db.business.name} : prochain passage ${fmtDate(v.start)} (${v.label}). Dites-nous si vous serez là : ${BASE_URL()}/chantier/${p.id}` });
  return { ok: true, visit: v };
}

export function answerVisit(projectId, visitId, present) {
  const p = load().projects.find((x) => x.id === projectId);
  const v = p?.visits?.find((x) => x.id === visitId);
  if (!v) return { error: "Passage introuvable" };
  v.answer = present ? "présent" : "absent";
  v.answeredAt = new Date().toISOString();
  save();
  const name = findClient(p.clientId)?.name || "Le client";
  notifyOwner(present ? `✅ ${name} sera là ${fmtDate(v.start)} (${v.label}).` : `❌ ${name} ne sera pas là ${fmtDate(v.start)} (${v.label}). À rappeler pour décaler.`);
  return { ok: true, visit: v };
}

export function portal(projectId) {
  const db = load();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p || !allows(db.business, "chantiers")) return null;
  const base = publicProject(projectId);
  const quote = p.quoteId ? db.quotes.find((q) => q.id === p.quoteId) : null;
  const invoices = db.invoices.filter((i) => (quote ? i.quoteId === quote.id : i.clientId === p.clientId)).map(invoiceView);
  const total = quote ? quoteTotals(quote).ttc : r2(invoices.reduce((s, i) => s + i.totals.ttc, 0));
  const paid = r2(invoices.reduce((s, i) => s + i.paid, 0));
  return {
    ...base,
    id: p.id,
    photos: p.journal.filter((j) => j.sharedWithClient && j.photo).map((j) => ({ id: j.id, src: j.photo, text: j.text, at: j.at, phase: j.phase || "pendant", author: j.author })),
    nextVisit: nextVisit(p),
    quote: quote ? { id: quote.id, number: quote.number, title: quote.title, status: quote.status, signedAt: quote.signedAt, totals: quoteTotals(quote), link: `${BASE_URL()}/q/${quote.id}` } : null,
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, kind: STAGES[i.kind], title: i.title, ttc: i.totals.ttc, paid: i.paid, remaining: i.remaining, status: i.status, dueDate: i.dueDate, link: i.link })),
    money: { total, paid, remaining: r2(Math.max(0, total - paid)) },
    messages: (p.messages || []).slice(-50),
    aiPaused: Boolean(p.aiPaused),
    docLabel: docLabel(),
  };
}

// Le client écrit depuis son espace : Prava répond tout de suite, sauf si l'artisan a pris le relais
export async function clientMessage(projectId, text) {
  const db = load();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return { error: "Chantier introuvable" };
  const c = findClient(p.clientId);
  const msg = { id: uid("pm"), from: "client", text: String(text).slice(0, 2000), at: new Date().toISOString() };
  (p.messages ||= []).push(msg);
  save();
  if (p.aiPaused) {
    notifyOwner(`💬 ${c?.name || "Client"} vous écrit (espace client, « ${p.title} ») : ${msg.text}`);
    return { ok: true, messages: p.messages.slice(-50) };
  }
  let reply = null;
  if (aiEnabled()) {
    try {
      const out = await chat({ conversationId: "esp_" + p.id, mode: "accueil", channel: "espace client", text: `[Message écrit dans l'espace client par ${c?.name}, tél. ${c?.phone}, à propos du ${projectLabel().toLowerCase()} « ${p.title} ». Réponds-lui directement et brièvement.]\n${msg.text}` });
      reply = out.reply;
    } catch (e) {
      console.error("Réponse IA impossible :", e.message);
    }
  }
  if (!reply) reply = simpleAnswer(p, msg.text);
  p.messages.push({ id: uid("pm"), from: "ia", text: reply, at: new Date().toISOString() });
  save();
  return { ok: true, messages: p.messages.slice(-50) };
}

// Réponses sans IA : avancement, prochain passage, paiement ; sinon le message part chez l'artisan
function simpleAnswer(p, text) {
  const db = load();
  const t = text.toLowerCase();
  const v = projectView(p);
  const nv = nextVisit(p);
  if (/avance|où en|fini|termin|quand|date|étape/.test(t)) return `Votre ${projectLabel().toLowerCase()} est à ${v.progress} %.${v.nextStep ? ` Prochaine étape : ${v.nextStep}.` : ""}${p.endDate ? ` Fin prévue le ${new Date(p.endDate).toLocaleDateString("fr-FR")}.` : ""}${nv ? ` Prochain passage ${fmtDate(nv.start)}.` : ""}`;
  if (/pay|factur|régl|acompte|virement|carte|combien/.test(t)) {
    const due = db.invoices.filter((i) => i.quoteId === p.quoteId && i.status !== "payée").map(invoiceView);
    return due.length ? `Il reste ${eur(due.reduce((s, i) => s + i.remaining, 0))} à régler (${due.map((i) => i.number).join(", ")}). Vous pouvez payer par carte dans l'onglet « Factures ».` : "Tout est réglé pour le moment, merci !";
  }
  notifyOwner(`💬 ${findClient(p.clientId)?.name || "Client"} vous écrit (espace client, « ${p.title} ») : ${text}`);
  return `Merci pour votre message. Je le transmets à ${db.business.owner}, qui vous répond ici au plus vite.`;
}

export function artisanMessage(projectId, text) {
  const db = load();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return { error: "Chantier introuvable" };
  (p.messages ||= []).push({ id: uid("pm"), from: "artisan", author: db.business.owner, text: String(text).slice(0, 2000), at: new Date().toISOString() });
  p.aiPaused = true;
  save();
  sendMessage({ clientId: p.clientId, channel: "sms", kind: "message artisan", text: `${db.business.name} : ${db.business.owner} vous a répondu dans votre espace client : ${BASE_URL()}/chantier/${p.id}` });
  return { ok: true };
}

export function setAiPaused(projectId, paused) {
  const p = load().projects.find((x) => x.id === projectId);
  if (!p) return { error: "Chantier introuvable" };
  p.aiPaused = Boolean(paused);
  save();
  return { ok: true };
}
