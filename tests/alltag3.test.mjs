import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShifts, parseTimetable, parseLegend } from '../www/js/plan.js';

const today = new Date(2026, 10, 1); // So 1.11.2026

test('Dienstplan mit Legende: Zeilen und Tabelle, Nachtdienst über Mitternacht', () => {
  const text = `Dienstplan November 2026 – Station 3
F = Frühdienst 06:00-14:00   S = Spätdienst 13:30-21:30   N = Nachtdienst 21:15-06:15
Mo 02.11. F
Di 03.11. F
Mi 04.11. frei
Do 05.11. S
05.11. 06.11. 07.11. 08.11.
N N frei S`;
  assert.deepEqual(Object.keys(parseLegend(text)), ['F', 'S', 'N']);
  const ev = parseShifts(text, today);
  assert.deepEqual(ev.map((e) => `${e.date} ${e.title} ${e.start}-${e.end}${e.endDate ? `→${e.endDate}` : ''}`), [
    '2026-11-02 Frühdienst 06:00-14:00',
    '2026-11-03 Frühdienst 06:00-14:00',
    '2026-11-05 Spätdienst 13:30-21:30',
    '2026-11-05 Nachtdienst 21:15-06:15→2026-11-06',
    '2026-11-06 Nachtdienst 21:15-06:15→2026-11-07',
    '2026-11-08 Spätdienst 13:30-21:30',
  ]);
  assert.deepEqual(parseShifts('Elternabend am 12.11. um 19 Uhr', today), []);
});

test('Stundenplan: Doppelstunden, freie Stunden, Serie bis zu den Sommerferien', () => {
  const text = `Stundenplan Klasse 5b
Std. Zeit | Montag | Dienstag | Mittwoch | Donnerstag | Freitag
1 7:55-8:40 | Mathe | Deutsch | Englisch | Sport | Bio
2 8:40-9:25 | Mathe | Deutsch | Englisch | Sport | Musik
3 9:45-10:30 | Deutsch | - | Mathe | Kunst | Mathe
4 10:30-11:15 | Englisch | - | Mathe | Kunst | Deutsch`;
  const ev = parseTimetable(text, today, { until: '2027-07-28', who: 'Mia' });
  const mo = ev.filter((e) => e.date === '2026-11-02').map((e) => `${e.title} ${e.start}-${e.end}`);
  assert.deepEqual(mo, ['Mathe (Mia) 07:55-09:25', 'Deutsch (Mia) 09:45-10:30', 'Englisch (Mia) 10:30-11:15']);
  const di = ev.filter((e) => e.date === '2026-11-03');
  assert.equal(di.length, 1);
  assert.deepEqual(di[0].repeat, { freq: 'weekly', interval: 1, until: '2027-07-28' });
  assert.deepEqual(di[0].forWhom, ['Mia']);
  assert.equal(ev.length, 3 + 1 + 2 + 2 + 4);
  assert.deepEqual(parseTimetable('Montag 10 Uhr Zahnarzt', today), []);
});

test('Ämtchenplan: reihum als versetzte Serien', async () => {
  const { rotationEvents } = await import('../www/js/aemtchen.js');
  const ev = rotationEvents({ task: 'Müll rausbringen', members: ['Ben', 'Mia', 'Jo'], freq: 'weekly', start: '2026-11-03' });
  assert.deepEqual(ev.map((e) => [e.title, e.date, e.responsible, e.repeat.interval]), [
    ['Müll rausbringen: Ben', '2026-11-03', 'Ben', 3], ['Müll rausbringen: Mia', '2026-11-10', 'Mia', 3], ['Müll rausbringen: Jo', '2026-11-17', 'Jo', 3],
  ]);
  const d = rotationEvents({ task: 'Kochen', members: ['A', 'B'], freq: 'daily', start: '2026-11-03', time: '18:00' });
  assert.deepEqual(d.map((e) => [e.date, e.start, e.repeat.freq, e.repeat.interval]), [['2026-11-03', '18:00', 'daily', 2], ['2026-11-04', '18:00', 'daily', 2]]);
});

test('Kasse: aufteilen, ausgleichen, zusammenführen, Link, GiroCode', async () => {
  const k = await import('../www/js/kasse.js');
  assert.equal(k.parseAmount('12,5'), 1250);
  assert.equal(k.parseAmount('3 €'), 300);
  assert.equal(k.parseAmount('abc'), null);
  const g = { id: 'g1', name: 'Ausflug', members: [{ name: 'Ben' }, { name: 'Mia', iban: 'DE89 3704 0044 0532 0130 00' }, { name: 'Jo' }], expenses: [
    { id: 'a', by: 'Mia', amount: 9000, text: 'Tickets', for: [], at: 1 },
    { id: 'b', by: 'Ben', amount: 1000, text: 'Eis', for: ['Ben', 'Jo'], at: 2 },
    { id: 'c', by: 'Jo', amount: 500, text: 'falsch', for: [], at: 3, deleted: true },
  ] };
  const bal = k.balances(g);
  assert.deepEqual(bal, { Ben: -2500, Mia: 6000, Jo: -3500 });
  assert.deepEqual(k.settle(bal), [{ from: 'Jo', to: 'Mia', amount: 3500 }, { from: 'Ben', to: 'Mia', amount: 2500 }]);
  assert.deepEqual(k.balances({ members: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], expenses: [{ by: 'A', amount: 100, for: [] }] }), { A: 66, B: -33, C: -33 });
  const back = await k.decodeGroup(await k.encodeGroup(g));
  assert.deepEqual(back, g);
  // Mia fügt hinzu, Ben löscht gleichzeitig etwas → beides bleibt erhalten
  const mia = { ...g, expenses: [...g.expenses, { id: 'd', by: 'Mia', amount: 200, text: 'Wasser', for: [], at: 4 }] };
  const ben = { ...g, expenses: g.expenses.map((e) => (e.id === 'b' ? { ...e, deleted: true } : e)) };
  const m = k.merge(mia, ben);
  assert.deepEqual(m.expenses.map((e) => `${e.id}${e.deleted ? '×' : ''}`), ['a', 'b×', 'c×', 'd']);
  assert.equal(k.validIban('DE89 3704 0044 0532 0130 00'), true);
  assert.equal(k.validIban('DE89 3704 0044 0532 0130 01'), false);
  assert.equal(k.epcPayload({ name: 'Mia', iban: 'DE89 3704 0044 0532 0130 00', amount: 3500, text: 'Ausflug' }), 'BCD\n002\n1\nSCT\n\nMia\nDE89370400440532013000\nEUR35.00\n\n\nAusflug');
});

test('Brückentage 2027 in Bayern', async () => {
  const { bridgeDays } = await import('../www/js/bruecken.js');
  const list = bridgeDays(2027, 'BY');
  const himmelfahrt = list.find((o) => o.holidays.includes('Christi Himmelfahrt') && o.vacation.length === 1);
  assert.deepEqual([himmelfahrt.start, himmelfahrt.end, himmelfahrt.vacation, himmelfahrt.free], ['2027-05-06', '2027-05-09', ['2027-05-07'], 4]);
  assert.ok(list.every((o) => o.free / o.vacation.length >= 2));
  assert.ok(list.some((o) => o.holidays.includes('Karfreitag')));
});
