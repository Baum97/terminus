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
