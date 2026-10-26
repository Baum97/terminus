// Kalender-Import für den Umzug: liest .ics-Dateien (Google-Export, iCloud, Outlook, Thunderbird)
// und liefert Termine in Berliner Ortszeit, wie die Android-Brücke sie einträgt.
import { pad } from './dates.js';

const BERLIN = 'Europe/Berlin';
// Outlook schreibt Windows-Zeitzonennamen.
const WINDOWS_TZ = {
  'W. Europe Standard Time': 'Europe/Berlin', 'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris', 'GMT Standard Time': 'Europe/London', 'UTC': 'UTC',
};

function unfold(text) {
  return String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseProp(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(';');
  const p = {};
  for (const x of params) {
    const [k, v = ''] = x.split('=');
    p[k.toUpperCase()] = v.replace(/"/g, '');
  }
  return { name: name.toUpperCase(), params: p, value: line.slice(colon + 1) };
}

const unescapeText = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// Versatz der Zeitzone zu UTC in Minuten zum Zeitpunkt ms
function tzOffset(ms, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUTC - ms) / 60000;
}

function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Wanduhrzeit in Zeitzone tz → Millisekunden
function zonedToMs(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let ms = guess - tzOffset(guess, tz) * 60000;
  ms = guess - tzOffset(ms, tz) * 60000;
  return ms;
}

function berlinParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: BERLIN, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// { allDay, date } oder { allDay: false, ms }
function parseDate(prop) {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4] || prop.params.VALUE === 'DATE') return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}` };
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] || 0].map(Number);
  if (m[7]) return { allDay: false, ms: Date.UTC(y, mo - 1, d, h, mi, s) };
  let tz = prop.params.TZID ? WINDOWS_TZ[prop.params.TZID] || prop.params.TZID.replace(/^\//, '') : BERLIN;
  if (!validTz(tz)) tz = BERLIN;
  return { allDay: false, ms: zonedToMs(y, mo, d, h, mi, s, tz) };
}

function durationMs(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, , w = 0, d = 0, h = 0, mi = 0, s = 0] = m;
  return (((+w * 7 + +d) * 24 + +h) * 60 + +mi) * 60000 + +s * 1000;
}

const isoAdd = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

// Liefert { events, skipped }. events: { title, date, endDate, start, end, location, description, rrule }
export function parseICS(text) {
  const events = [];
  let skipped = 0;
  let cur = null;
  let depth = 0;
  for (const line of unfold(text)) {
    if (/^BEGIN:VEVENT/i.test(line)) {
      cur = {};
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:VEVENT/i.test(line)) {
      const ev = finish(cur);
      if (ev) events.push(ev);
      else skipped++;
      cur = null;
    } else if (/^END:/i.test(line)) depth--;
    else if (depth === 0) {
      const p = parseProp(line);
      if (p && !(p.name in cur)) cur[p.name] = p;
    }
  }
  return { events, skipped };
}

function finish(c) {
  // Abgesagte Termine und Ausnahmen einzelner Serientermine überspringen wir.
  if (!c.DTSTART || c['RECURRENCE-ID'] || /CANCELLED/i.test(c.STATUS?.value || '')) return null;
  const start = parseDate(c.DTSTART);
  if (!start) return null;
  const end = c.DTEND ? parseDate(c.DTEND) : null;
  const dur = c.DURATION ? durationMs(c.DURATION.value) : null;
  const ev = {
    title: unescapeText(c.SUMMARY?.value || 'Termin').trim() || 'Termin',
    location: unescapeText(c.LOCATION?.value || '').trim(),
    description: unescapeText(c.DESCRIPTION?.value || '').trim(),
    rrule: c.RRULE ? c.RRULE.value.trim() : '',
    start: null, end: null, endDate: null,
  };
  if (start.allDay) {
    ev.date = start.date;
    // DTEND ist bei ganztägigen Terminen exklusiv.
    const last = end?.allDay ? isoAdd(end.date, -1) : dur ? isoAdd(start.date, Math.round(dur / 86400000) - 1) : start.date;
    if (last > ev.date) ev.endDate = last;
    return ev;
  }
  const endMs = end && !end.allDay ? end.ms : start.ms + (dur ?? 3600000);
  const s = berlinParts(start.ms);
  const e = berlinParts(Math.max(endMs, start.ms));
  ev.date = s.date;
  ev.start = s.time;
  ev.end = e.time;
  if (e.date !== s.date) ev.endDate = e.date;
  return ev;
}

// Für die Web-Version: einfache Wiederholungen in das Terminus-Format übersetzen.
export function simpleRepeat(rule) {
  if (!rule) return null;
  const p = Object.fromEntries(rule.split(';').map((x) => x.split('=')));
  const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' }[p.FREQ];
  if (!freq || p.COUNT || (p.BYDAY && p.BYDAY.includes(','))) return null;
  const until = p.UNTIL ? `${p.UNTIL.slice(0, 4)}-${p.UNTIL.slice(4, 6)}-${p.UNTIL.slice(6, 8)}` : null;
  return { freq, interval: +(p.INTERVAL || 1), until };
}
