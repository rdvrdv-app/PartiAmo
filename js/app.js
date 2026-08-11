/* app.js — UI wiring and rendering */

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));


const SLOTS = [
  ["mattina", "Mattina"], ["pranzo", "Pranzo"], ["pomeriggio", "Pomeriggio"],
  ["cena", "Cena"], ["serata", "Serata"], ["giornata", "Intera giornata"]
];

const UI = {

  /* ---------------- boot ---------------- */
  init() {
    Store.load();
    this.initTheme();
    this.fillSelects();

    $("#tabs").addEventListener("click", e => {
      const b = e.target.closest("button[data-tab]");
      if (b) this.go(b.dataset.tab);
    });
    $("#btn-theme").addEventListener("click", () => this.toggleTheme());
    $("#btn-refresh-weather").addEventListener("click", () => this.refreshWeather(false));

    this.bindSetup();
    this.bindChecklist();
    this.bindBaggage();
    this.bindVault();
    this.bindContacts();
    this.bindDashboard();

    this.syncLuggages();
    this.loadTripForm();
    this.renderAll();

    this.initAuth();

    if (Store.s.trip.dest && !Store.s.weather) this.refreshWeather(true);
  },

  go(tab) {
    $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".tab").forEach(s => s.classList.toggle("active", s.id === "tab-" + tab));
    window.scrollTo({ top: 0, behavior: "smooth" });
  },

  toast(msg) {
    const t = $("#toast");
    t.innerHTML = msg;
    t.classList.add("show");
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove("show"), 2600);
  },

  /* ---------------- auth & sharing ---------------- */
  async initAuth() {
    this.bindAuth();
    this.checkHashError();
    if (window.Supa) {
      const user = await Supa.init();
      this.onAuthChanged(user);
    }
    this.checkJoinUrl();
  },

  checkHashError() {
    if (!window.location.hash) return;
    const params = new URLSearchParams(window.location.hash.substring(1));
    const errorCode = params.get("error_code");
    const errorDesc = params.get("error_description");
    
    if (errorCode || errorDesc) {
      let msg = "Impossibile accedere";
      if (errorCode === "otp_expired" || (errorDesc && errorDesc.includes("expired"))) {
        msg = "Il link di accesso via email è scaduto o è già stato utilizzato. Richiedine uno nuovo.";
      } else if (errorDesc) {
        msg = errorDesc.replace(/\+/g, " ");
      }
      
      this.toast("⚠️ " + msg);
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      
      setTimeout(() => {
        const modal = $("#modal-auth");
        if (modal && typeof modal.showModal === "function") modal.showModal();
      }, 500);
    }
  },

  bindAuth() {
    const btnAuth = $("#btn-auth");
    if (btnAuth) {
      btnAuth.addEventListener("click", () => {
        const modal = $("#modal-auth");
        if (modal && typeof modal.showModal === "function") modal.showModal();
      });
    }

    const btnShare = $("#btn-share-trip");
    if (btnShare) {
      btnShare.addEventListener("click", () => this.openShareModal());
    }

    const formMagic = $("#form-magic-link");
    if (formMagic) {
      formMagic.addEventListener("submit", async e => {
        e.preventDefault();
        const email = $("#auth-email").value.trim();
        const statusEl = $("#auth-status");
        if (!email) return;
        try {
          statusEl.className = "note info";
          statusEl.textContent = "⏳ Invio link in corso…";
          await Supa.signInMagicLink(email);
          statusEl.className = "note ok";
          statusEl.textContent = "✅ Link di accesso inviato! Controlla la tua email per accedere con 1-click.";
        } catch (err) {
          statusEl.className = "note warn";
          let msg = err.message || "Impossibile inviare l'email";
          if (/rate\s?limit/i.test(msg)) {
            msg = "Hai richiesto troppi link in poco tempo per sicurezza. Attendi 1-2 minuti oppure controlla la tua casella email (le mail già inviate sono valide!).";
          }
          statusEl.textContent = "⚠️ " + msg;
        }
      });
    }

    const btnGoogle = $("#btn-google-login");
    if (btnGoogle) {
      btnGoogle.addEventListener("click", async () => {
        try {
          await Supa.signInGoogle();
        } catch (err) {
          this.toast("Errore Google Login: " + err.message);
        }
      });
    }

    const btnLogout = $("#btn-logout");
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        await Supa.signOut();
        this.toast("Logout effettuato");
        const modal = $("#modal-auth");
        if (modal && typeof modal.close === "function") modal.close();
      });
    }

    const btnSaveSupa = $("#btn-save-supa-config");
    if (btnSaveSupa) {
      btnSaveSupa.addEventListener("click", () => {
        const u = $("#supa-url-input").value.trim();
        const k = $("#supa-key-input").value.trim();
        if (u && k) {
          Supa.saveCredentials(u, k);
          this.toast("Credenziali Supabase salvate!");
          location.reload();
        }
      });
    }

    const btnCopy = $("#btn-copy-invite-link");
    if (btnCopy) {
      btnCopy.addEventListener("click", () => {
        const input = $("#share-link-input");
        if (input && input.value) {
          navigator.clipboard.writeText(input.value);
          this.toast("📋 Link invito copiato negli appunti!");
        }
      });
    }
  },

  async onAuthChanged(user) {
    const btnAuth = $("#btn-auth");
    const unloggedBox = $("#auth-unlogged");
    const loggedBox = $("#auth-logged");

    if (user) {
      if (btnAuth) btnAuth.textContent = "👤 " + (user.email ? user.email.split("@")[0] : "Account");
      if (unloggedBox) unloggedBox.classList.add("hidden");
      if (loggedBox) loggedBox.classList.remove("hidden");
      
      const nameEl = $("#user-display-name");
      const emailEl = $("#user-display-email");
      if (nameEl) nameEl.textContent = (user.user_metadata && user.user_metadata.full_name) || user.email.split("@")[0];
      if (emailEl) emailEl.textContent = user.email;

      if (window.Supa) {
        if (Store.s.trip && Store.s.trip.dest) {
          await Supa.saveTrip(Store.s.trip);
        } else {
          const userTrips = await Supa.getUserTrips();
          if (userTrips && userTrips.length) {
            const cloudTrip = userTrips[0];
            Store.s.trip.id = cloudTrip.id;
            Store.s.trip.dest = cloudTrip.dest;
            Store.s.trip.country = cloudTrip.country || "";
            Store.s.trip.start = cloudTrip.start_date;
            Store.s.trip.end = cloudTrip.end_date;
            Store.s.trip.transport = cloudTrip.transport || "aereo";
            Store.s.trip.airline = cloudTrip.airline || "nessuna";
            Store.s.trip.fare = cloudTrip.fare || "nessuna";
            Store.s.trip.inviteCode = cloudTrip.invite_code;
            Store.save();
            this.loadTripForm();
            await this.refreshWeather(true);
            Checklist.refresh();
            this.renderAll();
            this.toast(`🎉 Viaggio per ${cloudTrip.dest} ripristinato dal cloud!`);
          }
        }
      }
    } else {
      if (btnAuth) btnAuth.textContent = "🔑 Accedi";
      if (unloggedBox) unloggedBox.classList.remove("hidden");
      if (loggedBox) loggedBox.classList.add("hidden");
    }

    const t = Store.s.trip;
    const btnShare = $("#btn-share-trip");
    if (btnShare) btnShare.classList.toggle("hidden", !t.dest);
  },

  async checkJoinUrl() {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (!joinCode) return;

    if (!Supa.getUser()) {
      this.toast(`🔑 Accedi per unirti al viaggio (Codice: ${joinCode.toUpperCase()})`);
      const modal = $("#modal-auth");
      if (modal && typeof modal.showModal === "function") modal.showModal();
      return;
    }

    try {
      this.toast("⏳ Collegamento al viaggio in corso…");
      const trip = await Supa.joinTripByCode(joinCode);
      this.toast(`🎉 Ti sei unito al viaggio per ${trip.dest}!`);
      window.history.replaceState({}, document.title, window.location.pathname);
      this.renderAll();
    } catch (err) {
      this.toast("⚠️ Impossibile unirti: " + err.message);
    }
  },

  async openShareModal() {
    const t = Store.s.trip;
    if (!t.dest) {
      this.toast("Configura prima la destinazione del viaggio");
      return;
    }

    if (!t.inviteCode) {
      const cleanDest = t.dest.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6);
      const randNum = Math.floor(1000 + Math.random() * 9000);
      t.inviteCode = `${cleanDest || "TRIP"}-${randNum}`;
      Store.save();
    }

    const shareUrl = `${window.location.origin}${window.location.pathname}?join=${t.inviteCode}`;
    $("#share-code-txt").textContent = t.inviteCode;
    $("#share-link-input").value = shareUrl;

    const listEl = $("#share-participants-list");
    listEl.innerHTML = `<div class="note">⏳ Caricamento compagni di viaggio…</div>`;

    const modal = $("#modal-share");
    if (modal && typeof modal.showModal === "function") modal.showModal();

    if (Supa.isConfigured() && t.id) {
      const participants = await Supa.getTripParticipants(t.id);
      if (participants.length) {
        listEl.innerHTML = participants.map(p => `
          <div class="row gap-8 align-center" style="display:flex; align-items:center; gap:8px; padding:6px; background:var(--surface-2); border-radius:8px">
            <span style="font-size:18px">👤</span>
            <div style="flex:1">
              <strong style="font-size:13px">${esc(p.profiles?.full_name || p.profiles?.email || "Viaggiatore")}</strong>
              <span class="note" style="display:block; font-size:11px">${p.role === "owner" ? "👑 Creatore" : "✈️ Partecipante"}</span>
            </div>
          </div>
        `).join("");
      } else {
        listEl.innerHTML = `<div class="note">Nessun altro compagno si è ancora unito. Invia il link per invitare i tuoi amici!</div>`;
      }
    } else {
      listEl.innerHTML = `<div class="note">Invia il link ai tuoi compagni di viaggio per condividere POI, Itinerario e Contatti.</div>`;
    }
  },

  /* ---------------- theme ---------------- */
  initTheme() {
    const saved = Store.s.theme;
    const sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    this.setTheme(saved || (sysDark ? "dark" : "light"), false);
  },
  setTheme(mode, persist) {
    document.documentElement.dataset.theme = mode;
    $("#btn-theme").textContent = mode === "dark" ? "☀️" : "🌙";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = mode === "dark" ? "#0b1020" : "#f4f6fb";
    if (persist !== false) { Store.s.theme = mode; Store.save(); }
  },
  toggleTheme() {
    this.setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark", true);
  },

  renderAll() {
    this.renderDashboard();
    this.renderChecklist();
    this.renderBaggage();
    this.renderVault();
    this.renderContacts();
    this.renderItinerary();
    const t = Store.s.trip;
    $("#top-dest").textContent = t.dest ? `${t.dest} · ${itDate(t.start)}` : "";
  },

  /* ---------------- setup ---------------- */
  fillSelects() {
    const al = $("#tp-airline");
    al.innerHTML = Object.entries(DATA.airlines).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
    al.addEventListener("change", () => this.fillFares());
    // Nessun volo → nessuna compagnia da indicare. Auto → rimuove colli predefiniti.
    $("#tp-transport").addEventListener("change", e => {
      const val = e.target.value;
      if (val !== "aereo") { al.value = "nessuna"; this.fillFares(); }
      else if (al.value === "nessuna") { al.selectedIndex = 1; this.fillFares(); }

      if (val === "auto") {
        Store.s.bags = [];
        Store.s.trip.luggages = [];
        Store.save();
        this.renderTripLuggages();
        this.renderBaggage();
        this.renderChecklist();
        this.toast("Mezzo Auto selezionato: colli di default rimossi");
      }
    });
    $("#countries").innerHTML = Object.keys(DATA.countries)
      .map(c => `<option value="${esc(c.replace(/\b\w/g, m => m.toUpperCase()))}">`).join("");
  },
  fillFares(selected) {
    const a = DATA.airlines[$("#tp-airline").value] || DATA.airlines.altra;
    $("#tp-fare").innerHTML = Object.entries(a.fares).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
    if (selected && a.fares[selected]) $("#tp-fare").value = selected;
  },
  loadTripForm() {
    const t = Store.s.trip;
    $("#tp-dest").value = t.dest; $("#tp-country").value = t.country;
    $("#tp-start").value = t.start; $("#tp-end").value = t.end;
    $("#tp-type").value = t.type; $("#tp-transport").value = t.transport;
    $("#tp-airline").value = t.airline; this.fillFares(t.fare);
    if ($("#tp-travelers")) $("#tp-travelers").value = t.travelers || 1;
    $("#tp-laundry").value = t.laundry;
    this.renderTripLuggages();
  },
  /* Il set di colli (scheda Bagagli) è l'unica fonte: trip.luggages ne è la proiezione. */
  syncLuggages() {
    const s = Store.s;
    if (!s.bags || !s.bags.length) return;           // niente set: resta la dichiarazione legacy
    s.trip.luggages = s.bags.map(b => ({ id: b.id, type: Baggage.bagType(b) }));
    Store.save();
  },
  renderTripLuggages() {
    const s = Store.s;
    const LBL = {
      zaino: "🎒 Zaino / Borsa piccola",
      trolley: "🧳 Trolley cabina",
      stiva: "📦 Bagaglio da stiva"
    };
    const box = $("#tp-luggage-list");
    const items = (s.bags && s.bags.length) ? s.bags : (s.trip.luggages || []);

    let listHtml = "";
    if (items.length) {
      listHtml = `<div class="items">${items.map((b, idx) => {
        const type = (typeof b === "string") ? b : (b.type || (typeof Baggage !== "undefined" && Baggage.bagType ? Baggage.bagType(b) : "stiva"));
        const id = String(b.id || idx);
        const labelText = LBL[type] || (typeof type === "string" && type ? esc(type) : "📦 Collo speciale");
        const name = (typeof b.name === "string" && b.name) ? b.name : (LBL[type] || "Collo");
        const dims = b.l ? ` · ${b.l}×${b.w}×${b.h} cm${b.kg ? " · " + b.kg + " kg" : ""}` : "";
        return `<div class="item">
          <span class="nm">${labelText} <small>${esc(name)}${dims}</small></span>
          <button type="button" class="x btn-del-tp-bag" data-bag-id="${id}" title="Rimuovi questo bagaglio">✕</button>
        </div>`;
      }).join("")}</div>`;
    } else {
      listHtml = `<p class="note">Nessun bagaglio inserito. Aggiungi i colli che porterai in viaggio.</p>`;
    }

    const controlsHtml = `
      <div class="row wrap" style="gap:6px; margin-top:8px">
        <select id="tp-add-type" aria-label="Seleziona tipo di bagaglio" style="flex:1 1 180px; font-size:13px">
          <option value="zaino">🎒 Zaino / Borsa piccola (sotto il sedile)</option>
          <option value="trolley" selected>🧳 Trolley cabina</option>
          <option value="stiva">📦 Bagaglio da stiva</option>
        </select>
        <button type="button" class="primary small" id="btn-add-tp-bag">+ Aggiungi bagaglio</button>
      </div>`;

    box.innerHTML = listHtml + controlsHtml;
  },
  bindSetup() {
    $("#btn-go-bagagli").addEventListener("click", () => $("#form-bag").scrollIntoView({ behavior: "smooth", block: "center" }));

    // Il riepilogo in Viaggio agisce sugli stessi colli del set in Bagagli.
    $("#tp-luggage-list").addEventListener("click", e => {
      const delBtn = e.target.closest(".btn-del-tp-bag");
      if (delBtn) {
        const id = delBtn.dataset.bagId;
        Store.s.bags = (Store.s.bags || []).filter(b => String(b.id) !== id);
        Store.s.trip.luggages = (Store.s.trip.luggages || []).filter((b, idx) => String(b.id || idx) !== id);
        this.afterBagsChange();
        this.toast("Bagaglio rimosso");
        return;
      }

      const addBtn = e.target.closest("#btn-add-tp-bag");
      if (addBtn) {
        const type = $("#tp-add-type").value || "trolley";
        const defaultDims = {
          zaino: { name: "Zaino sotto sedile", l: 40, w: 30, h: 20, kg: 5 },
          trolley: { name: "Trolley cabina", l: 55, w: 40, h: 20, kg: 10 },
          stiva: { name: "Bagaglio stiva", l: 75, w: 50, h: 30, kg: 23 }
        };
        const def = defaultDims[type] || defaultDims.trolley;
        const b = {
          id: Store.uid(),
          name: def.name,
          l: def.l, w: def.w, h: def.h, kg: def.kg,
          type: type
        };
        Store.s.bags = Store.s.bags || [];
        Store.s.bags.push(b);
        Store.s.trip.luggages = Store.s.trip.luggages || [];
        Store.s.trip.luggages.push({ id: b.id, type: type });
        this.afterBagsChange();
        this.toast("Bagaglio aggiunto");
        return;
      }
    });

    $("#form-trip").addEventListener("submit", async e => {
      e.preventDefault();
      const t = Store.s.trip;
      const primaConfigurazione = !t.dest;   // solo al primo salvataggio si passa alla dashboard
      t.dest = $("#tp-dest").value.trim();
      t.country = $("#tp-country").value.trim();
      t.start = $("#tp-start").value; t.end = $("#tp-end").value;
      t.type = $("#tp-type").value; t.transport = $("#tp-transport").value;
      t.airline = $("#tp-airline").value; t.fare = $("#tp-fare").value;
      t.travelers = 1;
      t.laundry = $("#tp-laundry").value;
      if (t.transport === "auto" && (!Store.s.bags || !Store.s.bags.length)) { t.luggages = []; }
      if (t.end < t.start) { this.toast("La data di rientro precede la partenza"); return; }
      Store.save();
      if (window.Supa && Supa.getUser()) {
        await Supa.saveTrip(t);
      }
      await this.refreshWeather(true);
      Checklist.refresh();
      this.renderAll();
      if (primaConfigurazione) this.go("dashboard");
      this.toast(primaConfigurazione ? "Viaggio salvato: checklist generata" : "Modifiche salvate");
    });

    $("#btn-wipe").addEventListener("click", () => {
      if (confirm("Cancellare viaggio, checklist, documenti e allegati?")) {
        Store.reset(); this.loadTripForm(); this.renderAll(); this.toast("Dati cancellati");
      }
    });
  },

  /* ---------------- weather ---------------- */
  async refreshWeather(silent) {
    const t = Store.s.trip;
    if (!t.dest || !t.start || !t.end) return;
    $("#d-weather-sub").textContent = "Recupero previsioni…";
    try {
      Store.s.weather = await Weather.fetchTrip(t);
      Store.save();
      this.renderDashboard(); this.renderChecklist();
      if (!silent) this.toast("Meteo aggiornato");
    } catch (e) {
      $("#d-weather-sub").textContent = "Meteo non disponibile: " + e.message;
      if (!silent) this.toast("Meteo non disponibile");
    }
  },

  /* ---------------- dashboard ---------------- */
  dayWeatherAdvice(wDay) {
    if (!wDay) return "";
    const code = wDay.code;
    const rain = wDay.rainP != null ? wDay.rainP : (wDay.rainMm ? 50 : 0);
    const wind = wDay.wind || 0;
    const tmax = wDay.tmax || 20;

    if ([95, 96, 99].includes(code)) return "Temporali previsti: consigliate attività al coperto e guscio impermeabile.";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "Neve prevista: scarpe antiscivolo ed abbigliamento caldo termico.";
    if (rain >= 40 || [61, 63, 65, 80, 81, 82].includes(code)) return "Pioggia probabile: porta l'ombrello o un K-Way da passeggiata.";
    if (wind >= 35) return "Vento sostenuto: giacca antivento consigliata.";
    if (tmax >= 30) return "Giornata calda: abiti leggeri traspiranti e protezione solare.";
    if (tmax <= 12) return "Giornata fredda: giacca calda, cappello e sciarpa.";
    if ([0, 1].includes(code)) return "Meteo favorevole e soleggiato per camminare ed esplorare.";
    return "Meteo variabile: vestizione a strati consigliata.";
  },

  bindDashboard() {
    $("#d-forecast").addEventListener("click", e => {
      const card = e.target.closest(".fc-day[data-day]");
      if (!card) return;
      const day = card.dataset.day;
      if (day) {
        this.go("itinerario");
        this.renderItinerary();
        setTimeout(() => {
          const dayEl = document.querySelector(`details[data-day="${day}"]`) || document.querySelector(`#day-${day}`);
          if (dayEl) {
            dayEl.open = true;
            dayEl.setAttribute("open", "true");
            void dayEl.offsetHeight;
            dayEl.scrollIntoView({ behavior: "smooth", block: "center" });
            dayEl.style.outline = "3px solid var(--accent)";
            setTimeout(() => dayEl.style.outline = "", 2500);
          }
        }, 100);
      }
    });

    $("#d-next").addEventListener("click", e => {
      const item = e.target.closest(".next-item");
      if (!item) return;
      const tab = item.dataset.tab;
      const targetId = item.dataset.targetId;
      const day = item.dataset.day;

      const targetTab = day ? "itinerario" : (tab || "itinerario");
      this.go(targetTab);
      if (targetTab === "itinerario") this.renderItinerary();

      setTimeout(() => {
        if (day) {
          let iso = day.trim();
          if (iso.includes("/")) {
            const p = iso.split("/");
            if (p.length === 3) iso = `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
          } else if (iso.includes("-")) {
            const p = iso.split("-");
            if (p.length === 3) iso = `${p[0]}-${p[1].padStart(2, "0")}-${p[2].padStart(2, "0")}`;
          }

          const dayEl = document.querySelector(`details[data-day="${iso}"]`) ||
                        document.querySelector(`details[id="day-${iso}"]`) ||
                        document.querySelector(`[data-day="${iso}"]`) ||
                        document.querySelector(`#day-${iso}`);

          if (dayEl) {
            dayEl.open = true;
            dayEl.setAttribute("open", "true");
            void dayEl.offsetHeight; // force browser layout reflow

            dayEl.scrollIntoView({ behavior: "smooth", block: "center" });
            dayEl.style.outline = "3px solid var(--accent)";
            setTimeout(() => dayEl.style.outline = "", 2500);
          }
        } else if (targetId) {
          const cardEl = document.querySelector(`[data-doc-id="${targetId}"]`) ||
                         document.querySelector(`[data-contact-id="${targetId}"]`) ||
                         document.querySelector(`[data-poi-id="${targetId}"]`) ||
                         document.querySelector(`[data-id="${targetId}"]`);
          if (cardEl) {
            const card = cardEl.closest(".doc, .contact, .poi, .card, .item") || cardEl;
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.style.outline = "3px solid var(--accent)";
            setTimeout(() => card.style.outline = "", 2500);
          }
        }
      }, 100);
    });
  },

  renderDashboard() {
    const s = Store.s, t = s.trip, w = s.weather;
    const ready = !!(t.dest && t.start && t.end);
    $("#dash-empty").classList.toggle("hidden", ready);
    $("#dash-content").classList.toggle("hidden", !ready);
    if (!ready) return;

    const n = Checklist.days(t);
    $("#d-dest").textContent = t.dest;
    $("#d-dates").textContent = `${itDate(t.start)} → ${itDate(t.end)} · ${n} giorn${n === 1 ? "o" : "i"}`;
    const luggages = t.luggages || [{ type: t.luggage || "trolley" }];
    const counts = { zaino: 0, trolley: 0, stiva: 0 };
    luggages.forEach(b => { const type = b.type || b; counts[type] = (counts[type] || 0) + 1; });
    const luggageStr = Object.entries(counts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(" + ") || "1 zaino";
    const chips = [t.type, t.transport, luggageStr];
    if (t.transport === "aereo" && t.airline !== "nessuna") chips.push(DATA.airlines[t.airline].label);
    $("#d-chips").innerHTML = chips.map(c => `<span class="chip">${esc(c)}</span>`).join("");

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(t.start + "T00:00:00"), end = new Date(t.end + "T00:00:00");
    const dd = Math.round((start - today) / 86400000);
    $("#d-count").textContent = dd > 0 ? `-${dd}` : (today > end ? "✓" : "In corso");
    $("#d-count-sub").textContent = dd > 1 ? `giorni alla partenza` : dd === 1 ? "si parte domani!" :
      dd === 0 ? "si parte oggi 🎉" : today > end ? "viaggio concluso" : `giorno ${Math.round((today - start) / 86400000) + 1} di ${n}`;

    if (w) {
      $("#d-temp").textContent = `${w.tminAvg}° / ${w.tmaxAvg}°`;
      $("#d-weather-sub").innerHTML = `${esc(w.place)}<br>min ${w.tmin}° · max ${w.tmax}°${w.rainDays ? ` · ${w.rainDays} gg pioggia` : ""}`;
      $("#d-weather-source").textContent = `Fonte: Open-Meteo (${w.source}) — aggiornato il ${new Date(w.fetchedAt).toLocaleString("it-IT")}`;
      $("#d-forecast").innerHTML = w.days.map(d => {
        const [ic, lb] = DATA.wmoInfo(d.code);
        const dt = new Date(d.date + "T00:00:00");
        const rain = d.rainP != null ? d.rainP + "%" : (d.rainMm ? d.rainMm + " mm" : "");
        return `<div class="fc-day clickable-fc-day" data-day="${d.date}" title="${esc(lb)}${d.historical ? " (dato storico)" : ""} · Clicca per i dettagli giorno" style="cursor:pointer">
          <div class="d">${dt.toLocaleDateString("it-IT", { weekday: "short" })} ${dt.getDate()}</div>
          <div class="ic">${ic}</div>
          <div class="t">${Math.round(d.tmax)}°<small>/${Math.round(d.tmin)}°</small></div>
          <div class="r">${rain}${d.historical ? " ~" : ""}</div>
        </div>`;
      }).join("");
    } else {
      $("#d-temp").textContent = "—";
      $("#d-forecast").textContent = "Nessun dato meteo.";
    }

    const done = s.checklist.filter(i => i.done).length;
    const pct = s.checklist.length ? Math.round(done * 100 / s.checklist.length) : 0;
    $("#d-progress").textContent = pct + "%";
    $("#d-bar").style.width = pct + "%";
    $("#d-progress-sub").textContent = `${done} di ${s.checklist.length} voci spuntate`;

    /* alerts */
    const alerts = OCR.expiryAlerts(s.docs, t.end);
    if (dd >= 0 && dd <= 2 && pct < 80) alerts.push({ level: "warn", msg: `⏳ Partenza tra ${dd} giorn${dd === 1 ? "o" : "i"} e checklist al ${pct}%: mancano ${s.checklist.length - done} voci.` });
    if (!s.docs.length) alerts.push({ level: "info", msg: `🔐 Nessun documento nel Vault. Caricali per avere PNR, gate e scadenze sempre a portata di mano.` });
    if (w && w.storm) alerts.push({ level: "warn", msg: "⛈️ Temporali previsti: metti in valigia un guscio impermeabile e prevedi alternative al coperto." });
    if (w && w.snow) alerts.push({ level: "warn", msg: "❄️ Neve prevista: calzature antiscivolo e strato termico obbligatori." });
    if (w && (w.tmax - w.tmin) >= 12) alerts.push({ level: "info", msg: `🌡️ Escursione termica di ${w.tmax - w.tmin}°C tra minima e massima: vestizione a cipolla.` });
    $("#d-alerts").innerHTML = alerts.map(a => `<div class="alert ${a.level}">${a.msg}</div>`).join("");

    /* next commitments */
    const items = [];

    // 1. Documents from Vault
    s.docs.forEach(d => {
      const f = d.fields || {};
      if (f.flight) {
        items.push({
          date: f.dateMain || t.start,
          rawName: f.flight,
          html: `✈️ Volo <b>${esc(f.flight)}</b>${f.from ? ` ${esc(f.from)}→${esc(f.to || "")}` : ""}${f.dateMain ? " il " + itDate(f.dateMain) : ""}${f.timeDep ? " alle " + esc(f.timeDep) : ""}${f.gate ? " · gate " + esc(f.gate) : ""}${f.seat ? " · posto " + esc(f.seat) : ""}`,
          tab: "vault",
          targetId: d.id
        });
      }
      if (f.checkin) {
        items.push({
          date: f.checkin || t.start,
          rawName: f.property || d.title || "struttura",
          html: `🏨 Check-in ${esc(f.property || d.title || "struttura")} il ${itDate(f.checkin)}`,
          tab: "vault",
          targetId: d.id
        });
      }
    });

    // 2. Contacts with checkin/dates
    (s.contacts || []).forEach(c => {
      if (c.cin) {
        items.push({
          date: c.cin || t.start,
          rawName: c.name,
          html: `🏨 ${esc(c.name)} · Check-in ${esc(c.cin)}`,
          tab: "contatti",
          targetId: c.id
        });
      }
    });

    // 3. POIs scheduled for trip days
    (s.pois || []).forEach(p => {
      if (p.day && p.day >= t.start) {
        const catIcon = { visita: "🏛️", cibo: "🍽️", trasporto: "🚌", shopping: "🛍️", altro: "📍" }[p.cat] || "📍";
        items.push({
          date: p.day,
          rawName: p.name,
          html: `${catIcon} ${itDate(p.day)} · ${esc(p.name)}${p.addr ? " (" + esc(p.addr) + ")" : ""}`,
          tab: "itinerario",
          day: p.day,
          targetId: p.id
        });
      }
    });

    // 4. Itinerary day activities
    Object.keys(s.itinerary).sort().forEach(day => {
      if (day < t.start) return;
      SLOTS.forEach(([k, lbl]) => {
        (s.itinerary[day][k] || []).slice(0, 3).forEach(a => {
          items.push({
            date: day,
            time: a.time || "",
            rawName: a.text,
            html: `🗓️ ${itDate(day)}${a.time ? ` <b>${esc(a.time)}</b>` : ""} · ${lbl}: ${esc(a.text)}`,
            tab: "itinerario",
            day: day
          });
        });
      });
    });

    // Sort commitments chronologically by date and time
    items.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

    // Deduplicate items on the same date with matching names/keywords
    const uniqueItems = [];
    const seenKeys = new Set();

    items.forEach(item => {
      const cleanName = (item.rawName || "")
        .toLowerCase()
        .replace(/[^\w\sà-ù]/gi, "")
        .trim();

      if (!cleanName) {
        uniqueItems.push(item);
        return;
      }

      let isDuplicate = false;
      for (const existingKey of seenKeys) {
        const [exDate, exName] = existingKey.split(":::");
        if (exDate === item.date && exName && cleanName) {
          if (exName === cleanName || exName.includes(cleanName) || cleanName.includes(exName)) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (!isDuplicate) {
        seenKeys.add(`${item.date}:::${cleanName}`);
        uniqueItems.push(item);
      }
    });

    if (uniqueItems.length) {
      $("#d-next").innerHTML = `<ul class="next-commitments-list">${uniqueItems.slice(0, 8).map(i => `
        <li class="next-item" data-tab="${i.tab}" ${i.targetId ? `data-target-id="${i.targetId}"` : ""} ${i.day ? `data-day="${i.day}"` : ""}>
          <span>${i.html}</span> <span class="arr">→</span>
        </li>`).join("")}</ul>`;
    } else {
      $("#d-next").innerHTML = `<p class="note">Nessun impegno registrato. Aggiungi documenti, contatti o attività nell'itinerario.</p>`;
    }

    this.renderEmergency($("#d-emergency"));
  },

  renderEmergency(box) {
    const t = Store.s.trip;
    const ci = DATA.countryInfo(t.country) || (Store.s.weather && DATA.countryInfo(Store.s.weather.country)) || DATA.defaultCountry;
    const rawCountry = t.country || (Store.s.weather && Store.s.weather.country) || "";
    
    let embassyQuery = "Ambasciata d'Italia";
    const cleanCountry = (rawCountry && !/ital/i.test(rawCountry)) ? rawCountry.trim() : "";
    const cleanDest = (t.dest && !/ital/i.test(t.dest)) ? t.dest.trim() : "";
    
    if (cleanDest && cleanCountry) {
      embassyQuery = `Ambasciata d'Italia ${cleanDest} ${cleanCountry}`;
    } else if (cleanDest) {
      embassyQuery = `Ambasciata d'Italia ${cleanDest}`;
    } else if (cleanCountry) {
      embassyQuery = `Ambasciata d'Italia ${cleanCountry}`;
    }

    box.innerHTML = `<div class="kv">
        <dt>Emergenze</dt><dd>${esc(ci.emg)}</dd>
        <dt>Prese elettriche</dt><dd>Tipo ${esc(ci.plugs)} · ${esc(ci.volt)}</dd>
        <dt>Area</dt><dd>${ci.eu ? "UE — TEAM valida" : "Extra UE — assicurazione consigliata"}</dd>
      </div>
      <div class="actions">
        <a href="${mapsUrl(embassyQuery)}" target="_blank" rel="noopener">🏛️ Ambasciata italiana</a>
        <a href="${mapsUrl("ospedale " + (t.dest || rawCountry))}" target="_blank" rel="noopener">🏥 Ospedale più vicino</a>
        <a href="${mapsUrl("farmacia " + (t.dest || rawCountry))}" target="_blank" rel="noopener">💊 Farmacia</a>
        <a href="${mapsUrl("polizia " + (t.dest || rawCountry))}" target="_blank" rel="noopener">🚓 Polizia</a>
      </div>`;
  },

  /* ---------------- checklist ---------------- */
  bindChecklist() {
    $("#btn-regen").addEventListener("click", () => {
      Checklist.refresh(); this.renderChecklist(); this.renderDashboard(); this.toast("Checklist rigenerata");
    });
    $("#btn-reset-checks").addEventListener("click", () => {
      Store.s.checklist.forEach(i => i.done = false); Store.save(); this.renderChecklist(); this.renderDashboard();
    });
    $("#form-item").addEventListener("submit", e => {
      e.preventDefault();
      Store.s.checklist.push({
        id: Store.uid(), cat: $("#it-cat").value, name: $("#it-name").value.trim(),
        qty: +$("#it-qty").value || 1, note: "", gen: false, done: false
      });
      Store.save(); $("#it-name").value = ""; $("#it-qty").value = 1;
      this.renderChecklist(); this.renderDashboard();
    });
    $("#checklist-groups").addEventListener("click", e => {
      const row = e.target.closest(".item"); if (!row) return;
      const item = Store.s.checklist.find(i => i.id === row.dataset.id); if (!item) return;
      if (e.target.matches("input[type=checkbox]")) {
        item.done = e.target.checked;
      } else if (e.target.matches(".x")) {
        Store.s.checklist = Store.s.checklist.filter(i => i.id !== item.id);
        if (item.gen) { Store.s.removed = Store.s.removed || []; Store.s.removed.push(item.id); }
      } else if (e.target.matches(".qty")) {
        const v = prompt(`Quantità per "${item.name}"`, item.qty);
        if (v === null) return;
        item.qty = Math.max(1, parseInt(v, 10) || 1); item.qtyEdited = true;
      } else if (e.target.matches(".nm, .nm *")) {
        const v = prompt("Modifica voce", item.name);
        if (v === null || !v.trim()) return;
        item.name = v.trim();
      } else return;
      Store.save(); this.renderChecklist(); this.renderDashboard();
    });
  },

  renderChecklist() {
    const s = Store.s;
    if (!s.checklist.length && s.trip.dest) Checklist.refresh();
    $("#cl-logic").textContent = s.trip.dest ? Checklist.summary(s.trip, s.weather) : "Configura il viaggio per generare la checklist.";
    const done = s.checklist.filter(i => i.done).length;
    $("#cl-bar").style.width = (s.checklist.length ? done * 100 / s.checklist.length : 0) + "%";

    $("#checklist-groups").innerHTML = Object.entries(Checklist.CATS).map(([key, c]) => {
      const items = s.checklist.filter(i => i.cat === key);
      if (!items.length) return "";
      const d = items.filter(i => i.done).length;
      return `<div class="group">
        <div class="group-head"><h4>${c.icon} ${c.label}</h4><span class="group-count">${d}/${items.length}</span></div>
        <div class="items">${items.map(i => `
          <div class="item ${i.done ? "done" : ""}" data-id="${i.id}">
            <input type="checkbox" ${i.done ? "checked" : ""} aria-label="${esc(i.name)}">
            <span class="nm">${esc(i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ""}</span>
            ${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : `<span class="qty" style="background:transparent;color:var(--muted)">×1</span>`}
            <button class="x" title="Elimina">✕</button>
          </div>`).join("")}</div>
      </div>`;
    }).join("") || `<p class="note">Nessuna voce: configura il viaggio o aggiungine una manualmente.</p>`;
  },

  /* ---------------- baggage ---------------- */
  bindBaggage() {
    $("#form-bag").addEventListener("submit", e => {
      e.preventDefault();
      $("#bag-check").innerHTML = Baggage.check(Store.s.trip, +$("#bg-l").value, +$("#bg-w").value, +$("#bg-h").value, +$("#bg-kg").value);
    });

    $("#btn-bag-add").addEventListener("click", () => {
      const editId = $("#form-bag").dataset.editId;
      const b = {
        id: editId || Store.uid(),
        name: $("#bg-name").value.trim() || `Collo ${(Store.s.bags || []).length + 1}`,
        l: +$("#bg-l").value, w: +$("#bg-w").value, h: +$("#bg-h").value, kg: +$("#bg-kg").value || 0,
        type: $("#bg-type").value || ""
      };
      if (!b.l || !b.w || !b.h) { this.toast("Inserisci tutte e tre le dimensioni"); return; }
      Store.s.bags = Store.s.bags || [];
      if (editId) {
        const i = Store.s.bags.findIndex(x => x.id === editId);
        if (i >= 0) Store.s.bags[i] = b;
        this.exitBagEdit();
        this.toast("Collo aggiornato");
      } else {
        Store.s.bags.push(b);
        this.toast("Collo aggiunto al set");
      }
      this.afterBagsChange();
      $("#form-bag").reset(); $("#bag-check").innerHTML = "";
    });

    $("#btn-bag-clear").addEventListener("click", () => {
      Store.s.bags = []; this.exitBagEdit(); this.afterBagsChange();
    });

    $("#bag-set").addEventListener("click", e => {
      const row = e.target.closest(".item[data-bag]");
      if (!row) return;
      if (e.target.closest("[data-edit-bag]")) { this.editBag(row.dataset.bag); return; }
      if (!e.target.matches(".x")) return;
      Store.s.bags = (Store.s.bags || []).filter(b => b.id !== row.dataset.bag);
      if ($("#form-bag").dataset.editId === row.dataset.bag) this.exitBagEdit();
      this.afterBagsChange();
    });
  },

  /* Carica un collo nel form di aggiunta, che diventa form di modifica. */
  editBag(id) {
    const b = (Store.s.bags || []).find(x => x.id === id);
    if (!b) return;
    $("#form-bag").dataset.editId = id;
    $("#bg-name").value = b.name || "";
    $("#bg-type").value = b.type || "";
    $("#bg-l").value = b.l; $("#bg-w").value = b.w; $("#bg-h").value = b.h;
    $("#bg-kg").value = b.kg || "";
    $("#btn-bag-add").textContent = "💾 Salva modifiche";
    $("#bag-form-title").textContent = `Modifica "${b.name}"`;
    $("#form-bag").scrollIntoView({ behavior: "smooth", block: "center" });
  },
  exitBagEdit() {
    delete $("#form-bag").dataset.editId;
    $("#btn-bag-add").textContent = "+ Aggiungi al set";
    $("#bag-form-title").textContent = "Aggiungi un collo";
  },
  /* Il set guida checklist, liquidi e chip: dopo ogni modifica riallinea tutto. */
  afterBagsChange() {
    Store.save();
    this.syncLuggages();
    Checklist.refresh();
    this.renderBaggage();
    this.renderTripLuggages();
    this.renderChecklist();
    this.renderDashboard();
  },
  renderBaggage() {
    if (!Store.s.trip.dest) return;
    $("#bag-rules").innerHTML = Baggage.card(Store.s.trip);
    $("#bag-liquids").innerHTML = Baggage.liquids(Store.s.trip);
    $("#bag-set").innerHTML = Baggage.setCard(Store.s.trip, Store.s.bags || []);
  },

  /* ---------------- vault ---------------- */
  updateDocTypeLabels() {
    const type = $("#dc-type").value || "passaporto";
    const cfg = DOC_TYPES[type] || DOC_TYPES.altro;

    $("#dc-title").placeholder = cfg.titlePlaceholder;
    if ($("#dc-expiry-txt")) $("#dc-expiry-txt").textContent = cfg.expiryLabel;
    if ($("#dc-file-hint")) $("#dc-file-hint").textContent = cfg.fileHint;
    $("#dc-notes").placeholder = cfg.notesPlaceholder;
  },

  bindVault() {
    this.updateDocTypeLabels();
    $("#dc-type").addEventListener("change", () => this.updateDocTypeLabels());

    $("#dc-file").addEventListener("change", e => {
      const files = Array.from(e.target.files);
      $("#dc-files").textContent = files.length
        ? `📎 ${files.length} file: ${files.map(f => f.name).join(", ").slice(0, 90)}`
        : "";
      if (!$("#dc-title").value.trim() && files.length === 1) {
        $("#dc-title").value = files[0].name.replace(/\.[^.]+$/, "").slice(0, 60);
      }
    });

    $("#form-doc").addEventListener("submit", async e => {
      e.preventDefault();
      const files = Array.from($("#dc-file").files);
      if (!files.length) { this.toast("Seleziona almeno una foto o un PDF"); return; }
      const expiry = $("#dc-expiry").value;
      const doc = {
        id: Store.uid(), type: $("#dc-type").value,
        title: $("#dc-title").value.trim() || $("#dc-type option:checked").textContent,
        fields: expiry ? { expiry } : {},
        notes: $("#dc-notes").value.trim(),
        addedAt: isoLocal(new Date()),
        files: await Media.saveAll(files)
      };
      Store.s.docs.push(doc); Store.save();
      $("#form-doc").reset(); $("#dc-files").textContent = "";
      this.updateDocTypeLabels();
      this.renderVault(); this.renderDashboard();
      this.toast("Documento archiviato nel Vault");
    });

    $("#vault-list").addEventListener("click", async e => {
      const b = e.target.closest("[data-del-doc]"); if (!b) return;
      const id = b.dataset.delDoc;
      if (!confirm("Eliminare la scheda documento e tutti i suoi allegati?")) return;
      const doc = Store.s.docs.find(d => d.id === id);
      if (doc) for (const f of doc.files || []) await Media.del(f.id);
      Store.s.docs = Store.s.docs.filter(d => d.id !== id);
      Store.save(); this.renderVault(); this.renderDashboard();
    });

    $("#vault-list").addEventListener("change", async e => {
      const fileInput = e.target.closest("[data-add-doc-files]");
      if (!fileInput) return;
      const docId = fileInput.dataset.addDocFiles;
      const files = Array.from(fileInput.files);
      if (!files.length) return;
      const doc = Store.s.docs.find(d => d.id === docId);
      if (doc) {
        const newFiles = await Media.saveAll(files);
        doc.files = (doc.files || []).concat(newFiles);
        Store.save();
        this.renderVault();
        this.toast(`${newFiles.length} ${newFiles.length === 1 ? "allegato aggiunto" : "allegati aggiunti"} al documento`);
      }
    });
  },

  async renderVault() {
    const s = Store.s;
    const alerts = OCR.expiryAlerts(s.docs, s.trip.end);
    const box = $("#vault-list");
    box.innerHTML = (alerts.length ? alerts.map(a => `<div class="alert ${a.level}">${a.msg}</div>`).join("") : "")
      + (s.docs.length ? `<div class="cards-grid">${s.docs.map(d => {
        const n = (d.files || []).length;
        const badgeTxt = (typeof DOC_TYPES !== "undefined" && DOC_TYPES[d.type] && DOC_TYPES[d.type].badge) || d.type.replace("_", " ");
        return `<div class="doc">
          <h4>📄 ${esc(d.title)} <span class="badge">${esc(badgeTxt)}</span></h4>
          <div class="kv">
            <dt>File</dt><dd>${n} ${n === 1 ? "allegato" : "allegati"}</dd>
            ${d.fields && d.fields.expiry ? `<dt>Data / Scadenza</dt><dd>${itDate(d.fields.expiry)}</dd>` : ""}
            ${d.addedAt ? `<dt>Archiviato</dt><dd>${itDate(d.addedAt)}</dd>` : ""}
            ${d.notes ? `<dt>Note</dt><dd>${esc(d.notes)}</dd>` : ""}
          </div>
          <div class="thumbs" data-files='${esc(JSON.stringify(d.files || []))}' data-doc-id="${d.id}"></div>
          <div class="actions">
            <label title="Aggiungi altri file o foto a questa scheda documento">
              ➕ Aggiungi file
              <input type="file" data-add-doc-files="${d.id}" accept="image/*,application/pdf" multiple style="display:none">
            </label>
            <button data-del-doc="${d.id}">🗑 Elimina</button>
          </div>
        </div>`;
      }).join("")}</div>` : `<p class="note">Vault vuoto: archivia qui foto e PDF di documenti, biglietti e prenotazioni.</p>`);
    this.hydrateThumbs(box);
  },

  /* Attachments live in IndexedDB: resolve object URLs after the HTML is in place. */
  async hydrateThumbs(root) {
    for (const el of $$(".thumbs[data-files]", root)) {
      let files = [];
      try { files = JSON.parse(el.dataset.files); } catch (e) { }
      const docId = el.dataset.docId;
      const contactId = el.dataset.contactId;
      const poiId = el.dataset.poiId;
      el.removeAttribute("data-files");
      for (const f of files) {
        const url = await Media.url(f.id);
        if (!url) continue;
        // Allegati salvati prima della copia dei byte possono puntare a un file sparito:
        // meglio un segnaposto leggibile di un'immagine rotta.
        const broken = `this.parentNode.innerHTML='<span class=\\'file\\'>⚠️ file non più disponibile</span>'`;
        const inner = (f.type || "").startsWith("image/")
          ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(f.name)}" onerror="${broken}"></a>`
          : `<a class="file" href="${url}" target="_blank" rel="noopener">📎 ${esc((f.name || "file").slice(0, 18))}</a>`;
        el.insertAdjacentHTML("beforeend", `
          <div class="thumb-item">
            ${inner}
            <button type="button" class="del-thumb" title="Rimuovi allegato" data-del-file="${f.id}" ${docId ? `data-parent-doc="${docId}"` : ""} ${contactId ? `data-parent-contact="${contactId}"` : ""} ${poiId ? `data-parent-poi="${poiId}"` : ""}>✕</button>
          </div>
        `);
      }
    }
  },

  /* ---------------- contacts & POI ---------------- */
  /* Ogni tipo di contatto ha campi propri: gli orari di check-in servono solo a un alloggio. */
  KIND_FORM: {
    struttura:  { name: "Nome struttura", times: true,  timeIn: "Check-in (es. 15:00)", timeOut: "Check-out (es. 10:00)", ref: "Codice prenotazione", email: true },
    emergenza:  { name: "Servizio (es. Ambasciata italiana)", times: false, ref: "", email: true },
    trasporto:  { name: "Compagnia / autista", times: true, timeIn: "Ritiro / partenza", timeOut: "Riconsegna / arrivo", ref: "Codice prenotazione o targa", email: true },
    ristorante: { name: "Nome locale", times: true, timeIn: "Orario prenotazione", timeOut: "", ref: "Riferimento prenotazione", email: true },
    altro:      { name: "Nome", times: false, ref: "Riferimento", email: true }
  },
  applyContactKind() {
    const cfg = this.KIND_FORM[$("#ct-kind").value] || this.KIND_FORM.altro;
    $("#ct-name").placeholder = cfg.name;
    $("#ct-times").classList.toggle("hidden", !cfg.times);
    if (cfg.times) {
      $("#ct-in").placeholder = cfg.timeIn;
      $("#ct-out").classList.toggle("hidden", !cfg.timeOut);
      if (cfg.timeOut) $("#ct-out").placeholder = cfg.timeOut;
    }
    $("#ct-ref").classList.toggle("hidden", !cfg.ref);
    if (cfg.ref) $("#ct-ref").placeholder = cfg.ref;
    $("#ct-email").classList.toggle("hidden", !cfg.email);
    $("#ct-phone").placeholder = $("#ct-kind").value === "emergenza" ? "Numero (es. 112)" : "Telefono (+39…)";
  },
  parseGoogleMapsUrl(urlStr) {
    if (!urlStr || typeof urlStr !== "string") return null;
    let decoded = urlStr.trim();
    try { decoded = decodeURIComponent(decoded); } catch (e) {}
    let name = "", addr = "", cat = "";

    // 1. /place/Name/@lat,lng format
    const placeMatch = decoded.match(/\/maps\/place\/([^/@?]+)/) || decoded.match(/\/place\/([^/@?]+)/);
    if (placeMatch && placeMatch[1]) {
      name = placeMatch[1].replace(/\+/g, " ").replace(/%2B/gi, " ").trim();
    }

    // 2. Query param ?q=... or &q=...
    if (!name) {
      const qMatch = decoded.match(/[?&]q=([^&]+)/);
      if (qMatch && qMatch[1]) {
        const qVal = qMatch[1].replace(/\+/g, " ").replace(/%2B/gi, " ").trim();
        if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(qVal)) {
          addr = qVal;
        } else {
          name = qVal;
        }
      }
    }

    // 3. Search path /maps/search/Name
    if (!name) {
      const searchMatch = decoded.match(/\/maps\/search\/([^/@?]+)/);
      if (searchMatch && searchMatch[1]) {
        name = searchMatch[1].replace(/\+/g, " ").replace(/%2B/gi, " ").trim();
      }
    }

    // 4. Coordinates @lat,lng or !3d...!4d...
    const coordMatch = decoded.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (coordMatch) {
      const coords = `${coordMatch[1]}, ${coordMatch[2]}`;
      if (!addr) addr = coords;
    }

    // Clean up place name if comma separated
    if (name.includes(",")) {
      const parts = name.split(",").map(s => s.trim());
      name = parts[0];
      if (!addr) addr = parts.slice(1).join(", ");
    }

    // Auto category keyword detection
    const lower = (name + " " + addr).toLowerCase();
    if (/ristorante|trattoria|pizzeria|osteria|bar|caffè|pasticceria|bakery|cafe|restaurant|food|gelateria|pub|tasca|bistrot/i.test(lower)) {
      cat = "cibo";
    } else if (/stazione|aeroporto|metro|bus|fermata|terminal|parcheggio|port|station|airport|railway/i.test(lower)) {
      cat = "trasporto";
    } else if (/negozio|store|mall|outlet|bazaar|mercato|shopping|market/i.test(lower)) {
      cat = "shopping";
    } else if (/planetario|museo|castello|monumento|chiesa|basilica|duomo|miradouro|palazzo|torre|parco|giardino|museum|castle|tower|viewpoint|park|plaza|piazza|teatro|cinema/i.test(lower)) {
      cat = "visita";
    }

    return { name, addr, cat, mapsUrl: urlStr.trim() };
  },

  async reverseGeocode(name, lat, lng) {
    // 1. Try reverse geocoding if lat & lng are present
    if (lat && lng) {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&format=json`;
        const res = await fetch(url, {
          headers: {
            "Accept-Language": "it,en",
            "User-Agent": "PartiAmoTravelApp/1.0"
          }
        });
        if (res.ok) {
          const data = await res.json();
          const a = data.address || {};
          const road = a.road || a.pedestrian || a.street || a.square || a.amenity || a.tourism || "";
          const num = a.house_number ? " " + a.house_number : "";
          const city = a.city || a.town || a.village || a.suburb || a.municipality || "";
          
          if (road) {
            return road + num + (city ? ", " + city : "");
          } else if (data.display_name) {
            const parts = data.display_name.split(",").map(s => s.trim());
            return parts.slice(0, 3).join(", ");
          }
        }
      } catch (err) {
        console.warn("Reverse geocode error:", err);
      }
    }

    // 2. Fallback: Search Nominatim by place name if name exists
    if (name) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`;
        const res = await fetch(url, {
          headers: {
            "Accept-Language": "it,en",
            "User-Agent": "PartiAmoTravelApp/1.0"
          }
        });
        if (res.ok) {
          const list = await res.json();
          if (list && list.length) {
            const d = list[0];
            const parts = (d.display_name || "").split(",").map(s => s.trim());
            return parts.slice(0, 3).join(", ");
          }
        }
      } catch (err) {
        console.warn("Place search geocode error:", err);
      }
    }

    return null;
  },

  async resolveGoogleMapsUrl(urlStr) {
    if (!urlStr || typeof urlStr !== "string") return null;
    const cleanUrl = urlStr.trim();
    let parsed = this.parseGoogleMapsUrl(cleanUrl);

    // If it's a shortened URL (maps.app.goo.gl, goo.gl, g.co, etc.) and missing name or addr:
    if ((!parsed || !parsed.name) && /maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps/i.test(cleanUrl)) {
      try {
        const apiRes = await fetch("https://unshorten.me/json/" + encodeURIComponent(cleanUrl));
        if (apiRes.ok) {
          const data = await apiRes.json();
          if (data && data.resolved_url) {
            const resolvedParsed = this.parseGoogleMapsUrl(data.resolved_url);
            if (resolvedParsed && (resolvedParsed.name || resolvedParsed.addr)) {
              resolvedParsed.mapsUrl = cleanUrl;
              parsed = resolvedParsed;
            }
          }
        }
      } catch (err) {
        console.warn("Unshorten API error:", err);
      }
    }

    if (!parsed) return null;

    let lat = null, lng = null;
    if (parsed.addr && /^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(parsed.addr.trim())) {
      const parts = parsed.addr.split(",").map(s => s.trim());
      lat = parts[0]; lng = parts[1];
    }

    // Always convert coordinates into real street address & house number!
    const street = await this.reverseGeocode(parsed.name, lat, lng);
    if (street) {
      parsed.addr = street;
    } else if (lat && lng) {
      // Clear raw numeric GPS coordinates from the address field so numbers never appear
      parsed.addr = "";
    }

    return parsed;
  },

  bindContacts() {
    $("#ct-kind").addEventListener("change", () => this.applyContactKind());
    this.applyContactKind();

    $("#ct-maps-url").addEventListener("input", async e => {
      const url = e.target.value.trim();
      if (!url) return;

      const parsed = await this.resolveGoogleMapsUrl(url);

      if (parsed) {
        if (parsed.name) $("#ct-name").value = parsed.name;
        if (parsed.addr !== undefined) $("#ct-addr").value = parsed.addr;
        if (parsed.cat) {
          const catToKind = { cibo: "ristorante", trasporto: "trasporto", visita: "altro", shopping: "altro", altro: "altro" };
          if (catToKind[parsed.cat]) {
            $("#ct-kind").value = catToKind[parsed.cat];
            this.applyContactKind();
          }
        }
        this.toast(`Compilato: ${parsed.name || "Dati da Google Maps"}`);
      }
    });

    $("#poi-maps-url").addEventListener("input", async e => {
      const url = e.target.value.trim();
      if (!url) return;

      const parsed = await this.resolveGoogleMapsUrl(url);

      if (parsed) {
        if (parsed.name) $("#poi-name").value = parsed.name;
        if (parsed.addr !== undefined) $("#poi-addr").value = parsed.addr;
        if (parsed.cat) $("#poi-cat").value = parsed.cat;
        this.toast(`Compilato: ${parsed.name || "Dati da Google Maps"}`);
      }
    });

    $("#form-contact").addEventListener("submit", async e => {
      e.preventDefault();
      const cfg = this.KIND_FORM[$("#ct-kind").value] || this.KIND_FORM.altro;
      const c = {
        id: Store.uid(), kind: $("#ct-kind").value, name: $("#ct-name").value.trim(),
        phone: $("#ct-phone").value.trim(), email: $("#ct-email").value.trim(),
        addr: $("#ct-addr").value.trim(), mapsUrl: $("#ct-maps-url").value.trim(),
        cin: cfg.times ? $("#ct-in").value.trim() : "",
        cout: cfg.times && cfg.timeOut ? $("#ct-out").value.trim() : "",
        ref: cfg.ref ? $("#ct-ref").value.trim() : "",
        timeLabels: cfg.times ? [cfg.timeIn, cfg.timeOut] : null,
        notes: $("#ct-notes").value.trim(), files: []
      };
      const fl = $("#ct-media").files;
      if (fl.length) c.files = await Media.saveAll(fl);

      const editId = $("#form-contact").dataset.editId;
      if (editId) {
        const prev = Store.s.contacts.find(x => x.id === editId);
        if (prev) {
          // Gli allegati già presenti restano: i nuovi file si aggiungono.
          Object.assign(prev, c, { id: prev.id, files: (prev.files || []).concat(c.files) });
        }
        delete $("#form-contact").dataset.editId;
        const btn = $("#form-contact button.primary");
        if (btn) btn.textContent = "+ Salva contatto";
        this.toast("Contatto aggiornato");
      } else {
        Store.s.contacts.push(c);
        this.toast("Contatto salvato");
      }
      Store.save();
      $("#form-contact").reset();
      this.applyContactKind();
      const countEl = $("#ct-media-count");
      if (countEl) countEl.textContent = "";
      $("#ct-scan").innerHTML = "";
      this.renderContacts();
    });

    $("#ct-media").addEventListener("change", () => this.scanContactFiles());

    $("#form-poi").addEventListener("submit", async e => {
      e.preventDefault();
      const editId = $("#form-poi").dataset.editId;
      const fl = $("#poi-media").files;
      let newFiles = [];
      if (fl.length) newFiles = await Media.saveAll(fl);

      if (editId) {
        const p = Store.s.pois.find(x => x.id === editId);
        if (p) {
          p.name = $("#poi-name").value.trim();
          p.addr = $("#poi-addr").value.trim();
          p.mapsUrl = $("#poi-maps-url").value.trim();
          p.cat = $("#poi-cat").value;
          p.day = $("#poi-day").value;
          p.notes = $("#poi-notes").value.trim();
          if (newFiles.length) p.files = (p.files || []).concat(newFiles);
        }
        delete $("#form-poi").dataset.editId;
        const btn = $("#form-poi button.primary");
        if (btn) btn.textContent = "+ Salva POI";
        this.toast("POI aggiornato!");
      } else {
        const p = {
          id: Store.uid(), name: $("#poi-name").value.trim(), addr: $("#poi-addr").value.trim(),
          mapsUrl: $("#poi-maps-url").value.trim(),
          cat: $("#poi-cat").value, day: $("#poi-day").value, notes: $("#poi-notes").value.trim(), files: newFiles
        };
        Store.s.pois.push(p);
        this.toast("POI salvato");
      }
      Store.save();
      $("#form-poi").reset();
      const countEl = $("#poi-media-count");
      if (countEl) countEl.textContent = "";
      this.renderContacts();
      this.renderItinerary();
    });

    $("#poi-media").addEventListener("change", e => {
      const count = e.target.files.length;
      const countEl = $("#poi-media-count");
      if (countEl) countEl.textContent = count ? `📷 ${count} file selezionati` : "";
    });

    document.addEventListener("click", async e => {
      const delFileBtn = e.target.closest("[data-del-file]");
      if (delFileBtn) {
        const fileId = delFileBtn.dataset.delFile;
        const docId = delFileBtn.dataset.parentDoc;
        const contactId = delFileBtn.dataset.parentContact;
        const poiId = delFileBtn.dataset.parentPoi;

        if (confirm("Rimuovere questo allegato?")) {
          await Media.del(fileId);
          if (docId) {
            const doc = Store.s.docs.find(d => d.id === docId);
            if (doc) doc.files = (doc.files || []).filter(f => f.id !== fileId);
            Store.save(); this.renderVault();
          } else if (contactId) {
            const contact = Store.s.contacts.find(c => c.id === contactId);
            if (contact) contact.files = (contact.files || []).filter(f => f.id !== fileId);
            Store.save(); this.renderContacts();
          } else if (poiId) {
            const poi = Store.s.pois.find(p => p.id === poiId);
            if (poi) poi.files = (poi.files || []).filter(f => f.id !== fileId);
            Store.save(); this.renderContacts();
          }
          this.toast("Allegato rimosso");
        }
        return;
      }

      const editContactBtn = e.target.closest("[data-edit-contact]");
      if (editContactBtn) {
        const c = Store.s.contacts.find(x => x.id === editContactBtn.dataset.editContact);
        if (c) {
          const form = $("#form-contact");
          form.dataset.editId = c.id;
          $("#ct-kind").value = c.kind || "altro";
          this.applyContactKind();
          $("#ct-maps-url").value = c.mapsUrl || "";
          $("#ct-name").value = c.name || "";
          $("#ct-phone").value = c.phone || "";
          $("#ct-email").value = c.email || "";
          $("#ct-addr").value = c.addr || "";
          $("#ct-in").value = c.cin || "";
          $("#ct-out").value = c.cout || "";
          $("#ct-ref").value = c.ref || "";
          $("#ct-notes").value = c.notes || "";
          const btn = $("#form-contact button.primary");
          if (btn) btn.textContent = "💾 Salva modifiche";
          form.scrollIntoView({ behavior: "smooth", block: "center" });
          this.toast(`Modifica "${c.name}"`);
        }
        return;
      }

      const editPoiBtn = e.target.closest("[data-edit-poi]");
      if (editPoiBtn) {
        const id = editPoiBtn.dataset.editPoi;
        const p = Store.s.pois.find(x => x.id === id);
        if (p) {
          $("#form-poi").dataset.editId = p.id;
          $("#poi-maps-url").value = p.mapsUrl || "";
          $("#poi-name").value = p.name || "";
          $("#poi-addr").value = p.addr || "";
          $("#poi-cat").value = p.cat || "visita";
          $("#poi-day").value = p.day || "";
          $("#poi-notes").value = p.notes || "";
          const btn = $("#form-poi button.primary");
          if (btn) btn.textContent = "💾 Salva modifiche POI";
          $("#form-poi").scrollIntoView({ behavior: "smooth", block: "center" });
          this.toast(`Modifica "${p.name}"`);
        }
        return;
      }

      const b = e.target.closest("[data-del-contact], [data-del-poi]");
      if (!b) return;
      const isPoi = !!b.dataset.delPoi;
      const id = isPoi ? b.dataset.delPoi : b.dataset.delContact;
      const list = isPoi ? Store.s.pois : Store.s.contacts;
      const it = list.find(x => x.id === id);
      if (!it || !confirm("Eliminare la scheda completa?")) return;
      for (const f of it.files || []) await Media.del(f.id);
      if (isPoi) Store.s.pois = list.filter(x => x.id !== id);
      else Store.s.contacts = list.filter(x => x.id !== id);
      Store.save();
      this.renderContacts();
      this.renderItinerary();
    });
  },

  async scanContactFiles() {
    const files = Array.from($("#ct-media").files);
    const box = $("#ct-scan");
    const countEl = $("#ct-media-count");
    if (countEl) countEl.textContent = files.length ? `📷 ${files.length} file selezionati` : "";
    if (!files.length) { box.innerHTML = ""; return; }
    if (!Scan.available()) {
      box.innerHTML = `<div class="alert warn">Librerie OCR non caricate: verifica la cartella <code>vendor/</code>.</div>`;
      return;
    }
    const say = m => box.innerHTML = `<div class="alert info">⏳ ${esc(m)}</div>`;
    let out = [], modes = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const prefix = files.length > 1 ? `File ${i + 1}/${files.length} — ` : "";
        const r = await Scan.fromFile(f, { mrz: false }, m => say(prefix + m));
        out.push(r.text);
        modes.push(`${f.name}: ${r.mode} in ${r.seconds}s`);
      } catch (err) {
        console.error("Scan fallito", f.name, err);
        modes.push(`${f.name}: errore — ${err.message}`);
      }
    }
    const text = out.join("\n\n").trim();
    box.innerHTML = `<div class="alert ${text ? "ok" : "warn"}">${text ? "✅" : "⚠️"} ${esc(modes.join(" · "))}${text ? "" : "<br>Nessun testo riconosciuto: riprova con una foto più nitida ed illuminata."}</div>`;
    if (text) {
      const parsed = OCR.parse(text);
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      let nameMatch = parsed.passenger || parsed.property || parsed.company || (lines.length ? lines[0] : "");
      // Se il nome coinciderebbe con la ragione sociale, cerco la riga con il nome
      // della persona: su un biglietto da visita l'azienda va nel riferimento.
      if (parsed.company && nameMatch.toLowerCase() === parsed.company.toLowerCase()) {
        const person = lines.find(l => /^[A-ZÀ-Ù][a-zà-ù'’]+(\s+[A-ZÀ-Ù][a-zà-ù'’]+){1,2}$/.test(l) && l.toLowerCase() !== parsed.company.toLowerCase());
        if (person) nameMatch = person;
      }

      if (nameMatch && !$("#ct-name").value.trim()) $("#ct-name").value = nameMatch.slice(0, 60);
      // Riferimento = ragione sociale dell'azienda (su un biglietto da visita è la sigla).
      if (parsed.company && !$("#ct-ref").value.trim()) $("#ct-ref").value = parsed.company.slice(0, 60);
      if (parsed.phone && !$("#ct-phone").value.trim()) $("#ct-phone").value = parsed.phone;
      if (parsed.email && !$("#ct-email").value.trim()) $("#ct-email").value = parsed.email;
      if (parsed.address && !$("#ct-addr").value.trim()) $("#ct-addr").value = parsed.address.slice(0, 80);
      if (parsed.vat && !/p\.?\s?iva/i.test($("#ct-notes").value)) {
        $("#ct-notes").value = ($("#ct-notes").value ? $("#ct-notes").value + " · " : "") + "P.IVA " + parsed.vat;
      }
      if ((parsed.checkinTime || parsed.checkin) && !$("#ct-in").value.trim()) $("#ct-in").value = parsed.checkinTime || parsed.checkin;
      if ((parsed.checkoutTime || parsed.checkout) && !$("#ct-out").value.trim()) $("#ct-out").value = parsed.checkoutTime || parsed.checkout;

      // Auto-kind categorization
      const U = text.toUpperCase();
      if (/\b(HOTEL|B&B|BNB|RESORT|HOSTEL|OSTELLO|SUITE|CHECK-IN|CHECKOUT)\b/.test(U)) $("#ct-kind").value = "struttura";
      else if (/\b(TAXI|AIRPORT|AEROPORTO|VOLO|FLIGHT|TRENO|BUS|TRANSFER)\b/.test(U)) $("#ct-kind").value = "trasporto";
      else if (/\b(POLIZIA|AMBULANZA|EMERGENCY|SOCCORSO|EMERGENZA|OSPEDALE)\b/.test(U)) $("#ct-kind").value = "emergenza";
      else if (/\b(RISTORANTE|TRATTORIA|OSTERIA|PIZZERIA|RESTAURANT|BISTRO)\b/.test(U)) $("#ct-kind").value = "ristorante";
      // Biglietto da visita aziendale: nessun orario di check-in da chiedere.
      else if (parsed.company || parsed.vat) $("#ct-kind").value = "altro";
      this.applyContactKind();

      this.toast("Dati contatto estratti dalla foto!");
    }
  },

  async scanPoiFiles() {
    const files = Array.from($("#poi-media").files);
    const box = $("#poi-scan");
    if (!files.length) { box.innerHTML = ""; return; }
    if (!Scan.available()) {
      box.innerHTML = `<div class="alert warn">Librerie OCR non caricate: verifica la cartella <code>vendor/</code>.</div>`;
      return;
    }
    const say = m => box.innerHTML = `<div class="alert info">⏳ ${esc(m)}</div>`;
    let out = [], modes = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      try {
        const prefix = files.length > 1 ? `File ${i + 1}/${files.length} — ` : "";
        const r = await Scan.fromFile(f, { mrz: false }, m => say(prefix + m));
        out.push(r.text);
        modes.push(`${f.name}: ${r.mode} in ${r.seconds}s`);
      } catch (err) {
        console.error("Scan fallito", f.name, err);
        modes.push(`${f.name}: errore — ${err.message}`);
      }
    }
    const text = out.join("\n\n").trim();
    box.innerHTML = `<div class="alert ${text ? "ok" : "warn"}">${text ? "✅" : "⚠️"} ${esc(modes.join(" · "))}${text ? "" : "<br>Nessun testo riconosciuto."}</div>`;
    if (text) {
      const parsed = OCR.parse(text);
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const nameMatch = parsed.property || (lines.length ? lines[0] : "");
      if (nameMatch && !$("#poi-name").value.trim()) $("#poi-name").value = nameMatch.slice(0, 60);
      if (parsed.address && !$("#poi-addr").value.trim()) $("#poi-addr").value = parsed.address.slice(0, 80);
      if (parsed.dateMain && !$("#poi-day").value) $("#poi-day").value = parsed.dateMain;
      const extraNotes = [];
      if (parsed.phone) extraNotes.push("Tel: " + parsed.phone);
      if (parsed.email) extraNotes.push("Email: " + parsed.email);
      if (parsed.checkinTime || parsed.checkoutTime) extraNotes.push(`Orari: ${parsed.checkinTime || ""}-${parsed.checkoutTime || ""}`);
      if (extraNotes.length) {
        const curNotes = $("#poi-notes").value.trim();
        $("#poi-notes").value = curNotes ? curNotes + "\n" + extraNotes.join(" · ") : extraNotes.join(" · ");
      }
      this.toast("Dati POI estratti dalla foto!");
    }
  },

  renderContacts() {
    const s = Store.s, dest = s.trip.dest || "";
    const KIND = { struttura: "🏨", emergenza: "🚨", trasporto: "🚕", ristorante: "🍽️", altro: "📌" };
    const CAT = { visita: "🏛️", cibo: "🍽️", trasporto: "🚌", shopping: "🛍️", altro: "📍" };
    // L'etichetta degli orari dipende dal tipo: "Check-in" solo per un alloggio.
    const tLabel = (c, i, fb) => ((c.timeLabels && c.timeLabels[i]) || fb).replace(/\s*\(.*\)$/, "");

    $("#contacts-list").innerHTML = s.contacts.length ? s.contacts.map(c => `
      <div class="contact">
        <h4>${KIND[c.kind] || "📌"} ${esc(c.name)} <span class="badge">${esc(c.kind)}</span></h4>
        <div class="kv">
          ${c.phone ? `<dt>Telefono</dt><dd>${esc(c.phone)}</dd>` : ""}
          ${c.email ? `<dt>Email</dt><dd>${esc(c.email)}</dd>` : ""}
          ${c.addr ? `<dt>Indirizzo</dt><dd>${esc(c.addr)}</dd>` : ""}
          ${c.cin ? `<dt>${esc(tLabel(c, 0, "Check-in"))}</dt><dd>${esc(c.cin)}</dd>` : ""}
          ${c.cout ? `<dt>${esc(tLabel(c, 1, "Check-out"))}</dt><dd>${esc(c.cout)}</dd>` : ""}
          ${c.ref ? `<dt>Riferimento</dt><dd>${esc(c.ref)}</dd>` : ""}
          ${c.notes ? `<dt>Note</dt><dd>${esc(c.notes)}</dd>` : ""}
        </div>
        <div class="thumbs" data-files='${esc(JSON.stringify(c.files || []))}' data-contact-id="${c.id}"></div>
        <div class="actions">
          ${c.phone ? `<a href="tel:${esc(c.phone.replace(/\s/g, ""))}">📞 Chiama</a>
                       <a href="https://wa.me/${esc(c.phone.replace(/[^\d]/g, ""))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
          ${c.email ? `<a href="mailto:${esc(c.email)}">✉️ Email</a>` : ""}
          ${(c.mapsUrl || c.addr) ? `<a href="${esc(c.mapsUrl || mapsUrl(c.addr + " " + dest))}" target="_blank" rel="noopener">🗺️ Mappa</a>` : ""}
          <button data-edit-contact="${c.id}">✏️ Modifica</button>
          <button data-del-contact="${c.id}">🗑</button>
        </div>
      </div>`).join("") : `<p class="note">Nessun contatto salvato.</p>`;

    $("#pois-list").innerHTML = s.pois.length ? s.pois.map(p => `
      <div class="poi">
        <h4>${CAT[p.cat] || "📍"} ${esc(p.name)} ${p.day ? `<span class="badge">${itDate(p.day)}</span>` : ""}</h4>
        <div class="kv">
          ${p.addr ? `<dt>Dove</dt><dd>${esc(p.addr)}</dd>` : ""}
          ${p.notes ? `<dt>Note</dt><dd>${esc(p.notes)}</dd>` : ""}
        </div>
        <div class="thumbs" data-files='${esc(JSON.stringify(p.files || []))}' data-poi-id="${p.id}"></div>
        <div class="actions">
          <a href="${esc(p.mapsUrl || mapsUrl((p.addr || p.name) + " " + dest))}" target="_blank" rel="noopener">🗺️ Apri in Maps</a>
          <button data-edit-poi="${p.id}">✏️ Modifica</button>
          <button data-del-poi="${p.id}">🗑</button>
        </div>
      </div>`).join("") : `<p class="note">Nessun punto di interesse.</p>`;

    this.hydrateThumbs($("#contacts-list"));
    this.hydrateThumbs($("#pois-list"));
  },

  /* ---------------- itinerary ---------------- */
  renderItinerary() {
    const s = Store.s, t = s.trip;
    const box = $("#itin-days");
    if (!t.start || !t.end) { box.innerHTML = `<p class="note">Configura le date del viaggio.</p>`; return; }
    const days = [];
    for (let d = new Date(t.start + "T00:00:00"); d <= new Date(t.end + "T00:00:00"); d.setDate(d.getDate() + 1)) {
      days.push(new Date(d));
    }
    const todayIso = isoLocal(new Date());
    const SLOT_ICONS = {
      mattina: "🌅", pranzo: "🍽️", pomeriggio: "🌆",
      cena: "🍷", serata: "🌙", giornata: "🗓️"
    };

    box.innerHTML = days.map((d, i) => {
      const iso = isoLocal(d);
      const day = s.itinerary[iso] || {};
      const count = SLOTS.reduce((a, [k]) => a + ((day[k] || []).length), 0);
      const activeSlots = SLOTS.filter(([k]) => (day[k] || []).length > 0);

      const wDay = (s.weather && s.weather.days) ? s.weather.days.find(w => w.date === iso) : null;
      let wBadge = "", wPanel = "";

      if (wDay) {
        const [ic, lb] = DATA.wmoInfo(wDay.code);
        const rainStr = wDay.rainP != null ? `${wDay.rainP}%` : (wDay.rainMm ? `${wDay.rainMm} mm` : "");
        wBadge = `<span class="day-weather-badge">${ic} ${Math.round(wDay.tmax)}° / ${Math.round(wDay.tmin)}°${rainStr ? ` · 🌧️ ${rainStr}` : ""}</span>`;

        wPanel = `
          <div class="day-weather-panel">
            <div class="day-weather-main">
              <span class="day-weather-icon">${ic}</span>
              <div class="day-weather-text">
                <div class="day-weather-cond">${esc(lb)}</div>
                <div class="day-weather-sub">${esc(s.weather.place || t.dest)}${wDay.historical ? " (dato storico anno precedente)" : " (previsione Open-Meteo)"}</div>
              </div>
              <div class="day-weather-temps">
                ${Math.round(wDay.tmax)}°C <span class="min">/ ${Math.round(wDay.tmin)}°C</span>
              </div>
            </div>
            <div class="day-weather-stats">
              ${rainStr ? `<div class="stat-chip">🌧️ <b>${rainStr}</b> probabilità pioggia</div>` : `<div class="stat-chip">☀️ <b>0%</b> pioggia</div>`}
              ${wDay.wind ? `<div class="stat-chip">💨 <b>${Math.round(wDay.wind)} km/h</b> vento max</div>` : ""}
              <div class="stat-chip">💡 ${esc(this.dayWeatherAdvice(wDay))}</div>
            </div>
          </div>`;
      }

      return `<details class="day" id="day-${iso}" data-day="${iso}" ${iso === todayIso || (i === 0 && !count) ? "open" : ""}>
        <summary>
          <span>Giorno ${i + 1} — ${d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })} ${wBadge}</span>
          <span class="dn">${count} attività</span>
        </summary>
        <div style="padding:12px 14px">
          ${wPanel}
          ${activeSlots.length ? activeSlots.map(([k, lbl]) => `
            <div class="slot" style="margin-bottom:10px">
              <h5 style="margin-bottom:6px">${SLOT_ICONS[k] || "📌"} ${lbl}</h5>
              ${(day[k] || []).map((a, idx) => `
                <div class="act">
                  ${a.time ? `<span class="badge" style="font-size:11.5px; background:var(--accent-soft); color:var(--accent); font-weight:700; flex:0 0 auto">⏰ ${esc(a.time)}</span>` : ""}
                  <span class="t">${esc(a.text)}</span>
                  ${a.place ? `<a class="map" href="${mapsUrl(a.place + " " + (t.dest || ""))}" target="_blank" rel="noopener">🗺️ ${esc(a.place)}</a>` : ""}
                  <button class="x" data-edit-act="${iso}|${k}|${idx}" title="Modifica attività">✏️</button>
                  <button class="x" data-del-act="${iso}|${k}|${idx}" title="Elimina attività">✕</button>
                </div>`).join("")}
            </div>`).join("") : `<p class="note" style="margin-bottom:10px">Nessuna attività ancora in programma per questo giorno.</p>`}

          <form data-add-day-act="${iso}" class="col" style="gap:8px; background:var(--surface-2); padding:10px; border-radius:12px; border:1px solid var(--border)">
            <h5 style="margin:0; font-size:12px; text-transform:uppercase; color:var(--muted)">➕ Aggiungi / Modifica attività</h5>
            ${(s.pois && s.pois.length) ? `
              <select class="itin-poi-select" aria-label="Seleziona dai POI salvati" style="font-size:13px">
                <option value="">📍 Scegli dai POI salvati...</option>
                ${s.pois.map(p => `<option value="${esc(p.name + (p.addr ? " @ " + p.addr : ""))}">${esc(p.name)}${p.addr ? " (" + esc(p.addr) + ")" : ""}</option>`).join("")}
              </select>
            ` : ""}
            <div class="row wrap" style="gap:6px">
              <input class="itin-time-input" type="time" aria-label="Orario (opzionale)" title="Orario attività" style="flex:0 0 95px; font-size:13px">
              <input class="itin-text-input" placeholder="Attività @ luogo (es. Visita Castello)" aria-label="Descrizione attività" style="flex:1 1 180px">
              <select class="itin-slot-select" aria-label="Fase della giornata" style="flex:0 0 130px; font-size:13px">
                ${SLOTS.map(([k, lbl]) => `<option value="${k}">${lbl}</option>`).join("")}
              </select>
              <button class="primary small" style="flex:0 0 auto">+ Aggiungi</button>
            </div>
          </form>
        </div>
      </details>`;
    }).join("");

    box.onchange = e => {
      const sel = e.target.closest(".itin-poi-select"); if (!sel) return;
      const form = sel.closest("form"); if (!form) return;
      const input = form.querySelector(".itin-text-input");
      if (sel.value && input) input.value = sel.value;
    };

    box.onsubmit = e => {
      const form = e.target.closest("form[data-add-day-act]"); if (!form) return;
      e.preventDefault();
      const iso = form.dataset.addDayAct;
      const time = (form.querySelector(".itin-time-input")?.value || "").trim();
      const raw = (form.querySelector(".itin-text-input").value || "").trim();
      const slot = form.querySelector(".itin-slot-select").value;
      if (!raw) return;
      const [text, place] = raw.split("@").map(x => x.trim());
      const actObj = { text: text || raw, place: place || "", time: time || "" };

      s.itinerary[iso] = s.itinerary[iso] || {};

      const editSlot = form.dataset.editSlot;
      const editIdx = form.dataset.editIdx;

      if (editSlot !== undefined && editIdx !== undefined) {
        const oldIdx = +editIdx;
        if (editSlot === slot) {
          s.itinerary[iso][slot][oldIdx] = actObj;
        } else {
          if (s.itinerary[iso][editSlot]) {
            s.itinerary[iso][editSlot].splice(oldIdx, 1);
          }
          s.itinerary[iso][slot] = s.itinerary[iso][slot] || [];
          s.itinerary[iso][slot].push(actObj);
        }
        delete form.dataset.editSlot;
        delete form.dataset.editIdx;
        this.toast("Attività aggiornata!");
      } else {
        s.itinerary[iso][slot] = s.itinerary[iso][slot] || [];
        s.itinerary[iso][slot].push(actObj);
        this.toast("Attività aggiunta!");
      }

      Store.save(); this.renderItinerary(); this.renderDashboard();
    };

    box.onclick = e => {
      const editBtn = e.target.closest("[data-edit-act]");
      if (editBtn) {
        const [iso, slot, idxStr] = editBtn.dataset.editAct.split("|");
        const idx = +idxStr;
        if (s.itinerary[iso] && s.itinerary[iso][slot] && s.itinerary[iso][slot][idx]) {
          const act = s.itinerary[iso][slot][idx];
          const form = document.querySelector(`form[data-add-day-act="${iso}"]`);
          if (form) {
            form.dataset.editSlot = slot;
            form.dataset.editIdx = idx;
            const timeIn = form.querySelector(".itin-time-input");
            const textIn = form.querySelector(".itin-text-input");
            const slotSel = form.querySelector(".itin-slot-select");
            const submitBtn = form.querySelector("button");

            if (timeIn) timeIn.value = act.time || "";
            if (textIn) textIn.value = act.text + (act.place ? " @ " + act.place : "");
            if (slotSel) slotSel.value = slot;
            if (submitBtn) submitBtn.textContent = "💾 Salva";

            form.scrollIntoView({ behavior: "smooth", block: "center" });
            if (textIn) textIn.focus();
            this.toast(`Modifica "${act.text}"`);
          }
        }
        return;
      }

      const delBtn = e.target.closest("[data-del-act]");
      if (delBtn) {
        const [iso, slot, idx] = delBtn.dataset.delAct.split("|");
        if (s.itinerary[iso] && s.itinerary[iso][slot]) {
          s.itinerary[iso][slot].splice(+idx, 1);
          Store.save(); this.renderItinerary(); this.renderDashboard();
        }
      }
    };
  }
};

document.addEventListener("DOMContentLoaded", () => UI.init());
