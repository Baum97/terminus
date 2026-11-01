// Ämtchenplan: Aufgaben reihum (Müll, Kochen, Bad putzen). Jede Person bekommt eine eigene Serie,
// versetzt um ihren Platz in der Reihe – so wechselt es ab, ohne dass Terminus etwas nachpflegen muss.
import { addDays } from './dates.js';
import { normalizeEvent } from './events.js';

// { task, members: ['Ben', 'Mia'], freq: 'daily'|'weekly', start: ISO, time?: 'HH:MM', until?: ISO }
export function rotationEvents({ task, members, freq = 'weekly', start, time = null, until = null }) {
  const people = [...new Set((members || []).map((m) => String(m).trim()).filter(Boolean))].slice(0, 8);
  if (!task || !people.length || !start) return [];
  const step = freq === 'daily' ? 1 : 7;
  return people.map((name, i) => normalizeEvent({
    title: `${task}: ${name}`,
    date: addDays(start, i * step),
    start: time,
    end: null,
    responsible: name,
    forWhom: [name],
    repeat: people.length === 1 && freq === 'daily' ? { freq: 'daily', interval: 1, until } : { freq, interval: people.length, until },
    notes: `Ämtchenplan: ${people.join(' → ')} (${freq === 'daily' ? 'täglich' : 'wöchentlich'} reihum)`,
  })).filter(Boolean);
}
