// Terminfindung und Zusagen ohne Server.
// Abstimmung:  #u=<Umfrage>   – vom Organisator an alle
// Antwort:     #ua=<Antwort>  – von jeder Person zurück an den Organisator
// Zusage:      #z=<Zusage>    – Antwort auf eine Termin-Einladung (#t=)
// Alles steckt im Link hinter "#", wird also nie an einen Webserver geschickt.
import { isValidISO } from './dates.js';

const enc = (obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const dec = (code) => {
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(String(code).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const time = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null);

export const YES = 2, MAYBE = 1, NO = 0;

export function newPollId() {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

/* ---------- Abstimmung ---------- */

// poll: { id, title, location, by, options: [{ date, start, end }] }
export function encodePoll(poll) {
  return enc({ v: 1, i: poll.id, t: poll.title, l: poll.location || undefined, b: poll.by || undefined, o: poll.options.map((o) => [o.date, o.start || '', o.end || '']) });
}

export function decodePoll(code) {
  const d = dec(code);
  if (!d || d.v !== 1 || !/^[\w-]{4,24}$/.test(d.i || '') || !Array.isArray(d.o)) return null;
  const options = d.o.slice(0, 12).map(([date, start, end]) => ({ date, start: time(start), end: time(start) ? time(end) : null })).filter((o) => isValidISO(o.date));
  if (!options.length) return null;
  return { id: d.i, title: str(d.t, 120) || 'Termin', location: str(d.l, 200), by: str(d.b, 60), options };
}

// answer: { id, name, votes: [2|1|0 je Vorschlag] }
export function encodeAnswer({ id, name, votes }) {
  return enc({ v: 1, i: id, n: name, a: votes });
}

export function decodeAnswer(code) {
  const d = dec(code);
  if (!d || d.v !== 1 || !d.i || !Array.isArray(d.a)) return null;
  const name = str(d.n, 40);
  if (!name) return null;
  return { id: String(d.i).slice(0, 24), name, votes: d.a.slice(0, 12).map((x) => (x === YES || x === MAYBE ? x : NO)) };
}

// Übersicht je Vorschlag; bester = meiste Zusagen, dann meiste "vielleicht"
export function tally(poll, answers = {}) {
  const rows = poll.options.map((o, i) => {
    const yes = [], maybe = [], no = [];
    for (const [name, votes] of Object.entries(answers)) (votes[i] === YES ? yes : votes[i] === MAYBE ? maybe : no).push(name);
    return { ...o, index: i, yes, maybe, no, score: yes.length * 2 + maybe.length };
  });
  const top = Math.max(...rows.map((r) => r.score));
  const best = Object.keys(answers).length && top > 0 ? rows.filter((r) => r.score === top).map((r) => r.index) : [];
  return { rows, best, people: Object.keys(answers).length };
}

/* ---------- Zusagen zu Einladungen ---------- */

export const eventKey = (ev) => `${ev.date}|${ev.start || ''}|${String(ev.title || '').trim().toLowerCase()}`.slice(0, 160);

export const RSVP = { ja: 'kommt', vielleicht: 'vielleicht', nein: 'kommt nicht' };

export function encodeRsvp({ ev, name, status }) {
  return enc({ v: 1, k: eventKey(ev), t: ev.title, d: ev.date, s: ev.start || '', n: name, r: status });
}

export function decodeRsvp(code) {
  const d = dec(code);
  if (!d || d.v !== 1 || !d.k || !(d.r in RSVP) || !isValidISO(d.d)) return null;
  const name = str(d.n, 40);
  if (!name) return null;
  return { key: String(d.k).slice(0, 160), title: str(d.t, 120), date: d.d, start: time(d.s), name, status: d.r };
}
