// Brückentage: mit wenigen Urlaubstagen möglichst viele freie Tage am Stück.
import { publicHolidays } from './holidays.js';
import { addDays, toISO, fromISO } from './dates.js';

// Vorschläge für ein Jahr und Bundesland: [{ start, end, vacation: [ISO], free, holidays: [Name] }]
export function bridgeDays(year, state = '', { maxVacation = 5, from = null } = {}) {
  const hol = new Map([...publicHolidays(year - 1, state), ...publicHolidays(year, state), ...publicHolidays(year + 1, state)].map((h) => [h.date, h.name]));
  const isOff = (iso) => {
    const wd = fromISO(iso).getDay();
    return wd === 0 || wd === 6 || hol.has(iso);
  };
  const out = [];
  for (const [hDate] of hol) {
    if (!hDate.startsWith(String(year)) || (from && hDate < from)) continue;
    // Fenster um den Feiertag: links und rechts bis zu maxVacation Arbeitstage dazunehmen
    for (let left = 0; left <= 8; left++) {
      for (let right = 0; right <= 8; right++) {
        let start = addDays(hDate, -left), end = addDays(hDate, right);
        // Fenster bis an benachbarte freie Tage ausdehnen
        while (isOff(addDays(start, -1))) start = addDays(start, -1);
        while (isOff(addDays(end, 1))) end = addDays(end, 1);
        const vacation = [];
        for (let d = start; d <= end; d = addDays(d, 1)) if (!isOff(d)) vacation.push(d);
        if (!vacation.length || vacation.length > maxVacation) continue;
        if (!isOff(start) || !isOff(end)) continue;
        const free = Math.round((fromISO(end) - fromISO(start)) / 86400000) + 1;
        const names = [];
        for (let d = start; d <= end; d = addDays(d, 1)) if (hol.has(d) && !names.includes(hol.get(d))) names.push(hol.get(d));
        out.push({ start, end, vacation, free, holidays: names, ratio: free / vacation.length });
      }
    }
  }
  // Beste je Zeitraum: gleiches Ergebnis nur einmal, Überlappungen zugunsten des besseren Verhältnisses
  const uniq = [...new Map(out.map((o) => [`${o.start}|${o.end}`, o])).values()]
    .filter((o) => o.free >= 4 && o.ratio >= 2)
    .sort((a, b) => b.ratio - a.ratio || b.free - a.free);
  const picked = [];
  for (const o of uniq) {
    const overlap = picked.find((p) => o.start <= p.end && o.end >= p.start);
    if (!overlap) picked.push(o);
    else if (o.vacation.length > overlap.vacation.length && o.free >= overlap.free + 3 && !picked.some((p) => p !== overlap && o.start <= p.end && o.end >= p.start)) {
      // größere Variante (z. B. ganze Osterwoche) zusätzlich anbieten, wenn sie deutlich mehr bringt
      picked.push({ ...o, alt: true });
    }
  }
  return picked.sort((a, b) => a.start.localeCompare(b.start)).map(({ ratio, ...o }) => o);
}

export const _today = () => toISO(new Date());
