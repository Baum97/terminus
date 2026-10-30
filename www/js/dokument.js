// Dokumente als Quelle: E-Mails (.eml) und Bahntickets. Läuft komplett auf dem Gerät.
// PDFs liest pdf.js (siehe pdf.js), danach landet der Text hier oder in der normalen Erkennung.
import { normalizeEvent } from './events.js';
import { pad } from './dates.js';

/* ---------- E-Mail (.eml) ---------- */

function splitHeaders(raw) {
  const i = raw.search(/\r?\n\r?\n/);
  const head = (i < 0 ? raw : raw.slice(0, i)).replace(/\r?\n[ \t]+/g, ' ');
  const body = i < 0 ? '' : raw.slice(i).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in headers)) headers[m[1].toLowerCase()] = m[2];
  }
  return { headers, body };
}

const param = (value, name) => (value || '').match(new RegExp(`${name}="?([^";]+)"?`, 'i'))?.[1];

function bytesToText(bytes, charset = 'utf-8') {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const latin1Bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

function decodeBody(body, encoding = '', charset = 'utf-8') {
  const enc = encoding.toLowerCase();
  if (enc === 'base64') {
    try {
      return bytesToText(latin1Bytes(atob(body.replace(/\s+/g, ''))), charset);
    } catch {
      return '';
    }
  }
  if (enc === 'quoted-printable') {
    const s = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return bytesToText(latin1Bytes(s), charset);
  }
  return body;
}

// =?UTF-8?Q?Termin_f=C3=BCr_Ben?= → "Termin für Ben"
export function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([QB])\?([^?]*)\?=(?:\s+(?==\?))?/gi, (_, charset, kind, data) => {
    if (kind.toUpperCase() === 'B') return decodeBody(data, 'base64', charset);
    return decodeBody(data.replace(/_/g, ' '), 'quoted-printable', charset);
  });
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectParts(raw, out) {
  const { headers, body } = splitHeaders(raw);
  const type = (headers['content-type'] || 'text/plain').toLowerCase();
  const boundary = param(headers['content-type'], 'boundary');
  if (type.startsWith('multipart/') && boundary) {
    const pieces = body.split(`--${boundary}`).slice(1);
    for (const p of pieces) if (!p.startsWith('--')) collectParts(p.replace(/^\r?\n/, ''), out);
    return;
  }
  const text = decodeBody(body, headers['content-transfer-encoding'], param(headers['content-type'], 'charset') || 'utf-8');
  if (type.startsWith('text/calendar') || /\.ics"?$/i.test(param(headers['content-disposition'], 'filename') || '')) out.ics ??= text;
  else if (type.startsWith('text/plain') && !/attachment/i.test(headers['content-disposition'] || '')) out.plain ??= text;
  else if (type.startsWith('text/html')) out.html ??= text;
}

// Liefert { subject, from, date, text, ics } aus einer .eml-Datei
export function readEmail(raw) {
  const { headers } = splitHeaders(raw);
  const parts = {};
  collectParts(raw, parts);
  const subject = decodeWords(headers.subject || '').trim();
  const text = (parts.plain || (parts.html ? htmlToText(parts.html) : '')).trim();
  return { subject, from: decodeWords(headers.from || '').trim(), date: headers.date || '', text: subject ? `${subject}\n\n${text}` : text, ics: parts.ics || null };
}

/* ---------- Bahntickets ---------- */

const TRAIN = /\b(ICE|ECE|EC|IC|IRE|RE|RB|S|FLX|NJ|EN|RJX?|TGV|ALX|ME|MEX)\s?\d{1,5}\b/;
const STOP = /^(.+?)\s+(?:(\d{1,2})\.(\d{1,2})\.(\d{4})?\s+)?(ab|an)\s+(\d{1,2}):(\d{2})(.*)$/;

function inferYear(day, month, text, today) {
  const y = text.match(/\b\d{1,2}\.\d{1,2}\.(20\d{2})\b/)?.[1];
  if (y) return +y;
  const guess = new Date(today.getFullYear(), month - 1, day);
  return guess < new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2) ? today.getFullYear() + 1 : today.getFullYear();
}

// Erkennt Fahrkarten mit Verbindungstabelle (DB, Nahverkehr, viele Bahnen in Europa):
// "Frankfurt(Main)Hbf 08.11. ab 10:16 9 ICE 597 Wg. 7, Pl. 45" / "München Hbf 08.11. an 13:28 18".
// Liefert eine Fahrt je Hin- bzw. Rückweg, Umstiege stehen in den Notizen.
export function parseTicket(text, today = new Date()) {
  const raw = String(text || '');
  if (!/fahrkarte|ticket|reiseverbindung|reservierung|fahrschein|buchung/i.test(raw)) return [];
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const stops = [];
  let lastDate = null;
  for (const line of lines) {
    const m = line.match(STOP);
    if (!m) continue;
    const [, station, d, mo, , kind, h, mi, rest] = m;
    if (d) lastDate = { d: +d, mo: +mo };
    if (!lastDate) {
      const any = raw.match(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/);
      if (!any) continue;
      lastDate = { d: +any[1], mo: +any[2] };
    }
    const train = rest.match(TRAIN)?.[0]?.replace(/\s+/, ' ') || '';
    const platform = rest.replace(TRAIN, ' ').match(/^\s*(?:Gl\.?\s*)?(\d{1,2}\s?[a-f]?(?:-\d{1,2})?)\b/i)?.[1] || '';
    const seat = rest.match(/(Wg\.?|Wagen)\s*(\d+)[,;]?\s*(Pl\.?|Platz|Plätze)\s*([\d ,]+)/i);
    const year = inferYear(lastDate.d, lastDate.mo, raw, today);
    stops.push({
      station: station.replace(/\s+\d{1,2}\.\d{1,2}\.?$/, '').trim(), kind, date: `${year}-${pad(lastDate.mo)}-${pad(lastDate.d)}`, time: `${pad(+h)}:${mi}`,
      train, platform, seat: seat ? `Wagen ${seat[2]}, Platz ${seat[4].trim().replace(/[ ,]+$/, '')}` : '',
    });
  }
  // Abfahrt + folgende Ankunft = ein Abschnitt
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i].kind === 'ab' && stops[i + 1].kind === 'an') legs.push({ from: stops[i], to: stops[i + 1] });
  }
  if (!legs.length) return [];
  // Abschnitte zu Fahrten zusammenfassen; mehr als 4 Stunden Pause = neue Fahrt (z. B. Rückfahrt)
  const at = (s) => new Date(`${s.date}T${s.time}:00`).getTime();
  const trips = [];
  for (const leg of legs) {
    const cur = trips.at(-1);
    if (cur && at(leg.from) - at(cur.at(-1).to) >= 0 && at(leg.from) - at(cur.at(-1).to) < 4 * 3600000) cur.push(leg);
    else trips.push([leg]);
  }
  return trips.map((trip) => {
    const first = trip[0].from, last = trip.at(-1).to;
    const trains = trip.map((l) => l.from.train).filter(Boolean);
    const title = trip.length === 1 && trains[0] ? `${trains[0]} nach ${last.station}` : `Bahnfahrt nach ${last.station}`;
    const notes = trip.map((l) => [
      `${l.from.time} ${l.from.station}${l.from.platform ? ` (Gleis ${l.from.platform})` : ''}`,
      [l.from.train, l.from.seat].filter(Boolean).join(', '),
      `${l.to.time} ${l.to.station}${l.to.platform ? ` (Gleis ${l.to.platform})` : ''}`,
    ].filter(Boolean).join(' → ')).join('\n');
    const umstieg = trip.length > 1 ? `\n${trip.length - 1}× umsteigen` : '';
    return normalizeEvent({
      title, date: first.date, start: first.time, end: last.time, endDate: last.date !== first.date ? last.date : null,
      location: `${first.station}${first.platform ? `, Gleis ${first.platform}` : ''}`, notes: notes + umstieg, kind: 'termin',
    });
  }).filter(Boolean);
}
