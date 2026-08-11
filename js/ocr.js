/* ocr.js — text parser for travel documents.
   Works on text pasted from an OCR app, a confirmation email or a PDF copy-paste.
   Extracts: MRZ (passport/ID), PNR, flight number, route, dates, times, gate, seat, contacts. */

const OCR = (function () {

  const MONTHS = { gen:1, feb:2, mar:3, apr:4, mag:5, giu:6, lug:7, ago:8, set:9, ott:10, nov:11, dic:12,
                   jan:1, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, dec:12 };

  const pad = n => String(n).padStart(2, "0");

  /* Two-digit year in MRZ: >  current year + 15 → past century (birth), else future (expiry). */
  function mrzDate(yy, mm, dd, kind) {
    const y = parseInt(yy, 10), cur = new Date().getFullYear() % 100;
    let full;
    if (kind === "birth") full = y > cur ? 1900 + y : 2000 + y;
    else full = y < cur - 15 ? 2100 + y : 2000 + y;
    return `${full}-${mm}-${dd}`;
  }

  function normDate(s) {
    if (!s) return "";
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (m) {
      let y = m[3].length === 2 ? "20" + m[3] : m[3];
      let p1 = parseInt(m[1], 10), p2 = parseInt(m[2], 10);
      if (p2 > 12 && p1 <= 12) return `${y}-${pad(p1)}-${pad(p2)}`;
      return `${y}-${pad(p2)}-${pad(p1)}`;
    }
    m = s.match(/(\d{1,2})\s+([a-zA-Zàèéìòù]{3})[a-zA-Zàèéìòù.]*\s+(\d{4})/);
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
    return "";
  }

  function parse(text) {
    let t = (text || "").replace(/\r/g, "").replace(/[|~§¢¥]+/g, " ");
    t = t.replace(/[ \t]+/g, " ");
    const U = t.toUpperCase();
    const f = {};

    /* --- MRZ: parsed line by line, OCR output rarely keeps exact 44-char lines --- */
    const allLines = U.split("\n").map(l => l.replace(/\s+/g, "").trim()).filter(Boolean);
    const lines = allLines.filter(l => /^[A-Z0-9<]{25,}$/.test(l) && (l.match(/</g) || []).length >= 2);

    /* Name line (TD3 line 1 / TD1 line 3): P<ITAROSSI<<MARIO<<<<< */
    for (const l of lines) {
      const nm = l.match(/^([A-Z]{1,2})<([A-Z]{3})([A-Z<]+)$/);
      if (!nm) continue;
      const parts = nm[3].split("<<");
      f.surname = (parts[0] || "").replace(/</g, " ").trim();
      f.name = (parts[1] || "").replace(/</g, " ").trim();
      f.nationality = nm[2];
      f.docType = nm[1][0] === "P" ? "Passaporto" : "Carta d'identità";
      break;
    }

    /* TD1 name line has no country prefix: ROSSI<<MARIO<<<<< */
    if (!f.surname) {
      for (const l of lines) {
        const nm = l.match(/^([A-Z]{2,})<<([A-Z][A-Z<]+)$/);
        if (!nm) continue;
        f.surname = nm[1];
        f.name = nm[2].replace(/</g, " ").trim();
        break;
      }
    }

    /* Data line: docNumber(9) [check] nationality(3) birth(6) [check] sex expiry(6). */
    for (const l of lines) {
      const md = l.match(/^([A-Z0-9<]{9})[0-9<]?([A-Z<]{3})(\d{6})[0-9<]?([MFX<])(\d{6})/);
      if (!md) continue;
      f.docNumber = md[1].replace(/</g, "");
      f.nationality = f.nationality || md[2].replace(/</g, "");
      f.birth = mrzDate(md[3].slice(0, 2), md[3].slice(2, 4), md[3].slice(4, 6), "birth");
      f.sex = md[4] === "<" ? "" : md[4];
      f.expiry = mrzDate(md[5].slice(0, 2), md[5].slice(2, 4), md[5].slice(4, 6), "exp");
      f.docType = f.docType || "Passaporto";
      break;
    }

    /* TD1 (ID card) data line: birth(6) [check] sex expiry(6) nationality(3) */
    if (!f.expiry) {
      for (const l of lines) {
        const t1 = l.match(/^(\d{6})[0-9<]?([MFX<])(\d{6})[0-9<]?([A-Z<]{3})/);
        if (!t1) continue;
        f.birth = mrzDate(t1[1].slice(0, 2), t1[1].slice(2, 4), t1[1].slice(4, 6), "birth");
        f.sex = t1[2] === "<" ? "" : t1[2];
        f.expiry = mrzDate(t1[3].slice(0, 2), t1[3].slice(2, 4), t1[3].slice(4, 6), "exp");
        f.nationality = f.nationality || t1[4].replace(/</g, "");
        f.docType = f.docType || "Carta d'identità";
        break;
      }
    }
    if (!f.docNumber) {
      const idLine = lines.find(l => /^I[A-Z<]{2}[A-Z]{3}[A-Z0-9<]{9}/.test(l));
      if (idLine) { f.docNumber = idLine.slice(5, 14).replace(/</g, ""); f.docType = f.docType || "Carta d'identità"; }
    }

    /* --- Labelled fields (email / voucher / ticket) --- */
    const grab = (re, i) => { const m = t.match(re); return m ? (m[i || 1] || "").trim() : ""; };

    f.docNumber = f.docNumber || grab(/(?:passaporto|documento|carta d['’]identit[àa]|document(?:\s*no)?)[^\w]{0,12}([A-Z]{1,2}\s?\d{5,9}|[A-Z0-9]{6,10})/i);
    const expLabel = grab(/(?:scadenz\w*|valid[oa]\s+fino|expiry|expires?|date of expiry)[^\d]{0,15}([\d]{1,4}[\/.\-\s][\w]{1,9}[\/.\-\s][\d]{2,4})/i);
    if (expLabel && !f.expiry) f.expiry = normDate(expLabel);

    f.pnr = (grab(/(?:pnr|codice\s+(?:di\s+)?prenotazione|booking\s+(?:ref\w*|code)|reservation\s+code|confirmation\s+(?:number|code))[^A-Z0-9]{0,12}([A-Z0-9]{5,8})/i) || "").toUpperCase();
    f.ticket = grab(/(?:biglietto|ticket\s*(?:no|number)?)[^A-Z0-9]{0,10}(\d{3}[- ]?\d{10})/i);

    /* Flight number only in a flight context */
    const flightCtx = /\b(VOLO|FLIGHT|BOARDING|IMBARCO|CARTA D'IMBARCO|VUELO)\b/.test(U);
    f.flight = grab(/(?:volo|flight|vuelo)[^A-Z0-9]{0,8}([A-Z0-9]{2}\s?\d{2,4})/i).replace(/\s/g, "").toUpperCase();
    if (!f.flight && flightCtx) {
      const fl = U.match(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b(?=[^\d]|$)/);
      if (fl) f.flight = fl[1] + fl[2];
    }

    // Su una foto il trattino fra i due scali esce spesso come punto o freccia storta:
    // i separatori larghi si accettano solo se il documento è già identificato come volo.
    const route = U.match(flightCtx
      ? /\b([A-Z]{3})\s*(?:[-–—>→»=.·]+|TO|\/)\s*([A-Z]{3})\b/
      : /\b([A-Z]{3})\s*(?:[-–—>→]|TO|\/)\s*([A-Z]{3})\b/);
    if (route && !/CHECK|ROOM|SUITE/.test(route[0])) { f.from = route[1]; f.to = route[2]; }

    f.gate = grab(/gate[^A-Z0-9]{0,6}([A-Z]?\d{1,3}[A-Z]?)/i).toUpperCase();
    f.seat = grab(/(?:posto|seat)[^A-Z0-9]{0,6}(\d{1,2}\s?[A-K])/i).replace(/\s/g, "").toUpperCase();

    const times = (t.match(/\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/gi) || []).map(x => x.replace(/[.hH]/, ":"));
    const isStay = /check[\s\-]?in|check[\s\-]?out/i.test(t);
    if (times.length && !isStay) { f.timeDep = times[0]; if (times[1]) f.timeArr = times[1]; }
    if (times.length && isStay) { f.checkinTime = times[0]; if (times[1]) f.checkoutTime = times[1]; }

    const dates = [];
    const dre = /(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[a-zA-Zàèéìòù]{3,9}\s+\d{4})/g;
    let m; while ((m = dre.exec(t))) { const d = normDate(m[1]); if (d) dates.push(d); }
    const ci = normDate(grab(/check[\s\-]?in[^\d]{0,20}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i));
    const co = normDate(grab(/check[\s\-]?out[^\d]{0,20}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i));
    if (ci) f.checkin = ci;
    if (co) f.checkout = co;
    if (!f.checkin && dates.length) f.dateMain = dates[0];
    if (dates.length > 1) f.dateEnd = dates[dates.length - 1];

    // Email parsing with OCR typo tolerance (@ read as [at], (at), ©, space surrounding @)
    const emailMatch = grab(/([\w.+-]+\s*(?:@|\[at\]|\(at\)|©)\s*[\w.-]+\s*\.\s*[\w.]{2,6})/i);
    if (emailMatch) {
      f.email = emailMatch.replace(/\s+/g, "").replace("[at]", "@").replace("(at)", "@").replace("©", "@");
    }

    // Fiscal identifiers: estratti per primi e mascherati, altrimenti una partita IVA
    // di 11 cifre finisce nel telefono (comincia per 0 come i fissi italiani).
    f.vat = (grab(/(?:p(?:artita)?\.?\s*i\.?v\.?a\.?|vat(?:\s*(?:number|no|id))?|ust-?idnr)[^0-9A-Z]{0,12}([A-Z]{0,2}[\s.]?\d{8,13})/i) || "")
      .replace(/[\s.]/g, "").toUpperCase();
    f.taxCode = (grab(/(?:c\.?\s*f\.?|codice\s+fiscale|tax\s*code)[^0-9A-Z]{0,10}([A-Z0-9]{11,16})\b/i) || "").toUpperCase();
    const masked = t
      .replace(/(?:p(?:artita)?\.?\s*i\.?v\.?a\.?|vat|ust-?idnr|c\.?\s*f\.?|codice\s+fiscale|rea|iban|cap|c\/c|conto)[^\n]{0,40}/gi, " ")
      .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,28}\b/g, " ");   // IBAN sciolti

    // Phone parsing with label detection (TEL, PHONE, CELL, MOB, WHATSAPP, CONTATTI)
    const grabIn = (src, re, i) => { const m = src.match(re); return m ? (m[i || 1] || "").trim() : ""; };
    const phoneRaw =
      grabIn(masked, /(?:tel\w*|phone|cell\w*|mob\w*|contatt\w*|whatsapp|fax|t\.|m\.)\s*:?\s*(\+?[\d\s().\/-]{7,22})/i) ||
      grabIn(masked, /(\+\d{1,4}[\d\s().\/-]{6,18}\d)/) ||
      grabIn(masked, /\b(3\d{2}[-.\s]?\d{3}[-.\s]?\d{3,4})\b/) ||        // cellulari italiani
      grabIn(masked, /\b(0\d{1,3}[-.\s\/]\d{5,8})\b/);                    // fissi: serve un separatore
    if (phoneRaw) {
      const digits = phoneRaw.replace(/\D/g, "");
      // Una P.IVA/CF sfuggita alla maschera ha 11 cifre attaccate: un telefono no.
      const looksFiscal = /^\d{11}$/.test(phoneRaw.trim());
      if (digits.length >= 6 && digits.length <= 15 && !looksFiscal) {
        f.phone = phoneRaw.replace(/[^\d+]/g, " ").replace(/\s+/g, " ").trim();
      }
    }

    // Address: la via si tiene per intero, prefisso e numero civico compresi
    // ("Via Federico Fellini, 2" non deve diventare "Federico Fellini").
    const STREET = "via|viale|v\\.le|piazza|p\\.zza|piazzale|corso|c\\.so|largo|vicolo|strada|contrada|localit[àa]|rua|calle|avenida|avenue|av\\.|street|st\\.|road|rd\\.|boulevard|blvd\\.|square|sq\\.|plaza|place|rue|strasse|straße";
    f.address = grab(new RegExp(`(?:indirizzo|address|sede(?:\\s+legale)?)\\s*:?\\s*((?:${STREET})[^\\n]{3,70})`, "i"))
      || grab(new RegExp(`((?:${STREET})\\s+[^\\n]{3,70}?)(?=\\s*[-–|·]\\s|\\s*\\n|$)`, "i"));
    if (!f.address) {
      const addrLine = t.split("\n").map(l => l.trim())
        .find(l => new RegExp(`\\b(${STREET})\\b`, "i").test(l) || /\b\d{5}\b\s+[A-Za-z]/.test(l));
      if (addrLine && addrLine.length <= 80) f.address = addrLine;
    }
    if (f.address) f.address = f.address.replace(/\s*[,;]\s*$/, "").replace(/\s{2,}/g, " ").trim();

    // Name / Company / Property parsing
    f.passenger = f.name ? `${f.name} ${f.surname}` : grab(/(?:passeggero|passenger|nome|ospite|guest|name|persona|contatto)\s*:?\s*([A-ZÀ-Ù][\w'àèéìòù]+(?:[ \t]+[A-ZÀ-Ù][\w'àèéìòù]+){1,3})/i);
    f.property = grab(/((?:hotel|b&b|bnb|apartment|appartamento|residence|ostello|hostel|resort|ristorante|trattoria|osteria|pizzeria|bar|caffè|caffe|museo|museum|palazzo|castello|teatro|park|parco|ponte|miradouro|belvedere|duomo|basilica|chiesa|stazione|station|aeroporto|airport|terminal|studio|dott\.|prof\.|ing\.|azienda|società|company)\s+[^\n,.]{2,60}?)(?=\.|\,|[-–|]|\n|$)/i);
    if (!f.property) {
      const propLine = t.split("\n").map(l => l.trim()).find(l => /\b(hotel|b&b|bnb|resort|ristorante|trattoria|osteria|pizzeria|caffè|museo|museum|palazzo|castello|teatro|miradouro|belvedere|duomo|basilica|chiesa|stazione|aeroporto|studio|ncc|transfer|taxi|agency|agenzia)\b/i.test(l));
      if (propLine && propLine.length <= 60) f.property = propLine;
    }
    // Ragione sociale: forma giuridica esplicita, oppure la riga-logo di un biglietto
    // da visita (sigla tutta maiuscola, tipo "SHS"), oppure il soggetto della P.IVA.
    f.company = grab(/([A-ZÀ-Ù0-9][\w&.'’-]*(?:[ \t]+[A-ZÀ-Ù0-9][\w&.'’-]*)*[ \t]+(?:s\.?\s?r\.?\s?l\.?s?|s\.?\s?p\.?\s?a\.?|s\.?\s?n\.?\s?c\.?|s\.?\s?a\.?\s?s\.?|soc\.?\s+coop\.?|gmbh|ltd\.?|llc|inc\.?|b\.?v\.?|lda\.?))(?!\w)/i);
    if (!f.company) {
      const lines2 = t.split("\n").map(l => l.trim()).filter(Boolean);
      const acronym = lines2.find(l => /^[A-Z][A-Z0-9&.\- ]{1,14}$/.test(l) && !/^(VIA|TEL|FAX|EMAIL|MAIL|P\.?IVA|VAT|CAP|SRL|SPA)$/.test(l.replace(/[.\s]/g, "")));
      if (acronym) f.company = acronym.trim();
    }
    if (f.company && f.property && f.company.toLowerCase() === f.property.toLowerCase()) delete f.company;

    // Fallback title for business cards if no property found.
    // Skipped when the document already identified itself as a ticket/booking/ID:
    // there the first line is a header ("CARTA D'IMBARCO - ..."), not a venue name.
    const identified = f.flight || f.pnr || f.checkin || f.docNumber || f.ticket;
    if (!f.property && !f.name && !identified) {
      const titleCandidate = t.split("\n").map(l => l.trim()).find(l => l.length >= 3 && l.length <= 50 && !/@|\d{5,}/.test(l) && !/TEL|FAX|EMAIL|VIA|HTTP/i.test(l));
      if (titleCandidate) f.property = titleCandidate;
    }

    Object.keys(f).forEach(k => { if (!f[k]) delete f[k]; });
    return f;
  }

  const LABELS = {
    docType: "Tipo documento", docNumber: "Numero documento", passenger: "Intestatario",
    name: "Nome", surname: "Cognome", nationality: "Nazionalità", birth: "Data di nascita",
    sex: "Sesso", expiry: "Scadenza", pnr: "Codice PNR", ticket: "Nr. biglietto",
    flight: "Volo", from: "Partenza", to: "Arrivo", gate: "Gate", seat: "Posto",
    timeDep: "Orario partenza", timeArr: "Orario arrivo", dateMain: "Data", dateEnd: "Data fine",
    checkin: "Check-in", checkout: "Check-out", checkinTime: "Orario check-in",
    checkoutTime: "Orario check-out", property: "Struttura",
    company: "Azienda", vat: "Partita IVA", taxCode: "Codice fiscale",
    address: "Indirizzo", phone: "Telefono", email: "Email"
  };

  /* Passport/ID validity: many countries require 6 months of residual validity after return. */
  function expiryAlerts(docs, tripEnd) {
    const out = [];
    if (!tripEnd) return out;
    const end = new Date(tripEnd + "T00:00:00");
    docs.forEach(d => {
      const exp = d.fields && d.fields.expiry;
      if (!exp) return;
      const e = new Date(exp + "T00:00:00");
      if (isNaN(e)) return;
      const months = (e - end) / (1000 * 60 * 60 * 24 * 30.44);
      const label = `${d.title || d.type} (scad. ${exp.split("-").reverse().join("/")})`;
      if (e < end) out.push({ level: "danger", msg: `⛔ ${label}: scade <b>prima del rientro</b>. Documento inutilizzabile per questo viaggio.` });
      else if (months < 3) out.push({ level: "danger", msg: `⛔ ${label}: solo ${months.toFixed(1)} mesi di validità residua dopo il rientro. Molti Paesi ne richiedono 6: rinnova subito.` });
      else if (months < 6) out.push({ level: "warn", msg: `⚠️ ${label}: ${months.toFixed(1)} mesi di validità dopo il rientro, sotto la soglia dei 6 mesi richiesta da diversi Paesi extra-UE.` });
    });
    return out;
  }

  return { parse, LABELS, expiryAlerts, normDate };
})();
