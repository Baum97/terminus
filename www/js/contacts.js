// Kontakte: vCard-Import (Export aus Thunderbird, GMX, Web.de, Outlook, iCloud …)
// und Zusammenführen mit den gespeicherten Personen.
import { isEmail, newId } from './events.js';
import { normalizePhone } from './share.js';

function decodeQuotedPrintable(value, charset = 'utf-8') {
  const bytes = [];
  const s = value;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(s[i]));
    }
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}

const unescape = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

function parseLine(line) {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [rawName, ...params] = line.slice(0, colon).split(';');
  const name = rawName.split('.').pop().toUpperCase();
  const p = {};
  for (const param of params) {
    const [k, v = ''] = param.split('=');
    p[k.toUpperCase()] = v.replace(/"/g, '');
  }
  let value = line.slice(colon + 1);
  if ((p.ENCODING || '').toUpperCase() === 'QUOTED-PRINTABLE') value = decodeQuotedPrintable(value, p.CHARSET || 'utf-8');
  return { name, value };
}

// Liefert [{ name, emails: [], phone }]
export function parseVCards(text) {
  const lines = [];
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const prev = lines.length - 1;
    if (/^[ \t]/.test(raw) && prev >= 0) lines[prev] += raw.slice(1);
    // vCard 2.1: Quoted-Printable-Zeilen, die mit "=" enden, gehen in der nächsten Zeile weiter.
    else if (prev >= 0 && /QUOTED-PRINTABLE/i.test(lines[prev]) && lines[prev].endsWith('=')) lines[prev] = lines[prev].slice(0, -1) + raw;
    else lines.push(raw);
  }
  const contacts = [];
  let cur = null;
  for (const line of lines) {
    if (/^BEGIN:VCARD/i.test(line)) cur = { fn: '', n: '', emails: [], phone: '' };
    else if (/^END:VCARD/i.test(line)) {
      if (cur) {
        const [family = '', given = ''] = cur.n.split(';');
        const name = cur.fn || [given, family].map(unescape).filter(Boolean).join(' ');
        if (cur.emails.length || cur.phone) contacts.push({ name: name || cur.emails[0] || cur.phone, emails: cur.emails, phone: cur.phone });
      }
      cur = null;
    } else if (cur) {
      const prop = parseLine(line);
      if (!prop) continue;
      if (prop.name === 'FN') cur.fn = unescape(prop.value);
      else if (prop.name === 'N') cur.n = prop.value;
      else if (prop.name === 'EMAIL') {
        const email = unescape(prop.value).replace(/^mailto:/i, '').toLowerCase();
        if (isEmail(email) && !cur.emails.includes(email)) cur.emails.push(email);
      } else if (prop.name === 'TEL' && !cur.phone) cur.phone = unescape(prop.value).replace(/^tel:/i, '');
    }
  }
  return contacts;
}

// Eine Person je E-Mail-Adresse, damit man gezielt einladen kann.
export function contactsToPeople(contacts) {
  const people = [];
  for (const c of contacts) {
    const phone = normalizePhone(c.phone);
    if (!c.emails.length) {
      if (phone) people.push({ id: newId(), name: c.name, phone, email: '' });
      continue;
    }
    c.emails.forEach((email, i) => people.push({ id: newId(), name: c.name, email, phone: i === 0 ? phone : '' }));
  }
  return people;
}

// Neue Personen hinzufügen, vorhandene (gleiche E-Mail oder Nummer) ergänzen statt doppeln.
export function mergePeople(existing, incoming) {
  const out = existing.map((p) => ({ ...p }));
  let added = 0;
  for (const p of incoming) {
    const same = out.find((o) => (p.email && o.email === p.email) || (!p.email && p.phone && o.phone === p.phone));
    if (same) {
      if (!same.phone && p.phone) same.phone = p.phone;
      if ((!same.name || same.name === same.email) && p.name) same.name = p.name;
    } else {
      out.push(p);
      added++;
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { people: out, added };
}

export function matches(person, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return person.name.toLowerCase().includes(q) || (person.email || '').includes(q);
}

export function initials(name) {
  const parts = String(name || '?').replace(/[^\p{L}\s-]/gu, '').trim().split(/[\s-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
