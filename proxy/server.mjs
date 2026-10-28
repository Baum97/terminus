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
import { createAboStore, AboError, MAX_ICS } from './abo.mjs';

const ROOT = resolve(fileURLToPath(new URL('../www', import.meta.url)));
const PORT = +(process.env.PORT || 8080);
const LLM_URL = process.env.LLM_URL || 'https://api.mistral.ai/v1/chat/completions';
const LLM_KEY = process.env.LLM_KEY || process.env.MISTRAL_API_KEY || '';
// Kleines Modell für Text (Standardweg), größeres nur für Fotos ohne erkennbaren Text.
const LLM_MODEL = process.env.LLM_MODEL || 'mistral-small-latest';
const LLM_TEXT_MODEL = process.env.LLM_TEXT_MODEL || (process.env.LLM_MODEL ? LLM_MODEL : 'ministral-8b-latest');
const DAILY_LIMIT = +(process.env.DAILY_LIMIT || 30);
const MAX_BODY = 8 * 1024 * 1024;
const AI_ENABLED = Boolean(LLM_KEY || process.env.LLM_URL);
// Die Android-App läuft unter https://localhost und darf die KI-Schnittstelle nutzen.
// Abo-Links für Kalender: Speicherort und öffentliche Adresse (sonst aus dem Host-Header)
const ABO_DIR = resolve(process.env.ABO_DIR || fileURLToPath(new URL('../data/abo', import.meta.url)));
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const ABO_DAILY = +(process.env.ABO_DAILY || 20);
const abos = createAboStore(ABO_DIR);
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'https://localhost,capacitor://localhost').split(',').map((o) => o.trim()).filter(Boolean);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = /^\/(index\.html|sw\.js|manifest\.webmanifest|(css|js|icons|vendor|data)\/.+)?$/;

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

const aboUsage = new Map();
let aboDay = new Date().toDateString();
function allowAbo(ip) {
  const today = new Date().toDateString();
  if (today !== aboDay) {
    aboUsage.clear();
    aboDay = today;
  }
  const n = (aboUsage.get(ip) || 0) + 1;
  aboUsage.set(ip, n);
  return n <= ABO_DAILY;
}

function publicBase(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (req.socket.encrypted ? 'https' : 'http');
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

async function abo(req, res, id) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    if (req.method === 'POST' && !id) {
      if (!allowAbo(ip)) return send(res, 429, { error: 'Tageslimit für neue Abos erreicht.' });
      const created = await abos.create(await readBody(req, MAX_ICS + 4096));
      return send(res, 201, { ...created, url: `${publicBase(req)}/abo/${created.id}.ics` });
    }
    if (req.method === 'PUT' && id) {
      await abos.update(id, key, await readBody(req, MAX_ICS + 4096));
      return send(res, 200, { id, url: `${publicBase(req)}/abo/${id}.ics` });
    }
    if (req.method === 'DELETE' && id) {
      await abos.remove(id, key);
      res.writeHead(204);
      return res.end();
    }
    return send(res, 405, { error: 'Methode nicht erlaubt.' });
  } catch (e) {
    return send(res, e instanceof AboError ? e.status : e.status || 400, { error: e.message || 'Ungültige Anfrage.' });
  }
}

async function aboFile(req, res, id) {
  try {
    const { ics, updated } = await abos.get(id);
    res.writeHead(200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Last-Modified': new Date(updated).toUTCString(),
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : ics);
  } catch {
    send(res, 404, 'Dieses Kalender-Abo gibt es nicht (mehr).', 'text/plain; charset=utf-8');
  }
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req, max = MAX_BODY) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Zu groß.'), { status: 413 });
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
  const model = input.mode === 'image' ? LLM_MODEL : LLM_TEXT_MODEL;
  const body = { model, messages: input.messages, temperature: 0.1, max_tokens: 1500, response_format: { type: 'json_object' } };
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
  }
  if (pathname === '/api/health') return send(res, 200, { ok: AI_ENABLED, abo: true });
  const aboApi = pathname.match(/^\/api\/abo(?:\/([A-Za-z0-9_-]{22}))?$/);
  if (aboApi) return abo(req, res, aboApi[1]);
  const aboGet = pathname.match(/^\/abo\/([A-Za-z0-9_-]{22})\.ics$/);
  if (aboGet && (req.method === 'GET' || req.method === 'HEAD')) return aboFile(req, res, aboGet[1]);
  if (pathname === '/api/chat' && req.method === 'POST') return chat(req, res);
  // Android "Teilen an": nur der Service Worker nimmt das an; ohne ihn zurück zur App.
  if (pathname === '/share-target') {
    res.writeHead(303, { Location: '/' });
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Methode nicht erlaubt.' });
  return serveStatic(req, res, pathname);
}).listen(PORT, () => {
  console.log(`Terminus läuft auf http://localhost:${PORT}  (KI: ${AI_ENABLED ? `${LLM_TEXT_MODEL} / Fotos: ${LLM_MODEL} über ${new URL(LLM_URL).host}` : 'aus, nur Erkennung auf dem Gerät'})`);
});
