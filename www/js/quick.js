// Schnelleingabe: eine Zeile wird ein Termin.
//   "Mi 16 Uhr Zahnarzt Ben"  ·  "morgen 8:30 Elterngespräch @ Schule"  ·  "nächsten Freitag Kuchen backen für Mia"
import { toISO, addDays } from './dates.js';
import { parseText, findTimes, findDates } from './parse.js';
import { normalizeEvent } from './events.js';

const WD = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6 };
const RE_REL = /(?<![\p{L}])(heute|morgen|übermorgen|in\s+(\d+|zwei|drei|vier|fünf)\s+tagen|(?:(nächste[nrs]?|kommende[nrs]?|am)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\.?)(?![\p{L}])/iu;
const NUM = { zwei: 2, drei: 3, vier: 4, fünf: 5 };
const RE_DAYPART = /(?<![\p{L}])(früh|morgens|vormittags?|mittags?|nachmittags?|abends?)(?![\p{L}])/iu;
const DAYPART = { früh: '08:00', morgen: '08:00', vormittag: '10:00', mittag: '12:00', nachmittag: '15:00', abend: '19:00' };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function relativeDate(m, today) {
  const t = toISO(today);
  const word = m[1].toLowerCase();
  if (word === 'heute') return t;
  if (word === 'morgen') return addDays(t, 1);
  if (word === 'übermorgen') return addDays(t, 2);
  if (m[2]) return addDays(t, NUM[m[2].toLowerCase()] || +m[2]);
  const target = WD[m[4].toLowerCase()];
  let diff = (target - today.getDay() + 7) % 7;
  // "nächsten Dienstag" am Dienstag meint die kommende Woche, "Di" allein den heutigen Tag
  if (diff === 0 && m[3] && /^n|^k/i.test(m[3])) diff = 7;
  return addDays(t, diff);
}

export function quickParse(text, today = new Date(), { family = [] } = {}) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // Personen aus der Familie: "für Mia", "Ben"
  const forWhom = [];
  for (const name of family) {
    // "mit Papa" bleibt im Titel, "Ben" oder "für Mia" wird zur Person des Termins
    const re = new RegExp(`(?<![\\p{L}])(?<!mit\\s)(?:für\\s+)?${esc(name)}(?![\\p{L}])`, 'iu');
    if (re.test(s)) {
      forWhom.push(name);
      s = s.replace(re, ' ');
    }
  }
  // Ort nach "@": "Elterngespräch @ Schule"
  let location = '';
  const at = s.match(/\s@\s*(.+)$/);
  if (at) {
    location = at[1].trim();
    s = s.slice(0, at.index);
  }

  let date = null;
  const rel = s.match(RE_REL);
  const explicit = findDates(s, today).dates[0];
  if (explicit) {
    date = explicit.date;
    s = s.slice(0, explicit.index) + ' ' + s.slice(explicit.index + explicit.length);
    if (rel && WD[rel[4]?.toLowerCase()] !== undefined) s = s.replace(RE_REL, ' ');
  } else if (rel) {
    date = relativeDate(rel, today);
    s = s.replace(RE_REL, ' ');
  } else {
    // Wiederkehrend ("dienstags 16 Uhr Schwimmen") oder gar kein Datum: Regeln der Zettel-Erkennung
    const [ev] = parseText(s, today);
    if (ev) return normalizeEvent({ ...ev, forWhom, location: location || ev.location });
    return null;
  }

  let times = findTimes(s);
  if (times) s = s.replace(times.match, ' ');
  // Tageszeit-Wörter: aus dem Titel nehmen, ohne Uhrzeit als grobe Zeit verwenden
  const part = s.match(RE_DAYPART);
  if (part) {
    s = s.replace(RE_DAYPART, ' ');
    if (!times) times = { start: DAYPART[part[1].toLowerCase().replace(/s$/, '')] || null, end: null };
  }
  const title = s.replace(/(?<![\p{L}])(um|am|ab|für)(?![\p{L}])/giu, ' ').replace(/\s+/g, ' ').replace(/^[\s,:;–-]+|[\s,:;–-]+$/g, '').trim();
  return normalizeEvent({
    title: title ? title[0].toUpperCase() + title.slice(1) : 'Termin',
    date, start: times?.start || null, end: times?.end || null, location, forWhom,
  });
}
