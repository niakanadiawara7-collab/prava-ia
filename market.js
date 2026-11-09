// Espace public de mise en relation : un particulier décrit son chantier,
// Prava comprend la demande et propose les artisans les plus adaptés parmi ceux qui utilisent Prava.
import Anthropic from "@anthropic-ai/sdk";
import { load, save, uid } from "./db.js";
import { aiEnabled } from "./agent.js";
import { upsertClient, logCall, sendMessage } from "./ops.js";

export const TRADES = {
  plomberie: ["fuite", "robinet", "wc", "toilette", "évier", "evier", "chauffe-eau", "ballon", "canalisation", "douche", "baignoire", "lavabo", "plomb", "débouch", "salle de bain", "cuisine"],
  "électricité": ["prise", "tableau", "électri", "electri", "courant", "disjonct", "lumière", "luminaire", "interrupteur", "câbl", "cabl", "cuisine"],
  chauffage: ["chaudière", "chaudiere", "radiateur", "chauffage", "pompe à chaleur", "pac", "clim", "plancher chauffant", "poêle"],
  peinture: ["peinture", "peindre", "repeindre", "papier peint", "enduit", "plafond"],
  carrelage: ["carrelage", "carreler", "faïence", "faience", "salle de bain", "douche à l'italienne"],
  "maçonnerie": ["maçon", "macon", "mur porteur", "béton", "beton", "extension", "fissure", "dalle", "terrasse", "ouverture de mur"],
  menuiserie: ["fenêtre", "fenetre", "porte", "parquet", "placard", "volet", "escalier", "dressing", "cuisine"],
  toiture: ["toit", "toiture", "tuile", "gouttière", "gouttiere", "charpente", "zinguerie", "infiltration"],
  serrurerie: ["serrure", "clé", "cle ", "claqué", "claque", "blindée", "verrou"],
  jardin: ["jardin", "haie", "élagage", "elagage", "pelouse", "arbre", "paysag"],
};

const SEED = [
  { name: "Plomberie Dupont", self: true },
  { name: "Élec'Services Martin", trades: ["électricité"], city: "Paris 12e", zones: ["75", "94"], rating: 4.9, reviews: 212, responseMinutes: 8, nextSlotDays: 2, priceLevel: 2, labels: ["Qualifelec"], description: "Mise aux normes, tableaux électriques, dépannage 7j/7." },
  { name: "Atelier Bains & Carreaux", trades: ["carrelage", "plomberie"], city: "Montreuil", zones: ["93", "75"], rating: 4.7, reviews: 88, responseMinutes: 45, nextSlotDays: 9, priceLevel: 3, labels: ["Qualibat"], description: "Salles de bain clé en main, douches à l'italienne." },
  { name: "Chauffage Confort IDF", trades: ["chauffage", "plomberie"], city: "Vincennes", zones: ["94", "75"], rating: 4.6, reviews: 154, responseMinutes: 20, nextSlotDays: 1, priceLevel: 2, labels: ["RGE", "PG gaz"], description: "Chaudières, pompes à chaleur, contrats d'entretien. Aides MaPrimeRénov'." },
  { name: "Les Peintres du Marais", trades: ["peinture"], city: "Paris 3e", zones: ["75"], rating: 4.8, reviews: 67, responseMinutes: 60, nextSlotDays: 6, priceLevel: 2, labels: [], description: "Peinture intérieure, papier peint, ravalement léger." },
  { name: "Bâti-Pro Rénovation", trades: ["maçonnerie", "carrelage", "peinture"], city: "Saint-Denis", zones: ["93", "95", "75"], rating: 4.4, reviews: 41, responseMinutes: 120, nextSlotDays: 14, priceLevel: 1, labels: ["Qualibat", "Décennale"], description: "Rénovation complète, ouverture de murs, extensions." },
  { name: "Menuiserie Lefèvre", trades: ["menuiserie"], city: "Boulogne-Billancourt", zones: ["92", "75"], rating: 4.9, reviews: 95, responseMinutes: 90, nextSlotDays: 10, priceLevel: 3, labels: ["RGE"], description: "Fenêtres, portes, parquets et agencement sur mesure." },
  { name: "Toits de Paris", trades: ["toiture"], city: "Ivry-sur-Seine", zones: ["94", "75", "92"], rating: 4.5, reviews: 58, responseMinutes: 30, nextSlotDays: 3, priceLevel: 2, labels: ["Qualibat", "Décennale"], description: "Couverture, zinguerie, recherche d'infiltrations." },
  { name: "SOS Serrure 24h", trades: ["serrurerie"], city: "Paris 15e", zones: ["75", "92"], rating: 4.3, reviews: 301, responseMinutes: 5, nextSlotDays: 0, priceLevel: 2, labels: ["A2P"], description: "Ouverture de porte, serrures haute sécurité, 24h/24." },
  { name: "Plomberie Express 94", trades: ["plomberie"], city: "Créteil", zones: ["94"], rating: 4.2, reviews: 37, responseMinutes: 25, nextSlotDays: 0, priceLevel: 1, labels: [], description: "Dépannage plomberie rapide dans le Val-de-Marne." },
  { name: "Jardins de l'Est", trades: ["jardin"], city: "Nogent-sur-Marne", zones: ["94", "93"], rating: 4.7, reviews: 49, responseMinutes: 180, nextSlotDays: 7, priceLevel: 2, labels: [], description: "Entretien de jardins, taille de haies, élagage." },
];

// La fiche de l'entreprise de l'utilisateur dans l'annuaire, tenue à jour depuis Paramètres
function selfListing(db) {
  const b = db.business;
  const l = b.listing || {};
  return {
    id: "self", self: true, name: b.name, trades: l.trades || ["plomberie", "chauffage"], city: l.city || "Paris 11e", zones: l.zones || ["75", "93", "94"],
    rating: l.rating ?? 4.8, reviews: l.reviews ?? 126, responseMinutes: 2, nextSlotDays: 1, priceLevel: l.priceLevel || 2, labels: l.labels || ["RGE"],
    description: l.description || b.extraInfo || "", visible: l.visible !== false, phone: b.ownerPhone,
  };
}

export function providers() {
  const db = load();
  if (!db.providers) {
    db.providers = SEED.filter((p) => !p.self).map((p, i) => ({ id: "pro_" + i, visible: true, phone: "06 00 00 00 " + String(10 + i), ...p }));
    db.requests = [];
    db.leads = [];
    save();
  }
  return [selfListing(db), ...db.providers].filter((p) => p.visible);
}

// ---------- Comprendre la demande ----------
const SCHEMA = {
  type: "object",
  properties: {
    resume: { type: "string", description: "La demande reformulée en une phrase simple" },
    metiers: { type: "array", items: { type: "string", enum: Object.keys(TRADES) }, description: "Métiers nécessaires, du plus important au moins important" },
    ville: { type: "string", description: "Ville ou arrondissement, vide si inconnu" },
    code_postal: { type: "string", description: "Code postal ou département (2 chiffres), vide si inconnu" },
    urgence: { type: "string", enum: ["urgent", "sous 1 mois", "pas pressé"] },
    budget: { type: "string", description: "Budget indiqué, vide sinon" },
    questions: { type: "array", items: { type: "string" }, description: "1 ou 2 précisions utiles que l'artisan demandera" },
  },
  required: ["resume", "metiers", "ville", "code_postal", "urgence", "budget", "questions"],
  additionalProperties: false,
};

export async function analyzeRequest({ text, location, urgency, photo }) {
  if (aiEnabled()) {
    try {
      const client = new Anthropic();
      const content = [];
      const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(photo || "");
      if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
      content.push({ type: "text", text: `Demande de travaux d'un particulier.\nDescription : ${text}\nLieu indiqué : ${location || "non précisé"}\nDélai choisi : ${urgency || "non précisé"}\nAnalyse la demande (et la photo si présente) pour trouver les bons artisans.` });
      const r = await client.messages.create({
        model: process.env.PRAVA_MODEL || "claude-opus-5-5", max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content }],
      });
      const out = JSON.parse(r.content.find((b) => b.type === "text").text);
      return { ...out, source: "ia" };
    } catch (e) {
      console.error("Analyse IA impossible, analyse simple utilisée :", e.message);
    }
  }
  return analyzeSimple({ text, location, urgency });
}

function analyzeSimple({ text, location, urgency }) {
  const t = ` ${(text || "").toLowerCase()} `;
  const scores = Object.entries(TRADES).map(([trade, words]) => [trade, words.filter((w) => t.includes(w)).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const cp = /\b(\d{5})\b/.exec(`${location} ${text}`)?.[1] || "";
  const urgent = /urgen|vite|aujourd|ce soir|inond|coule|plus d'eau|plus de courant|claqu/.test(t);
  return {
    resume: (text || "").trim().replace(/\s+/g, " ").slice(0, 160),
    metiers: scores.map(([trade]) => trade).slice(0, 3),
    ville: location || "",
    code_postal: cp || (/paris/i.test(location || "") ? "75" : ""),
    urgence: urgency || (urgent ? "urgent" : "sous 1 mois"),
    budget: /(\d[\d\s]*)\s?(€|euros)/i.exec(text || "")?.[0] || "",
    questions: [],
    source: "simple",
  };
}

// ---------- Choisir les meilleurs artisans ----------
export function matchProviders(need) {
  const dept = (need.code_postal || "").slice(0, 2);
  const city = (need.ville || "").toLowerCase();
  const urgent = need.urgence === "urgent";
  return providers()
    .map((p) => {
      const reasons = [];
      let score = 0;
      const tradeHits = need.metiers.filter((m) => p.trades.includes(m));
      if (tradeHits.length) { score += 30 + 10 * Math.min(tradeHits.length, 2); reasons.push(`Spécialiste ${tradeHits.join(" et ")}`); }
      const nearCity = city && city.includes(p.city.toLowerCase().split(" ")[0]);
      if (nearCity || (dept && p.zones.includes(dept))) { score += 20; reasons.push(`Intervient ${dept && p.zones.includes(dept) ? `dans le ${dept}` : `à ${p.city}`}`); }
      score += Math.max(0, (p.rating - 3.5) / 1.5) * 15;
      reasons.push(`Note ${String(p.rating).replace(".", ",")}/5 (${p.reviews} avis)`);
      const dispo = p.nextSlotDays === 0 ? "aujourd'hui" : p.nextSlotDays === 1 ? "demain" : `sous ${p.nextSlotDays} jours`;
      score += urgent ? (p.nextSlotDays <= 1 ? 10 : 0) : Math.max(0, 10 - p.nextSlotDays / 2);
      if (urgent || p.nextSlotDays <= 3) reasons.push(`Disponible ${dispo}`);
      score += p.responseMinutes <= 15 ? 5 : p.responseMinutes <= 60 ? 3 : 1;
      if (p.responseMinutes <= 15) reasons.push(p.self ? "Répond tout de suite, 24h/24 (assistant Prava)" : `Répond en ${p.responseMinutes} min en moyenne`);
      if (p.labels.length) reasons.push(`Labels : ${p.labels.join(", ")}`);
      return { ...p, phone: undefined, score: Math.round(Math.min(score, 100)), reasons, dispo, tradeHits: tradeHits.length };
    })
    .filter((p) => p.tradeHits > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export async function searchProviders(input) {
  const need = await analyzeRequest(input);
  if (input.trade && TRADES[input.trade]) need.metiers = [input.trade, ...need.metiers.filter((m) => m !== input.trade)];
  const db = load();
  providers();
  const request = { id: uid("req"), at: new Date().toISOString(), text: String(input.text || "").slice(0, 2000), location: input.location || "", photo: input.photo ? true : false, need, status: "recherche" };
  db.requests.push(request);
  save();
  const matches = matchProviders(need);
  request.matchIds = matches.map((m) => m.id);
  save();
  return { requestId: request.id, need, matches };
}

// ---------- Envoyer la demande aux artisans choisis ----------
export function sendLeads({ requestId, providerIds, name, phone, email }) {
  const db = load();
  providers();
  const req = db.requests.find((r) => r.id === requestId);
  if (!req) return { error: "Demande introuvable, recommencez la recherche." };
  if (!name || !phone) return { error: "Merci d'indiquer votre nom et votre téléphone." };
  const all = providers();
  const chosen = all.filter((p) => (providerIds || []).includes(p.id) && (req.matchIds || []).includes(p.id)).slice(0, 3);
  if (!chosen.length) return { error: "Choisissez au moins un artisan." };
  req.status = "envoyée";
  req.contact = { name, phone, email };
  for (const p of chosen) {
    db.leads.push({ id: uid("lead"), requestId, providerId: p.id, providerName: p.name, at: new Date().toISOString(), status: "nouvelle" });
    const summary = `Demande Prava : ${req.need.resume} (${req.need.ville || req.location}, ${req.need.urgence}${req.need.budget ? `, budget ${req.need.budget}` : ""}). Contact : ${name}, ${phone}.`;
    if (p.self) {
      // La demande arrive directement dans l'outil du patron : fiche client, contact à rappeler, notification
      const c = upsertClient({ name, phone, email, address: req.need.ville || req.location });
      logCall({ client_name: c.name, phone, summary: `${req.need.resume}. Lieu : ${req.need.ville || req.location}. Délai : ${req.need.urgence}.${req.need.questions?.length ? " À demander : " + req.need.questions.join(" / ") : ""}`, urgency: req.need.urgence === "urgent" ? "haute" : "normale", needs_callback: true, channel: "Prava (nouvelle demande)" });
    } else {
      sendMessage({ to: p.phone, channel: "sms", kind: "demande artisan", text: summary });
    }
  }
  sendMessage({ to: phone, channel: "sms", kind: "demande envoyée", text: `Prava : votre demande a été envoyée à ${chosen.map((p) => p.name).join(", ")}. Ils vont vous recontacter rapidement.` });
  save();
  return { ok: true, sentTo: chosen.map((p) => p.name) };
}

export function leadsForSelf() {
  const db = load();
  providers();
  return db.leads.filter((l) => l.providerId === "self").map((l) => ({ ...l, request: db.requests.find((r) => r.id === l.requestId) })).reverse();
}
