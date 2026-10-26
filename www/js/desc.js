// Die Terminbeschreibung trägt die gemeinsamen Angaben der Familie. Sie wird über CalDAV mit allen
// geteilt und ist in jeder Kalender-App lesbar:
//
//   Treffpunkt am Haupteingang.
//
//   Mitbringen:
//   ☐ Laterne
//   ☑ Teelicht
//   Für: Mia, Ben
//   Zuständig: Papa
//   Kosten: 3 €

const OPEN = '☐';
const DONE = '☑';
const RE_ITEM = /^\s*([☐☑✓✔□■]|\[( |x|X)\])\s*(.+)$/u;
const RE_FIELD = /^\s*(Mitbringen|Für|Zuständig|Kosten)\s*:\s*(.*)$/i;

export function buildDescription({ notes = '', bring = [], forWhom = [], responsible = '', cost = '' } = {}) {
  const meta = [];
  if (bring.length) {
    meta.push('Mitbringen:');
    for (const b of bring) meta.push(`${b.done ? DONE : OPEN} ${b.text}`);
  }
  if (forWhom.length) meta.push(`Für: ${forWhom.join(', ')}`);
  if (responsible) meta.push(`Zuständig: ${responsible}`);
  if (cost) meta.push(`Kosten: ${cost}`);
  return [notes.trim(), meta.join('\n')].filter(Boolean).join('\n\n');
}

export function parseDescription(text = '') {
  const out = { notes: '', bring: [], forWhom: [], responsible: '', cost: '' };
  const rest = [];
  let inList = false;
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const item = line.match(RE_ITEM);
    if (item && (inList || out.bring.length)) {
      const done = item[1] === DONE || /[✓✔■]/.test(item[1]) || /x/i.test(item[2] || '');
      out.bring.push({ text: item[3].trim(), done });
      continue;
    }
    const field = line.match(RE_FIELD);
    if (field) {
      const key = field[1].toLowerCase();
      const value = field[2].trim();
      inList = key === 'mitbringen';
      // Ältere Form: "Mitbringen: Laterne, Teelicht" in einer Zeile
      if (inList && value) value.split(/,\s*/).filter(Boolean).forEach((t) => out.bring.push({ text: t, done: false }));
      if (key === 'für') out.forWhom = value.split(/,\s*/).filter(Boolean);
      if (key === 'zuständig') out.responsible = value;
      if (key === 'kosten') out.cost = value;
      continue;
    }
    inList = false;
    rest.push(line);
  }
  out.notes = rest.join('\n').trim();
  return out;
}

// Aus einem Terminus-Termin (Entwurf oder gemerkt)
export function describeEvent(ev) {
  return buildDescription({
    notes: ev.notes || '',
    bring: (ev.bring || []).map((text) => ({ text, done: (ev.done || []).includes(text) })),
    forWhom: ev.forWhom || [],
    responsible: ev.responsible || '',
    cost: ev.cost || '',
  });
}
