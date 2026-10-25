import { test } from 'node:test';
import assert from 'node:assert/strict';
import { easter, publicHolidays, holidayNotes, setSchoolHolidays, holidayStartFinder } from '../www/js/holidays.js';
import { buildICS, alarms, rrule, googleLink } from '../www/js/ics.js';
import { normalizeEvent } from '../www/js/events.js';
import { fmtRepeat } from '../www/js/dates.js';

test('Ostern und bewegliche Feiertage', () => {
  assert.equal(easter(2026).toDateString(), new Date(2026, 3, 5).toDateString());
  assert.equal(easter(2027).toDateString(), new Date(2027, 2, 28).toDateString());
  const by = Object.fromEntries(publicHolidays(2026, 'BY').map((h) => [h.name, h.date]));
  assert.equal(by['Fronleichnam'], '2026-06-04');
  assert.equal(by['Christi Himmelfahrt'], '2026-05-14');
  assert.equal(by['Allerheiligen'], '2026-11-01');
  assert.equal(by['Reformationstag'], undefined);
  const sn = Object.fromEntries(publicHolidays(2026, 'SN').map((h) => [h.name, h.date]));
  assert.equal(sn['Buß- und Bettag'], '2026-11-18');
  assert.equal(publicHolidays(2026).length, 9);
});

test('Hinweis auf Feiertag und Schulferien', () => {
  setSchoolHolidays({ NI: [{ name: 'Herbstferien', start: '2026-10-12', end: '2026-10-24' }, { name: 'Osterferien', start: '2027-03-22', end: '2027-04-06' }] });
  const reform = normalizeEvent({ title: 'Kinderturnen', date: '2026-10-31', start: '10:00' });
  assert.deepEqual(holidayNotes(reform, 'NI').map((n) => n.text), ['Feiertag: Reformationstag']);
  assert.deepEqual(holidayNotes(reform, 'BW'), []);
  const ferien = normalizeEvent({ title: 'Elternabend', date: '2026-10-20', start: '19:00' });
  assert.deepEqual(holidayNotes(ferien, 'NI').map((n) => n.text), ['In den Herbstferien']);
  assert.equal(holidayStartFinder('NI', new Date(2026, 9, 23))('oster'), '2027-03-22');
});

test('Erinnerungen: Frist am Vortag, Mitbringliste am Vorabend', () => {
  const frist = normalizeEvent({ kind: 'frist', title: 'Anmeldung: Ausflug', date: '2026-11-02', start: '12:00' });
  assert.equal(frist.start, null);
  assert.deepEqual(alarms(frist, { alarmMinutes: 60 }).map((a) => a.minutes), [900]);
  const fest = normalizeEvent({ title: 'Laternenfest', date: '2026-11-13', start: '17:00', bring: ['Laterne'] });
  const a = alarms(fest, { alarmMinutes: 60 });
  assert.deepEqual(a.map((x) => x.minutes), [17 * 60 + 300, 60]);
  assert.equal(a[0].text, 'Morgen: Laternenfest. Mitbringen: Laterne');
  assert.deepEqual(alarms(fest, { alarmMinutes: 60, eveReminder: false }).map((x) => x.minutes), [60]);
  const ics = buildICS([frist, fest], { alarmMinutes: 60 });
  assert.match(ics, /SUMMARY:Anmeldung: Ausflug \(Frist\)\r\nBEGIN:VALARM/);
  assert.match(ics, /TRIGGER:-PT1320M/);
});

test('Serientermine: RRULE, Google-Link und Anzeige', () => {
  const kurs = normalizeEvent({ title: 'Schwimmkurs', date: '2026-10-27', start: '16:00', repeat: 'biweekly', until: '2027-03-21' });
  assert.deepEqual(kurs.repeat, { freq: 'weekly', interval: 2, until: '2027-03-21' });
  assert.equal(rrule(kurs), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20270321T225959Z');
  assert.match(buildICS([kurs]), /RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20270321T225959Z\r\n/);
  assert.equal(new URL(googleLink(kurs)).searchParams.get('recur'), 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;UNTIL=20270321T225959Z');
  assert.equal(fmtRepeat(kurs), 'alle 2 Wochen dienstags bis So, 21.03.2027');
  assert.equal(fmtRepeat(normalizeEvent({ title: 'x', date: '2026-10-27', repeat: { freq: 'weekly' } })), 'jeden Dienstag');
  assert.equal(normalizeEvent({ title: 'Ferien', date: '2026-10-26', endDate: '2026-10-30', repeat: 'weekly' }).repeat, null);
});
