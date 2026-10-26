// Einheitliche Kalendereinträge für Ansicht, Aufgaben und Widget-Logik, egal ob sie aus dem
// Handykalender (über CalDAV/DAVx⁵ synchronisiert), der Merkliste oder den Geburtstagen kommen.
import { toISO, fromISO, addDays, pad } from './dates.js';
import { parseDescription, describeEvent } from './desc.js';

const DONE_PREFIX = '✓ ';
const FRIST_SUFFIX = ' (Frist)';

// Item: { key, source, id, calendarId, calendar, color, title, date, endDate, start, end, allDay,
//         location, meta, frist, done, recurring, birthday }
function decorate(item, rawTitle) {
  let title = rawTitle || 'Termin';
  const done = title.startsWith(DONE_PREFIX);
  if (done) title = title.slice(DONE_PREFIX.length);
  const frist = title.endsWith(FRIST_SUFFIX);
  if (frist) title = title.slice(0, -FRIST_SUFFIX.length);
  return { ...item, title, frist, done };
}

const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function fromDevice(raw) {
  const begin = new Date(raw.begin);
  const end = new Date(raw.end);
  let date, endDate = null, start = null, stop = null;
  if (raw.allDay) {
    // Ganztägige Termine liegen in UTC, Ende exklusiv.
    date = begin.toISOString().slice(0, 10);
    const last = addDays(end.toISOString().slice(0, 10), -1);
    if (last > date) endDate = last;
  } else {
    date = toISO(begin);
    start = hm(begin);
    stop = hm(end);
    if (toISO(end) !== date && end - begin > 0) endDate = toISO(new Date(raw.end - 1));
  }
  return decorate({
    key: `d:${raw.id}:${raw.begin}`, source: 'device', id: raw.id, begin: raw.begin, calendarId: raw.calendarId, calendar: raw.calendar,
    color: raw.color || '#2443C4', date, endDate, start, end: stop, allDay: !!raw.allDay,
    location: raw.location || '', description: raw.description || '', meta: parseDescription(raw.description || ''),
    recurring: !!raw.recurring,
  }, raw.title);
}

// Gemerkte Terminus-Termine (Web-Version) mit aufgeklappten Wiederholungen
export function fromLocal(ev, from, to) {
  const dates = occurrences(ev, from, to);
  return dates.map((date) => {
    const span = ev.endDate ? Math.round((fromISO(ev.endDate) - fromISO(ev.date)) / 86400000) : 0;
    return {
      key: `l:${ev.id}:${date}`, source: 'local', id: ev.id, occurrence: date, calendarId: 'local', calendar: 'Gemerkt', color: '#2443C4',
      title: ev.title, frist: ev.kind === 'frist', done: !!ev.completed, date, endDate: span ? addDays(date, span) : null,
      start: ev.start, end: ev.end, allDay: !ev.start, location: ev.location, description: describeEvent(ev),
      meta: parseDescription(describeEvent(ev)), recurring: !!ev.repeat,
    };
  });
}

// Alle Termine einer Serie zwischen from und to (ISO, inklusive), höchstens 400
export function occurrences(ev, from, to) {
  const last = ev.endDate || ev.date;
  if (!ev.repeat) return last >= from && ev.date <= to ? [ev.date] : [];
  const out = [];
  const { freq, interval = 1, until } = ev.repeat;
  const end = until && until < to ? until : to;
  const first = fromISO(ev.date);
  for (let i = 0; out.length < 400; i++) {
    const d = new Date(first);
    if (freq === 'daily') d.setDate(d.getDate() + i * interval);
    else if (freq === 'weekly') d.setDate(d.getDate() + i * 7 * interval);
    else {
      d.setMonth(first.getMonth() + i * interval);
      if (d.getDate() !== first.getDate()) continue; // 31. gibt es nicht in jedem Monat
    }
    const iso = toISO(d);
    if (iso > end) break;
    if (iso >= from && !(ev.exdates || []).includes(iso)) out.push(iso);
    if (i > 5000) break;
  }
  return out;
}

// Geburtstage: date "1950-03-14", "--03-14" oder "19500314"
export function birthdayItems(list, from, to) {
  const out = [];
  for (const b of list) {
    const m = String(b.date || '').match(/^(?:(\d{4})|--)-?(\d{2})-?(\d{2})/);
    if (!m) continue;
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      const date = `${y}-${m[2]}-${m[3]}`;
      if (date < from || date > to || toISO(fromISO(date)) !== date) continue;
      const age = m[1] ? y - +m[1] : null;
      out.push({
        key: `b:${b.name}:${date}`, source: 'birthday', id: null, calendar: 'Geburtstage', color: '#C8312B',
        title: `${b.name}${age && age > 0 && age < 130 ? ` wird ${age}` : ' hat Geburtstag'}`, date, endDate: null,
        start: null, end: null, allDay: true, location: '', description: '', meta: parseDescription(''), birthday: true,
        frist: false, done: false,
      });
    }
  }
  return out;
}

export function itemsOnDay(items, iso) {
  return items
    .filter((i) => i.date <= iso && (i.endDate || i.date) >= iso)
    .sort((a, b) => (a.allDay === b.allDay ? (a.start || '').localeCompare(b.start || '') || a.title.localeCompare(b.title, 'de') : a.allDay ? -1 : 1));
}

export function matchesPerson(item, name) {
  if (!name) return true;
  return item.meta.forWhom.includes(name) || item.meta.responsible === name;
}

// Titel für den Kalender nach dem Abhaken einer Frist
export function titleWithDone(item, done) {
  return `${done ? DONE_PREFIX : ''}${item.title}${item.frist ? FRIST_SUFFIX : ''}`;
}

// Montag der Woche
export function weekStart(iso) {
  const d = fromISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}

// 6 Wochen ab dem Montag vor dem Monatsersten
export function monthGrid(year, month) {
  const first = toISO(new Date(year, month, 1));
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
