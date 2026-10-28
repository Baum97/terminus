import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAboStore } from '../proxy/abo.mjs';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Vorlesung Analysis\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

test('Abo anlegen, abrufen, ändern, widerrufen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abo-'));
  const store = createAboStore(dir);
  const { id, key } = await store.create({ ics: ICS, title: 'Semester WiSe 26/27\nX' });
  assert.match(id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal((await store.get(id)).ics, ICS);
  assert.equal((await store.get(id)).title, 'Semester WiSe 26/27 X');
  // Der Schlüssel liegt nur als Hash auf dem Server
  const metaFile = (await readdir(dir)).find((f) => f.endsWith('.json'));
  assert.doesNotMatch(await readFile(join(dir, metaFile), 'utf8'), new RegExp(key));
  await assert.rejects(store.update(id, 'falsch', { ics: ICS }), { status: 403 });
  await store.update(id, key, { ics: ICS.replace('Analysis', 'Lineare Algebra') });
  assert.match((await store.get(id)).ics, /Lineare Algebra/);
  await assert.rejects(store.remove(id, 'falsch'), { status: 403 });
  await store.remove(id, key);
  await assert.rejects(store.get(id), { status: 404 });
});

test('Abo-Server lehnt Ungültiges ab', async () => {
  const store = createAboStore(await mkdtemp(join(tmpdir(), 'abo-')));
  await assert.rejects(store.create({ ics: 'Hallo' }), { status: 400 });
  await assert.rejects(store.create({ ics: `BEGIN:VCALENDAR\r\n${'X'.repeat(1024 * 1024)}\r\nEND:VCALENDAR\r\n` }), { status: 413 });
  await assert.rejects(store.get('../../etc/passwd'), { status: 404 });
  await assert.rejects(store.get('a'.repeat(22)), { status: 404 });
});
