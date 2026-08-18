/* supabase.js — Auth (link o codice via email), sincronizzazione multi-dispositivo e inviti. */

const Supa = (function () {
  let client = null;
  let currentUser = null;
  let currentSession = null;
  let profileEnsuredFor = null;

  const STORAGE_URL_KEY = "partiamo_supa_url";
  const STORAGE_ANON_KEY = "partiamo_supa_key";

  const DEFAULT_SUPABASE_URL = "https://jobclfopbomkuabnbjgr.supabase.co";
  const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvYmNsZm9wYm9ta3VhYm5iamdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTk1NjAsImV4cCI6MjEwMjAzNTU2MH0.bv83dh3lqczNPqp6MzUEfGb3QiuBzB-F-2odumqaEEM";

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function uuid() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, ch => {
      const r = Math.random() * 16 | 0;
      return (ch === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function isUuid(v) { return UUID_RE.test(String(v || "")); }

  function getSavedCredentials() {
    const url = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_URL_KEY)) || (typeof window !== "undefined" && window.SUPABASE_URL) || DEFAULT_SUPABASE_URL;
    const key = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_ANON_KEY)) || (typeof window !== "undefined" && window.SUPABASE_ANON_KEY) || DEFAULT_SUPABASE_ANON_KEY;
    return { url, key };
  }

  function isConfigured() {
    const { url, key } = getSavedCredentials();
    return !!(url && key && window.supabase);
  }

  function initClient() {
    const { url, key } = getSavedCredentials();
    if (url && key && window.supabase) {
      try {
        client = window.supabase.createClient(url, key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            // Il link della mail viene quasi sempre aperto su un dispositivo
            // diverso da quello che l'ha richiesto: il flusso PKCE fallirebbe
            // perché il code_verifier resta sul dispositivo di partenza.
            // Il flusso implicito porta i token nel fragment e funziona ovunque.
            flowType: "implicit",
            detectSessionInUrl: true
          }
        });
        return client;
      } catch (err) {
        console.warn("Supabase init failed:", err);
      }
    }
    return null;
  }

  /* L'URL a cui torna il link della mail: senza query e senza fragment,
     altrimenti Supabase rifiuta il redirect (deve combaciare con la
     allow-list) oppure il ?join=… si sovrappone ai token di accesso. */
  function redirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  /* Da un link "magico" incollato dall'utente estrae il token di verifica. */
  function extractTokenHash(raw) {
    const value = String(raw || "").trim();
    if (!value) return null;
    if (/^\d{6,8}$/.test(value)) return null;         // è un codice OTP, non un link
    try {
      const url = new URL(value);
      const fromQuery = url.searchParams.get("token_hash") || url.searchParams.get("token");
      if (fromQuery) return fromQuery;
      if (url.hash) {
        const h = new URLSearchParams(url.hash.substring(1));
        return h.get("token_hash") || h.get("token");
      }
    } catch (e) {
      // Non è un URL: può essere il token incollato da solo (pkce_… o esadecimale lungo).
      if (value.length >= 20 && !/\s/.test(value)) return value;
    }
    return null;
  }

  function cleanAuthParamsFromUrl() {
    const url = new URL(window.location.href);
    let touched = false;
    ["code", "error", "error_code", "error_description", "token_hash", "type"].forEach(p => {
      if (url.searchParams.has(p)) { url.searchParams.delete(p); touched = true; }
    });
    if (/access_token|refresh_token|error|provider_token/.test(url.hash || "")) { url.hash = ""; touched = true; }
    if (touched) window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }

  async function resolveUser() {
    if (currentUser) return currentUser;
    const c = client || initClient();
    if (!c) return null;
    try {
      const { data } = await c.auth.getUser();
      currentUser = data ? data.user : null;
    } catch (e) { /* offline o sessione assente */ }
    return currentUser;
  }

  /* ---------------- mappatura locale <-> remoto ---------------- */

  function tripToRow(trip, state, ownedByMe, userId) {
    const row = {
      id: trip.id,
      dest: trip.dest,
      country: trip.country || "",
      start_date: trip.start,
      end_date: trip.end,
      travelers: Number(trip.travelers) || 1,
      transport: trip.transport || "aereo",
      airline: trip.airline || "nessuna",
      fare: trip.fare || "nessuna",
      invite_code: trip.inviteCode,
      updated_at: new Date().toISOString(),
      prefs: {
        type: trip.type || "urbano",
        luggage: trip.luggage || "",
        luggages: trip.luggages || [],
        laundry: trip.laundry || "no",
        bags: (state && state.bags) || []
      }
    };
    if (ownedByMe) row.owner_id = userId;
    return row;
  }

  function rowToTrip(row) {
    const prefs = row.prefs || {};
    return {
      id: row.id,
      ownerId: row.owner_id || null,
      inviteCode: row.invite_code || "",
      dest: row.dest || "",
      country: row.country || "",
      start: row.start_date || "",
      end: row.end_date || "",
      travelers: row.travelers || 1,
      transport: row.transport || "aereo",
      airline: row.airline || "nessuna",
      fare: row.fare || "nessuna",
      type: prefs.type || "urbano",
      luggage: prefs.luggage || "",
      luggages: Array.isArray(prefs.luggages) ? prefs.luggages : null,
      laundry: prefs.laundry || "no",
      bags: Array.isArray(prefs.bags) ? prefs.bags : null
    };
  }

  const poiToRow = (p, tripId, userId) => ({
    id: p.id, trip_id: tripId, created_by: userId,
    name: p.name || "", addr: p.addr || "", maps_url: p.mapsUrl || "",
    cat: p.cat || "visita", day: p.day || null, notes: p.notes || ""
  });

  const rowToPoi = r => ({
    id: r.id, name: r.name || "", addr: r.addr || "", mapsUrl: r.maps_url || "",
    cat: r.cat || "visita", day: r.day || "", notes: r.notes || "", files: []
  });

  const contactToRow = (ct, tripId, userId) => ({
    id: ct.id, trip_id: tripId, created_by: userId,
    kind: ct.kind || "struttura", name: ct.name || "", phone: ct.phone || "",
    email: ct.email || "", addr: ct.addr || "", cin: ct.cin || "",
    cout: ct.cout || "", ref: ct.ref || "", notes: ct.notes || ""
  });

  const rowToContact = r => ({
    id: r.id, kind: r.kind || "struttura", name: r.name || "", phone: r.phone || "",
    email: r.email || "", addr: r.addr || "", cin: r.cin || "", cout: r.cout || "",
    ref: r.ref || "", notes: r.notes || "", files: []
  });

  /* itinerary locale: { "2026-04-01": { mattina: [ {id,text,place,time} ] } } */
  function itineraryToRows(itinerary, tripId, userId) {
    const rows = [];
    Object.keys(itinerary || {}).forEach(day => {
      const slots = itinerary[day] || {};
      Object.keys(slots).forEach(slot => {
        (slots[slot] || []).forEach(act => {
          if (!act || !act.text || !isUuid(act.id)) return;
          rows.push({
            id: act.id, trip_id: tripId, created_by: userId,
            day, slot, text: act.text, place: act.place || "", time: act.time || ""
          });
        });
      });
    });
    return rows;
  }

  function rowsToItinerary(rows) {
    const out = {};
    (rows || []).forEach(r => {
      if (!r.day || !r.slot) return;
      out[r.day] = out[r.day] || {};
      out[r.day][r.slot] = out[r.day][r.slot] || [];
      out[r.day][r.slot].push({ id: r.id, text: r.text || "", place: r.place || "", time: r.time || "" });
    });
    return out;
  }

  /* La checklist è privata per utente. Formato v2: oltre alle voci conserva
     l'elenco delle voci generate che l'utente ha tolto, altrimenti ricomparirebbero
     sugli altri dispositivi. Si continua a leggere anche il formato "array". */
  const writeChecklist = state => ({
    v: 2,
    list: state.checklist || [],
    removed: state.removed || []
  });

  function readChecklist(raw) {
    if (Array.isArray(raw)) return { list: raw, removed: [] };
    if (raw && Array.isArray(raw.list)) return { list: raw.list, removed: Array.isArray(raw.removed) ? raw.removed : [] };
    return null;
  }

  /* Firma dei dati già inviati: evita di riscrivere sul database ad ogni
     salvataggio locale (il meteo, per esempio, salva molto spesso). */
  const lastPushed = {};
  function changed(section, payload, signatureSource) {
    const sig = JSON.stringify(signatureSource === undefined ? payload : signatureSource);
    if (lastPushed[section] === sig) return false;
    lastPushed[section] = sig;
    return true;
  }
  function forgetSignatures() { Object.keys(lastPushed).forEach(k => delete lastPushed[k]); }

  return {
    isConfigured,
    uuid,
    isUuid,

    getUrl() {
      return getSavedCredentials().url;
    },

    getClient() {
      if (!client) initClient();
      return client;
    },

    saveCredentials(url, key) {
      if (url) localStorage.setItem(STORAGE_URL_KEY, url.trim());
      if (key) localStorage.setItem(STORAGE_ANON_KEY, key.trim());
      client = null;
      return initClient();
    },

    async init() {
      const c = this.getClient();
      if (!c) return null;

      try {
        await this.completeUrlAuth();

        const { data: { session } } = await c.auth.getSession();
        currentSession = session;
        currentUser = session ? session.user : null;

        c.auth.onAuthStateChange((event, session) => {
          const previousId = currentUser ? currentUser.id : null;
          currentSession = session;
          currentUser = session ? session.user : null;
          if (!currentUser || currentUser.id !== previousId) forgetSignatures();
          // TOKEN_REFRESHED scatta ogni ora: non deve far ripartire la
          // sincronizzazione completa se l'utente non è cambiato.
          if (event === "TOKEN_REFRESHED" && currentUser && currentUser.id === previousId) return;
          if (window.UI && typeof window.UI.onAuthChanged === "function") {
            window.UI.onAuthChanged(currentUser);
          }
        });

        return currentUser;
      } catch (err) {
        console.warn("Auth session check error:", err);
      }
      return null;
    },

    /* Chiude il giro del link ricevuto per email, in tutte le sue forme:
       token nel fragment (flusso implicito), ?code= (PKCE), ?token_hash=. */
    async completeUrlAuth() {
      const c = this.getClient();
      if (!c) return { status: "none" };

      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

      const errorCode = query.get("error_code") || hash.get("error_code");
      const errorDesc = query.get("error_description") || hash.get("error_description");
      if (errorCode || errorDesc) {
        cleanAuthParamsFromUrl();
        return { status: "error", code: errorCode, description: (errorDesc || "").replace(/\+/g, " ") };
      }

      try {
        const tokenHash = query.get("token_hash");
        if (tokenHash) {
          const { error } = await c.auth.verifyOtp({ token_hash: tokenHash, type: query.get("type") || "email" });
          cleanAuthParamsFromUrl();
          if (error) return { status: "error", description: error.message };
          return { status: "signed-in" };
        }

        const code = query.get("code");
        if (code && typeof c.auth.exchangeCodeForSession === "function") {
          const { error } = await c.auth.exchangeCodeForSession(code);
          cleanAuthParamsFromUrl();
          if (error) return { status: "error", description: error.message };
          return { status: "signed-in" };
        }

        if (hash.get("access_token")) {
          // getSession() attende la lettura del fragment da parte del client:
          // ripulire l'URL prima farebbe perdere i token appena arrivati.
          await c.auth.getSession();
          cleanAuthParamsFromUrl();
          return { status: "signed-in" };
        }
      } catch (err) {
        cleanAuthParamsFromUrl();
        return { status: "error", description: err.message };
      }

      return { status: "none" };
    },

    getUser() { return currentUser; },
    getSession() { return currentSession; },

    async signInMagicLink(email) {
      const c = this.getClient();
      if (!c) throw new Error("Supabase non configurato");
      const { data, error } = await c.auth.signInWithOtp({
        email: String(email || "").trim(),
        options: { shouldCreateUser: true, emailRedirectTo: redirectUrl() }
      });
      if (error) throw error;
      return data;
    },

    /* Accetta indifferentemente il codice a 6 cifre oppure il link ricevuto
       per email (incollato per intero): così l'accesso funziona qualunque
       cosa contenga il template della mail. */
    async verifyOtp(email, input) {
      const c = this.getClient();
      if (!c) throw new Error("Supabase non configurato");

      const value = String(input || "").trim();
      const tokenHash = extractTokenHash(value);

      const { data, error } = tokenHash
        ? await c.auth.verifyOtp({ token_hash: tokenHash, type: "email" })
        : await c.auth.verifyOtp({ email: String(email || "").trim(), token: value.replace(/\s+/g, ""), type: "email" });

      if (error) throw error;
      return data;
    },

    async signInGoogle() {
      const c = this.getClient();
      if (!c) throw new Error("Supabase non configurato");
      const { data, error } = await c.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectUrl() }
      });
      if (error) throw error;
      return data;
    },

    async signOut() {
      const c = this.getClient();
      if (!c) return;
      await c.auth.signOut();
      currentUser = null;
      currentSession = null;
      profileEnsuredFor = null;
      forgetSignatures();
      if (window.UI && typeof window.UI.onAuthChanged === "function") {
        window.UI.onAuthChanged(null);
      }
    },

    /* trips.owner_id ha una foreign key su profiles: se il profilo manca
       (account creato prima del trigger) ogni salvataggio fallirebbe. */
    async ensureProfile() {
      const c = this.getClient();
      const u = await resolveUser();
      if (!c || !u || profileEnsuredFor === u.id) return;
      try {
        await c.from("profiles").upsert({
          id: u.id,
          email: u.email || "",
          full_name: (u.user_metadata && u.user_metadata.full_name) || null,
          avatar_url: (u.user_metadata && u.user_metadata.avatar_url) || null
        }, { onConflict: "id" });
        profileEnsuredFor = u.id;
      } catch (err) {
        console.warn("ensureProfile:", err);
      }
    },

    async joinTripByCode(code) {
      const c = this.getClient();
      const u = await resolveUser();
      if (!c || !u) throw new Error("Accedi prima per unirti al viaggio");
      await this.ensureProfile();

      const cleanCode = String(code || "").trim();

      // La RLS impedisce di leggere un viaggio di cui non si è ancora membri:
      // l'iscrizione passa da una funzione SECURITY DEFINER lato database.
      const { data, error } = await c.rpc("join_trip_by_code", { p_code: cleanCode });
      if (error) {
        if (/function .*join_trip_by_code/i.test(error.message || "")) {
          throw new Error("Aggiorna lo schema del database (supabase_schema.sql) per abilitare gli inviti");
        }
        throw new Error(error.message || "Codice invito non valido o viaggio non trovato");
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.id) throw new Error("Codice invito non valido o viaggio non trovato");
      forgetSignatures();
      return row;
    },

    async getTripParticipants(tripId) {
      const c = this.getClient();
      if (!c || !tripId) return [];
      try {
        const { data, error } = await c
          .from("trip_participants")
          .select("user_id, role, profiles(email, full_name, avatar_url)")
          .eq("trip_id", tripId);
        if (error) throw error;
        return data || [];
      } catch (err) {
        console.warn("Get participants error:", err);
        return [];
      }
    },

    /* ---------------- lettura dal cloud ---------------- */

    async listTrips() {
      const c = this.getClient();
      const u = await resolveUser();
      if (!c || !u) return [];

      const byId = new Map();
      const [owned, joined] = await Promise.all([
        c.from("trips").select("*").eq("owner_id", u.id),
        c.from("trip_participants").select("role, trips(*)").eq("user_id", u.id)
      ]);

      if (owned.error) console.warn("listTrips (owner):", owned.error.message);
      (owned.data || []).forEach(t => byId.set(t.id, t));

      if (joined.error) console.warn("listTrips (partecipante):", joined.error.message);
      (joined.data || []).forEach(r => { if (r.trips && !byId.has(r.trips.id)) byId.set(r.trips.id, r.trips); });

      return Array.from(byId.values()).sort((a, b) => {
        const ta = Date.parse(a.updated_at || a.created_at || 0) || 0;
        const tb = Date.parse(b.updated_at || b.created_at || 0) || 0;
        return tb - ta;
      });
    },

    /* Scarica il viaggio (quello indicato, altrimenti il più recente) con
       tutti i dati collegati. Le query partono in parallelo. */
    async pullTrip(preferredId) {
      const c = this.getClient();
      const u = await resolveUser();
      if (!c || !u) return null;

      const trips = await this.listTrips();
      if (!trips.length) return null;

      const row = (preferredId && trips.find(t => t.id === preferredId)) || trips[0];

      const [pois, contacts, itin, checklist] = await Promise.all([
        c.from("pois").select("*").eq("trip_id", row.id),
        c.from("contacts").select("*").eq("trip_id", row.id),
        c.from("itinerary_items").select("*").eq("trip_id", row.id),
        c.from("checklists").select("items, updated_at").eq("trip_id", row.id).eq("user_id", u.id).maybeSingle()
      ]);

      [pois, contacts, itin].forEach(res => { if (res.error) console.warn("pullTrip:", res.error.message); });

      return {
        trip: rowToTrip(row),
        pois: (pois.data || []).map(rowToPoi),
        contacts: (contacts.data || []).map(rowToContact),
        itinerary: rowsToItinerary(itin.data || []),
        checklist: readChecklist(checklist.data && checklist.data.items),
        tripsCount: trips.length
      };
    },

    /* ---------------- scrittura sul cloud ---------------- */

    /* Salva viaggio, POI, contatti, itinerario e checklist.
       Ritorna il viaggio salvato oppure null se non c'era nulla da fare. */
    async pushTrip(state) {
      const c = this.getClient();
      const u = await resolveUser();
      if (!c || !u || !state || !state.trip) return null;

      const trip = state.trip;
      if (!trip.dest || !trip.start || !trip.end) return null;   // start_date/end_date sono NOT NULL

      await this.ensureProfile();

      let localDirty = false;
      if (!isUuid(trip.id)) { trip.id = uuid(); localDirty = true; }
      if (!trip.inviteCode) {
        const cleanDest = trip.dest.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
        trip.inviteCode = `${cleanDest || "TRIP"}-${Math.floor(1000 + Math.random() * 9000)}`;
        localDirty = true;
      }

      // Gli id locali (base36) non sono UUID: senza questa normalizzazione ogni
      // upsert inserirebbe una riga nuova, duplicando POI e contatti nel cloud.
      (state.pois || []).forEach(p => { if (!isUuid(p.id)) { p.id = uuid(); localDirty = true; } });
      (state.contacts || []).forEach(ct => { if (!isUuid(ct.id)) { ct.id = uuid(); localDirty = true; } });
      Object.keys(state.itinerary || {}).forEach(day => {
        Object.keys(state.itinerary[day] || {}).forEach(slot => {
          (state.itinerary[day][slot] || []).forEach(act => {
            if (act && !isUuid(act.id)) { act.id = uuid(); localDirty = true; }
          });
        });
      });
      if (localDirty && typeof Store !== "undefined" && Store.saveLocalOnly) Store.saveLocalOnly();

      const ownedByMe = !trip.ownerId || trip.ownerId === u.id;

      try {
        const tripRow = tripToRow(trip, state, ownedByMe, u.id);
        // updated_at cambia ad ogni chiamata: va escluso dal confronto,
        // altrimenti la firma risulterebbe sempre diversa.
        const tripSig = Object.assign({}, tripRow, { updated_at: null });
        if (changed("trip", tripRow, tripSig)) {
          const { error } = await c.from("trips").upsert(tripRow, { onConflict: "id" });
          if (error) { console.error("Salvataggio viaggio:", error.message); delete lastPushed.trip; return null; }
        }

        if (ownedByMe) {
          trip.ownerId = u.id;
          if (changed("participant", trip.id)) {
            await c.from("trip_participants").upsert(
              { trip_id: trip.id, user_id: u.id, role: "owner" },
              { onConflict: "trip_id,user_id" }
            );
          }
        }

        // Le scritture indipendenti partono insieme; ogni lavoro porta con sé il
        // nome della sezione, così un errore azzera solo la firma di quella
        // sezione e il tentativo successivo la riprova.
        const jobs = [];
        const run = (section, query) => jobs.push({ section, query });

        const poiRows = (state.pois || []).map(p => poiToRow(p, trip.id, u.id));
        if (poiRows.length && changed("pois", poiRows)) run("pois", c.from("pois").upsert(poiRows, { onConflict: "id" }));

        const contactRows = (state.contacts || []).map(ct => contactToRow(ct, trip.id, u.id));
        if (contactRows.length && changed("contacts", contactRows)) run("contacts", c.from("contacts").upsert(contactRows, { onConflict: "id" }));

        const itinRows = itineraryToRows(state.itinerary, trip.id, u.id);
        if (itinRows.length && changed("itinerary", itinRows)) run("itinerary", c.from("itinerary_items").upsert(itinRows, { onConflict: "id" }));

        const checklistPayload = writeChecklist(state);
        if (changed("checklist", checklistPayload)) {
          run("checklist", c.from("checklists").upsert(
            { user_id: u.id, trip_id: trip.id, items: checklistPayload, updated_at: new Date().toISOString() },
            { onConflict: "user_id,trip_id" }
          ));
        }

        // Cancellazioni: si propagano per id (lapidi), così non si toccano mai
        // le righe aggiunte nel frattempo dagli altri partecipanti.
        const tomb = state.deleted || {};
        const tombJobs = [
          ["pois", tomb.pois],
          ["contacts", tomb.contacts],
          ["itinerary_items", tomb.itinerary]
        ].filter(([, ids]) => (ids || []).some(isUuid));

        tombJobs.forEach(([table, ids]) => {
          run("delete:" + table, c.from(table).delete().in("id", ids.filter(isUuid)));
        });

        const results = await Promise.all(jobs.map(j => j.query));
        let failed = false;
        results.forEach((res, i) => {
          if (!res || !res.error) return;
          failed = true;
          console.warn("Sincronizzazione (" + jobs[i].section + "):", res.error.message);
          delete lastPushed[jobs[i].section];
        });

        if (!failed) {
          // Marca ciò che è arrivato nel cloud: al prossimo ripristino
          // distingue "creato qui e non ancora inviato" (da conservare) da
          // "cancellato da un altro dispositivo" (da rimuovere).
          const stamp = Date.now();
          (state.pois || []).forEach(p => { p.syncedAt = stamp; });
          (state.contacts || []).forEach(ct => { ct.syncedAt = stamp; });
          Object.keys(state.itinerary || {}).forEach(day => {
            Object.keys(state.itinerary[day] || {}).forEach(slot => {
              (state.itinerary[day][slot] || []).forEach(act => { if (act) act.syncedAt = stamp; });
            });
          });
          if (tombJobs.length && state.deleted) {
            state.deleted = { pois: [], contacts: [], itinerary: [] };
          }
          if (typeof Store !== "undefined" && Store.saveLocalOnly) Store.saveLocalOnly();
        }

        return trip;
      } catch (err) {
        console.error("Sincronizzazione viaggio fallita:", err);
        forgetSignatures();
      }
      return null;
    },

    /* "Cancella tutto" deve valere anche sul cloud, altrimenti al primo
       accesso successivo il viaggio tornerebbe indietro. */
    async deleteTrip(tripId) {
      const c = this.getClient();
      const u = await resolveUser();
      if (!c || !u || !isUuid(tripId)) return false;
      try {
        await c.from("trip_participants").delete().eq("trip_id", tripId).eq("user_id", u.id);
        // Le tabelle collegate hanno ON DELETE CASCADE: basta il viaggio.
        // Se l'utente non è il proprietario la RLS blocca la cancellazione
        // e resta valida la sola uscita dal viaggio, fatta qui sopra.
        await c.from("trips").delete().eq("id", tripId);
        forgetSignatures();
        return true;
      } catch (err) {
        console.warn("deleteTrip:", err);
        return false;
      }
    },

    /* Compatibilità con le chiamate esistenti: Supa.saveTrip(trip). */
    async saveTrip(trip) {
      const state = (typeof Store !== "undefined" && Store.s) ? Store.s : { trip };
      return this.pushTrip(state);
    },

    resetSyncCache: forgetSignatures
  };
})();

window.Supa = Supa;
