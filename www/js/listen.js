// Listen (Einkauf, Packliste, To-dos). Mit Tasks.org/OpenTasks auf dem Handy über DAVx⁵ geteilt,
// sonst lokal in Terminus. Reine Hilfsfunktionen, die Oberfläche steht in listenui.js.

// "Milch, 2 Eier und Brot" → ["Milch", "2 Eier", "Brot"]
export function splitItems(text) {
  return String(text || '')
    .split(/\s*(?:[,;،\n]|\bund\b|\s\+\s)\s*/i)
    .map((s) => s.replace(/^[-•*☐☑✓]\s*/, '').trim())
    .filter(Boolean)
    .map((s) => s.slice(0, 120));
}

// "Einkauf: Milch, Eier und Brot" → eine Aufgabe „Einkauf“ mit drei Unterpunkten
export function splitTitled(text) {
  const m = String(text || '').match(/^\s*([^:\n]{1,40}?)\s*:\s*(.+)$/s);
  // keine Uhrzeit („um 12:30“), kein Link („https://…“)
  if (!m || !/\p{L}/u.test(m[1]) || (/\d$/.test(m[1]) && /^\d/.test(m[2])) || /^\//.test(m[2])) return null;
  const items = splitItems(m[2]);
  return items.length ? { title: m[1][0].toUpperCase() + m[1].slice(1), items } : null;
}

// Unterpunkte stehen bei Tasks.org/OpenTasks als Markdown-Checkliste in der Beschreibung
// („- [ ] Milch“): So zeigen auch Tasks.org und Nextcloud Tasks sie als Häkchen-Liste.
const CHECK = /^\s*(?:[-*+]\s*)?\[([ xX])\]\s+(.+?)\s*$|^\s*([☐☑✓])\s*(.+?)\s*$/;
export function parseChecklist(notes) {
  const sub = [];
  const rest = [];
  for (const line of String(notes || '').split(/\r?\n/)) {
    const m = line.match(CHECK);
    if (m) sub.push({ text: (m[2] || m[4]).slice(0, 120), done: m[1] ? m[1] !== ' ' : m[3] !== '☐' });
    else rest.push(line);
  }
  return { sub, rest: rest.join('\n').trim() };
}

export function checklistNotes(sub, rest = '') {
  const lines = (sub || []).map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}`);
  return [String(rest || '').trim(), lines.join('\n')].filter(Boolean).join('\n\n');
}

// Unterpunkte dazu: gleiche werden nicht doppelt angelegt, abgehakte wieder geöffnet
export function addSubs(sub, texts) {
  let out = [...(sub || [])];
  for (const t of texts) {
    const hit = out.findIndex((s) => s.text.toLowerCase() === t.toLowerCase());
    if (hit >= 0) out = out.map((s, i) => (i === hit ? { ...s, done: false } : s));
    else out.push({ text: t.slice(0, 120), done: false });
  }
  return out.slice(0, 100);
}

export const subProgress = (sub) => (sub?.length ? `${sub.filter((s) => s.done).length}/${sub.length}` : '');

// Zum Verschicken als Nachricht: offene zuerst, erledigte durchgestrichen am Ende; Unterpunkte eingerückt
export function listText(name, items) {
  const line = (i) => [`${i.done ? '☑' : '☐'} ${i.text}`, ...(i.sub || []).map((s) => `    ${s.done ? '☑' : '☐'} ${s.text}`)];
  const open = items.filter((i) => !i.done).flatMap(line);
  const done = items.filter((i) => i.done).flatMap(line);
  return [`📝 ${name}`, ...open, ...(done.length ? ['', ...done] : [])].join('\n');
}

// Liste als Link (#l=…): Empfänger kann sie als eigene Kopie übernehmen.
// Unterpunkte stehen getrennt in „s“ (Index → Texte), damit ältere Versionen den Link weiter lesen.
export function encodeList(name, items) {
  const open = items.filter((i) => !i.done);
  const s = {};
  open.forEach((i, n) => {
    const subs = (i.sub || []).filter((x) => !x.done).map((x) => x.text);
    if (subs.length) s[n] = subs;
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, n: name, i: open.map((i) => i.text), ...(Object.keys(s).length ? { s } : {}) }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeList(code) {
  try {
    const d = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (d.v !== 1 || !Array.isArray(d.i)) return null;
    const out = { name: String(d.n || 'Liste').slice(0, 60), items: d.i.filter((x) => typeof x === 'string').slice(0, 200).map((x) => x.slice(0, 120)) };
    if (d.s && typeof d.s === 'object') {
      const sub = {};
      for (const [k, v] of Object.entries(d.s)) {
        if (out.items[+k] !== undefined && Array.isArray(v)) sub[+k] = v.filter((x) => typeof x === 'string').slice(0, 100).map((x) => x.slice(0, 120));
      }
      if (Object.keys(sub).length) out.sub = sub;
    }
    return out;
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

// Zettel ohne Datum (Einkaufszettel, To-do-Liste): jede kurze Zeile wird eine Aufgabe
export function taskLines(text, max = 20) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.replace(/^\s*(?:[-•*☐☑✓▪·]|\d{1,2}[.)]|\[\s?[xX]?\s?\])\s*/, '').replace(/\s+/g, ' ').trim();
    if (l.length < 2 || l.length > 60 || !/\p{L}{2}/u.test(l)) continue;
    if (l.split(' ').length > 8 || /[.!?]$/.test(l) && l.split(' ').length > 4) continue;
    if (/^(liebe|lieber|hallo|hi|sehr geehrte|viele grüße|mit freundlichen|einkauf(sliste)?|to-?do|liste|aufgaben)\b[:,]?$/i.test(l)) continue;
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
    if (out.length >= max) break;
  }
  return out.length >= 2 ? out : [];
}

// Lebensmittel und Drogerie: daran erkennt Terminus einen Einkaufszettel
const GROCERY = /(?<![\p{L}])(milch|eier?|brot|brötchen|toast|butter|käse|joghurt|quark|sahne|mehl|zucker|salz|pfeffer|nudeln|spaghetti|reis|kartoffeln|tomaten|gurken?|äpfel|apfel|bananen?|birnen|trauben|zitronen?|orangen|obst|gemüse|salat|möhren|karotten|zwiebeln?|knoblauch|paprika|brokkoli|wurst|schinken|salami|hack|fleisch|hähnchen|fisch|kaffee|tee|saft|wasser|sprudel|bier|wein|cola|müsli|haferflocken|marmelade|honig|nutella|öl|essig|ketchup|senf|chips|schokolade|kekse|pizza|klopapier|toilettenpapier|küchenrolle|taschentücher|spülmittel|waschmittel|zahnpasta|shampoo|duschgel|seife|windeln|katzenfutter|hundefutter)(?![\p{L}])/iu;
const HEADING = /^(einkauf\w*|to-?dos?|zu erledigen|erledigen|liste|aufgaben|packliste.*|mitnehmen|besorgen|kaufen|baumarkt|drogerie|supermarkt|rewe|edeka|aldi|lidl|penny|netto|kaufland|dm|rossmann)\s*:?$/i;

// Zettel ohne Datum → eine Aufgabe mit Unterpunkten: { title, items } oder null.
// Überschrift („Einkaufsliste“, „Rewe:“) wird zum Titel, sonst „Einkauf“ bei Lebensmitteln, sonst „Zu erledigen“.
export function taskSheet(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  let title = '';
  const first = lines[0]?.replace(/^[-•*☐☑✓▪·]\s*/, '') || '';
  if (first && (HEADING.test(first) || (/:$/.test(first) && first.split(' ').length <= 3))) title = first.replace(/\s*:$/, '');
  const items = taskLines(title ? lines.slice(1).join('\n') : lines.join('\n'), 100);
  if (title ? !items.length : items.length < 2) return null;
  if (!title) title = items.filter((i) => GROCERY.test(i)).length >= Math.max(2, Math.ceil(items.length / 3)) ? 'Einkauf' : 'Zu erledigen';
  return { title: title[0].toUpperCase() + title.slice(1), items };
}

// Gleiche Liste gemeint? „Einkaufsliste“ ≈ „Einkauf“, „Packzettel“ ≈ „Pack“
export const sameList = (a, b) => {
  const n = (x) => String(x || '').toLowerCase().trim().replace(/s?(liste|zettel)$/, '');
  return !!n(a) && n(a) === n(b);
};
