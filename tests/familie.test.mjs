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

import { deflateRawSync } from 'node:zlib';
import { readZip } from '../www/js/unzip.js';
import { fromDevice, fromLocal, occurrences, birthdayItems, itemsOnDay, matchesPerson, titleWithDone, monthGrid } from '../www/js/calendar.js';

// Kleine ZIP-Datei wie der Google-Export: eine komprimierte .ics, eine unkomprimierte andere Datei
function makeZip(files) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), raw = enc.encode(f.text);
    const data = f.store ? raw : deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(f.store ? 0 : 8, 8); lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(f.store ? 0 : 8, 10); ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, data);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test('Google-Export als ZIP wird entpackt', async () => {
  const zip = makeZip([{ name: 'anna@gmail.com.ics', text: 'BEGIN:VCALENDAR\nÄÖÜ\nEND:VCALENDAR' }, { name: 'readme.txt', text: 'x', store: true }]);
  const files = await readZip(zip);
  assert.deepEqual(files, [{ name: 'anna@gmail.com.ics', text: 'BEGIN:VCALENDAR\nÄÖÜ\nEND:VCALENDAR' }]);
});

test('Handykalender: Frist, erledigt, Familienangaben, ganztägig', () => {
  const frist = fromDevice({ id: '7', title: '✓ Anmeldung: Ausflug (Frist)', begin: Date.UTC(2026, 10, 2), end: Date.UTC(2026, 10, 3), allDay: true, description: 'Für: Mia\nZuständig: Papa' });
  assert.deepEqual([frist.title, frist.frist, frist.done, frist.date, frist.endDate, frist.meta.forWhom], ['Anmeldung: Ausflug', true, true, '2026-11-02', null, ['Mia']]);
  assert.equal(titleWithDone(frist, false), 'Anmeldung: Ausflug (Frist)');
  assert.ok(matchesPerson(frist, 'Papa') && matchesPerson(frist, 'Mia') && !matchesPerson(frist, 'Ben'));
  const t = new Date(2026, 10, 13, 17, 0).getTime();
  const fest = fromDevice({ id: '8', title: 'Laternenfest', begin: t, end: t + 90 * 60000, allDay: false });
  assert.deepEqual([fest.date, fest.start, fest.end, fest.endDate], ['2026-11-13', '17:00', '18:30', null]);
});

test('Serien aufklappen, Geburtstage und Monatsraster', () => {
  const kurs = { id: 'k', title: 'Schwimmkurs', date: '2026-10-27', start: '16:00', repeat: { freq: 'weekly', interval: 2, until: '2026-12-01' }, bring: [], notes: '' };
  assert.deepEqual(occurrences(kurs, '2026-11-01', '2026-12-31'), ['2026-11-10', '2026-11-24']);
  assert.equal(fromLocal(kurs, '2026-11-01', '2026-11-30').length, 2);
  const monat = { id: 'm', date: '2026-01-31', repeat: { freq: 'monthly', interval: 1 } };
  assert.deepEqual(occurrences(monat, '2026-01-01', '2026-05-31'), ['2026-01-31', '2026-03-31', '2026-05-31']);
  const bdays = birthdayItems([{ name: 'Oma Gisela', date: '1950-11-14' }, { name: 'Ben', date: '--02-29' }], '2026-11-01', '2028-03-01');
  assert.deepEqual(bdays.map((b) => `${b.date} ${b.title}`), ['2026-11-14 Oma Gisela wird 76', '2027-11-14 Oma Gisela wird 77', '2028-02-29 Ben hat Geburtstag']);
  const day = itemsOnDay([fromLocal(kurs, '2026-11-10', '2026-11-10')[0], bdays[0]], '2026-11-10');
  assert.equal(day.length, 1);
  const grid = monthGrid(2026, 10);
  assert.deepEqual([grid[0], grid.length, grid[41]], ['2026-10-26', 42, '2026-12-06']);
});
