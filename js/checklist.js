/* checklist.js — dynamic packing-list engine.
   Inputs: trip duration, weather (min/max/rain), trip type, transport, luggage, laundry. */

const Checklist = (function () {

  const CATS = {
    documenti:    { label: "Documenti", icon: "🛂" },
    abbigliamento:{ label: "Abbigliamento & Cambi", icon: "👕" },
    elettronica:  { label: "Elettronica", icon: "🔌" },
    igiene:       { label: "Igiene & Salute", icon: "🧴" },
    extra:        { label: "Extra", icon: "🎒" }
  };

  const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function days(trip) {
    if (!trip.start || !trip.end) return 1;
    const a = new Date(trip.start + "T00:00:00"), b = new Date(trip.end + "T00:00:00");
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  }

  /* Clothing quantities. Laundry caps the wardrobe at a 7-day cycle. */
  function garments(n, w, trip) {
    const cap = trip.laundry === "si" ? Math.min(n, 7) : n;
    const tmax = w ? w.tmaxAvg : 18;
    const tmin = w ? w.tminAvg : 10;

    // t-shirt factor: hot climate = more changes per day, cold = fewer
    const tf = tmax >= 27 ? 1.3 : tmax >= 20 ? 1 : tmax >= 12 ? 0.85 : 0.7;
    const shirts = Math.max(2, Math.ceil(cap * tf));
    const bottomsDiv = tmax >= 27 ? 2 : tmax >= 15 ? 3 : 4;

    const g = {
      intimo: cap + 1,
      calzini: cap + 1,
      magliette: shirts,
      pantaloni: Math.max(1, Math.ceil(cap / bottomsDiv)),
      pigiama: Math.max(1, Math.ceil(cap / 4)),
      felpe: 0, giacca: 0, termico: 0
    };

    if (tmax < 5)       { g.termico = Math.max(2, Math.ceil(cap / 3)); g.felpe = Math.max(2, Math.ceil(cap / 4)); g.giacca = 1; }
    else if (tmax < 12) { g.termico = trip.type === "trekking" ? 2 : 1; g.felpe = Math.max(2, Math.ceil(cap / 4)); g.giacca = 1; }
    else if (tmax < 18) { g.felpe = Math.max(1, Math.ceil(cap / 5)); g.giacca = 1; }
    else if (tmax < 25) { g.felpe = 1; }
    else                { g.felpe = tmin < 18 ? 1 : 0; }

    return g;
  }

  function generate(trip, w) {
    const n = days(trip);
    const g = garments(n, w, trip);
    const flying = trip.transport === "aereo" && trip.airline !== "nessuna";
    const luggages = trip.luggages || [{ type: trip.luggage || "trolley" }];
    const holdBag = luggages.some(b => (b.type || b) === "stiva");
    const ci = DATA.countryInfo(trip.country) || (w && DATA.countryInfo(w.country)) || DATA.defaultCountry;
    const tmax = w ? w.tmaxAvg : null, tmin = w ? w.tminAvg : null;
    const swing = w ? (w.tmax - w.tmin) : 0;
    const out = [];
    const add = (cat, name, qty, note) => out.push({ id: slug(cat + "-" + name), cat, name, qty: qty || 1, note: note || "", gen: true, done: false });

    /* --- Documenti --- */
    add("documenti", "Carta d'identità / Passaporto", trip.travelers);
    if (flying) add("documenti", "Carte d'imbarco (stampate + smartphone)", trip.travelers);
    add("documenti", "Conferme prenotazione alloggio", 1);
    if (!ci.eu) add("documenti", "Assicurazione sanitaria di viaggio", 1, "Fuori UE: la TEAM non copre");
    if (ci.eu) add("documenti", "Tessera Sanitaria / TEAM", trip.travelers);
    add("documenti", "Patente (o Patente Internazionale se extra-UE)", 1);
    add("documenti", "Contanti in valuta locale + carta di credito", 1);
    add("documenti", "Copie digitali dei documenti (cloud/offline)", 1);

    /* --- Abbigliamento --- */
    add("abbigliamento", "Intimo", g.intimo);
    add("abbigliamento", "Calzini", g.calzini, tmax !== null && tmax < 10 ? "Preferisci lana merino" : "");
    add("abbigliamento", "Magliette / T-shirt", g.magliette);
    add("abbigliamento", "Pantaloni / gonne", g.pantaloni);
    add("abbigliamento", "Pigiama", g.pigiama);
    if (g.termico) add("abbigliamento", "Strato termico (base layer)", g.termico, "Primo strato della cipolla");
    if (g.felpe)   add("abbigliamento", "Felpa / maglione", g.felpe, "Strato intermedio");
    if (g.giacca)  add("abbigliamento", tmax < 5 ? "Giacca invernale imbottita" : "Giacca / capospalla", 1, "Strato esterno");
    if (tmax !== null && tmax < 5) { add("abbigliamento", "Cappello, sciarpa e guanti", 1); }
    if (tmax !== null && tmax >= 24) { add("abbigliamento", "Cappello / bandana anti-sole", 1); add("abbigliamento", "Occhiali da sole", 1); }
    if (w && w.rainDays > 0) add("abbigliamento", "Giacca impermeabile o ombrello compatto", 1, `${w.rainDays} giorn${w.rainDays === 1 ? "o" : "i"} con pioggia probabile`);
    if (w && w.snow) add("abbigliamento", "Scarponi impermeabili / doposci", 1);
    if (swing >= 10) add("abbigliamento", "Outfit a cipolla (3 strati intercambiabili)", 1, `Escursione termica ${swing}°C: base + intermedio + guscio`);
    add("abbigliamento", "Scarpe comode da cammino", 1);
    add("abbigliamento", "Sacchetto per il bucato sporco", 1);

    if (trip.type === "business") {
      add("abbigliamento", "Completo / abito formale", Math.max(1, Math.ceil(n / 3)));
      add("abbigliamento", "Camicie", Math.max(2, Math.ceil(n * 0.9)));
      add("abbigliamento", "Scarpe eleganti", 1);
      add("abbigliamento", "Cintura + cravatta", 1);
      add("extra", "Biglietti da visita", 1);
      add("extra", "Blocco note e penna", 1);
    }
    if (trip.type === "trekking") {
      add("abbigliamento", "Scarponi da trekking (già rodati)", 1);
      add("abbigliamento", "Calze tecniche", Math.max(3, Math.ceil(n / 2)));
      add("abbigliamento", "Guscio antivento/antipioggia", 1);
      add("extra", "Zaino da giornata 20-30L", 1);
      add("extra", "Borraccia / sacca idrica", 1);
      add("extra", "Bastoncini da trekking", 1);
      add("extra", "Frontale + batterie di scorta", 1);
      add("extra", "Mappa offline e/o GPS", 1);
      add("igiene", "Cerotti anti-vesciche", 1);
    }
    if (trip.type === "relax") {
      add("abbigliamento", "Costume da bagno", Math.min(3, Math.max(2, Math.ceil(n / 4))));
      add("abbigliamento", "Infradito / sandali", 1);
      add("abbigliamento", "Copricostume / parei", 1);
      add("extra", "Telo mare in microfibra", trip.travelers);
      add("igiene", "Doposole", 1);
    }
    if (trip.type === "urbano") {
      add("abbigliamento", "Outfit per una serata fuori", 1);
      add("extra", "Marsupio / borsa antifurto", 1);
    }

    /* --- Elettronica --- */
    add("elettronica", "Smartphone + caricabatterie", trip.travelers);
    add("elettronica", "Powerbank", 1, flying ? "Solo in bagaglio a mano: vietato in stiva" : "");
    add("elettronica", `Adattatore presa ${ci.plugs} (${ci.volt})`, 1, "Tipo di presa della destinazione");
    add("elettronica", "Cavi USB di ricambio", 2);
    add("elettronica", "Auricolari / cuffie", 1);
    if (trip.type === "business") add("elettronica", "Laptop + alimentatore", 1);
    if (n >= 4) add("elettronica", "Ciabatta multipresa compatta", 1, "Una sola presa a muro in hotel");
    if (trip.type === "trekking" || trip.type === "relax") add("elettronica", "Custodia impermeabile per telefono", 1);
    add("elettronica", "eSIM / SIM locale o verifica roaming", 1);

    /* --- Igiene & Salute --- */
    const liquidNote = flying && !holdBag ? "Max 100 ml, in busta trasparente da 1L" : "";
    add("igiene", "Spazzolino + dentifricio", trip.travelers, liquidNote);
    add("igiene", "Bagnoschiuma / shampoo", 1, liquidNote);
    add("igiene", "Deodorante", 1, flying && !holdBag ? "Preferisci lo stick: non conta come liquido" : "");
    add("igiene", "Rasoio / necessaire", 1, flying && !holdBag ? "Lamette a mano: consentiti solo i rasoi usa e getta" : "");
    add("igiene", "Salviette umidificate e fazzoletti", 1);
    add("igiene", "Crema solare", 1, tmax !== null && tmax >= 22 ? "Indice alto: SPF 50" : liquidNote);
    add("igiene", "Farmaci personali + ricetta", 1, "In bagaglio a mano, nella confezione originale");
    add("igiene", "Antidolorifico / antipiretico", 1);
    add("igiene", "Antidiarroico e fermenti lattici", 1);
    add("igiene", "Cerotti e disinfettante", 1);
    add("igiene", "Repellente per insetti", 1);
    if (!ci.eu) add("igiene", "Integratori sali minerali", 1);
    if (tmin !== null && tmin < 0) add("igiene", "Crema barriera per labbra e viso", 1);

    /* --- Extra --- */
    add("extra", "Lucchetto TSA", holdBag ? 1 : 0);
    add("extra", "Borraccia riutilizzabile vuota", trip.travelers, flying ? "Riempila dopo i controlli" : "");
    add("extra", "Snack per il viaggio", 1);
    add("extra", "Occhiali da vista / lenti a contatto + liquido", 1);
    if (flying) { add("extra", "Cuscino da viaggio e mascherina", 1); add("extra", "Tag identificativo sul bagaglio", 1); }
    if (n >= 5) add("extra", "Cubi organizer per valigia", 1);
    add("extra", "Sacchetti richiudibili (liquidi e scarpe)", 2);

    return out.filter(i => i.qty > 0);
  }

  /* Regenerate keeping user state: done flags, custom items, deleted generated items. */
  function refresh() {
    const s = Store.s;
    s.removed = s.removed || [];
    const prev = new Map(s.checklist.map(i => [i.id, i]));
    const custom = s.checklist.filter(i => !i.gen);
    const fresh = generate(s.trip, s.weather)
      .filter(i => !s.removed.includes(i.id))
      .map(i => {
        const p = prev.get(i.id);
        return p ? Object.assign(i, { done: p.done, qty: p.qtyEdited ? p.qty : i.qty, qtyEdited: p.qtyEdited }) : i;
      });
    s.checklist = fresh.concat(custom);
    Store.save();
    return s.checklist;
  }

  function summary(trip, w) {
    const n = days(trip);
    const g = garments(n, w, trip);
    const parts = [`${n} giorn${n === 1 ? "o" : "i"}`];
    if (w) parts.push(`${w.tminAvg}°/${w.tmaxAvg}°C medi (min ${w.tmin}° · max ${w.tmax}°)`);
    parts.push(`${g.intimo} cambi intimo · ${g.magliette} magliette · ${g.pantaloni} pantaloni`);
    if (g.felpe) parts.push(`${g.felpe} strat${g.felpe === 1 ? "o" : "i"} intermed${g.felpe === 1 ? "io" : "i"}`);
    if (trip.laundry === "si" && n > 7) parts.push("lavanderia: guardaroba limitato a 7 giorni");
    if (w && (w.tmax - w.tmin) >= 10) parts.push(`escursione termica ${w.tmax - w.tmin}°C → vestizione a cipolla`);
    return parts.join(" · ");
  }

  return { CATS, generate, refresh, summary, days, garments, slug };
})();
