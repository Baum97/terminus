// Familien-Infokarte: Kinderarzt, Allergien, Medikamente, Notfallkontakte – für Babysitter, Großeltern, Kita.
// Nur auf dem Gerät gespeichert; geteilt wird bewusst per Link (#ik=…).
import { addDays, isValidISO, toISO } from './dates.js';
import { normalizeEvent } from './events.js';

export const FIELDS = [
  ['birth', 'Geburtsdatum'], ['allergies', 'Allergien / Unverträglichkeiten'], ['meds', 'Medikamente'], ['notes', 'Wichtig zu wissen'],
  ['doctor', 'Kinder- oder Hausarzt'], ['doctorPhone', 'Telefon Arzt'], ['insurance', 'Krankenkasse'], ['emergency', 'Notfallkontakte (Name und Telefon, je Zeile)'],
];

export function cleanCard(raw) {
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const c = { id: str(raw.id, 20) || `i${Date.now().toString(36)}`, name: str(raw.name, 40) };
  for (const [k] of FIELDS) c[k] = str(raw[k], k === 'emergency' || k === 'notes' ? 500 : 200);
  if (c.birth && !isValidISO(c.birth)) c.birth = '';
  return c.name ? c : null;
}

// Telefonnummern in einem Text finden, z. B. "Oma Anna 0171 2345678"
export function phones(text) {
  return [...String(text || '').matchAll(/(\+?\d[\d /()-]{5,}\d)/g)].map((m) => ({ shown: m[1].trim(), tel: m[1].replace(/[^\d+]/g, '') }));
}

/* ---------- Vorsorgeuntersuchungen (U1–U9, J1) ---------- */

const addMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return toISO(new Date(t.getFullYear(), t.getMonth(), Math.min(d, last)));
};

// Zeiträume nach der Kinder-Richtlinie (gesetzliche Krankenkassen)
export const U_EXAMS = [
  ['U2', (b) => addDays(b, 3), (b) => addDays(b, 10)],
  ['U3', (b) => addDays(b, 21), (b) => addDays(b, 35)],
  ['U4', (b) => addMonths(b, 3), (b) => addMonths(b, 4)],
  ['U5', (b) => addMonths(b, 6), (b) => addMonths(b, 7)],
  ['U6', (b) => addMonths(b, 10), (b) => addMonths(b, 12)],
  ['U7', (b) => addMonths(b, 21), (b) => addMonths(b, 24)],
  ['U7a', (b) => addMonths(b, 34), (b) => addMonths(b, 36)],
  ['U8', (b) => addMonths(b, 46), (b) => addMonths(b, 48)],
  ['U9', (b) => addMonths(b, 60), (b) => addMonths(b, 64)],
  ['J1', (b) => addMonths(b, 144), (b) => addMonths(b, 168)],
];

// Kommende Untersuchungen als Fristen: Erinnerung zwei Wochen vor Beginn des Zeitraums (Termin beim Arzt machen)
export function checkups(card, today = new Date()) {
  if (!card.birth) return [];
  const now = toISO(today);
  return U_EXAMS.map(([name, from, to]) => ({ name, from: from(card.birth), to: to(card.birth) }))
    .filter((u) => u.to >= now)
    .map((u) => normalizeEvent({
      kind: 'frist', date: addDays(u.from, -14) < now ? now : addDays(u.from, -14), title: `${u.name} für ${card.name}: Termin machen`, forWhom: [card.name],
      notes: `Vorsorgeuntersuchung ${u.name}: vom ${u.from.split('-').reverse().join('.')} bis ${u.to.split('-').reverse().join('.')}. Gelbes Heft mitnehmen.${card.doctor ? ` Arzt: ${card.doctor}${card.doctorPhone ? `, ${card.doctorPhone}` : ''}` : ''}`,
    }))
    .filter(Boolean);
}

/* ---------- Link ---------- */

const b64 = (bytes) => {
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function encodeCards(cards) {
  return b64(await pipe(new TextEncoder().encode(JSON.stringify({ v: 1, c: cards })), new CompressionStream('deflate-raw')));
}

export async function decodeCards(code) {
  try {
    const d = JSON.parse(new TextDecoder().decode(await pipe(unb64(code), new DecompressionStream('deflate-raw'))));
    return d.v === 1 && Array.isArray(d.c) ? d.c.slice(0, 12).map(cleanCard).filter(Boolean) : null;
  } catch {
    return null;
  }
}
