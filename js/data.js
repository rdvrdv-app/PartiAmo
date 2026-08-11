/* data.js — static reference data: country info (plugs, voltage, emergency), airline baggage rules */

const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const itDate = s => s ? s.split("-").reverse().join("/") : "";
const isoLocal = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const mapsUrl = q => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);

const DATA = {};

const DOC_TYPES = {
  passaporto: {
    badge: "🛂 PASSAPORTO",
    titlePlaceholder: "Etichetta (es. Passaporto Mario Rossi)",
    expiryLabel: "📅 Scadenza passaporto (per avvisi validità)",
    notesPlaceholder: "Numero passaporto, nazionalità, note...",
    fileHint: "📷 Scansiona o carica la prima pagina con foto e MRZ"
  },
  carta_identita: {
    badge: "🪪 CARTA IDENTITÀ",
    titlePlaceholder: "Etichetta (es. Carta Identità Luigi)",
    expiryLabel: "📅 Scadenza carta d'identità",
    notesPlaceholder: "Numero documento, comune di rilascio, note...",
    fileHint: "📷 Carica foto fronte e retro della carta d'identità"
  },
  carta_imbarco: {
    badge: "✈️ CARTA D'IMBARCO",
    titlePlaceholder: "Etichetta (es. Volo Milano - Lisbona FR1234)",
    expiryLabel: "🛫 Data del volo / viaggio",
    notesPlaceholder: "Compagnia aerea, nr. volo, PNR, posto, gate...",
    fileHint: "🎫 Carica PDF del biglietto o foto della carta d'imbarco"
  },
  hotel: {
    badge: "🏨 PRENOTAZIONE HOTEL",
    titlePlaceholder: "Etichetta (es. Voucher Hotel Lisboa Central)",
    expiryLabel: "🏨 Data di Check-in",
    notesPlaceholder: "Codice prenotazione, indirizzo, orari check-in/out, note...",
    fileHint: "📄 Carica voucher di conferma prenotazione (PDF o foto)"
  },
  assicurazione: {
    badge: "🛡️ ASSICURAZIONE",
    titlePlaceholder: "Etichetta (es. Polizza Europ Assistance)",
    expiryLabel: "🛡️ Data fine copertura polizza",
    notesPlaceholder: "Numero polizza, contatti emergenza sanitaria, massimali...",
    fileHint: "📜 Carica attestato di polizza o tessera sanitaria"
  },
  patente: {
    badge: "🚗 PATENTE DI GUIDA",
    titlePlaceholder: "Etichetta (es. Patente Marco)",
    expiryLabel: "📅 Scadenza patente",
    notesPlaceholder: "Numero patente, categorie abilitate (A, B...), note...",
    fileHint: "📷 Carica foto fronte/retro della patente o permesso internazionale"
  },
  altro: {
    badge: "📄 DOCUMENTO",
    titlePlaceholder: "Etichetta (es. Ricevuta / Visto / Certificato)",
    expiryLabel: "📅 Data di riferimento / Scadenza",
    notesPlaceholder: "Note e dettagli del documento...",
    fileHint: "📎 Carica foto o file PDF"
  }
};


/* Country reference: plug types, voltage, emergency numbers, Schengen/EU flag.
   Keys are lowercase Italian country names. */
DATA.countries = {
  "italia":        { plugs: "C/F/L", volt: "230V", emg: "112", eu: true },
  "francia":       { plugs: "C/E",   volt: "230V", emg: "112", eu: true },
  "spagna":        { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "portogallo":    { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "germania":      { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "austria":       { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "svizzera":      { plugs: "C/J",   volt: "230V", emg: "112", eu: false },
  "paesi bassi":   { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "olanda":        { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "belgio":        { plugs: "C/E",   volt: "230V", emg: "112", eu: true },
  "grecia":        { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "croazia":       { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "slovenia":      { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "ungheria":      { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "polonia":       { plugs: "C/E",   volt: "230V", emg: "112", eu: true },
  "repubblica ceca": { plugs: "C/E", volt: "230V", emg: "112", eu: true },
  "danimarca":     { plugs: "C/E/F/K", volt: "230V", emg: "112", eu: true },
  "svezia":        { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "norvegia":      { plugs: "C/F",   volt: "230V", emg: "112", eu: false },
  "finlandia":     { plugs: "C/F",   volt: "230V", emg: "112", eu: true },
  "islanda":       { plugs: "C/F",   volt: "230V", emg: "112", eu: false },
  "irlanda":       { plugs: "G",     volt: "230V", emg: "112 / 999", eu: true },
  "regno unito":   { plugs: "G",     volt: "230V", emg: "999 / 112", eu: false },
  "malta":         { plugs: "G",     volt: "230V", emg: "112", eu: true },
  "cipro":         { plugs: "G",     volt: "230V", emg: "112", eu: true },
  "albania":       { plugs: "C/F",   volt: "230V", emg: "112", eu: false },
  "turchia":       { plugs: "C/F",   volt: "230V", emg: "112", eu: false },
  "marocco":       { plugs: "C/E",   volt: "220V", emg: "19 (polizia) / 15 (ambulanza)", eu: false },
  "egitto":        { plugs: "C/F",   volt: "220V", emg: "122 / 123", eu: false },
  "tunisia":       { plugs: "C/E",   volt: "230V", emg: "197 / 190", eu: false },
  "stati uniti":   { plugs: "A/B",   volt: "120V", emg: "911", eu: false },
  "usa":           { plugs: "A/B",   volt: "120V", emg: "911", eu: false },
  "canada":        { plugs: "A/B",   volt: "120V", emg: "911", eu: false },
  "messico":       { plugs: "A/B",   volt: "127V", emg: "911", eu: false },
  "brasile":       { plugs: "C/N",   volt: "127/220V", emg: "190 / 192", eu: false },
  "argentina":     { plugs: "C/I",   volt: "220V", emg: "911", eu: false },
  "giappone":      { plugs: "A/B",   volt: "100V", emg: "110 (polizia) / 119 (ambulanza)", eu: false },
  "cina":          { plugs: "A/C/I", volt: "220V", emg: "110 / 120", eu: false },
  "thailandia":    { plugs: "A/B/C", volt: "220V", emg: "191 / 1669", eu: false },
  "vietnam":       { plugs: "A/C/F", volt: "220V", emg: "113 / 115", eu: false },
  "indonesia":     { plugs: "C/F",   volt: "230V", emg: "112", eu: false },
  "india":         { plugs: "C/D/M", volt: "230V", emg: "112", eu: false },
  "emirati arabi uniti": { plugs: "G", volt: "230V", emg: "999 / 998", eu: false },
  "australia":     { plugs: "I",     volt: "230V", emg: "000", eu: false },
  "nuova zelanda": { plugs: "I",     volt: "230V", emg: "111", eu: false },
  "sudafrica":     { plugs: "D/M/N", volt: "230V", emg: "10111 / 10177", eu: false },
  "kenya":         { plugs: "G",     volt: "240V", emg: "999 / 112", eu: false }
};

DATA.defaultCountry = { plugs: "verifica il tipo di presa locale", volt: "?", emg: "112 (numero europeo)", eu: false };

DATA.countryInfo = function (name) {
  if (!name) return null;
  return DATA.countries[name.trim().toLowerCase()] || null;
};

/* Airline hand/hold baggage rules. Reference values — always re-check on the carrier site. */
DATA.airlines = {
  nessuna: {
    label: "Nessuna (non volo)",
    fares: { nessuna: { label: "—", cabin: { dims: [0, 0, 0], kg: 0 } } }
  },
  ryanair: {
    label: "Ryanair",
    fares: {
      basic:    { label: "Basic",             cabin: { dims: [40, 25, 20], kg: 10, note: "Solo borsa piccola sotto il sedile" } },
      regular:  { label: "Regular / Priority", cabin: { dims: [40, 25, 20], kg: 10 }, extra: { dims: [55, 40, 20], kg: 10, label: "Trolley 10 kg in cappelliera" } },
      plus:     { label: "Plus / Flexi",      cabin: { dims: [40, 25, 20], kg: 10 }, extra: { dims: [55, 40, 20], kg: 10 }, hold: { kg: 20 } }
    }
  },
  easyjet: {
    label: "easyJet",
    fares: {
      standard: { label: "Standard",  cabin: { dims: [45, 36, 20], kg: 15, note: "Sotto il sedile" } },
      plus:     { label: "Plus / Up front", cabin: { dims: [45, 36, 20], kg: 15 }, extra: { dims: [56, 45, 25], kg: 15, label: "Bagaglio grande in cabina" } },
      hold:     { label: "Con stiva", cabin: { dims: [45, 36, 20], kg: 15 }, hold: { kg: 23 } }
    }
  },
  wizzair: {
    label: "Wizz Air",
    fares: {
      basic:    { label: "Basic",     cabin: { dims: [40, 30, 20], kg: 10 } },
      priority: { label: "WIZZ Priority", cabin: { dims: [40, 30, 20], kg: 10 }, extra: { dims: [55, 40, 23], kg: 10 } },
      hold:     { label: "Con stiva", cabin: { dims: [40, 30, 20], kg: 10 }, hold: { kg: 20 } }
    }
  },
  vueling: {
    label: "Vueling",
    fares: {
      basic:    { label: "Basic",     cabin: { dims: [40, 30, 20], kg: 10 } },
      optima:   { label: "Optima",    cabin: { dims: [40, 30, 20], kg: 10 }, extra: { dims: [55, 40, 20], kg: 10 } },
      hold:     { label: "Con stiva", cabin: { dims: [40, 30, 20], kg: 10 }, hold: { kg: 23 } }
    }
  },
  ita: {
    label: "ITA Airways",
    fares: {
      economy:  { label: "Economy Light", cabin: { dims: [55, 35, 25], kg: 8, label: "Trolley in cabina" }, extra: { dims: [45, 36, 20], kg: 0, label: "Borsa piccola" } },
      classic:  { label: "Economy Classic", cabin: { dims: [55, 35, 25], kg: 8, label: "Trolley in cabina" }, hold: { kg: 23 } },
      business: { label: "Business",   cabin: { dims: [55, 35, 25], kg: 8, label: "Trolley in cabina" }, hold: { kg: 32, pieces: 2 } }
    }
  },
  lufthansa: {
    label: "Lufthansa",
    fares: {
      light:    { label: "Economy Light",   cabin: { dims: [55, 40, 23], kg: 8, label: "Trolley in cabina" } },
      classic:  { label: "Economy Classic", cabin: { dims: [55, 40, 23], kg: 8, label: "Trolley in cabina" }, hold: { kg: 23 } },
      business: { label: "Business",        cabin: { dims: [55, 40, 23], kg: 8, label: "Trolley in cabina", pieces: 2 }, hold: { kg: 32, pieces: 2 } }
    }
  },
  airfrance: {
    label: "Air France",
    fares: {
      light:    { label: "Light",   cabin: { dims: [55, 35, 25], kg: 12, label: "Trolley in cabina" } },
      standard: { label: "Standard", cabin: { dims: [55, 35, 25], kg: 12, label: "Trolley in cabina" }, hold: { kg: 23 } },
      business: { label: "Business", cabin: { dims: [55, 35, 25], kg: 12, label: "Trolley in cabina", pieces: 2 }, hold: { kg: 32, pieces: 2 } }
    }
  },
  ba: {
    label: "British Airways",
    fares: {
      basic:    { label: "Basic",    cabin: { dims: [56, 45, 25], kg: 23, label: "Trolley in cabina" }, extra: { dims: [40, 30, 15], kg: 23, label: "Borsa piccola" } },
      standard: { label: "Con stiva", cabin: { dims: [56, 45, 25], kg: 23, label: "Trolley in cabina" }, hold: { kg: 23 } }
    }
  },
  iberia: {
    label: "Iberia",
    fares: {
      basic:    { label: "Basic",    cabin: { dims: [56, 40, 25], kg: 10, label: "Trolley in cabina" } },
      optima:   { label: "Optima",   cabin: { dims: [56, 40, 25], kg: 10, label: "Trolley in cabina" }, hold: { kg: 23 } }
    }
  },
  turkish: {
    label: "Turkish Airlines",
    fares: {
      eco:      { label: "Economy",  cabin: { dims: [55, 40, 23], kg: 8, label: "Trolley in cabina" }, hold: { kg: 23 } },
      business: { label: "Business", cabin: { dims: [55, 40, 23], kg: 8, label: "Trolley in cabina", pieces: 2 }, hold: { kg: 32, pieces: 2 } }
    }
  },
  emirates: {
    label: "Emirates",
    fares: {
      eco:      { label: "Economy",  cabin: { dims: [55, 38, 22], kg: 7, label: "Trolley in cabina" }, hold: { kg: 25 } },
      business: { label: "Business", cabin: { dims: [55, 38, 22], kg: 7, label: "Trolley in cabina", pieces: 2 }, hold: { kg: 35, pieces: 2 } }
    }
  },
  altra: {
    label: "Altra compagnia",
    fares: {
      generico: { label: "Standard IATA", cabin: { dims: [55, 40, 20], kg: 8, label: "Trolley in cabina", note: "Riferimento generico IATA: verifica sul sito" } }
    }
  }
};

/* WMO weather codes → icon + label (Open-Meteo) */
DATA.wmo = {
  0: ["☀️", "Sereno"], 1: ["🌤️", "Poco nuvoloso"], 2: ["⛅", "Parz. nuvoloso"], 3: ["☁️", "Coperto"],
  45: ["🌫️", "Nebbia"], 48: ["🌫️", "Nebbia gelata"],
  51: ["🌦️", "Pioviggine"], 53: ["🌦️", "Pioviggine"], 55: ["🌦️", "Pioviggine forte"],
  61: ["🌧️", "Pioggia debole"], 63: ["🌧️", "Pioggia"], 65: ["🌧️", "Pioggia forte"],
  66: ["🌧️", "Pioggia gelata"], 67: ["🌧️", "Pioggia gelata"],
  71: ["🌨️", "Neve debole"], 73: ["🌨️", "Neve"], 75: ["❄️", "Neve forte"], 77: ["❄️", "Nevischio"],
  80: ["🌦️", "Rovesci"], 81: ["🌧️", "Rovesci"], 82: ["⛈️", "Rovesci forti"],
  85: ["🌨️", "Rovesci nevosi"], 86: ["❄️", "Rovesci nevosi"],
  95: ["⛈️", "Temporale"], 96: ["⛈️", "Temporale/grandine"], 99: ["⛈️", "Temporale forte"]
};
DATA.wmoInfo = function (c) { return DATA.wmo[c] || ["🌡️", "—"]; };
