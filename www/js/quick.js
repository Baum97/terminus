// Schnelleingabe: eine Zeile wird ein Termin, ohne Datum eine Aufgabe.
//   "Mi 16 Uhr Zahnarzt Ben"  ·  "morgen 8:30 Elterngespräch @ Schule"  ·  "nächsten Freitag Kuchen backen für Mia"
//   "Milch kaufen" (Aufgabe)  ·  "Einkauf: Milch, Eier, Brot" (Aufgabe mit Unterpunkten)
import { toISO, addDays } from './dates.js';
import { parseText, findTimes, findDates } from './parse.js';
import { normalizeEvent } from './events.js';
import { splitTitled } from './listen.js';

const WD = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6 };
const RE_REL = /(?<![\p{L}])(heute|morgen|übermorgen|in\s+(\d+|zwei|drei|vier|fünf)\s+tagen|(?:(nächste[nrs]?|kommende[nrs]?|am)\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\.?)(?![\p{L}])/iu;
const NUM = { zwei: 2, drei: 3, vier: 4, fünf: 5 };
const RE_SERIES = /(?<![\p{L}])((montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)s|jeden|jede[nm]?\s|immer\s|täglich|monatlich|alle\s+\S+\s+wochen)(?![\p{L}])/iu;
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

  // Wiederholungen ("dienstags … bis 26.01.") übernimmt die Serien-Regel der Zettel-Erkennung
  if (RE_SERIES.test(s)) {
    const [ev] = parseText(s, today);
    if (ev) return normalizeEvent({ ...ev, forWhom, location: location || ev.location });
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
    return quickTask(s, forWhom);
  }

  let times = findTimes(s);
  if (times) s = s.replace(times.match, ' ');
  // Tageszeit-Wörter: aus dem Titel nehmen, ohne Uhrzeit als grobe Zeit verwenden
  const part = s.match(RE_DAYPART);
  if (part) {
    s = s.replace(RE_DAYPART, ' ');
    if (!times) times = { start: DAYPART[part[1].toLowerCase().replace(/s$/, '')] || null, end: null };
  }
  // Füllwörter raus, auch ein übrig gebliebenes „bis“/„zum“ am Ende („unterschreiben bis Freitag“)
  const title = s.replace(/(?<![\p{L}])(um|am|ab|für)(?![\p{L}])/giu, ' ').replace(/\s+/g, ' ').replace(/^[\s,:;–-]+|[\s,:;–-]+$/g, '').trim()
    .replace(/\s+(bis|zum|zur|vom|von|den|spätestens)$/i, '').replace(/^(bis|spätestens)\s+/i, '').trim();
  // „… bis Freitag“ ohne Uhrzeit ist eine Frist (bis zu diesem Tag erledigen)
  const frist = !times?.start && /(?<![\p{L}])(bis|spätestens)(?![\p{L}])/iu.test(text);
  // „Einkauf: Milch, Eier bis Samstag“: Aufgabe mit Unterpunkten, das Datum ist „bis wann“
  const list = !times?.start && splitTitled(title);
  if (list && list.items.length >= 2) return normalizeEvent({ kind: 'aufgabe', title: list.title, items: list.items, date, forWhom });
  return normalizeEvent({
    title: title ? title[0].toUpperCase() + title.slice(1) : 'Termin',
    date, start: times?.start || null, end: times?.end || null, location, forWhom, kind: frist ? 'frist' : 'termin',
  });
}

// Ohne Datum: eine Aufgabe. Mit Doppelpunkt („Einkauf: Milch, Eier“) mit Unterpunkten.
function quickTask(text, forWhom) {
  const s = String(text).replace(/\s+/g, ' ').replace(/^[\s,–-]+|[\s,–-]+$/g, '').trim();
  if (!s) return null;
  const list = splitTitled(s);
  if (list) return normalizeEvent({ kind: 'aufgabe', title: list.title, items: list.items, forWhom });
  return normalizeEvent({ kind: 'aufgabe', title: s[0].toUpperCase() + s.slice(1), forWhom });
}
