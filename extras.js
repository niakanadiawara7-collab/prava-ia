// Écrans ajoutés : Téléphone (appel simulé avec voix naturelle), Aides rénovation, Rentabilité et commandes,
// Facture électronique, Import Excel/CSV. Utilise les fonctions de app.js (api, post, put, esc, eur, main, STATE…).

Object.assign(VIEWS, { telephone, aides: aidesView, rentabilite, importer: importView });
VIEW_FEATURE.rentabilite = "chantiers";
const pct = (n) => `${n} %`;
const statusBadge = (ok, yes = "branché", no = "mode démo") => `<span class="badge ${ok ? "ok" : "warn"}">${ok ? yes : no}</span>`;

// =====================================================================
// Voix : ElevenLabs côté serveur si la clé est là, sinon la meilleure voix française du navigateur
// =====================================================================
let currentAudio = null;
function bestVoice() {
  const voices = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang.toLowerCase().startsWith("fr"));
  const saved = (() => { try { return localStorage.getItem("prava_voice"); } catch { return null; } })();
  return voices.find((v) => v.name === saved) || voices.find((v) => /natural|neural|online|premium|enhanced/i.test(v.name)) || voices.find((v) => /google/i.test(v.name)) || voices.find((v) => /amélie|amelie|thomas|denise|vivienne|henri/i.test(v.name)) || voices[0];
}
function browserSay(text) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, ""));
    u.lang = "fr-FR"; u.rate = 1.03;
    const v = bestVoice(); if (v) u.voice = v;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
async function sayText(text) {
  stopVoice();
  if (STATE?.integrations?.voix?.connected) {
    try {
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (r.ok && (r.headers.get("content-type") || "").includes("audio")) {
        const url = URL.createObjectURL(await r.blob());
        return await new Promise((resolve) => { currentAudio = new Audio(url); currentAudio.onended = currentAudio.onerror = () => resolve(); currentAudio.play().catch(resolve); });
      }
    } catch {}
  }
  return browserSay(text);
}
function stopVoice() { try { currentAudio?.pause(); } catch {} currentAudio = null; window.speechSynthesis?.cancel(); }
// L'accueil IA et l'assistant patron utilisent aussi la meilleure voix
speak = (text) => { sayText(text); };
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => {};

// =====================================================================
// Téléphone
// =====================================================================
async function telephone() {
  const I = STATE.integrations;
  const calls = (await api("/api/calls")).filter((c) => c.channel === "téléphone").slice(0, 8);
  const voices = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang.toLowerCase().startsWith("fr"));
  const bv = bestVoice();
  main.insertAdjacentHTML("beforeend", `
    <h1>Téléphone</h1>
    <p class="sub">Prava décroche sur votre numéro avec une voix naturelle, 24 h/24 : il comprend la demande, prend le rendez-vous, fait le devis pendant l'appel et vous envoie le résumé.</p>
    <div class="grid g2">
      <div class="card phone-hero">
        <div class="muted" style="font-size:12px">Votre ligne Prava</div>
        <div style="font-size:26px;font-weight:700;margin:2px 0 6px">${esc(I.telephone.number || STATE.business.phone || "Numéro à brancher")}</div>
        <div class="row" style="margin-bottom:12px">${statusBadge(I.telephone.connected, "ligne active", "ligne simulée")} ${statusBadge(I.vapi.connected || I.voix.connected, "voix naturelle", "voix du navigateur")}</div>
        <button class="primary call-btn" id="simCall">📞 Simuler un appel entrant</button>
        <p class="muted" style="font-size:12px;margin-bottom:0">Jouez le client au micro : Prava répond à voix haute, en mains libres, comme au téléphone. Chrome ou Edge conseillé.</p>
        ${I.voix.connected ? "" : `<label for="voicePick">Voix utilisée pour la démo</label><select id="voicePick">${voices.map((v) => `<option ${v === bv ? "selected" : ""}>${esc(v.name)}</option>`).join("") || "<option>Voix par défaut</option>"}</select>
        <p class="muted" style="font-size:12px;margin:4px 0 0">Les voix « Natural » / « Online » (Edge) ou « Google » (Chrome) sont les plus naturelles. Au téléphone réel, la voix vient de Vapi ou ElevenLabs.</p>`}
      </div>
      <div class="card"><h2>Branchement de la vraie ligne</h2>
        ${["telephone", "vapi", "voix"].map((k) => `<div class="row" style="border-top:1px solid var(--border);padding:8px 0"><div style="flex:1;min-width:200px"><b>${esc(I[k].label)}</b><br><span class="muted" style="font-size:12px">${esc(I[k].env)}</span></div>${statusBadge(I[k].connected)}</div>`).join("")}
        <ol style="padding-left:18px;font-size:13px;margin-bottom:0">
          <li><b>Voix temps réel (conseillé)</b> : créer un assistant Vapi, modèle « Custom LLM » avec l'adresse <code>${esc(I.vapi.url)}</code>, voix française ElevenLabs, et y acheter ou importer un numéro français. Latence d'environ une seconde, l'appelant peut couper la parole.</li>
          <li><b>Ou Twilio seul</b> : numéro Twilio pointé vers <code>${esc(I.vapi.voiceUrl)}</code>. Avec <code>ELEVENLABS_API_KEY</code>, Prava parle avec la voix ElevenLabs au lieu de la voix Polly.</li>
          <li>L'artisan garde son numéro : renvoi d'appel vers la ligne Prava (immédiat, ou après 15 s sans réponse).</li>
        </ol></div>
    </div>
    <div class="card"><h2>Derniers appels</h2><div class="table-wrap"><table><tr><th>Date</th><th>Client</th><th>Résumé</th><th>Urgence</th></tr>
      ${calls.map((c) => `<tr><td>${fdt(c.at)}</td><td>${esc(c.client || c.phone || "–")}</td><td>${esc(c.summary)}</td><td>${badge(c.urgency)}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">Aucun appel</td></tr>'}</table></div></div>`);
  $("#voicePick")?.addEventListener("change", (e) => { try { localStorage.setItem("prava_voice", e.target.value); } catch {} sayText("Bonjour, je suis l'assistant de " + STATE.business.name + "."); });
  $("#simCall").onclick = callScreen;
}

function ring() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (const t of [0, 0.5]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 440; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.08, ctx.currentTime + t); g.gain.setValueAtTime(0, ctx.currentTime + t + 0.4);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.45);
    }
    setTimeout(() => ctx.close(), 1200);
  } catch {}
}

function callScreen() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const ov = document.createElement("div");
  ov.className = "callscreen";
  ov.innerHTML = `<div class="callbox">
      <div class="call-head"><div class="avatar">P</div><div><b>${esc(STATE.business.name)}</b><div id="cs_state" class="muted">Appel en cours…</div></div><span class="spacer"></span><span id="cs_timer" class="muted">00:00</span></div>
      <div id="cs_log" class="call-log"></div>
      <div id="cs_wave" class="wave"><span></span><span></span><span></span><span></span><span></span></div>
      ${SR ? "" : `<div class="row"><input id="cs_text" placeholder="Votre micro n'est pas disponible : tapez la phrase du client" style="flex:1"><button id="cs_send" class="primary">Dire</button></div>`}
      <div class="row" style="justify-content:center;margin-top:12px"><button id="cs_mute" class="small">🎤 Micro actif</button><button id="cs_hang" class="hang">Raccrocher</button></div>
    </div>`;
  document.body.appendChild(ov);
  const log = ov.querySelector("#cs_log"), state = ov.querySelector("#cs_state"), wave = ov.querySelector("#cs_wave");
  const add = (cls, html) => { log.insertAdjacentHTML("beforeend", `<div class="${cls}">${html}</div>`); log.scrollTop = log.scrollHeight; };
  let conv = null, rec = null, live = true, muted = false, busy = false;
  const t0 = Date.now();
  const timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); ov.querySelector("#cs_timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }, 1000);
  const setState = (txt, speaking) => { state.textContent = txt; wave.classList.toggle("on", Boolean(speaking)); };

  async function prava(text) {
    setState("Prava parle…", true);
    await sayText(text);
    if (!live) return;
    listen();
  }
  function listen() {
    if (!SR || muted || !live) { setState(muted ? "Micro coupé" : "À vous (tapez la phrase du client)"); return; }
    setState("À vous, je vous écoute…");
    rec = new SR(); rec.lang = "fr-FR"; rec.interimResults = true;
    let final = "", interimEl = null;
    rec.onresult = (e) => {
      const txt = Array.from(e.results).map((r) => r[0].transcript).join("");
      if (!interimEl) { add("msg user", ""); interimEl = log.lastElementChild; }
      interimEl.textContent = txt;
      if (e.results[e.results.length - 1].isFinal) final = txt;
    };
    rec.onend = () => { rec = null; if (!live) return; if (final.trim()) client(final.trim(), true); else if (!muted) listen(); };
    rec.onerror = (e) => { if (e.error === "not-allowed") { setState("Micro refusé : autorisez-le dans le navigateur"); muted = true; } };
    rec.start();
  }
  async function client(text, shown) {
    if (busy) return;
    busy = true;
    if (!shown) add("msg user", esc(text));
    setState("Prava réfléchit…");
    try {
      const r = await post("/api/chat", { conversationId: conv, mode: "accueil", channel: "téléphone", text });
      conv = r.conversationId;
      for (const a of r.actions) add("action", describeAction(a));
      add("msg ai", esc(r.reply));
      busy = false;
      if (live) prava(r.reply);
    } catch (e) { busy = false; add("msg ai", "Erreur : " + esc(e.message)); }
  }
  function hang() {
    live = false; clearInterval(timer); stopVoice(); try { rec?.abort(); } catch {}
    setState("Appel terminé"); wave.classList.remove("on");
    ov.querySelector("#cs_hang").textContent = "Fermer";
    ov.querySelector("#cs_hang").onclick = () => { ov.remove(); route(); };
    add("action", "📞 Appel terminé. Le résumé est dans le tableau de bord, la fiche client et vos SMS (Messages envoyés).");
  }
  ov.querySelector("#cs_hang").onclick = hang;
  ov.querySelector("#cs_mute").onclick = (e) => { muted = !muted; e.target.textContent = muted ? "🔇 Micro coupé" : "🎤 Micro actif"; if (muted) { try { rec?.abort(); } catch {} setState("Micro coupé"); } else if (!busy) listen(); };
  ov.querySelector("#cs_send")?.addEventListener("click", () => { const i = ov.querySelector("#cs_text"); if (i.value.trim()) { client(i.value.trim()); i.value = ""; } });
  ov.querySelector("#cs_text")?.addEventListener("keydown", (e) => { if (e.key === "Enter") ov.querySelector("#cs_send").click(); });
  setState("Ça sonne…"); ring();
  setTimeout(() => {
    const greet = `${STATE.business.name}, bonjour ! Je suis l'assistant virtuel. Que puis-je faire pour vous ?`;
    add("msg ai", esc(greet));
    if (!STATE.aiEnabled) add("action", "Mode démo : ajoutez la clé ANTHROPIC_API_KEY pour que Prava réponde vraiment.");
    prava(greet);
  }, 1300);
}

// =====================================================================
// Aides à la rénovation énergétique
// =====================================================================
const CAT_COLOR = { bleu: "#2563eb", jaune: "#ca8a04", violet: "#7c3aed", rose: "#db2777" };
async function aidesView() {
  const quotes = (await api("/api/quotes")).filter((q) => q.aids);
  const rge = STATE.business.rge;
  const catalog = STATE.services.filter((s) => s.aid);
  const generic = Object.entries(STATE.aides.gestes).filter(([k]) => !catalog.some((s) => s.aid === k));
  main.insertAdjacentHTML("beforeend", `
    <h1>Aides rénovation</h1>
    <p class="sub">MaPrimeRénov' et prime CEE calculées en direct, reste à charge affiché sur le devis, TVA à 5,5 % et mention certifiée par le client à la signature.</p>
    ${rge?.numero ? `<div class="card row" style="padding:10px 16px"><span class="badge ok">RGE</span> <b>${esc(rge.numero)}</b> <span class="muted">${esc(rge.organisme || "")}${rge.validite ? ` · valide jusqu'au ${fdate(rge.validite)}` : ""}</span></div>` : `<div class="banner">Sans certification RGE, vos clients n'ont pas droit aux aides. Renseignez votre numéro RGE dans Paramètres.</div>`}
    <div class="grid g2">
      <div class="card"><h2>1. Le foyer</h2>
        <div class="row"><div style="flex:1;min-width:120px"><label for="a_pers">Personnes dans le foyer</label><input id="a_pers" type="number" min="1" value="3"></div>
        <div style="flex:1;min-width:150px"><label for="a_inc">Revenu fiscal de référence</label><input id="a_inc" type="number" value="36000"></div></div>
        <label style="display:flex;gap:6px;align-items:center;color:var(--text)"><input type="checkbox" id="a_idf" style="width:auto" checked> Logement en Île-de-France</label>
        <p id="a_cat" style="margin-bottom:0"></p>
        <h2 style="margin-top:16px">2. Les travaux</h2>
        <div id="a_lines"></div><button class="small" id="a_add">+ Ajouter un poste</button>
      </div>
      <div class="card" id="a_result"><p class="muted">Ajoutez un poste de travaux.</p></div>
    </div>
    <div class="card"><h2>3. Créer le devis avec les aides</h2>
      <div class="row"><div style="flex:1;min-width:160px"><label for="a_name">Client</label><input id="a_name" placeholder="Nom et prénom"></div><div style="flex:1;min-width:140px"><label for="a_phone">Téléphone</label><input id="a_phone"></div>
      <div style="flex:1;min-width:160px"><label for="a_email">Email</label><input id="a_email"></div><div style="flex:2;min-width:200px"><label for="a_addr">Adresse du logement</label><input id="a_addr"></div></div>
      <p class="row"><button class="primary" id="a_create">Créer et envoyer le devis (TVA 5,5 %)</button><span class="muted" style="font-size:12px">Le client voit ses aides et son reste à charge sur le lien de signature et sur le PDF.</span></p></div>
    <div class="card"><h2>Devis avec aides</h2><div class="table-wrap"><table><tr><th>N°</th><th>Client</th><th>Objet</th><th class="num">TTC</th><th class="num">Aides</th><th class="num">Reste à charge</th><th>Statut</th><th></th></tr>
      ${quotes.map((q) => `<tr><td>${esc(q.number)}</td><td>${esc(q.client)}</td><td>${esc(q.title)}</td><td class="num">${eur(q.totals.ttc)}</td><td class="num" style="color:var(--ok)">${eur(q.aids.total)}</td><td class="num"><b>${eur(q.aids.resteACharge)}</b></td><td>${badge(q.status)}</td><td class="row"><a href="/api/quotes/${q.id}/pdf" target="_blank"><button class="small">PDF</button></a><a href="/q/${q.id}" target="_blank"><button class="small">Lien client</button></a></td></tr>`).join("") || '<tr><td colspan="8" class="muted">Aucun</td></tr>'}</table></div></div>`);
  const opts = `${catalog.map((s) => `<option value="svc:${esc(s.code)}" data-aid="${s.aid}" data-price="${s.price}" data-unit="${esc(s.unit)}" data-label="${esc(s.label)}">${esc(s.label)} (${eur(s.price)} / ${esc(s.unit)})</option>`).join("")}${generic.map(([k, g]) => `<option value="aid:${k}" data-aid="${k}" data-price="" data-unit="${esc(g.unit)}" data-label="${esc(g.label)}">${esc(g.label)} (prix à saisir)</option>`).join("")}`;
  const addLine = (val) => {
    $("#a_lines").insertAdjacentHTML("beforeend", `<div class="row a_line" style="margin-bottom:6px"><select class="a_g" style="flex:3;min-width:200px">${opts}</select><input class="a_q" type="number" value="1" style="flex:1;min-width:60px" title="Quantité"><input class="a_p" type="number" placeholder="PU HT" style="flex:1;min-width:80px" title="Prix unitaire HT"><button class="small a_x">✕</button></div>`);
    const row = $("#a_lines").lastElementChild;
    const sel = $(".a_g", row);
    if (val) sel.value = val;
    const sync = () => { const o = sel.selectedOptions[0]; $(".a_p", row).value = o.dataset.price; $(".a_q", row).value = o.dataset.unit === "m²" ? 80 : 1; calc(); };
    sel.onchange = sync; sync();
    $(".a_q", row).oninput = $(".a_p", row).oninput = calc;
    $(".a_x", row).onclick = () => { row.remove(); calc(); };
  };
  let timer = null;
  const lines = () => [...document.querySelectorAll(".a_line")].map((r) => { const o = $(".a_g", r).selectedOptions[0]; return { code: o.value.startsWith("svc:") ? o.value.slice(4) : undefined, label: o.dataset.label, qty: Number($(".a_q", r).value) || 1, unit: o.dataset.unit, unitPrice: Number($(".a_p", r).value) || 0, aid: o.dataset.aid }; });
  const profile = () => ({ persons: Number($("#a_pers").value), income: Number($("#a_inc").value), idf: $("#a_idf").checked });
  function calc() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const ls = lines();
      if (!ls.length) return ($("#a_result").innerHTML = '<p class="muted">Ajoutez un poste de travaux.</p>');
      try {
        const a = await post("/api/aides/estimate", { lines: ls, profile: profile(), tva: 5.5 });
        const color = CAT_COLOR[a.category] || "var(--accent)";
        $("#a_cat").innerHTML = a.category ? `Profil : <b style="color:${color}">${esc(a.categoryLabel)}</b>` : "";
        $("#a_result").innerHTML = `<h2>Aides estimées</h2>
          <table>${a.items.map((it) => `<tr><td>${esc(it.label)}<br><span class="muted" style="font-size:12px">${it.qty} ${esc(ls.find((l) => l.aid === it.code)?.unit || "")}</span></td><td class="num">MaPrimeRénov'<br><b>${eur(it.mpr)}</b></td><td class="num">Prime CEE<br><b>${eur(it.cee)}</b></td></tr>`).join("")}</table>
          <div class="grid g2" style="margin-top:12px;gap:8px">${tile(eur(a.ttc), "coût des travaux TTC (TVA 5,5 %)")}${tile(eur(a.total), "aides au total" + (a.capped ? " (plafonné)" : ""))}</div>
          <div class="card stat" style="margin:8px 0 0;background:var(--ok-soft);border-color:transparent"><div class="v" style="color:var(--ok)">${eur(a.resteACharge)}</div><div class="l">reste à charge pour le client, soit ${a.ttc ? Math.round((a.resteACharge / a.ttc) * 100) : 0} % du prix</div></div>
          ${a.warnings.map((w) => `<p class="muted" style="font-size:12px;margin:8px 0 0">⚠️ ${esc(w)}</p>`).join("")}
          <p class="muted" style="font-size:12px;margin:6px 0 0">Barèmes indicatifs à mettre à jour chaque année (france-renov.gouv.fr). La prime CEE dépend du fournisseur d'énergie partenaire.</p>`;
      } catch (e) { $("#a_result").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
    }, 250);
  }
  ["#a_pers", "#a_inc", "#a_idf"].forEach((s) => ($(s).oninput = $(s).onchange = calc));
  $("#a_add").onclick = () => addLine();
  addLine(catalog[0] ? `svc:${catalog[0].code}` : undefined);
  if (catalog[1]) addLine(`svc:${catalog[1].code}`);
  $("#a_create").onclick = async () => {
    if (!$("#a_name").value.trim()) return alert("Indiquez le nom du client.");
    const ls = lines();
    const r = await post("/api/quotes", { client_name: $("#a_name").value, phone: $("#a_phone").value, email: $("#a_email").value, address: $("#a_addr").value, title: ls.map((l) => l.label.split(" (")[0]).join(" + ").slice(0, 90), tva: 5.5, aid_profile: profile(), lines: ls.map((l) => ({ code: l.code, label: l.label, qty: l.qty, unit: l.unit, unit_price: l.unitPrice, aid: l.aid })), notes: "Montant des aides indicatif, sous réserve d'acceptation du dossier MaPrimeRénov' (à déposer avant le début des travaux)." });
    await route();
    alertBox(`Devis ${r.quote.number} envoyé au client avec ses aides et son reste à charge.`);
  };
}

// =====================================================================
// Rentabilité des chantiers et commandes fournisseurs
// =====================================================================
const marginColor = (p) => (p >= 25 ? "var(--ok)" : p >= 12 ? "var(--warn)" : "var(--bad)");
async function rentabilite() {
  const [rows, orders] = await Promise.all([api("/api/margins"), api("/api/purchase-orders")]);
  const ca = rows.reduce((s, r) => s + r.caHt, 0), mp = rows.reduce((s, r) => s + r.projected.margin.amount, 0);
  main.insertAdjacentHTML("beforeend", `
    <h1>Rentabilité des ${esc(plural(STATE.projectLabel).toLowerCase())}</h1>
    <p class="sub">Pour chaque chantier : ce que vous avez vendu, ce que vous coûtent le matériel et les heures, et la marge qui vous reste. Prava suit les achats rangés en compta, les livraisons et les heures pointées.</p>
    <div class="grid g4">${tile(eur(ca), "vendu HT (chantiers suivis)")}${tile(eur(mp), "marge prévue en fin de chantier")}${tile(ca ? pct(Math.round((mp / ca) * 100)) : "–", "taux de marge")}${tile(orders.filter((o) => o.status !== "livrée" && o.status !== "annulée").length, "commandes en cours")}</div>
    <div class="card" style="margin-top:16px"><div class="table-wrap"><table><tr><th>${esc(STATE.projectLabel)}</th><th>Avancement</th><th class="num">Vendu HT</th><th class="num">Matériel prévu / réel</th><th class="num">Heures prévues / réelles</th><th class="num">Marge prévue</th><th class="num">Marge projetée</th><th></th></tr>
      ${rows.map((r) => `<tr class="click" data-m="${r.id}"><td><b>${esc(r.title)}</b><br><span class="muted">${esc(r.client)}</span>${r.alerts.map((a) => `<br><span class="badge bad">${esc(a)}</span>`).join("")}</td><td>${r.progress} %</td><td class="num">${eur(r.caHt)}</td><td class="num">${eur(r.planned.materials)}<br><span style="color:${r.real.materials > r.planned.materials * 1.1 ? "var(--bad)" : "inherit"}">${eur(r.real.materials)}</span></td><td class="num">${r.planned.hours} h<br><span style="color:${r.real.hours > r.planned.hours * 1.1 ? "var(--bad)" : "inherit"}">${r.real.hours} h</span></td><td class="num">${eur(r.planned.margin.amount)}<br><span class="muted">${pct(r.planned.margin.percent)}</span></td><td class="num"><b style="color:${marginColor(r.projected.margin.percent)}">${eur(r.projected.margin.amount)}</b><br><span style="color:${marginColor(r.projected.margin.percent)}">${pct(r.projected.margin.percent)}</span></td><td><button class="small">Détail</button></td></tr>`).join("") || '<tr><td colspan="8" class="muted">Aucun chantier</td></tr>'}</table></div>
      <p class="muted" style="font-size:12px;margin-bottom:0">Coût horaire chargé : ${eur(STATE.business.hourlyCost || 38)} (modifiable dans Paramètres). La marge projetée = réel à ce jour + ce qu'il reste à faire selon le devis.</p></div>
    <div class="card"><h2>Commandes fournisseurs</h2><div class="table-wrap"><table><tr><th>N°</th><th>Fournisseur</th><th>Chantier</th><th class="num">Montant HT</th><th>Livraison</th><th>Statut</th><th></th></tr>
      ${orders.map((o) => poRow(o)).join("") || '<tr><td colspan="7" class="muted">Aucune commande</td></tr>'}</table></div></div>`);
  main.querySelectorAll("[data-m]").forEach((tr) => (tr.onclick = () => marginDrawer(tr.dataset.m)));
  bindPo(main, () => route());
}
const poRow = (o) => `<tr><td>${esc(o.number)}</td><td>${esc(o.supplier)}</td><td>${esc(o.project || "")}</td><td class="num">${eur(o.total)}</td><td>${fdate(o.deliveryDate)}</td><td>${badge(o.status === "livrée" ? "terminé" : o.status === "annulée" ? "annulé" : "en cours").replace(/>[^<]+</, `>${esc(o.status)}<`)}</td>
  <td class="row"><a href="/api/purchase-orders/${o.id}/pdf" target="_blank"><button class="small">PDF</button></a>${o.status === "livrée" || o.status === "annulée" ? "" : `<button class="small" data-po="${o.id}|livrée">📦 Livrée</button>`}</td></tr>`;
function bindPo(el, after) {
  el.querySelectorAll("[data-po]").forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); const [id, status] = b.dataset.po.split("|"); await post(`/api/purchase-orders/${id}/status`, { status }); alertBox("Livraison enregistrée : la dépense est rangée en compta et rattachée au chantier."); after(); }));
}

async function marginDrawer(id) {
  const [m, mat, p] = await Promise.all([api(`/api/projects/${id}/margin`), api(`/api/projects/${id}/materials`).catch(() => ({ groups: [] })), api(`/api/projects/${id}`)]);
  const row = (l, a, b, money = true) => `<tr><td>${l}</td><td class="num">${money ? eur(a) : a + " h"}</td><td class="num">${money ? eur(b) : b + " h"}</td></tr>`;
  openDrawer(`<div class="row"><h2 style="margin:0">💶 ${esc(p.title)}</h2><span class="spacer"></span><button onclick="closeDrawer()">✕</button></div>
    <p class="muted">${esc(p.client)} · ${m.progress} % fait</p>
    ${m.alerts.map((a) => `<p class="badge bad">${esc(a)}</p>`).join(" ")}
    <div class="grid g2" style="gap:8px">${tile(eur(m.planned.margin.amount) + " · " + pct(m.planned.margin.percent), "marge prévue au devis")}<div class="card stat"><div class="v" style="color:${marginColor(m.projected.margin.percent)}">${eur(m.projected.margin.amount)} · ${pct(m.projected.margin.percent)}</div><div class="l">marge projetée en fin de chantier</div></div></div>
    <table style="margin-top:8px"><tr><th></th><th class="num">Prévu</th><th class="num">Réel à ce jour</th></tr>
      ${row("Vendu HT", m.caHt, m.invoicedHt).replace("Réel", "Facturé")}${row("Matériel", m.planned.materials, m.real.materials)}${row("Heures", m.planned.hours, m.real.hours, false)}${row(`Main d'œuvre (${eur(m.hourlyCost)}/h)`, m.planned.hours * m.hourlyCost, m.real.hours * m.hourlyCost)}${row("<b>Coût total</b>", m.planned.cost, m.real.cost)}</table>
    ${m.real.pendingOrders ? `<p class="muted" style="font-size:12px">+ ${eur(m.real.pendingOrders)} HT de commandes pas encore livrées.</p>` : ""}${m.estimated ? '<p class="muted" style="font-size:12px">Certaines lignes n\'ont pas de prix d\'achat au catalogue : estimation à 35 % de matériel et 35 % de main d\'œuvre.</p>' : ""}
    <h2 style="margin-top:16px">Heures pointées</h2>
    ${m.timeEntries.slice().reverse().map((t) => `<p style="margin:3px 0">${fdate(t.date)} · ${esc(t.staff)} · <b>${t.hours} h</b> ${esc(t.note)}</p>`).join("") || '<p class="muted">Aucune heure.</p>'}
    <div class="row"><input id="t_h" placeholder="Heures (ex. 7,5)" style="flex:1"><select id="t_s" style="flex:1">${STATE.staff.map((s) => `<option ${s.name === p.staff ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select><button class="small primary" id="t_add">Pointer</button></div>
    <h2 style="margin-top:16px">Achats rattachés</h2>
    ${m.real.expenses.map((e) => `<p style="margin:3px 0">${fdate(e.date)} · ${esc(e.supplier)} · ${esc(e.label)} · <b>${eur(e.ht)} HT</b></p>`).join("") || '<p class="muted">Aucun achat.</p>'}
    <h2 style="margin-top:16px">Commander le matériel</h2>
    <p class="muted" style="font-size:12px">Prava prépare les bons de commande à partir du devis, groupés par fournisseur, et les envoie par mail avec l'adresse du chantier.</p>
    ${(mat.groups || []).map((g, i) => `<div class="card" style="padding:10px;margin-bottom:8px"><div class="row"><b>${esc(g.supplier)}</b><span class="muted" style="font-size:12px">${esc(g.email)}</span><span class="spacer"></span><b>${eur(g.total)} HT</b></div>
      <ul style="margin:6px 0;padding-left:18px;font-size:13px">${g.lines.map((l) => `<li>${esc(l.label.replace("Fournitures pour : ", ""))} · ${l.qty} ${esc(l.unit)} × ${eur(l.unitCost)}${l.estimated ? " (estimé)" : ""}</li>`).join("")}</ul>
      <button class="small ${g.alreadyOrdered ? "" : "primary"}" data-order="${i}">${g.alreadyOrdered ? "Commander à nouveau" : "📨 Envoyer le bon de commande"}</button></div>`).join("") || `<p class="muted">${esc(mat.error || "Rien à commander.")}</p>`}
    ${m.orders.length ? `<h2 style="margin-top:16px">Commandes de ce chantier</h2><div class="table-wrap"><table>${m.orders.map(poRow).join("")}</table></div>` : ""}`);
  $("#t_add").onclick = async () => { try { await post(`/api/projects/${id}/time`, { hours: $("#t_h").value, staff: $("#t_s").value }); marginDrawer(id); } catch (e) { alert(e.message); } };
  drawer.querySelectorAll("[data-order]").forEach((b) => (b.onclick = async () => { const g = mat.groups[Number(b.dataset.order)]; const r = await post("/api/purchase-orders", { projectId: id, supplier: g.supplier }); alertBox(`Bon de commande ${r.order.number} envoyé à ${g.supplier}.`); marginDrawer(id); }));
  bindPo(drawer, () => marginDrawer(id));
}
window.marginDrawer = marginDrawer;

// =====================================================================
// Facture électronique (dans Devis & factures et dans Compta)
// =====================================================================
const EF_BADGE = { "déposée": "warn", "émise": "", "reçue": "", "mise à disposition": "", "prise en charge": "", "approuvée": "ok", "paiement transmis": "ok", "encaissée": "ok", "refusée": "bad" };
async function einvoiceCard() {
  const s = await api("/api/einvoice");
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<div class="row"><h2 style="margin:0">🧾 Facture électronique</h2><span class="badge ok">prêt pour la réforme 2026</span><span class="spacer"></span>${statusBadge(s.connected, "plateforme branchée", "plateforme simulée")}</div>
    <p class="muted" style="margin:6px 0 10px">Chaque facture part au format Factur-X (PDF + XML EN 16931) via <b>${esc(s.platform)}</b> : facture électronique pour les clients professionnels, e-reporting pour les particuliers. Les factures de vos fournisseurs arrivent toutes seules dans Compta.</p>
    <div class="grid g4" style="gap:8px">${tile(s.transmitted, "factures transmises")}${tile(s.b2b, "à des professionnels")}${tile(s.b2c, "e-reporting particuliers")}${tile(s.incoming, "factures fournisseurs à valider")}</div>
    <label style="display:flex;gap:6px;align-items:center;color:var(--text);margin-top:10px"><input type="checkbox" id="ef_auto" style="width:auto" ${s.auto ? "checked" : ""}> Transmettre automatiquement chaque nouvelle facture</label>`;
  return el;
}
async function enhanceDevis() {
  const invCard = [...main.querySelectorAll(".card h2")].find((h) => h.textContent === "Factures")?.closest(".card");
  if (!invCard) return;
  invCard.before(await einvoiceCard());
  $("#ef_auto").onchange = (e) => put("/api/business", { einvoice: { ...(STATE.business.einvoice || {}), auto: e.target.checked } });
  main.querySelectorAll("[data-tx]").forEach((b) => (b.onclick = async () => { const r = await post(`/api/invoices/${b.dataset.tx}/transmit`); await route(); alertBox(`Facture transmise (${r.einvoice.flow}) via ${r.einvoice.platform}.`); }));
  main.querySelectorAll("[data-ef]").forEach((b) => (b.onclick = async () => {
    const inv = (await api("/api/invoices")).find((i) => i.id === b.dataset.ef);
    const e = inv.einvoice;
    openDrawer(`<div class="row"><h2 style="margin:0">Facture ${esc(inv.number)}</h2><span class="spacer"></span><button onclick="closeDrawer()">✕</button></div>
      <p class="muted">${esc(inv.client)} · ${esc(e.format)} · ${e.flow === "e-invoicing" ? "facture électronique (client professionnel)" : "e-reporting (client particulier)"}<br>Via ${esc(e.platform)}${e.simulated ? " (simulé)" : ""}</p>
      <div class="timeline">${e.events.map((x) => `<div><span class="badge ${EF_BADGE[x.status] || ""}">${esc(x.status)}</span> <span class="muted" style="font-size:12px">${fdt(x.at)}</span><br>${esc(x.note)}</div>`).join("")}</div>
      <p class="row"><a href="/api/invoices/${inv.id}/facturx.xml" target="_blank"><button class="small">Voir le XML Factur-X</button></a><a href="/api/invoices/${inv.id}/pdf" target="_blank"><button class="small">PDF (XML intégré)</button></a></p>`);
  }));
}
async function enhanceCompta() {
  const list = await api("/api/einbox");
  const projects = await api("/api/projects");
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `<div class="row"><h2 style="margin:0">📥 Factures fournisseurs reçues par la plateforme</h2><span class="spacer"></span><button class="small" id="ein_sim">Simuler une réception</button></div>
    <p class="muted" style="margin:6px 0 10px">Depuis le 1er septembre 2026, toutes les entreprises reçoivent leurs factures fournisseurs en électronique. Prava les lit, vous validez en un clic et elles sont rangées en compta (et sur le bon chantier).</p>
    <div class="table-wrap"><table><tr><th>Reçue</th><th>Fournisseur</th><th>N°</th><th>Objet</th><th class="num">TTC</th><th>Chantier</th><th>Statut</th><th></th></tr>
    ${list.map((f) => `<tr><td>${fdate(f.receivedAt)}</td><td>${esc(f.supplier)}<br><span class="muted" style="font-size:12px">SIREN ${esc(f.supplierSiren)}</span></td><td>${esc(f.number)}</td><td>${esc(f.label)}</td><td class="num">${eur(f.ttc)}</td>
      <td>${f.status === "à valider" ? `<select data-einp="${f.id}" style="width:auto;max-width:160px"><option value="">—</option>${projects.map((p) => `<option value="${p.id}" ${p.id === f.projectId ? "selected" : ""}>${esc(p.title)}</option>`).join("")}</select>` : esc(projects.find((p) => p.id === f.projectId)?.title || "")}</td>
      <td>${badge(f.status === "rangée" ? "rangé" : f.status === "refusée" ? "annulé" : "à traiter").replace(/>[^<]+</, `>${esc(f.status)}<`)}</td>
      <td class="row">${f.status === "à valider" ? `<button class="small primary" data-eina="${f.id}">Valider</button><button class="small" data-einr="${f.id}">Refuser</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="8" class="muted">Aucune</td></tr>'}</table></div>`;
  main.appendChild(el);
  $("#ein_sim").onclick = async () => { await post("/api/einbox/simulate"); route(); };
  el.querySelectorAll("[data-eina]").forEach((b) => (b.onclick = async () => { const sel = el.querySelector(`[data-einp="${b.dataset.eina}"]`); await post(`/api/einbox/${b.dataset.eina}/accept`, { projectId: sel?.value || null }); await route(); alertBox("Facture validée et rangée dans les dépenses."); }));
  el.querySelectorAll("[data-einr]").forEach((b) => (b.onclick = async () => { const reason = prompt("Motif du refus (transmis au fournisseur)", "Montant différent de la commande"); if (reason !== null) { await post(`/api/einbox/${b.dataset.einr}/accept`, { refuse: true, reason }); route(); } }));
}
const _devis = VIEWS.devis, _compta = VIEWS.compta, _param = VIEWS.parametres;
VIEWS.devis = async () => { await _devis(); await enhanceDevis(); };
VIEWS.compta = async () => { await _compta(); await enhanceCompta(); };

// =====================================================================
// Paramètres : RGE, coûts, fournisseurs, facture électronique, intégrations
// =====================================================================
VIEWS.parametres = async () => {
  await _param();
  const b = STATE.business, I = STATE.integrations;
  const el = document.createElement("div");
  el.innerHTML = `<div class="grid g2">
    <div class="card"><h2>Coûts, RGE et fournisseurs</h2>
      <div class="row"><div style="flex:1;min-width:140px"><label for="p_hc">Coût horaire chargé (€)</label><input id="p_hc" type="number" value="${b.hourlyCost ?? 38}"></div><div style="flex:1;min-width:140px"><label for="p_hr">Taux horaire facturé (€ HT)</label><input id="p_hr" type="number" value="${b.hourlyRate ?? 55}"></div></div>
      <label for="p_rge">Certification RGE (numéro)</label><input id="p_rge" value="${esc(b.rge?.numero || "")}" placeholder="ex. Qualibat RGE 7131 n° …">
      <div class="row"><div style="flex:1;min-width:140px"><label for="p_rgeo">Organisme</label><input id="p_rgeo" value="${esc(b.rge?.organisme || "")}"></div><div style="flex:1;min-width:140px"><label for="p_rgev">Valide jusqu'au</label><input id="p_rgev" type="date" value="${esc(b.rge?.validite || "")}"></div></div>
      <label for="p_sup">Fournisseurs (un par ligne : nom ; email de commande)</label><textarea id="p_sup" rows="3">${esc((b.suppliers || []).map((s) => `${s.name} ; ${s.email}`).join("\n"))}</textarea>
      <label for="p_iban">IBAN (sur les factures)</label><input id="p_iban" value="${esc(b.iban || "")}">
      <label for="p_pa">Plateforme agréée pour la facture électronique</label><input id="p_pa" value="${esc(b.einvoice?.platform || "")}">
      <p><button class="primary" id="p_save2">Enregistrer</button></p></div>
    <div class="card"><h2>Branchements</h2><p class="muted" style="font-size:12px">Tout marche en mode démo. Ajoutez la clé dans le fichier .env pour passer en réel.</p>
      ${Object.values(I).map((x) => `<div class="row" style="border-top:1px solid var(--border);padding:8px 0"><div style="flex:1;min-width:200px"><b>${esc(x.label)}</b><br><span class="muted" style="font-size:12px">${esc(x.env)}</span></div>${statusBadge(x.connected)}</div>`).join("")}
      <p style="margin-bottom:0"><a href="#importer">📥 Importer mon catalogue et mes clients (Excel, Obat, Batappli…)</a></p></div></div>`;
  const demoCard = [...main.querySelectorAll(".card h2")].find((h) => h.textContent === "Démo")?.closest(".card");
  demoCard ? demoCard.before(el) : main.appendChild(el);
  $("#p_save2").onclick = async () => {
    await put("/api/business", { hourlyCost: Number($("#p_hc").value), hourlyRate: Number($("#p_hr").value), rge: $("#p_rge").value.trim() ? { numero: $("#p_rge").value.trim(), organisme: $("#p_rgeo").value, validite: $("#p_rgev").value } : null, suppliers: $("#p_sup").value.split("\n").map((l) => l.split(";").map((x) => x.trim())).filter(([n]) => n).map(([name, email = ""]) => ({ name, email })), defaultSupplier: $("#p_sup").value.split(";")[0].trim(), iban: $("#p_iban").value, einvoice: { ...(b.einvoice || {}), platform: $("#p_pa").value } });
    await route(); alertBox("Enregistré.");
  };
};

// =====================================================================
// Import du catalogue et des clients
// =====================================================================
let importKind = "catalogue";
async function importView() {
  main.insertAdjacentHTML("beforeend", `
    <h1>Importer mes données</h1>
    <p class="sub">Récupérez en 5 minutes votre bibliothèque de prix et votre fichier clients depuis votre ancien logiciel (Obat, Batappli, EBP, Tolteck…) ou un simple fichier Excel. Prava reconnaît les colonnes tout seul.</p>
    <div class="card">
      <div class="row"><button class="${importKind === "catalogue" ? "primary" : ""}" data-kind="catalogue">📚 Catalogue de prix</button><button class="${importKind === "clients" ? "primary" : ""}" data-kind="clients">👥 Fichier clients</button></div>
      <p class="muted" style="font-size:13px">${importKind === "catalogue" ? `Dans Obat : <i>Bibliothèque › Exporter</i>. Dans Batappli : <i>Bibliothèque › Export Excel</i>. Les prix d'achat et temps de pose servent ensuite au calcul de la marge par chantier.` : "Depuis votre logiciel, votre téléphone (export des contacts en CSV) ou un tableau Excel : nom, téléphone, email, adresse. Les doublons sont fusionnés."}</p>
      <div class="row"><label class="small" style="margin:0"><button type="button" class="primary" id="i_pick">📄 Choisir un fichier (.xlsx, .xls, .csv)</button><input type="file" id="i_file" accept=".csv,.txt,.xlsx,.xls,.ods" class="hidden"></label>
        <span class="muted">ou essayez avec un exemple :</span>
        ${importKind === "catalogue" ? `<a href="/api/import/sample?kind=catalogue&format=obat">Export Obat</a> · <a href="/api/import/sample?kind=catalogue&format=batappli">Export Batappli</a> · <button class="small" id="i_try">Charger l'exemple Obat</button>` : `<a href="/api/import/sample?kind=clients">Fichier clients</a> · <button class="small" id="i_try">Charger l'exemple</button>`}</div>
      <label for="i_paste">Ou collez des lignes copiées depuis Excel</label><textarea id="i_paste" rows="3" placeholder="Copiez les cellules dans Excel (avec la ligne des titres) et collez-les ici"></textarea>
    </div>
    <div id="i_prev"></div>`);
  main.querySelectorAll("[data-kind]").forEach((b) => (b.onclick = () => { importKind = b.dataset.kind; route(); }));
  $("#i_pick").onclick = () => $("#i_file").click();
  $("#i_file").onchange = async (e) => { const f = e.target.files[0]; if (f) showPreview(await readSheet(f), f.name); };
  $("#i_paste").oninput = () => { const t = $("#i_paste").value; if (t.trim().split("\n").length > 1) showPreview(parseCsv(t), "collage"); };
  $("#i_try").onclick = async () => { const t = await (await fetch(`/api/import/sample?kind=${importKind}&format=obat`)).text(); showPreview(parseCsv(t.replace(/^﻿/, "")), importKind === "catalogue" ? "bibliotheque-obat.csv" : "clients-export.csv"); };
}

function parseCsv(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const sep = first.includes("\t") ? "\t" : (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function readSheet(file) {
  if (/\.(csv|txt)$/i.test(file.name)) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);
    return parseCsv(text.replace(/^﻿/, ""));
  }
  if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = res; s.onerror = () => rej(new Error("Lecture Excel indisponible hors ligne : enregistrez le fichier en CSV.")); document.head.appendChild(s); });
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
}

const FIELD_LABELS = { code: "Code", label: "Désignation", unit: "Unité", price: "Prix de vente HT", cost: "Prix d'achat HT", hours: "Temps (h)", supplier: "Fournisseur", tva: "TVA", name: "Nom", firstname: "Prénom", lastname: "Nom de famille", phone: "Téléphone", email: "Email", address: "Adresse", zip: "Code postal", city: "Ville", siren: "SIREN / SIRET", notes: "Notes" };
async function showPreview(rows, name) {
  const box = $("#i_prev");
  try {
    const pv = await post("/api/import/preview", { kind: importKind, rows });
    let mapping = pv.mapping.slice();
    const render = async () => {
      box.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Aperçu : ${esc(name)}</h2><span class="spacer"></span><span class="badge ok">${pv.total} ligne(s) lues</span></div>
        <p class="muted" style="font-size:13px">Prava a reconnu les colonnes ci-dessous. Corrigez si besoin, puis importez.</p>
        <div class="table-wrap"><table><tr>${pv.headers.map((h, i) => `<th>${esc(h) || "—"}<br><select data-col="${i}" style="width:auto;font-weight:normal">${["", ...pv.fields].map((f) => `<option value="${f}" ${mapping[i] === f ? "selected" : ""}>${f ? esc(FIELD_LABELS[f] || f) : "Ignorer"}</option>`).join("")}</select></th>`).join("")}</tr>
        ${rows.slice(pv.headerIndex + 1, pv.headerIndex + 7).map((r) => `<tr>${pv.headers.map((_, i) => `<td>${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("")}</table></div>
        <div class="row" style="margin-top:10px"><select id="i_mode" style="width:auto"><option value="ajouter">Ajouter à ${importKind === "catalogue" ? "mon catalogue" : "mes clients"} (mise à jour des doublons)</option>${importKind === "catalogue" ? '<option value="remplacer">Remplacer tout mon catalogue</option>' : ""}</select>
          <button class="primary" id="i_go">Importer</button></div></div>`;
      box.querySelectorAll("[data-col]").forEach((s) => (s.onchange = () => { mapping[Number(s.dataset.col)] = s.value || null; }));
      $("#i_go").onclick = async () => {
        try {
          const r = await post("/api/import", { kind: importKind, rows, mapping, headerIndex: pv.headerIndex, mode: $("#i_mode").value });
          box.innerHTML = `<div class="card" style="border:2px solid var(--ok)"><h2 style="color:var(--ok)">✓ Import terminé</h2><p>${r.added} ${importKind === "catalogue" ? "prestation(s) ajoutée(s)" : "client(s) ajouté(s)"}, ${r.updated} mise(s) à jour.</p><p class="row"><a href="#${importKind === "catalogue" ? "parametres" : "clients"}"><button class="primary">Voir ${importKind === "catalogue" ? "le catalogue" : "les clients"}</button></a></p></div>`;
          STATE = await api("/api/state");
        } catch (e) { alert(e.message); }
      };
    };
    await render();
  } catch (e) { box.innerHTML = `<div class="banner">${esc(e.message)}</div>`; }
}
