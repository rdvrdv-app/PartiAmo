/* assistant.js — Assistente virtuale PartiAmo.
   Rende la chat nel tab #tab-assistente, il pannello suggerimenti in dashboard
   e il pulsante fluttuante. Parla con /api/assistant (Claude lato server).
   Nessun dato del Vault viene inviato. */

const Assistant = (function () {

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const history = [];
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
  async function ask(text) {
    history.push({ role: "user", content: text });
    const r = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history, context: context() })
    });
    const data = await r.json().catch(() => ({ error: "Risposta non valida dal server" }));
    if (!r.ok || data.error) throw new Error(data.error || ("Errore " + r.status));
    history.push({ role: "assistant", content: data.text });
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
    box.innerHTML = head + history.map(m => bubble(m.role === "user" ? "user" : "bot", m.content)).join("")
      + (busy ? `<div class="ai-msg bot ai-typing"><i></i><i></i><i></i></div>` : "");
    box.scrollTop = box.scrollHeight;
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
      history.push({ role: "assistant", content: "Non riesco a contattare l'assistente: " + e.message });
      if (typeof UI !== "undefined" && UI.toast) UI.toast("⚠️ Assistente non disponibile");
    } finally {
      busy = false;
      renderThread();
    }
  }

  /* Suggerimenti in dashboard: calcolati in locale, nessuna chiamata di rete. */
  function renderSuggestions() {
    const box = $("#ai-suggestions");
    if (!box) return;
    const s = Store.s, t = s.trip || {}, w = s.weather;
    const items = [];
    if (w && w.rainDays > 0) items.push(`🌧️ ${w.rainDays} giorn${w.rainDays === 1 ? "o" : "i"} di pioggia previsti: sposta le tappe all'aperto`);
    if (w && (w.tmax - w.tmin) >= 10) items.push(`🌡️ Escursione termica ${w.tmax - w.tmin}°C: vestizione a cipolla`);
    const list = s.checklist || [];
    if (list.length) items.push(`✅ Checklist al ${Math.round(list.filter(i => i.done).length / list.length * 100)}%: ${list.filter(i => !i.done).length} voci da spuntare`);
    (s.docs || []).forEach(d => {
      if (d.type === "passaporto" && d.expiry) items.push(`🛂 Passaporto in scadenza il ${d.expiry.split("-").reverse().join("/")}`);
    });
    if (!items.length) items.push("Configura il viaggio per ricevere suggerimenti su meteo, bagagli e checklist.");
    box.innerHTML = `<ul class="next-commitments-list">` + items.slice(0, 4)
      .map(i => `<li class="next-item"><span>${esc(i)}</span><span class="arr">→</span></li>`).join("") + `</ul>`;
  }

  function init() {
    const input = $("#ai-input");
    if (input) {
      $("#form-ai").addEventListener("submit", e => { e.preventDefault(); send(input.value); });
    }
    document.addEventListener("click", e => {
      const chip = e.target.closest("[data-ai-ask]");
      if (chip) { if (typeof UI !== "undefined") UI.go("assistente"); send(chip.dataset.aiAsk); return; }
      if (e.target.closest("#btn-ai-fab") || e.target.closest("#btn-ai-open")) {
        if (typeof UI !== "undefined") UI.go("assistente");
      }
    });
    renderThread();
    renderSuggestions();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { ask, send, renderSuggestions, renderThread, history };
})();
