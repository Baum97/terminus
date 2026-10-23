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

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const date = str(raw.date, 10);
  if (!isValidISO(date)) return null;
  let endDate = str(raw.endDate, 10);
  if (!isValidISO(endDate) || endDate <= date) endDate = null;
  const start = normTime(raw.start ?? '');
  let end = start ? normTime(raw.end ?? '') : null;
  if (end && !endDate && end <= start) end = null;
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
    const key = `${ev.date}|${ev.start}|${ev.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out.sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
}
