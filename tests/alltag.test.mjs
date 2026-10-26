import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quickParse } from '../www/js/quick.js';

const today = new Date(2026, 9, 26); // Mo, 26.10.2026
const family = ['Mia', 'Ben', 'Papa'];
const q = (t) => {
  const e = quickParse(t, today, { family });
  return e && [e.title, e.date, e.start, e.end, e.location, e.forWhom.join(',')];
};

test('Schnelleingabe mit Wochentag, Uhrzeit und Person', () => {
  assert.deepEqual(q('Mi 16 Uhr Zahnarzt Ben'), ['Zahnarzt', '2026-10-28', '16:00', null, '', 'Ben']);
  assert.deepEqual(q('morgen 8:30 Elterngespräch @ Grundschule Lindenweg'), ['Elterngespräch', '2026-10-27', '08:30', null, 'Grundschule Lindenweg', '']);
  assert.deepEqual(q('nächsten Montag Kuchen backen für Mia'), ['Kuchen backen', '2026-11-02', null, null, '', 'Mia']);
  assert.deepEqual(q('Mo 10-11 Uhr Turnen'), ['Turnen', '2026-10-26', '10:00', '11:00', '', '']);
  assert.deepEqual(q('heute Abend 19:30 Elternabend'), ['Elternabend', '2026-10-26', '19:30', null, '', '']);
  assert.deepEqual(q('Do nachmittags Spielplatz mit Papa'), ['Spielplatz mit Papa', '2026-10-29', '15:00', null, '', '']);
  assert.deepEqual(q('in 3 Tagen Reifenwechsel'), ['Reifenwechsel', '2026-10-29', null, null, '', '']);
  assert.deepEqual(q('14.11. 15 Uhr Kindergeburtstag Mia'), ['Kindergeburtstag', '2026-11-14', '15:00', null, '', 'Mia']);
  assert.equal(quickParse('Milch kaufen', today, { family }), null);
});

test('Schnelleingabe für wiederkehrende Termine', () => {
  const e = quickParse('dienstags 16 Uhr Schwimmkurs Mia', today, { family });
  assert.deepEqual([e.title, e.date, e.start, e.repeat.freq, e.forWhom[0]], ['Schwimmkurs', '2026-10-27', '16:00', 'weekly', 'Mia']);
});

import { holidayExdates, setSchoolHolidays } from '../www/js/holidays.js';
import { normalizeEvent } from '../www/js/events.js';
import { buildICS } from '../www/js/ics.js';
import { occurrences } from '../www/js/calendar.js';
import { berlinUtcStamp } from '../www/js/icsimport.js';

test('Serie setzt in den Ferien und an Feiertagen aus', () => {
  setSchoolHolidays({ NI: [{ name: 'Weihnachtsferien', start: '2026-12-23', end: '2027-01-09' }] });
  const kurs = normalizeEvent({ title: 'Schwimmkurs', date: '2026-12-01', start: '16:00', repeat: { freq: 'weekly' }, until: '2027-01-26' });
  const ex = holidayExdates(kurs, 'NI');
  assert.deepEqual(ex, ['2026-12-29', '2027-01-05']);
  const fr = normalizeEvent({ title: 'Turnen', date: '2026-12-04', start: '15:00', repeat: { freq: 'weekly' }, until: '2026-12-31' });
  assert.deepEqual(holidayExdates(fr, 'NI'), ['2026-12-25']); // 1. Weihnachtstag (Fr), Ferien beginnen am 23.12.
  const withEx = normalizeEvent({ ...kurs, exdates: ex, skipHolidays: true });
  assert.deepEqual(occurrences(withEx, '2026-12-20', '2027-01-15'), ['2026-12-22', '2027-01-12']);
  assert.match(buildICS([withEx]), /EXDATE;TZID=Europe\/Berlin:20261229T160000,20270105T160000\r\n/);
  assert.equal(berlinUtcStamp('2026-12-29', '16:00'), '20261229T150000Z');
  assert.equal(berlinUtcStamp('2026-07-01', '16:00'), '20260701T140000Z');
});
