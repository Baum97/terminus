// Teilen an andere Personen: Nachrichtentext, Termin-Link, WhatsApp- und Mail-Links.
// Der Termin steckt im Link-Anker (#t=…). Der Teil hinter # wird nie an einen Server geschickt.
import { fmtWhen, fmtDate, fmtRepeat } from './dates.js';
import { normalizeEvent } from './events.js';

const KEYS = { title: 't', date: 'd', endDate: 'e', start: 's', end: 'n', location: 'l', notes: 'o', bring: 'b', cost: 'c', kind: 'k', repeat: 'r' };

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeEvent(ev) {
  const compact = {};
  for (const [k, short] of Object.entries(KEYS)) {
    const v = ev[k];
    if (v == null || v === '' || (Array.isArray(v) && !v.length) || (k === 'kind' && v === 'termin')) continue;
    compact[short] = k === 'notes' ? v.slice(0, 300) : v;
  }
  return b64urlEncode(JSON.stringify(compact));
}

export function decodeEvent(code) {
  try {
    const compact = JSON.parse(b64urlDecode(code));
    const raw = {};
    for (const [k, short] of Object.entries(KEYS)) if (compact[short] != null) raw[k] = compact[short];
    return normalizeEvent(raw);
  } catch {
    return null;
  }
}

export function eventLink(ev, base = location.origin + location.pathname) {
  return `${base}#t=${encodeEvent(ev)}`;
}

export function messageText(ev, link) {
  const lines = [`${ev.kind === 'frist' ? '⏰ Frist: ' : '📅 '}${ev.title}`, ev.kind === 'frist' ? `bis ${fmtDate(ev.date)}` : fmtWhen(ev)];
  if (ev.repeat) lines.push(`🔁 ${fmtRepeat(ev)}`);
  if (ev.location) lines.push(`📍 ${ev.location}`);
  if (ev.bring?.length) lines.push(`🎒 Mitbringen: ${ev.bring.join(', ')}`);
  if (ev.cost) lines.push(`💶 ${ev.cost}`);
  if (link) lines.push('', `In den Kalender: ${link}`);
  return lines.join('\n');
}

// "0171 123 45 67" oder "+49 171 …" → "491711234567" für wa.me
export function normalizePhone(input) {
  let d = String(input || '').replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = '49' + d.slice(1);
  return /^\d{8,15}$/.test(d) ? d : '';
}

export function whatsappLink(text, phone = '') {
  return `https://wa.me/${normalizePhone(phone)}?text=${encodeURIComponent(text)}`;
}

export function mailLink(text, subject, email = '') {
  return `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

export function mailtoMany(emails, subject, body) {
  return `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const firstName = (name) => String(name).trim().split(/\s+/)[0];

// Einladungs-Mail an eine oder mehrere Personen, in Du-Form.
export function inviteMail(ev, guests, { ownerName = '', link = '', withAttachment = false } = {}) {
  const one = guests.length === 1;
  const named = one && guests[0].name && !guests[0].name.includes('@');
  const lines = [
    named ? `Hallo ${firstName(guests[0].name)},` : one ? 'Hallo,' : 'Hallo zusammen,',
    '',
    `ich lade ${one ? 'dich' : 'euch'} zu folgendem Termin ein:`,
    '',
    ev.title,
    fmtWhen(ev),
  ];
  if (ev.location) lines.push(`Ort: ${ev.location}`);
  if (ev.bring?.length) lines.push(`Mitbringen: ${ev.bring.join(', ')}`);
  if (ev.cost) lines.push(`Kosten: ${ev.cost}`);
  if (ev.notes && ev.notes.length < 200) lines.push(ev.notes);
  if (link) lines.push('', `Mit einem Klick in ${one ? 'deinen' : 'euren'} Kalender:`, link);
  if (withAttachment) lines.push('', `Die Kalenderdatei hängt außerdem an. ${one ? 'Öffne' : 'Öffnet'} sie, um den Termin zu übernehmen.`);
  lines.push('', 'Viele Grüße');
  if (ownerName) lines.push(ownerName);
  return { subject: `Einladung: ${ev.title} (${fmtDate(ev.date)})`, body: lines.join('\n') };
}
