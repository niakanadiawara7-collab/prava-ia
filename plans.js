// Les 3 formules d'abonnement et les fonctions que chacune débloque.
export const PLANS = {
  essentiel: { label: "Essentiel", price: 79, summary: "Secrétaire téléphonique", includes: ["Répond aux appels 24h/24, 7j/7", "Repère les urgences", "Prend les rendez-vous", "SMS de confirmation au client", "Résumé de chaque appel à l'artisan", "Relais de la secrétaire, le soir et le week-end"] },
  pro: { label: "Pro", price: 149, summary: "+ devis, factures et relances", includes: ["Tout Essentiel", "Devis préparés à partir de l'appel", "Signature en ligne", "Factures d'acompte, intermédiaire et solde", "Paiement par carte en un clic", "Relances des impayés par SMS et mail"] },
  complet: { label: "Complet", price: 199, summary: "+ compta, mails, suivi de chantier et espace client", includes: ["Tout Pro", "Factures et dépenses rangées", "Dossier pour l'expert-comptable", "Tri des mails et réponses préparées", "Suivi de chantier avec photos", "Espace client : avancement, photos, factures, messages"] },
};

const ORDER = ["essentiel", "pro", "complet"];
// Formule minimale pour chaque fonction
const FEATURE_PLAN = { devis: "pro", factures: "pro", compta: "complet", mails: "complet", chantiers: "complet" };

export function allows(business, feature) {
  const need = FEATURE_PLAN[feature];
  if (!need) return true;
  return ORDER.indexOf(business?.plan || "complet") >= ORDER.indexOf(need);
}

export function planFeatures(business) {
  return Object.fromEntries(Object.keys(FEATURE_PLAN).map((f) => [f, allows(business, f)]));
}

// Catégories de dépenses (ici car utilisées au chargement des outils de l'IA)
export const EXPENSE_CATEGORIES = ["Matériaux et fournitures", "Carburant et déplacements", "Outillage et équipement", "Sous-traitance", "Assurances", "Téléphone et internet", "Repas", "Loyer et charges", "Autre"];
