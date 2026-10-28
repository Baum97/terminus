import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aboFromDevice, aboFromLocal, encodeAbo, decodeAbo, subscribeLinks } from '../www/js/aboexport.js';
import { parseICS } from '../www/js/icsimport.js';
import { normalizeEvent } from '../www/js/events.js';


const rows = [
  { id: '1', title: 'Analysis I', start: Date.UTC(2026, 9, 19, 8, 15), duration: 'P5400S', rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20270205T235959Z', exdate: '', allDay: false,
    location: 'Hörsaal 1', description: 'Klausur am Ende\n\nMitbringen:\n☐ Taschenrechner\nFür: Mia\nZuständig: Papa' },
  { id: '2', title: 'Semesterferien', start: Date.UTC(2027, 1, 8), end: Date.UTC(2027, 3, 12), allDay: true, location: '', description: '' },
  { id: '3', originalId: '1', originalTime: Date.UTC(2026, 10, 2, 9, 15), cancelled: true },
  { id: '4', originalId: '1', originalTime: Date.UTC(2026, 10, 9, 9, 15), cancelled: false, title: 'Analysis I (Raumwechsel)', start: Date.UTC(2026, 10, 9, 9, 15), end: Date.UTC(2026, 10, 9, 10, 45), allDay: false, location: 'Hörsaal 3' },
  { id: '5', title: 'Gelöscht', start: Date.UTC(2026, 9, 20, 8), end: Date.UTC(2026, 9, 20, 9), cancelled: true },
];

test('Abo-Datei aus dem Handykalender: Serie, Ausnahmen, nur freigegebene Felder', () => {
  const ics = aboFromDevice(rows, { name: 'Informatik WiSe 26/27', calendarId: '7', fields: { location: true, notes: false, bring: false }, now: new Date('2026-10-28T10:00:00Z') });
  assert.match(ics, /X-WR-CALNAME:Informatik WiSe 26\/27/);
  assert.match(ics, /UID:7-1@terminus\r\nDTSTAMP:20261028T100000Z\r\nDTSTART;TZID=Europe\/Berlin:20261019T101500\r\nDURATION:PT5400S/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270205T235959Z\r\nEXDATE:20261102T091500Z/);
  assert.match(ics, /RECURRENCE-ID:20261109T091500Z/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270208\r\nDTEND;VALUE=DATE:20270412/);
  assert.match(ics, /LOCATION:Hörsaal 1/);
  assert.doesNotMatch(ics, /Gelöscht|Taschenrechner|Mia|Papa|Klausur|DESCRIPTION/);
  // Lässt sich wieder einlesen (z. B. von Kommilitonen mit Terminus)
  const back = parseICS(ics);
  assert.equal(back.events.length, 2);
  assert.equal(back.skipped, 1); // die Ausnahme mit RECURRENCE-ID
});

test('Mit Notizen und Mitbringliste, aber nie Familienangaben', () => {
  const ics = aboFromDevice(rows, { name: 'X', calendarId: '7', fields: { location: false, notes: true, bring: true } });
  assert.match(ics, /DESCRIPTION:Klausur am Ende\\n\\nMitbringen: Taschenrechner/);
  assert.doesNotMatch(ics, /LOCATION|Für|Zuständig|Mia|Papa/);
});

test('Web-Version: gemerkte Termine ohne Familienangaben', () => {
  const ev = normalizeEvent({ title: 'Tutorium', date: '2026-11-03', start: '14:00', location: 'Raum 2', notes: 'Blatt 3', forWhom: ['Mia'], responsible: 'Papa', bring: ['Laptop'] });
  const ics = aboFromLocal([ev], { name: 'Tutorien', fields: { location: true, notes: false, bring: false } });
  assert.match(ics, /X-WR-CALNAME:Tutorien/);
  assert.match(ics, /LOCATION:Raum 2/);
  assert.doesNotMatch(ics, /Blatt 3|Mia|Papa|Laptop|VALARM/);
});

test('Abo-Seite: Link, Abonnieren in iPhone, Google, Outlook', () => {
  const code = encodeAbo({ url: 'https://terminus.example.de/abo/VRT_GPVcwh30seQHjIvrlg.ics', name: 'Informatik WiSe', by: 'Fachschaft' });
  assert.deepEqual(decodeAbo(code), { url: 'https://terminus.example.de/abo/VRT_GPVcwh30seQHjIvrlg.ics', name: 'Informatik WiSe', by: 'Fachschaft' });
  assert.equal(decodeAbo(encodeAbo({ url: 'javascript:alert(1)', name: 'x' })), null);
  const l = subscribeLinks('https://terminus.example.de/abo/a.ics', 'Informatik WiSe');
  assert.equal(l.webcal, 'webcal://terminus.example.de/abo/a.ics');
  assert.match(l.google, /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2F/);
  assert.match(l.outlook, /addfromweb\?url=https%3A%2F%2Fterminus\.example\.de%2Fabo%2Fa\.ics&name=Informatik%20WiSe$/);
});
