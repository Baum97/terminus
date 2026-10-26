// Kalender-Export: iCalendar-Datei (RFC 5545) und Google-Kalender-Link.
import { addDays, addMinutes, toMinutes, fromISO } from './dates.js';
import { describeEvent } from './desc.js';

const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
  'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
  'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const escapeText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compactDate = (iso) => iso.replace(/-/g, '');
const compactTime = (t) => t.replace(':', '') + '00';

// Zeilen auf 75 Byte falten, ohne UTF-8-Zeichen zu zerschneiden.
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// Erinnerungen in Minuten vor Beginn. Bei ganztägigen Terminen ist "Beginn" 0 Uhr.
// - Frist: am Vortag um 9 Uhr
// - Mitbringliste oder Kosten: am Vorabend um 19 Uhr ("Morgen: …, Mitbringen: …")
// - sonst die eingestellte Erinnerung
export function alarms(ev, { alarmMinutes = null, eveReminder = true } = {}) {
  if (ev.kind === 'frist') return [{ minutes: 15 * 60, text: `Frist morgen: ${ev.title}` }];
  const out = [];
  const startMin = ev.start ? toMinutes(ev.start) : 0;
  const eve = eveReminder && (ev.bring?.length || ev.cost);
  if (eve) {
    const what = [ev.bring?.length ? `Mitbringen: ${ev.bring.join(', ')}` : '', ev.cost ? `Kosten: ${ev.cost}` : ''].filter(Boolean).join(' · ');
    out.push({ minutes: startMin + 5 * 60, text: `Morgen: ${ev.title}. ${what}` });
  }
  if (alarmMinutes != null && alarmMinutes !== '' && !(eve && !ev.start)) {
    const minutes = ev.start ? +alarmMinutes : 6 * 60;
    if (!out.some((a) => a.minutes === minutes)) out.push({ minutes, text: ev.title });
  }
  return out;
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// RRULE ohne Präfix, z. B. "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20270321T225959Z"
export function rrule(ev) {
  const r = ev.repeat;
  if (!r) return '';
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly') parts.push(`BYDAY=${BYDAY[fromISO(ev.date).getDay()]}`);
  if (r.until) parts.push(`UNTIL=${compactDate(r.until)}${ev.start ? 'T225959Z' : ''}`);
  return parts.join(';');
}

export function summary(ev) {
  return ev.kind === 'frist' ? `${ev.title} (Frist)` : ev.title;
}

export function description(ev) {
  return describeEvent(ev);
}

// Zeitspanne eines Termins. Ganztägige Termine enden exklusiv am Folgetag.
export function span(ev, defaultMinutes = 60) {
  if (!ev.start) return { allDay: true, start: ev.date, end: addDays(ev.endDate || ev.date, 1) };
  return { allDay: false, date: ev.date, start: ev.start, end: ev.end || addMinutes(ev.start, defaultMinutes) };
}

const cn = (name) => `"${String(name || '').replace(/["\r\n]/g, '')}"`;

// Mit organizer (eigene Adresse) und Gästen wird eine echte Einladung daraus (METHOD:REQUEST):
// Kalender wie Outlook, Thunderbird oder Gmail zeigen dann Zusagen/Absagen an.
export function buildICS(events, { defaultMinutes = 60, alarmMinutes = null, eveReminder = true, organizer = null } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const invite = Boolean(organizer?.email) && events.some((e) => e.guests?.length);
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Terminus//DE', 'CALSCALE:GREGORIAN', `METHOD:${invite ? 'REQUEST' : 'PUBLISH'}`, ...VTIMEZONE];
  for (const ev of events) {
    const s = span(ev, defaultMinutes);
    out.push('BEGIN:VEVENT', `UID:${ev.id}@terminus`, `DTSTAMP:${stamp}`);
    if (s.allDay) {
      out.push(`DTSTART;VALUE=DATE:${compactDate(s.start)}`, `DTEND;VALUE=DATE:${compactDate(s.end)}`);
    } else {
      out.push(`DTSTART;TZID=Europe/Berlin:${compactDate(s.date)}T${compactTime(s.start)}`,
        `DTEND;TZID=Europe/Berlin:${compactDate(s.date)}T${compactTime(s.end)}`);
    }
    out.push(`SUMMARY:${escapeText(summary(ev))}`);
    if (ev.repeat) out.push(`RRULE:${rrule(ev)}`);
    if (ev.repeat && ev.exdates?.length) {
      out.push(ev.start
        ? `EXDATE;TZID=Europe/Berlin:${ev.exdates.map((d) => `${compactDate(d)}T${compactTime(ev.start)}`).join(',')}`
        : `EXDATE;VALUE=DATE:${ev.exdates.map(compactDate).join(',')}`);
    }
    if (invite && ev.guests?.length) {
      out.push('SEQUENCE:0', 'STATUS:CONFIRMED', `ORGANIZER;CN=${cn(organizer.name || organizer.email)}:mailto:${organizer.email}`);
      for (const g of ev.guests) out.push(`ATTENDEE;CN=${cn(g.name || g.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${g.email}`);
    }
    if (ev.location) out.push(`LOCATION:${escapeText(ev.location)}`);
    const desc = description(ev);
    if (desc) out.push(`DESCRIPTION:${escapeText(desc)}`);
    for (const a of alarms(ev, { alarmMinutes, eveReminder })) {
      out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(a.text)}`, `TRIGGER:-PT${a.minutes}M`, 'END:VALARM');
    }
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}

export function icsFileName(events) {
  const base = events.length === 1 ? events[0].title : `${events.length} Termine`;
  return `${base.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'termin'}.ics`;
}

export function googleLink(ev, defaultMinutes = 60) {
  const s = span(ev, defaultMinutes);
  const dates = s.allDay
    ? `${compactDate(s.start)}/${compactDate(s.end)}`
    : `${compactDate(s.date)}T${compactTime(s.start)}/${compactDate(s.date)}T${compactTime(s.end)}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: summary(ev), dates, ctz: 'Europe/Berlin' });
  if (ev.repeat) p.set('recur', `RRULE:${rrule(ev)}`);
  if (ev.location) p.set('location', ev.location);
  const desc = description(ev);
  if (desc) p.set('details', desc);
  return `https://calendar.google.com/calendar/render?${p}`;
}
