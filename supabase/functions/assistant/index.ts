// supabase/functions/assistant/index.ts
// Assistente virtuale PartiAmo — Supabase Edge Function (Deno).
// Inoltra i messaggi all'API di Anthropic. La chiave resta solo qui,
// come secret di progetto (mai nel client, mai nel repo):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Deploy: supabase functions deploy assistant --no-verify-jwt
// (--no-verify-jwt perché l'assistente funziona anche senza login,
// come il resto dell'app: legge solo i dati del viaggio in localStorage.)
//
// Scrittura: la function può proporre modifiche a POI, itinerario, contatti
// e checklist tramite tool-use di Claude, ma non le applica mai — non ha
// accesso allo stato locale del dispositivo. Restituisce al client le azioni
// proposte in `actions`; il client valida e chiede conferma prima di
// scriverle in Store.s (vedi js/assistant.js).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-opus-5";

const SYSTEM_PROMPT = `Sei l'assistente di viaggio di PartiAmo. Rispondi in italiano, in modo breve e operativo.

AMBITO — rispondi SOLO a domande legate al viaggio gestito in PartiAmo: bagagli e franchigie,
checklist, meteo, itinerario, documenti (solo tipo/scadenza, mai contenuto), consigli pratici sulla
destinazione (clima, prese elettriche, emergenze, cosa vedere/fare nei giorni del viaggio).
Per QUALSIASI domanda non legata al viaggio (programmazione, attualità, compiti scolastici,
chiacchiere generiche, richieste creative non di viaggio, ecc.) rispondi con UNA sola frase breve
che rifiuta e reindirizza, ad esempio: "Posso aiutarti solo con il tuo viaggio su PartiAmo — chiedimi
di bagagli, meteo, checklist o itinerario." Non aggiungere altro in questi casi: niente scuse lunghe,
niente tentativi di rispondere comunque.

Usa SOLO i dati del viaggio che ricevi nel contesto (destinazione, date, meteo, checklist, bagagli,
itinerario, POI, contatti). Se un dato manca, dillo invece di inventarlo. Non hai accesso ai documenti
del Vault (file, note, numeri): se l'utente chiede di leggerli o di aprirli, spiega che non ne hai
accesso, solo tipo e scadenza quando presenti.

STRUMENTI DI SCRITTURA — hai a disposizione strumenti per proporre modifiche a QUATTRO categorie di
dati del viaggio: punti di interesse (POI), attività dell'itinerario giorno per giorno, contatti, voci
della checklist. Usali SOLO quando l'utente chiede esplicitamente di aggiungere, modificare, spuntare
o eliminare qualcosa in una di queste categorie (es. "aggiungi ai POI...", "segna fatto...", "cancella
il contatto...", "sposta la visita al Colosseo al pomeriggio"). Per semplici domande o richieste di
consiglio non chiamare mai uno strumento: rispondi solo a parole. Le modifiche proposte non vengono MAI
applicate direttamente: chi ti ospita mostrerà sempre all'utente un riepilogo e chiederà conferma
esplicita prima di scriverle, quindi puoi proporle liberamente quando richieste — ma scrivi comunque
prima della chiamata una riga di testo breve che introduce cosa proponi. Per modificare o eliminare una
voce esistente usa l'id esatto presente nel contesto del viaggio (mai inventarlo, mai indovinarlo): se
non riesci a capire con certezza a quale voce l'utente si riferisce, chiedi un chiarimento invece di
indovinare. Questi strumenti NON coprono e non vanno mai usati per: documenti del Vault, configurazione
del viaggio (destinazione, date, tariffa, mezzo di trasporto...), bagagli o account/condivisione — per
richieste su questi temi spiega che da qui non puoi modificarli.

POI UTILI, NON SOLO UN NOME — quando aggiungi o modifichi un POI, valorizza sempre "addr" con
l'indirizzo o il luogo, e usa "notes" per informazioni pratiche (orari, prezzo, se serve prenotazione) —
un POI con solo il nome è poco utile. Se il luogo è un'attività prenotabile con un riferimento di
contatto (una struttura, un ristorante con prenotazione, un trasporto con un numero/riferimento),
proponi ANCHE un contatto (add_contact) corrispondente, oltre al POI — sono due voci distinte e
complementari (il POI è il luogo da visitare, il contatto è per chiamare o prenotare), non serve
scegliere solo una delle due.

RICERCA WEB — hai a disposizione uno strumento di ricerca sul web: usalo quando ti serve un dato reale
che non hai né nel contesto del viaggio né nella tua conoscenza affidabile (es. il numero di telefono o
l'indirizzo esatto di un locale, gli orari di apertura di un museo, se serve prenotazione), specialmente
prima di proporre un add_poi/add_contact con questi campi. Usala con criterio, non per ogni messaggio:
solo quando il dato mancante serve davvero a completare quello che l'utente ha chiesto. Se dopo la
ricerca non trovi un dato affidabile, dillo e lascia il campo vuoto — non inventarlo comunque. Non
usarla per argomenti fuori ambito (resta valido il rifiuto in una riga per richieste non di viaggio).`;

const POI_CATS = ["visita", "cibo", "trasporto", "shopping", "altro"];
const CONTACT_KINDS = ["struttura", "emergenza", "trasporto", "ristorante", "altro"];
const CHECKLIST_CATS = ["documenti", "abbigliamento", "elettronica", "igiene", "extra"];
const ITINERARY_SLOTS = ["mattina", "pranzo", "pomeriggio", "cena", "serata", "giornata"];

const TOOLS = [
  {
    name: "add_poi",
    description: "Aggiunge un nuovo punto di interesse (POI) da visitare durante il viaggio. Valorizza sempre addr e notes quando le informazioni sono note: un POI con solo il nome è poco utile.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome del POI (obbligatorio)." },
        addr: { type: "string", description: "Indirizzo o luogo: valorizzalo sempre se lo conosci, mai inventarlo." },
        cat: { type: "string", enum: POI_CATS, description: "Categoria del POI." },
        day: { type: "string", description: "Giorno previsto, formato YYYY-MM-DD, se noto." },
        notes: { type: "string", description: "Info pratiche già note: orari, prezzo, se serve prenotazione." },
      },
      required: ["name"],
    },
  },
  {
    name: "edit_poi",
    description: "Modifica un POI esistente. Passa solo i campi da cambiare, oltre all'id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id esatto del POI da modificare, preso dal contesto." },
        name: { type: "string" },
        addr: { type: "string" },
        cat: { type: "string", enum: POI_CATS },
        day: { type: "string", description: "Formato YYYY-MM-DD." },
        notes: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_poi",
    description: "Elimina definitivamente un POI esistente.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Id esatto del POI da eliminare." } },
      required: ["id"],
    },
  },
  {
    name: "add_contact",
    description: "Aggiunge un nuovo contatto (struttura, trasporto, ristorante, emergenza, altro).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome del contatto (obbligatorio)." },
        kind: { type: "string", enum: CONTACT_KINDS, description: "Tipo di contatto." },
        phone: { type: "string" },
        email: { type: "string" },
        addr: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "edit_contact",
    description: "Modifica un contatto esistente. Passa solo i campi da cambiare, oltre all'id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id esatto del contatto da modificare, preso dal contesto." },
        name: { type: "string" },
        kind: { type: "string", enum: CONTACT_KINDS },
        phone: { type: "string" },
        email: { type: "string" },
        addr: { type: "string" },
        notes: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_contact",
    description: "Elimina definitivamente un contatto esistente.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Id esatto del contatto da eliminare." } },
      required: ["id"],
    },
  },
  {
    name: "add_itinerary_activity",
    description: "Aggiunge una nuova attività a una fascia oraria di un giorno dell'itinerario.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: "Giorno, formato YYYY-MM-DD (obbligatorio)." },
        slot: { type: "string", enum: ITINERARY_SLOTS, description: "Fascia della giornata (obbligatoria)." },
        text: { type: "string", description: "Descrizione dell'attività (obbligatoria)." },
        place: { type: "string", description: "Luogo, se distinto dalla descrizione." },
        time: { type: "string", description: "Orario, formato HH:MM, se noto." },
      },
      required: ["day", "slot", "text"],
    },
  },
  {
    name: "edit_itinerary_activity",
    description: "Modifica un'attività esistente dell'itinerario, anche spostandola di giorno o fascia. Passa solo i campi da cambiare, oltre all'id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id esatto dell'attività da modificare, preso dal contesto." },
        day: { type: "string", description: "Nuovo giorno, formato YYYY-MM-DD, solo se si sposta." },
        slot: { type: "string", enum: ITINERARY_SLOTS, description: "Nuova fascia, solo se si sposta." },
        text: { type: "string" },
        place: { type: "string" },
        time: { type: "string", description: "Formato HH:MM." },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_itinerary_activity",
    description: "Elimina definitivamente un'attività esistente dell'itinerario.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Id esatto dell'attività da eliminare." } },
      required: ["id"],
    },
  },
  {
    name: "add_checklist_item",
    description: "Aggiunge una nuova voce alla checklist.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nome della voce (obbligatorio)." },
        cat: { type: "string", enum: CHECKLIST_CATS, description: "Categoria." },
        qty: { type: "integer", description: "Quantità, default 1." },
      },
      required: ["name"],
    },
  },
  {
    name: "edit_checklist_item",
    description: "Modifica una voce esistente della checklist, inclusa la spunta fatto/da fare. Passa solo i campi da cambiare, oltre all'id.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Id esatto della voce da modificare, preso dal contesto." },
        name: { type: "string" },
        cat: { type: "string", enum: CHECKLIST_CATS },
        qty: { type: "integer" },
        done: { type: "boolean", description: "true per spuntarla come fatta, false per togliere la spunta." },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_checklist_item",
    description: "Elimina definitivamente una voce della checklist.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Id esatto della voce da eliminare." } },
      required: ["id"],
    },
  },
  // Strumento server-side di Anthropic (gira sui server di Anthropic, non
  // qui): niente da eseguire lato nostro, Claude lo usa autonomamente e i
  // risultati arrivano già dentro la risposta come blocchi
  // "web_search_tool_result", filtrati via dai blocchi che leggiamo (text/
  // tool_use) come tutto il resto che non è testo o una delle 12 azioni.
  { type: "web_search_20260209", name: "web_search", max_uses: 3 },
];

const MAX_BODY_BYTES = 100 * 1024; // 100KB, più che sufficiente per contesto + storico chat
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 20 richieste ogni 10 minuti per IP

// Contatore in memoria: vale finché l'istanza della function resta "calda".
// Su cold start riparte da zero — accettabile per un'app personale; per un
// limite più robusto servirebbe una tabella Postgres dedicata.
const rateLimitBuckets = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitBuckets.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  rateLimitBuckets.set(ip, timestamps);
  return false;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

interface ChatMessage {
  role?: string;
  content?: string;
}

interface ProposedAction {
  tool: string;
  input: Record<string, unknown>;
}

interface ClaudeReply {
  text: string;
  actions: ProposedAction[];
}

// Il ciclo di ricerca web di Claude è server-side: se supera il suo limite
// interno (10 iterazioni), l'API risponde con stop_reason "pause_turn"
// invece di finire il turno. Per riprendere basta reinviare la stessa
// conversazione con la risposta parziale accodata come turno assistant —
// niente messaggio utente fittizio, il server capisce da solo dove
// ripartire. Un tetto sui tentativi evita un ciclo (e una spesa) senza fine.
const MAX_PAUSE_CONTINUATIONS = 3;

async function callAnthropic(payload: Record<string, unknown>): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Errore Anthropic ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function callClaude(messages: ChatMessage[], context: Record<string, unknown>): Promise<ClaudeReply> {
  const system = SYSTEM_PROMPT + "\n\nContesto del viaggio (JSON):\n" + JSON.stringify(context);
  // deno-lint-ignore no-explicit-any
  let convo: any[] = messages.slice(-12).map(m => ({
    role: m && m.role === "assistant" ? "assistant" : "user",
    content: String((m && m.content) || ""),
  }));

  // deno-lint-ignore no-explicit-any
  let data: any;
  for (let attempt = 0; attempt <= MAX_PAUSE_CONTINUATIONS; attempt++) {
    data = await callAnthropic({
      model: ANTHROPIC_MODEL,
      max_tokens: 1200,
      system,
      tools: TOOLS,
      messages: convo,
    });
    if (data.stop_reason !== "pause_turn") break;
    convo = [...convo, { role: "assistant", content: data.content }];
  }

  const content = Array.isArray(data.content) ? data.content : [];
  const text = content
    .filter((b: { type?: string }) => b && b.type === "text")
    .map((b: { text?: string }) => b.text)
    .join("\n")
    .trim();
  const actions: ProposedAction[] = content
    .filter((b: { type?: string; name?: string }) => b && b.type === "tool_use" && typeof b.name === "string")
    .map((b: { name: string; input?: unknown }) => ({
      tool: b.name,
      input: (b.input && typeof b.input === "object") ? b.input as Record<string, unknown> : {},
    }));

  return { text: text || (actions.length ? "" : "Non ho una risposta da darti al momento."), actions };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Metodo non consentito." }, 405);
  }
  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Assistente non configurato: manca ANTHROPIC_API_KEY nei secret del progetto Supabase." }, 500);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    || req.headers.get("cf-connecting-ip")
    || "unknown";
  if (isRateLimited(ip)) {
    return json({ error: "Troppe richieste, riprova tra qualche minuto." }, 429);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "Corpo della richiesta troppo grande." }, 400);
  }

  let body: { messages?: ChatMessage[]; context?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON non valido." }, 400);
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const context = body.context && typeof body.context === "object" ? body.context : {};
  if (!messages.length) {
    return json({ error: "Nessun messaggio fornito." }, 400);
  }

  try {
    const { text, actions } = await callClaude(messages, context);
    return json({ text, actions });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Errore nel contattare l'assistente." }, 502);
  }
});
