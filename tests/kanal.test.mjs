import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newChannel, buildPackage, openPackage, judge, packageLink } from '../www/js/kanal.js';
import { aboFromDevice } from '../www/js/aboexport.js';
import { parseICS } from '../www/js/icsimport.js';

// Ein Semester: 14 Vorlesungsreihen und 6 Einzeltermine
const rows = [];
for (let i = 0; i < 14; i++) rows.push({ id: `${i}`, title: `Vorlesung ${i + 1}: Grundlagen der Informatik`, start: Date.UTC(2026, 9, 19 + (i % 5), 8 + (i % 4) * 2, 15), duration: 'P5400S', rrule: 'FREQ=WEEKLY;UNTIL=20270205T235959Z', allDay: false, location: `Hörsaal ${i % 4 + 1}, Gebäude E1`, description: '' });
for (let i = 0; i < 6; i++) rows.push({ id: `k${i}`, title: `Klausur ${i + 1}`, start: Date.UTC(2027, 1, 8 + i, 8), end: Date.UTC(2027, 1, 8 + i, 10), allDay: false, location: 'Audimax', description: '' });
const ics = aboFromDevice(rows, { name: 'Informatik WiSe 26/27', calendarId: '7' });

test('Kalender-Paket: kompletter Stand, klein genug für eine Nachricht, prüfbar', async () => {
  const ch = await newChannel();
  const pkg = await buildPackage({ ...ch, name: 'Informatik WiSe 26/27', by: 'Fachschaft', ics, seq: 1000 });
  const link = packageLink('https://baum97.github.io/terminus/', pkg);
  assert.ok(link.length < ics.length / 2, `Link ${link.length} Zeichen, .ics ${ics.length}`);
  const opened = await openPackage(pkg);
  assert.deepEqual([opened.name, opened.by, opened.seq, opened.count, opened.channel], ['Informatik WiSe 26/27', 'Fachschaft', 1000, 20, ch.channel]);
  assert.equal(opened.ics, ics);
  assert.match(opened.fingerprint, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assert.equal(parseICS(opened.ics).events.length, 20);
});

test('Gefälschte oder veränderte Pakete werden abgelehnt', async () => {
  const ch = await newChannel();
  const pkg = await buildPackage({ ...ch, name: 'Semester', ics, seq: 1 });
  const [head, body, sig] = pkg.split('.');
  // Inhalt eines anderen Kalenders mit der alten Signatur
  const other = await buildPackage({ ...ch, name: 'Semester', ics: ics.replace('Audimax', 'Mensa'), seq: 1 });
  await assert.rejects(openPackage(`${head}.${other.split('.')[1]}.${sig}`), { code: 'signature' });
  await assert.rejects(openPackage(`${head}.${body}`), { code: 'format' });
  await assert.rejects(openPackage('Quatsch'), { code: 'format' });
  // Ein Fremder baut ein gültig signiertes Paket für denselben Kanal
  const fremd = await newChannel();
  const fake = await openPackage(await buildPackage({ ...fremd, channel: ch.channel, name: 'Semester', ics, seq: 5 }));
  const known = { publicKey: ch.publicKey, seq: 1 };
  assert.equal(judge(fake, known).action, 'reject');
});

test('Neuere Stände ersetzen ältere, alte Links ändern nichts', async () => {
  const ch = await newChannel();
  const v1 = await openPackage(await buildPackage({ ...ch, name: 'S', ics, seq: 100 }));
  const v2 = await openPackage(await buildPackage({ ...ch, name: 'S', ics, seq: 200 }));
  assert.equal(judge(v1, undefined).action, 'subscribe');
  assert.equal(judge(v2, { publicKey: ch.publicKey, seq: 100 }).action, 'update');
  assert.equal(judge(v1, { publicKey: ch.publicKey, seq: 200 }).action, 'current');
  assert.equal(judge(v2, { publicKey: ch.publicKey, seq: 200 }).reason, 'Du hast diesen Stand schon.');
});
