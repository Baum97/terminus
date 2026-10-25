// Termin-Erkennung ohne KI: Regeln für deutsche Datums- und Zeitangaben.
// Läuft komplett auf dem Gerät. Grundlage ist Text (eingefügt oder per OCR).
import { toISO, pad } from './dates.js';
import { normalizeEvents } from './events.js';

const MONTH_NAMES = [
  ['januar', 1], ['jänner', 1], ['jan', 1], ['februar', 2], ['feb', 2], ['märz', 3], ['maerz', 3],
  ['mrz', 3], ['mär', 3], ['april', 4], ['apr', 4], ['mai', 5], ['juni', 6], ['jun', 6], ['juli', 7],
  ['jul', 7], ['august', 8], ['aug', 8], ['september', 9], ['sept', 9], ['sep', 9], ['oktober', 10],
  ['okt', 10], ['november', 11], ['nov', 11], ['dezember', 12], ['dez', 12],
];
const MONTH_MAP = Object.fromEntries(MONTH_NAMES);
const MON = MONTH_NAMES.map((m) => m[0]).sort((a, b) => b.length - a.length).join('|');
const DASH = '(?:-|–|—|bis)';

const RE = {
  rangeNum: new RegExp(`(?<![\\d.])(\\d{1,2})\\.(?:(\\d{1,2})\\.(\\d{4}|\\d{2})?)?\\s*${DASH}\\s*(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?!\\d)`, 'giu'),
  rangeText: new RegExp(`(?<!\\d)(\\d{1,2})\\.?\\s*${DASH}\\s*(\\d{1,2})\\.?\\s*(${MON})\\.?(?![\\p{L}])(?:\\s*(\\d{4}))?`, 'giu'),
  text: new RegExp(`(?<!\\d)(\\d{1,2})\\.?\\s*(${MON})\\.?(?![\\p{L}])(?:\\s*(\\d{4}))?`, 'giu'),
  num: /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?![\d])/gu,
  iso: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/gu,
  timeRange: /(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr\s*)?(?:-|–|—|bis)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|h)(?![\p{L}])/giu,
  timeRangeColon: /(?<![\d.:])(\d{1,2}):(\d{2})\s*(?:-|–|—|bis)\s*(\d{1,2}):(\d{2})(?!\d)/gu,
  time: /(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr|h)(?![\p{L}])/giu,
  timeColon: /(?<![\d.:])(\d{1,2}):(\d{2})(?!\d)/gu,
  weekday: /(?<![\p{L}])(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|(?:mo|di|mi|do|fr|sa|so)(?=[.,]))[.,]?/giu,
  greeting: /^(liebe|lieber|hallo|hi|sehr geehrte|guten tag|moin|servus)\b/i,
  location: /(?:^|[\s,;])(?:ort|wo|treffpunkt|adresse|location|raum)\s*:\s*(.+)$/i,
  bring: /mitbring|mitzubring|mitnehmen|mitgeben|denkt an|nicht vergessen/i,
  cost: /(\d+(?:[.,]\d{1,2})?)\s?(?:€|euro|eur)(?![\p{L}])/iu,
  bullet: /^[-•*–·▪✓]\s*/,
};

function resolveDate(d, m, y, today) {
  d = +d; m = +m;
  if (!d || !m || d > 31 || m > 12) return null;
  let year;
  if (y) {
    year = +y;
    if (year < 100) year += 2000;
  } else {
    // Ohne Jahr: nächstes Vorkommen, mit etwas Toleranz für kürzlich Vergangenes.
    year = today.getFullYear();
    const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 60);
    if (new Date(year, m - 1, d) < limit) year++;
  }
  const dt = new Date(year, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return toISO(dt);
}

function mask(line, start, len) {
  return line.slice(0, start) + ' '.repeat(len) + line.slice(start + len);
}

function findDates(line, today) {
  const dates = [];
  let masked = line;
  const take = (re, fn) => {
    re.lastIndex = 0;
    for (const m of [...masked.matchAll(re)]) {
      const r = fn(m);
      if (!r || !r.date) continue;
      dates.push({ ...r, index: m.index, length: m[0].length });
      masked = mask(masked, m.index, m[0].length);
    }
  };
  take(RE.rangeNum, (m) => {
    const endDate = resolveDate(m[4], m[5], m[6], today);
    if (!endDate) return null;
    const endYear = endDate.slice(0, 4);
    let date = resolveDate(m[1], m[2] || m[5], m[3] || endYear, today);
    if (date && date > endDate) date = resolveDate(m[1], m[2] || m[5], +endYear - 1, today);
    return date ? { date, endDate } : null;
  });
  take(RE.rangeText, (m) => {
    const mon = MONTH_MAP[m[3].toLowerCase()];
    const endDate = resolveDate(m[2], mon, m[4], today);
    const date = endDate && resolveDate(m[1], mon, endDate.slice(0, 4), today);
    return date && date <= endDate ? { date, endDate } : null;
  });
  take(RE.text, (m) => ({ date: resolveDate(m[1], MONTH_MAP[m[2].toLowerCase()], m[3], today) }));
  take(RE.iso, (m) => ({ date: resolveDate(m[3], m[2], m[1], today) }));
  take(RE.num, (m) => ({ date: resolveDate(m[1], m[2], m[3], today) }));
  dates.sort((a, b) => a.index - b.index);
  return { dates, masked };
}

const WD_INDEX = { so: 0, sonntag: 0, mo: 1, montag: 1, di: 2, dienstag: 2, mi: 3, mittwoch: 3, do: 4, donnerstag: 4, fr: 5, freitag: 5, sa: 6, samstag: 6 };

// Steht ein Wochentag im Text, der nicht zum Datum passt, ist eins von beiden falsch.
function weekdayMismatch(line, iso) {
  RE.weekday.lastIndex = 0;
  const m = RE.weekday.exec(line);
  if (!m) return false;
  const wd = WD_INDEX[m[0].toLowerCase().replace(/[.,]$/, '')];
  const [y, mo, d] = iso.split('-').map(Number);
  return wd != null && new Date(y, mo - 1, d).getDay() !== wd;
}

const hm = (h, m) => (+h < 24 && +(m || 0) < 60 ? `${pad(+h)}:${pad(+(m || 0))}` : null);

export function findTimes(line) {
  for (const re of [RE.timeRangeColon, RE.timeRange]) {
    re.lastIndex = 0;
    const m = re.exec(line);
    if (m) {
      const start = hm(m[1], m[2]), end = hm(m[3], m[4]);
      if (start && end && end > start) return { start, end, match: m[0] };
    }
  }
  for (const re of [RE.time, RE.timeColon]) {
    re.lastIndex = 0;
    const m = re.exec(line);
    if (m) {
      const start = hm(m[1], m[2]);
      if (start) return { start, end: null, match: m[0] };
    }
  }
  return null;
}

const FILLER = /(?<![\p{L}])(am|den|um|ab|bis|findet|statt|wir|laden|ein|herzlich|ganz|euch|sie|alle|unser|unsere|unseren|unserem|feiern|gibt|es|ist|sind|wird|uhr|beginn|ende|ca|termin|datum|zeit|wann)(?![\p{L}])/giu;

function cleanTitle(text) {
  let t = text;
  for (const re of [RE.timeRangeColon, RE.timeRange, RE.time, RE.timeColon]) t = t.replace(re, ' ');
  t = t.replace(RE.weekday, ' ').replace(RE.location, ' ').replace(FILLER, ' ');
  t = t.replace(/^\s*(hey|hallo|hi|moin|servus|huhu)\b[!,.:]*/i, ' ');
  t = t.replace(/[()[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[\s:.,;!–-]+|[\s:,;–-]+$/g, '').replace(/[.!]+$/, '').trim();
  return t.length >= 3 ? t : '';
}

function looksLikeHeading(line) {
  return line && line.length >= 3 && line.length <= 60 && !RE.greeting.test(line) && !/[.,]$/.test(line);
}

function findLocation(lines) {
  for (const l of lines) {
    const m = l.match(RE.location);
    if (m) return m[1].replace(/[.;]+$/, '').trim();
  }
  return '';
}

function findBring(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (!RE.bring.test(lines[i])) continue;
    const after = lines[i].includes(':') ? lines[i].slice(lines[i].indexOf(':') + 1).trim() : '';
    let items = [];
    if (after) {
      items = after.replace(/[.!]+$/, '').split(/,|;|\s+und\s+/);
    } else {
      const bulleted = RE.bullet.test(lines[i + 1] || '');
      for (const l of lines.slice(i + 1, i + 9)) {
        if (!l) break;
        if (bulleted ? RE.bullet.test(l) : l.length < 32 && !/[.!?]$/.test(l)) items.push(l.replace(RE.bullet, ''));
        else break;
      }
    }
    items = items.map((s) => s.trim()).filter((s) => s && s.length < 60);
    if (items.length) return items;
    // Ganzer Satz wie "Bitte Laterne und Teelicht mitbringen."
    const m = lines[i].match(/bitte\s+(.+?)\s+(?:mitbringen|mitnehmen|mitgeben)/i);
    if (m) return m[1].split(/,|\s+und\s+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function findCost(lines) {
  for (const l of lines) {
    const m = l.match(RE.cost);
    if (m) return `${m[1].replace('.', ',')} €`;
  }
  return '';
}

// Steht vor dem Datum "bis", "spätestens" oder "Anmeldeschluss", ist es eine Frist.
const FRIST_BEFORE = /(?:bis|spätestens|anmeldeschluss|abgabeschluss|einsendeschluss|frist|deadline)(?:\s+(?:zum|zur|am|den|spätestens|einschließlich|kommenden))*[\s:,]*(?:(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\.?,?\s*)?(?:den\s+)?$/i;
const FRIST_ACTION = /anmeld|melde[nt]?\b.*\ban\b|anmeldeschluss|rückmeld|zurück|abgeb|abgabe|einreich|einsend|überweis|bezahl|zahlen|einzahl|mitgeb|unterschr|bescheid|frist/i;
const FRIST_LABELS = [
  [/anmeld|melde[nt]?\b.*\ban\b/i, 'Anmeldung'],
  [/rückmeld|zurück|unterschr|bescheid/i, 'Rückmeldung'],
  [/überweis|bezahl|zahlen|einzahl|€|euro/i, 'Bezahlen'],
  [/abgeb|abgabe|einreich|einsend/i, 'Abgabe'],
  [/mitgeb/i, 'Mitgeben'],
];

function isFrist(line, index) {
  const before = line.slice(Math.max(0, index - 40), index);
  if (!FRIST_BEFORE.test(before)) return false;
  return /schluss|frist|deadline|spätestens/i.test(before) || FRIST_ACTION.test(line);
}

function fristLabel(line) {
  for (const [re, label] of FRIST_LABELS) if (re.test(line)) return label;
  return 'Frist';
}

// Wiederkehrende Termine: "dienstags", "jeden Montag", "alle zwei Wochen"
const WD_NAMES = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
const RE_WEEKLY = /(?<![\p{L}])(?:(?:jeden|jede[nm]?|immer)\s+(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)|(sonntag|montag|dienstag|mittwoch|donnerstag|freitag|samstag)s)(?![\p{L}])/iu;
const RE_INTERVAL = /alle\s+(zwei|2|drei|3|vier|4)\s+wochen|(14|vierzehn)[\s-]?tägig|zweiwöchentlich/i;
const RE_UNTIL_HOLIDAY = /bis\s+(?:zu\s+den|zum\s+beginn\s+der|vor\s+den)\s+(herbst|weihnachts|winter|oster|pfingst|sommer|faschings|fastnachts)ferien/i;
const RE_DAILY = /(?<![\p{L}])(täglich|jeden tag)(?![\p{L}])/iu;
const RE_MONTHLY = /(?<![\p{L}])(monatlich|jeden monat)(?![\p{L}])/iu;
const INTERVAL_WORDS = { zwei: 2, drei: 3, vier: 4, 14: 2, vierzehn: 2 };

function findRepeat(line, opts) {
  const weekly = line.match(RE_WEEKLY);
  const freq = weekly ? 'weekly' : RE_DAILY.test(line) ? 'daily' : RE_MONTHLY.test(line) ? 'monthly' : null;
  if (!freq) return null;
  const iv = line.match(RE_INTERVAL);
  const interval = iv ? INTERVAL_WORDS[(iv[1] || iv[2]).toLowerCase()] || +(iv[1] || iv[2]) || 1 : 1;
  let until = null;
  const hol = line.match(RE_UNTIL_HOLIDAY);
  if (hol && opts.holidayStart) {
    const startOfHoliday = opts.holidayStart(hol[1].toLowerCase());
    if (startOfHoliday) until = addDaysISO(startOfHoliday, -1);
  }
  const weekday = weekly ? WD_NAMES.indexOf((weekly[1] || weekly[2]).toLowerCase()) : null;
  return { freq, interval, until, weekday, match: weekly?.[0] || '' };
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + n));
}

function nextWeekday(today, weekday, from = null) {
  const d = from ? new Date(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10)) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  return toISO(d);
}

// opts.holidayStart(name): Beginn der nächsten Ferien dieses Namens ("oster" → "2027-03-29")
export function parseText(text, today = new Date(), opts = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const hits = [];
  lines.forEach((line, i) => {
    const r = findDates(line, today);
    const repeat = findRepeat(line, opts);
    // "bis 31.03." in einer Wiederholungszeile ist das Ende der Serie, kein eigener Termin.
    if (repeat && r.dates.length) {
      const last = r.dates[r.dates.length - 1];
      if (/bis\s*(?:zum\s*)?(?:\S+\s*)?$/i.test(line.slice(Math.max(0, last.index - 12), last.index)) && r.dates.length >= 1) {
        repeat.until = repeat.until || last.date;
        r.dates.pop();
      }
    }
    if (repeat && !r.dates.length && repeat.weekday != null) {
      r.dates.push({ date: nextWeekday(today, repeat.weekday), index: 0, synthetic: true });
    }
    let prevEnd = 0;
    for (const d of r.dates) {
      d.frist = !d.endDate && !d.synthetic && isFrist(line, d.index);
      // Wort für die Frist aus dem Satzteil direkt um dieses Datum ("überweist 12 € bis 6.11.")
      d.clause = line.slice(prevEnd, d.index + (d.length || 0) + 15);
      prevEnd = d.index + (d.length || 0);
    }
    if (r.dates.length) hits.push({ i, ...r, repeat });
  });
  const heading = lines.find((l, i) => looksLikeHeading(l) && !hits.some((h) => h.i === i)) || '';
  const termDates = hits.flatMap((h) => h.dates.filter((d) => !d.frist));
  const single = termDates.length === 1;

  const events = [];
  hits.forEach((h, hi) => {
    const nextHit = hi + 1 < hits.length ? hits[hi + 1].i : lines.length;
    const block = lines.slice(h.i, Math.min(nextHit, h.i + 8));
    const scope = single ? lines : block;
    const onlyFrist = h.dates.every((d) => d.frist);

    let times = findTimes(h.masked);
    if (!times && !onlyFrist) for (const l of block.slice(1)) if ((times = findTimes(l))) break;
    if (times && !times.end) {
      for (const l of block) {
        const m = l.match(/(?:ende|bis)\D{0,8}?(\d{1,2})(?:[:.](\d{2}))?\s*uhr/i);
        const end = m && hm(m[1], m[2]);
        if (end && end > times.start) { times = { ...times, end }; break; }
      }
    }

    let titleSource = h.masked;
    if (h.repeat?.match) titleSource = titleSource.replace(h.repeat.match, ' ');
    titleSource = titleSource.replace(RE_INTERVAL, ' ').replace(RE_UNTIL_HOLIDAY, ' ').replace(RE_DAILY, ' ').replace(RE_MONTHLY, ' ').replace(/(?<![\p{L}])(ab|bis)\s*$/iu, ' ');
    let title = cleanTitle(titleSource);
    // Ein ganzer Satz ("fahren wir in den Wildpark. Abfahrt …") taugt nicht als Titel: dann die Überschrift darüber.
    const sentence = /^\p{Ll}/u.test(title) || /[.!?]\s/.test(title);
    if (!title || title.length > 50 || sentence) {
      const prev = lines.slice(Math.max(0, h.i - 3), h.i).reverse().find((l) => looksLikeHeading(l) && !findDates(l, today).dates.length);
      title = (single ? heading : prev) || (sentence ? '' : title.slice(0, 50)) || heading || title.slice(0, 50) || 'Termin';
    }
    if (single && !onlyFrist && heading && heading.length <= 50 && (title.split(' ').length > 6 || /einladung|termin|fest|feier|abend|treffen|ausflug|fahrt|besuch|konzert|aufführung|versammlung|sprechtag|turnier/i.test(heading))) {
      title = heading.replace(/^einladung\s+(zum|zur|zu)\s+/i, '');
    }

    const location = onlyFrist ? '' : findLocation(scope);
    const bring = onlyFrist ? [] : findBring(scope);
    const cost = findCost(onlyFrist ? [lines[h.i]] : scope);

    for (const d of h.dates) {
      if (d.frist) {
        events.push({ kind: 'frist', title: fristLabel(d.clause), date: d.date, cost: findCost([d.clause]), context: true });
        continue;
      }
      events.push({
        title, date: d.date, endDate: d.endDate || null,
        start: d.endDate ? null : times?.start || null,
        end: d.endDate ? null : times?.end || null,
        location, bring, cost,
        repeat: h.repeat ? { freq: h.repeat.freq, interval: h.repeat.interval, until: h.repeat.until } : null,
        unsure: title === 'Termin' || (h.dates.length === 1 && !d.synthetic && weekdayMismatch(lines[h.i], d.date)),
      });
    }
  });

  // Fristen bekommen den Anlass dazu: "Anmeldung: Ausflug Wildpark"
  const main = events.filter((e) => e.kind !== 'frist');
  const context = main.length === 1 ? main[0].title : heading.replace(/^einladung\s+(zum|zur|zu)\s+/i, '');
  for (const e of events) {
    if (e.context) {
      if (context && context.length <= 40) e.title = `${e.title}: ${context}`;
      delete e.context;
    }
  }
  return normalizeEvents(events);
}
