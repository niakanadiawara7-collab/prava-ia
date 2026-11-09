// Import du catalogue de prix et des clients depuis Excel / CSV (exports Obat, Batappli, EBP, Tolteck, tableur maison).
// Le navigateur lit le fichier et envoie les lignes ; ici on devine les colonnes et on importe.
import { load, save, uid } from "./db.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Synonymes des en-têtes rencontrés dans les exports des logiciels du bâtiment
const FIELDS = {
  catalogue: {
    code: ["code", "reference", "ref", "ref article", "code article", "code ouvrage", "n article", "sku"],
    label: ["designation", "libelle", "description", "intitule", "nom", "article", "ouvrage", "prestation", "libelle ouvrage", "designation ouvrage"],
    unit: ["unite", "u", "unit", "unite de mesure", "um"],
    price: ["prix", "prix ht", "pu ht", "prix unitaire ht", "prix de vente", "prix de vente ht", "pv ht", "tarif", "prix unitaire", "montant ht", "pu"],
    cost: ["prix d achat", "prix achat", "pa ht", "cout", "cout achat", "debourse", "debourse sec", "prix achat ht", "cout materiaux", "fourniture"],
    hours: ["temps", "temps mo", "heures", "duree h", "main d oeuvre h", "temps de pose", "mo h", "temps unitaire"],
    supplier: ["fournisseur", "marque fournisseur", "distributeur"],
    tva: ["tva", "taux tva", "tx tva"],
  },
  clients: {
    name: ["nom", "nom complet", "client", "raison sociale", "societe", "nom client", "contact", "denomination"],
    firstname: ["prenom", "first name"],
    lastname: ["nom de famille", "last name"],
    phone: ["telephone", "tel", "portable", "mobile", "tel portable", "telephone mobile", "tel fixe", "telephone 1", "gsm"],
    email: ["email", "e mail", "mail", "courriel", "adresse email", "adresse mail"],
    address: ["adresse", "adresse 1", "rue", "adresse postale", "adresse de facturation", "voie"],
    zip: ["cp", "code postal", "postal"],
    city: ["ville", "commune", "localite"],
    siren: ["siren", "siret", "n siret", "n siren"],
    notes: ["notes", "commentaire", "commentaires", "remarques", "observations"],
  },
};

function guessField(kind, header) {
  const h = norm(header);
  if (!h) return null;
  let best = null, score = 0;
  for (const [field, syns] of Object.entries(FIELDS[kind])) {
    for (const s of syns) {
      const sc = h === s ? 100 + s.length : h.startsWith(s + " ") || h.endsWith(" " + s) ? 50 + s.length : h.includes(s) && s.length > 3 ? 10 + s.length : 0;
      if (sc > score) { score = sc; best = field; }
    }
  }
  return best;
}

// Trouve la ligne d'en-têtes (certains exports ont un titre ou des lignes vides au début)
function headerRow(rows, kind) {
  let best = 0, bestScore = -1;
  rows.slice(0, 10).forEach((r, i) => {
    const s = r.filter((c) => guessField(kind, c)).length;
    if (s > bestScore) { bestScore = s; best = i; }
  });
  return best;
}

export function preview({ kind, rows }) {
  if (!FIELDS[kind]) return { error: "Type d'import inconnu" };
  rows = (rows || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()));
  if (rows.length < 2) return { error: "Le fichier ne contient pas assez de lignes." };
  const h = headerRow(rows, kind);
  const headers = rows[h].map((c) => String(c ?? "").trim());
  const used = new Set();
  const mapping = headers.map((x) => { const f = guessField(kind, x); if (!f || used.has(f)) return null; used.add(f); return f; });
  const data = rows.slice(h + 1);
  const items = toItems(kind, data, mapping);
  return { ok: true, headers, mapping, fields: Object.keys(FIELDS[kind]), headerIndex: h, total: data.length, sample: items.slice(0, 8), valid: items.length };
}

const num = (v) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[€\s  ]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

function toItems(kind, data, mapping) {
  const out = [];
  for (const r of data) {
    const o = {};
    mapping.forEach((f, i) => { if (f && r[i] != null && String(r[i]).trim() !== "") o[f] = String(r[i]).trim(); });
    if (kind === "catalogue") {
      if (!o.label) continue;
      const price = num(o.price);
      if (price == null) continue;
      out.push({ code: o.code || "", label: o.label, unit: normUnit(o.unit), price, cost: num(o.cost), hours: num(o.hours), supplier: o.supplier || "", duration: num(o.hours) ? Math.round(num(o.hours) * 60) : 60 });
    } else {
      const name = o.name || [o.firstname, o.lastname].filter(Boolean).join(" ");
      if (!name && !o.phone && !o.email) continue;
      const address = [o.address, [o.zip, o.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      const siren = (o.siren || "").replace(/\D/g, "").slice(0, 9);
      out.push({ name: o.firstname && o.name && !o.name.includes(o.firstname) ? `${o.firstname} ${o.name}` : name || "Client sans nom", phone: o.phone || "", email: o.email || "", address, notes: o.notes || "", ...(siren.length === 9 ? { type: "pro", siren } : { type: "particulier" }) });
    }
  }
  return out;
}

function normUnit(u) {
  const n = norm(u);
  if (!n) return "u";
  if (["m2", "m 2", "metre carre", "m²"].includes(n) || u === "m²") return "m²";
  if (["ml", "m", "metre", "metre lineaire"].includes(n)) return "m";
  if (["h", "heure", "heures", "hr"].includes(n)) return "h";
  if (["ft", "forfait", "ens", "ensemble"].includes(n)) return "forfait";
  if (["u", "un", "unite", "pce", "piece", "pc"].includes(n)) return "u";
  return u;
}

export function runImport({ kind, rows, mapping, headerIndex = 0, mode = "ajouter" }) {
  const db = load();
  const data = (rows || []).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim())).slice(headerIndex + 1);
  const items = toItems(kind, data, mapping);
  if (!items.length) return { error: "Aucune ligne valide à importer : vérifiez les colonnes." };
  let added = 0, updated = 0;
  if (kind === "catalogue") {
    if (mode === "remplacer") db.services = [];
    for (const it of items) {
      const ex = db.services.find((s) => (it.code && s.code === it.code) || s.label.toLowerCase() === it.label.toLowerCase());
      const clean = Object.fromEntries(Object.entries(it).filter(([, v]) => v !== null && v !== ""));
      if (ex) { Object.assign(ex, clean); updated++; } else { db.services.push({ code: it.code || "IMP" + (db.services.length + 1), duration: 60, unit: "u", ...clean }); added++; }
    }
  } else {
    const digits = (p) => String(p || "").replace(/\D/g, "").replace(/^33/, "0");
    for (const it of items) {
      const ex = db.clients.find((c) => (it.phone && digits(c.phone) === digits(it.phone)) || (it.email && c.email && c.email.toLowerCase() === it.email.toLowerCase()) || c.name.toLowerCase() === it.name.toLowerCase());
      if (ex) { for (const [k, v] of Object.entries(it)) if (v && !ex[k]) ex[k] = v; updated++; }
      else { db.clients.push({ id: uid("cli"), ...it, imported: true, createdAt: new Date(Date.now() - 400 * 864e5).toISOString() }); added++; }
    }
  }
  save();
  return { ok: true, added, updated, total: items.length };
}

// ---------- Fichiers d'exemple (pour la démo : « export de votre ancien logiciel ») ----------
const SAMPLES = {
  dupont: [
    ["PLB-001", "Remplacement mitigeur lavabo (fourni posé)", "u", 38, 145, 1, "Cedeo"],
    ["PLB-002", "Remplacement WC suspendu complet (bâti + cuvette)", "u", 310, 690, 4, "Cedeo"],
    ["PLB-003", "Débouchage canalisation au furet", "forfait", 5, 120, 1, ""],
    ["PLB-004", "Remplacement groupe de sécurité chauffe-eau", "u", 22, 95, 0.75, "Cedeo"],
    ["CHF-010", "Désembouage circuit de chauffage (jusqu'à 8 radiateurs)", "forfait", 60, 450, 4, "Cedeo"],
    ["CHF-011", "Remplacement radiateur acier 1000 W", "u", 140, 360, 2, "Cedeo"],
    ["CHF-012", "Robinet thermostatique (fourni posé)", "u", 18, 65, 0.5, "Cedeo"],
    ["PLB-020", "Création arrivée et évacuation lave-linge", "forfait", 45, 220, 2, "Cedeo"],
  ],
  electricien: [
    ["ELE-001", "Remplacement interrupteur différentiel 40 A type A", "u", 48, 160, 0.75, "Rexel"],
    ["ELE-002", "Mise à la terre d'un logement", "forfait", 70, 480, 4, "Rexel"],
    ["ELE-003", "Pose radiateur électrique à inertie 1500 W", "u", 290, 560, 1.5, "Rexel"],
    ["ELE-004", "Interphone / visiophone (fourni posé)", "u", 160, 390, 2, "Rexel"],
    ["ELE-005", "Prise RJ45 catégorie 6", "u", 12, 70, 0.5, "Sonepar"],
    ["ELE-006", "Détecteur de fumée raccordé", "u", 25, 80, 0.5, "Rexel"],
    ["ELE-007", "Création circuit spécialisé (plaque, four, lave-linge)", "u", 35, 190, 1.5, "Rexel"],
    ["ELE-008", "Éclairage extérieur avec détecteur", "u", 55, 210, 1.5, "Sonepar"],
  ],
  peintre: [
    ["PEI-001", "Lessivage murs et plafonds", "m²", 0.4, 6, 0.08, "Tollens"],
    ["PEI-002", "Pose de toile de verre à peindre", "m²", 3.5, 22, 0.25, "Tollens"],
    ["PEI-003", "Peinture boiseries (plinthes, chambranles)", "m", 0.8, 9, 0.12, "Tollens"],
    ["PEI-004", "Peinture sol béton (garage, cave)", "m²", 4.2, 24, 0.2, "Seigneurie"],
    ["PEI-005", "Enduit de lissage complet", "m²", 1.6, 14, 0.2, "Seigneurie"],
    ["PEI-006", "Peinture radiateur", "u", 6, 85, 1.2, "Tollens"],
    ["PEI-007", "Dépose papier peint ancien", "m²", 0.3, 8, 0.15, ""],
    ["PEI-008", "Peinture volets bois (2 faces)", "u", 9, 140, 2, "Tollens"],
  ],
};

export function sampleCsv(kind, profile, format = "obat") {
  const fr = (n) => String(n).replace(".", ",");
  if (kind === "clients") {
    const rows = [
      ["Nom", "Prénom", "Téléphone", "E-mail", "Adresse", "CP", "Ville", "SIRET", "Commentaire"],
      ["Lambert", "Nicolas", "06 14 25 36 47", "n.lambert@example.fr", "5 rue Voltaire", "75011", "Paris", "", "Client depuis 2019"],
      ["Mercier", "Aurélie", "07 58 69 70 81", "aurelie.m@example.fr", "28 bd Voltaire", "75011", "Paris", "", ""],
      ["Faure", "Gilles", "06 92 83 74 65", "", "3 rue de Montreuil", "93100", "Montreuil", "", "Interphone en panne, appeler avant"],
      ["Gestimmo Syndic", "", "01 43 56 78 90", "travaux@gestimmo.example.fr", "40 rue de la Roquette", "75011", "Paris", "41234567800018", "Syndic : 12 immeubles"],
      ["Chevalier", "Marie", "06 37 48 59 60", "marie.chevalier@example.fr", "14 av. Parmentier", "75011", "Paris", "", ""],
      ["Rousseau", "Karim", "07 21 32 43 54", "k.rousseau@example.fr", "9 rue Saint-Maur", "75010", "Paris", "", "Entretien chaque année en octobre"],
      ["Boulangerie Le Fournil", "", "01 48 05 06 07", "contact@lefournil.example.fr", "62 rue Oberkampf", "75011", "Paris", "52345678900027", "Professionnel"],
      ["Blanc", "Sylvie", "06 05 16 27 38", "sylvie.blanc@example.fr", "2 rue de Lappe", "75011", "Paris", "", ""],
    ];
    return rows.map((r) => r.join(";")).join("\r\n");
  }
  const data = SAMPLES[profile] || SAMPLES.dupont;
  const head = format === "batappli" ? ["Code ouvrage", "Libellé", "Unité", "Déboursé sec", "PU HT", "Temps MO (h)", "Fournisseur"] : ["Référence", "Désignation", "Unité", "Prix d'achat HT", "Prix de vente HT", "Temps de pose", "Fournisseur"];
  const title = format === "batappli" ? ["Bibliothèque d'ouvrages - export Batappli"] : ["Export bibliothèque Obat"];
  return [title, [], head, ...data.map(([c, l, u, cost, price, h, s]) => [c, l, u, fr(cost), fr(price), fr(h), s])].map((r) => r.join(";")).join("\r\n");
}
