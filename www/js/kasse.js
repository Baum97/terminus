// Gemeinsame Kasse (Ausflug, WG, Kita-Kasse) ohne Server.
// Der komplette Stand reist als Link (#ka=…). Wer einen Stand öffnet, führt ihn mit dem eigenen zusammen:
// Ausgaben werden über ihre Kennung vereinigt, gelöschte bleiben als "gelöscht" markiert.
// Beträge in Cent.

export const newId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10);

// "12,50" / "12.5" / "12 €" → 1250
export function parseAmount(s) {
  const m = String(s || '').replace(/\s|€|eur/gi, '').match(/^(\d{1,6})(?:[.,](\d{1,2}))?$/);
  return m ? +m[1] * 100 + +(m[2] || '0').padEnd(2, '0') : null;
}

export const euro = (cents) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

// Gleichmäßig aufteilen; übrige Cent bekommen die Ersten
function shares(amount, people) {
  const base = Math.floor(amount / people.length);
  let rest = amount - base * people.length;
  return people.map((p) => [p, base + (rest-- > 0 ? 1 : 0)]);
}

export function balances(group) {
  const bal = Object.fromEntries(group.members.map((m) => [m.name, 0]));
  for (const e of group.expenses || []) {
    if (e.deleted || !(e.by in bal)) continue;
    const forWhom = (e.for?.length ? e.for : Object.keys(bal)).filter((n) => n in bal);
    if (!forWhom.length) continue;
    bal[e.by] += e.amount;
    for (const [p, c] of shares(e.amount, forWhom)) bal[p] -= c;
  }
  return bal;
}

// Wenige Überweisungen: größter Schuldner zahlt an größten Gläubiger
export function settle(bal) {
  const debt = Object.entries(bal).filter(([, v]) => v < 0).map(([n, v]) => [n, -v]).sort((a, b) => b[1] - a[1]);
  const cred = Object.entries(bal).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const out = [];
  while (debt.length && cred.length) {
    const [d, dv] = debt[0], [c, cv] = cred[0];
    const x = Math.min(dv, cv);
    out.push({ from: d, to: c, amount: x });
    debt[0][1] -= x;
    cred[0][1] -= x;
    if (!debt[0][1]) debt.shift();
    if (!cred[0][1]) cred.shift();
  }
  return out;
}

// Zwei Stände zusammenführen (gleiche Kasse)
export function merge(a, b) {
  if (!a) return b;
  const members = [...a.members];
  for (const m of b.members) {
    const hit = members.find((x) => x.name === m.name);
    if (!hit) members.push(m);
    else if (!hit.iban && m.iban) hit.iban = m.iban;
  }
  const byId = new Map(a.expenses.map((e) => [e.id, e]));
  for (const e of b.expenses) {
    const old = byId.get(e.id);
    byId.set(e.id, old ? { ...old, deleted: old.deleted || e.deleted } : e);
  }
  return { ...a, name: a.name || b.name, members, expenses: [...byId.values()].sort((x, y) => x.at - y.at) };
}

/* ---------- Link (komprimiert) ---------- */

const b64 = (bytes) => {
  let bin = '';
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function encodeGroup(g) {
  const compact = {
    v: 1, i: g.id, n: g.name, m: g.members.map((m) => (m.iban ? [m.name, m.iban] : [m.name])),
    e: g.expenses.map((e) => [e.id, e.by, e.amount, e.text, e.for || [], e.at, e.deleted ? 1 : 0, e.settle ? 1 : 0]),
  };
  return b64(await pipe(new TextEncoder().encode(JSON.stringify(compact)), new CompressionStream('deflate-raw')));
}

export async function decodeGroup(code) {
  try {
    const d = JSON.parse(new TextDecoder().decode(await pipe(unb64(code), new DecompressionStream('deflate-raw'))));
    if (d.v !== 1 || !d.i || !Array.isArray(d.m) || !Array.isArray(d.e)) return null;
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    return {
      id: str(d.i, 20), name: str(d.n, 60) || 'Kasse',
      members: d.m.map(([name, iban]) => ({ name: str(name, 40), ...(iban ? { iban: str(iban, 34) } : {}) })).filter((m) => m.name).slice(0, 30),
      expenses: d.e.filter((e) => Array.isArray(e) && Number.isInteger(e[2]) && e[2] > 0 && e[2] < 1e8).slice(0, 2000).map(([id, by, amount, text, forWhom, at, del, st]) => ({
        id: str(id, 20), by: str(by, 40), amount, text: str(text, 80), for: Array.isArray(forWhom) ? forWhom.map((x) => str(x, 40)) : [], at: +at || 0,
        ...(del ? { deleted: true } : {}), ...(st ? { settle: true } : {}),
      })),
    };
  } catch {
    return null;
  }
}

/* ---------- Überweisen per GiroCode (EPC-QR, von deutschen Banking-Apps lesbar) ---------- */

export const cleanIban = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

export function validIban(s) {
  const iban = cleanIban(s);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const moved = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => c.charCodeAt(0) - 55);
  let rest = 0;
  for (const ch of moved) rest = (rest * 10 + +ch) % 97;
  return rest === 1;
}

export function epcPayload({ name, iban, amount, text }) {
  return ['BCD', '002', '1', 'SCT', '', name.slice(0, 70), cleanIban(iban), `EUR${(amount / 100).toFixed(2)}`, '', '', String(text || '').slice(0, 140)].join('\n');
}
