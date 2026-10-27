// Alles bleibt im Browser dieses Geräts (localStorage). Kein Konto, keine Cloud.
import { normalizeEvents } from './events.js';

const KEY = { settings: 'terminus.settings', people: 'terminus.people', saved: 'terminus.saved', family: 'terminus.family', setup: 'terminus.setup' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_SETTINGS = { provider: null, endpoint: '', model: '', apiKey: '', alarmMinutes: 60, defaultMinutes: 60, ownerName: '', ownerEmail: '', state: '', lang: 'de', eveReminder: true, photoFallback: true, showBirthdays: true, familyCalendarId: '' };

export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read(KEY.settings, {}) });
export const setSettings = (s) => write(KEY.settings, s);

export const getPeople = () => read(KEY.people, []);
export const setPeople = (p) => write(KEY.people, p);

export const getSaved = () => normalizeEvents(read(KEY.saved, []));
export function addSaved(events) {
  const byId = new Map(getSaved().map((e) => [e.id, e]));
  events.forEach((e) => byId.set(e.id, e));
  return write(KEY.saved, [...byId.values()]);
}
export const removeSaved = (id) => write(KEY.saved, getSaved().filter((e) => e.id !== id));
export const clearSaved = () => write(KEY.saved, []);

// Familienmitglieder: [{ id, name, role: 'kind' | 'erw' }]
export const getFamily = () => read(KEY.family, []);
export const setFamily = (f) => write(KEY.family, f);

// Stand des Einrichtungsassistenten (ohne Passwörter)
export const getSetup = () => read(KEY.setup, {});
export const setSetup = (v) => write(KEY.setup, v);
