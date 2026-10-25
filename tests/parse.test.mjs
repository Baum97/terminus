import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseText } from '../www/js/parse.js';

const today = new Date(2026, 9, 23); // Fr, 23.10.2026

test('Elternbrief mit einem Termin, Uhrzeit, Ort und Mitbringliste', () => {
  const text = `Kita Sonnenschein
Einladung zum Laternenfest

Liebe Eltern,
am Freitag, den 14.11. feiern wir unser Laternenfest.
Beginn: 17:00 Uhr, Ende ca. 18:30 Uhr
Treffpunkt: Garten der Kita, Lindenstraße 4
Bitte mitbringen:
- Laterne
- Teelicht
Wir sammeln 3 € für Punsch.`;
  const [ev, ...rest] = parseText(text, today);
  assert.equal(rest.length, 0);
  assert.equal(ev.date, '2026-11-14');
  assert.equal(ev.start, '17:00');
  assert.equal(ev.end, '18:30');
  assert.equal(ev.title, 'Laternenfest');
  assert.equal(ev.location, 'Garten der Kita, Lindenstraße 4');
  assert.deepEqual(ev.bring, ['Laterne', 'Teelicht']);
  assert.equal(ev.cost, '3 €');
});

test('Terminplan mit mehreren Zeilen und Ferien-Zeitraum', () => {
  const text = `Termine 1. Halbjahr 2026/27
Herbstferien 26.10.–30.10.2026
Elternabend Klasse 3b: Di, 10.11.2026, 19:30 Uhr
Weihnachtsbasar 5. Dezember 14–17 Uhr
Zeugnisausgabe 29.01.2027`;
  const evs = parseText(text, today);
  assert.equal(evs.length, 4);
  assert.deepEqual([evs[0].title, evs[0].date, evs[0].endDate], ['Herbstferien', '2026-10-26', '2026-10-30']);
  assert.deepEqual([evs[1].title, evs[1].start], ['Elternabend Klasse 3b', '19:30']);
  assert.deepEqual([evs[2].title, evs[2].date, evs[2].start, evs[2].end], ['Weihnachtsbasar', '2026-12-05', '14:00', '17:00']);
  assert.equal(evs[3].date, '2027-01-29');
});

test('Datum ohne Jahr im Januar landet im nächsten Jahr', () => {
  const [ev] = parseText('Neujahrsempfang 10.01. um 11 Uhr', today);
  assert.equal(ev.date, '2027-01-10');
  assert.equal(ev.start, '11:00');
});

test('Chat-Nachricht mit Uhrzeit in Folgezeile und Ortsangabe', () => {
  const [ev] = parseText('Hey! Kindergeburtstag von Mia am 7. November\nab 15 Uhr\nOrt: Trampolinhalle Jump, Gewerbestr. 12', today);
  assert.equal(ev.date, '2026-11-07');
  assert.equal(ev.start, '15:00');
  assert.match(ev.title, /Kindergeburtstag von Mia/);
  assert.equal(ev.location, 'Trampolinhalle Jump, Gewerbestr. 12');
});

test('Uhrzeiten mit Punkt werden nicht als Datum gelesen', () => {
  const evs = parseText('Zahnarzt Dr. Weber 03.12.2026 um 8.30 Uhr', today);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].start, '08:30');
  assert.match(evs[0].title, /Zahnarzt Dr. Weber/);
});

test('Text ohne Datum ergibt keine Termine', () => {
  assert.equal(parseText('Bitte denkt an die Turnbeutel.', today).length, 0);
});

test('Wochentag passt nicht zum Datum: Termin wird zur Prüfung markiert', () => {
  const [wrong] = parseText('Sommerfest am Freitag, 14.11.2026 um 15 Uhr', today);
  assert.equal(wrong.unsure, true);
  const [right] = parseText('Sommerfest am Freitag, 13.11.2026 um 15 Uhr', today);
  assert.equal(right.unsure, false);
});

test('Fristen werden eigene Einträge mit passendem Namen', () => {
  const text = `Ausflug in den Wildpark
Am Mittwoch, 11.11.2026 fahren wir in den Wildpark. Abfahrt 8:30 Uhr.
Bitte meldet euer Kind bis zum 2.11. an und überweist 12 € bis spätestens 6.11.
Rückmeldung zum Elternabend bitte bis Freitag, 30.10.`;
  const evs = parseText(text, today);
  const byDate = Object.fromEntries(evs.map((e) => [e.date, e]));
  assert.deepEqual([byDate['2026-11-11'].kind, byDate['2026-11-11'].title, byDate['2026-11-11'].start], ['termin', 'Ausflug in den Wildpark', '08:30']);
  assert.deepEqual([byDate['2026-11-02'].kind, byDate['2026-11-02'].title], ['frist', 'Anmeldung: Ausflug in den Wildpark']);
  assert.deepEqual([byDate['2026-11-06'].title, byDate['2026-11-06'].cost], ['Bezahlen: Ausflug in den Wildpark', '12 €']);
  assert.equal(byDate['2026-10-30'].title, 'Rückmeldung: Ausflug in den Wildpark');
  assert.equal(evs.length, 4);
});

test('Ferien mit "bis" bleiben ein Zeitraum und werden keine Frist', () => {
  const [ev] = parseText('Herbstferien vom 26.10. bis 30.10.2026', today);
  assert.deepEqual([ev.kind, ev.date, ev.endDate], ['termin', '2026-10-26', '2026-10-30']);
});

test('Wöchentliche Termine mit Enddatum', () => {
  const [ev, ...rest] = parseText('Schwimmkurs dienstags 16:00 Uhr bis 23.03.2027', today);
  assert.equal(rest.length, 0);
  assert.deepEqual([ev.title, ev.date, ev.start], ['Schwimmkurs', '2026-10-27', '16:00']);
  assert.deepEqual(ev.repeat, { freq: 'weekly', interval: 1, until: '2027-03-23' });
});

test('Alle zwei Wochen bis zu den Osterferien', () => {
  const holidayStart = (name) => (name === 'oster' ? '2027-03-22' : null);
  const [ev] = parseText('Fußballtraining alle zwei Wochen freitags 17 Uhr bis zu den Osterferien', today, { holidayStart });
  assert.deepEqual([ev.title, ev.date, ev.start], ['Fußballtraining', '2026-10-23', '17:00']);
  assert.deepEqual(ev.repeat, { freq: 'weekly', interval: 2, until: '2027-03-21' });
});

test('Satz als Terminzeile: Überschrift wird zum Titel, auch bei mehreren Terminen', () => {
  const evs = parseText(`Ausflug in den Wildpark
Am Mittwoch, 11.11.2026 fahren wir in den Wildpark. Abfahrt 8:30 Uhr.
Kinderturnen 31.10. 10 Uhr`, today);
  assert.deepEqual(evs.map((e) => e.title), ['Kinderturnen', 'Ausflug in den Wildpark']);
});
