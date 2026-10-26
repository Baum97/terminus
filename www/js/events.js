// Gemeinsames Termin-Format für KI, lokale Erkennung, Teilen-Links und Speicher.
import { isValidISO, normTime } from './dates.js';

let counter = 0;
export const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const isEmail = (s) => typeof s === 'string' && /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(s.trim());

// Eingeladene Personen: [{ name, email }], ohne Dubletten.
export function normalizeGuests(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const g of list) {
    const email = typeof g?.email === 'string' ? g.email.trim().toLowerCase() : '';
    if (!isEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ name: typeof g.name === 'string' ? g.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '', email });
  }
  return out.slice(0, 50);
}

const str = (v, max = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const FREQS = ['daily', 'weekly', 'monthly'];

// Wiederholung: { freq: 'daily' | 'weekly' | 'monthly', interval: 1–4, until: 'YYYY-MM-DD' | null }.
// Die KI darf auch kurz "weekly", "biweekly" oder "monthly" plus "until" liefern.
export function normalizeRepeat(raw, until, date) {
  let r = raw;
  if (typeof r === 'string') {
    const s = r.toLowerCase();
    r = s === 'biweekly' ? { freq: 'weekly', interval: 2 } : { freq: s };
  }
  if (!r || typeof r !== 'object' || !FREQS.includes(r.freq)) return null;
  const interval = Math.min(4, Math.max(1, Math.round(+r.interval || 1)));
  let u = typeof (r.until ?? until) === 'string' ? (r.until ?? until).slice(0, 10) : null;
  if (!isValidISO(u) || u <= date) u = null;
  return { freq: r.freq, interval, until: u };
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = str(raw.date, 10);
  if (!isValidISO(date)) return null;
  let endDate = str(raw.endDate, 10);
  if (!isValidISO(endDate) || endDate <= date) endDate = null;
  const kind = raw.kind === 'frist' || raw.kind === 'deadline' ? 'frist' : 'termin';
  // Fristen sind ganztägig: "bis 2.11." heißt bis zum Ende des Tages.
  const start = kind === 'frist' ? null : normTime(raw.start ?? '');
  let end = start ? normTime(raw.end ?? '') : null;
  if (end && !endDate && end <= start) end = null;
  if (kind === 'frist') endDate = null;
  let bring = raw.bring;
  if (typeof bring === 'string') bring = bring.split(/[,;]/);
  bring = Array.isArray(bring) ? bring.map((b) => str(b, 80)).filter(Boolean).slice(0, 12) : [];
  return {
    id: str(raw.id, 40) || newId(),
    title: str(raw.title, 120) || 'Termin',
    date,
    endDate,
    start,
    end,
    location: str(raw.location, 200),
    notes: typeof raw.notes === 'string' ? raw.notes.trim().slice(0, 1000) : '',
    bring,
    cost: str(raw.cost, 40),
    guests: normalizeGuests(raw.guests),
    forWhom: (Array.isArray(raw.forWhom) ? raw.forWhom : []).map((n) => str(n, 40)).filter(Boolean).slice(0, 8),
    responsible: str(raw.responsible, 40),
    done: (Array.isArray(raw.done) ? raw.done : []).map((n) => str(n, 80)).filter(Boolean),
    kind,
    skipHolidays: raw.skipHolidays === true,
    exdates: (Array.isArray(raw.exdates) ? raw.exdates : []).filter((d) => isValidISO(d) && d > date).slice(0, 200),
    repeat: kind === 'frist' || endDate ? null : normalizeRepeat(raw.repeat, raw.until, date),
    unsure: raw.unsure === true || raw.confidence === 'niedrig' || raw.confidence === 'low',
  };
}

export function normalizeEvents(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const ev = normalizeEvent(raw);
    if (!ev) continue;
    const key = `${ev.kind}|${ev.date}|${ev.start}|${ev.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}
