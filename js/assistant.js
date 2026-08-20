/* assistant.js — Assistente virtuale PartiAmo.
   Rende la chat nel tab #tab-assistente, raggiungibile dal pulsante
   fluttuante. Parla con la Supabase Edge Function "assistant"
   (Claude lato server, chiave mai esposta al client).
   Nessun dato del Vault viene inviato. */

const Assistant = (function () {

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Storico persistito in Store.s.assistantHistory (localStorage, come il resto
  // dello stato locale): resta visibile a reload/riapertura dell'app, mai
  // sincronizzato su Supabase (solo dati di viaggio lo sono).
  const MAX_HISTORY = 60;
  const history = () => Store.s.assistantHistory || (Store.s.assistantHistory = []);
  let busy = false;

  /* ---------- contesto: solo dati di viaggio, mai allegati o documenti ---------- */
  function context() {
    const s = Store.s, t = s.trip || {};
    const list = s.checklist || [];
    const w = s.weather;
    return {
      destinazione: t.dest || null,
      paese: t.country || null,
      partenza: t.start || null,
      rientro: t.end || null,
      giorni: (typeof Checklist !== "undefined" && t.start && t.end) ? Checklist.days(t) : null,
      tipoViaggio: t.type,
      trasporto: t.transport,
      compagnia: t.airline,
      tariffa: t.fare,
      lavanderia: t.laundry,
      viaggiatori: t.travelers,
      bagagli: (t.luggages || []).map(b => b.type),
      colli: (s.bags || []).map(b => ({ nome: b.name, l: b.l, p: b.w, h: b.h, kg: b.kg, tipo: b.type })),
      meteo: w ? { tminMedia: w.tminAvg, tmaxMedia: w.tmaxAvg, min: w.tmin, max: w.tmax, giorniPioggia: w.rainDays, neve: w.snow } : null,
      checklist: {
        totale: list.length,
        completate: list.filter(i => i.done).length,
        mancanti: list.filter(i => !i.done).slice(0, 25).map(i => i.name)
      },
      itinerario: s.itinerary || {},
      poi: (s.pois || []).map(p => ({ nome: p.name, categoria: p.cat, giorno: p.day })),
      // Del Vault si manda SOLO tipo e scadenza: mai file, note o numeri documento.
      scadenzeDocumenti: (s.docs || []).map(d => ({ tipo: d.type, scadenza: d.expiry })).filter(d => d.scadenza)
    };
  }

  /* ---------- rete ---------- */
  function endpointUrl() {
    // Backend su Supabase Edge Function: stessa base URL già usata per auth/sync
    // (Supa.getUrl(), configurabile), niente server Node da gestire a parte.
    const base = (typeof Supa !== "undefined" && Supa.getUrl) ? Supa.getUrl() : "";
    return base ? base.replace(/\/$/, "") + "/functions/v1/assistant" : "/api/assistant";
  }

  function pushHistory(msg) {
    const h = history();
    h.push(msg);
    while (h.length > MAX_HISTORY) h.shift();
    Store.save();
  }

  async function ask(text) {
    pushHistory({ role: "user", content: text });
    // Le Edge Function di Supabase richiedono un header di autorizzazione:
    // basta la chiave anon pubblica, non serve un utente loggato.
    const anonKey = (typeof Supa !== "undefined" && Supa.getAnonKey) ? Supa.getAnonKey() : "";
    const headers = { "Content-Type": "application/json" };
    if (anonKey) {
      headers["Authorization"] = "Bearer " + anonKey;
      headers["apikey"] = anonKey;
    }
    const r = await fetch(endpointUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: history(), context: context() })
    });
    const data = await r.json().catch(() => ({ error: "Risposta non valida dal server" }));
    if (!r.ok || data.error) throw new Error(data.error || ("Errore " + r.status));
    pushHistory({ role: "assistant", content: data.text });
    return data.text;
  }

  /* ---------- rendering ---------- */
  function bubble(role, text) {
    return `<div class="ai-msg ${role === "user" ? "me" : "bot"}">${esc(text).replace(/\n/g, "<br>")}</div>`;
  }

  function renderThread() {
    const box = $("#ai-thread");
    if (!box) return;
    const t = Store.s.trip || {};
    const head = t.dest
      ? `<div class="ai-context">Contesto: ${esc(t.dest)} · ${esc(t.start || "—")} → ${esc(t.end || "—")}</div>`
      : `<div class="ai-context">Nessun viaggio configurato: compila il tab Viaggio per risposte precise.</div>`;
    box.innerHTML = head + history().map(m => bubble(m.role === "user" ? "user" : "bot", m.content)).join("")
      + (busy ? `<div class="ai-msg bot ai-typing"><i></i><i></i><i></i></div>` : "");
    box.scrollTop = box.scrollHeight;
  }

  function clearHistory() {
    if (busy) return;
    Store.s.assistantHistory = [];
    Store.save();
    renderThread();
    if (typeof UI !== "undefined" && UI.toast) UI.toast("Conversazione cancellata");
  }

  async function send(text) {
    if (busy || !text.trim()) return;
    busy = true;
    renderThread();
    $("#ai-input").value = "";
    renderThread();
    try {
      await ask(text);
    } catch (e) {
      pushHistory({ role: "assistant", content: "Non riesco a contattare l'assistente: " + e.message });
      if (typeof UI !== "undefined" && UI.toast) UI.toast("⚠️ Assistente non disponibile");
    } finally {
      busy = false;
      renderThread();
    }
  }

  function init() {
    const input = $("#ai-input");
    if (input) {
      $("#form-ai").addEventListener("submit", e => { e.preventDefault(); send(input.value); });
    }
    document.addEventListener("click", e => {
      const chip = e.target.closest("[data-ai-ask]");
      if (chip) { if (typeof UI !== "undefined") UI.go("assistente"); send(chip.dataset.aiAsk); return; }
      if (e.target.closest("#btn-ai-fab")) {
        if (typeof UI !== "undefined") UI.go("assistente");
      }
      if (e.target.closest("#btn-ai-clear")) clearHistory();
    });
    renderThread();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { ask, send, renderThread, history };
})();
