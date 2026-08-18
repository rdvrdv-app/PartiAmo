const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTS = [8000, 8080, 3000, 5000, 8081];
let portIdx = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip'
};

// ============================================================
// Assistente virtuale — POST /api/assistant
// Inoltra i messaggi all'API di Anthropic. La chiave resta solo
// qui lato server: non è mai esposta al client.
// ============================================================

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

const SYSTEM_PROMPT = `Sei l'assistente di viaggio di PartiAmo. Rispondi in italiano, in modo breve e operativo.
Usa SOLO i dati del viaggio che ricevi nel contesto (destinazione, date, meteo, checklist, bagagli, itinerario, POI).
Se un dato manca, dillo invece di inventarlo. Non hai accesso ai documenti del Vault (file, note, numeri):
se l'utente chiede di leggerli o di aprirli, spiega che non ne hai accesso, solo tipo e scadenza quando presenti.`;

const MAX_BODY_BYTES = 100 * 1024; // 100KB, più che sufficiente per contesto + storico chat
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 20 richieste ogni 10 minuti per IP

const rateLimitBuckets = new Map();

function isRateLimited(ip) {
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

// Pulizia periodica per non far crescere la mappa all'infinito su un
// servizio esposto a lungo (IP che non tornano più restano occupati poco).
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitBuckets) {
    const fresh = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length) rateLimitBuckets.set(ip, fresh);
    else rateLimitBuckets.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Corpo della richiesta troppo grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('JSON non valido.'));
      }
    });
    req.on('error', reject);
  });
}

async function callClaude(messages, context) {
  const system = SYSTEM_PROMPT + '\n\nContesto del viaggio (JSON):\n' + JSON.stringify(context);
  const payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 800,
    system,
    messages: messages.slice(-12).map(m => ({
      role: m && m.role === 'assistant' ? 'assistant' : 'user',
      content: String((m && m.content) || '')
    }))
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('Errore Anthropic ' + res.status);
    throw new Error(msg);
  }
  const text = (data.content || [])
    .filter(b => b && b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
  return text || 'Non ho una risposta da darti al momento.';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleAssistant(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';

  if (!ANTHROPIC_API_KEY) {
    sendJson(res, 500, { error: "Assistente non configurato: manca ANTHROPIC_API_KEY sul server." });
    return;
  }
  if (isRateLimited(ip)) {
    sendJson(res, 429, { error: 'Troppe richieste, riprova tra qualche minuto.' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, MAX_BODY_BYTES);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
    return;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const context = body.context && typeof body.context === 'object' ? body.context : {};
  if (!messages.length) {
    sendJson(res, 400, { error: 'Nessun messaggio fornito.' });
    return;
  }

  try {
    const text = await callClaude(messages, context);
    sendJson(res, 200, { text });
  } catch (e) {
    sendJson(res, 502, { error: e.message || "Errore nel contattare l'assistente." });
  }
}

// ============================================================
// Server statico + routing API
// ============================================================

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];

  if (pathname === '/api/assistant') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Metodo non consentito.' });
      return;
    }
    handleAssistant(req, res).catch(() => sendJson(res, 500, { error: 'Errore interno del server.' }));
    return;
  }

  let filePath = path.join(__dirname, decodeURIComponent(req.url === '/' ? 'index.html' : pathname));
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

function startServer() {
  const p = PORTS[portIdx];
  server.removeAllListeners('error');
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      portIdx++;
      if (portIdx < PORTS.length) startServer();
      else console.error('No free ports available');
    }
  });
  server.listen(p, () => {
    console.log(`Server running at http://localhost:${p}/`);
    if (!ANTHROPIC_API_KEY) {
      console.warn('ANTHROPIC_API_KEY non impostata: /api/assistant risponderà con errore 500.');
    }
  });
}

startServer();
