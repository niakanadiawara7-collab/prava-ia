// Stockage JSON très simple (un fichier). Suffit pour un prototype ;
// à remplacer par PostgreSQL (hébergé en Europe) pour la production.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { SECTORS } from "./sectors.js";
import { DEMOS } from "./demos.js";

import { AsyncLocalStorage } from "node:async_hooks";

// Multi-comptes : chaque entreprise a sa propre base (data/tenants/<id>.json).
// Le compte courant est porté par la requête (AsyncLocalStorage), donc load() renvoie
// toujours la base de l'entreprise connectée, sans rien changer au reste du code.
export const DATA_DIR = process.env.PRAVA_DATA || path.join(process.cwd(), "data");
const TENANT_DIR = path.join(DATA_DIR, "tenants");
const ctx = new AsyncLocalStorage();
const tenants = new Map();

// Identifiants non devinables (ils servent aussi dans les liens envoyés aux clients)
export function uid(prefix) {
  return prefix + "_" + Date.now().toString(36) + crypto.randomBytes(6).toString("hex");
}

export function nextNumber(kind) {
  const db = load();
  const year = new Date().getFullYear();
  db.counters[kind] = (db.counters[kind] || 0) + 1;
  const prefix = kind === "quote" ? "D" : "F";
  return `${prefix}-${year}-${String(db.counters[kind]).padStart(4, "0")}`;
}

export function applySector(sectorId) {
  const db = load();
  const s = SECTORS[sectorId] || SECTORS.autre;
  db.business.sector = sectorId;
  db.business.tva = s.tva;
  db.services = s.services.map((x) => ({ ...x }));
  db.staff = s.staff.map((x) => ({ id: uid("stf"), ...x }));
  db.hours = JSON.parse(JSON.stringify(s.hours));
}

function seed(profileId) {
  const P = DEMOS[profileId] || DEMOS.dupont;
  const db = {
    business: {
      name: "", sector: P.sector, owner: "", phone: "", ownerPhone: "", email: "", address: "", siret: "",
      tva: 10,
      depositPercent: 30,
      intermediatePercent: 40,
      plan: "complet",
      answerMode: "toujours",
      forwardNumber: "",
      accountantEmail: "cabinet.martin@expert-comptable.example.fr",
      reviewUrl: "https://g.page/r/votre-fiche-google/review",
      languages: "français, anglais, espagnol, arabe",
      extraInfo: "",
      demoProfile: DEMOS[profileId] ? profileId : "dupont",
      hourlyCost: 38, hourlyRate: 55,
      rge: null, suppliers: [], defaultSupplier: "",
      einvoice: { platform: "Plateforme agréée partenaire", auto: true },
      iban: "FR76 3000 4000 0500 0012 3456 789",
    },
    services: [], staff: [], hours: {},
    clients: [], appointments: [], quotes: [], invoices: [], calls: [], outbox: [], projects: [], expenses: [], mails: [], purchaseOrders: [], einbox: [],
    conversations: {}, counters: {},
  };
  tenants.set(currentId(), db);
  applySector(P.sector);
  Object.assign(db.business, P.business);
  if (P.services) db.services = P.services.map((x) => ({ ...x }));
  if (P.extraServices) db.services.push(...P.extraServices.map((x) => ({ ...x })));
  if (P.suppliers) { db.business.suppliers = P.suppliers.map((x) => ({ ...x })); db.business.defaultSupplier = P.suppliers[0].name; }
  if (P.rge) db.business.rge = { ...P.rge };
  if (P.staff) db.staff = P.staff.map((x) => ({ id: uid("stf"), ...x }));
  if (P.listing) db.business.listing = { visible: true, ...P.listing };
  // Ligne de devis : [libellé, quantité, unité, prix HT, coût d'achat unitaire, heures unitaires, fournisseur, code catalogue]
  const lines = (ls) => ls.map(([label, qty, unit, unitPrice, cost, hours, supplier, code]) => ({ label, qty, unit, unitPrice, ...(cost != null ? { cost } : {}), ...(hours != null ? { hours } : {}), ...(supplier ? { supplier } : {}), ...(code ? { code } : {}) }));
  // Quelques données de démonstration
  const C = P.clients.map(({ age, civ, ...c }) => ({ id: uid("cli"), ...c, createdAt: daysAgo(age) }));
  db.clients.push(C[0], C[1]);
  db.quotes.push({ id: uid("quo"), number: nextNumber("quote"), clientId: C[P.quoteSent.client].id, title: P.quoteSent.title, lines: lines(P.quoteSent.lines), tva: 10, status: "envoyé", createdAt: daysAgo(4), followups: [] });
  const t = new Date(); t.setDate(t.getDate() + 1); while ([0, 6].includes(t.getDay())) t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0);
  const ac = C[P.appointment.client];
  db.appointments.push({ id: uid("apt"), clientId: ac.id, title: P.appointment.title, start: localISO(t), duration: P.appointment.duration, staff: P.appointment.staff, address: ac.address, status: "confirmé", reminders: [] });
  db.calls.push({ id: uid("cal"), clientId: C[P.call.client].id, channel: "téléphone", summary: P.call.summary, urgency: "normale", missed: false, at: daysAgo(1) });
  // Un chantier en cours, relié à un devis signé avec acompte payé
  const PR = P.project, pc = C[PR.client];
  const qb = {
    id: uid("quo"), number: nextNumber("quote"), clientId: pc.id, title: PR.title, lines: lines(PR.lines),
    tva: 10, status: "signé", createdAt: daysAgo(20), signedAt: daysAgo(18), signedBy: pc.name, followups: [], depositPaid: 0,
  };
  db.quotes.push(qb);
  const ht = qb.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const acompte = round(ht * 0.3);
  db.invoices.push({ id: uid("inv"), number: nextNumber("invoice"), kind: "acompte", quoteId: qb.id, clientId: pc.id, title: `Acompte · ${PR.title}`, lines: [{ label: `Acompte de 30 % sur le devis ${qb.number} (« ${PR.title} »)`, qty: 1, unit: "forfait", unitPrice: acompte }], tva: 10, depositPaid: 0, payments: [{ amount: round(acompte * 1.1), at: daysAgo(17), method: "carte bancaire" }], status: "payée", paidAt: daysAgo(17), createdAt: daysAgo(18), dueDate: daysAgo(11).slice(0, 10), followups: [] });
  qb.depositPaid = round(acompte * 1.1);
  const next = new Date(); next.setDate(next.getDate() + 1); while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1); next.setHours(8, 30, 0, 0);
  const civ = P.clients[PR.client].civ || pc.name;
  db.projects.push({
    id: uid("prj"), clientId: pc.id, quoteId: qb.id, title: PR.title, address: pc.address, staff: PR.staff,
    startDate: daysAgo(6).slice(0, 10), endDate: new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10), status: "en cours", notifyClient: true,
    steps: PR.steps.map((label, i) => ({ label, done: i < 4, doneAt: i < 4 ? daysAgo(12 - i * 2) : null })),
    journal: PR.journal.map(([d, text, ph, phase, shared], i) => ({ id: uid("jrn"), at: daysAgo(d), author: PR.staff, text, photo: ph ? demoPhoto(ph[0], ph[1], i) : null, phase, sharedWithClient: shared })),
    visits: [{ id: uid("vis"), start: localISO(next), label: PR.visit, staff: PR.staff, answer: null }],
    messages: [
      { id: uid("pm"), from: "client", text: PR.question, at: daysAgo(2) },
      { id: uid("pm"), from: "ia", text: PR.answer.replace("{civ}", civ).replace("{date}", new Date(daysAgo(8)).toLocaleDateString("fr-FR")), at: daysAgo(2) },
    ],
    aiPaused: false,
    createdAt: daysAgo(14),
  });
  qb.projectId = db.projects[0].id;
  const prj = db.projects[0];
  // Heures pointées sur le chantier (pour la marge réelle)
  prj.timeEntries = (PR.time || [[6, 7], [5, 8], [4, 7.5], [1, 6]]).map(([d, h], i) => ({ id: uid("tim"), date: daysAgo(d).slice(0, 10), staff: PR.staff, hours: h, note: i === 0 ? "Démarrage" : "" }));
  // Une facture impayée, pour montrer les relances
  const uc = C[P.unpaid.client];
  if (!db.clients.includes(uc)) db.clients.push(uc);
  db.invoices.push({ id: uid("inv"), number: nextNumber("invoice"), kind: "facture", quoteId: null, clientId: uc.id, title: P.unpaid.title, lines: lines(P.unpaid.lines), tva: 10, depositPaid: 0, payments: [], status: "à payer", createdAt: daysAgo(35), dueDate: daysAgo(5).slice(0, 10), followups: ["J-2", "R0"] });
  for (const c of C) if (!db.clients.includes(c)) db.clients.push(c);
  // Dépenses du mois (pour la compta)
  const e = (d, supplier, label, category, ttc, shop) => { const tvaRate = 20; const h = round(ttc / (1 + tvaRate / 100)); const photo = shop ? demoReceipt(shop, ttc.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\u202f/g, " ")) : null; return { id: uid("exp"), date: daysAgo(d).slice(0, 10), supplier, label, category, ttc, ht: h, tva: round(ttc - h), tvaRate, photo, source: photo ? "photo" : "manuel", createdAt: daysAgo(d) }; };
  db.expenses.push(...P.expenses.map((x) => e(...x)));
  // Les deux premiers achats sont le matériel du chantier en cours
  db.expenses.slice(0, 2).forEach((x) => (x.projectId = prj.id));
  // Une commande fournisseur envoyée, pas encore livrée
  if (PR.order) {
    db.counters.po = 1;
    db.purchaseOrders.push({ id: uid("po"), number: `BC-${new Date().getFullYear()}-0001`, projectId: prj.id, supplier: PR.order.supplier, email: P.suppliers?.find((s) => s.name === PR.order.supplier)?.email || "", lines: PR.order.lines.map(([label, qty, unit, unitCost]) => ({ label, qty, unit, unitCost })), deliveryDate: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), deliveryAddress: prj.address, note: "", status: "confirmée", createdAt: daysAgo(2) });
  }
  // Un devis de rénovation énergétique avec les aides calculées
  if (P.aidQuote) {
    const A = P.aidQuote;
    db.quotes.push({ id: uid("quo"), number: nextNumber("quote"), clientId: C[A.client].id, title: A.title, lines: lines(A.lines), tva: 5.5, aidProfile: { ...A.profile }, status: "envoyé", createdAt: daysAgo(1), followups: [], notes: "Montant des aides indicatif, sous réserve d'acceptation du dossier MaPrimeRénov' (à déposer avant le début des travaux)." });
  }
  // Un client professionnel (syndic) : facture électronique obligatoire
  const pro = { id: uid("cli"), name: "Syndic Gestimmo", company: "Gestimmo SAS", type: "pro", siren: "412 345 678", phone: "01 43 56 78 90", email: "travaux@gestimmo.example.fr", address: "40 rue de la Roquette, 75011 Paris", notes: "Syndic de copropriété, 12 immeubles dans le secteur", createdAt: daysAgo(200) };
  db.clients.push(pro);
  const rate = db.business.hourlyRate || 55;
  db.invoices.push({ id: uid("inv"), number: nextNumber("invoice"), kind: "facture", quoteId: null, clientId: pro.id, title: "Intervention dans les parties communes", lines: lines([["Intervention dans les parties communes (main d'œuvre)", 3, "h", rate], ["Fournitures", 1, "forfait", 140]]), tva: 10, depositPaid: 0, payments: [{ amount: round((3 * rate + 140) * 1.1), at: daysAgo(3), method: "virement" }], status: "payée", paidAt: daysAgo(3), createdAt: daysAgo(12), dueDate: daysAgo(-18).slice(0, 10), followups: [] });
  // Factures déjà transmises par la plateforme agréée (statuts réalistes)
  const ev = (st, d, note = "") => ({ status: st, at: daysAgo(d), note });
  for (const inv of db.invoices) {
    const b2b = inv.clientId === pro.id;
    const age = Math.round((Date.now() - new Date(inv.createdAt).getTime()) / 864e5);
    const events = b2b ? [ev("déposée", age, "Factur-X généré et contrôlé"), ev("émise", age, "Transmise à la plateforme du client (SIREN 412345678)"), ev("reçue", age, "Reçue par la plateforme du client"), ev("mise à disposition", age - 1, "Le client a ouvert la facture"), ev("approuvée", age - 2, "Facture approuvée par le client")] : [ev("déposée", age, "Factur-X généré et contrôlé"), ev("émise", age, "Données de vente transmises à l'administration (e-reporting, client particulier)")];
    if (inv.status === "payée") events.push(ev("encaissée", 3, "Statut d'encaissement transmis"));
    inv.einvoice = { flow: b2b ? "e-invoicing" : "e-reporting", format: "Factur-X (EN 16931)", platform: db.business.einvoice.platform, events, status: events.at(-1).status, simulated: true };
  }
  // Factures fournisseurs reçues par la plateforme (réception obligatoire depuis le 1er septembre 2026)
  for (const [i, f] of (P.einbox || []).entries()) {
    const ht = f.ht;
    db.einbox.push({ id: uid("ein"), supplier: f.supplier, supplierSiren: f.siren, number: f.number, date: daysAgo(f.age).slice(0, 10), label: f.label, ht, ttc: round(ht * 1.2), tvaRate: 20, category: "Matériaux et fournitures", receivedAt: daysAgo(f.age), status: "à valider", platform: db.business.einvoice.platform, projectId: i === 0 ? prj.id : null });
  }
  // Mails reçus, déjà triés
  db.mails.push(...P.mails(db.business).map(([from, fromName, subject, body, h, category, priority, summary, draft, amount]) => ({ id: uid("mail"), from, fromName, subject, body, at: hoursAgo(h), status: "à traiter", category, priority, summary, draft, amount, sortedBy: "ia" })));
  db.calls.push({ id: uid("cal"), clientId: null, phone: P.missedPhone, channel: "téléphone", summary: "Appel manqué", urgency: "inconnue", missed: true, at: new Date(Date.now() - 3600e3).toISOString(), smsSent: false });
}

// Les heures de rendez-vous sont stockées en heure locale (Europe/Paris), format AAAA-MM-JJTHH:MM
export function localISO(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hoursAgo(n) {
  return new Date(Date.now() - n * 3600e3).toISOString();
}

// Photos et tickets de démonstration (dessins SVG), pour que la galerie et la compta ne soient pas vides
export function demoPhoto(color, label, seed = 0) {
  const lines = [];
  for (let x = 0; x <= 400; x += 50) lines.push(`<path d="M${x} 0V200"/>`);
  for (let y = 0; y <= 200; y += 40) lines.push(`<path d="M0 ${y}H400"/>`);
  for (let i = -6; i <= 16; i++) lines.push(`<path d="M${200 + i * 30} 200L${200 + i * 90} 400"/>`);
  for (const y of [225, 260, 305, 360]) lines.push(`<path d="M0 ${y}H400"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e4dc"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="#22252a"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><g stroke="rgba(255,255,255,.35)" stroke-width="2">${lines.join("")}</g><rect x="${240 + seed * 10}" y="40" width="110" height="160" fill="rgba(255,255,255,.18)"/><rect y="352" width="400" height="48" fill="rgba(0,0,0,.55)"/><text x="14" y="386" font-family="sans-serif" font-weight="bold" font-size="26" fill="#fff">${label}</text></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function demoReceipt(shop, total) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 360"><rect width="240" height="360" fill="#fbfaf6"/><text x="120" y="44" text-anchor="middle" font-family="monospace" font-weight="bold" font-size="22" fill="#222">${shop}</text><g fill="#999">${[80, 104, 128, 152, 176, 200].map((y, i) => `<rect x="24" y="${y}" width="${120 + (i * 37) % 60}" height="8"/><rect x="186" y="${y}" width="30" height="8"/>`).join("")}</g><path d="M24 236H216" stroke="#222" stroke-dasharray="4 4"/><text x="24" y="268" font-family="monospace" font-size="16" fill="#222">TOTAL TTC</text><text x="216" y="268" text-anchor="end" font-family="monospace" font-weight="bold" font-size="16" fill="#222">${total}</text></svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

function daysAgo(n) {
  return new Date(Date.now() - n * 864e5).toISOString();
}

function currentId() {
  const id = ctx.getStore()?.tenantId;
  if (!id) throw new Error("Aucun compte sélectionné");
  return id;
}

const tenantFile = (id) => path.join(TENANT_DIR, id.replace(/[^\w-]/g, "") + ".json");

function migrate(db) {
  db.projects ||= []; db.expenses ||= []; db.mails ||= []; db.purchaseOrders ||= []; db.einbox ||= []; db.outbox ||= []; db.calls ||= [];
  db.business.hourlyCost ??= 38; db.business.hourlyRate ??= 55; db.business.einvoice ||= { platform: "", auto: false }; db.business.suppliers ||= [];
  db.business.plan ||= "complet"; db.business.answerMode ||= "toujours"; db.business.intermediatePercent ??= 40;
  return db;
}

function readTenant(id) {
  if (tenants.has(id)) return tenants.get(id);
  const f = tenantFile(id);
  if (!fs.existsSync(f)) return null;
  const db = migrate(JSON.parse(fs.readFileSync(f, "utf8")));
  tenants.set(id, db);
  return db;
}

export function listTenantIds() {
  if (!fs.existsSync(TENANT_DIR)) return [];
  return fs.readdirSync(TENANT_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
}

// Exécute fn avec la base de l'entreprise `id` comme base courante
export function withTenant(id, fn) {
  return ctx.run({ tenantId: id }, fn);
}
export const currentTenantId = () => ctx.getStore()?.tenantId || null;
export const tenantExists = (id) => Boolean(id && readTenant(id));

// Retrouve l'entreprise qui possède un devis, une facture, un chantier… (liens envoyés aux clients)
export function findTenantOf(collection, objectId) {
  for (const id of listTenantIds()) {
    const db = readTenant(id);
    if ((db?.[collection] || []).some((x) => x.id === objectId)) return id;
  }
  return null;
}
export function findTenantWhere(pred) {
  for (const id of listTenantIds()) { const db = readTenant(id); if (db && pred(db)) return id; }
  return null;
}

export function load() {
  const id = currentId();
  const db = readTenant(id);
  if (!db) throw new Error("Compte introuvable");
  return db;
}

const timers = new Map();
export function save() {
  const id = currentTenantId();
  if (!id) return;
  const db = tenants.get(id);
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => writeTenant(id, db), 50));
}
function writeTenant(id, db) {
  timers.delete(id);
  fs.mkdirSync(TENANT_DIR, { recursive: true });
  const f = tenantFile(id), tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, f); // écriture atomique : jamais de fichier à moitié écrit
}
export function flushAll() {
  for (const [id] of timers) { clearTimeout(timers.get(id)); writeTenant(id, tenants.get(id)); }
}

// Nouvelle entreprise : base vide (vraies données) ou remplie avec une démo
export function createTenant(id, { sector = "btp", demo = null, business = {} } = {}) {
  withTenant(id, () => {
    if (demo) seed(demo);
    else blank(sector);
    Object.assign(load().business, business);
    writeTenant(id, load());
  });
  return id;
}

function blank(sector) {
  const db = {
    business: {
      name: "", sector, owner: "", phone: "", ownerPhone: "", email: "", address: "", siret: "", tvaNumber: "",
      tva: 10, depositPercent: 30, intermediatePercent: 40, plan: "complet", answerMode: "toujours", forwardNumber: "",
      accountantEmail: "", reviewUrl: "", languages: "français, anglais", extraInfo: "", demoProfile: null,
      hourlyCost: 38, hourlyRate: 55, rge: null, suppliers: [], defaultSupplier: "",
      einvoice: { platform: "", auto: false }, iban: "", paymentTerms: 30, legalForm: "", insurance: "",
      onboarded: false,
    },
    services: [], staff: [], hours: {},
    clients: [], appointments: [], quotes: [], invoices: [], calls: [], outbox: [], projects: [], expenses: [], mails: [], purchaseOrders: [], einbox: [],
    conversations: {}, counters: {},
  };
  tenants.set(currentId(), db);
  applySector(sector);
}

export function reset(profileId) {
  const keep = { ...load().business };
  if (profileId === "vide") blank(keep.sector || "btp");
  else seed(profileId || keep.demoProfile);
  // On garde l'identité de l'entreprise si le compte n'est pas un compte de démo
  if (profileId === "vide") Object.assign(load().business, pickKeep(keep));
  save();
  return load();
}
const pickKeep = (b) => Object.fromEntries(["name", "owner", "phone", "ownerPhone", "email", "address", "siret", "tvaNumber", "iban", "legalForm", "insurance", "plan"].map((k) => [k, b[k]]));

export function findClient(id) {
  return load().clients.find((c) => c.id === id);
}

export function quoteTotals(q) {
  const ht = q.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unitPrice), 0);
  const tva = (ht * Number(q.tva || 0)) / 100;
  return { ht: round(ht), tva: round(tva), ttc: round(ht + tva) };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
