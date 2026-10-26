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
  const f = quickParse('dienstags 16 Uhr Schwimmkurs Mia bis 26.01.2027', today, { family });
  assert.deepEqual([f.title, f.date, f.repeat.until, f.forWhom[0]], ['Schwimmkurs', '2026-10-27', '2027-01-26', 'Mia']);
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

import { buildBackup, parseBackup } from '../www/js/backup.js';

test('Sicherung: ohne API-Schlüssel, Rücklesen mit Prüfung', () => {
  const text = buildBackup({
    settings: { provider: 'mistral', apiKey: 'geheim', state: 'NI' },
    people: [{ id: 'p', name: 'Oma', email: 'oma@posteo.de' }],
    family: [{ id: 'f', name: 'Mia', role: 'kind' }],
    saved: [{ title: 'Laternenfest', date: '2026-11-13' }, { title: 'kaputt', date: 'x' }],
  }, new Date('2026-10-26T10:00:00Z'));
  assert.doesNotMatch(text, /geheim/);
  const back = parseBackup(text);
  assert.equal(back.settings.state, 'NI');
  assert.equal(back.settings.apiKey, undefined);
  assert.deepEqual([back.people.length, back.family[0].name, back.saved.length, back.created], [1, 'Mia', 1, '2026-10-26T10:00:00.000Z']);
  assert.throws(() => parseBackup('{"app":"andere"}'), /keine Terminus-Sicherung/);
  assert.throws(() => parseBackup('kein json'), /kein gültiges JSON/);
  assert.throws(() => parseBackup('{"app":"terminus","version":99}'), /neueren Terminus-Version/);
});
