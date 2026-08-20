/* store.js — persistence. Structured state in localStorage, binary attachments in IndexedDB. */

const Store = (function () {
  const KEY = "partiamo.state.v1";

  function blank() {
    return {
      trip: {
        dest: "", country: "", start: "", end: "", type: "urbano",
        transport: "aereo", airline: "ryanair", fare: "", luggage: "trolley",
        luggages: [{ id: "l1", type: "zaino" }, { id: "l2", type: "trolley" }],
        travelers: 1, laundry: "no"
      },
      weather: null,
      checklist: [],
      bags: [],
      docs: [],
      contacts: [],
      pois: [],
      itinerary: {},
      assistantHistory: [],
      // Id delle schede cancellate in locale, in attesa di essere rimosse
      // anche dal cloud: propagare le cancellazioni per id evita di toccare
      // ciò che gli altri partecipanti hanno aggiunto nel frattempo.
      deleted: { pois: [], contacts: [], itinerary: [] },
      theme: null
    };
  }

  let state = blank();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        state = Object.assign(blank(), JSON.parse(raw));
        if (state.trip && !state.trip.luggages) {
          const l = state.trip.luggage || "trolley";
          const arr = [{ id: "l1", type: "zaino" }];
          if (l.includes("trolley")) arr.push({ id: "l2", type: "trolley" });
          if (l.includes("stiva")) arr.push({ id: "l3", type: "stiva" });
          state.trip.luggages = arr;
        }
        const d = state.deleted && typeof state.deleted === "object" ? state.deleted : {};
        state.deleted = {
          pois: Array.isArray(d.pois) ? d.pois : [],
          contacts: Array.isArray(d.contacts) ? d.contacts : [],
          itinerary: Array.isArray(d.itinerary) ? d.itinerary : []
        };
      }
    } catch (e) {
      console.warn("Stato corrotto, reset", e);
      state = blank();
    }
    return state;
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      if (typeof UI !== "undefined" && UI && UI.toast) UI.toast("Spazio esaurito: rimuovi qualche allegato");
      return false;
    }
  }

  let syncTimer = null;
  let syncPaused = false;

  function scheduleSync() {
    if (syncPaused) return;
    if (!window.Supa || typeof Supa.getUser !== "function" || !Supa.getUser()) return;
    if (!state.trip || !state.trip.dest) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      Supa.pushTrip(state).catch(err => console.warn("Sync:", err));
    }, 1200);
  }

  /* save()            → salva in locale e programma la sincronizzazione.
     saveLocalOnly()   → salva soltanto in locale (usato dalla sincronizzazione
                         stessa per non innescare un ciclo di scritture). */
  function save() {
    if (persist()) scheduleSync();
  }

  function saveLocalOnly() { persist(); }

  function reset() {
    state = blank();
    persist();
    Media.clear();
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const uuid = () => (window.Supa && Supa.uuid) ? Supa.uuid() :
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : uid());

  return {
    get s() { return state; },
    load, save, saveLocalOnly, reset, uid, uuid,

    /* Segna una scheda come cancellata, così la rimozione arriva anche
       sugli altri dispositivi al prossimo salvataggio. */
    tombstone(kind, id) {
      if (!id || !state.deleted || !state.deleted[kind]) return;
      if (!state.deleted[kind].includes(id)) state.deleted[kind].push(id);
    },

    /* Durante il ripristino dal cloud le scritture locali non devono
       rimbalzare sul database sovrascrivendo i dati appena scaricati. */
    pauseSync() { syncPaused = true; clearTimeout(syncTimer); },
    resumeSync(runNow) {
      syncPaused = false;
      if (runNow) scheduleSync();
    },
    syncNow() {
      clearTimeout(syncTimer);
      if (syncPaused) return Promise.resolve(null);
      if (!window.Supa || !Supa.getUser || !Supa.getUser()) return Promise.resolve(null);
      return Supa.pushTrip(state).catch(err => { console.warn("Sync:", err); return null; });
    }
  };
})();

/* Media — IndexedDB blob store (files are too large for localStorage). */
const Media = (function () {
  const DB = "partiamo-media", STORE = "files";
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }

  const urls = new Map();

  return {
    async put(id, file) {
      // Si copiano i byte: salvando l'oggetto File, IndexedDB conserva solo un rimando
      // al percorso su disco e l'allegato si rompe appena l'originale viene spostato.
      const buf = await file.arrayBuffer();
      const blob = new Blob([buf], { type: file.type || "application/octet-stream" });
      await tx("readwrite", st => st.put({ blob, name: file.name, type: file.type, size: blob.size }, id));
      return id;
    },
    async get(id) { return tx("readonly", st => st.get(id)); },
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const rec = await this.get(id);
      if (!rec) return null;
      const u = URL.createObjectURL(rec.blob);
      urls.set(id, u);
      return u;
    },
    async del(id) {
      if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
      return tx("readwrite", st => st.delete(id));
    },
    async saveAll(fileList) {
      const ids = [];
      for (const f of fileList) {
        const id = Store.uid();
        await this.put(id, f);
        ids.push({ id, name: f.name, type: f.type });
      }
      return ids;
    },
    clear() { tx("readwrite", st => st.clear()).catch(() => {}); }
  };
})();
