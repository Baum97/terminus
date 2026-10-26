// Sicherung: Personen, Familie, gemerkte Termine und Einstellungen als JSON-Datei.
// Der API-Schlüssel bleibt draußen, er gehört nicht in eine Datei, die man herumschickt.
import { normalizeEvents } from './events.js';

const VERSION = 1;

export function buildBackup({ settings, people, family, saved }, now = new Date()) {
  const { apiKey, ...safeSettings } = settings || {};
  return JSON.stringify({ app: 'terminus', version: VERSION, created: now.toISOString(), settings: safeSettings, people, family, saved }, null, 2);
}

// Liefert die geprüften Daten oder wirft einen Fehler mit verständlicher Meldung
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Das ist keine Terminus-Sicherung (kein gültiges JSON).');
  }
  if (!data || data.app !== 'terminus') throw new Error('Das ist keine Terminus-Sicherung.');
  if (data.version > VERSION) throw new Error('Diese Sicherung stammt aus einer neueren Terminus-Version. Bitte zuerst die App aktualisieren.');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  return {
    created: typeof data.created === 'string' ? data.created : '',
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
    people: list(data.people).filter((p) => typeof p.name === 'string'),
    family: list(data.family).filter((m) => typeof m.name === 'string'),
    saved: normalizeEvents(list(data.saved)),
  };
}

export function backupFileName(now = new Date()) {
  return `terminus-sicherung-${now.toISOString().slice(0, 10)}.json`;
}
