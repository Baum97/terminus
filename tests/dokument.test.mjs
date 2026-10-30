import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTicket, readEmail, decodeWords } from '../www/js/dokument.js';

const today = new Date(2026, 9, 30);

test('Bahnticket: Hin- und Rückfahrt mit Umstieg, Gleis und Platz', () => {
  const text = `Online-Ticket
Hinfahrt am 08.11.2026
Ihre Reiseverbindung und Reservierung
Halt Datum Zeit Gleis Produkte Reservierung
Frankfurt(Main)Hbf 08.11. ab 10:16 9 ICE 597 Wg. 7, Pl. 45
Mannheim Hbf 08.11. an 10:54 3
Mannheim Hbf 08.11. ab 11:05 4 ICE 691
München Hbf 08.11. an 13:28 18
Rückfahrt am 10.11.2026
München Hbf 10.11. ab 17:02 21 ICE 592 Wg. 9, Pl. 61, 62
Frankfurt(Main)Hbf 10.11. an 20:15 7`;
  const [hin, rueck] = parseTicket(text, today);
  assert.equal(hin.title, 'Bahnfahrt nach München Hbf');
  assert.deepEqual([hin.date, hin.start, hin.end, hin.location], ['2026-11-08', '10:16', '13:28', 'Frankfurt(Main)Hbf, Gleis 9']);
  assert.match(hin.notes, /10:16 Frankfurt\(Main\)Hbf \(Gleis 9\) → ICE 597, Wagen 7, Platz 45 → 10:54 Mannheim Hbf \(Gleis 3\)/);
  assert.match(hin.notes, /1× umsteigen/);
  assert.equal(rueck.title, 'ICE 592 nach Frankfurt(Main)Hbf');
  assert.deepEqual([rueck.date, rueck.start, rueck.end], ['2026-11-10', '17:02', '20:15']);
  assert.match(rueck.notes, /Wagen 9, Platz 61, 62/);
});

test('Kein Ticket: normaler Text bleibt bei der normalen Erkennung', () => {
  assert.deepEqual(parseTicket('Elternabend am 12.11. ab 19:00 in der Aula', today), []);
});

test('E-Mail: Betreff, quoted-printable, HTML und Kalender-Anhang', () => {
  const eml = [
    'From: Praxis Dr. =?UTF-8?Q?M=C3=BCller?= <praxis@example.de>',
    'Subject: =?UTF-8?Q?Ihr_Termin_am_14.11.?=',
    'Content-Type: multipart/mixed; boundary="XYZ"',
    '',
    '--XYZ',
    'Content-Type: multipart/alternative; boundary="ALT"',
    '',
    '--ALT',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<p>Sehr geehrte Frau Beispiel,</p><p>Ihr Termin: Sa 14.11.2026 um 9:30 Uhr, Praxis M=C3=BCller.</p>',
    '--ALT--',
    '--XYZ',
    'Content-Type: text/calendar; method=REQUEST',
    'Content-Transfer-Encoding: base64',
    '',
    btoa('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261114T083000Z\r\nSUMMARY:Arzt\r\nEND:VEVENT\r\nEND:VCALENDAR'),
    '--XYZ--',
  ].join('\r\n');
  const m = readEmail(eml);
  assert.equal(m.subject, 'Ihr Termin am 14.11.');
  assert.equal(m.from, 'Praxis Dr. Müller <praxis@example.de>');
  assert.match(m.text, /^Ihr Termin am 14\.11\.\n\nSehr geehrte Frau Beispiel,\n+Ihr Termin: Sa 14\.11\.2026 um 9:30 Uhr, Praxis Müller\./);
  assert.match(m.ics, /SUMMARY:Arzt/);
  assert.equal(decodeWords('=?ISO-8859-1?B?R3L832U=?='), 'Grüße');
});
