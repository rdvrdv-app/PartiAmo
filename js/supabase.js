/* supabase.js — Client Auth, Realtime Sync & Invite Management */

const Supa = (function () {
  let client = null;
  let currentUser = null;
  let currentSession = null;

  const STORAGE_URL_KEY = "partiamo_supa_url";
  const STORAGE_ANON_KEY = "partiamo_supa_key";

  const DEFAULT_SUPABASE_URL = "https://jobclfopbomkuabnbjgr.supabase.co";
  const DEFAULT_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvYmNsZm9wYm9ta3VhYm5iamdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0NTk1NjAsImV4cCI6MjEwMjAzNTU2MH0.bv83dh3lqczNPqp6MzUEfGb3QiuBzB-F-2odumqaEEM";

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
          auth: { persistSession: true, autoRefreshToken: true }
        });
        return client;
      } catch (err) {
        console.warn("Supabase init failed:", err);
      }
    }
    return null;
  }

  return {
    isConfigured,
    getClient() {
      if (!client) initClient();
      return client;
    },

    saveCredentials(url, key) {
      if (url) localStorage.setItem(STORAGE_URL_KEY, url.trim());
      if (key) localStorage.setItem(STORAGE_ANON_KEY, key.trim());
      return initClient();
    },

    async init() {
      const c = this.getClient();
      if (!c) return null;

      try {
        const { data: { session } } = await c.auth.getSession();
        currentSession = session;
        currentUser = session ? session.user : null;

        c.auth.onAuthStateChange((_event, session) => {
          currentSession = session;
          currentUser = session ? session.user : null;
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

    getUser() { return currentUser; },
    getSession() { return currentSession; },

    async signInMagicLink(email) {
      const c = this.getClient();
      if (!c) throw new Error("Supabase non configurato");
      const { data, error } = await c.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
      return data;
    },

    async verifyOtp(email, token) {
      const c = this.getClient();
      if (!c) throw new Error("Supabase non configurato");
      const { data, error } = await c.auth.verifyOtp({
        email: email.trim(),
        token: token.trim(),
        type: "email"
      });
      if (error) throw error;
      return data;
    },

    async signInGoogle() {
      const c = this.getClient();
      if (!c) throw new Error("Supabase non configurato");
      const { data, error } = await c.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
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
      if (window.UI && typeof window.UI.onAuthChanged === "function") {
        window.UI.onAuthChanged(null);
      }
    },

    async joinTripByCode(code) {
      const c = this.getClient();
      if (!c || !currentUser) throw new Error("Accedi prima per unirti al viaggio");
      
      const cleanCode = code.trim().toLowerCase();
      // 1. Trova il viaggio col codice d'invito
      const { data: trips, error } = await c.from("trips").select("id, dest, country, start_date, end_date").eq("invite_code", cleanCode);
      if (error || !trips || !trips.length) throw new Error("Codice invito non valido o viaggio non trovato");

      const trip = trips[0];
      // 2. Inserisci utente nei partecipanti
      const { error: partErr } = await c.from("trip_participants").upsert({
        trip_id: trip.id,
        user_id: currentUser.id,
        role: "member"
      });

      if (partErr) throw partErr;
      return trip;
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

    async saveTrip(trip) {
      const c = this.getClient();
      if (!c || !trip || !trip.dest) return null;
      let u = currentUser;
      if (!u && c.auth) {
        try { const { data } = await c.auth.getUser(); u = data ? data.user : null; } catch (e) {}
      }
      if (!u) return null;

      try {
        const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trip.id || "");
        if (!isValidUUID) {
          trip.id = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") ?
                    crypto.randomUUID() :
                    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
                      const r = Math.random() * 16 | 0;
                      return (char === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                    });
          if (typeof Store !== "undefined" && Store.save) Store.save();
        }
        if (!trip.inviteCode) {
          const cleanDest = trip.dest.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
          const randNum = Math.floor(1000 + Math.random() * 9000);
          trip.inviteCode = `${cleanDest || "TRIP"}-${randNum}`;
          if (typeof Store !== "undefined" && Store.save) Store.save();
        }

        const { data: tripData, error: tripErr } = await c.from("trips").upsert({
          id: trip.id,
          owner_id: u.id,
          dest: trip.dest,
          country: trip.country || "",
          start_date: trip.start,
          end_date: trip.end,
          transport: trip.transport || "aereo",
          airline: trip.airline || "nessuna",
          fare: trip.fare || "nessuna",
          invite_code: trip.inviteCode
        }).select();

        if (tripErr) console.error("Supabase saveTrip error:", tripErr);

        await c.from("trip_participants").upsert({
          trip_id: trip.id,
          user_id: u.id,
          role: "owner"
        });

        // Sync POIs to Supabase
        if (Store.s.pois && Store.s.pois.length) {
          for (const p of Store.s.pois) {
            const poiUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id || "") ? p.id : null;
            const poiRow = {
              trip_id: trip.id,
              created_by: u.id,
              name: p.name,
              addr: p.addr || "",
              maps_url: p.mapsUrl || "",
              cat: p.cat || "visita",
              day: p.day || null,
              notes: p.notes || ""
            };
            if (poiUuid) poiRow.id = poiUuid;
            await c.from("pois").upsert(poiRow);
          }
        }

        // Sync Contacts to Supabase
        if (Store.s.contacts && Store.s.contacts.length) {
          for (const ct of Store.s.contacts) {
            const ctUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ct.id || "") ? ct.id : null;
            const ctRow = {
              trip_id: trip.id,
              created_by: u.id,
              kind: ct.kind || "struttura",
              name: ct.name,
              phone: ct.phone || "",
              email: ct.email || "",
              addr: ct.addr || "",
              cin: ct.cin || "",
              cout: ct.cout || "",
              ref: ct.ref || "",
              notes: ct.notes || ""
            };
            if (ctUuid) ctRow.id = ctUuid;
            await c.from("contacts").upsert(ctRow);
          }
        }

        return trip;
      } catch (err) {
        console.error("Save trip to Supabase error:", err);
      }
      return null;
    },

    async getUserTrips() {
      const c = this.getClient();
      if (!c) return [];
      let u = currentUser;
      if (!u && c.auth) {
        try { const { data } = await c.auth.getUser(); u = data ? data.user : null; } catch (e) {}
      }
      if (!u) return [];

      try {
        const { data: ownerTrips, error: ownerErr } = await c
          .from("trips")
          .select("*")
          .eq("owner_id", u.id);

        if (!ownerErr && ownerTrips && ownerTrips.length) {
          return ownerTrips;
        }

        const { data: partData, error: partErr } = await c
          .from("trip_participants")
          .select("trip_id, role, trips(*)")
          .eq("user_id", u.id);

        if (!partErr && partData && partData.length) {
          return partData.map(row => row.trips).filter(Boolean);
        }
      } catch (err) {
        console.warn("GetUserTrips error:", err);
      }
      return [];
    },

    async loadTripSubData(tripId) {
      const c = this.getClient();
      if (!c || !tripId) return { pois: [], contacts: [] };

      try {
        const { data: pois } = await c.from("pois").select("*").eq("trip_id", tripId);
        const { data: contacts } = await c.from("contacts").select("*").eq("trip_id", tripId);
        return { pois: pois || [], contacts: contacts || [] };
      } catch (err) {
        console.warn("loadTripSubData error:", err);
        return { pois: [], contacts: [] };
      }
    }
  };
})();

window.Supa = Supa;
