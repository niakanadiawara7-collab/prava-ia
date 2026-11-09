// Profils métiers : chaque secteur adapte le vocabulaire, le catalogue de prix,
// les types de rendez-vous et les règles de l'assistant. Ajouter un secteur =
// ajouter un objet ici.

const SEMAINE = { lun: ["08:00-12:00", "14:00-18:00"], mar: ["08:00-12:00", "14:00-18:00"], mer: ["08:00-12:00", "14:00-18:00"], jeu: ["08:00-12:00", "14:00-18:00"], ven: ["08:00-12:00", "14:00-18:00"], sam: [], dim: [] };

export const SECTORS = {
  btp: {
    label: "Artisan du bâtiment (plombier, électricien, chauffagiste…)",
    docLabel: "Devis",
    appointmentLabel: "Intervention",
    hours: SEMAINE,
    tva: 10,
    rules: [
      "Qualifie la demande : nature de la panne ou des travaux, adresse du chantier, urgence (fuite, panne de chauffage, coupure électrique = urgent).",
      "Pour une urgence, propose le premier créneau disponible et marque l'appel comme urgent.",
      "Le devis de déplacement + diagnostic peut être fait tout de suite ; pour de gros travaux, propose une visite technique.",
      "TVA à 10 % pour la rénovation d'un logement de plus de 2 ans, 20 % sinon.",
    ],
    services: [
      { code: "DEP", label: "Déplacement + diagnostic", unit: "forfait", price: 69, duration: 60 },
      { code: "FUITE", label: "Recherche et réparation de fuite", unit: "forfait", price: 150, duration: 90 },
      { code: "CHAUFFE", label: "Remplacement chauffe-eau 200 L (fourni posé)", unit: "u", price: 1250, duration: 240 },
      { code: "ENT-CHAUD", label: "Entretien annuel chaudière gaz", unit: "forfait", price: 120, duration: 60 },
      { code: "PRISE", label: "Pose prise électrique", unit: "u", price: 75, duration: 30 },
      { code: "TABLEAU", label: "Remplacement tableau électrique", unit: "forfait", price: 1100, duration: 360 },
      { code: "MO", label: "Main d'œuvre", unit: "h", price: 55, duration: 60 },
    ],
    staff: [
      { name: "Karim", skills: ["plomberie", "chauffage"], zone: "Nord" },
      { name: "Julie", skills: ["électricité"], zone: "Sud" },
    ],
    campaign: "Bonjour {client}, c'est {entreprise}. Votre entretien annuel de chaudière approche : voulez-vous réserver un créneau ?",
  },
  restaurant: {
    label: "Restaurant / traiteur",
    docLabel: "Devis traiteur",
    appointmentLabel: "Réservation",
    hours: { lun: [], mar: ["12:00-14:30", "19:00-22:30"], mer: ["12:00-14:30", "19:00-22:30"], jeu: ["12:00-14:30", "19:00-22:30"], ven: ["12:00-14:30", "19:00-23:00"], sam: ["12:00-14:30", "19:00-23:00"], dim: ["12:00-15:00"] },
    tva: 10,
    rules: [
      "Pour une réservation, demande la date, l'heure, le nombre de couverts, le nom et un téléphone. Une table dure environ 1 h 30.",
      "Demande s'il y a des allergies ou une occasion particulière, et note-le.",
      "Au-delà de 12 personnes ou pour un événement privé, propose un devis groupe/traiteur.",
      "Tu peux renseigner sur la carte, les horaires et l'accès ; ne promets pas un plat qui n'est pas au catalogue.",
    ],
    services: [
      { code: "MENU-MIDI", label: "Menu du midi (entrée-plat-dessert)", unit: "pers.", price: 22, duration: 90 },
      { code: "MENU-SOIR", label: "Menu découverte du soir", unit: "pers.", price: 45, duration: 90 },
      { code: "COCKTAIL", label: "Cocktail dînatoire traiteur (12 pièces)", unit: "pers.", price: 28, duration: 0 },
      { code: "PRIVAT", label: "Privatisation de salle (soirée)", unit: "forfait", price: 600, duration: 300 },
      { code: "SERVICE", label: "Serveur pour événement", unit: "h", price: 35, duration: 0 },
    ],
    staff: [{ name: "Salle", skills: ["réservation"], zone: "", capacity: 12 }],
    campaign: "Bonjour {client}, {entreprise} lance sa nouvelle carte de saison. Envie de réserver une table ?",
  },
  medical: {
    label: "Cabinet médical / paramédical (médecin, kiné, dentiste…)",
    docLabel: "Devis de soins",
    appointmentLabel: "Consultation",
    hours: SEMAINE,
    tva: 0,
    rules: [
      "Tu es un secrétariat médical : tu ne donnes JAMAIS d'avis médical, de diagnostic ni de conseil de traitement.",
      "Si la personne décrit une urgence vitale (douleur thoracique, difficulté à respirer, malaise, saignement important), dis-lui d'appeler immédiatement le 15 (ou le 112) et n'essaie pas de prendre rendez-vous.",
      "Demande s'il s'agit d'un nouveau patient, le motif en quelques mots (sans détails médicaux inutiles), nom, date de naissance et téléphone.",
      "Les données de santé sont sensibles : ne répète pas d'informations médicales inutilement.",
    ],
    services: [
      { code: "CS", label: "Consultation", unit: "acte", price: 30, duration: 20 },
      { code: "CS-NV", label: "Première consultation (nouveau patient)", unit: "acte", price: 30, duration: 30 },
      { code: "TELE", label: "Téléconsultation", unit: "acte", price: 30, duration: 15 },
      { code: "CERTIF", label: "Certificat (sport, etc.)", unit: "acte", price: 30, duration: 15 },
    ],
    staff: [{ name: "Dr Martin", skills: ["consultation"], zone: "" }],
    campaign: "Bonjour {client}, le cabinet {entreprise} vous rappelle qu'il est temps de prévoir votre visite de suivi annuelle.",
  },
  notaire: {
    label: "Office notarial / profession juridique",
    docLabel: "Estimation de frais",
    appointmentLabel: "Rendez-vous",
    hours: SEMAINE,
    tva: 20,
    rules: [
      "Accueil d'un office notarial : identifie l'objet (vente, achat, succession, donation, mariage/PACS, création de société) et oriente vers le bon collaborateur.",
      "Ne donne pas de conseil juridique personnalisé ; tu peux expliquer les étapes générales et la liste des pièces à apporter.",
      "Les frais d'acquisition sont surtout des taxes ; toute estimation est indicative et sera confirmée par l'étude.",
      "Confidentialité stricte : ne communique aucune information sur un dossier sans être sûr de l'identité de l'appelant ; propose plutôt un rappel.",
    ],
    services: [
      { code: "RDV1", label: "Premier rendez-vous de conseil", unit: "forfait", price: 0, duration: 45 },
      { code: "COMPROMIS", label: "Rédaction compromis de vente", unit: "forfait", price: 350, duration: 60 },
      { code: "PACS", label: "Convention de PACS", unit: "forfait", price: 350, duration: 60 },
      { code: "TESTAMENT", label: "Testament authentique", unit: "forfait", price: 220, duration: 60 },
      { code: "STATUTS", label: "Statuts de société", unit: "forfait", price: 900, duration: 60 },
    ],
    staff: [{ name: "Me Dubois", skills: ["immobilier", "famille"], zone: "" }, { name: "Mme Leroy", skills: ["succession"], zone: "" }],
    campaign: "Bonjour {client}, l'office {entreprise} reste à votre disposition pour faire le point sur votre situation patrimoniale.",
  },
  fleuriste: {
    label: "Fleuriste / commerce de proximité",
    docLabel: "Devis",
    appointmentLabel: "Retrait / livraison",
    hours: { lun: [], mar: ["09:00-19:00"], mer: ["09:00-19:00"], jeu: ["09:00-19:00"], ven: ["09:00-19:30"], sam: ["09:00-19:30"], dim: ["09:00-13:00"] },
    tva: 10,
    rules: [
      "Prends les commandes : occasion (anniversaire, mariage, deuil…), budget, couleurs, date et heure de retrait ou adresse de livraison, message pour la carte.",
      "Pour un mariage ou un deuil, propose un devis détaillé.",
      "Une livraison ou un retrait se planifie comme un créneau d'agenda.",
    ],
    services: [
      { code: "BOUQ-S", label: "Bouquet de saison (taille S)", unit: "u", price: 35, duration: 15 },
      { code: "BOUQ-L", label: "Bouquet de saison (taille L)", unit: "u", price: 65, duration: 15 },
      { code: "DEUIL", label: "Couronne de deuil", unit: "u", price: 150, duration: 15 },
      { code: "MARIAGE", label: "Bouquet de mariée", unit: "u", price: 120, duration: 15 },
      { code: "LIVR", label: "Livraison (10 km)", unit: "forfait", price: 12, duration: 30 },
    ],
    staff: [{ name: "Boutique", skills: ["commande"], zone: "", capacity: 4 }],
    campaign: "Bonjour {client}, la fête des mères approche ! {entreprise} vous propose de réserver votre bouquet dès maintenant.",
  },
  garage: {
    label: "Garage automobile",
    docLabel: "Devis",
    appointmentLabel: "Rendez-vous atelier",
    hours: SEMAINE,
    tva: 20,
    rules: [
      "Demande le modèle, l'année et l'immatriculation du véhicule, le kilométrage et le symptôme.",
      "Rappelle les contrôles techniques et les révisions ; pour un véhicule non roulant, propose un dépannage.",
    ],
    services: [
      { code: "REV", label: "Révision constructeur", unit: "forfait", price: 189, duration: 120 },
      { code: "VIDANGE", label: "Vidange + filtre", unit: "forfait", price: 89, duration: 60 },
      { code: "PLAQ", label: "Plaquettes de frein avant", unit: "forfait", price: 140, duration: 60 },
      { code: "DIAG", label: "Diagnostic électronique", unit: "forfait", price: 60, duration: 45 },
      { code: "MO", label: "Main d'œuvre", unit: "h", price: 65, duration: 60 },
    ],
    staff: [{ name: "Atelier", skills: ["mécanique"], zone: "", capacity: 2 }],
    campaign: "Bonjour {client}, d'après nos dossiers la révision de votre véhicule approche. {entreprise} peut vous proposer un créneau.",
  },
  beaute: {
    label: "Coiffure / institut de beauté",
    docLabel: "Devis",
    appointmentLabel: "Rendez-vous",
    hours: { lun: [], mar: ["09:00-19:00"], mer: ["09:00-19:00"], jeu: ["09:00-20:00"], ven: ["09:00-20:00"], sam: ["09:00-18:00"], dim: [] },
    tva: 20,
    rules: ["Demande la prestation souhaitée, la longueur des cheveux si besoin, et le ou la professionnelle préférée."],
    services: [
      { code: "COUPE-F", label: "Coupe femme + brushing", unit: "u", price: 45, duration: 60 },
      { code: "COUPE-H", label: "Coupe homme", unit: "u", price: 25, duration: 30 },
      { code: "COUL", label: "Couleur", unit: "u", price: 55, duration: 90 },
      { code: "SOIN", label: "Soin du visage", unit: "u", price: 60, duration: 60 },
    ],
    staff: [{ name: "Sarah", skills: ["coiffure"], zone: "" }, { name: "Inès", skills: ["esthétique"], zone: "" }],
    campaign: "Bonjour {client}, cela fait un moment ! {entreprise} serait ravi de vous revoir. Réservez en un clic.",
  },
  autre: {
    label: "Autre activité (générique)",
    docLabel: "Devis",
    appointmentLabel: "Rendez-vous",
    hours: SEMAINE,
    tva: 20,
    rules: ["Comprends le besoin, prends les coordonnées, propose un rendez-vous ou un devis à partir du catalogue."],
    services: [
      { code: "RDV", label: "Rendez-vous découverte", unit: "forfait", price: 0, duration: 30 },
      { code: "PRESTA", label: "Prestation standard", unit: "h", price: 60, duration: 60 },
    ],
    staff: [{ name: "Équipe", skills: [], zone: "" }],
    campaign: "Bonjour {client}, {entreprise} prend de vos nouvelles. Avez-vous besoin de nous ?",
  },
};

export function sectorList() {
  return Object.entries(SECTORS).map(([id, s]) => ({ id, label: s.label }));
}

// Suivi de chantier (ou de dossier, de commande… selon le métier) : nom et étapes par défaut
export const PROJECTS = {
  btp: { label: "Chantier", steps: ["Visite et métré", "Devis signé et acompte reçu", "Commande du matériel", "Préparation du chantier", "Travaux", "Finitions et nettoyage", "Réception avec le client"] },
  garage: { label: "Réparation", steps: ["Véhicule déposé", "Diagnostic", "Pièces commandées", "Réparation", "Essai et contrôle", "Véhicule prêt"] },
  notaire: { label: "Dossier", steps: ["Premier rendez-vous", "Pièces reçues", "Compromis signé", "Délai de rétractation", "Accord de prêt", "Acte signé"] },
  restaurant: { label: "Événement", steps: ["Demande reçue", "Menu validé", "Acompte reçu", "Mise en place", "Événement terminé"] },
  fleuriste: { label: "Commande", steps: ["Commande reçue", "Fleurs commandées", "Composition", "Livraison"] },
  medical: { label: "Suivi", steps: ["Premier rendez-vous", "Examens", "Traitement", "Contrôle"] },
  beaute: { label: "Prestation", steps: ["Rendez-vous", "Prestation", "Suivi"] },
  autre: { label: "Projet", steps: ["Démarrage", "En cours", "Livraison", "Terminé"] },
};
