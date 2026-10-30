// Ablauf-Wächter: Ausweis, TÜV, Verträge, Garantie. Terminus erinnert rechtzeitig vorher,
// nicht erst am Stichtag. Reine Logik, die Oberfläche steht in ablaufui.js.
import { addDays, fmtDate, isValidISO, toISO } from './dates.js';
import { normalizeEvent } from './events.js';

// lead: Tage Vorlauf; notice: Kündigungsfrist in Monaten (nur Verträge)
export const KINDS = {
  ausweis: { label: 'Personalausweis', lead: 56, todo: 'Neuen Ausweis beim Bürgeramt beantragen (Bearbeitung dauert einige Wochen).' },
  pass: { label: 'Reisepass', lead: 70, todo: 'Neuen Pass beim Bürgeramt beantragen (Bearbeitung dauert bis zu sechs Wochen).' },
  fuehrerschein: { label: 'Führerschein', lead: 56, todo: 'Neuen Kartenführerschein bei der Führerscheinstelle beantragen.' },
  tuev: { label: 'TÜV / Hauptuntersuchung', lead: 28, todo: 'Termin für die Hauptuntersuchung machen.', month: true },
  vertrag: { label: 'Vertrag oder Abo', lead: 14, notice: 1, todo: 'Prüfen: verlängern lassen, wechseln oder kündigen.' },
  versicherung: { label: 'Versicherung', lead: 14, notice: 1, todo: 'Prüfen: verlängern lassen, wechseln oder kündigen.' },
  garantie: { label: 'Garantie', lead: 28, todo: 'Mängel jetzt noch reklamieren.' },
  sonstiges: { label: 'Sonstiges', lead: 28, todo: '' },
};

const monthsBefore = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

// TÜV-Plakette nennt nur den Monat: "2027-05" → letzter Tag im Mai
export function endOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

// item: { kind, name, expires (ISO), notice? (Monate) } → Frist-Termin oder null
export function reminderFor(item, today = new Date()) {
  const k = KINDS[item.kind] || KINDS.sonstiges;
  if (!isValidISO(item.expires)) return null;
  const what = item.name ? `${k.label}: ${item.name}` : k.label;
  const notice = k.notice != null ? Math.max(0, Math.min(24, +(item.notice ?? k.notice) || 0)) : 0;
  // Verträge: bis zum letzten Kündigungstag, mit Vorlauf; sonst Ablaufdatum minus Vorlauf
  const deadline = notice ? monthsBefore(item.expires, notice) : item.expires;
  let date = addDays(deadline, -k.lead);
  const todayIso = toISO(today);
  if (date < todayIso) date = todayIso;
  const title = notice ? `${what} – kündigen bis ${fmtDate(deadline, false)}?` : `${what} läuft am ${fmtDate(item.expires)} ab`;
  const notes = [
    k.todo,
    notice ? `Endet am ${fmtDate(item.expires)}, Kündigungsfrist ${notice} ${notice === 1 ? 'Monat' : 'Monate'}: Kündigung muss bis ${fmtDate(deadline)} angekommen sein.` : '',
  ].filter(Boolean).join('\n');
  return normalizeEvent({ title, date, kind: 'frist', notes });
}

// Aus erkanntem Text (Foto vom Dokument) das wahrscheinlichste Ablaufdatum: spätestes Datum in der Zukunft
export function guessExpiry(dates, today = new Date()) {
  const todayIso = toISO(today);
  return dates.filter((d) => isValidISO(d) && d > todayIso).sort().at(-1) || null;
}
