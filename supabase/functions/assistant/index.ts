// supabase/functions/assistant/index.ts
// Assistente virtuale PartiAmo — Supabase Edge Function (Deno).
// Inoltra i messaggi all'API di Anthropic. La chiave resta solo qui,
// come secret di progetto (mai nel client, mai nel repo):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Deploy: supabase functions deploy assistant --no-verify-jwt
// (--no-verify-jwt perché l'assistente funziona anche senza login,
// come il resto dell'app: legge solo i dati del viaggio in localStorage.)

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
itinerario, POI). Se un dato manca, dillo invece di inventarlo. Non hai accesso ai documenti del
Vault (file, note, numeri): se l'utente chiede di leggerli o di aprirli, spiega che non ne hai accesso,
solo tipo e scadenza quando presenti.`;

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

async function callClaude(messages: ChatMessage[], context: Record<string, unknown>): Promise<string> {
  const system = SYSTEM_PROMPT + "\n\nContesto del viaggio (JSON):\n" + JSON.stringify(context);
  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 800,
    system,
    messages: messages.slice(-12).map(m => ({
      role: m && m.role === "assistant" ? "assistant" : "user",
      content: String((m && m.content) || ""),
    })),
  };

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
  const text = (data.content || [])
    .filter((b: { type?: string }) => b && b.type === "text")
    .map((b: { text?: string }) => b.text)
    .join("\n")
    .trim();
  return text || "Non ho una risposta da darti al momento.";
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
    const text = await callClaude(messages, context);
    return json({ text });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Errore nel contattare l'assistente." }, 502);
  }
});
