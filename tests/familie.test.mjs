import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDescription, parseDescription, describeEvent } from '../www/js/desc.js';
import { normalizeEvent } from '../www/js/events.js';

test('Beschreibung mit Checkliste, Kindern und Zuständigkeit: hin und zurück', () => {
  const text = buildDescription({
    notes: 'Treffpunkt am Haupteingang.',
    bring: [{ text: 'Laterne', done: false }, { text: 'Teelicht', done: true }],
    forWhom: ['Mia', 'Ben'], responsible: 'Papa', cost: '3 €',
  });
  assert.equal(text, 'Treffpunkt am Haupteingang.\n\nMitbringen:\n☐ Laterne\n☑ Teelicht\nFür: Mia, Ben\nZuständig: Papa\nKosten: 3 €');
  assert.deepEqual(parseDescription(text), {
    notes: 'Treffpunkt am Haupteingang.',
    bring: [{ text: 'Laterne', done: false }, { text: 'Teelicht', done: true }],
    forWhom: ['Mia', 'Ben'], responsible: 'Papa', cost: '3 €',
  });
});

test('Ältere und fremde Schreibweisen werden verstanden', () => {
  const p = parseDescription('Mitbringen: Laterne, Teelicht\nKosten: 3 €\nBitte warm anziehen');
  assert.deepEqual(p.bring.map((b) => b.text), ['Laterne', 'Teelicht']);
  assert.equal(p.notes, 'Bitte warm anziehen');
  const q = parseDescription('Mitbringen:\n[x] Kuchen\n[ ] Teller');
  assert.deepEqual(q.bring, [{ text: 'Kuchen', done: true }, { text: 'Teller', done: false }]);
  assert.deepEqual(parseDescription('').bring, []);
});

test('Termin mit Familienangaben ergibt die passende Beschreibung', () => {
  const ev = normalizeEvent({ title: 'Laternenfest', date: '2026-11-13', bring: ['Laterne'], forWhom: ['Mia'], responsible: 'Papa', done: ['Laterne'] });
  assert.equal(describeEvent(ev), 'Mitbringen:\n☑ Laterne\nFür: Mia\nZuständig: Papa');
});

import { parseICS, simpleRepeat } from '../www/js/icsimport.js';

// Auszug wie aus einem Google-Kalender-Export, ergänzt um Outlook- und Sonderfälle
const ICS = `BEGIN:VCALENDAR\r
PRODID:-//Google Inc//Google Calendar 70.9054//EN\r
BEGIN:VEVENT\r
DTSTART:20261113T160000Z\r
DTEND:20261113T173000Z\r
SUMMARY:Laternenfest\\, Kita\r
LOCATION:Lindenstraße 4\\, Berlin\r
DESCRIPTION:Laterne mitbringen\\nund warm anziehen\r
BEGIN:VALARM\r
SUMMARY:nicht übernehmen\r
END:VALARM\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;VALUE=DATE:20261222\r
DTEND;VALUE=DATE:20270103\r
SUMMARY:Weihnachtsferien\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;TZID=America/New_York:20260715T090000\r
DURATION:PT2H\r
SUMMARY:Call mit New York\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART;TZID=W. Europe Standard Time:20261027T160000\r
DTEND;TZID=W. Europe Standard Time:20261027T170000\r
RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270321T225959Z\r
SUMMARY:Schwimmkurs mit einem sehr langen Titel\r
  der umgebrochen wurde\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART:20261110T090000Z\r
SUMMARY:Abgesagt\r
STATUS:CANCELLED\r
END:VEVENT\r
BEGIN:VEVENT\r
DTSTART:20261103T150000Z\r
RECURRENCE-ID:20261103T150000Z\r
SUMMARY:Ausnahme\r
END:VEVENT\r
END:VCALENDAR\r
`;

test('ICS-Import: UTC, Zeitzonen, ganztägig, Dauer, Serien, Absagen', () => {
  const { events, skipped } = parseICS(ICS);
  assert.equal(skipped, 2);
  const [fest, ferien, call, kurs] = events;
  assert.deepEqual([fest.title, fest.date, fest.start, fest.end, fest.location], ['Laternenfest, Kita', '2026-11-13', '17:00', '18:30', 'Lindenstraße 4, Berlin']);
  assert.equal(fest.description, 'Laterne mitbringen\nund warm anziehen');
  assert.deepEqual([ferien.date, ferien.endDate, ferien.start], ['2026-12-22', '2027-01-02', null]);
  assert.deepEqual([call.date, call.start, call.end], ['2026-07-15', '15:00', '17:00']);
  assert.deepEqual([kurs.title, kurs.start, kurs.rrule], ['Schwimmkurs mit einem sehr langen Titel der umgebrochen wurde', '16:00', 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20270321T225959Z']);
  assert.deepEqual(simpleRepeat(kurs.rrule), { freq: 'weekly', interval: 1, until: '2027-03-21' });
  assert.equal(simpleRepeat('FREQ=WEEKLY;BYDAY=MO,WE'), null);
});
