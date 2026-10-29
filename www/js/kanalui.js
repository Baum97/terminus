// Kalender per Nachricht verschicken und empfangen (ohne Server).
// Absender: ein Schlüsselpaar je Kalender; jede Nachricht enthält den kompletten, signierten Stand.
// Empfänger: Das erste Paket legt das Abo an (Absender-Kennung merken), spätere ersetzen es,
// wenn sie vom selben Absender stammen und neuer sind.
import { newChannel, buildPackage, openPackage, judge, packageLink, packageAppLink, MAX_LINK } from './kanal.js';
import { parseICS, simpleRepeat, berlinParts } from './icsimport.js';
import { normalizeEvent } from './events.js';

const $ = (sel, root = document) => root.querySelector(sel);
const OWN = 'terminus.kanaele.eigen';
const SUBS = 'terminus.kanaele';
const WEB_EVENTS = 'terminus.kanaele.termine';
const QR_MAX = 2300;
const COLORS = ['#7B3FB5', '#0B7A75', '#B5462B', '#3F6FB5', '#8A6D00', '#B53F7A'];
let ctx;

const load = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
};
const save = (key, v) => {
  try {
    localStorage.setItem(key, JSON.stringify(v || {}));
  } catch {
    // Speicher voll oder gesperrt
  }
};

// { [kalenderId]: { channel, privateJwk, publicKey, name, fields, seq, hash, sent, dirty } }
export const getOwnChannels = () => load(OWN);
export const setOwnChannels = (v) => save(OWN, v);
// { [kanal]: { publicKey, seq, name, by, fingerprint, calendarId, count, updated } }
export const getSubscriptions = () => load(SUBS);
export const setSubscriptions = (v) => save(SUBS, v);

export function initKanal(c) {
  ctx = c;
  $('#kanal-banner').addEventListener('click', () => {
    const [calId, k] = Object.entries(getOwnChannels()).find(([, x]) => x.dirty) || [];
    if (calId) ctx.openShareCalendar({ id: calId, name: k.name });
  });
  updateBanner();
  document.addEventListener('visibilitychange', () => !document.hidden && checkChanged());
  checkChanged();
}

/* ---------- Absender ---------- */

// Stand ohne Zeitstempel, damit nur echte Änderungen zählen
async function hashIcs(ics) {
  const bytes = new TextEncoder().encode(ics.replace(/^DTSTAMP:.*\r?\n/gm, ''));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function channelFor(calId) {
  return getOwnChannels()[calId] || null;
}

// Nach Änderungen durch Terminus: Hinweis "Update senden"
export function markDirty(calId) {
  const own = getOwnChannels();
  if (!own[calId] || own[calId].dirty) return;
  own[calId].dirty = true;
  setOwnChannels(own);
  updateBanner();
}

// Änderungen aus anderen Apps (z. B. über DAVx⁵) erkennen, höchstens alle zehn Minuten
let lastCheck = 0;
async function checkChanged() {
  if (Date.now() - lastCheck < 600000) return;
  lastCheck = Date.now();
  const own = getOwnChannels();
  let changed = false;
  for (const [calId, k] of Object.entries(own)) {
    if (k.dirty) continue;
    try {
      const hash = await hashIcs(await ctx.buildIcs(calId, k.name, k.fields));
      if (hash !== k.hash) {
        k.dirty = true;
        changed = true;
      }
    } catch {
      // Kalender gerade nicht lesbar
    }
  }
  if (changed) {
    setOwnChannels(own);
    updateBanner();
  }
}

function updateBanner() {
  const dirty = Object.values(getOwnChannels()).filter((k) => k.dirty);
  const b = $('#kanal-banner');
  b.hidden = !dirty.length;
  b.textContent = dirty.length === 1
    ? `„${dirty[0].name}“ wurde geändert. Update an die Abonnenten senden ›`
    : `${dirty.length} geteilte Kalender wurden geändert. Updates senden ›`;
}

// Zustand für den Teilen-Dialog: { channel, changed, sent }
export async function channelState(calId, name, fields) {
  const k = channelFor(calId);
  if (!k) return null;
  const hash = await hashIcs(await ctx.buildIcs(calId, name, fields));
  return { ...k, changed: hash !== k.hash || k.dirty };
}

// Baut das Paket, verschickt es als Nachricht und liefert den Link (für den QR-Code)
export async function sendCalendar(cal, fields) {
  const own = getOwnChannels();
  const first = !own[cal.id];
  const k = own[cal.id] || { ...(await newChannel()), seq: 0 };
  const ics = await ctx.buildIcs(cal.id, cal.name, fields);
  const seq = Math.max(Date.now(), (k.seq || 0) + 1);
  const pkg = await buildPackage({ ...k, name: cal.name, by: ctx.state.settings.ownerName || '', ics, seq });
  const link = packageLink(ctx.publicUrl(), pkg);
  if (link.length > MAX_LINK) throw new Error('Dieser Kalender ist zu groß für eine Nachricht. Schick ihn als Kalenderdatei oder nutze einen Abo-Link über einen Server.');
  own[cal.id] = { ...k, name: cal.name, fields, seq, hash: await hashIcs(ics), sent: Date.now(), dirty: false };
  setOwnChannels(own);
  updateBanner();
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  const stand = new Date(seq).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const text = first
    ? `📅 Kalender „${cal.name}“ (${count} Termine)\nAntippen, dann sind alle Termine in deinem Kalender. Updates kommen hier in die Gruppe – einfach wieder antippen.\n\n${link}`
    : `📅 Update für „${cal.name}“ (Stand ${stand})\nAntippen, dann ist dein Kalender wieder aktuell.\n\n${link}`;
  try {
    if (ctx.isNative) await ctx.Native.shareText({ text, title: first ? 'Kalender senden' : 'Update senden' });
    else if (navigator.share) await navigator.share({ text });
    else await navigator.clipboard.writeText(text);
  } catch {
    // Teilen abgebrochen: der Stand gilt trotzdem als gesendet, der Link steht im Dialog
  }
  return { link, qr: link.length <= QR_MAX, first };
}

// Kalender nicht mehr verschicken: neuer Schlüssel beim nächsten Senden (alte Abos laufen ins Leere)
export function stopSending(calId) {
  const own = getOwnChannels();
  delete own[calId];
  setOwnChannels(own);
  updateBanner();
}

/* ---------- Empfänger ---------- */

const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
};

const colorFor = (channel) => COLORS[[...channel].reduce((n, ch) => n + ch.charCodeAt(0), 0) % COLORS.length];

// Termine der Web-Version: { [kanal]: [Terminus-Termine] }
export function webSubscriptionEvents() {
  const subs = getSubscriptions();
  const all = load(WEB_EVENTS);
  return Object.entries(all).filter(([ch]) => subs[ch]).map(([ch, events]) => ({ name: subs[ch].name, color: colorFor(ch), channel: ch, events }));
}

// Kalender-IDs auf dem Handy, die abonniert (und darum schreibgeschützt) sind
export const subscribedCalendarIds = () => new Set(Object.values(getSubscriptions()).map((s) => s.calendarId).filter(Boolean));

const stampToIso = (stamp) => {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? berlinParts(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6])).date : null;
};

async function apply(pkg) {
  const { events } = parseICS(pkg.ics, { exceptions: true });
  const subs = getSubscriptions();
  let calendarId = null;
  if (ctx.isNative) {
    ({ id: calendarId } = await ctx.Native.ensureLocalCalendar({ key: pkg.channel, name: pkg.name, color: colorFor(pkg.channel) }));
    await ctx.Native.clearCalendar({ id: calendarId });
    for (let i = 0; i < events.length; i += 100) {
      const chunk = events.slice(i, i + 100).map((e) => ({ ...e, summary: e.title, reminders: [], defaultMinutes: 60 }));
      await ctx.Native.insertEvents({ events: chunk, calendarId });
    }
  } else {
    const all = load(WEB_EVENTS);
    all[pkg.channel] = events.map((e) => normalizeEvent({
      ...e, notes: e.description, repeat: simpleRepeat(e.rrule), exdates: (e.exdate || '').split(',').filter(Boolean).map(stampToIso),
    })).filter(Boolean);
    save(WEB_EVENTS, all);
  }
  subs[pkg.channel] = {
    publicKey: pkg.publicKey, seq: pkg.seq, name: pkg.name, by: pkg.by, fingerprint: pkg.fingerprint, calendarId, count: events.length, updated: Date.now(),
  };
  setSubscriptions(subs);
  return events.length;
}

export async function endSubscription(channel) {
  const subs = getSubscriptions();
  const s = subs[channel];
  if (!s) return;
  if (ctx.isNative && s.calendarId) await ctx.Native.deleteLocalCalendar({ id: s.calendarId });
  const all = load(WEB_EVENTS);
  delete all[channel];
  save(WEB_EVENTS, all);
  delete subs[channel];
  setSubscriptions(subs);
}

const when = (ms) => new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function setState(text, bad = false) {
  const el = $('#k-state');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.hidden = !text;
}

// Einstieg über #k=… (Browser) oder terminus://k?d=… (App)
export async function handleKanalCode(code) {
  ctx.show('kanal');
  $('#k-title').textContent = 'Kalender wird geprüft …';
  $('#k-sub').textContent = '';
  $('#k-fp').textContent = '';
  $('#k-actions').hidden = true;
  $('#k-file-box').hidden = true;
  setState('');
  let pkg;
  try {
    pkg = await openPackage(code);
  } catch (e) {
    $('#k-title').textContent = 'Kalender nicht übernommen';
    setState(e.message || 'Dieser Kalender-Link ist beschädigt.', true);
    return true;
  }
  const known = getSubscriptions()[pkg.channel];
  const verdict = judge(pkg, known);
  $('#k-title').textContent = `„${pkg.name}“`;
  $('#k-sub').textContent = `${pkg.by ? `Kalender von ${pkg.by}` : 'Geteilter Kalender'} · ${pkg.count} Termine · Stand ${when(pkg.seq)}`;
  $('#k-fp').textContent = known
    ? `Absender-Kennung ${pkg.fingerprint}. Updates übernimmt Terminus nur mit dieser Kennung.`
    : `Absender-Kennung ${pkg.fingerprint}. Terminus merkt sich die Kennung und übernimmt später nur Updates mit derselben Kennung.`;
  $('#k-file-box').hidden = false;
  $('#k-file').onclick = () => downloadIcs(pkg);
  const applyBtn = $('#k-apply');
  const appLink = $('#k-app');
  appLink.href = packageAppLink(code);
  appLink.hidden = ctx.isNative;

  if (verdict.action === 'reject') {
    setState(verdict.reason, true);
    $('#k-file-box').hidden = true;
    return true;
  }
  if (verdict.action === 'current') {
    setState(`${verdict.reason} Zuletzt aktualisiert: ${when(known.updated)}.`);
    $('#k-actions').hidden = ctx.isNative;
    applyBtn.hidden = true;
    return true;
  }
  const doApply = async () => {
    applyBtn.disabled = true;
    setState(verdict.action === 'update' ? 'Aktualisiere …' : 'Trage die Termine ein …');
    try {
      const n = await apply(pkg);
      setState(verdict.action === 'update'
        ? `✓ Aktualisiert: ${n} Termine. Der alte Stand wurde ersetzt.`
        : `✓ Abonniert: ${n} Termine stehen im Kalender „${pkg.name}“. Kommt ein Update, einfach wieder antippen.`);
      applyBtn.hidden = true;
      $('#k-actions').hidden = ctx.isNative;
    } catch (e) {
      setState(e.message || 'Das hat nicht geklappt.', true);
    } finally {
      applyBtn.disabled = false;
    }
  };
  applyBtn.hidden = false;
  applyBtn.textContent = verdict.action === 'update' ? 'Jetzt aktualisieren' : ctx.isNative ? 'Abonnieren' : 'Hier im Browser abonnieren';
  applyBtn.onclick = doApply;
  $('#k-actions').hidden = false;
  // Updates eines bekannten Absenders übernimmt die App sofort
  if (verdict.action === 'update' && ctx.isNative) await doApply();
  return true;
}

function downloadIcs(pkg) {
  const fileName = `${pkg.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'kalender'}.ics`;
  if (ctx.isNative) {
    const base64 = toBase64(pkg.ics);
    ctx.Native.shareFile({ base64, mimeType: 'text/calendar', fileName, text: pkg.name, title: 'Kalenderdatei öffnen' }).catch(() => {});
    return;
  }
  const url = URL.createObjectURL(new Blob([pkg.ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
