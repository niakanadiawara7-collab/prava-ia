// Facture électronique (réforme 2026-2027) : génération Factur-X (XML CII, profil EN 16931),
// transmission via une plateforme agréée (PA), suivi des statuts du cycle de vie,
// e-reporting pour les clients particuliers et réception des factures fournisseurs.
// Sans PA_API_URL dans .env, la transmission est simulée (statuts réalistes).
import { load, save, uid, findClient, quoteTotals, localISO } from "./db.js";
import { notifyOwner } from "./ops.js";

const r2 = (n) => Math.round(n * 100) / 100;
const x = (s) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);
const d8 = (iso) => String(iso).slice(0, 10).replace(/-/g, "");
const amt = (n) => Number(n).toFixed(2);

export const PA_NAME = () => process.env.PA_NAME || load().business.einvoice?.platform || "Plateforme agréée partenaire";
export const paConnected = () => Boolean(process.env.PA_API_URL);

// Statuts du cycle de vie (norme XP Z12-012) utilisés dans le suivi
export const LIFECYCLE = ["déposée", "émise", "reçue", "mise à disposition", "prise en charge", "approuvée", "paiement transmis", "encaissée", "refusée"];

const siren = (siret) => String(siret || "").replace(/\D/g, "").slice(0, 9);
// Numéro de TVA intracommunautaire français calculé à partir du SIREN
export function vatNumber(sirenStr) {
  const s = siren(sirenStr);
  if (s.length !== 9) return "";
  const key = (12 + 3 * (Number(s) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${s}`;
}

export function isB2B(client) {
  return client?.type === "pro" && siren(client.siren || client.siret).length === 9;
}

export function facturxXml(inv) {
  const db = load();
  const b = db.business;
  const c = findClient(inv.clientId) || {};
  const t = quoteTotals(inv);
  const paid = r2((inv.payments || []).reduce((s, p) => s + p.amount, 0) + (inv.depositPaid || 0));
  const rate = Number(inv.tva);
  const cat = rate > 0 ? "S" : "E";
  const typeCode = t.ht < 0 ? "381" : "380";
  const lines = inv.lines.map((l, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${x(l.label)}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amt(l.unitPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${unitCode(l.unit)}">${Number(l.qty)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${cat}</ram:CategoryCode><ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(l.qty * l.unitPrice)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>A1</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${x(inv.number)}</ram:ID>
    <ram:TypeCode>${typeCode}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${d8(inv.createdAt)}</udt:DateTimeString></ram:IssueDateTime>
    <ram:IncludedNote><ram:Content>${x(inv.title)}</ram:Content></ram:IncludedNote>
    <ram:IncludedNote><ram:Content>Pénalités de retard : 3 fois le taux d'intérêt légal. Indemnité forfaitaire pour frais de recouvrement : 40 €. Pas d'escompte pour paiement anticipé.</ram:Content><ram:SubjectCode>PMT</ram:SubjectCode></ram:IncludedNote>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>${lines}
    <ram:ApplicableHeaderTradeAgreement>
      ${inv.quoteId ? `<ram:BuyerReference>${x(db.quotes.find((q) => q.id === inv.quoteId)?.number || "")}</ram:BuyerReference>` : ""}
      <ram:SellerTradeParty>
        <ram:Name>${x(b.name)}</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${siren(b.siret)}</ram:ID></ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>${addr(b.address)}</ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="0225">${siren(b.siret)}</ram:URIID></ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${vatNumber(b.siret)}</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${x(c.company || c.name)}</ram:Name>
        ${isB2B(c) ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${siren(c.siren)}</ram:ID></ram:SpecifiedLegalOrganization>` : ""}
        <ram:PostalTradeAddress>${addr(c.address)}</ram:PostalTradeAddress>
        ${isB2B(c) ? `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${siren(c.siren)}</ram:URIID></ram:URIUniversalCommunication><ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${vatNumber(c.siren)}</ram:ID></ram:SpecifiedTaxRegistration>` : ""}
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>${c.address ? `<ram:ShipToTradeParty><ram:PostalTradeAddress>${addr(c.address)}</ram:PostalTradeAddress></ram:ShipToTradeParty>` : ""}</ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode>${b.iban ? `<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${x(b.iban.replace(/\s/g, ""))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>` : ""}</ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${amt(t.tva)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>
        ${cat === "E" ? "<ram:ExemptionReason>TVA non applicable, art. 293 B du CGI</ram:ExemptionReason>" : ""}
        <ram:BasisAmount>${amt(t.ht)}</ram:BasisAmount><ram:CategoryCode>${cat}</ram:CategoryCode>
        <ram:DueDateTypeCode>72</ram:DueDateTypeCode>
        <ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${d8(inv.dueDate)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amt(t.ht)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amt(t.ht)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${amt(t.tva)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amt(t.ttc)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${amt(paid)}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${amt(Math.max(0, t.ttc - paid))}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

function addr(a) {
  const m = /^(.*?),?\s*(\d{5})\s+(.+)$/.exec(String(a || ""));
  return m ? `<ram:PostcodeCode>${m[2]}</ram:PostcodeCode><ram:LineOne>${x(m[1])}</ram:LineOne><ram:CityName>${x(m[3])}</ram:CityName><ram:CountryID>FR</ram:CountryID>` : `<ram:LineOne>${x(a)}</ram:LineOne><ram:CountryID>FR</ram:CountryID>`;
}

function unitCode(u) {
  return { h: "HUR", "m²": "MTK", m2: "MTK", m: "MTR", forfait: "C62", u: "C62", kg: "KGM", l: "LTR", L: "LTR" }[u] || "C62";
}

function event(inv, status, note) {
  inv.einvoice.events.push({ status, at: new Date().toISOString(), note: note || "" });
  inv.einvoice.status = status;
}

// Transmet la facture : e-invoicing (client professionnel) ou e-reporting (particulier)
export async function transmit(id) {
  const db = load();
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) return { error: "Facture introuvable" };
  if (inv.einvoice?.events?.length) return { ok: true, einvoice: inv.einvoice, note: "Déjà transmise" };
  const c = findClient(inv.clientId);
  const b2b = isB2B(c);
  inv.einvoice = { flow: b2b ? "e-invoicing" : "e-reporting", format: "Factur-X (EN 16931)", platform: PA_NAME(), events: [], status: null, simulated: !paConnected() };
  if (paConnected()) {
    try {
      const r = await fetch(process.env.PA_API_URL, { method: "POST", headers: { "Content-Type": "application/xml", Authorization: `Bearer ${process.env.PA_API_KEY || ""}`, "X-Flow": inv.einvoice.flow }, body: facturxXml(inv) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json().catch(() => ({}));
      inv.einvoice.externalId = j.id || null;
      event(inv, "déposée", "Déposée sur la plateforme");
    } catch (e) {
      event(inv, "refusée", "Erreur de transmission : " + e.message);
      save();
      return { error: "Transmission impossible : " + e.message };
    }
  } else {
    event(inv, "déposée", `Factur-X généré et contrôlé (${inv.lines.length} ligne(s))`);
    if (b2b) { event(inv, "émise", `Transmise à la plateforme du client (SIREN ${String(c.siren).replace(/\D/g, "")})`); event(inv, "reçue", "Reçue par la plateforme du client"); }
    else event(inv, "émise", "Données de vente transmises à l'administration (e-reporting, client particulier)");
  }
  save();
  return { ok: true, einvoice: inv.einvoice };
}

// Simulation : la plateforme du client fait avancer la facture ; le paiement déclenche « encaissée »
export function advanceLifecycle() {
  const db = load();
  const done = [];
  for (const inv of db.invoices) {
    const e = inv.einvoice;
    if (!e?.simulated || !e.events.length) continue;
    const last = new Date(e.events.at(-1).at).getTime();
    if (e.flow === "e-invoicing" && e.status === "reçue" && Date.now() - last > 60e3) { event(inv, "mise à disposition", "Le client a ouvert la facture"); done.push(`e-facture ${inv.number} mise à disposition`); }
    else if (e.flow === "e-invoicing" && e.status === "mise à disposition" && Date.now() - last > 60e3) { event(inv, "approuvée", "Facture approuvée par le client"); done.push(`e-facture ${inv.number} approuvée`); }
    if (inv.status === "payée" && e.status !== "encaissée") { event(inv, "encaissée", "Statut d'encaissement transmis (obligatoire pour la TVA sur les prestations)"); done.push(`e-facture ${inv.number} encaissée`); }
  }
  if (done.length) save();
  return done;
}

// Transmission automatique des nouvelles factures si l'option est active
export async function autoTransmit() {
  const db = load();
  if (db.business.einvoice?.auto === false) return [];
  const out = [];
  for (const inv of db.invoices.filter((i) => !i.einvoice?.events?.length && new Date(i.createdAt) >= new Date(db.business.einvoice?.since || 0))) {
    const r = await transmit(inv.id);
    if (r.ok) out.push(`e-facture ${inv.number} transmise`);
  }
  return out;
}

// ---------- Réception des factures fournisseurs (obligatoire depuis le 1er septembre 2026) ----------
export function inbox() {
  return (load().einbox || []).slice().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function acceptIncoming(id, { projectId, refuse, reason } = {}) {
  const db = load();
  const f = (db.einbox || []).find((x) => x.id === id);
  if (!f) return { error: "Facture introuvable" };
  if (refuse) { f.status = "refusée"; f.reason = reason || ""; save(); return { ok: true, invoice: f }; }
  if (f.status === "rangée") return { ok: true, invoice: f };
  f.status = "rangée";
  const exp = { id: uid("exp"), date: f.date, supplier: f.supplier, label: `Facture électronique ${f.number}${f.label ? " · " + f.label : ""}`, category: f.category || "Matériaux et fournitures", ttc: f.ttc, ht: f.ht, tva: r2(f.ttc - f.ht), tvaRate: f.tvaRate || 20, photo: null, source: "facture électronique", projectId: projectId || f.projectId || null, createdAt: new Date().toISOString() };
  (db.expenses ||= []).push(exp);
  f.expenseId = exp.id;
  save();
  return { ok: true, invoice: f, expense: exp };
}

// Pour la démo : une nouvelle facture fournisseur arrive par la plateforme
export function simulateIncoming() {
  const db = load();
  const sup = db.business.suppliers?.[0]?.name || "Fournisseur";
  const ht = r2(150 + Math.random() * 400);
  const f = { id: uid("ein"), supplier: sup, supplierSiren: "552 081 317", number: `${sup.slice(0, 2).toUpperCase()}-${Math.floor(10000 + Math.random() * 89999)}`, date: localISO(new Date()).slice(0, 10), label: "Fournitures diverses", ht, ttc: r2(ht * 1.2), tvaRate: 20, category: "Matériaux et fournitures", receivedAt: new Date().toISOString(), status: "à valider", platform: PA_NAME() };
  (db.einbox ||= []).push(f);
  save();
  notifyOwner(`📥 Facture électronique reçue de ${sup} (${f.number}, ${f.ttc.toFixed(2)} € TTC). À valider dans Compta.`);
  return { ok: true, invoice: f };
}

export function einvoiceStats() {
  const db = load();
  const inv = db.invoices;
  return {
    platform: PA_NAME(), connected: paConnected(), auto: db.business.einvoice?.auto !== false,
    transmitted: inv.filter((i) => i.einvoice?.events?.length).length, pending: inv.filter((i) => !i.einvoice?.events?.length).length,
    b2b: inv.filter((i) => i.einvoice?.flow === "e-invoicing").length, b2c: inv.filter((i) => i.einvoice?.flow === "e-reporting").length,
    incoming: (db.einbox || []).filter((f) => f.status === "à valider").length,
  };
}
