// Gesetzliche Feiertage (offline berechnet) und Schulferien (data/ferien.json, beim Build
// aus der OpenHolidays-API erzeugt) je Bundesland.
import { toISO, addDays } from './dates.js';
import { occurrences } from './calendar.js';

export const STATES = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg',
  HE: 'Hessen', MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz', SL: 'Saarland', SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};

// Ostersonntag nach der Gaußschen Osterformel (Anonymer Gregorianischer Algorithmus)
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Nur landesweite Feiertage. Feiertage einzelner Gemeinden (Fronleichnam in Teilen Sachsens und
// Thüringens, Mariä Himmelfahrt in Teilen Bayerns, Augsburger Friedensfest) fehlen bewusst.
export function publicHolidays(year, state = '') {
  const e = toISO(easter(year));
  const fix = (m, d) => `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const list = [
    [fix(1, 1), 'Neujahr'],
    [addDays(e, -2), 'Karfreitag'],
    [addDays(e, 1), 'Ostermontag'],
    [fix(5, 1), 'Tag der Arbeit'],
    [addDays(e, 39), 'Christi Himmelfahrt'],
    [addDays(e, 50), 'Pfingstmontag'],
    [fix(10, 3), 'Tag der Deutschen Einheit'],
    [fix(12, 25), '1. Weihnachtstag'],
    [fix(12, 26), '2. Weihnachtstag'],
  ];
  const only = (states, date, name) => states.includes(state) && list.push([date, name]);
  only(['BW', 'BY', 'ST'], fix(1, 6), 'Heilige Drei Könige');
  only(['BE', 'MV'], fix(3, 8), 'Internationaler Frauentag');
  only(['BB'], e, 'Ostersonntag');
  only(['BB'], addDays(e, 49), 'Pfingstsonntag');
  only(['BW', 'BY', 'HE', 'NW', 'RP', 'SL'], addDays(e, 60), 'Fronleichnam');
  only(['SL'], fix(8, 15), 'Mariä Himmelfahrt');
  only(['TH'], fix(9, 20), 'Weltkindertag');
  only(['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'], fix(10, 31), 'Reformationstag');
  only(['BW', 'BY', 'NW', 'RP', 'SL'], fix(11, 1), 'Allerheiligen');
  if (state === 'SN') {
    // Buß- und Bettag: Mittwoch vor dem 23. November
    const d = new Date(year, 10, 22);
    while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
    list.push([toISO(d), 'Buß- und Bettag']);
  }
  return list.map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
}

let ferien = null;

// Erwartetes Format: { "BY": [{ "name": "Herbstferien", "start": "2026-11-02", "end": "2026-11-06" }], … }
export async function loadSchoolHolidays(url = 'data/ferien.json') {
  if (ferien) return ferien;
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    ferien = res.ok ? await res.json() : {};
  } catch {
    ferien = {};
  }
  return ferien;
}

export function setSchoolHolidays(data) {
  ferien = data || {};
}

export function schoolHolidays(state) {
  return (ferien && ferien[state]) || [];
}

// Hinweise für einen Termin: Feiertag oder Schulferien an einem seiner Tage.
export function holidayNotes(ev, state = '') {
  const notes = [];
  const days = [];
  for (let d = ev.date; d <= (ev.endDate || ev.date) && days.length < 62; d = addDays(d, 1)) days.push(d);
  const years = [...new Set(days.map((d) => +d.slice(0, 4)))];
  const holidays = years.flatMap((y) => publicHolidays(y, state));
  for (const h of holidays) if (days.includes(h.date)) notes.push({ type: 'feiertag', text: `Feiertag: ${h.name}` });
  if (state && !ev.endDate) {
    const f = schoolHolidays(state).find((p) => ev.date >= p.start && ev.date <= p.end);
    if (f) notes.push({ type: 'ferien', text: `In den ${f.name}` });
  }
  return notes;
}

// Für "bis zu den Osterferien": Beginn der nächsten Ferien, deren Name so anfängt.
export function holidayStartFinder(state, today = new Date()) {
  const now = toISO(today);
  return (key) => {
    const hit = schoolHolidays(state)
      .filter((p) => p.end >= now && p.name.toLowerCase().startsWith(key))
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    return hit ? hit.start : null;
  };
}

// Termine einer Serie, die in die Schulferien oder auf einen Feiertag fallen (höchstens ein Jahr voraus)
export function holidayExdates(ev, state) {
  if (!ev.repeat) return [];
  const to = ev.repeat.until || addDays(ev.date, 366);
  const dates = occurrences({ ...ev, exdates: [] }, ev.date, to);
  const years = [...new Set(dates.map((d) => +d.slice(0, 4)))];
  const feiertage = new Set(years.flatMap((y) => publicHolidays(y, state).map((h) => h.date)));
  const ferien = state ? schoolHolidays(state) : [];
  return dates.filter((d) => feiertage.has(d) || ferien.some((p) => d >= p.start && d <= p.end));
}
