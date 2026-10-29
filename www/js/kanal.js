// Kalender verschicken ohne Server: Ein "Paket" ist ein Link, der den kompletten Stand eines
// Kalenders enthält (komprimierte .ics-Datei), signiert vom Absender. Der Transport ist eine
// Messenger-Gruppe oder jede andere Nachricht. Der neueste Stand ersetzt den alten; verpasste
// Updates sind egal, und Neue brauchen nur den letzten Link.
//
// Format:  <Kopf>.<Inhalt>.<Signatur>   (jeweils base64url)
//   Kopf    = JSON { v, c (Kanal), n (Name), by (Absender), pk (öffentlicher Schlüssel), s (Stand), e (Anzahl Termine) }
//   Inhalt  = deflate-raw(.ics)
//   Signatur = ECDSA P-256 / SHA-256 über "<Kopf>.<Inhalt>"

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
export const MAX_LINK = 60000;

const b64 = (bytes) => {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const deflate = (text) => pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
const inflate = async (bytes) => new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));

export class KanalError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ---------- Absender ---------- */

// Neuer Kanal: zufällige Kennung und Schlüsselpaar. Der private Schlüssel bleibt auf dem Gerät.
export async function newChannel() {
  const keys = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  return {
    channel: b64(crypto.getRandomValues(new Uint8Array(12))),
    privateJwk: await crypto.subtle.exportKey('jwk', keys.privateKey),
    publicKey: b64(await crypto.subtle.exportKey('raw', keys.publicKey)),
  };
}

export async function buildPackage({ channel, privateJwk, publicKey, name, by = '', ics, seq = Date.now() }) {
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const head = b64(new TextEncoder().encode(JSON.stringify({ v: 1, c: channel, n: name, by, pk: publicKey, s: seq, e: count })));
  const body = b64(await deflate(ics));
  const key = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign']);
  const sig = b64(await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${sig}`;
}

/* ---------- Empfänger ---------- */

// Prüft die Signatur und packt aus. Wirft KanalError bei kaputten oder gefälschten Paketen.
export async function openPackage(pkg) {
  const parts = String(pkg || '').split('.');
  if (parts.length !== 3) throw new KanalError('format', 'Dieser Kalender-Link ist unvollständig.');
  const [head, body, sig] = parts;
  let info;
  try {
    info = JSON.parse(new TextDecoder().decode(unb64(head)));
  } catch {
    throw new KanalError('format', 'Dieser Kalender-Link ist beschädigt.');
  }
  if (info.v !== 1 || !info.c || !info.pk || !Number.isFinite(info.s)) throw new KanalError('format', 'Dieser Kalender-Link ist beschädigt.');
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('raw', unb64(info.pk), ALG, false, ['verify']);
    ok = await crypto.subtle.verify(SIGN, key, unb64(sig), new TextEncoder().encode(`${head}.${body}`));
  } catch {
    ok = false;
  }
  if (!ok) throw new KanalError('signature', 'Die Signatur stimmt nicht. Der Link wurde verändert und wird nicht übernommen.');
  const ics = await inflate(unb64(body));
  return {
    channel: info.c, name: String(info.n || 'Kalender').slice(0, 80), by: String(info.by || '').slice(0, 60),
    publicKey: info.pk, seq: info.s, count: info.e || 0, ics, fingerprint: await fingerprint(info.pk),
  };
}

// Entscheidet, ob ein Paket zu einem bestehenden Abo passt.
// known: { publicKey, seq } oder undefined
export function judge(pkg, known) {
  if (!known) return { action: 'subscribe' };
  if (known.publicKey !== pkg.publicKey) return { action: 'reject', reason: 'Dieses Update stammt nicht vom ursprünglichen Absender und wird ignoriert.' };
  if (pkg.seq <= known.seq) return { action: 'current', reason: pkg.seq === known.seq ? 'Du hast diesen Stand schon.' : 'Du hast schon einen neueren Stand.' };
  return { action: 'update' };
}

// Kurze, vorlesbare Kennung des Absenders, z. B. "3F9A-12C4-77B0"
export async function fingerprint(publicKey) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', unb64(publicKey)));
  const hex = [...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export const packageLink = (base, pkg) => `${base}#k=${pkg}`;
export const packageAppLink = (pkg) => `terminus://k?d=${pkg}`;
