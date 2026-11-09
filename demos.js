// Profils de démonstration : chaque profil remplit l'application avec une
// entreprise, des clients, un devis, un chantier, des factures, des dépenses et
// des mails crédibles pour un métier donné. Pour préparer la démo d'un prospect,
// copiez un bloc, changez le nom, le métier, les prix, puis chargez-le depuis
// Paramètres > Démo (ou POST /api/demo {"profile": "id"}).

const sign = (b) => `\n\nCordialement,\n${b.owner}\n${b.name} · ${b.phone}`;

export const DEMOS = {
  // ---------- Profil par défaut (plombier) ----------
  dupont: {
    label: "Plomberie Dupont (plombier-chauffagiste, Paris 11e)",
    sector: "btp",
    business: {
      name: "Plomberie Dupont", owner: "Marc Dupont", phone: "01 23 45 67 89", ownerPhone: "06 12 34 56 78",
      email: "contact@plomberie-dupont.fr", address: "12 rue des Lilas, 75011 Paris", siret: "123 456 789 00012",
      extraInfo: "Zone d'intervention : Paris et petite couronne. Urgences 7j/7 avec majoration de 50 % le week-end.",
    },
    listing: null,
    rge: { numero: "QualiPAC QPAC/2026/08124", organisme: "Qualit'EnR", validite: "2027-06-30" },
    suppliers: [{ name: "Cedeo", email: "commandes.paris11@cedeo.example.fr" }, { name: "Point P", email: "agence.bastille@pointp.example.fr" }],
    extraServices: [
      { code: "PAC", label: "Pompe à chaleur air/eau 8 kW (fournie posée, mise en service)", unit: "u", price: 11500, duration: 960, cost: 6200, hours: 16, supplier: "Cedeo", aid: "pac_air_eau" },
      { code: "CET", label: "Chauffe-eau thermodynamique 200 L (fourni posé)", unit: "u", price: 3200, duration: 300, cost: 1450, hours: 5, supplier: "Cedeo", aid: "chauffe_eau_thermo" },
      { code: "DEP-FIOUL", label: "Dépose ancienne chaudière fioul et évacuation", unit: "forfait", price: 650, duration: 240, cost: 80, hours: 4 },
    ],
    aidQuote: { client: 2, title: "Pompe à chaleur + chauffe-eau thermodynamique", profile: { persons: 3, income: 36000, idf: true }, lines: [["Pompe à chaleur air/eau 8 kW (fournie posée, mise en service)", 1, "u", 11500, 6200, 16, "Cedeo", "PAC"], ["Chauffe-eau thermodynamique 200 L (fourni posé)", 1, "u", 3200, 1450, 5, "Cedeo", "CET"], ["Dépose ancienne chaudière fioul et évacuation", 1, "forfait", 650, 80, 4, null, "DEP-FIOUL"]] },
    einbox: [
      { supplier: "Cedeo", siren: "552 081 317", number: "CE-88577", label: "Mitigeur thermostatique, siphon, flexibles", ht: 218.4, age: 1 },
      { supplier: "Point P", siren: "542 097 902", number: "PP-41206", label: "Colle carrelage et joints", ht: 96.5, age: 4 },
    ],
    clients: [
      { name: "Sophie Bernard", phone: "06 11 22 33 44", email: "sophie.b@example.fr", address: "4 av. de la République, 75011 Paris", notes: "", age: 40 },
      { name: "Ahmed Benali", phone: "07 55 66 77 88", email: "ahmed.b@example.fr", address: "18 rue Oberkampf, 75011 Paris", notes: "Préfère être appelé le soir", age: 400, civ: "M. Benali" },
      { name: "Claire Martin", phone: "06 77 88 99 00", email: "claire.m@example.fr", address: "9 rue de Charonne, 75011 Paris", notes: "", age: 30 },
    ],
    quoteSent: { client: 0, title: "Remplacement chauffe-eau", lines: [["Remplacement chauffe-eau 200 L (fourni posé)", 1, "u", 1250], ["Déplacement + diagnostic", 1, "forfait", 69]] },
    appointment: { client: 1, title: "Entretien chaudière", staff: "Karim", duration: 60 },
    call: { client: 1, summary: "Demande d'entretien annuel de chaudière, rendez-vous pris." },
    project: {
      client: 1, title: "Rénovation salle de bain", staff: "Karim",
      lines: [
        ["Dépose baignoire et faïence, évacuation des gravats", 1, "forfait", 650, 60, 8, "Point P"],
        ["Douche à l'italienne (receveur extra-plat, paroi, mitigeur thermostatique)", 1, "u", 2400, 1150, 14, "Cedeo"],
        ["Carrelage sol et murs (fourni posé)", 18, "m²", 95, 32, 1.1, "Point P"],
        ["Meuble vasque, miroir lumineux et raccordements", 1, "u", 1150, 560, 5, "Cedeo"],
      ],
      steps: ["Visite et métré", "Devis signé et acompte reçu", "Commande du matériel", "Préparation du chantier", "Travaux", "Finitions et nettoyage", "Réception avec le client"],
      journal: [
        [7, "La salle de bain avant les travaux.", ["#a08a6f", "Avant travaux"], "avant", true],
        [6, "Démarrage du chantier : ancienne baignoire et faïence déposées. Évacuation des gravats faite.", ["#8a6d55", "Dépose terminée"], "pendant", true],
        [3, "Arrivées d'eau refaites pour la douche à l'italienne. Mur côté fenêtre un peu humide, à surveiller.", null, "pendant", false],
        [1, "Pose du receveur de douche terminée. Carrelage prévu cette semaine.", ["#5f8aa0", "Receveur posé"], "pendant", true],
      ],
      visit: "Pose du carrelage",
      time: [[6, 8], [5, 7.5], [3, 6], [2, 4], [1, 5.5]],
      order: { supplier: "Cedeo", lines: [["Meuble vasque 80 cm + miroir LED", 1, "u", 495], ["Kit de raccordement et siphon", 1, "u", 65]] },
      question: "Bonjour, est-ce que le carrelage gris clair a bien été commandé ?",
      answer: "Bonjour {civ}, oui : l'étape « Commande du matériel » est terminée depuis le {date}. La pose du carrelage est prévue lors du prochain passage.",
    },
    unpaid: { client: 2, title: "Dépannage fuite cuisine", lines: [["Recherche et réparation de fuite", 1, "forfait", 180], ["Déplacement", 1, "forfait", 45]] },
    expenses: [
      [9, "Point P", "Carrelage gris clair 20 m² + colle", "Matériaux et fournitures", 1188, "POINT P"],
      [8, "Cedeo", "Receveur extra-plat + mitigeur thermostatique", "Matériaux et fournitures", 846, "CEDEO"],
      [5, "TotalEnergies", "Gasoil camionnette", "Carburant et déplacements", 92.4, "TOTAL"],
      [3, "Leroy Merlin", "Disques diamant et cales", "Outillage et équipement", 64.9, null],
    ],
    mails: (b) => [
      ["julie.r@example.fr", "Julie Roux", "Fuite sous l'évier, ça coule !", "Bonjour, j'ai une fuite sous l'évier de la cuisine depuis ce matin, l'eau coule dans le meuble. Pouvez-vous venir aujourd'hui ? 06 22 33 44 55", 1, "Urgent", "haute", "Fuite active sous l'évier, demande une intervention aujourd'hui.", "Bonjour Julie,\n\nCoupez l'arrivée d'eau sous l'évier (robinet d'arrêt) en attendant. Nous vous appelons dans l'heure pour fixer le passage aujourd'hui." + sign(b), 0],
      ["p.lemoine@example.fr", "Pierre Lemoine", "Devis pour changer un ballon d'eau chaude", "Bonjour, mon ballon de 150 L a 15 ans et chauffe mal. Combien pour le remplacer ? J'habite Montreuil.", 5, "Demande de devis", "normale", "Remplacement d'un ballon 150 L à Montreuil.", "Bonjour Pierre,\n\nMerci pour votre demande. Le remplacement d'un ballon de 150 L démarre autour de 1 100 € TTC fourni posé ; pour un devis précis, nous pouvons passer voir l'installation. Choisissez un créneau ici : /reserver" + sign(b), 0],
      ["factures@cedeo.example.fr", "Cedeo", "Votre facture n° 88412", "Bonjour, veuillez trouver votre facture n° 88412 d'un montant de 312,60 € TTC, échéance fin de mois.", 20, "Facture fournisseur", "normale", "Facture Cedeo n° 88412 de 312,60 € TTC.", "", 312.6],
      ["ne-pas-repondre@urssaf.example.fr", "Urssaf", "Votre échéance du mois", "Votre prochaine échéance de cotisations est fixée au 5 du mois prochain.", 26, "Administratif", "normale", "Rappel de l'échéance Urssaf du 5 du mois prochain.", "", 0],
      ["promo@outillage.example.fr", "Outillage Pro", "-30 % sur les perceuses ce week-end", "Offre spéciale réservée aux pros.", 30, "Publicité", "basse", "Publicité.", "", 0],
    ],
    missedPhone: "06 98 76 54 32",
  },

  // ---------- Artisan 1 : électricien ----------
  electricien: {
    label: "Moreau Électricité (électricienne, Paris 15e)",
    sector: "btp",
    business: {
      name: "Moreau Électricité", owner: "Nadia Moreau", phone: "01 45 67 89 10", ownerPhone: "06 21 43 65 87",
      email: "contact@moreau-electricite.fr", address: "27 rue de la Convention, 75015 Paris", siret: "812 345 678 00021",
      languages: "français, anglais, portugais",
      extraInfo: "Électricienne certifiée Qualifelec et IRVE (bornes de recharge). Zone : Paris 15e, 14e, 7e et Hauts-de-Seine. Dépannage en urgence du lundi au samedi, majoration de 40 % après 19 h. Aide Advenir possible sur les bornes de recharge en copropriété.",
    },
    services: [
      { code: "DEP", label: "Déplacement + diagnostic", unit: "forfait", price: 69, duration: 60 },
      { code: "PANNE", label: "Dépannage panne électrique (recherche + réparation)", unit: "forfait", price: 140, duration: 90 },
      { code: "TABLEAU", label: "Remplacement tableau électrique aux normes NF C 15-100", unit: "forfait", price: 1350, duration: 420 },
      { code: "PRISE", label: "Création prise ou interrupteur", unit: "u", price: 75, duration: 30 },
      { code: "LUM", label: "Création point lumineux (spot LED encastré)", unit: "u", price: 95, duration: 45 },
      { code: "IRVE", label: "Borne de recharge 7 kW (fournie posée, certifiée IRVE)", unit: "u", price: 1490, duration: 300 },
      { code: "DIAG", label: "Diagnostic électrique complet + rapport", unit: "forfait", price: 150, duration: 90 },
      { code: "MO", label: "Main d'œuvre", unit: "h", price: 58, duration: 60 },
    ],
    staff: [
      { name: "Yanis", skills: ["électricité", "dépannage", "tableau"], zone: "Paris" },
      { name: "Léa", skills: ["électricité", "borne de recharge", "domotique"], zone: "Hauts-de-Seine" },
    ],
    listing: { trades: ["électricité"], city: "Paris 15e", zones: ["75", "92"], labels: ["Qualifelec", "IRVE"], rating: 4.9, reviews: 143, description: "Mise aux normes, tableaux électriques, bornes de recharge, dépannage rapide." },
    rge: { numero: "Qualifelec RGE n° E-E2026-4471", organisme: "Qualifelec", validite: "2027-03-31" },
    suppliers: [{ name: "Rexel", email: "agence.paris15@rexel.example.fr" }, { name: "Sonepar", email: "commandes@sonepar.example.fr" }],
    extraServices: [
      { code: "VMC-DF", label: "VMC double flux haut rendement (fournie posée)", unit: "u", price: 4800, duration: 960, cost: 2100, hours: 16, supplier: "Rexel", aid: "vmc_double_flux" },
      { code: "CET", label: "Chauffe-eau thermodynamique 200 L (fourni posé)", unit: "u", price: 3100, duration: 300, cost: 1400, hours: 5, supplier: "Rexel", aid: "chauffe_eau_thermo" },
    ],
    aidQuote: { client: 2, title: "VMC double flux + chauffe-eau thermodynamique", profile: { persons: 2, income: 52000, idf: true }, lines: [["VMC double flux haut rendement (fournie posée)", 1, "u", 4800, 2100, 16, "Rexel", "VMC-DF"], ["Chauffe-eau thermodynamique 200 L (fourni posé)", 1, "u", 3100, 1400, 5, "Rexel", "CET"]] },
    einbox: [
      { supplier: "Rexel", siren: "309 304 616", number: "RX-55387", label: "Disjoncteurs, peignes et bornier", ht: 312.8, age: 1 },
      { supplier: "Sonepar", siren: "722 007 696", number: "SO-20931", label: "Gaines ICTA et boîtes d'encastrement", ht: 128.9, age: 5 },
    ],
    clients: [
      { name: "Isabelle Garnier", phone: "06 32 54 76 98", email: "isabelle.g@example.fr", address: "8 rue Lecourbe, 75015 Paris", notes: "Parking en sous-sol, place n° 42", age: 12 },
      { name: "Thomas Lefort", phone: "07 61 82 93 04", email: "thomas.l@example.fr", address: "41 rue du Commerce, 75015 Paris", notes: "Code porte 4512B, 3e étage", age: 60, civ: "M. Lefort" },
      { name: "Hélène Petit", phone: "06 45 23 67 89", email: "helene.p@example.fr", address: "3 rue Cambronne, 75015 Paris", notes: "", age: 45 },
    ],
    quoteSent: { client: 0, title: "Borne de recharge en parking", lines: [["Borne de recharge 7 kW (fournie posée, certifiée IRVE)", 1, "u", 1490], ["Tirage de câble depuis le compteur (25 m)", 25, "m", 22], ["Déplacement + diagnostic", 1, "forfait", 69]] },
    appointment: { client: 0, title: "Visite technique borne de recharge", staff: "Léa", duration: 60 },
    call: { client: 0, summary: "Demande de visite technique pour une borne de recharge au parking, rendez-vous pris." },
    project: {
      client: 1, title: "Rénovation électrique appartement", staff: "Yanis",
      lines: [
        ["Dépose de l'ancienne installation et mise en sécurité", 1, "forfait", 750, 40, 7, "Rexel"],
        ["Remplacement tableau électrique aux normes NF C 15-100", 1, "forfait", 1350, 520, 7, "Rexel"],
        ["Création prise ou interrupteur", 22, "u", 75, 9, 0.6, "Rexel"],
        ["Création point lumineux (spot LED encastré)", 10, "u", 95, 22, 0.75, "Sonepar"],
        ["Attestation de conformité Consuel", 1, "forfait", 180, 150, 0.5],
      ],
      steps: ["Visite et diagnostic", "Devis signé et acompte reçu", "Commande du matériel", "Mise en sécurité du logement", "Travaux", "Essais et attestation Consuel", "Réception avec le client"],
      journal: [
        [7, "L'ancien tableau à fusibles avant les travaux.", ["#9a8f7a", "Avant travaux"], "avant", true],
        [6, "Installation mise en sécurité, anciens câbles déposés dans le séjour et la cuisine.", ["#7d6f5c", "Dépose terminée"], "pendant", true],
        [3, "Gaine abîmée derrière le plan de travail de la cuisine, à remplacer en plus (chiffrer avant d'en parler au client).", null, "pendant", false],
        [1, "Saignées et passage des gaines terminés dans toutes les pièces. Pose du tableau prévue au prochain passage.", ["#5d7a91", "Gaines passées"], "pendant", true],
      ],
      visit: "Pose du nouveau tableau électrique",
      time: [[6, 7], [5, 8], [4, 7], [2, 6.5], [1, 7]],
      order: { supplier: "Sonepar", lines: [["Spots LED encastrables BBC (lot de 10)", 1, "lot", 189], ["Gaine ICTA 20 mm (remplacement cuisine)", 50, "m", 0.9]] },
      question: "Bonjour, est-ce que le courant sera coupé toute la journée au prochain passage ?",
      answer: "Bonjour {civ}, le courant sera coupé environ 3 heures pendant la pose du nouveau tableau, le matin. Pensez à débrancher le congélateur ou à le garder fermé. Le matériel est arrivé : l'étape « Commande du matériel » est terminée depuis le {date}.",
    },
    unpaid: { client: 2, title: "Dépannage disjoncteur qui saute", lines: [["Dépannage panne électrique (recherche + réparation)", 1, "forfait", 140], ["Remplacement interrupteur différentiel 40 A", 1, "u", 85]] },
    expenses: [
      [9, "Rexel", "Tableau 3 rangées + disjoncteurs et différentiels", "Matériaux et fournitures", 1420.8, "REXEL"],
      [8, "Sonepar", "Câble 3G2,5 et gaines ICTA 100 m", "Matériaux et fournitures", 386.4, "SONEPAR"],
      [5, "TotalEnergies", "Gasoil utilitaire", "Carburant et déplacements", 88.7, "TOTAL"],
      [3, "Würth", "Forets, chevilles et boîtes d'encastrement", "Outillage et équipement", 54.3, null],
    ],
    mails: (b) => [
      ["marc.d@example.fr", "Marc Dumas", "Plus de courant dans la moitié de l'appart", "Bonjour, depuis ce matin plus rien ne marche dans la cuisine et la salle de bain, le disjoncteur ressaute dès que je le remonte. J'ai un bébé, pouvez-vous venir vite ? 06 54 32 10 98", 1, "Urgent", "haute", "Disjoncteur qui saute, plus de courant cuisine et salle de bain, bébé au domicile.", "Bonjour Marc,\n\nLaissez le disjoncteur baissé et débranchez les appareils de la cuisine (bouilloire, lave-linge) en attendant. Nous vous appelons dans l'heure pour passer aujourd'hui." + sign(b), 0],
      ["s.kone@example.fr", "Samir Koné", "Devis borne de recharge maison", "Bonjour, je viens d'acheter une voiture électrique, je voudrais une borne dans mon garage à Issy-les-Moulineaux. Quel prix ?", 5, "Demande de devis", "normale", "Borne de recharge dans un garage de maison à Issy.", "Bonjour Samir,\n\nMerci pour votre demande. Une borne 7 kW certifiée IRVE démarre autour de 1 650 € TTC fournie posée (crédit d'impôt possible). Pour un devis précis, nous passons voir le compteur et le garage : choisissez un créneau ici : /reserver" + sign(b), 0],
      ["factures@rexel.example.fr", "Rexel", "Votre facture n° RX-55021", "Bonjour, veuillez trouver votre facture n° RX-55021 d'un montant de 642,18 € TTC, échéance au 30.", 20, "Facture fournisseur", "normale", "Facture Rexel n° RX-55021 de 642,18 € TTC.", "", 642.18],
      ["ne-pas-repondre@urssaf.example.fr", "Urssaf", "Votre échéance du mois", "Votre prochaine échéance de cotisations est fixée au 5 du mois prochain.", 26, "Administratif", "normale", "Rappel de l'échéance Urssaf du 5 du mois prochain.", "", 0],
      ["promo@elecdirect.example.fr", "Élec Direct", "-25 % sur les spots LED", "Promo pros jusqu'à dimanche.", 30, "Publicité", "basse", "Publicité.", "", 0],
    ],
    missedPhone: "06 87 65 43 21",
  },

  // ---------- Artisan 2 : peintre ----------
  peintre: {
    label: "Fernandes Peinture & Déco (peintre, Montreuil)",
    sector: "btp",
    business: {
      name: "Fernandes Peinture & Déco", owner: "Paulo Fernandes", phone: "01 48 59 60 71", ownerPhone: "06 33 44 55 66",
      email: "contact@fernandes-peinture.fr", address: "15 rue de Paris, 93100 Montreuil", siret: "854 321 987 00015",
      languages: "français, portugais, anglais",
      extraInfo: "Peinture intérieure et extérieure, papier peint, ravalement. Zone : Montreuil, Paris Est (11e, 12e, 20e), Vincennes, Bagnolet. Visite et métré gratuits. Peintures Tollens et Seigneurie, finitions mates ou velours au choix du client.",
    },
    services: [
      { code: "VISITE", label: "Visite et métré (gratuit)", unit: "forfait", price: 0, duration: 45 },
      { code: "PREP", label: "Préparation des supports (rebouchage, ponçage, sous-couche)", unit: "m²", price: 9, duration: 0 },
      { code: "PEINT", label: "Peinture murs et plafonds, 2 couches (fournie posée)", unit: "m²", price: 28, duration: 0 },
      { code: "PP", label: "Pose de papier peint (fourni par le client)", unit: "m²", price: 32, duration: 0 },
      { code: "PORTE", label: "Peinture porte ou boiserie (2 faces)", unit: "u", price: 120, duration: 120 },
      { code: "FACADE", label: "Ravalement de façade (nettoyage + peinture)", unit: "m²", price: 55, duration: 0 },
      { code: "MO", label: "Main d'œuvre", unit: "h", price: 45, duration: 60 },
    ],
    staff: [
      { name: "Paulo", skills: ["peinture", "papier peint", "visite"], zone: "Montreuil" },
      { name: "Inès", skills: ["peinture", "ravalement"], zone: "Paris Est" },
    ],
    listing: { trades: ["peinture"], city: "Montreuil", zones: ["93", "75", "94"], labels: ["Qualibat", "Décennale"], rating: 4.8, reviews: 97, description: "Peinture intérieure, papier peint et ravalement. Visite et métré gratuits." },
    rge: { numero: "Qualibat RGE 7131 n° E-138712", organisme: "Qualibat", validite: "2027-09-30" },
    suppliers: [{ name: "Tollens", email: "montreuil@tollens.example.fr" }, { name: "Seigneurie", email: "commandes@seigneurie.example.fr" }],
    extraServices: [
      { code: "ITE", label: "Isolation des murs par l'extérieur (polystyrène 140 mm + enduit)", unit: "m²", price: 165, duration: 0, cost: 62, hours: 1.4, supplier: "Seigneurie", aid: "isolation_murs_ext" },
      { code: "ITI", label: "Isolation des murs par l'intérieur (doublage isolant 100 mm)", unit: "m²", price: 78, duration: 0, cost: 28, hours: 0.8, supplier: "Seigneurie", aid: "isolation_murs_int" },
    ],
    aidQuote: { client: 2, title: "Isolation de la façade par l'extérieur", profile: { persons: 4, income: 48000, idf: true }, lines: [["Isolation des murs par l'extérieur (polystyrène 140 mm + enduit)", 95, "m²", 165, 62, 1.4, "Seigneurie", "ITE"], ["Échafaudage, protection et nettoyage", 1, "forfait", 1800, 600, 16]] },
    einbox: [
      { supplier: "Tollens", siren: "562 088 542", number: "T-31144", label: "Peinture velours blanc 15 L, rouleaux", ht: 186.3, age: 1 },
      { supplier: "Seigneurie", siren: "542 049 788", number: "SG-77810", label: "Enduit de lissage 25 kg", ht: 74.2, age: 6 },
    ],
    clients: [
      { name: "Camille Robert", phone: "06 12 98 34 76", email: "camille.r@example.fr", address: "22 rue de Bagnolet, 75020 Paris", notes: "", age: 10 },
      { name: "Jean-Marc Dubois", phone: "07 23 45 67 81", email: "jm.dubois@example.fr", address: "6 bd Rouget de Lisle, 93100 Montreuil", notes: "Chat à la maison, bien fermer les portes", age: 90, civ: "M. Dubois" },
      { name: "Sarah Cohen", phone: "06 98 12 45 37", email: "sarah.c@example.fr", address: "11 av. de Paris, 94300 Vincennes", notes: "", age: 50 },
    ],
    quoteSent: { client: 0, title: "Peinture séjour et couloir", lines: [["Préparation des supports (rebouchage, ponçage, sous-couche)", 62, "m²", 9], ["Peinture murs et plafonds, 2 couches (fournie posée)", 62, "m²", 28], ["Peinture porte ou boiserie (2 faces)", 3, "u", 120]] },
    appointment: { client: 2, title: "Visite et métré cuisine", staff: "Paulo", duration: 45 },
    call: { client: 2, summary: "Souhaite repeindre sa cuisine, visite et métré gratuits réservés." },
    project: {
      client: 1, title: "Rafraîchissement appartement 3 pièces", staff: "Paulo",
      lines: [
        ["Protection des sols et des meubles, préparation des supports", 85, "m²", 9, 1.2, 0.15, "Seigneurie"],
        ["Peinture murs et plafonds, 2 couches (fournie posée)", 85, "m²", 28, 4.5, 0.35, "Tollens"],
        ["Peinture porte ou boiserie (2 faces)", 6, "u", 120, 12, 1.5, "Tollens"],
        ["Pose de papier peint, mur de la chambre", 12, "m²", 32, 9, 0.5, "Tollens"],
      ],
      steps: ["Visite et métré", "Devis signé et acompte reçu", "Choix des teintes et commande", "Protection et préparation", "Peinture", "Finitions et nettoyage", "Réception avec le client"],
      journal: [
        [7, "Le séjour avant les travaux.", ["#b3a58e", "Avant travaux"], "avant", true],
        [6, "Sols et meubles protégés, fissures rebouchées et poncées dans le séjour et le couloir.", ["#9c8c74", "Préparation faite"], "pendant", true],
        [3, "Fissure au plafond du couloir plus profonde que prévu, à surveiller (peut-être une toile de verre à proposer).", null, "pendant", false],
        [1, "Sous-couche passée dans le séjour et la chambre. Première couche vert sauge sur le mur du séjour.", ["#8aa38a", "Sous-couche passée"], "pendant", true],
      ],
      visit: "Deuxième couche séjour et papier peint de la chambre",
      time: [[6, 7], [5, 7], [2, 6], [1, 7.5]],
      order: { supplier: "Tollens", lines: [["Papier peint intissé motif feuillage (6 rouleaux)", 6, "u", 18], ["Colle intissé 5 kg", 1, "u", 21]] },
      question: "Bonjour, est-ce que la teinte vert sauge a bien été commandée pour la chambre aussi ?",
      answer: "Bonjour {civ}, oui : l'étape « Choix des teintes et commande » est terminée depuis le {date}, le vert sauge a été commandé pour le séjour et la chambre. La pose est prévue lors du prochain passage.",
    },
    unpaid: { client: 2, title: "Peinture chambre d'enfant", lines: [["Peinture murs et plafonds, 2 couches (fournie posée)", 34, "m²", 28], ["Préparation des supports (rebouchage, ponçage, sous-couche)", 34, "m²", 9]] },
    expenses: [
      [9, "Tollens", "Peinture velours vert sauge 30 L + blanc plafond 20 L", "Matériaux et fournitures", 612.4, "TOLLENS"],
      [8, "Seigneurie", "Sous-couche et enduit de rebouchage", "Matériaux et fournitures", 214.8, "SEIGNEURIE"],
      [5, "TotalEnergies", "Gasoil utilitaire", "Carburant et déplacements", 64.2, "TOTAL"],
      [3, "Leroy Merlin", "Bâches, rubans de masquage et rouleaux", "Outillage et équipement", 76.5, null],
    ],
    mails: (b) => [
      ["n.girard@example.fr", "Nathalie Girard", "Plafond abîmé après un dégât des eaux", "Bonjour, suite à une fuite chez le voisin du dessus, mon plafond de salle de bain est taché et cloque. L'expert de l'assurance passe vendredi, il me faut un devis avant. 06 71 82 93 14", 1, "Urgent", "haute", "Dégât des eaux, devis plafond nécessaire avant le passage de l'expert vendredi.", "Bonjour Nathalie,\n\nNous pouvons passer faire le métré dès demain pour que vous ayez le devis avant vendredi. Pouvez-vous nous envoyer une photo du plafond en réponse à ce mail ?" + sign(b), 0],
      ["f.martins@example.fr", "Fabien Martins", "Ravalement façade pavillon", "Bonjour, je voudrais refaire la façade de mon pavillon à Bagnolet, environ 120 m². Vous faites ça ?", 5, "Demande de devis", "normale", "Ravalement d'une façade de pavillon d'environ 120 m² à Bagnolet.", "Bonjour Fabien,\n\nOui, nous faisons les ravalements. Pour 120 m², comptez autour de 6 500 à 7 500 € TTC selon l'état de la façade. La visite et le métré sont gratuits : choisissez un créneau ici : /reserver" + sign(b), 0],
      ["factures@tollens.example.fr", "Tollens", "Votre facture n° T-30981", "Bonjour, veuillez trouver votre facture n° T-30981 d'un montant de 528,40 € TTC, échéance fin de mois.", 20, "Facture fournisseur", "normale", "Facture Tollens n° T-30981 de 528,40 € TTC.", "", 528.4],
      ["ne-pas-repondre@urssaf.example.fr", "Urssaf", "Votre échéance du mois", "Votre prochaine échéance de cotisations est fixée au 5 du mois prochain.", 26, "Administratif", "normale", "Rappel de l'échéance Urssaf du 5 du mois prochain.", "", 0],
      ["promo@peinture-pro.example.fr", "Peinture Pro", "Pistolet airless à -20 %", "Offre réservée aux artisans.", 30, "Publicité", "basse", "Publicité.", "", 0],
    ],
    missedPhone: "06 76 54 32 19",
  },
};

export const demoList = () => Object.entries(DEMOS).map(([id, d]) => ({ id, label: d.label }));
