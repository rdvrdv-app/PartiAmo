/* supabase.js — Client Auth, Realtime Sync & Invite Management */

const Supa = (function () {
  let client = null;
  let currentUser = null;
  let currentSession = null;

  const STORAGE_URL_KEY = "partiamo_supa_url";
  const STORAGE_ANON_KEY = "partiamo_supa_key";

  function getSavedCredentials() {
    const url = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_URL_KEY)) || (typeof window !== "undefined" && window.SUPABASE_URL) || "";
    const key = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_ANON_KEY)) || (typeof window !== "undefined" && window.SUPABASE_ANON_KEY) || "";
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
    }
  };
})();

window.Supa = Supa;
