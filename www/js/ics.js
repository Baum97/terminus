// Kalender-Export: iCalendar-Datei (RFC 5545) und Google-Kalender-Link.
import { addDays, addMinutes } from './dates.js';

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

export function description(ev) {
  const lines = [];
  if (ev.bring?.length) lines.push(`Mitbringen: ${ev.bring.join(', ')}`);
  if (ev.cost) lines.push(`Kosten: ${ev.cost}`);
  if (ev.notes) lines.push(ev.notes);
  return lines.join('\n');
}

// Zeitspanne eines Termins. Ganztägige Termine enden exklusiv am Folgetag.
export function span(ev, defaultMinutes = 60) {
  if (!ev.start) return { allDay: true, start: ev.date, end: addDays(ev.endDate || ev.date, 1) };
  return { allDay: false, date: ev.date, start: ev.start, end: ev.end || addMinutes(ev.start, defaultMinutes) };
}

export function buildICS(events, { defaultMinutes = 60, alarmMinutes = null } = {}) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Terminus//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...VTIMEZONE];
  for (const ev of events) {
    const s = span(ev, defaultMinutes);
    out.push('BEGIN:VEVENT', `UID:${ev.id}@terminus`, `DTSTAMP:${stamp}`);
    if (s.allDay) {
      out.push(`DTSTART;VALUE=DATE:${compactDate(s.start)}`, `DTEND;VALUE=DATE:${compactDate(s.end)}`);
    } else {
      out.push(`DTSTART;TZID=Europe/Berlin:${compactDate(s.date)}T${compactTime(s.start)}`,
        `DTEND;TZID=Europe/Berlin:${compactDate(s.date)}T${compactTime(s.end)}`);
    }
    out.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.location) out.push(`LOCATION:${escapeText(ev.location)}`);
    const desc = description(ev);
    if (desc) out.push(`DESCRIPTION:${escapeText(desc)}`);
    if (alarmMinutes != null) {
      // Bei ganztägigen Terminen bezieht sich die Erinnerung auf 0 Uhr, daher am Vortag um 18 Uhr.
      const trigger = s.allDay ? '-PT6H' : `-PT${alarmMinutes}M`;
      out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(ev.title)}`, `TRIGGER:${trigger}`, 'END:VALARM');
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
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates, ctz: 'Europe/Berlin' });
  if (ev.location) p.set('location', ev.location);
  const desc = description(ev);
  if (desc) p.set('details', desc);
  return `https://calendar.google.com/calendar/render?${p}`;
}
