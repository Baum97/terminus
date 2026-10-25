// Datums-Helfer. Alle Daten sind lokale Kalendertage als "YYYY-MM-DD",
// Uhrzeiten als "HH:MM" (Europe/Berlin wird erst beim Export gesetzt).

export const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(fromISO(s)) === s;
}

export function normTime(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// ISO-Kalenderwoche, wie sie in Deutschland auf jedem Kalender steht.
export function isoWeek(iso) {
  const d = fromISO(iso);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

export const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const WD_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function fmtDate(iso, withYear = true) {
  const d = fromISO(iso);
  return `${WD_SHORT[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${withYear ? d.getFullYear() : ''}`;
}

// "Fr, 14.11.2026 · 17:00–18:30 Uhr" bzw. "Mo, 27.10. – Fr, 31.10.2026"
export function fmtWhen(ev) {
  if (ev.endDate && ev.endDate !== ev.date) {
    return `${fmtDate(ev.date, false)} – ${fmtDate(ev.endDate)}`;
  }
  const day = fmtDate(ev.date);
  if (!ev.start) return `${day} · ganztägig`;
  return `${day} · ${ev.start}${ev.end ? '–' + ev.end : ''} Uhr`;
}

export const toMinutes = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// "jeden Dienstag", "alle 2 Wochen dienstags", "täglich", "monatlich am 27." und ggf. "bis 21.03.2027"
export function fmtRepeat(ev) {
  const r = ev.repeat;
  if (!r) return '';
  const d = fromISO(ev.date);
  let text;
  if (r.freq === 'daily') text = r.interval > 1 ? `alle ${r.interval} Tage` : 'täglich';
  else if (r.freq === 'monthly') text = `${r.interval > 1 ? `alle ${r.interval} Monate` : 'monatlich'} am ${d.getDate()}.`;
  else text = r.interval > 1 ? `alle ${r.interval} Wochen ${WEEKDAYS[d.getDay()].toLowerCase()}s` : `jeden ${WEEKDAYS[d.getDay()]}`;
  return r.until ? `${text} bis ${fmtDate(r.until)}` : text;
}
