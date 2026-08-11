/* baggage.js — airline allowance card + dimension checker + cabin liquids rules */

const Baggage = (function () {

  function rule(trip) {
    const a = DATA.airlines[trip.airline] || DATA.airlines.altra;
    const fares = Object.keys(a.fares);
    const key = a.fares[trip.fare] ? trip.fare : fares[0];
    return { airline: a, fareKey: key, fare: a.fares[key] };
  }

  const dimStr = d => `${d[0]} × ${d[1]} × ${d[2]} cm`;

  // "Nessuna" compagnia = viaggio senza aereo, anche se il mezzo è rimasto su aereo.
  const noFlight = trip => trip.transport !== "aereo" || trip.airline === "nessuna";

  function card(trip) {
    if (noFlight(trip)) {
      let icon = "🚗";
      let msg = "";
      if (trip.transport === "auto") {
        icon = "🚗";
        msg = "<b>Viaggio in auto</b>: nessun limite di franchigia. I colli inseriti servono a calcolare la quantità ideale di vestiti nella checklist e a pianificare lo spazio nel bagagliaio.";
      } else if (trip.transport === "nave") {
        icon = "🚢";
        msg = "<b>Viaggio in nave/traghetto</b>: nessun limite di rigore aereo. Utile separare uno zaino/borsa a mano per la traversata (documenti, felpa per aria condizionata, rimedi per il mare) dalla valigia grande.";
      } else if (trip.transport === "treno") {
        icon = "🚆";
        msg = "<b>Viaggio in treno</b>: nessun limite aereo. Ricorda che sulle tratte ad alta velocità valgono le regole di ingombro delle cappelliere (solitamente max 2-3 colli a passeggero).";
      } else {
        icon = "🚌";
        msg = `Viaggio con mezzo <b>${esc(trip.transport)}</b>: nessun limite di franchigia aerea.`;
      }
      return `<div class="alert info">${icon} ${msg}</div>`;
    }
    const { airline, fare } = rule(trip);
    let h = `<div class="kv">
      <dt>Compagnia</dt><dd>${esc(airline.label)}</dd>
      <dt>Tariffa</dt><dd>${esc(fare.label)}</dd>
      <dt>${esc(fare.cabin.label || "Borsa piccola")}</dt><dd>${dimStr(fare.cabin.dims)} — max ${fare.cabin.kg} kg${fare.cabin.pieces ? " × " + fare.cabin.pieces : ""}</dd>`;
    if (fare.extra) h += `<dt>${esc(fare.extra.label || "Trolley cabina")}</dt><dd>${dimStr(fare.extra.dims)}${fare.extra.kg ? " — max " + fare.extra.kg + " kg" : ""}</dd>`;
    if (fare.hold) h += `<dt>Bagaglio da stiva</dt><dd>max ${fare.hold.kg} kg${fare.hold.pieces ? " × " + fare.hold.pieces + " colli" : ""}</dd>`;
    else h += `<dt>Bagaglio da stiva</dt><dd>Non incluso — acquisto separato</dd>`;
    h += `</div>`;
    if (fare.cabin.note) h += `<p class="note">ℹ️ ${esc(fare.cabin.note)}</p>`;

    const luggages = trip.luggages || [{ type: trip.luggage || "trolley" }];
    const counts = { zaino: 0, trolley: 0, stiva: 0 };
    luggages.forEach(b => { const t = b.type || b; counts[t] = (counts[t] || 0) + 1; });

    const parts = [];
    if (counts.zaino) parts.push(`${counts.zaino} zaino/borsa`);
    if (counts.trolley) parts.push(`${counts.trolley} trolley cabina`);
    if (counts.stiva) parts.push(`${counts.stiva} bagagli${counts.stiva === 1 ? "o" : ""} da stiva`);
    const summaryText = parts.join(", ") || "nessun bagaglio";

    const wantsStiva = counts.stiva > 0;
    const wantsTrolley = counts.trolley > 0;

    if (wantsTrolley && !fare.extra && !fare.hold) {
      h += `<div class="alert warn">⚠️ Hai configurato: <b>${esc(summaryText)}</b> ma la tariffa <b>${esc(fare.label)}</b> include solo la borsa piccola sotto il sedile. Aggiungi la priorità o il bagaglio in stiva.</div>`;
    }
    if (wantsStiva && !fare.hold) {
      h += `<div class="alert warn">⚠️ La tariffa selezionata non include la stiva: acquistala prima del check-in (in aeroporto costa molto di più).</div>`;
    }
    return h;
  }

  /* Compare user bag against the allowance; orientation-independent. */
  function check(trip, l, w, hgt, kg) {
    if (noFlight(trip)) return `<div class="alert info">Nessun limite aereo da verificare.</div>`;
    const { fare } = rule(trip);
    const mine = [l, w, hgt].filter(Boolean).sort((a, b) => b - a);
    if (mine.length < 3) return `<div class="alert warn">Inserisci tutte e tre le dimensioni.</div>`;

    const test = (allow) => {
      const a = allow.slice().sort((x, y) => y - x);
      return mine.every((m, i) => m <= a[i]);
    };

    // Stessi slot (e stesso ordine per volume) usati dal set: evita di annunciare
    // "borsa piccola" per uno slot che nella tariffa è in realtà il trolley.
    for (const s of slots(trip).filter(s => s.dims)) {
      if (test(s.dims)) {
        const over = kg && s.kg && kg > s.kg;
        return `<div class="alert ${over ? "warn" : "ok"}">${over ? "⚠️" : "✅"} Rientra in: <b>${s.name}</b> (${dimStr(s.dims)})
          ${over ? `<br>Ma pesa ${kg} kg contro un limite di ${s.kg} kg: alleggerisci di ${(kg - s.kg).toFixed(1)} kg.` : (s.kg ? `<br>Limite peso ${s.kg} kg${kg ? ` — dichiarati ${kg} kg: ok.` : "."}` : "")}</div>`;
      }
    }
    if (fare.hold) return `<div class="alert warn">⚠️ Fuori misura per la cabina: va in stiva (max ${fare.hold.kg} kg).</div>`;
    return `<div class="alert danger">❌ Fuori misura per ogni franchigia inclusa nella tariffa. Serve l'acquisto di un bagaglio aggiuntivo.</div>`;
  }

  /* Slots included in the fare, smallest first (data order is not size order). */
  function slots(trip) {
    const { fare } = rule(trip);
    const out = [{ name: fare.cabin.label || "Borsa piccola", dims: fare.cabin.dims, kg: fare.cabin.kg, count: fare.cabin.pieces || 1 }];
    if (fare.extra) out.push({ name: fare.extra.label || "Trolley in cabina", dims: fare.extra.dims, kg: fare.extra.kg || 0, count: fare.extra.pieces || 1 });
    out.sort((a, b) => vol(a.dims) - vol(b.dims));
    if (fare.hold) out.push({ name: "Bagaglio da stiva", dims: null, kg: fare.hold.kg, count: fare.hold.pieces || 1 });
    return out;
  }

  const vol = d => d ? d[0] * d[1] * d[2] : Infinity;

  /* Tipo del collo: quello scelto dall'utente, altrimenti dedotto dalle misure. */
  function bagType(b) {
    if (b.type) return b.type;
    const d = [b.l, b.w, b.h].sort((x, y) => y - x);
    if (d[0] > 56 || vol(d) > 55 * 40 * 25) return "stiva";
    if (d[0] <= 45 && d[1] <= 36 && d[2] <= 20) return "zaino";
    return "trolley";
  }
  const fits = (bag, dims) => {
    if (!dims) return true; // hold: no practical size limit for a normal suitcase
    const m = [bag.l, bag.w, bag.h].sort((a, b) => b - a);
    const a = dims.slice().sort((x, y) => y - x);
    return m.every((v, i) => v <= a[i]);
  };

  /* Assign every bag of the set to an included slot: smallest bag into the smallest slot that fits. */
  function fitSet(trip, bags) {
    const av = slots(trip).map(s => Object.assign({}, s, { left: s.count }));
    const sorted = bags.slice().sort((a, b) => vol([a.l, a.w, a.h]) - vol([b.l, b.w, b.h]));
    const rows = [];
    sorted.forEach(bag => {
      const slot = av.find(s => s.left > 0 && fits(bag, s.dims));
      if (slot) {
        slot.left--;
        const over = bag.kg && slot.kg && bag.kg > slot.kg;
        rows.push({ bag, slot: slot.name, ok: !over, msg: over ? `${bag.kg} kg contro un limite di ${slot.kg} kg: togli ${(bag.kg - slot.kg).toFixed(1)} kg` : (slot.kg ? `entro i ${slot.kg} kg` : "ok") });
      } else {
        rows.push({ bag, slot: null, ok: false, msg: "nessuna franchigia libera per questo collo: va acquistato a parte" });
      }
    });
    return { rows, totalKg: bags.reduce((a, b) => a + (b.kg || 0), 0) };
  }

  const ICON = { zaino: "🎒 zaino", trolley: "🧳 trolley", stiva: "📦 stiva" };

  function setCard(trip, bags) {
    if (!bags.length) return `<p class="note">Nessun bagaglio nel set. Aggiungi i colli che porti (zaino, trolley, valigia) per verificarli insieme.</p>`;
    const tot = bags.reduce((a, b) => a + (b.kg || 0), 0);
    if (noFlight(trip)) {
      return `<div class="items">${bags.map(b => `
        <div class="item" data-bag="${b.id}">
          <span class="nm">${esc(b.name)} <span class="badge">${ICON[bagType(b)]}</span><small>${b.l}×${b.w}×${b.h} cm${b.kg ? " · " + b.kg + " kg" : ""}</small></span>
          <button class="x" data-edit-bag="${b.id}" title="Modifica">✏️</button>
          <button class="x" title="Rimuovi">✕</button>
        </div>`).join("")}</div>
        <p class="note">Totale: ${bags.length} coll${bags.length === 1 ? "o" : "i"}${tot ? ` · ${tot.toFixed(1)} kg` : ""}. Nessun limite aereo da rispettare.</p>`;
    }
    const { rows } = fitSet(trip, bags);
    const bad = rows.filter(r => !r.ok).length;
    return `<div class="items">${rows.map(r => `
        <div class="item" data-bag="${r.bag.id}">
          <span class="nm">${r.ok ? "✅" : "⚠️"} ${esc(r.bag.name)} <span class="badge">${ICON[bagType(r.bag)]}</span>
            <small>${r.bag.l}×${r.bag.w}×${r.bag.h} cm${r.bag.kg ? " · " + r.bag.kg + " kg" : ""} → ${r.slot ? esc(r.slot) + ", " + esc(r.msg) : esc(r.msg)}</small></span>
          <button class="x" data-edit-bag="${r.bag.id}" title="Modifica">✏️</button>
          <button class="x" title="Rimuovi">✕</button>
        </div>`).join("")}</div>
      <div class="alert ${bad ? "warn" : "ok"}">${bad ? `⚠️ ${bad} coll${bad === 1 ? "o" : "i"} fuori franchigia` : "✅ Tutto il set rientra nella tariffa"} · ${bags.length} coll${bags.length === 1 ? "o" : "i"}${tot ? ` · ${tot.toFixed(1)} kg totali` : ""}</div>`;
  }

  function liquids(trip) {
    if (noFlight(trip)) return `<div class="alert info">Nessuna restrizione sui liquidi.</div>`;
    const { fare } = rule(trip);
    const luggages = trip.luggages || [{ type: trip.luggage || "trolley" }];
    // Si segue il bagaglio dichiarato dall'utente, come fa la checklist: se la tariffa
    // non include la stiva, l'avviso di acquisto è già nella scheda franchigie.
    const holdOnly = luggages.some(b => (b.type || b) === "stiva");
    let h = `<ul class="note" style="padding-left:18px;line-height:1.7">
      <li>Contenitori da <b>max 100 ml</b> ciascuno (conta la capienza stampata, non il contenuto residuo).</li>
      <li>Tutti dentro <b>una sola busta trasparente richiudibile da 1 litro</b> (circa 20×20 cm), una per passeggero.</li>
      <li>Da estrarre e mostrare separatamente al controllo.</li>
      <li>Esenti: farmaci con ricetta, alimenti per neonati, liquidi acquistati dopo i controlli (sigillati con scontrino).</li>
      <li>Vietati in stiva: powerbank, sigarette elettroniche, batterie al litio sfuse.</li>
    </ul>`;
    if (holdOnly) h += `<div class="alert ok">✅ Hai il bagaglio da stiva: sposta lì i formati grandi e tieni a mano solo l'essenziale.</div>`;
    else h += `<div class="alert warn">⚠️ Senza stiva tutti i liquidi devono rispettare il limite di 100 ml. Valuta i formati solidi (shampoo e deodorante stick).</div>`;
    return h;
  }

  return { card, check, liquids, rule, slots, fitSet, setCard, bagType };
})();
