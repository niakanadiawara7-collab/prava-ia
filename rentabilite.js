// Rentabilité des chantiers (marge prévue / réelle) et commandes aux fournisseurs générées depuis le devis.
import PDFDocument from "pdfkit";
import { load, save, uid, findClient, quoteTotals, localISO } from "./db.js";
import { sendMessage, notifyOwner, completeStep, addJournal } from "./ops.js";

const r2 = (n) => Math.round(n * 100) / 100;
const BASE_URL = () => process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

// Coût d'achat et heures d'une ligne : renseignés sur la ligne, sinon dans le catalogue, sinon estimés
export function lineCost(line) {
  const db = load();
  const svc = db.services.find((s) => (line.code && s.code === line.code) || s.label === line.label);
  const price = Number(line.unitPrice) || 0;
  const rate = Number(db.business.hourlyRate) || 55;
  if (line.cost != null || line.hours != null) return { cost: Number(line.cost) || 0, hours: Number(line.hours) || 0, supplier: line.supplier || svc?.supplier || "", estimated: false };
  if (svc && (svc.cost != null || svc.hours != null)) return { cost: Number(svc.cost) || 0, hours: Number(svc.hours) || 0, supplier: svc.supplier || "", estimated: false };
  // Pas d'information : 35 % de matériaux et 35 % de main d'œuvre (estimation)
  return { cost: r2(price * 0.35), hours: r2((price * 0.35) / rate), supplier: "", estimated: true };
}

export function projectMargin(p) {
  const db = load();
  const q = p.quoteId ? db.quotes.find((x) => x.id === p.quoteId) : null;
  const hourly = Number(db.business.hourlyCost) || 38;
  const caHt = q ? quoteTotals(q).ht : 0;
  let plannedMat = 0, plannedHours = 0, estimated = false;
  for (const l of q?.lines || []) { const c = lineCost(l); plannedMat += c.cost * l.qty; plannedHours += c.hours * l.qty; estimated ||= c.estimated; }
  const expenses = (db.expenses || []).filter((e) => e.projectId === p.id);
  const realMat = expenses.reduce((s, e) => s + Number(e.ht || 0), 0);
  const realHours = (p.timeEntries || []).reduce((s, t) => s + Number(t.hours || 0), 0);
  const pending = (db.purchaseOrders || []).filter((o) => o.projectId === p.id && o.status !== "livrée" && o.status !== "annulée").reduce((s, o) => s + poTotal(o), 0);
  const invoicedHt = db.invoices.filter((i) => q && i.quoteId === q.id).reduce((s, i) => s + quoteTotals(i).ht, 0);
  const plannedCost = plannedMat + plannedHours * hourly;
  const progress = p.steps.length ? p.steps.filter((x) => x.done).length / p.steps.length : 0;
  // Réel à date + ce qui reste prévu (commandes en cours, heures restantes) = projection de fin de chantier
  const projectedMat = realMat + pending + (p.status === "terminé" ? 0 : Math.max(0, plannedMat - realMat - pending));
  const projectedHours = p.status === "terminé" ? realHours : realHours + plannedHours * (1 - progress);
  const realCost = realMat + realHours * hourly;
  const projectedCost = projectedMat + projectedHours * hourly;
  const m = (cost) => ({ amount: r2(caHt - cost), percent: caHt ? Math.round(((caHt - cost) / caHt) * 100) : 0 });
  const alerts = [];
  if (realMat > plannedMat * 1.1 && plannedMat) alerts.push(`Achats au-dessus du prévu (+${Math.round((realMat / plannedMat - 1) * 100)} %)`);
  if (realHours > plannedHours * 1.1 && plannedHours) alerts.push(`Heures au-dessus du prévu (+${Math.round((realHours / plannedHours - 1) * 100)} %)`);
  if (projectedCost > plannedCost * 1.1 && plannedCost) alerts.push("La marge finale risque d'être plus faible que prévu");
  return {
    caHt: r2(caHt), invoicedHt: r2(invoicedHt), hourlyCost: hourly, estimated,
    planned: { materials: r2(plannedMat), hours: r2(plannedHours), cost: r2(plannedCost), margin: m(plannedCost) },
    real: { materials: r2(realMat), hours: r2(realHours), cost: r2(realCost), pendingOrders: r2(pending), expenses: expenses.map((e) => ({ id: e.id, date: e.date, supplier: e.supplier, label: e.label, ht: e.ht })) },
    projected: { materials: r2(projectedMat), hours: r2(projectedHours), cost: r2(projectedCost), margin: m(projectedCost) },
    progress: Math.round(progress * 100), alerts,
  };
}

export function marginOverview() {
  const db = load();
  return db.projects.map((p) => ({ id: p.id, title: p.title, client: findClient(p.clientId)?.name, status: p.status, ...projectMargin(p) }));
}

export function addTime(projectId, { staff, hours, date, note }) {
  const db = load();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return { error: "Chantier introuvable" };
  const h = Number(String(hours).replace(",", "."));
  if (!(h > 0)) return { error: "Nombre d'heures invalide" };
  (p.timeEntries ||= []).push({ id: uid("tim"), date: date || localISO(new Date()).slice(0, 10), staff: staff || p.staff, hours: h, note: note || "" });
  save();
  return { ok: true, margin: projectMargin(p) };
}

export function linkExpense(expenseId, projectId) {
  const e = (load().expenses || []).find((x) => x.id === expenseId);
  if (!e) return { error: "Dépense introuvable" };
  e.projectId = projectId || null;
  save();
  return { ok: true };
}

// ---------- Commandes fournisseurs ----------
export function poTotal(o) {
  return r2(o.lines.reduce((s, l) => s + l.qty * l.unitCost, 0));
}

function nextPo() {
  const db = load();
  db.counters.po = (db.counters.po || 0) + 1;
  return `BC-${new Date().getFullYear()}-${String(db.counters.po).padStart(4, "0")}`;
}

// Liste du matériel à commander pour un chantier, regroupée par fournisseur
export function materialsFor(projectId) {
  const db = load();
  const p = db.projects.find((x) => x.id === projectId);
  const q = p?.quoteId && db.quotes.find((x) => x.id === p.quoteId);
  if (!q) return { error: "Ce chantier n'est pas relié à un devis" };
  const def = db.business.defaultSupplier || db.business.suppliers?.[0]?.name || "Fournisseur";
  const groups = {};
  for (const l of q.lines) {
    const c = lineCost(l);
    if (!(c.cost > 0)) continue;
    const sup = c.supplier || def;
    (groups[sup] ||= []).push({ label: `Fournitures pour : ${l.label}`, qty: l.qty, unit: l.unit, unitCost: c.cost, estimated: c.estimated });
  }
  const ordered = (db.purchaseOrders || []).filter((o) => o.projectId === projectId && o.status !== "annulée");
  return { projectId, groups: Object.entries(groups).map(([supplier, lines]) => ({ supplier, email: supplierEmail(supplier), lines, total: r2(lines.reduce((s, l) => s + l.qty * l.unitCost, 0)), alreadyOrdered: ordered.some((o) => o.supplier === supplier) })) };
}

function supplierEmail(name) {
  const s = (load().business.suppliers || []).find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  return s?.email || `commandes@${String(name).toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "")}.example.fr`;
}

export function createPurchaseOrder({ projectId, supplier, lines, deliveryDate, note }) {
  const db = load();
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) return { error: "Chantier introuvable" };
  if (!lines?.length) {
    const g = materialsFor(projectId).groups?.find((x) => x.supplier === supplier);
    lines = g?.lines || [];
  }
  if (!lines.length) return { error: "Aucune ligne à commander" };
  const o = {
    id: uid("po"), number: nextPo(), projectId, supplier, email: supplierEmail(supplier), lines: lines.map((l) => ({ label: l.label, qty: Number(l.qty), unit: l.unit || "u", unitCost: Number(l.unitCost) })),
    deliveryDate: deliveryDate || localISO(new Date(Date.now() + 3 * 864e5)).slice(0, 10), deliveryAddress: p.address, note: note || "", status: "envoyée", createdAt: new Date().toISOString(),
  };
  (db.purchaseOrders ||= []).push(o);
  save();
  sendMessage({ to: o.email, channel: "email", kind: "bon de commande", text: `${db.business.name} : bon de commande ${o.number} (${o.lines.length} ligne(s), ${poTotal(o).toFixed(2)} € HT), livraison souhaitée le ${new Date(o.deliveryDate).toLocaleDateString("fr-FR")} au ${o.deliveryAddress}. Référence chantier : ${p.title}. PDF : ${BASE_URL()}/api/purchase-orders/${o.id}/pdf` });
  return { ok: true, order: { ...o, total: poTotal(o) } };
}

// Livraison reçue : la dépense est rangée en compta et rattachée au chantier
export function setPoStatus(id, status) {
  const db = load();
  const o = (db.purchaseOrders || []).find((x) => x.id === id);
  if (!o) return { error: "Commande introuvable" };
  if (!["envoyée", "confirmée", "livrée", "annulée"].includes(status)) return { error: "Statut inconnu" };
  const was = o.status;
  o.status = status;
  if (status === "livrée" && was !== "livrée") {
    o.deliveredAt = new Date().toISOString();
    const ht = poTotal(o);
    (db.expenses ||= []).push({ id: uid("exp"), date: localISO(new Date()).slice(0, 10), supplier: o.supplier, label: `Bon de commande ${o.number}`, category: "Matériaux et fournitures", ttc: r2(ht * 1.2), ht, tva: r2(ht * 0.2), tvaRate: 20, photo: null, source: "bon de commande", projectId: o.projectId, createdAt: new Date().toISOString() });
    const p = db.projects.find((x) => x.id === o.projectId);
    const step = p?.steps.find((s) => /commande/i.test(s.label) && !s.done);
    save();
    if (step) completeStep({ project: p.id, step: step.label });
    if (p) addJournal({ project: p.id, text: `Livraison ${o.supplier} reçue (bon ${o.number}).`, share: false });
    notifyOwner(`📦 Livraison ${o.supplier} (${o.number}) reçue pour « ${p?.title} ». Dépense de ${ht.toFixed(2)} € HT rangée en compta.`);
  }
  save();
  return { ok: true, order: { ...o, total: poTotal(o) } };
}

export function listPurchaseOrders(projectId) {
  return (load().purchaseOrders || []).filter((o) => !projectId || o.projectId === projectId).slice().reverse().map((o) => ({ ...o, total: poTotal(o), project: load().projects.find((p) => p.id === o.projectId)?.title }));
}

export function renderPoPdf(o, res) {
  const db = load();
  const b = db.business;
  const p = db.projects.find((x) => x.id === o.projectId);
  const pdf = new PDFDocument({ size: "A4", margin: 50 });
  pdf.pipe(res);
  pdf.fillColor("#4f46e5").fontSize(20).font("Helvetica-Bold").text(b.name, 50, 50);
  pdf.fillColor("#333").fontSize(9).font("Helvetica").text(b.address).text(`Tél. ${b.phone} · ${b.email}`).text(`SIRET ${b.siret}`);
  pdf.fontSize(16).font("Helvetica-Bold").fillColor("#111").text(`BON DE COMMANDE ${o.number}`, 280, 50, { width: 265, align: "right" });
  pdf.fontSize(9).font("Helvetica").text(`Date : ${new Date(o.createdAt).toLocaleDateString("fr-FR")}`, 280, 72, { width: 265, align: "right" });
  pdf.text(`Fournisseur : ${o.supplier}`, 50, 130).text(`Livraison souhaitée : ${new Date(o.deliveryDate).toLocaleDateString("fr-FR")}`).text(`Adresse de livraison : ${o.deliveryAddress}`).text(`Chantier : ${p?.title || ""}`);
  let y = 200;
  pdf.rect(50, y, 495, 20).fill("#4f46e5");
  pdf.fillColor("#fff").font("Helvetica-Bold");
  pdf.text("Désignation", 54, y + 6).text("Qté", 330, y + 6, { width: 50, align: "right" }).text("PU HT", 390, y + 6, { width: 70, align: "right" }).text("Total HT", 465, y + 6, { width: 76, align: "right" });
  y += 26;
  pdf.fillColor("#111").font("Helvetica");
  for (const l of o.lines) {
    const h = Math.max(pdf.heightOfString(l.label, { width: 270 }), 12);
    pdf.text(l.label, 54, y, { width: 270 }).text(`${l.qty} ${l.unit}`, 330, y, { width: 50, align: "right" }).text(l.unitCost.toFixed(2) + " €", 390, y, { width: 70, align: "right" }).text((l.qty * l.unitCost).toFixed(2) + " €", 465, y, { width: 76, align: "right" });
    y += h + 8;
  }
  pdf.font("Helvetica-Bold").fontSize(11).text(`Total HT : ${poTotal(o).toFixed(2)} €`, 300, y + 10, { width: 245, align: "right" });
  pdf.end();
}
