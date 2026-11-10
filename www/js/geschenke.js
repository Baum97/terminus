// Geschenkideen: übers Jahr sammeln, eine Woche vor dem Geburtstag kommt die Erinnerung mit der Liste.
import { addDays, toISO } from './dates.js';
import { normalizeEvent } from './events.js';

// "1950-03-14", "--03-14", "19500314", "14.03." → "03-14"
export function monthDay(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(?:\d{4}|--)-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = t.match(/^(\d{1,2})\.(\d{1,2})\./);
  return m ? `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

export function nextBirthday(md, today = new Date()) {
  const now = toISO(today);
  for (let y = today.getFullYear(); y <= today.getFullYear() + 8; y++) {
    const iso = `${y}-${md}`;
    const d = new Date(y, +md.slice(0, 2) - 1, +md.slice(3, 5));
    if (toISO(d) === iso && iso >= now) return iso;
  }
  return null;
}

export const daysUntil = (iso, today = new Date()) => Math.round((new Date(`${iso}T00:00:00`) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);

// Jährliche Erinnerung eine Woche vorher, mit den aktuellen Ideen
export function giftReminder(person, today = new Date()) {
  const next = nextBirthday(person.md, today);
  if (!next) return null;
  let date = addDays(next, -7);
  if (date < toISO(today)) date = addDays(`${+next.slice(0, 4) + 1}-${person.md}`, -7);
  const open = (person.ideas || []).filter((i) => !i.done).map((i) => i.text);
  return normalizeEvent({
    title: `🎁 Geschenk für ${person.name}`, date, kind: 'termin', repeat: { freq: 'yearly', interval: 1 },
    notes: `Geburtstag am ${+person.md.slice(3, 5)}.${+person.md.slice(0, 2)}. in einer Woche.${open.length ? `\nIdeen: ${open.join(', ')}` : ''}\nAlle Ideen: Terminus → Gemeinsam → Geschenkideen`,
  });
}
