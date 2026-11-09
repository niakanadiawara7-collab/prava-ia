// L'assistant IA : un appel Claude avec des outils métier, en boucle jusqu'à la réponse finale.
// Deux modes : "accueil" (répond aux clients au téléphone, WhatsApp, SMS, email…)
// et "patron" (le dirigeant pilote son activité en langage naturel).
import Anthropic from "@anthropic-ai/sdk";
import { load, save, uid, localISO } from "./db.js";
import { SECTORS } from "./sectors.js";
import * as ops from "./ops.js";
import * as billing from "./billing.js";
import { allows, EXPENSE_CATEGORIES } from "./plans.js";
import { GESTES, computeAids } from "./aides.js";

const MODEL = process.env.PRAVA_MODEL || "claude-opus-5-5";
const EFFORT = process.env.PRAVA_EFFORT || "low"; // conversation en direct : on privilégie la rapidité
let client = null;

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------- Outils ----------
const T = (name, description, properties, required = []) => ({ name, description, input_schema: { type: "object", properties, required } });
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });

const contactProps = {
  client_name: str("Nom et prénom du client"),
  phone: str("Téléphone du client"),
  email: str("Email du client, si donné"),
  address: str("Adresse (intervention, livraison…), si utile"),
};

const TOOLS = {
  lookup_client: T("lookup_client", "Cherche un client existant par téléphone ou nom, avec son historique (rendez-vous, devis, appels).", { query: str("Téléphone ou nom") }, ["query"]),
  check_availability: T("check_availability", "Liste les créneaux libres de l'agenda. À appeler avant de proposer un horaire.", {
    date_from: str("Premier jour à regarder, format AAAA-MM-JJ"),
    days: num("Nombre de jours à regarder (1 à 14), 3 par défaut"),
    duration_minutes: num("Durée du rendez-vous en minutes (voir le catalogue)"),
  }, ["date_from"]),
  book_appointment: T("book_appointment", "Réserve un rendez-vous / une réservation / une intervention et envoie la confirmation au client. Seulement après accord du client sur le créneau.", {
    ...contactProps,
    start: str("Début, heure locale, format AAAA-MM-JJTHH:MM"),
    duration_minutes: num("Durée en minutes"),
    title: str("Objet court (ex. : Fuite sous évier, Table pour 4, Consultation)"),
    skill: str("Compétence requise, pour choisir le bon membre de l'équipe (ex. : électricité)"),
    party_size: num("Nombre de personnes (restaurant)"),
    notes: str("Informations utiles : allergies, code d'accès, symptômes, pièces à apporter…"),
  }, ["client_name", "phone", "start", "duration_minutes", "title"]),
  move_appointment: T("move_appointment", "Déplace ou annule un rendez-vous existant (trouver son id avec lookup_client puis check_availability).", {
    appointment_id: str("Id du rendez-vous"), new_start: str("Nouveau début AAAA-MM-JJTHH:MM"), cancel: { type: "boolean", description: "true pour annuler" },
  }, ["appointment_id"]),
  create_quote: T("create_quote", "Crée un devis (ou estimation) à partir du catalogue de prix et l'envoie au client avec un lien de signature électronique et d'acompte.", {
    ...contactProps,
    title: str("Objet du devis"),
    lines: { type: "array", description: "Lignes du devis", items: { type: "object", properties: { code: str("Code du catalogue, si la prestation y est"), label: str("Libellé"), qty: num("Quantité"), unit: str("Unité"), unit_price: num("Prix unitaire HT, seulement si hors catalogue") }, required: ["label", "qty"] } },
    tva: num("Taux de TVA en %, si différent du taux par défaut"),
    notes: str("Conditions, délais, remarques"),
    aid_profile: { type: "object", description: "Rénovation énergétique : profil du foyer pour calculer MaPrimeRénov' et la prime CEE sur le devis", properties: { persons: num("Personnes dans le foyer"), income: num("Revenu fiscal de référence"), idf: { type: "boolean", description: "Île-de-France" } } },
  }, ["client_name", "title", "lines"]),
  save_call_summary: T("save_call_summary", "Enregistre le résumé de la conversation dans la fiche client et l'envoie au patron. À appeler une fois à la fin de chaque échange (ou dès qu'une urgence est identifiée).", {
    client_name: str("Nom du client"), phone: str("Téléphone"),
    summary: str("Résumé en 2-3 phrases : besoin, ce qui a été fait (RDV, devis), ce qui reste à faire"),
    urgency: { type: "string", enum: ["faible", "normale", "haute", "urgente"] },
    needs_callback: { type: "boolean", description: "Le patron doit-il rappeler ?" },
  }, ["summary", "urgency"]),
  // Outils réservés au patron
  get_agenda: T("get_agenda", "Liste les rendez-vous entre deux dates.", { date_from: str("AAAA-MM-JJ"), date_to: str("AAAA-MM-JJ") }, ["date_from"]),
  get_stats: T("get_stats", "Chiffres clés : appels, devis, taux de conversion, CA signé, impayés, devis en attente.", {}),
  convert_quote_to_invoice: T("convert_quote_to_invoice", "Transforme un devis en facture et l'envoie au client.", { quote_number: str("Numéro du devis, ex. D-2026-0001") }, ["quote_number"]),
  create_invoice_from_report: T("create_invoice_from_report", "À partir d'un rapport d'intervention dicté, crée directement la facture (et le compte rendu).", {
    ...contactProps, title: str("Objet"), report_text: str("Compte rendu propre de l'intervention"),
    lines: { type: "array", items: { type: "object", properties: { code: str("Code catalogue"), label: str("Libellé"), qty: num("Quantité"), unit: str("Unité"), unit_price: num("Prix HT si hors catalogue") }, required: ["label", "qty"] } },
  }, ["client_name", "report_text", "lines"]),
  send_message: T("send_message", "Envoie un SMS, WhatsApp ou email à un client.", { client_name: str("Nom du client"), phone: str("Téléphone (si pas de nom)"), channel: { type: "string", enum: ["sms", "whatsapp", "email"] }, text: str("Message") }, ["channel", "text"]),
  project_status: T("project_status", "Donne l'avancement d'un chantier (ou dossier, commande) à un client qui le demande : étapes faites, prochaine étape, date de fin prévue.", { query: str("Nom ou téléphone du client") }, ["query"]),
  list_projects: T("list_projects", "Liste les chantiers avec leur avancement, la prochaine étape et les retards.", { status: { type: "string", enum: ["en cours", "terminé"] } }),
  create_project: T("create_project", "Ouvre le suivi d'un chantier (souvent à partir d'un devis signé). Le client reçoit un lien de suivi.", {
    quote_id: str("Numéro du devis, ex. D-2026-0001 (facultatif)"), ...contactProps, title: str("Nom du chantier"), staff: str("Responsable du chantier"),
    start_date: str("Début AAAA-MM-JJ"), end_date: str("Fin prévue AAAA-MM-JJ"),
  }),
  project_update: T("project_update", "Met à jour un chantier : coche une étape terminée et/ou ajoute une note au journal de chantier. Le client est prévenu par SMS quand une étape est finie, et quand la note lui est partagée.", {
    project: str("Nom du client ou du chantier"), step_done: str("Étape terminée (nom de l'étape)"), note: str("Note pour le journal de chantier"), share_with_client: { type: "boolean", description: "Partager la note avec le client" },
  }, ["project"]),
  create_invoice: T("create_invoice", "Crée une facture à partir d'un devis signé : acompte, situation intermédiaire, solde ou facture complète. Le client la reçoit par SMS et mail avec un lien de paiement par carte.", {
    quote_number: str("Numéro du devis, ex. D-2026-0001"), kind: { type: "string", enum: ["acompte", "intermédiaire", "solde", "facture"] }, percent: num("Pourcentage du devis HT pour un acompte ou une situation (facultatif)"),
  }, ["quote_number", "kind"]),
  get_accounting: T("get_accounting", "Point comptable sur une période : ventes, encaissements, dépenses par catégorie, TVA estimée à reverser, justificatifs manquants.", { from: str("Début AAAA-MM-JJ"), to: str("Fin AAAA-MM-JJ") }),
  add_expense: T("add_expense", "Enregistre une dépense (achat de matériel, carburant…) dictée par le patron.", {
    supplier: str("Fournisseur"), label: str("Ce qui a été acheté"), category: { type: "string", enum: EXPENSE_CATEGORIES }, ttc: num("Montant TTC en euros"), tvaRate: num("Taux de TVA (20 par défaut)"), date: str("AAAA-MM-JJ"),
  }, ["label", "ttc"]),
  list_mails: T("list_mails", "Liste les mails reçus à traiter, triés par catégorie, avec un résumé et la réponse préparée.", {}),
  add_visit: T("add_visit", "Programme le prochain passage sur un chantier ; le client est prévenu et peut répondre « Je serai là ».", { project: str("Nom du client ou du chantier"), start: str("AAAA-MM-JJTHH:MM"), label: str("Ce qui sera fait") }, ["project", "start"]),
  estimate_aids: T("estimate_aids", "Estime les aides à la rénovation énergétique (MaPrimeRénov' + prime CEE) et le reste à charge pour un projet : pompe à chaleur, chauffe-eau thermodynamique ou solaire, isolation, VMC double flux, fenêtres, poêle ou chaudière à granulés. Montants indicatifs.", {
    gestures: { type: "array", description: "Travaux envisagés", items: { type: "object", properties: { code: { type: "string", enum: Object.keys(GESTES) }, qty: num("Quantité (m² pour l'isolation, nombre d'équipements sinon)"), price_ht: num("Prix HT estimé du poste, depuis le catalogue si possible") }, required: ["code"] } },
    persons: num("Nombre de personnes dans le foyer"), income: num("Revenu fiscal de référence du foyer (€)"), idf: { type: "boolean", description: "Logement en Île-de-France" },
  }, ["gestures"]),
  run_campaign: T("run_campaign", "Campagne de relance des anciens clients (entretien annuel, nouvelle carte, révision…).", { text: str("Message, avec {client} et {entreprise} comme variables (facultatif)"), inactive_days: num("Clients sans rendez-vous depuis N jours (300 par défaut)") }),
};

const MODES = {
  accueil: ["lookup_client", "check_availability", "book_appointment", "move_appointment", "create_quote", "estimate_aids", "project_status", "save_call_summary"],
  patron: ["lookup_client", "check_availability", "book_appointment", "move_appointment", "create_quote", "get_agenda", "get_stats", "convert_quote_to_invoice", "create_invoice", "create_invoice_from_report", "send_message", "run_campaign", "estimate_aids", "list_projects", "create_project", "project_update", "add_visit", "get_accounting", "add_expense", "list_mails"],
};
// Outils débloqués selon la formule de l'entreprise
const TOOL_FEATURE = { create_quote: "devis", convert_quote_to_invoice: "factures", create_invoice: "factures", create_invoice_from_report: "factures", project_status: "chantiers", list_projects: "chantiers", create_project: "chantiers", project_update: "chantiers", add_visit: "chantiers", get_accounting: "compta", add_expense: "compta", list_mails: "mails" };

function runTool(name, input, ctx) {
  const db = load();
  switch (name) {
    case "lookup_client": return ops.lookupClient(input.query);
    case "check_availability": return ops.availableSlots(input);
    case "book_appointment": return ops.bookAppointment(input, ctx.replyChannel);
    case "move_appointment": return ops.moveAppointment(input);
    case "create_quote": return ops.createQuote({ ...input, source: ctx.channel }, ctx.replyChannel);
    case "save_call_summary": return ops.logCall({ ...input, channel: ctx.channel, transcript: ctx.conversationId });
    case "get_agenda": return ops.agenda(input);
    case "get_stats": return ops.stats();
    case "convert_quote_to_invoice": return ops.convertQuoteToInvoice(input.quote_number);
    case "create_invoice_from_report": return ops.createInvoiceFromReport(input);
    case "send_message": {
      const c = input.client_name || input.phone ? ops.upsertClient({ name: input.client_name, phone: input.phone }) : null;
      return ops.sendMessage({ clientId: c?.id, channel: input.channel, kind: "message", text: input.text });
    }
    case "run_campaign": return ops.runCampaign(input);
    case "estimate_aids": {
      const lines = (input.gestures || []).map((g) => { const svc = db.services.find((s) => s.aid === g.code); return { label: svc?.label || GESTES[g.code]?.label || g.code, qty: Number(g.qty) || 1, unit: svc?.unit || "u", unitPrice: g.price_ht != null ? Number(g.price_ht) / (Number(g.qty) || 1) : svc?.price || 0, aid: g.code }; });
      const r = computeAids({ lines, tva: 5.5 }, { persons: input.persons, income: input.income, idf: input.idf });
      return r ? { ...r, rappel: "Montants indicatifs. Le dossier MaPrimeRénov' se dépose avant de signer le devis. L'entreprise doit être RGE." } : { error: "Aucun geste éligible" };
    }
    case "create_invoice": return billing.createInvoice({ quote: input.quote_number, kind: input.kind, percent: input.percent });
    case "get_accounting": return billing.accountingSummary(input);
    case "add_expense": return billing.addExpense({ ...input, source: "dicté" });
    case "list_mails": return (db.mails || []).filter((m) => m.status === "à traiter").map((m) => ({ id: m.id, de: m.fromName, objet: m.subject, categorie: m.category, priorite: m.priority, resume: m.summary, reponse_preparee: m.draft }));
    case "add_visit": {
      const p = ops.findProject(input.project);
      return p ? billing.addVisit(p.id, input) : { error: "Aucun chantier trouvé à ce nom" };
    }
    case "project_status": {
      const p = ops.findProject(input.query);
      if (!p) return { error: "Aucun chantier trouvé à ce nom" };
      const v = ops.publicProject(p.id);
      return { ...v, journal: v.journal.slice(-3).map((j) => `${j.at.slice(0, 10)} : ${j.text}`) };
    }
    case "list_projects": return ops.listProjects(input).map((p) => ({ ...p, journal: p.journal.slice(-3).map((j) => `${j.at.slice(0, 10)} ${j.author} : ${j.text}`) }));
    case "create_project": return ops.createProject(input);
    case "project_update": {
      const out = {};
      if (input.step_done) Object.assign(out, ops.completeStep({ project: input.project, step: input.step_done }));
      if (input.note && !out.error) Object.assign(out, ops.addJournal({ project: input.project, text: input.note, share: input.share_with_client }));
      return out;
    }
    default: return { error: "Outil inconnu " + name, db: !!db };
  }
}

// ---------- Consignes ----------
function systemPrompt(mode, channel) {
  const db = load();
  const b = db.business;
  const s = SECTORS[b.sector] || SECTORS.autre;
  const now = new Date();
  const catalogue = db.services.map((x) => `- ${x.code} | ${x.label} | ${x.price} € HT / ${x.unit}${x.duration ? ` | durée ${x.duration} min` : ""}`).join("\n");
  const hours = Object.entries(db.hours).map(([d, r]) => `${d} : ${r.length ? r.join(", ") : "fermé"}`).join(" ; ");
  const staff = db.staff.map((x) => `${x.name}${x.skills.length ? ` (${x.skills.join(", ")})` : ""}${x.zone ? ` zone ${x.zone}` : ""}`).join(", ");
  const common = `Entreprise : ${b.name} — ${s.label}
Responsable : ${b.owner}. Adresse : ${b.address}. Téléphone : ${b.phone}. Email : ${b.email}.
Horaires : ${hours}
Équipe : ${staff}
TVA par défaut : ${b.tva} %. Acompte demandé à la signature : ${b.depositPercent} %.
Infos complémentaires : ${b.extraInfo || "aucune"}
Catalogue de prix (bibliothèque de prix, code | libellé | prix | durée) :
${catalogue}
Le document commercial s'appelle ici « ${s.docLabel} » et un rendez-vous s'appelle « ${s.appointmentLabel} ».
Nous sommes le ${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} (heure de Paris ; l'heure exacte est indiquée dans chaque message).`;

  if (mode === "patron") {
    return `Tu es Prava, l'assistant personnel de ${b.owner}, dirigeant(e) de ${b.name}. Tu l'aides à piloter son activité : agenda, devis, factures, relances, chiffres, messages aux clients, rapports d'intervention dictés.
${common}
Réponds de façon brève et directe (il ou elle est souvent sur le terrain et t'écoute peut-être à voix haute) : va droit au but, chiffres d'abord. Utilise les outils pour toute donnée ; n'invente jamais un chiffre. Pour le suivi des chantiers, quand le patron dit par exemple « chez Benali le carrelage est fini », coche l'étape correspondante et ajoute une note avec project_update ; partage la note avec le client seulement si c'est une info utile pour lui (pas un souci interne). Factures : create_invoice fait l'acompte, la situation intermédiaire ou le solde d'un devis ; le client reçoit un lien de paiement par carte et les relances partent seules. Compta : get_accounting pour un point, add_expense pour une dépense dictée. Mails : list_mails pour lire les mails à traiter et leur réponse préparée. Quand un rapport d'intervention est dicté, reformule-le proprement, déduis les lignes depuis le catalogue et crée la facture. Confirme chaque action effectuée en une phrase.`;
  }
  const voice = channel === "téléphone";
  return `Tu es l'assistant(e) d'accueil de ${b.name}. Tu réponds aux clients sur le canal « ${channel} » au nom de l'entreprise, 24 h/24, avec chaleur et professionnalisme.
${common}
Règles du métier :
${s.rules.map((r) => "- " + r).join("\n")}
Ce que tu fais :
- Comprendre le besoin, poser une question à la fois, et récupérer nom + téléphone (et adresse si utile).
- Proposer des créneaux réels (check_availability) puis réserver (book_appointment) une fois que le client a choisi.
${allows(b, "devis") ? `- Établir un ${s.docLabel.toLowerCase()} avec create_quote à partir du catalogue quand le client veut un prix. Si la prestation n'est pas au catalogue, dis que le responsable confirmera le prix et note-le dans le résumé.` : `- Pour un prix ou un ${s.docLabel.toLowerCase()}, note la demande dans le résumé : ${b.owner} l'enverra lui-même.`}
- Urgence (fuite, panne, plus de chauffage, danger…) : rassure, donne les gestes de sécurité simples, et appelle tout de suite save_call_summary avec urgency « urgente » et needs_callback pour que ${b.owner} soit prévenu en priorité.
- Si le client envoie une photo, décris ce que tu vois et estime les quantités (surface, nombre d'éléments…) pour le devis, en précisant que c'est une estimation.
- Rénovation énergétique (pompe à chaleur, isolation, chauffe-eau thermodynamique, VMC…) : demande la taille du foyer, le revenu fiscal approximatif et si le logement est en Île-de-France, puis donne une estimation des aides avec estimate_aids (MaPrimeRénov' + prime CEE, reste à charge), en précisant que c'est indicatif et que le dossier se dépose avant de signer.
- Si un client demande où en est son chantier (ou dossier, commande), utilise project_status et réponds simplement : étapes faites, prochaine étape, date prévue.
- Avant de terminer, appelle save_call_summary avec le niveau d'urgence.
- Langues : réponds dans la langue du client (${b.languages || "français"} et toute autre).
- N'invente jamais une information (prix, disponibilité, politique) qui n'est pas ci-dessus. Si tu ne sais pas, propose que ${b.owner} rappelle.
${voice ? "- C'est un appel téléphonique : phrases courtes et naturelles, pas de listes, pas de markdown, pas d'émoji, dis les heures comme à l'oral (« 14 heures 30 »). Ne propose que 2 ou 3 créneaux à la fois." : "- Réponses courtes adaptées à la messagerie, sans markdown lourd."}`;
}

// ---------- Boucle de conversation ----------
export async function chat({ conversationId, mode = "accueil", channel = "chat", text, images = [] }) {
  const db = load();
  if (!aiEnabled()) {
    return { conversationId: conversationId || uid("cnv"), reply: "⚠️ Mode démo : la clé ANTHROPIC_API_KEY n'est pas configurée, l'IA ne peut pas répondre. Toutes les autres fonctions (agenda, devis PDF, signature, automatisations, tableau de bord) marchent. Voir le README pour ajouter la clé.", actions: [] };
  }
  client ||= new Anthropic();
  const id = conversationId || uid("cnv");
  const conv = (db.conversations[id] ||= { id, mode, channel, startedAt: new Date().toISOString(), messages: [] });
  const content = [];
  for (const img of images.slice(0, 4)) {
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(img);
    if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  // L'heure va dans le message et pas dans les consignes, pour que les consignes restent en cache
  content.push({ type: "text", text: `[${localISO(new Date()).slice(11)}] ${text || "(photo envoyée)"}` });
  conv.messages.push({ role: "user", content });

  const replyChannel = ["whatsapp", "email"].includes(channel) ? channel : "sms";
  const ctx = { channel, replyChannel, conversationId: id };
  const tools = MODES[mode].filter((n) => allows(db.business, TOOL_FEATURE[n])).map((n) => TOOLS[n]);
  const system = systemPrompt(mode, channel);
  const actions = [];

  for (let i = 0; i < 10; i++) {
    const response = await createMessage({ system, tools, messages: conv.messages });
    conv.messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "refusal") {
      save();
      return { conversationId: id, reply: "Je ne peux pas traiter cette demande. Le responsable va vous recontacter.", actions };
    }
    if (response.stop_reason === "pause_turn") continue;
    const uses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) {
      save();
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      return { conversationId: id, reply, actions };
    }
    const results = [];
    for (const u of uses) {
      let out;
      try { out = runTool(u.name, u.input, ctx); } catch (e) { out = { error: e.message }; }
      actions.push({ tool: u.name, input: u.input, result: out });
      results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out), is_error: Boolean(out && out.error) });
    }
    conv.messages.push({ role: "user", content: results });
  }
  save();
  return { conversationId: id, reply: "Un instant, je transmets votre demande au responsable.", actions };
}

// Réponse structurée (JSON) : tri des mails, lecture des tickets
export async function aiJson({ content, schema }) {
  client ||= new Anthropic();
  const r = await client.messages.create({ model: MODEL, max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content }] });
  return JSON.parse(r.content.find((b) => b.type === "text").text);
}

async function createMessage({ system, tools, messages }) {
  // cache_control : les consignes, le catalogue et l'historique sont mis en cache d'un message à l'autre (coût divisé ~10 sur ces tokens)
  const params = { model: MODEL, max_tokens: 16000, system, tools, messages, output_config: { effort: EFFORT }, cache_control: { type: "ephemeral" } };
  try {
    // Repli automatique côté serveur si le modèle décline une requête
    return await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) return client.messages.create(params);
    throw e;
  }
}
