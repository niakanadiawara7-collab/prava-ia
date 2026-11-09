// Génération des devis et factures en PDF.
import PDFDocument from "pdfkit";
import { load, findClient, quoteTotals } from "./db.js";
import { docLabel } from "./ops.js";
import { computeAids, vatMention } from "./aides.js";
import { facturxXml } from "./einvoice.js";
import { PassThrough } from "node:stream";

// Même rendu, mais dans un Buffer (pour l'envoyer à Yousign)
export function renderPdfBuffer(doc, kind) {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const chunks = [];
    out.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks))).on("error", reject);
    renderPdf(doc, kind, out);
  });
}

const eur = (n) => Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, " ") + " €";
const frDate = (iso) => new Date(iso).toLocaleDateString("fr-FR");

export function renderPdf(doc, kind, res) {
  const db = load();
  const b = db.business;
  const c = findClient(doc.clientId) || {};
  const t = quoteTotals(doc);
  const pdf = new PDFDocument({ size: "A4", margin: 50, info: { Title: `${kind === "invoice" ? "Facture" : docLabel()} ${doc.number}`, Author: b.name } });
  pdf.pipe(res);
  // Facture électronique : le XML Factur-X (EN 16931) est joint au PDF
  if (kind === "invoice") pdf.file(Buffer.from(facturxXml(doc)), { name: "factur-x.xml", type: "text/xml", description: "Factur-X EN 16931", relationship: "Alternative", creationDate: new Date(doc.createdAt), modifiedDate: new Date() });
  const accent = "#4f46e5";

  pdf.fillColor(accent).fontSize(20).font("Helvetica-Bold").text(b.name, 50, 50);
  pdf.fillColor("#333").fontSize(9).font("Helvetica")
    .text(b.address).text([b.phone && `Tél. ${b.phone}`, b.email].filter(Boolean).join(" · "))
    .text([b.legalForm, b.siret && `SIRET ${b.siret}`].filter(Boolean).join(" · "))
    .text((b.tvaNumber || vatNum(b.siret)) && Number(doc.tva) ? `TVA intracom. ${b.tvaNumber || vatNum(b.siret)}` : "");

  const title = kind === "invoice" ? "FACTURE" : docLabel().toUpperCase();
  pdf.fontSize(16).font("Helvetica-Bold").fillColor("#111").text(`${title} ${doc.number}`, 320, 50, { width: 225, align: "right" });
  pdf.fontSize(9).font("Helvetica").text(`Date : ${frDate(doc.createdAt)}`, 320, 72, { width: 225, align: "right" });
  if (kind === "invoice") pdf.text(`Échéance : ${frDate(doc.dueDate)}`, { width: 225, align: "right" });
  else pdf.text("Validité : 30 jours", { width: 225, align: "right" });

  pdf.roundedRect(320, 110, 225, 70, 4).strokeColor("#ddd").stroke();
  pdf.fontSize(9).fillColor("#666").text("Client", 330, 118);
  pdf.fillColor("#111").font("Helvetica-Bold").text(c.name || "", 330, 131).font("Helvetica").text(c.address || "", { width: 205 }).text([c.phone, c.email].filter(Boolean).join(" · "), { width: 205 });

  pdf.fontSize(11).font("Helvetica-Bold").text(`Objet : ${doc.title}`, 50, 200);

  // Tableau des lignes
  let y = 230;
  const cols = [50, 300, 360, 420, 480];
  pdf.rect(50, y, 495, 20).fill(accent);
  pdf.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
  ["Désignation", "Qté", "Unité", "PU HT", "Total HT"].forEach((h, i) => pdf.text(h, cols[i] + 4, y + 6, { width: (cols[i + 1] || 545) - cols[i] - 8, align: i ? "right" : "left" }));
  y += 24;
  pdf.font("Helvetica").fillColor("#111");
  for (const l of doc.lines) {
    const h = Math.max(pdf.heightOfString(l.label, { width: 240 }), 12);
    pdf.text(l.label, cols[0] + 4, y, { width: 240 });
    pdf.text(String(l.qty), cols[1] + 4, y, { width: 52, align: "right" });
    pdf.text(l.unit, cols[2] + 4, y, { width: 52, align: "right" });
    pdf.text(eur(l.unitPrice), cols[3] + 4, y, { width: 52, align: "right" });
    pdf.text(eur(l.qty * l.unitPrice), cols[4] + 4, y, { width: 57, align: "right" });
    y += h + 8;
    pdf.moveTo(50, y - 4).lineTo(545, y - 4).strokeColor("#eee").stroke();
  }

  // Totaux
  y += 6;
  const row = (label, val, bold) => {
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).text(label, 340, y, { width: 120, align: "right" }).text(val, 465, y, { width: 80, align: "right" });
    y += bold ? 18 : 14;
  };
  row("Total HT", eur(t.ht));
  row(`TVA ${doc.tva} %`, eur(t.tva));
  row("Total TTC", eur(t.ttc), true);
  if (kind === "invoice" && doc.depositPaid) { row("Acompte versé", "- " + eur(doc.depositPaid)); row("Reste à payer", eur(t.ttc - doc.depositPaid), true); }
  if (!Number(doc.tva)) { pdf.font("Helvetica").fontSize(8).text("TVA non applicable, art. 293 B du CGI.", 50, y); y += 14; }

  // Aides à la rénovation énergétique (devis)
  const aids = kind === "quote" ? computeAids(doc) : null;
  if (aids?.category && aids.total > 0) {
    y += 8;
    if (y > 600) { pdf.addPage(); y = 50; }
    const h = 30 + aids.items.length * 13 + 34;
    pdf.roundedRect(50, y, 495, h, 6).fillAndStroke("#ecfdf3", "#86efac");
    pdf.fillColor("#14532d").font("Helvetica-Bold").fontSize(10).text(`Aides estimées (${aids.categoryLabel})`, 60, y + 8);
    let yy = y + 24;
    pdf.font("Helvetica").fontSize(9);
    for (const it of aids.items) { pdf.text(`${it.label}`, 60, yy, { width: 280 }).text(`MaPrimeRénov' ${eur(it.mpr)} · CEE ${eur(it.cee)}`, 340, yy, { width: 195, align: "right" }); yy += 13; }
    pdf.font("Helvetica-Bold").text(`Total des aides : ${eur(aids.total)}${aids.capped ? " (plafonné)" : ""}`, 60, yy + 4).text(`Reste à charge estimé : ${eur(aids.resteACharge)}`, 340, yy + 4, { width: 195, align: "right" });
    pdf.font("Helvetica").fontSize(7.5).fillColor("#166534").text(`Montants indicatifs, sous réserve d'acceptation des dossiers. ${aids.rgeNumero ? `Entreprise RGE : ${aids.rgeNumero}.` : ""}`, 60, yy + 18, { width: 475 });
    pdf.fillColor("#111");
    y += h + 6;
  }

  if (doc.notes) {
    y += 10;
    pdf.font("Helvetica-Bold").fontSize(9).text(kind === "invoice" ? "Compte rendu" : "Remarques", 50, y);
    pdf.font("Helvetica").text(doc.notes, 50, pdf.y + 2, { width: 495 });
    y = pdf.y + 10;
  }

  // Mention de TVA à taux réduit certifiée par le client (remplace l'attestation 1300/1301-SD)
  const vm = (b.sector === "btp" || kind === "quote") ? vatMention(doc) : null;
  if (vm) {
    if (y > 640) { pdf.addPage(); y = 50; }
    pdf.font("Helvetica-Bold").fontSize(8).fillColor("#333").text(`Taux réduit de TVA (${doc.tva} %)`, 50, y + 10);
    pdf.font("Helvetica").fontSize(7.5).text(vm, 50, pdf.y + 2, { width: 495 });
    y = pdf.y + 4;
  }

  // Mentions
  pdf.fontSize(8).fillColor("#555").font("Helvetica");
  const foot = kind === "invoice"
    ? `Paiement à réception, au plus tard le ${frDate(doc.dueDate)}. En cas de retard : pénalités au taux de 3 fois le taux d'intérêt légal et indemnité forfaitaire pour frais de recouvrement de 40 € (art. L441-10 du Code de commerce). Pas d'escompte pour paiement anticipé.`
    : `${docLabel()} gratuit, valable 30 jours. Acompte de ${b.depositPercent} % à la signature. Bon pour accord : signature électronique via le lien reçu par SMS ou e-mail.`;
  pdf.text(foot, 50, Math.max(y + 20, 670), { width: 495 });
  if (b.insurance) pdf.text(`Assurance professionnelle : ${b.insurance}.`, 50, pdf.y + 2, { width: 495 });
  if (kind === "invoice") pdf.text(`Facture électronique au format Factur-X (EN 16931)${doc.einvoice?.platform ? `, transmise via ${doc.einvoice.platform}` : ""}. ${b.iban ? `Règlement par virement : IBAN ${b.iban}${b.bic ? `, BIC ${b.bic}` : ""}, référence ${doc.number}.` : ""}`, 50, pdf.y + 4, { width: 495 });
  if (doc.signedBy) {
    pdf.fillColor("#15803d").text(`Signé électroniquement par ${doc.signedBy} le ${frDate(doc.signedAt)}.`, 50, pdf.y + 6);
    const sg = doc.signature;
    if (sg?.image) {
      const yy = pdf.y + 4;
      try { pdf.image(Buffer.from(sg.image.split(",")[1], "base64"), 50, yy, { fit: [140, 50] }); } catch {}
      pdf.fillColor("#555").fontSize(7).text(`Dossier de preuve : ${sg.method}. Code à usage unique vérifié${sg.vatCertified ? ", mention de TVA certifiée" : ""}. Le ${new Date(sg.at).toLocaleString("fr-FR")}, IP ${sg.ip}. Empreinte SHA-256 du devis : ${sg.fingerprint}`, 200, yy, { width: 345 });
    } else if (sg?.provider === "yousign") pdf.fillColor("#555").fontSize(7).text(`Signature Yousign, demande ${sg.requestId}. Empreinte SHA-256 : ${sg.fingerprint}`, 50, pdf.y + 2, { width: 495 });
  }
  pdf.end();
}

function vatNum(siret) {
  const s = String(siret || "").replace(/\D/g, "").slice(0, 9);
  if (s.length !== 9) return "";
  return `FR${String((12 + 3 * (Number(s) % 97)) % 97).padStart(2, "0")}${s}`;
}
