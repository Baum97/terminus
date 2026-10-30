// Listen (Einkauf, Packliste, To-dos). Mit Tasks.org/OpenTasks auf dem Handy über DAVx⁵ geteilt,
// sonst lokal in Terminus. Reine Hilfsfunktionen, die Oberfläche steht in listenui.js.

// "Milch, 2 Eier und Brot" → ["Milch", "2 Eier", "Brot"]
export function splitItems(text) {
  return String(text || '')
    .split(/\s*(?:[,;\n]|\bund\b|\s\+\s)\s*/i)
    .map((s) => s.replace(/^[-•*☐☑✓]\s*/, '').trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 120));
}

// Zum Verschicken als Nachricht: offene zuerst, erledigte durchgestrichen am Ende
export function listText(name, items) {
  const open = items.filter((i) => !i.done).map((i) => `☐ ${i.text}`);
  const done = items.filter((i) => i.done).map((i) => `☑ ${i.text}`);
  return [`📝 ${name}`, ...open, ...(done.length ? ['', ...done] : [])].join('\n');
}

// Liste als Link (#l=…): Empfänger kann sie als eigene Kopie übernehmen
export function encodeList(name, items) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, n: name, i: items.filter((i) => !i.done).map((i) => i.text) }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeList(code) {
  try {
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (d.v !== 1 || !Array.isArray(d.i)) return null;
    return { name: String(d.n || 'Liste').slice(0, 60), items: d.i.filter((x) => typeof x === 'string').slice(0, 200).map((x) => x.slice(0, 120)) };
  } catch {
    return null;
  }
}

// Ein Eintrag gleichen Namens wird nicht doppelt angelegt (offen oder wieder geöffnet)
export function mergeItem(items, text) {
  const hit = items.find((i) => i.text.toLowerCase() === text.toLowerCase());
  if (hit) return { items: items.map((i) => (i === hit ? { ...i, done: false } : i)), added: false };
  return { items: [...items, { id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, done: false }], added: true };
}
