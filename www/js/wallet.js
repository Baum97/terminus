// Wallet: Tickets, Bordkarten, Eintrittskarten als PDF oder Bild – nur auf diesem Gerät (IndexedDB).
// Ein Eintrag: { id, title, date?, kind, app?, appLabel?, note?, mime, name, added, blob }
const DB = 'terminus-wallet';
const STORE = 'items';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Speicher nicht verfügbar'));
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error || new Error('Speichern fehlgeschlagen'));
  });
}

export const putItem = (item) => tx('readwrite', (s) => s.put(item));
export const deleteItem = (id) => tx('readwrite', (s) => s.delete(id));
export const getItem = (id) => tx('readonly', (s) => s.get(id));
export const allItems = () => tx('readonly', (s) => s.getAll());

// Sortierung für die Ansicht: heute/kommend nach Datum, dann ohne Datum, abgelaufene zuletzt
export function sortItems(items, todayIso) {
  const group = (i) => (!i.date ? 1 : i.date >= todayIso ? 0 : 2);
  return items.slice().sort((a, b) => group(a) - group(b) || (a.date || '').localeCompare(b.date || '') || b.added - a.added);
}

// Passendes Ticket zu einem Termin: gleicher Tag und ähnlicher Titel (oder ausdrücklich verknüpft)
export function matchEvent(items, ev) {
  const t = String(ev.title || '').toLowerCase();
  return items.find((i) => i.eventKey && i.eventKey === `${ev.date}|${t}`)
    || items.find((i) => i.date === ev.date && (t.includes(String(i.title).toLowerCase()) || String(i.title).toLowerCase().includes(t)))
    || null;
}
