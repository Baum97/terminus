// Abo-Datei eines Kalenders: nur das, was geteilt werden soll.
// Immer: Titel und Zeit (inkl. Serien und Ausnahmen). Auf Wunsch: Ort, Notizen, Mitbringliste.
// Nie: Für, Zuständig, Häkchen, Erinnerungen, Gäste.
import { VTIMEZONE, fold, escapeText, buildICS } from './ics.js';
import { berlinParts } from './icsimport.js';
import { parseDescription } from './desc.js';

export const DEFAULT_FIELDS = { location: true, notes: false, bring: false };

const utcStamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const berlinStamp = (ms) => {
  const p = berlinParts(ms);
  return `${p.date.replace(/-/g, '')}T${p.time.replace(':', '')}00`;
};

// Android schreibt Dauern teils als "P3600S", der Standard verlangt "PT3600S"
const normDuration = (d) => (d ? d.replace(/^P(\d+)S$/, 'PT$1S') : '');

function sharedDescription(raw, fields) {
  const d = parseDescription(raw || '');
  const parts = [];
  if (fields.notes && d.notes) parts.push(d.notes);
  if (fields.bring && d.bring.length) parts.push(`Mitbringen: ${d.bring.map((b) => b.text).join(', ')}`);
  return parts.join('\n\n');
}

function header(name) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Terminus//Abo//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`, 'X-WR-TIMEZONE:Europe/Berlin', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H', ...VTIMEZONE];
}

function exdateLine(raw) {
  if (!raw) return null;
  // Android: "20261229T150000Z,…" oder "Europe/Berlin;20261229T160000,…"
  const m = raw.match(/^([^;]+);(.+)$/);
  return m ? `EXDATE;TZID=${m[1]}:${m[2]}` : `EXDATE:${raw}`;
}

// rows: Ergebnis von Native.exportCalendar
export function aboFromDevice(rows, { name, calendarId, fields = DEFAULT_FIELDS, now = new Date() }) {
  const stamp = utcStamp(now.getTime());
  const masters = rows.filter((r) => !r.originalId && !r.cancelled);
  const exceptions = rows.filter((r) => r.originalId);
  const cancelledBy = new Map();
  for (const e of exceptions.filter((x) => x.cancelled)) {
    const list = cancelledBy.get(e.originalId) || [];
    list.push(utcStamp(e.originalTime));
    cancelledBy.set(e.originalId, list);
  }
  const uid = (id) => `${calendarId}-${id}@terminus`;
  const timeLines = (r) => {
    if (r.allDay) {
      const out = [`DTSTART;VALUE=DATE:${utcDate(r.start)}`];
      if (r.end) out.push(`DTEND;VALUE=DATE:${utcDate(r.end)}`);
      else out.push(`DURATION:${normDuration(r.duration) || 'P1D'}`);
      return out;
    }
    const out = [`DTSTART;TZID=Europe/Berlin:${berlinStamp(r.start)}`];
    if (r.end && !r.rrule) out.push(`DTEND;TZID=Europe/Berlin:${berlinStamp(r.end)}`);
    else out.push(`DURATION:${normDuration(r.duration) || (r.end ? `PT${Math.round((r.end - r.start) / 60000)}M` : 'PT1H')}`);
    return out;
  };
  const body = (r) => {
    const out = [`SUMMARY:${escapeText(r.title || 'Termin')}`];
    if (fields.location && r.location) out.push(`LOCATION:${escapeText(r.location)}`);
    const desc = sharedDescription(r.description, fields);
    if (desc) out.push(`DESCRIPTION:${escapeText(desc)}`);
    return out;
  };
  const lines = header(name);
  for (const r of masters) {
    lines.push('BEGIN:VEVENT', `UID:${uid(r.id)}`, `DTSTAMP:${stamp}`, ...timeLines(r), ...body(r));
    if (r.rrule) {
      lines.push(`RRULE:${r.rrule}`);
      const ex = exdateLine(r.exdate);
      if (ex) lines.push(ex);
      if (cancelledBy.has(r.id)) lines.push(`EXDATE:${cancelledBy.get(r.id).join(',')}`);
    }
    lines.push('END:VEVENT');
  }
  // Geänderte Einzeltermine einer Serie
  const masterIds = new Set(masters.map((m) => m.id));
  for (const e of exceptions.filter((x) => !x.cancelled && masterIds.has(x.originalId))) {
    lines.push('BEGIN:VEVENT', `UID:${uid(e.originalId)}`, `DTSTAMP:${stamp}`, `RECURRENCE-ID:${utcStamp(e.originalTime)}`, ...timeLines({ ...e, rrule: null }), ...body(e), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Web-Version: gemerkte Termine, ohne Familienangaben
export function aboFromLocal(events, { name, fields = DEFAULT_FIELDS }) {
  const shared = events.map((e) => ({
    ...e, location: fields.location ? e.location : '', notes: fields.notes ? e.notes : '', bring: fields.bring ? e.bring : [],
    cost: '', forWhom: [], responsible: '', done: [], guests: [],
  }));
  return buildICS(shared, { alarmMinutes: null, eveReminder: false })
    .replace('METHOD:PUBLISH\r\n', `METHOD:PUBLISH\r\nX-WR-CALNAME:${escapeText(name)}\r\nREFRESH-INTERVAL;VALUE=DURATION:PT6H\r\n`);
}

/* ---------- Abo-Seite ---------- */

const b64url = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function encodeAbo({ url, name, by = '' }) {
  return b64url(JSON.stringify({ u: url, n: name, ...(by ? { b: by } : {}) }));
}

export function decodeAbo(code) {
  try {
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (!/^https?:\/\/[^\s]+\.ics$/.test(d.u || '')) return null;
    return { url: d.u, name: String(d.n || 'Kalender').slice(0, 80), by: String(d.b || '').slice(0, 60) };
  } catch {
    return null;
  }
}

// Abonnieren in den verbreiteten Kalendern
export function subscribeLinks(url, name) {
  const webcal = url.replace(/^https?:\/\//, 'webcal://');
  return {
    webcal,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`,
  };
}
