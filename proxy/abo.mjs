// Abo-Links: Ein Kalender wird als .ics-Datei unter einer zufälligen Adresse veröffentlicht.
// Wer die Adresse kennt, kann ihn abonnieren (nur lesen). Ändern und löschen darf nur, wer den
// Bearbeitungsschlüssel hat; der Server speichert davon nur einen Hash.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_ICS = 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{22}$/;
const hash = (key) => createHash('sha256').update(String(key)).digest();

export class AboError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function checkIcs(ics) {
  if (typeof ics !== 'string' || !ics.startsWith('BEGIN:VCALENDAR') || !/END:VCALENDAR\s*$/.test(ics)) {
    throw new AboError(400, 'Keine gültige Kalenderdatei.');
  }
  if (Buffer.byteLength(ics) > MAX_ICS) throw new AboError(413, 'Kalender zu groß (höchstens 1 MB).');
}

const cleanTitle = (t) => String(t || 'Kalender').replace(/[\r\n]+/g, ' ').slice(0, 80);

export function createAboStore(dir) {
  const files = (id) => ({ ics: join(dir, `${id}.ics`), meta: join(dir, `${id}.json`) });

  async function meta(id) {
    if (!ID.test(id)) throw new AboError(404, 'Unbekanntes Abo.');
    try {
      return JSON.parse(await readFile(files(id).meta, 'utf8'));
    } catch {
      throw new AboError(404, 'Unbekanntes Abo.');
    }
  }

  async function authorize(id, key) {
    const m = await meta(id);
    const a = Buffer.from(m.keyHash, 'hex');
    const b = hash(key || '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AboError(403, 'Falscher Bearbeitungsschlüssel.');
    return m;
  }

  return {
    async create({ ics, title }) {
      checkIcs(ics);
      await mkdir(dir, { recursive: true });
      const id = randomBytes(16).toString('base64url');
      const key = randomBytes(24).toString('base64url');
      const now = new Date().toISOString();
      await writeFile(files(id).ics, ics);
      await writeFile(files(id).meta, JSON.stringify({ title: cleanTitle(title), keyHash: hash(key).toString('hex'), created: now, updated: now }));
      return { id, key };
    },
    async update(id, key, { ics, title }) {
      const m = await authorize(id, key);
      checkIcs(ics);
      await writeFile(files(id).ics, ics);
      await writeFile(files(id).meta, JSON.stringify({ ...m, title: title ? cleanTitle(title) : m.title, updated: new Date().toISOString() }));
      return { id };
    },
    async remove(id, key) {
      await authorize(id, key);
      await rm(files(id).ics, { force: true });
      await rm(files(id).meta, { force: true });
    },
    async get(id) {
      const m = await meta(id);
      return { ics: await readFile(files(id).ics, 'utf8'), title: m.title, updated: m.updated };
    },
  };
}
