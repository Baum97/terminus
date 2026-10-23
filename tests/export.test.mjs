import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildICS, googleLink } from '../www/js/ics.js';
import { encodeEvent, decodeEvent, normalizePhone } from '../www/js/share.js';
import { normalizeEvent } from '../www/js/events.js';

const ev = normalizeEvent({ id: 'x1', title: 'Laternenfest, Kita', date: '2026-11-13', start: '17:00', location: 'Lindenstraße 4', bring: ['Laterne'] });
const ferien = normalizeEvent({ id: 'x2', title: 'Weihnachtsferien', date: '2026-12-22', endDate: '2027-01-02' });

test('iCalendar: Zeitzone, Escaping, Standarddauer und ganztägige Zeiträume', () => {
  const ics = buildICS([ev, ferien], { defaultMinutes: 90, alarmMinutes: 15 });
  assert.match(ics, /DTSTART;TZID=Europe\/Berlin:20261113T170000\r\n/);
  assert.match(ics, /DTEND;TZID=Europe\/Berlin:20261113T183000\r\n/);
  assert.match(ics, /SUMMARY:Laternenfest\\, Kita\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261222\r\nDTEND;VALUE=DATE:20270103\r\n/);
  assert.match(ics, /TRIGGER:-PT15M/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

test('Google-Link enthält Zeitraum und Zeitzone', () => {
  const url = new URL(googleLink(ev));
  assert.equal(url.searchParams.get('dates'), '20261113T170000/20261113T180000');
  assert.equal(url.searchParams.get('ctz'), 'Europe/Berlin');
});

test('Termin-Link übersteht Hin- und Rückweg inklusive Umlauten', () => {
  const back = decodeEvent(encodeEvent(ev));
  assert.equal(back.title, ev.title);
  assert.equal(back.location, 'Lindenstraße 4');
  assert.deepEqual(back.bring, ['Laterne']);
  assert.equal(decodeEvent('kaputt!'), null);
});

test('Handynummern werden für WhatsApp international geschrieben', () => {
  assert.equal(normalizePhone('0171 234 5678'), '491712345678');
  assert.equal(normalizePhone('+43 664 1234567'), '436641234567');
  assert.equal(normalizePhone('0049 30 1234567'), '49301234567');
  assert.equal(normalizePhone('123'), '');
});
