/* assistant.js — Assistente virtuale PartiAmo.
   Rende la chat nel tab #tab-assistente, raggiungibile dal pulsante
   fluttuante. Parla con la Supabase Edge Function "assistant"
   (Claude lato server, chiave mai esposta al client).
   Nessun dato del Vault viene inviato.

   Scrittura: l'assistente può proporre modifiche a POI, itinerario,
   contatti e checklist (le uniche quattro categorie coperte). Le azioni
   proposte da Claude arrivano nella risposta come `actions` e vengono
   SEMPRE rivalidate qui (mai fidarsi ciecamente dell'output del modello)
   prima di essere mostrate come riepilogo in chat con conferma esplicita
   dell'utente — non toccano mai Store.s finché non si preme "Applica". */

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

  /* ---------- azioni consentite: SOLO POI, itinerario, contatti, checklist ---------- */
  const POI_CATS = ["visita", "cibo", "trasporto", "shopping", "altro"];
  const CONTACT_KINDS = ["struttura", "emergenza", "trasporto", "ristorante", "altro"];
  const CHECKLIST_CATS = ["documenti", "abbigliamento", "elettronica", "igiene", "extra"];
  const ITIN_SLOTS = ["mattina", "pranzo", "pomeriggio", "cena", "serata", "giornata"];
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function findItineraryLoc(id) {
    const it = Store.s.itinerary || {};
    for (const day of Object.keys(it)) {
      const dayObj = it[day] || {};
      for (const slot of Object.keys(dayObj)) {
        const idx = (dayObj[slot] || []).findIndex(a => a && a.id === id);
        if (idx !== -1) return { day, slot, idx };
      }
    }
    return null;
  }

  const ACTIONS = {
    add_poi: {
      validate(input) {
        if (!input || typeof input.name !== "string" || !input.name.trim()) return "nome mancante";
        if (input.cat !== undefined && !POI_CATS.includes(input.cat)) return "categoria non valida";
        if (input.day && !DAY_RE.test(input.day)) return "giorno non valido";
        return null;
      },
      summary(input) { return `➕ Nuovo POI «${input.name.trim()}»${input.day ? " · " + input.day : ""}`; },
      apply(input) {
        Store.s.pois.push({
          id: Store.uid(), name: input.name.trim(), addr: (input.addr || "").trim(),
          mapsUrl: "", cat: POI_CATS.includes(input.cat) ? input.cat : "altro",
          day: input.day || "", notes: (input.notes || "").trim(), files: []
        });
      }
    },
    edit_poi: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!Store.s.pois.find(p => p.id === input.id)) return "POI non trovato";
        if (input.cat !== undefined && !POI_CATS.includes(input.cat)) return "categoria non valida";
        if (input.day && !DAY_RE.test(input.day)) return "giorno non valido";
        return null;
      },
      summary(input) {
        const p = Store.s.pois.find(x => x.id === input.id);
        return `✏️ Modifica POI «${p ? p.name : input.id}»`;
      },
      apply(input) {
        const p = Store.s.pois.find(x => x.id === input.id);
        if (!p) return;
        if (typeof input.name === "string" && input.name.trim()) p.name = input.name.trim();
        if (typeof input.addr === "string") p.addr = input.addr.trim();
        if (POI_CATS.includes(input.cat)) p.cat = input.cat;
        if (typeof input.day === "string") p.day = input.day;
        if (typeof input.notes === "string") p.notes = input.notes.trim();
      }
    },
    delete_poi: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!Store.s.pois.find(p => p.id === input.id)) return "POI non trovato";
        return null;
      },
      summary(input) {
        const p = Store.s.pois.find(x => x.id === input.id);
        return `🗑️ Elimina POI «${p ? p.name : input.id}»`;
      },
      apply(input) {
        const p = Store.s.pois.find(x => x.id === input.id);
        if (!p) return;
        Store.s.pois = Store.s.pois.filter(x => x.id !== input.id);
        Store.tombstone("pois", input.id);
      }
    },

    add_contact: {
      validate(input) {
        if (!input || typeof input.name !== "string" || !input.name.trim()) return "nome mancante";
        if (input.kind !== undefined && !CONTACT_KINDS.includes(input.kind)) return "tipo non valido";
        return null;
      },
      summary(input) { return `➕ Nuovo contatto «${input.name.trim()}»`; },
      apply(input) {
        Store.s.contacts.push({
          id: Store.uid(), kind: CONTACT_KINDS.includes(input.kind) ? input.kind : "altro",
          name: input.name.trim(), phone: (input.phone || "").trim(), email: (input.email || "").trim(),
          addr: (input.addr || "").trim(), mapsUrl: "", cin: "", cout: "", ref: "", timeLabels: null,
          notes: (input.notes || "").trim(), files: []
        });
      }
    },
    edit_contact: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!Store.s.contacts.find(c => c.id === input.id)) return "contatto non trovato";
        if (input.kind !== undefined && !CONTACT_KINDS.includes(input.kind)) return "tipo non valido";
        return null;
      },
      summary(input) {
        const c = Store.s.contacts.find(x => x.id === input.id);
        return `✏️ Modifica contatto «${c ? c.name : input.id}»`;
      },
      apply(input) {
        const c = Store.s.contacts.find(x => x.id === input.id);
        if (!c) return;
        if (typeof input.name === "string" && input.name.trim()) c.name = input.name.trim();
        if (CONTACT_KINDS.includes(input.kind)) c.kind = input.kind;
        if (typeof input.phone === "string") c.phone = input.phone.trim();
        if (typeof input.email === "string") c.email = input.email.trim();
        if (typeof input.addr === "string") c.addr = input.addr.trim();
        if (typeof input.notes === "string") c.notes = input.notes.trim();
      }
    },
    delete_contact: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!Store.s.contacts.find(c => c.id === input.id)) return "contatto non trovato";
        return null;
      },
      summary(input) {
        const c = Store.s.contacts.find(x => x.id === input.id);
        return `🗑️ Elimina contatto «${c ? c.name : input.id}»`;
      },
      apply(input) {
        const c = Store.s.contacts.find(x => x.id === input.id);
        if (!c) return;
        Store.s.contacts = Store.s.contacts.filter(x => x.id !== input.id);
        Store.tombstone("contacts", input.id);
      }
    },

    add_itinerary_activity: {
      validate(input) {
        if (!input || typeof input.day !== "string" || !DAY_RE.test(input.day)) return "giorno non valido";
        if (typeof input.slot !== "string" || !ITIN_SLOTS.includes(input.slot)) return "fascia non valida";
        if (typeof input.text !== "string" || !input.text.trim()) return "descrizione mancante";
        return null;
      },
      summary(input) { return `➕ Nuova attività «${input.text.trim()}» il ${input.day} (${input.slot})`; },
      apply(input) {
        const it = Store.s.itinerary;
        it[input.day] = it[input.day] || {};
        it[input.day][input.slot] = it[input.day][input.slot] || [];
        it[input.day][input.slot].push({
          id: Store.uuid(), text: input.text.trim(), place: (input.place || "").trim(), time: (input.time || "").trim()
        });
      }
    },
    edit_itinerary_activity: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!findItineraryLoc(input.id)) return "attività non trovata";
        if (input.day !== undefined && !DAY_RE.test(input.day)) return "giorno non valido";
        if (input.slot !== undefined && !ITIN_SLOTS.includes(input.slot)) return "fascia non valida";
        return null;
      },
      summary(input) {
        const loc = findItineraryLoc(input.id);
        const act = loc ? Store.s.itinerary[loc.day][loc.slot][loc.idx] : null;
        return `✏️ Modifica attività «${act ? act.text : input.id}»`;
      },
      apply(input) {
        const loc = findItineraryLoc(input.id);
        if (!loc) return;
        const it = Store.s.itinerary;
        const [act] = it[loc.day][loc.slot].splice(loc.idx, 1);
        if (typeof input.text === "string" && input.text.trim()) act.text = input.text.trim();
        if (typeof input.place === "string") act.place = input.place.trim();
        if (typeof input.time === "string") act.time = input.time.trim();
        const newDay = (typeof input.day === "string" && DAY_RE.test(input.day)) ? input.day : loc.day;
        const newSlot = ITIN_SLOTS.includes(input.slot) ? input.slot : loc.slot;
        it[newDay] = it[newDay] || {};
        it[newDay][newSlot] = it[newDay][newSlot] || [];
        it[newDay][newSlot].push(act);
      }
    },
    delete_itinerary_activity: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!findItineraryLoc(input.id)) return "attività non trovata";
        return null;
      },
      summary(input) {
        const loc = findItineraryLoc(input.id);
        const act = loc ? Store.s.itinerary[loc.day][loc.slot][loc.idx] : null;
        return `🗑️ Elimina attività «${act ? act.text : input.id}»`;
      },
      apply(input) {
        const loc = findItineraryLoc(input.id);
        if (!loc) return;
        const [act] = Store.s.itinerary[loc.day][loc.slot].splice(loc.idx, 1);
        if (act && act.id) Store.tombstone("itinerary", act.id);
      }
    },

    add_checklist_item: {
      validate(input) {
        if (!input || typeof input.name !== "string" || !input.name.trim()) return "nome mancante";
        if (input.cat !== undefined && !CHECKLIST_CATS.includes(input.cat)) return "categoria non valida";
        return null;
      },
      summary(input) { return `➕ Nuova voce checklist «${input.name.trim()}»`; },
      apply(input) {
        Store.s.checklist.push({
          id: Store.uid(), cat: CHECKLIST_CATS.includes(input.cat) ? input.cat : "extra",
          name: input.name.trim(), qty: Math.max(1, parseInt(input.qty, 10) || 1),
          note: "", gen: false, done: false
        });
      }
    },
    edit_checklist_item: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!Store.s.checklist.find(i => i.id === input.id)) return "voce non trovata";
        if (input.cat !== undefined && !CHECKLIST_CATS.includes(input.cat)) return "categoria non valida";
        return null;
      },
      summary(input) {
        const i = Store.s.checklist.find(x => x.id === input.id);
        const flag = typeof input.done === "boolean" ? (input.done ? " · spuntata come fatta" : " · segnata da fare") : "";
        return `✏️ Modifica voce checklist «${i ? i.name : input.id}»${flag}`;
      },
      apply(input) {
        const i = Store.s.checklist.find(x => x.id === input.id);
        if (!i) return;
        if (typeof input.name === "string" && input.name.trim()) i.name = input.name.trim();
        if (CHECKLIST_CATS.includes(input.cat)) i.cat = input.cat;
        if (input.qty !== undefined) { i.qty = Math.max(1, parseInt(input.qty, 10) || 1); i.qtyEdited = true; }
        if (typeof input.done === "boolean") i.done = input.done;
      }
    },
    delete_checklist_item: {
      validate(input) {
        if (!input || !input.id) return "id mancante";
        if (!Store.s.checklist.find(i => i.id === input.id)) return "voce non trovata";
        return null;
      },
      summary(input) {
        const i = Store.s.checklist.find(x => x.id === input.id);
        return `🗑️ Elimina voce checklist «${i ? i.name : input.id}»`;
      },
      apply(input) {
        const i = Store.s.checklist.find(x => x.id === input.id);
        if (!i) return;
        Store.s.checklist = Store.s.checklist.filter(x => x.id !== input.id);
        // Le voci generate automaticamente vanno anche in "removed", altrimenti
        // la prossima rigenerazione della checklist le rimette dentro.
        if (i.gen) { Store.s.removed = Store.s.removed || []; Store.s.removed.push(i.id); }
      }
    }
  };

  /* Non fidarsi mai ciecamente dell'output del modello: ogni azione ricevuta
     deve essere uno dei 12 tool consentiti (le sole 4 categorie autorizzate)
     e avere una forma valida (id esistente per modifica/cancellazione, campi
     obbligatori per un'aggiunta) prima di poter anche solo comparire come
     proposta in chat. */
  function validateActions(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const a of raw) {
      if (!a || typeof a.tool !== "string" || !Object.prototype.hasOwnProperty.call(ACTIONS, a.tool)) continue;
      const spec = ACTIONS[a.tool];
      const input = (a.input && typeof a.input === "object" && !Array.isArray(a.input)) ? a.input : {};
      const err = spec.validate(input);
      if (err) { console.warn(`Assistente: azione "${a.tool}" scartata (${err})`, input); continue; }
      // Selezionata di default: l'utente può togliere la spunta alle singole
      // voci prima di applicare, non è tutto-o-niente.
      out.push({ tool: a.tool, input, summary: spec.summary(input), selected: true });
    }
    return out;
  }

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
      // Includono l'id di ogni voce: serve all'assistente per proporre
      // modifiche/cancellazioni mirate (mai testo libero come riferimento).
      checklist: {
        totale: list.length,
        completate: list.filter(i => i.done).length,
        voci: list.map(i => ({ id: i.id, nome: i.name, cat: i.cat, qty: i.qty, fatto: !!i.done }))
      },
      itinerario: s.itinerary || {},
      poi: (s.pois || []).map(p => ({ id: p.id, nome: p.name, categoria: p.cat, giorno: p.day, indirizzo: p.addr, note: p.notes })),
      contatti: (s.contacts || []).map(c => ({ id: c.id, nome: c.name, tipo: c.kind, telefono: c.phone, email: c.email, indirizzo: c.addr, note: c.notes })),
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
    const actions = validateActions(data.actions);
    pushHistory({ role: "assistant", content: data.text || "", actions });
    return data.text;
  }

  /* ---------- rendering ---------- */
  function bubble(role, text) {
    return `<div class="ai-msg ${role === "user" ? "me" : "bot"}">${esc(text).replace(/\n/g, "<br>")}</div>`;
  }

  function proposalCard(msg, idx) {
    if (!msg.actions || !msg.actions.length) return "";
    if (msg.status === "applied") {
      const n = msg.appliedCount != null ? msg.appliedCount : msg.actions.length;
      const total = msg.actions.length;
      const label = n < total ? `✅ Applicate ${n} di ${total} modifiche proposte` : "✅ Modifiche applicate";
      return `<div class="ai-msg bot ai-proposal ai-proposal-done"><div class="ai-proposal-status">${label}</div></div>`;
    }
    if (msg.status === "cancelled") {
      return `<div class="ai-msg bot ai-proposal ai-proposal-done"><div class="ai-proposal-status">Modifiche annullate</div></div>`;
    }
    // Ogni voce ha una spunta indipendente, selezionata di default: non è
    // tutto-o-niente, si può scartare solo qualcuna delle modifiche proposte.
    return `<div class="ai-msg bot ai-proposal" data-msg-idx="${idx}">
      <div class="ai-proposal-head">Modifiche proposte — scegli cosa applicare</div>
      <div class="ai-proposal-list">${msg.actions.map((a, ai) => `
        <label class="ai-proposal-item">
          <input type="checkbox" data-proposal-check="${idx}|${ai}" ${a.selected !== false ? "checked" : ""}>
          <span>${esc(a.summary)}</span>
        </label>`).join("")}</div>
      <div class="ai-proposal-actions">
        <button type="button" class="ghost small" data-proposal-cancel="${idx}">Annulla tutto</button>
        <button type="button" class="primary small" data-proposal-apply="${idx}">✅ Applica selezionate</button>
      </div>
    </div>`;
  }

  function renderThread() {
    const box = $("#ai-thread");
    if (!box) return;
    const t = Store.s.trip || {};
    const head = t.dest
      ? `<div class="ai-context">Contesto: ${esc(t.dest)} · ${esc(t.start || "—")} → ${esc(t.end || "—")}</div>`
      : `<div class="ai-context">Nessun viaggio configurato: compila il tab Viaggio per risposte precise.</div>`;
    box.innerHTML = head + history().map((m, idx) => {
      const text = (m.content || "").trim() ? bubble(m.role === "user" ? "user" : "bot", m.content) : "";
      return text + proposalCard(m, idx);
    }).join("") + (busy ? `<div class="ai-msg bot ai-typing"><i></i><i></i><i></i></div>` : "");
    box.scrollTop = box.scrollHeight;
  }

  function clearHistory() {
    if (busy) return;
    Store.s.assistantHistory = [];
    Store.save();
    renderThread();
    if (typeof UI !== "undefined" && UI.toast) UI.toast("Conversazione cancellata");
  }

  function toggleProposalAction(msgIdx, actionIdx, checked) {
    const msg = history()[msgIdx];
    if (!msg || !msg.actions || !msg.actions[actionIdx] || msg.status) return;
    msg.actions[actionIdx].selected = !!checked;
    Store.save();
  }

  /* Esegue solo le voci con la spunta attiva (non tutto-o-niente): ognuna
     viene rivalidata appena prima di scriverla — lo stato può essere
     cambiato nel frattempo (es. una scheda cancellata a mano) — e quelle
     non più valide vengono saltate silenziosamente invece di rompere
     l'applicazione delle altre. */
  function applyProposal(idx) {
    const h = history();
    const msg = h[idx];
    if (!msg || !msg.actions || !msg.actions.length || msg.status) return;
    const toApply = msg.actions.filter(a => a.selected !== false);
    if (!toApply.length) {
      if (typeof UI !== "undefined" && UI.toast) UI.toast("Nessuna modifica selezionata");
      return;
    }
    let applied = 0, skipped = 0;
    toApply.forEach(a => {
      const spec = ACTIONS[a.tool];
      if (!spec || spec.validate(a.input)) { skipped++; return; }
      spec.apply(a.input);
      applied++;
    });
    msg.status = "applied";
    msg.appliedCount = applied;
    Store.save();
    if (typeof UI !== "undefined") {
      UI.renderContacts();
      UI.renderItinerary();
      UI.renderChecklist();
      UI.renderDashboard();
      if (UI.toast) UI.toast(skipped ? `✅ Applicate ${applied}, ${skipped} non più valide` : `✅ Applicate ${applied} modifiche`);
    }
    renderThread();
  }

  function cancelProposal(idx) {
    const h = history();
    const msg = h[idx];
    if (!msg || !msg.actions || !msg.actions.length || msg.status) return;
    msg.status = "cancelled";
    Store.save();
    renderThread();
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
      if (e.target.closest("#btn-ai-clear")) { clearHistory(); return; }
      const applyBtn = e.target.closest("[data-proposal-apply]");
      if (applyBtn) { applyProposal(+applyBtn.dataset.proposalApply); return; }
      const cancelBtn = e.target.closest("[data-proposal-cancel]");
      if (cancelBtn) { cancelProposal(+cancelBtn.dataset.proposalCancel); return; }
    });
    document.addEventListener("change", e => {
      const chk = e.target.closest("[data-proposal-check]");
      if (!chk) return;
      const [msgIdx, actionIdx] = chk.dataset.proposalCheck.split("|").map(Number);
      toggleProposalAction(msgIdx, actionIdx, chk.checked);
    });
    renderThread();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { ask, send, renderThread, history };
})();
