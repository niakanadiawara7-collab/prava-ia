// Interface patron de Prava IA (une seule page, sans framework).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eur = (n) => Number(n || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const fdate = (s) => new Date(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const fdt = (s) => new Date(s).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const localISO = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (r.status === 401 && !path.startsWith("/api/auth/")) { location.href = "/connexion"; throw new Error("Connexion requise"); }
  const data = await r.json();
  if (!r.ok || data?.error) throw new Error(data?.error || r.statusText);
  return data;
}
const post = (p, body = {}) => api(p, { method: "POST", body });
const put = (p, body) => api(p, { method: "PUT", body });

let STATE = null;
const main = $("#main");
const drawer = $("#drawer");

const badge = (status) => {
  const cls = { "signé": "ok", "payée": "ok", "confirmé": "ok", "terminé": "ok", "envoyé": "warn", "à payer": "warn", "annulé": "bad", "en retard": "bad", "en cours": "warn", urgente: "bad", haute: "warn", "à traiter": "warn", "répondu": "ok", "rangé": "ok", "présent": "ok", "absent": "bad" }[status] || "";
  return `<span class="badge ${cls}">${esc(status)}</span>`;
};

// ---------- Navigation ----------
const VIEWS = { dashboard, accueil: () => chatView("accueil"), patron: () => chatView("patron"), agenda, chantiers, devis, compta, mails, clients, messages, parametres };
const VIEW_FEATURE = { chantiers: "chantiers", devis: "devis", compta: "compta", mails: "mails" };
async function route() {
  const v = location.hash.slice(1) || "dashboard";
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  drawer.classList.add("hidden");
  STATE = await api("/api/state");
  $("#bizName").textContent = STATE.business.name;
  $("#navProjects").textContent = "🏗️ Suivi des " + plural(STATE.projectLabel).toLowerCase();
  const plan = STATE.plans[STATE.business.plan] || STATE.plans.complet;
  $("#planName").textContent = `Formule ${plan.label} · ${plan.price} €/mois`;
  document.querySelectorAll("nav [data-feature]").forEach((a) => a.classList.toggle("hidden", !STATE.features[a.dataset.feature]));
  api("/api/mails").then((ms) => { const n = ms.filter((m) => m.status === "à traiter").length; $("#mailCount").textContent = n; $("#mailCount").classList.toggle("hidden", !n || !STATE.features.mails); }).catch(() => {});
  main.innerHTML = "";
  if (VIEW_FEATURE[v] && !STATE.features[VIEW_FEATURE[v]]) return upsell(VIEW_FEATURE[v]);
  if (!STATE.aiEnabled) main.insertAdjacentHTML("beforeend", `<div class="banner">L'assistant IA n'est pas encore activé sur ce serveur : ajoutez la clé <b>ANTHROPIC_API_KEY</b> (voir le guide d'installation). Devis, factures, agenda et clients fonctionnent déjà.</div>`);
  await (VIEWS[v] || dashboard)();
}
window.addEventListener("hashchange", route);
document.addEventListener("DOMContentLoaded", route);

// ---------- Tableau de bord ----------
async function dashboard() {
  const [s, calls, leads] = await Promise.all([api("/api/stats"), api("/api/calls"), api("/api/leads")]);
  const urgent = calls.filter((c) => c.urgency === "urgente" && !c.handled);
  main.insertAdjacentHTML("beforeend", `
    <h1>Bonjour ${esc(STATE.business.owner.split(" ")[0])} 👋</h1>
    <p class="sub">${esc(s.periode)} · ${s.rdv_aujourdhui} rendez-vous aujourd'hui, ${s.rdv_a_venir} à venir</p>
    ${setupCard()}
    ${urgent.length ? `<div class="card" style="border:2px solid var(--bad)"><h2 style="color:var(--bad)">🚨 Urgences à traiter en priorité</h2>${urgent.map((c) => `<div class="row" style="border-top:1px solid var(--border);padding:8px 0"><div style="flex:1;min-width:220px"><b>${esc(c.client || c.phone || "Inconnu")}</b> ${c.phone ? `· <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : ""} <span class="muted">${fdt(c.at)}</span><br>${esc(c.summary)}</div><button class="small" data-handled="${c.id}">✓ Traité</button></div>`).join("")}</div>` : ""}
    <div class="grid g4">
      ${tile(s.appels_recus, "contacts reçus")}${tile(s.appels_manques, "appels manqués")}${STATE.features.devis ? tile(s.devis_envoyes, plural(STATE.docLabel).toLowerCase() + " envoyés") + tile(s.taux_conversion, "taux de signature") + tile(eur(s.ca_signe_ttc), "CA signé TTC") + tile(eur(s.encaisse_30j), "encaissé") + tile(s.factures_impayees.length, "factures impayées") : ""}${STATE.features.mails ? tile(s.mails_a_traiter, "mails à traiter") : ""}
    </div>
    <div class="grid g2" style="margin-top:16px">
      ${STATE.features.devis ? `<div class="card"><h2>${esc(plural(STATE.docLabel))} en attente de signature</h2>${list(s.devis_en_attente, "Aucun")}</div>
      <div class="card"><h2>Factures impayées</h2>${list(s.factures_impayees, "Aucune")}<p class="muted" style="font-size:12px;margin-bottom:0">Relances automatiques par SMS et e-mail, avec le lien de la facture.</p></div>` : ""}
      ${STATE.features.chantiers ? `<div class="card"><h2>${esc(plural(STATE.projectLabel))} en cours</h2>${list(s.chantiers_en_cours, "Aucun")}</div>` : ""}
      <div class="card"><h2>Nouvelles demandes via Prava</h2>${leads.length ? `<ul>${leads.slice(0, 6).map((l) => `<li><b>${esc(l.request?.contact?.name || "")}</b> · ${esc(l.request?.need?.resume || "")} <span class="muted">(${fdate(l.at)}, ${esc(l.request?.need?.urgence || "")})</span></li>`).join("")}</ul>` : `<p class="muted">Aucune pour l'instant. Partagez votre lien de réservation (Paramètres) sur votre site et votre fiche Google.</p>`}</div>
    </div>
    <div class="card">
      <div class="row"><h2>Derniers contacts</h2><span class="spacer"></span>
        <button id="missed">Simuler un appel manqué</button>
        <button id="auto" class="primary">Lancer les automatisations</button></div>
      <div class="table-wrap"><table><tr><th>Date</th><th>Canal</th><th>Client</th><th>Résumé</th><th>Urgence</th></tr>
      ${calls.slice(0, 12).map((c) => `<tr><td>${fdt(c.at)}</td><td>${esc(c.channel)}</td><td>${esc(c.client || c.phone || "–")}</td><td>${esc(c.summary)}${c.needsCallback ? ' <span class="badge bad">à rappeler</span>' : ""}${c.missed ? ` <span class="badge ${c.smsSent ? "ok" : "warn"}">${c.smsSent ? "SMS envoyé" : "SMS à envoyer"}</span>` : ""}</td><td>${badge(c.urgency)}</td></tr>`).join("")}
      </table></div>
      <p class="muted">Les automatisations tournent toutes les minutes : relance des devis à J+3 et J+7, rappel des rendez-vous la veille, SMS après un appel manqué, demande d'avis Google après l'intervention, relance des impayés par SMS et mail.</p>
    </div>`);
  main.querySelectorAll("[data-handled]").forEach((b) => (b.onclick = async () => { await post(`/api/calls/${b.dataset.handled}/handled`); route(); }));
  $("#auto").onclick = async () => { const r = await post("/api/automations"); alertBox(r.done.length ? `${r.done.length} action(s) : ${r.done.join(", ")}` : "Rien à faire pour l'instant."); };
  $("#missed").onclick = async () => { const phone = prompt("Numéro de l'appelant", "06 00 00 00 00"); if (phone) { await post("/api/calls/missed", { phone }); await post("/api/automations"); route(); } };
}
const plural = (label) => label.replace(/^(\S+?)(s|x)?(?=\s|$)/, (m, w, end) => w + (end || "s"));
const tile = (v, l) => `<div class="card stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
const list = (arr, empty) => arr.length ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="muted">${empty}</p>`;
// Premiers pas : ce qu'il manque pour envoyer de vrais devis et factures
function setupCard() {
  const b = STATE.business;
  if (b.demoProfile) return "";
  const steps = [
    [b.name && b.owner && b.phone && b.address, "Renseigner le nom, le responsable, le téléphone et l'adresse de l'entreprise", "#parametres"],
    [b.siret, "Ajouter votre SIRET (obligatoire sur les devis et factures)", "#parametres"],
    [b.insurance || !["btp"].includes(b.sector), "Indiquer votre assurance décennale (obligatoire sur les devis du bâtiment)", "#parametres"],
    [b.iban || STATE.stripe, "Ajouter votre IBAN pour que les clients puissent payer par virement", "#parametres"],
    [STATE.services.length && STATE.services.some((x) => x.price > 0), "Vérifier votre catalogue de prix (ou l'importer depuis Excel)", "#importer"],
    [STATE.mail, "Activer l'envoi des e-mails sur le serveur (SMTP), sinon les devis ne partent pas", null],
  ];
  const todo = steps.filter(([ok]) => !ok);
  if (!todo.length) return "";
  return `<div class="card" style="border:2px solid var(--accent)"><h2>Premiers pas (${steps.length - todo.length}/${steps.length})</h2><ul>${steps.map(([ok, label, href]) => `<li style="margin:4px 0">${ok ? "✅" : "⬜"} ${href && !ok ? `<a href="${href}">${esc(label)}</a>` : esc(label)}</li>`).join("")}</ul></div>`;
}
function alertBox(text) { const d = document.createElement("div"); d.className = "banner"; d.textContent = text; main.prepend(d); setTimeout(() => d.remove(), 6000); }

// ---------- Chat (accueil client ou assistant patron) ----------
const CHANNELS = ["téléphone", "whatsapp", "sms", "email", "site web", "instagram", "google business"];
const convIds = {};
function chatView(mode) {
  const isPatron = mode === "patron";
  main.insertAdjacentHTML("beforeend", `
    <h1>${isPatron ? "Assistant patron" : "Accueil IA"}</h1>
    <p class="sub">${isPatron
      ? "Demandez « Qu'est-ce que j'ai demain ? », « Combien de devis en attente ? », dictez un rapport d'intervention, lancez une relance…"
      : "Simulez un client qui appelle ou écrit. L'IA comprend le besoin, propose un créneau, réserve, fait le devis et vous envoie le résumé."}</p>
    <div class="card">
      <div class="row">
        ${isPatron ? "" : `<label style="margin:0">Canal</label><select id="channel" style="width:auto">${CHANNELS.map((c) => `<option>${c}</option>`).join("")}</select>`}
        <label style="margin:0"><input type="checkbox" id="speak" style="width:auto" ${isPatron ? "" : "checked"}> Lire les réponses à voix haute</label>
        <span class="spacer"></span><button id="reset">Nouvelle conversation</button>
      </div>
      <div class="chat">
        <div class="msgs" id="msgs"></div>
        <div id="preview" class="row"></div>
        <div class="composer">
          ${isPatron ? "" : `<label class="small" style="margin:0"><button type="button" id="photoBtn" title="Envoyer une photo">📷</button><input type="file" id="photo" accept="image/*" multiple class="hidden"></label>`}
          <button type="button" id="mic" class="mic" title="Parler">🎤</button>
          <textarea id="input" rows="1" placeholder="${isPatron ? "Votre demande…" : "Message du client… (ex. : Bonjour, j'ai une fuite sous mon évier)"}"></textarea>
          <button id="send" class="primary">Envoyer</button>
        </div>
      </div>
    </div>`);
  const msgs = $("#msgs"), input = $("#input");
  let images = [];
  const add = (cls, html) => { msgs.insertAdjacentHTML("beforeend", `<div class="${cls}">${html}</div>`); msgs.scrollTop = msgs.scrollHeight; };
  const greet = isPatron ? `Bonjour ${STATE.business.owner.split(" ")[0]}, que puis-je faire pour vous ?` : `${STATE.business.name}, bonjour ! Je suis l'assistant virtuel. Comment puis-je vous aider ?`;
  add("msg ai", esc(greet));

  $("#reset").onclick = () => { delete convIds[mode]; msgs.innerHTML = ""; add("msg ai", esc(greet)); };
  if (!isPatron) {
    $("#photoBtn").onclick = () => $("#photo").click();
    $("#photo").onchange = async (e) => {
      for (const f of e.target.files) images.push(await resizeImage(f));
      $("#preview").innerHTML = images.map((src) => `<img src="${src}" style="height:50px;border-radius:6px">`).join("");
    };
  }

  async function send() {
    const text = input.value.trim();
    if (!text && !images.length) return;
    add("msg user", images.map((s) => `<img src="${s}">`).join("") + esc(text));
    input.value = "";
    const sentImages = images; images = []; $("#preview").innerHTML = "";
    add("typing", "L'assistant écrit…");
    $("#send").disabled = true;
    try {
      const channel = isPatron ? "patron" : $("#channel").value;
      const r = await post("/api/chat", { conversationId: convIds[mode], mode, channel, text, images: sentImages });
      convIds[mode] = r.conversationId;
      msgs.querySelector(".typing")?.remove();
      for (const a of r.actions) add("action", describeAction(a));
      add("msg ai", esc(r.reply));
      if ($("#speak").checked) speak(r.reply);
    } catch (e) {
      msgs.querySelector(".typing")?.remove();
      add("msg ai", "Erreur : " + esc(e.message));
    }
    $("#send").disabled = false;
  }
  $("#send").onclick = send;
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  setupMic($("#mic"), input, send);
}

function describeAction({ tool, input, result }) {
  if (result?.error) return `⚠️ ${esc(tool)} : ${esc(result.error)}`;
  switch (tool) {
    case "check_availability": return `🔎 Agenda consulté (${result.length} jour(s) avec des créneaux libres)`;
    case "book_appointment": return `📅 Rendez-vous réservé : ${esc(input.title)}, ${fdt(input.start)} avec ${esc(result.appointment.staff)} · confirmation envoyée`;
    case "move_appointment": return `📅 Rendez-vous ${input.cancel ? "annulé" : "déplacé"}`;
    case "create_quote": return `📄 ${esc(STATE.docLabel)} ${esc(result.quote.number)} créé (${eur(result.quote.totals.ttc)} TTC) · <a href="${result.quote.pdf}" target="_blank">PDF</a> · <a href="${result.quote.link}" target="_blank">lien client</a>`;
    case "save_call_summary": return `📝 Résumé enregistré et envoyé au patron (urgence : ${esc(input.urgency)})`;
    case "lookup_client": return `👤 Fiche client consultée (${result.length} résultat(s))`;
    case "convert_quote_to_invoice": return `🧾 Facture ${esc(result.invoice.number)} créée · <a href="/api/invoices/${result.invoice.id}/pdf" target="_blank">PDF</a>`;
    case "create_invoice_from_report": return `🧾 Rapport transformé en facture ${esc(result.invoice.number)} · <a href="/api/invoices/${result.invoice.id}/pdf" target="_blank">PDF</a>`;
    case "send_message": return `💬 Message ${esc(input.channel)} envoyé`;
    case "run_campaign": return `📣 Campagne envoyée à ${result.envoyes} client(s)`;
    case "estimate_aids": return `🏠 Aides estimées : ${eur(result.total)} (MaPrimeRénov' ${eur(result.mpr)} + CEE ${eur(result.cee)}) · reste à charge ${eur(result.resteACharge)}`;
    case "project_status": return `🏗️ Avancement consulté : ${esc(result.title)} (${result.progress} %)`;
    case "list_projects": return `🏗️ ${result.length} ${esc(STATE.projectLabel.toLowerCase())}(s) consulté(s)`;
    case "create_project": return `🏗️ ${esc(STATE.projectLabel)} ouvert : ${esc(result.project.title)} · lien de suivi envoyé au client`;
    case "project_update": return `🏗️ ${esc(STATE.projectLabel)} mis à jour${result.project ? ` (${result.project.progress} %)` : ""}${input.step_done ? ` · étape « ${esc(input.step_done)} » cochée, client prévenu` : ""}${input.note ? " · note ajoutée" : ""}`;
    default: return `✓ ${esc(tool)}`;
  }
}

function setupMic(btn, input, send) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.title = "Reconnaissance vocale non disponible dans ce navigateur (utilisez Chrome ou Edge)"; btn.disabled = true; return; }
  let rec = null;
  btn.onclick = () => {
    if (rec) { rec.stop(); return; }
    speechSynthesis.cancel();
    rec = new SR();
    rec.lang = "fr-FR";
    rec.interimResults = true;
    rec.onresult = (e) => { input.value = Array.from(e.results).map((r) => r[0].transcript).join(""); if (e.results[e.results.length - 1].isFinal) { rec.stop(); } };
    rec.onend = () => { btn.classList.remove("on"); rec = null; if (input.value.trim()) send(); };
    btn.classList.add("on");
    rec.start();
  };
}

function speak(text) {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, ""));
  u.lang = "fr-FR";
  const v = speechSynthesis.getVoices().find((v) => v.lang.startsWith("fr"));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}

function resizeImage(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = img.width * scale; c.height = img.height * scale;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.src = URL.createObjectURL(file);
  });
}

// ---------- Agenda ----------
let weekOffset = 0;
async function agenda() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + weekOffset * 7);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  const apts = await api(`/api/appointments?from=${localISO(start).slice(0, 10)}&to=${localISO(end).slice(0, 10)}`);
  const today = localISO(new Date()).slice(0, 10);
  const days = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  main.insertAdjacentHTML("beforeend", `
    <div class="row"><h1>Agenda</h1><span class="spacer"></span>
      <button id="prev">◀</button><button id="now">Cette semaine</button><button id="next">▶</button>
      <button class="primary" id="new">+ Nouveau rendez-vous</button></div>
    <p class="sub">Semaine du ${fdate(start)} · équipe : ${STATE.staff.map((s) => esc(s.name)).join(", ")}</p>
    <div class="week">${days.map((d) => {
      const key = localISO(d).slice(0, 10);
      const items = apts.filter((a) => a.start.startsWith(key));
      return `<div class="day ${key === today ? "today" : ""}"><h3>${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</h3>
        ${items.map((a) => `<div class="apt"><b>${a.start.slice(11)} · ${esc(a.title)}</b>${esc(a.client || "")}<br><span class="muted">${esc(a.staff)} · ${a.duration} min</span> ${a.status !== "confirmé" ? badge(a.status) : ""}
          <div class="row" style="margin-top:4px"><button class="small" data-cancel="${a.id}">Annuler</button></div></div>`).join("") || '<span class="muted">—</span>'}</div>`;
    }).join("")}</div>`);
  $("#prev").onclick = () => { weekOffset--; route(); };
  $("#next").onclick = () => { weekOffset++; route(); };
  $("#now").onclick = () => { weekOffset = 0; route(); };
  main.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = async () => { if (confirm("Annuler ce rendez-vous ? Le client sera prévenu.")) { await post(`/api/appointments/${b.dataset.cancel}`, { cancel: true }); route(); } }));
  $("#new").onclick = () => {
  openDrawer(`
    <h2>Nouveau rendez-vous</h2>
    <label>Client</label><input id="n_name"><label>Téléphone</label><input id="n_phone">
    <label>Objet</label><input id="n_title">
    <label>Prestation</label><select id="n_svc">${STATE.services.map((s) => `<option value="${s.duration || 60}">${esc(s.label)}</option>`).join("")}</select>
    <label>Date</label><input type="date" id="n_date" value="${today}">
    <div id="n_slots" class="row" style="margin-top:8px"></div>
    <p class="row"><button onclick="closeDrawer()">Fermer</button></p>`);
  const load = async () => {
    const slots = await api(`/api/slots?date=${$("#n_date").value}&days=1&duration=${$("#n_svc").value}`);
    $("#n_slots").innerHTML = slots[0]?.creneaux.map((h) => `<button class="small" data-h="${h}">${h}</button>`).join("") || '<span class="muted">Aucun créneau ce jour-là</span>';
    $("#n_slots").querySelectorAll("button").forEach((b) => (b.onclick = async () => {
      const r = await post("/api/appointments", { client_name: $("#n_name").value, phone: $("#n_phone").value, title: $("#n_title").value || $("#n_svc").selectedOptions[0].text, start: `${$("#n_date").value}T${b.dataset.h}`, duration_minutes: Number($("#n_svc").value) });
      if (r.error) alert(r.error); else route();
    }));
  };
  $("#n_date").onchange = load; $("#n_svc").onchange = load; load();
  };
}

function openDrawer(html) { drawer.innerHTML = html; drawer.classList.remove("hidden"); }
window.closeDrawer = () => drawer.classList.add("hidden");

// ---------- Devis & factures ----------
async function devis() {
  const [quotes, invoices] = await Promise.all([api("/api/quotes"), api("/api/invoices")]);
  main.insertAdjacentHTML("beforeend", `
    <div class="row"><h1>${esc(plural(STATE.docLabel))} &amp; factures</h1><span class="spacer"></span>
      <a href="/api/export/compta.csv"><button>Export comptable (CSV)</button></a>
      <button class="primary" id="newQ">+ Nouveau ${esc(STATE.docLabel.toLowerCase())}</button></div>
    <p class="sub">Le client reçoit un lien pour consulter et signer. Dès la signature, la facture d'acompte part avec un lien de paiement par carte ; la situation intermédiaire part quand l'étape « Travaux » est cochée, le solde quand le chantier est terminé. Relances automatiques par SMS et mail.</p>
    <div class="card"><h2>${esc(plural(STATE.docLabel))}</h2><div class="table-wrap"><table>
      <tr><th>N°</th><th>Date</th><th>Client</th><th>Objet</th><th class="num">TTC</th><th>Statut</th><th></th></tr>
      ${quotes.map((q) => `<tr><td>${esc(q.number)}</td><td>${fdate(q.createdAt)}</td><td>${esc(q.client)}</td><td>${esc(q.title)}${q.followups.length ? ` <span class="muted">(relancé J+${q.followups.join(", J+")})</span>` : ""}</td><td class="num">${eur(q.totals.ttc)}${q.aids?.total ? `<br><span class="badge ok" title="Reste à charge ${eur(q.aids.resteACharge)}">aides ${eur(q.aids.total)}</span>` : ""}</td>
        <td>${badge(q.status)}${q.depositPaid ? ` <span class="badge ok">acompte ${eur(q.depositPaid)}</span>` : ""}</td>
        <td class="row"><a href="/api/quotes/${q.id}/pdf" target="_blank"><button class="small">PDF</button></a><a href="/q/${q.id}" target="_blank"><button class="small">Lien client</button></a>
        ${q.invoiced || q.status !== "signé" || !STATE.features.factures ? "" : `${invoices.some((i) => i.quoteId === q.id && i.kind === "acompte") ? "" : `<button class="small" data-invk="${q.id}|acompte">Acompte</button>`}<button class="small" data-invk="${q.id}|intermédiaire">Situation</button><button class="small" data-invk="${q.id}|facture">${invoices.some((i) => i.quoteId === q.id) ? "Solde" : "Facture"}</button>`}${!STATE.features.chantiers ? "" : q.projectId ? `<a href="#chantiers"><button class="small">Voir le suivi</button></a>` : `<button class="small" data-prj="${q.id}">Ouvrir le suivi</button>`}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">Aucun</td></tr>'}
    </table></div></div>
    ${STATE.features.factures ? `<div class="card"><h2>Factures</h2><div class="table-wrap"><table>
      <tr><th>N°</th><th>Type</th><th>Client</th><th>Objet</th><th class="num">TTC</th><th class="num">Réglé</th><th>Échéance</th><th>Statut</th><th>E-facture</th><th></th></tr>
      ${invoices.map((i) => `<tr><td>${esc(i.number)}<br><span class="muted" style="font-size:12px">${fdate(i.createdAt)}</span></td><td>${esc(i.kindLabel)}</td><td>${esc(i.client)}</td><td>${esc(i.title)}</td><td class="num">${eur(i.totals.ttc)}</td><td class="num">${eur(i.paid)}</td><td>${fdate(i.dueDate)}</td>
        <td>${badge(i.status === "à payer" && i.dueDate < localISO(new Date()).slice(0, 10) ? "en retard" : i.status)}${i.followups?.length ? `<br><span class="muted" style="font-size:12px">${i.followups.length} relance(s)</span>` : ""}</td>
        <td>${i.einvoice?.events?.length ? `<button class="small" data-ef="${i.id}" title="Suivi de la facture électronique">${esc(i.einvoice.status)}</button><br><span class="muted" style="font-size:11px">${i.einvoice.flow === "e-invoicing" ? "pro" : "e-reporting"}</span>` : `<button class="small" data-tx="${i.id}">Transmettre</button>`}</td>
        <td class="row"><a href="/api/invoices/${i.id}/pdf" target="_blank"><button class="small">PDF</button></a><a href="/f/${i.id}" target="_blank"><button class="small">Lien de paiement</button></a>${i.status === "payée" ? "" : `<button class="small" data-paid="${i.id}">Marquer payée</button>`}</td></tr>`).join("") || '<tr><td colspan="10" class="muted">Aucune</td></tr>'}
    </table></div></div>` : ""}`);
  main.querySelectorAll("[data-invk]").forEach((b) => (b.onclick = async () => { const [quote_id, kind] = b.dataset.invk.split("|"); let msg = null; try { const r = await post("/api/invoices", { quote_id, kind }); msg = `Facture ${r.invoice.number} envoyée au client par SMS et mail, avec le lien de paiement.`; } catch (e) { alert(e.message); } await route(); if (msg) alertBox(msg); }));
  main.querySelectorAll("[data-prj]").forEach((b) => (b.onclick = async () => { const r = await post("/api/projects", { quote_id: b.dataset.prj }); location.hash = "chantiers"; projectDrawerId = r.project.id; }));
  main.querySelectorAll("[data-paid]").forEach((b) => (b.onclick = async () => { const method = prompt("Mode de règlement (virement, chèque, espèces, carte…)", "virement"); if (method === null) return; const amount = prompt("Montant reçu en € TTC (laisser vide = tout le reste à payer)", ""); if (amount === null) return; await post(`/api/invoices/${b.dataset.paid}/paid`, { method, amount: amount ? Number(amount.replace(",", ".")) : undefined }); route(); }));
  $("#newQ").onclick = quoteForm;
}

function quoteForm() {
  openDrawer(`
    <h2>Nouveau ${esc(STATE.docLabel.toLowerCase())}</h2>
    <label>Client</label><input id="q_name"><label>Téléphone</label><input id="q_phone"><label>Email</label><input id="q_email"><label>Adresse</label><input id="q_addr">
    <label>Objet</label><input id="q_title">
    <label>Lignes</label><div id="q_lines"></div><button class="small" id="q_add">+ Ligne</button>
    <label>TVA %</label><input id="q_tva" type="number" value="${STATE.business.tva}">
    <div id="q_aid" class="hidden" style="background:var(--ok-soft);border-radius:8px;padding:8px 10px;margin-top:10px"><b style="color:var(--ok)">Rénovation énergétique : aides du client</b>
      <div class="row"><div style="flex:1"><label>Personnes</label><input id="q_pers" type="number" value="2"></div><div style="flex:1"><label>Revenu fiscal</label><input id="q_inc" type="number" placeholder="ex. 32000"></div></div>
      <label style="display:flex;gap:6px;align-items:center;color:var(--text)"><input type="checkbox" id="q_idf" style="width:auto"> Île-de-France</label></div>
    <p class="row"><button class="primary" id="q_save">Créer et envoyer</button><button onclick="closeDrawer()">Annuler</button></p>`);
  const addLine = () => $("#q_lines").insertAdjacentHTML("beforeend", `<div class="row" style="margin-bottom:6px">
    <select class="l_svc" style="flex:3">${STATE.services.map((s) => `<option value="${esc(s.code)}" data-price="${s.price}" data-aid="${esc(s.aid || "")}">${esc(s.label)} (${eur(s.price)})${s.aid ? " · aides" : ""}</option>`).join("")}</select>
    <input class="l_qty" type="number" value="1" style="flex:1"></div>`);
  const checkAid = () => { const any = [...document.querySelectorAll("#q_lines .l_svc")].some((s) => s.selectedOptions[0]?.dataset.aid); $("#q_aid").classList.toggle("hidden", !any); if (any) $("#q_tva").value = 5.5; };
  $("#q_lines").onchange = checkAid;
  $("#q_add").onclick = addLine; addLine();
  $("#q_save").onclick = async () => {
    const lines = [...document.querySelectorAll("#q_lines .row")].map((r) => ({ code: $(".l_svc", r).value, label: $(".l_svc", r).selectedOptions[0].text.replace(/ \(.*\)$/, ""), qty: Number($(".l_qty", r).value) }));
    const aid_profile = $("#q_aid").classList.contains("hidden") || !$("#q_inc").value ? undefined : { persons: Number($("#q_pers").value), income: Number($("#q_inc").value), idf: $("#q_idf").checked };
    await post("/api/quotes", { client_name: $("#q_name").value, phone: $("#q_phone").value, email: $("#q_email").value, address: $("#q_addr").value, title: $("#q_title").value || "Devis", lines, tva: Number($("#q_tva").value), aid_profile });
    route();
  };
}

// ---------- Clients (mini-CRM) ----------
async function clients() {
  const cs = await api("/api/clients");
  main.insertAdjacentHTML("beforeend", `<h1>Clients</h1><p class="sub">Chaque fiche regroupe appels, résumés, rendez-vous, devis, factures et messages.</p>
    <div class="card"><div class="table-wrap"><table><tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>RDV</th><th>Devis</th></tr>
    ${cs.map((c) => `<tr class="click" data-id="${c.id}"><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td>${c.appointments}</td><td>${c.quotes}</td></tr>`).join("")}</table></div></div>`);
  main.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => clientDrawer(tr.dataset.id)));
}

async function clientDrawer(id) {
  const h = await api(`/api/clients/${id}`);
  const c = h.client;
  openDrawer(`<div class="row"><h2>${esc(c.name)}</h2><span class="spacer"></span><button onclick="closeDrawer()">✕</button></div>
    <p class="muted">${esc(c.phone)} · ${esc(c.email)}<br>${esc(c.address)}</p>
    <label>Notes</label><textarea id="c_notes" rows="2">${esc(c.notes)}</textarea><button class="small" id="c_save">Enregistrer</button>
    <h2 style="margin-top:16px">Historique des contacts</h2>${h.calls.map((x) => `<p><b>${fdt(x.at)}</b> · ${esc(x.channel)} ${badge(x.urgency)}<br>${esc(x.summary)}${x.transcript ? ` <a href="#" data-conv="${x.transcript}">transcription</a>` : ""}</p>`).join("") || '<p class="muted">—</p>'}
    <h2>Rendez-vous</h2>${h.appointments.map((a) => `<p>${fdt(a.start)} · ${esc(a.title)} ${badge(a.status)}</p>`).join("") || '<p class="muted">—</p>'}
    <h2>${esc(plural(STATE.docLabel))} &amp; factures</h2>${[...h.quotes.map((q) => ["/api/quotes/", q]), ...h.invoices.map((i) => ["/api/invoices/", i])].map(([p, q]) => `<p><a href="${p}${q.id}/pdf" target="_blank">${esc(q.number)}</a> · ${esc(q.title)} · ${eur(q.totals.ttc)} ${badge(q.status)}</p>`).join("") || '<p class="muted">—</p>'}
    <h2>Messages envoyés</h2>${h.messages.map((m) => `<p class="muted">${fdt(m.at)} · ${esc(m.channel)} · ${esc(m.text)}</p>`).join("") || '<p class="muted">—</p>'}
    <div id="transcript"></div>`);
  $("#c_save").onclick = () => put(`/api/clients/${id}`, { notes: $("#c_notes").value });
  drawer.querySelectorAll("[data-conv]").forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    const conv = await api(`/api/conversations/${a.dataset.conv}`);
    const lines = (conv?.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]).filter((b) => b.type === "text").map((b) => `<p><b>${m.role === "user" ? "Client" : "IA"} :</b> ${esc(b.text)}</p>`));
    $("#transcript").innerHTML = `<h2>Transcription</h2>${lines.join("")}`;
  }));
}

// ---------- Messages (boîte d'envoi unique) ----------
async function messages() {
  const out = await api("/api/outbox");
  main.insertAdjacentHTML("beforeend", `<div class="row"><h1>Messages envoyés</h1><span class="spacer"></span><button class="primary" id="camp">📣 Campagne de relance des anciens clients</button></div>
    <p class="sub">Tous les SMS, WhatsApp et emails envoyés par l'IA et les automatisations. ${STATE.twilio ? "Twilio est connecté : les SMS partent pour de vrai." : "Envoi simulé tant que Twilio n'est pas configuré."}</p>
    <div class="card"><div class="table-wrap"><table><tr><th>Date</th><th>Canal</th><th>Type</th><th>Destinataire</th><th>Message</th><th>État</th></tr>
    ${out.map((m) => `<tr><td>${fdt(m.at)}</td><td>${esc(m.channel)}</td><td><span class="badge">${esc(m.kind)}</span></td><td>${esc(m.client || m.to)}</td><td>${esc(m.text)}</td><td class="muted">${esc(m.status)}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">Aucun message</td></tr>'}</table></div></div>`);
  $("#camp").onclick = async () => {
    const days = prompt("Relancer les clients sans rendez-vous depuis combien de jours ?", "300");
    if (!days) return;
    const r = await post("/api/campaign", { inactive_days: Number(days) });
    alert(`${r.envoyes} message(s) envoyé(s)`); route();
  };
}

// ---------- Paramètres ----------
async function parametres() {
  const b = STATE.business;
  const field = (k, l) => `<label>${l}</label><input data-k="${k}" value="${esc(b[k])}">`;
  main.insertAdjacentHTML("beforeend", `<h1>Paramètres</h1><p class="sub">Choisissez le métier : l'IA adapte son vocabulaire, ses règles, le catalogue de prix et les horaires.</p>
    <div class="card"><h2>Formule</h2><div class="grid g4">${Object.entries(STATE.plans).map(([k, p]) => `<label style="margin:0;display:block;border:2px solid ${k === b.plan ? "var(--accent)" : "var(--border)"};border-radius:10px;padding:12px;color:var(--text);cursor:pointer">
        <input type="radio" name="plan" value="${k}" ${k === b.plan ? "checked" : ""} style="width:auto"> <b>${esc(p.label)}</b> · ${p.price} €/mois<br><span class="muted">${esc(p.summary)}</span>
        <ul style="padding-left:18px;margin:6px 0 0;font-size:12px">${p.includes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></label>`).join("")}</div>
      <p class="muted" style="font-size:12px">Changer de formule affiche ou cache les menus correspondants.</p></div>
    <div class="card"><h2>Mon compte</h2>
      <p>Connecté avec <b>${esc(STATE.account?.email || "")}</b></p>
      <p>Lien de réservation à mettre sur votre site, Google et Instagram :<br><code style="user-select:all">${esc(STATE.bookingUrl)}</code></p>
      <p class="muted" style="font-size:13px">E-mails aux clients : ${STATE.mail ? "✅ activés" : "⚠️ non configurés (les devis et factures ne partent pas, voir le guide d'installation)"} · SMS : ${STATE.twilio ? "✅ activés" : "⚠️ non configurés"} · Paiement par carte : ${STATE.stripe ? "✅ Stripe" : "virement (IBAN)"} · IA : ${STATE.aiEnabled ? "✅" : "⚠️ clé manquante"}</p>
      <div class="row"><input type="password" id="pwCur" placeholder="Mot de passe actuel" style="flex:1;min-width:160px"><input type="password" id="pwNew" placeholder="Nouveau mot de passe (8 caractères min.)" style="flex:1;min-width:160px"><button id="pwSave">Changer le mot de passe</button></div>
      <p><button id="logout">Se déconnecter</button></p></div>
    <div class="card"><h2>Quand Prava répond au téléphone</h2>
      <select id="answerMode">${[["toujours", "À chaque appel"], ["debordement", "Quand la secrétaire est déjà en ligne ou ne décroche pas (après 15 s)"], ["hors_horaires", "Le soir, le week-end, et en journée si la secrétaire ne décroche pas"]].map(([k, l]) => `<option value="${k}" ${b.answerMode === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label for="forwardNumber">Numéro du bureau ou de la secrétaire (sonne en premier)</label><input id="forwardNumber" value="${esc(b.forwardNumber || "")}" placeholder="ex. 01 23 45 67 80">
      <p class="muted" style="font-size:12px">Il faut un vrai numéro Twilio pour que ce réglage s'applique aux appels.</p>
      <button id="saveAnswer">Enregistrer</button></div>
    <div class="card"><h2>Métier</h2><div class="row"><select id="sector" style="flex:1">${STATE.sectors.map((s) => `<option value="${s.id}" ${s.id === b.sector ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
      <button class="primary" id="applySector">Appliquer le modèle</button></div>
      <p class="muted">Remplace le catalogue, l'équipe et les horaires par ceux du modèle (vos clients, devis et rendez-vous sont conservés).</p></div>
    <div class="grid g2">
      <div class="card"><h2>Entreprise</h2>${field("name", "Nom")}${field("owner", "Responsable")}${field("phone", "Téléphone")}${field("ownerPhone", "Portable du patron (résumés d'appels)")}${field("email", "Email")}${field("address", "Adresse")}${field("legalForm", "Forme juridique (ex. EI, SARL au capital de 5 000 €)")}${field("siret", "SIRET")}${field("tvaNumber", "N° de TVA intracommunautaire (vide si franchise de TVA)")}${field("insurance", "Assurance décennale (assureur, n° de contrat, zone couverte)")}${field("iban", "IBAN (affiché sur les factures pour le virement)")}${field("bic", "BIC")}${field("paymentTerms", "Délai de paiement des factures (jours)")}${field("twilioNumber", "Numéro Prava (Twilio) qui reçoit les appels")}
        ${field("tva", "TVA par défaut (%)")}${field("depositPercent", "Facture d'acompte à la signature (%)")}${field("intermediatePercent", "Situation intermédiaire quand les travaux sont faits (%)")}${field("accountantEmail", "Email de l'expert-comptable")}${field("reviewUrl", "Lien avis Google")}${field("languages", "Langues parlées par l'assistant")}
        <label>Informations pour l'assistant (zone, tarifs spéciaux, accès, FAQ…)</label><textarea data-k="extraInfo" rows="4">${esc(b.extraInfo)}</textarea>
        <p><button class="primary" id="saveBiz">Enregistrer</button></p></div>
      <div>
        <div class="card"><h2>Horaires</h2>${Object.entries(STATE.hours).map(([d, r]) => `<div class="row"><span style="width:40px">${d}</span><input data-day="${d}" value="${esc(r.join(", "))}" placeholder="fermé" style="flex:1"></div>`).join("")}
          <p class="muted">Format : 08:00-12:00, 14:00-18:00</p><button id="saveHours">Enregistrer</button></div>
        <div class="card"><h2>Équipe</h2><textarea id="staff" rows="4">${esc(STATE.staff.map((s) => [s.name, s.skills.join(" / "), s.zone, s.capacity || 1].join(" ; ")).join("\n"))}</textarea>
          <p class="muted">Une ligne par personne (ou salle) : nom ; compétences séparées par / ; zone ; nombre de rendez-vous simultanés (ex. 12 tables). L'IA attribue le rendez-vous à la bonne personne.</p><button id="saveStaff">Enregistrer</button></div>
      </div>
    </div>
    <div class="card"><h2>Catalogue de prix</h2><div class="table-wrap"><table id="svc"><tr><th>Code</th><th>Libellé</th><th>Unité</th><th>Prix HT</th><th>Durée (min)</th><th>Achat HT</th><th>Heures</th><th>Fournisseur</th><th>Aide</th><th></th></tr>
      ${STATE.services.map(svcRow).join("")}</table></div>
      <p class="row"><button id="addSvc">+ Ajouter</button><button class="primary" id="saveSvc">Enregistrer le catalogue</button></p></div>
    <div class="card"><h2>Démo et remise à zéro</h2>
      <p class="muted">⚠️ Attention : charger une démo <b>remplace toutes vos données</b> (clients, devis, factures…) par une entreprise fictive. À utiliser seulement sur un compte de démonstration.</p>
      <div class="row"><select id="demoProfile" style="flex:1">${(STATE.demos || []).map((d) => `<option value="${d.id}" ${d.id === b.demoProfile ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select>
      <button class="primary" id="loadDemo">Charger cette démo</button></div>
      <p><button id="reset">Repartir de zéro (efface clients, devis, factures)</button></p></div>`);
  main.querySelectorAll("[name=plan]").forEach((r) => (r.onchange = async () => { await put("/api/business", { plan: r.value }); route(); }));
  $("#saveAnswer").onclick = async () => { await put("/api/business", { answerMode: $("#answerMode").value, forwardNumber: $("#forwardNumber").value }); alertBox("Enregistré."); };
  $("#applySector").onclick = async () => { if (confirm("Appliquer ce modèle de métier ?")) { await post("/api/sector", { sector: $("#sector").value }); route(); } };
  $("#saveBiz").onclick = async () => { const o = {}; main.querySelectorAll("[data-k]").forEach((i) => (o[i.dataset.k] = ["tva", "depositPercent", "intermediatePercent", "paymentTerms"].includes(i.dataset.k) ? Number(i.value) : i.value)); await put("/api/business", o); route(); };
  $("#saveHours").onclick = async () => { const h = {}; main.querySelectorAll("[data-day]").forEach((i) => (h[i.dataset.day] = i.value.split(",").map((x) => x.trim()).filter(Boolean))); await put("/api/hours", { hours: h }); route(); };
  $("#saveStaff").onclick = async () => { const staff = $("#staff").value.split("\n").filter((l) => l.trim()).map((l, i) => { const [name, skills = "", zone = "", capacity = "1"] = l.split(";").map((x) => x.trim()); return { id: "stf_" + i, name, skills: skills.split("/").map((x) => x.trim()).filter(Boolean), zone, capacity: Number(capacity) || 1 }; }); await put("/api/staff", { staff }); route(); };
  $("#addSvc").onclick = () => $("#svc").insertAdjacentHTML("beforeend", svcRow({ code: "", label: "", unit: "u", price: 0, duration: 60 }));
  $("#svc").onclick = (e) => { if (e.target.dataset.del !== undefined) e.target.closest("tr").remove(); };
  $("#saveSvc").onclick = async () => { const services = [...main.querySelectorAll("#svc tr[data-svc]")].map((tr) => { const v = [...tr.querySelectorAll("input")].map((i) => i.value); const o = { code: v[0], label: v[1], unit: v[2], price: Number(v[3]), duration: Number(v[4]) || 0, supplier: v[7] || undefined, aid: tr.querySelector("select").value || undefined }; if (v[5] !== "") o.cost = Number(v[5]); if (v[6] !== "") o.hours = Number(v[6]); return o; }).filter((s) => s.label); await put("/api/services", { services }); route(); };
  $("#reset").onclick = async () => { if (confirm("Effacer tous vos clients, devis, factures, chantiers et rendez-vous ? Vos informations d'entreprise sont gardées. C'est définitif.") && prompt("Tapez EFFACER pour confirmer") === "EFFACER") { await post("/api/demo", { profile: "vide" }); location.reload(); } };
  $("#loadDemo").onclick = async () => { if (confirm("Remplacer TOUTES vos données par cette entreprise de démo ? C'est définitif.")) { await post("/api/demo", { profile: $("#demoProfile").value }); location.reload(); } };
  $("#logout").onclick = async () => { await post("/api/auth/logout"); location.href = "/connexion"; };
  $("#pwSave").onclick = async () => { try { await post("/api/auth/password", { current: $("#pwCur").value, password: $("#pwNew").value }); alertBox("Mot de passe changé."); $("#pwCur").value = $("#pwNew").value = ""; } catch (e) { alertBox(e.message); } };
}
const TRADE_LIST = ["plomberie", "électricité", "chauffage", "peinture", "carrelage", "maçonnerie", "menuiserie", "toiture", "serrurerie", "jardin"];
const svcRow = (s) => `<tr data-svc><td><input value="${esc(s.code)}" style="min-width:70px"></td><td><input value="${esc(s.label)}" style="min-width:200px"></td><td><input value="${esc(s.unit)}" style="min-width:50px"></td><td><input type="number" value="${s.price}" style="min-width:70px"></td><td><input type="number" value="${s.duration ?? ""}" style="min-width:60px"></td><td><input type="number" value="${s.cost ?? ""}" placeholder="?" style="min-width:60px"></td><td><input type="number" value="${s.hours ?? ""}" placeholder="?" style="min-width:50px"></td><td><input value="${esc(s.supplier || "")}" style="min-width:80px"></td><td><select style="min-width:90px"><option value=""></option>${Object.entries(STATE.aides?.gestes || {}).map(([k, g]) => `<option value="${k}" ${s.aid === k ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></td><td><button class="small" data-del>✕</button></td></tr>`;

// ---------- Suivi de chantier ----------
let projectDrawerId = null;
async function chantiers() {
  const ps = await api("/api/projects");
  const L = STATE.projectLabel;
  main.insertAdjacentHTML("beforeend", `
    <div class="row"><h1>Suivi des ${esc(plural(L).toLowerCase())}</h1><span class="spacer"></span><button class="primary" id="newP">+ Nouveau ${esc(L.toLowerCase())}</button></div>
    <p class="sub">Les étapes, les notes et les photos de chaque ${esc(L.toLowerCase())}. Le client a sa propre page de suivi et reçoit un SMS à chaque étape terminée.</p>
    <div class="grid g2">${ps.map((p) => `
      <div class="card click" data-p="${p.id}" style="cursor:pointer">
        <div class="row"><h2 style="margin:0">${esc(p.title)}</h2><span class="spacer"></span>${badge(p.late ? "en retard" : p.status)}</div>
        <p class="muted" style="margin:4px 0 8px">${esc(p.client)} · ${esc(p.address)}<br>Responsable : ${esc(p.staff)} · fin prévue ${p.endDate ? fdate(p.endDate) : "non fixée"}</p>
        ${bar(p.progress)}
        <p style="margin:8px 0 0">${p.nextStep ? `Prochaine étape : <b>${esc(p.nextStep)}</b>` : "Toutes les étapes sont faites"} <span class="muted">· ${p.notes} note(s)</span></p>
      </div>`).join("") || `<div class="card muted">Aucun ${esc(L.toLowerCase())} pour l'instant. Ouvrez-en un ici ou depuis un devis signé.</div>`}</div>`);
  main.querySelectorAll("[data-p]").forEach((c) => (c.onclick = () => projectDrawer(c.dataset.p)));
  $("#newP").onclick = () => {
    openDrawer(`<h2>Nouveau ${esc(L.toLowerCase())}</h2>
      <label for="p_title">Nom</label><input id="p_title" placeholder="ex. Rénovation cuisine">
      <label for="p_name">Client</label><input id="p_name"><label for="p_phone">Téléphone</label><input id="p_phone"><label for="p_addr">Adresse</label><input id="p_addr">
      <label for="p_staff">Responsable</label><select id="p_staff">${STATE.staff.map((s) => `<option>${esc(s.name)}</option>`).join("")}</select>
      <div class="row"><div style="flex:1"><label for="p_start">Début</label><input type="date" id="p_start" value="${localISO(new Date()).slice(0, 10)}"></div><div style="flex:1"><label for="p_end">Fin prévue</label><input type="date" id="p_end"></div></div>
      <p class="row"><button class="primary" id="p_save">Créer et envoyer le lien au client</button><button onclick="closeDrawer()">Annuler</button></p>`);
    $("#p_save").onclick = async () => {
      const r = await post("/api/projects", { title: $("#p_title").value, client_name: $("#p_name").value, phone: $("#p_phone").value, address: $("#p_addr").value, staff: $("#p_staff").value, start_date: $("#p_start").value, end_date: $("#p_end").value });
      await route(); projectDrawer(r.project.id);
    };
  };
  if (projectDrawerId) { const id = projectDrawerId; projectDrawerId = null; projectDrawer(id); }
}

const bar = (pct) => `<div style="height:8px;border-radius:99px;background:var(--border);overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent)"></div></div><div class="muted" style="font-size:12px;margin-top:2px">${pct} % terminé</div>`;

async function projectDrawer(id) {
  const p = await api(`/api/projects/${id}`);
  openDrawer(`<div class="row"><h2 style="margin:0">${esc(p.title)}</h2><span class="spacer"></span><button onclick="closeDrawer()">✕</button></div>
    <p class="muted">${esc(p.client)} · ${esc(p.address)}<br>Responsable : ${esc(p.staff)} · du ${fdate(p.startDate)} au ${p.endDate ? fdate(p.endDate) : "?"}</p>
    ${bar(p.progress)}
    <p class="row" style="margin-top:10px"><a href="/chantier/${p.id}" target="_blank"><button class="small">👤 Espace client</button></a><button class="small" onclick="marginDrawer('${p.id}')">💶 Marge et commandes</button>
      <label style="margin:0;display:flex;gap:6px;align-items:center"><input type="checkbox" id="pd_notify" style="width:auto" ${p.notifyClient ? "checked" : ""}> Prévenir le client à chaque étape</label></p>
    <h2 style="margin-top:14px">Étapes</h2>
    ${p.steps.map((s, i) => `<label style="display:flex;gap:8px;align-items:center;font-size:14px;color:var(--text);margin:6px 0"><input type="checkbox" data-step="${i}" style="width:auto" ${s.done ? "checked" : ""}> ${esc(s.label)} ${s.doneAt ? `<span class="muted" style="font-size:12px">${fdate(s.doneAt)}</span>` : ""}</label>`).join("")}
    <h2 style="margin-top:14px">Prochain passage</h2>
    ${(p.visits || []).filter((v) => v.start >= localISO(new Date())).sort((a, b) => a.start.localeCompare(b.start)).map((v) => `<p style="margin:4px 0">${fdt(v.start)} · ${esc(v.label)} · ${esc(v.staff)} ${v.answer ? badge(v.answer) : '<span class="badge">en attente de réponse</span>'}</p>`).join("") || '<p class="muted">Aucun passage prévu.</p>'}
    <div class="row"><input type="datetime-local" id="pv_start" style="flex:1;min-width:180px"><input id="pv_label" placeholder="ex. Pose du carrelage" style="flex:1;min-width:150px"><button class="small" id="pv_add">Prévenir le client</button></div>
    <p class="muted" style="font-size:12px;margin:4px 0">Le client reçoit un SMS et répond « Je serai là » depuis son espace.</p>
    <h2 style="margin-top:14px">Messages du client</h2>
    <div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto">${(p.messages || []).map((m) => `<div class="msg ${m.from === "client" ? "ai" : "user"}" style="max-width:90%;${m.from === "client" ? "" : "align-self:flex-end"}"><span style="font-size:11px;opacity:.75;display:block">${m.from === "client" ? esc(p.client) : m.from === "ia" ? "Prava (réponse automatique)" : esc(m.author || "Vous")} · ${fdt(m.at)}</span>${esc(m.text)}</div>`).join("") || '<p class="muted">Aucun message.</p>'}</div>
    <div class="row" style="margin-top:6px"><input id="pm_text" placeholder="Répondre au client (vous prenez le relais)" style="flex:1"><button class="small primary" id="pm_send">Envoyer</button></div>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pm_ai" style="width:auto" ${p.aiPaused ? "" : "checked"}> Prava répond automatiquement aux questions du client</label>
    <h2 style="margin-top:14px">Journal de chantier</h2>
    <label for="pd_text">Nouvelle note</label><textarea id="pd_text" rows="2" placeholder="ex. Carrelage posé, joints demain"></textarea>
    <div class="row" style="margin-top:6px"><button type="button" class="primary" id="pd_photoBtn">📷 Prendre une photo du chantier</button><input type="file" id="pd_photo" accept="image/*" capture="environment" multiple class="hidden"><select id="pd_phase" style="width:auto"><option value="">Classement auto</option><option value="avant">Avant</option><option value="pendant">Pendant</option><option value="après">Après</option></select><span id="pd_prev"></span></div>
    <p class="muted" style="font-size:12px;margin:4px 0">Sur téléphone, le bouton ouvre l'appareil photo. Les photos montrées au client apparaissent sur sa page de suivi.</p>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="pd_share" style="width:auto" checked> Montrer cette note au client (SMS + page de suivi)</label>
    <p><button class="primary" id="pd_add">Ajouter au journal</button></p>
    ${p.journal.some((j) => j.photo) ? `<h2 style="margin-top:14px">Photos (${p.journal.filter((j) => j.photo).length})</h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:6px">${p.journal.filter((j) => j.photo).reverse().map((j) => `<img src="${j.photo}" title="${esc(j.text)}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;${j.sharedWithClient ? "" : "opacity:.6"}">`).join("")}</div>` : ""}
    ${p.journal.slice().reverse().map((j) => `<div style="border-top:1px solid var(--border);padding:8px 0"><div class="muted" style="font-size:12px">${fdt(j.at)} · ${esc(j.author)} ${j.sharedWithClient ? '<span class="badge ok">vu par le client</span>' : '<span class="badge">interne</span>'}</div>
      ${j.photo ? `<img src="${j.photo}" style="max-width:100%;border-radius:8px;margin:6px 0">` : ""}<div>${esc(j.text)}</div></div>`).join("") || '<p class="muted">Aucune note.</p>'}`);
  let photos = [];
  $("#pd_photoBtn").onclick = () => $("#pd_photo").click();
  $("#pd_photo").onchange = async (e) => {
    for (const f of e.target.files) photos.push(await resizeImage(f));
    $("#pd_prev").innerHTML = photos.map((ph) => `<img src="${ph}" style="height:40px;border-radius:6px">`).join(" ");
    e.target.value = "";
  };
  $("#pd_notify").onchange = (e) => put(`/api/projects/${id}`, { notifyClient: e.target.checked });
  $("#pv_add").onclick = async () => { if (!$("#pv_start").value) return alert("Choisissez la date et l'heure."); await post(`/api/projects/${id}/visits`, { start: $("#pv_start").value, label: $("#pv_label").value }); projectDrawer(id); };
  $("#pm_send").onclick = async () => { if (!$("#pm_text").value.trim()) return; await post(`/api/projects/${id}/messages`, { text: $("#pm_text").value }); projectDrawer(id); };
  $("#pm_ai").onchange = (e) => post(`/api/projects/${id}/ai`, { paused: !e.target.checked });
  drawer.querySelectorAll("[data-step]").forEach((c) => (c.onchange = async () => { await post(`/api/projects/${id}/steps`, { index: Number(c.dataset.step), done: c.checked }); await refreshProjects(); projectDrawer(id); }));
  $("#pd_add").onclick = async () => {
    if (!$("#pd_text").value.trim() && !photos.length) return;
    const share = $("#pd_share").checked;
    if (!photos.length) await post(`/api/projects/${id}/journal`, { text: $("#pd_text").value, share });
    for (const [i, photo] of photos.entries()) await post(`/api/projects/${id}/journal`, { text: i === photos.length - 1 ? $("#pd_text").value : "", photo, share, notify: i === photos.length - 1, count: photos.length, phase: $("#pd_phase").value });
    await refreshProjects(); projectDrawer(id);
  };
}

async function refreshProjects() {
  if (location.hash === "#chantiers") await route();
}

// ---------- Formules ----------
function upsell(feature) {
  const need = { devis: "pro", factures: "pro", compta: "complet", mails: "complet", chantiers: "complet" }[feature];
  const p = STATE.plans[need];
  main.insertAdjacentHTML("beforeend", `<h1>Disponible avec la formule ${esc(p.label)}</h1>
    <div class="card"><p>${esc(p.summary)} · <b>${p.price} € par mois</b></p><ul>${p.includes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <button class="primary" id="up">Passer à la formule ${esc(p.label)}</button></div>`);
  $("#up").onclick = async () => { await put("/api/business", { plan: need }); route(); };
}

// ---------- Compta ----------
let comptaPeriod = "mois";
function periodRange(k) {
  const d = new Date(), y = d.getFullYear(), m = d.getMonth(), iso = (x) => localISO(x).slice(0, 10);
  if (k === "mois-1") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (k === "trimestre") { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(d)]; }
  if (k === "annee") return [`${y}-01-01`, iso(d)];
  return [iso(new Date(y, m, 1)), iso(d)];
}
async function compta() {
  const [from, to] = periodRange(comptaPeriod);
  const [s, expenses] = await Promise.all([api(`/api/compta?from=${from}&to=${to}`), api("/api/expenses")]);
  const inP = expenses.filter((e) => e.date >= from && e.date <= to);
  const P = { mois: "Ce mois-ci", "mois-1": "Le mois dernier", trimestre: "Ce trimestre", annee: "Cette année" };
  main.insertAdjacentHTML("beforeend", `
    <div class="row"><h1>Compta</h1><span class="spacer"></span>
      <select id="period" style="width:auto">${Object.entries(P).map(([k, l]) => `<option value="${k}" ${k === comptaPeriod ? "selected" : ""}>${l}</option>`).join("")}</select>
      <a href="/api/export/compta.csv?from=${from}&to=${to}"><button>Télécharger le fichier comptable</button></a>
      <button class="primary" id="sendAcc">Envoyer à mon expert-comptable</button></div>
    <p class="sub">Toutes les factures et dépenses rangées automatiquement. Photographiez vos tickets, Prava les classe. Du ${fdate(from)} au ${fdate(to)}.</p>
    <div class="grid g4">${tile(eur(s.ventes.ht), "ventes HT")}${tile(eur(s.encaisse), "encaissé")}${tile(eur(s.reste_a_encaisser), "reste à encaisser")}${tile(eur(s.depenses.ht), "dépenses HT")}${tile(eur(s.tva_a_reverser), "TVA à reverser (estimation)")}${tile(eur(s.resultat_ht), "résultat HT")}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h2>Ajouter une dépense</h2>
        <button type="button" class="primary" id="e_photoBtn">📷 Photographier un ticket ou une facture</button><input type="file" id="e_photo" accept="image/*" capture="environment" class="hidden"> <span id="e_prev"></span>
        <p class="muted" style="font-size:12px;margin:4px 0">${STATE.aiEnabled ? "L'IA lit le ticket et remplit les champs." : "Avec la clé IA, Prava lit le ticket tout seul. Pour l'instant, remplissez les champs."}</p>
        <div class="row"><div style="flex:2;min-width:140px"><label for="e_sup">Fournisseur</label><input id="e_sup"></div><div style="flex:1;min-width:120px"><label for="e_date">Date</label><input type="date" id="e_date" value="${localISO(new Date()).slice(0, 10)}"></div></div>
        <label for="e_label">Achat</label><input id="e_label" placeholder="ex. Carrelage 20 m²">
        <div class="row"><div style="flex:2;min-width:160px"><label for="e_cat">Catégorie</label><select id="e_cat">${STATE.expenseCategories.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
          <div style="flex:1;min-width:90px"><label for="e_ttc">Montant TTC</label><input id="e_ttc" inputmode="decimal"></div><div style="flex:1;min-width:70px"><label for="e_tva">TVA %</label><input id="e_tva" value="20" inputmode="decimal"></div></div>
        <p><button class="primary" id="e_save">Ranger la dépense</button></p></div>
      <div class="card"><h2>Dépenses par catégorie</h2>${Object.keys(s.depenses.par_categorie).length ? `<table>${Object.entries(s.depenses.par_categorie).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${eur(v)} HT</td></tr>`).join("")}</table>` : '<p class="muted">Aucune dépense sur la période.</p>'}
        ${s.depenses.sans_justificatif ? `<p class="badge warn" style="margin-top:10px">${s.depenses.sans_justificatif} dépense(s) sans justificatif</p>` : `<p class="badge ok" style="margin-top:10px">Tous les justificatifs sont là</p>`}
        <p class="muted" style="font-size:12px">TVA collectée ${eur(s.ventes.tva)} − TVA déductible ${eur(s.depenses.tva)}. Estimation à faire valider par votre expert-comptable.</p></div>
    </div>
    <div class="card"><h2>Dépenses rangées</h2><div class="table-wrap"><table><tr><th></th><th>Date</th><th>Fournisseur</th><th>Achat</th><th>Catégorie</th><th class="num">HT</th><th class="num">TVA</th><th class="num">TTC</th><th></th></tr>
      ${inP.map((e) => `<tr><td>${e.photo ? `<img src="${e.photo}" alt="Justificatif" style="width:36px;height:48px;object-fit:cover;border-radius:4px;cursor:zoom-in" data-big="${e.id}">` : '<span class="badge warn">manquant</span>'}</td><td>${fdate(e.date)}</td><td>${esc(e.supplier)}</td><td>${esc(e.label)}</td><td>${esc(e.category)}</td><td class="num">${eur(e.ht)}</td><td class="num">${eur(e.tva)}</td><td class="num">${eur(e.ttc)}</td><td><button class="small" data-del="${e.id}">✕</button></td></tr>`).join("") || '<tr><td colspan="9" class="muted">Aucune</td></tr>'}</table></div></div>`);
  $("#period").onchange = (e) => { comptaPeriod = e.target.value; route(); };
  $("#sendAcc").onclick = async () => { try { await post("/api/compta/send", { from, to }); alertBox(`Dossier envoyé à ${STATE.business.accountantEmail}.`); } catch (e) { alert(e.message); } };
  let photo = null;
  $("#e_photoBtn").onclick = () => $("#e_photo").click();
  $("#e_photo").onchange = async (e) => {
    if (!e.target.files[0]) return;
    photo = await resizeImage(e.target.files[0]);
    $("#e_prev").innerHTML = `<img src="${photo}" style="height:40px;border-radius:4px;vertical-align:middle">`;
    if (!STATE.aiEnabled) return;
    $("#e_prev").insertAdjacentHTML("beforeend", ' <span class="muted">Lecture du ticket…</span>');
    try {
      const { fields: f } = await post("/api/expenses/scan", { photo });
      $("#e_sup").value = f.supplier || ""; $("#e_date").value = f.date || $("#e_date").value; $("#e_label").value = f.label || ""; $("#e_cat").value = f.category; $("#e_ttc").value = f.ttc; $("#e_tva").value = f.tvaRate;
      $("#e_prev").lastElementChild.textContent = "✓ Lu, vérifiez puis rangez";
    } catch (err) { $("#e_prev").lastElementChild.textContent = err.message; }
  };
  $("#e_save").onclick = async () => {
    if (!$("#e_ttc").value) return alert("Indiquez le montant TTC.");
    await post("/api/expenses", { supplier: $("#e_sup").value, date: $("#e_date").value, label: $("#e_label").value, category: $("#e_cat").value, ttc: $("#e_ttc").value, tvaRate: $("#e_tva").value, photo, source: photo ? "photo" : "manuel" });
    route();
  };
  main.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (confirm("Supprimer cette dépense ?")) { await api(`/api/expenses/${b.dataset.del}`, { method: "DELETE" }); route(); } }));
  main.querySelectorAll("[data-big]").forEach((img) => (img.onclick = () => openDrawer(`<div class="row"><h2 style="margin:0">Justificatif</h2><span class="spacer"></span><button onclick="closeDrawer()">✕</button></div><img src="${img.src}" style="width:100%;margin-top:12px;border-radius:8px">`)));
}

// ---------- Mails ----------
const MAIL_BADGE = { Urgent: "bad", "Demande de devis": "", "Question client": "", "Facture fournisseur": "warn", Administratif: "warn", Publicité: "" };
let mailFilter = "à traiter";
async function mails() {
  const all = await api("/api/mails");
  const shown = all.filter((m) => mailFilter === "tous" || (mailFilter === "à traiter" ? m.status === "à traiter" : m.category === mailFilter));
  const cats = STATE.mailCategories.filter((c) => all.some((m) => m.category === c));
  main.insertAdjacentHTML("beforeend", `
    <div class="row"><h1>Mails</h1><span class="spacer"></span><button id="fake">Simuler un mail reçu</button></div>
    <p class="sub">Prava trie vos mails, résume chacun et prépare la réponse. Vous relisez, vous envoyez. Les factures fournisseurs vont en compta en un clic.</p>
    <div class="row" style="margin-bottom:12px">${["à traiter", ...cats, "tous"].map((c) => `<button class="small ${c === mailFilter ? "primary" : ""}" data-mf="${esc(c)}">${esc(c[0].toUpperCase() + c.slice(1))} (${c === "tous" ? all.length : c === "à traiter" ? all.filter((m) => m.status === "à traiter").length : all.filter((m) => m.category === c).length})</button>`).join("")}</div>
    <div class="card"><div class="table-wrap"><table><tr><th>Reçu</th><th>De</th><th>Catégorie</th><th>Résumé</th><th>État</th></tr>
      ${shown.map((m) => `<tr class="click" data-mail="${m.id}"><td>${fdt(m.at)}</td><td><b>${esc(m.fromName)}</b><br><span class="muted" style="font-size:12px">${esc(m.subject)}</span></td><td><span class="badge ${MAIL_BADGE[m.category] ?? ""}">${esc(m.category)}</span></td><td>${esc(m.summary)}</td><td>${badge(m.status)}</td></tr>`).join("") || '<tr><td colspan="5" class="muted">Rien à traiter 🎉</td></tr>'}</table></div></div>`);
  main.querySelectorAll("[data-mf]").forEach((b) => (b.onclick = () => { mailFilter = b.dataset.mf; route(); }));
  main.querySelectorAll("[data-mail]").forEach((tr) => (tr.onclick = () => mailDrawer(all.find((m) => m.id === tr.dataset.mail))));
  $("#fake").onclick = () => {
    openDrawer(`<div class="row"><h2 style="margin:0">Simuler un mail reçu</h2><span class="spacer"></span><button onclick="closeDrawer()">✕</button></div>
      <label for="f_name">De (nom)</label><input id="f_name" value="Nadia Leroy"><label for="f_from">Adresse</label><input id="f_from" value="nadia.leroy@example.fr">
      <label for="f_subj">Objet</label><input id="f_subj" value="Plus d'eau chaude depuis hier"><label for="f_body">Message</label><textarea id="f_body" rows="5">Bonjour, nous n'avons plus d'eau chaude depuis hier soir, le ballon fait un bruit bizarre. Pouvez-vous passer rapidement ? Merci</textarea>
      <p><button class="primary" id="f_go">Recevoir ce mail</button></p>`);
    $("#f_go").onclick = async () => { $("#f_go").disabled = true; const r = await post("/api/mails", { fromName: $("#f_name").value, from: $("#f_from").value, subject: $("#f_subj").value, body: $("#f_body").value }); mailFilter = "à traiter"; await route(); mailDrawer(r.mail); };
  };
}

function mailDrawer(m) {
  openDrawer(`<div class="row"><h2 style="margin:0">${esc(m.subject)}</h2><span class="spacer"></span><button onclick="closeDrawer()">✕</button></div>
    <p class="muted">${esc(m.fromName)} &lt;${esc(m.from)}&gt; · ${fdt(m.at)}</p>
    <p><span class="badge ${MAIL_BADGE[m.category] ?? ""}">${esc(m.category)}</span> ${badge(m.status)} <span class="muted" style="font-size:12px">trié par ${m.sortedBy === "ia" ? "l'IA" : "règles simples"}</span></p>
    <div class="card" style="background:var(--bg);white-space:pre-wrap">${esc(m.body)}</div>
    <p><b>En bref :</b> ${esc(m.summary)}</p>
    ${m.draft ? `<label for="m_draft">Réponse préparée par Prava (modifiable)</label><textarea id="m_draft" rows="8">${esc(m.draft)}</textarea>
      <p class="row"><button class="primary" id="m_send" ${m.status === "répondu" ? "disabled" : ""}>${m.status === "répondu" ? "✓ Réponse envoyée" : "Envoyer la réponse"}</button></p>` : ""}
    <p class="row">${m.category === "Facture fournisseur" && m.status !== "rangé" ? `<button class="primary" id="m_exp">🧾 Ranger en dépense${m.amount ? ` (${eur(m.amount)})` : ""}</button>` : ""}
      ${m.status === "à traiter" ? `<button id="m_arch">Archiver</button>` : ""}</p>`);
  $("#m_send") && ($("#m_send").onclick = async () => { await post(`/api/mails/${m.id}/reply`, { text: $("#m_draft").value }); await route(); alertBox(`Réponse envoyée à ${m.fromName}.`); });
  $("#m_exp") && ($("#m_exp").onclick = async () => { await post(`/api/mails/${m.id}/expense`); await route(); alertBox("Facture rangée dans la compta."); });
  $("#m_arch") && ($("#m_arch").onclick = async () => { await post(`/api/mails/${m.id}/status`, { status: "archivé" }); route(); });
}
