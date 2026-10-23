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
      dates.push({ ...r, index: m.index });
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

export function parseText(text, today = new Date()) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
  const hits = [];
  lines.forEach((line, i) => {
    const r = findDates(line, today);
    if (r.dates.length) hits.push({ i, ...r });
  });
  const heading = lines.find((l, i) => looksLikeHeading(l) && !hits.some((h) => h.i === i)) || '';
  const single = hits.length === 1 && hits[0].dates.length === 1;

  const events = [];
  hits.forEach((h, hi) => {
    const nextHit = hi + 1 < hits.length ? hits[hi + 1].i : lines.length;
    const block = lines.slice(h.i, Math.min(nextHit, h.i + 8));
    const scope = single ? lines : block;

    let times = findTimes(h.masked);
    if (!times) for (const l of block.slice(1)) if ((times = findTimes(l))) break;
    if (times && !times.end) {
      for (const l of block) {
        const m = l.match(/(?:ende|bis)\D{0,8}?(\d{1,2})(?:[:.](\d{2}))?\s*uhr/i);
        const end = m && hm(m[1], m[2]);
        if (end && end > times.start) { times = { ...times, end }; break; }
      }
    }

    let title = cleanTitle(h.masked);
    if (!title || title.length > 50) {
      const prev = lines.slice(Math.max(0, h.i - 3), h.i).reverse().find((l) => looksLikeHeading(l) && !findDates(l, today).dates.length);
      title = (single ? heading : prev) || title.slice(0, 50) || heading || 'Termin';
    }
    if (single && heading && heading.length <= 50 && (title.split(' ').length > 6 || /einladung|termin|fest|feier|abend|treffen/i.test(heading))) {
      title = heading.replace(/^einladung\s+(zum|zur|zu)\s+/i, '');
    }

    const location = findLocation(scope);
    const bring = findBring(scope);
    const cost = findCost(scope);

    for (const d of h.dates) {
      events.push({
        title, date: d.date, endDate: d.endDate || null,
        start: d.endDate ? null : times?.start || null,
        end: d.endDate ? null : times?.end || null,
        location, bring, cost,
        unsure: title === 'Termin' || (h.dates.length === 1 && weekdayMismatch(lines[h.i], d.date)),
      });
    }
  });
  return normalizeEvents(events);
}
