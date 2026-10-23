// Kleiner Server ohne Abhängigkeiten (Node 18+): liefert die App aus und reicht
// KI-Anfragen an Mistral oder ein eigenes Modell weiter. Der API-Schlüssel bleibt hier,
// Nutzer brauchen keinen. Fotos werden nicht gespeichert und nicht geloggt.
//
//   MISTRAL_API_KEY=… node proxy/server.mjs
//   LLM_URL=http://localhost:11434/v1/chat/completions LLM_MODEL=mistral-small3.2 node proxy/server.mjs
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../www', import.meta.url)));
const PORT = +(process.env.PORT || 8080);
const LLM_URL = process.env.LLM_URL || 'https://api.mistral.ai/v1/chat/completions';
const LLM_KEY = process.env.LLM_KEY || process.env.MISTRAL_API_KEY || '';
const LLM_MODEL = process.env.LLM_MODEL || 'mistral-small-latest';
const DAILY_LIMIT = +(process.env.DAILY_LIMIT || 30);
const MAX_BODY = 8 * 1024 * 1024;
const AI_ENABLED = Boolean(LLM_KEY || process.env.LLM_URL);
// Die Android-App läuft unter https://localhost und darf die KI-Schnittstelle nutzen.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://localhost,capacitor://localhost').split(',').map((o) => o.trim()).filter(Boolean);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = /^\/(index\.html|sw\.js|manifest\.webmanifest|(css|js|icons|vendor)\/.+)?$/;

// Einfaches Tageslimit pro IP, nur im Speicher.
const usage = new Map();
let usageDay = new Date().toDateString();
function allow(ip) {
  const today = new Date().toDateString();
  if (today !== usageDay) {
    usage.clear();
    usageDay = today;
  }
  const n = (usage.get(ip) || 0) + 1;
  usage.set(ip, n);
  return n <= DAILY_LIMIT;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('zu groß'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function chat(req, res) {
  if (!AI_ENABLED) return send(res, 503, { error: 'KI ist auf diesem Server nicht eingerichtet.' });
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  if (!allow(ip)) return send(res, 429, { error: 'Tageslimit erreicht.' });
  let input;
  try {
    input = await readBody(req);
  } catch (e) {
    return send(res, e.status || 400, { error: 'Ungültige Anfrage.' });
  }
  if (!Array.isArray(input.messages)) return send(res, 400, { error: 'messages fehlt.' });
  // Nur bekannte Felder weitergeben; das Modell legt der Server fest.
  const body = { model: LLM_MODEL, messages: input.messages, temperature: 0.1, response_format: { type: 'json_object' } };
  // Mistral erwartet image_url als String.
  if (LLM_URL.includes('api.mistral.ai')) {
    for (const m of body.messages) {
      if (Array.isArray(m.content)) for (const p of m.content) if (p.type === 'image_url' && p.image_url?.url) p.image_url = p.image_url.url;
    }
  }
  try {
    const upstream = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(LLM_KEY ? { Authorization: `Bearer ${LLM_KEY}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await upstream.text();
    if (!upstream.ok) console.warn(`KI-Fehler ${upstream.status}: ${text.slice(0, 200)}`);
    send(res, upstream.ok ? 200 : 502, upstream.ok ? text : { error: `KI-Fehler ${upstream.status}` });
  } catch (e) {
    console.warn('KI nicht erreichbar:', e.message);
    send(res, 502, { error: 'KI nicht erreichbar.' });
  }
}

async function serveStatic(req, res, pathname) {
  if (!PUBLIC.test(pathname)) return send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
  const file = normalize(join(ROOT, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(ROOT)) return send(res, 403, 'Verboten', 'text/plain; charset=utf-8');
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'Nicht gefunden', 'text/plain; charset=utf-8');
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.startsWith('/api/') && CORS_ORIGINS.includes(req.headers.origin)) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  }
  if (pathname === '/api/health') return send(res, 200, { ok: AI_ENABLED });
  if (pathname === '/api/chat' && req.method === 'POST') return chat(req, res);
  // Android "Teilen an": nur der Service Worker nimmt das an; ohne ihn zurück zur App.
  if (pathname === '/share-target') {
    res.writeHead(303, { Location: '/' });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Methode nicht erlaubt.' });
  return serveStatic(req, res, pathname);
}).listen(PORT, () => {
  console.log(`Terminus läuft auf http://localhost:${PORT}  (KI: ${AI_ENABLED ? `${LLM_MODEL} über ${new URL(LLM_URL).host}` : 'aus, nur Erkennung auf dem Gerät'})`);
});
