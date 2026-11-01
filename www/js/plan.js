// Dienstpläne und Stundenpläne vom Foto. Läuft auf dem Gerät, ohne KI.
// Dienstplan: Kürzel mit Legende ("F = Frühdienst 6:00–14:00") → einzelne Schichten.
// Stundenplan: Kopfzeile mit Wochentagen, Zeilen mit Uhrzeit und Fächern → wöchentliche Serien bis zu den Sommerferien.
import { findDates, findTimes } from './parse.js';
import { normalizeEvent } from './events.js';
import { addDays, fromISO, toISO, pad } from './dates.js';

const clean = (l) => l.replace(/[|¦]/g, ' | ').replace(/\s+/g, ' ').trim();
const hm = (h, m) => `${pad(+h)}:${pad(+(m || 0))}`;

/* ---------- Dienstplan ---------- */

const LEGEND = /(?:^|\s)([A-ZÄÖÜ][A-ZÄÖÜa-z]?\d?)\s*[=:]\s*([A-Za-zÄÖÜäöüß-]+(?:\s[A-Za-zÄÖÜäöüß-]+)?)?\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:Uhr\s*)?[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?/g;
const OFF = /^(frei|x|u|urlaub|ft|ü|-|–|\/)$/i;

export function parseLegend(text) {
  const codes = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    LEGEND.lastIndex = 0;
    for (const m of line.matchAll(LEGEND)) {
      const [, code, name, h1, m1, h2, m2] = m;
      if (+h1 > 24 || +h2 > 24) continue;
      codes[code.toUpperCase()] = { name: name?.trim() || `Schicht ${code}`, start: hm(h1, m1), end: hm(h2, m2) };
    }
  }
  return codes;
}

function shift(date, code, codes) {
  const c = codes[code.toUpperCase()];
  if (!c) return null;
  const night = c.end <= c.start;
  return normalizeEvent({ title: c.name, date, start: c.start, end: c.end, endDate: night ? addDays(date, 1) : null, notes: `Dienstplan: ${code}` });
}

// Liefert Schichten oder [] (dann übernimmt die normale Erkennung)
export function parseShifts(text, today = new Date()) {
  const codes = parseLegend(text);
  const known = Object.keys(codes);
  if (!known.length) return [];
  const isCode = (t) => known.includes(t.toUpperCase());
  const lines = String(text).split(/\r?\n/).map(clean).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    LEGEND.lastIndex = 0;
    if (LEGEND.test(line)) continue;
    const { dates: found } = findDates(line, today);
    const dates = found.filter((d) => d.date && !d.endDate);
    if (!dates.length) continue;
    // Tabelle: Zeile mit vielen Daten, darunter eine Zeile mit gleich vielen Kürzeln
    if (dates.length >= 3) {
      const next = (lines[i + 1] || '').split(/\s+|\|/).filter((t) => t && t !== '|');
      if (next.length === dates.length && next.every((t) => isCode(t) || OFF.test(t))) {
        dates.forEach((d, k) => isCode(next[k]) && out.push(shift(d.date, next[k], codes)));
        i++;
        continue;
      }
    }
    // Zeile: "Mo 03.11. F" oder "03.11. Spätdienst 14:00-22:00"
    const d = dates[0];
    const rest = (line.slice(0, d.index) + ' ' + line.slice(d.index + d.length)).split(/\s+/);
    const code = rest.find((t) => isCode(t.replace(/[^\wÄÖÜäöü]/g, '')));
    if (code) {
      out.push(shift(d.date, code.replace(/[^\wÄÖÜäöü]/g, ''), codes));
      continue;
    }
    const t = findTimes(line);
    if (t?.end) {
      const night = t.end <= t.start;
      out.push(normalizeEvent({ title: 'Dienst', date: d.date, start: t.start, end: t.end, endDate: night ? addDays(d.date, 1) : null, notes: 'Dienstplan' }));
    }
  }
  const events = out.filter(Boolean);
  return events.length >= 2 ? events : [];
}

/* ---------- Stundenplan ---------- */

const DAYS = [
  [/^mo(ntag|\.)?$/i, 1], [/^di(enstag|\.)?$/i, 2], [/^mi(ttwoch|\.)?$/i, 3], [/^do(nnerstag|\.)?$/i, 4], [/^fr(eitag|\.)?$/i, 5], [/^sa(mstag|\.)?$/i, 6],
];
const dayOf = (t) => DAYS.find(([re]) => re.test(t))?.[1];

function nextWeekday(today, wd) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
  return toISO(d);
}

// opts.until: letzter Schultag (z. B. vor den Sommerferien); opts.who: Name des Kindes
export function parseTimetable(text, today = new Date(), { until = null, who = '' } = {}) {
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean);
  const headIdx = lines.findIndex((l) => l.split(/[\s|]+/).filter((t) => dayOf(t)).length >= 3);
  if (headIdx < 0) return [];
  const days = lines[headIdx].split(/[\s|]+/).map(dayOf).filter(Boolean);
  const slots = Object.fromEntries(days.map((d) => [d, []]));
  for (const line of lines.slice(headIdx + 1)) {
    const t = findTimes(line);
    if (!t?.end) continue;
    const rest = line.replace(t.match, ' ').replace(/^\s*\d{1,2}\s*[.)]?\s+/, ' ').replace(/\bUhr\b/g, ' ').replace(/^[\s|]+|[\s|]+$/g, '');
    let cells = rest.split(/\s*\|\s*/).map((c) => c.trim());
    if (cells.length !== days.length) cells = rest.split(/\s+/);
    if (cells.length !== days.length) continue;
    cells.forEach((c, k) => {
      if (c && !/^[-–—/x]$/i.test(c)) slots[days[k]].push({ start: t.start, end: t.end, subject: c });
    });
  }
  const events = [];
  for (const [wd, list] of Object.entries(slots)) {
    // Doppelstunden zusammenfassen (gleiches Fach, höchstens 20 Minuten Pause)
    const blocks = [];
    for (const s of list.sort((a, b) => a.start.localeCompare(b.start))) {
      const last = blocks.at(-1);
      const gap = last ? (toMin(s.start) - toMin(last.end)) : Infinity;
      if (last && last.subject.toLowerCase() === s.subject.toLowerCase() && gap >= 0 && gap <= 20) last.end = s.end;
      else blocks.push({ ...s });
    }
    const date = nextWeekday(today, +wd);
    for (const b of blocks) {
      events.push(normalizeEvent({
        title: who ? `${b.subject} (${who})` : b.subject, date, start: b.start, end: b.end,
        repeat: { freq: 'weekly', interval: 1, until }, forWhom: who ? [who] : [], notes: 'Stundenplan',
      }));
    }
  }
  return events.filter(Boolean).length >= 3 ? events.filter(Boolean) : [];
}

const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

export const _test = { nextWeekday, fromISO };
