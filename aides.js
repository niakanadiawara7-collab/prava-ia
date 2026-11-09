// Aides à la rénovation énergétique : MaPrimeRénov' (par geste) et CEE (primes énergie),
// plus la mention de TVA à taux réduit que le client certifie en signant le devis.
// BARÈMES INDICATIFS (repris des grilles 2025) : à vérifier et mettre à jour chaque année
// sur france-renov.gouv.fr. Les montants CEE varient selon le fournisseur d'énergie.
import { load, quoteTotals } from "./db.js";

// Couleurs officielles des profils de revenus
export const CATEGORIES = {
  bleu: { label: "Très modestes (MaPrimeRénov' Bleu)", cap: 0.9, ceeBonus: true },
  jaune: { label: "Modestes (MaPrimeRénov' Jaune)", cap: 0.75, ceeBonus: true },
  violet: { label: "Intermédiaires (MaPrimeRénov' Violet)", cap: 0.6, ceeBonus: false },
  rose: { label: "Supérieurs (MaPrimeRénov' Rose)", cap: 0.4, ceeBonus: false },
};

// Plafonds de revenu fiscal de référence (bleu, jaune, violet) par taille du foyer
const PLAFONDS = {
  horsIdf: { 1: [17363, 22259, 31185], 2: [25393, 32553, 45842], 3: [30540, 39148, 55196], 4: [35676, 45735, 64550], 5: [40835, 52348, 73907], plus: [5151, 6598, 9357] },
  idf: { 1: [24031, 29253, 40851], 2: [35270, 42933, 60051], 3: [42357, 51564, 71846], 4: [49455, 60208, 84562], 5: [56580, 68877, 96817], plus: [7116, 8663, 12257] },
};

// Gestes éligibles : forfait MaPrimeRénov' par catégorie [bleu, jaune, violet, rose], prime CEE [modestes, autres],
// unité de calcul, plafond de quantité, taux de TVA applicable
export const GESTES = {
  pac_air_eau: { label: "Pompe à chaleur air/eau", unit: "u", mpr: [5000, 4000, 3000, 0], cee: [4000, 2500], tva: 5.5 },
  pac_geo: { label: "Pompe à chaleur géothermique", unit: "u", mpr: [11000, 9000, 6000, 0], cee: [5000, 4000], tva: 5.5 },
  chauffe_eau_thermo: { label: "Chauffe-eau thermodynamique", unit: "u", mpr: [1200, 800, 400, 0], cee: [150, 100], tva: 5.5 },
  chauffe_eau_solaire: { label: "Chauffe-eau solaire individuel", unit: "u", mpr: [4000, 3000, 2000, 0], cee: [300, 200], tva: 5.5 },
  poele_granules: { label: "Poêle à granulés", unit: "u", mpr: [1250, 1000, 500, 0], cee: [800, 500], tva: 5.5 },
  chaudiere_granules: { label: "Chaudière à granulés", unit: "u", mpr: [5000, 4000, 3000, 0], cee: [4000, 2500], tva: 5.5 },
  vmc_double_flux: { label: "VMC double flux", unit: "u", mpr: [2500, 2000, 1500, 0], cee: [400, 300], tva: 5.5 },
  isolation_murs_ext: { label: "Isolation des murs par l'extérieur", unit: "m²", maxQty: 100, mpr: [75, 60, 40, 0], cee: [15, 10], tva: 5.5 },
  isolation_murs_int: { label: "Isolation des murs par l'intérieur", unit: "m²", maxQty: 100, mpr: [25, 20, 15, 0], cee: [12, 8], tva: 5.5 },
  isolation_rampants: { label: "Isolation des rampants / toiture", unit: "m²", maxQty: 100, mpr: [25, 20, 15, 0], cee: [12, 8], tva: 5.5 },
  isolation_combles: { label: "Isolation des combles perdus (CEE uniquement)", unit: "m²", mpr: [0, 0, 0, 0], cee: [12, 7], tva: 5.5 },
  fenetres: { label: "Fenêtres double vitrage (remplacement de simple vitrage)", unit: "u", mpr: [100, 80, 40, 0], cee: [40, 30], tva: 5.5 },
  audit: { label: "Audit énergétique", unit: "u", mpr: [500, 400, 300, 0], cee: [0, 0], tva: 20 },
};

const ORDER = ["bleu", "jaune", "violet", "rose"];

export function categoryFor({ persons = 2, income, idf = false }) {
  if (!income) return null;
  const t = PLAFONDS[idf ? "idf" : "horsIdf"];
  const n = Math.max(1, Math.round(Number(persons) || 1));
  const row = n <= 5 ? t[n] : t[5].map((v, i) => v + (n - 5) * t.plus[i]);
  const i = row.findIndex((plafond) => Number(income) <= plafond);
  return i === -1 ? "rose" : ORDER[i];
}

// Code d'aide d'une ligne : posé sur la ligne, ou repris du catalogue (champ « aid » de la prestation)
export function lineAid(line) {
  if (line.aid && GESTES[line.aid]) return line.aid;
  const svc = load().services.find((s) => (line.code && s.code === line.code) || s.label === line.label);
  return svc?.aid && GESTES[svc.aid] ? svc.aid : null;
}

// Calcule les aides d'un devis selon le profil du foyer (quote.aidProfile)
export function computeAids(quote, profileOverride) {
  const prof = profileOverride || quote.aidProfile;
  const gestures = quote.lines.map((l) => ({ line: l, code: lineAid(l) })).filter((x) => x.code);
  if (!gestures.length) return null;
  const db = load();
  const t = quoteTotals(quote);
  const cat = prof ? (prof.category && CATEGORIES[prof.category] ? prof.category : categoryFor(prof)) : null;
  const rge = Boolean(db.business.rge?.numero);
  const items = gestures.map(({ line, code }) => {
    const g = GESTES[code];
    const qty = Math.min(Number(line.qty) || 1, g.maxQty || Infinity);
    const ci = cat ? ORDER.indexOf(cat) : -1;
    const mpr = ci >= 0 ? g.mpr[ci] * qty : 0;
    const cee = cat ? (CATEGORIES[cat].ceeBonus ? g.cee[0] : g.cee[1]) * qty : 0;
    return { code, label: g.label, line: line.label, qty, mpr: Math.round(mpr), cee: Math.round(cee) };
  });
  let mpr = items.reduce((s, x) => s + x.mpr, 0);
  let cee = items.reduce((s, x) => s + x.cee, 0);
  // Écrêtement : le total des aides ne peut pas dépasser un pourcentage de la dépense TTC
  let capped = false;
  if (cat) {
    const max = Math.round(t.ttc * CATEGORIES[cat].cap);
    if (mpr + cee > max) {
      capped = true;
      const over = mpr + cee - max;
      const fromMpr = Math.min(over, mpr);
      mpr -= fromMpr; cee -= over - fromMpr;
    }
  }
  const total = mpr + cee;
  return {
    category: cat, categoryLabel: cat ? CATEGORIES[cat].label : null, profile: prof || null,
    items, mpr, cee, total, capped, resteACharge: Math.round((t.ttc - total) * 100) / 100, ttc: t.ttc,
    rge, rgeNumero: db.business.rge?.numero || "", reducedVat: Number(quote.tva) < 10.0001 && Number(quote.tva) > 0,
    warnings: [
      !rge && "Les aides ne sont versées que si l'entreprise est certifiée RGE : renseignez votre numéro RGE dans Paramètres.",
      !cat && "Indiquez le revenu fiscal et la taille du foyer pour calculer le montant exact.",
      "Montants indicatifs : la demande MaPrimeRénov' doit être déposée AVANT la signature du devis, sur maprimerenov.gouv.fr.",
    ].filter(Boolean),
  };
}

// Mention de TVA à taux réduit que le client certifie en signant (remplace l'ancienne attestation 1300/1301-SD)
export function vatMention(quote) {
  const rate = Number(quote.tva);
  if (!(rate > 0 && rate < 20)) return null;
  const energy = rate < 10;
  return `Le client certifie que les travaux portent sur un local à usage d'habitation achevé depuis plus de deux ans, qu'ils n'aboutissent pas à la production d'un immeuble neuf ni n'augmentent la surface de plancher de plus de 10 %${energy ? ", et qu'ils constituent des travaux d'amélioration de la qualité énergétique au sens de l'article 278-0 bis A du CGI (TVA à 5,5 %)" : " (TVA à 10 %, article 279-0 bis du CGI)"}. Il s'engage à conserver le devis et la facture portant cette mention.`;
}

export function aidesInfo() {
  return { categories: CATEGORIES, gestes: Object.fromEntries(Object.entries(GESTES).map(([k, g]) => [k, { label: g.label, unit: g.unit, tva: g.tva }])) };
}
