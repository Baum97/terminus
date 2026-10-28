// Kalender teilen: "Abonnieren" (nur lesen, über einen Abo-Link) und "Mitbearbeiten" (Einladung ins Konto).
// Ein Abo-Link enthält nur diesen einen Kalender und nur die freigegebenen Felder.
import { aboFromDevice, aboFromLocal, DEFAULT_FIELDS, encodeAbo, decodeAbo, subscribeLinks } from './aboexport.js';
import { inviteTarget } from './setupdata.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'terminus.abos';
let ctx;
const share = { cal: null, mode: 'abo' };

// { [kalenderId]: { id, key, url, name, fields, server, updated } }; der Schlüssel bleibt auf dem Gerät
export function getAbos() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
export function setAbos(v) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v || {}));
  } catch {
    // Speicher voll oder gesperrt: Abo bleibt beim nächsten Versuch neu anzulegen
  }
}

function serverBase() {
  const s = (ctx.state.settings.aboServer || ctx.config.serverUrl || '').trim();
  if (s) return s.endsWith('/') ? s : `${s}/`;
  return ctx.isNative ? '' : './';
}

async function serverReady() {
  const base = serverBase();
  if (!base) return false;
  try {
    const r = await fetch(`${base}api/health`, { cache: 'no-store' });
    return r.ok && (await r.json()).abo === true;
  } catch {
    return false;
  }
}

export function initAbo(c) {
  ctx = c;
  for (const b of document.querySelectorAll('#dlg-share-cal [data-share-mode]')) {
    b.addEventListener('click', () => {
      share.mode = b.dataset.shareMode;
      renderShare();
    });
  }
  for (const id of ['#sc-location', '#sc-notes', '#sc-bring']) $(id).addEventListener('change', fieldsChanged);
  $('#sc-create').addEventListener('click', () => run($('#sc-create'), createAbo));
  $('#sc-update').addEventListener('click', () => run($('#sc-update'), async () => {
    await publish(share.cal.id);
    return 'Aktualisiert. Abonnenten sehen die Änderung beim nächsten Abgleich ihres Kalenders.';
  }));
  $('#sc-revoke').addEventListener('click', revoke);
  $('#sc-send').addEventListener('click', sendAbo);
  $('#sc-copy').addEventListener('click', () => copy($('#sc-link').textContent));
  $('#sc-file').addEventListener('click', () => run($('#sc-file'), sendSnapshot));
  $('#sc-edit-invite').addEventListener('click', () => {
    $('#dlg-share-cal').close();
    ctx.openInvite(share.cal.id);
  });
  document.addEventListener('visibilitychange', () => !document.hidden && republishStale());
}

async function run(button, fn) {
  button.disabled = true;
  const msg = $('#sc-msg');
  msg.hidden = true;
  msg.classList.remove('bad');
  try {
    const text = await fn();
    if (text) Object.assign(msg, { textContent: text, hidden: false });
  } catch (e) {
    Object.assign(msg, { textContent: e.message || 'Das hat nicht geklappt.', hidden: false });
    msg.classList.add('bad');
  } finally {
    button.disabled = false;
  }
}

const copy = (text) => navigator.clipboard?.writeText(text).then(() => ctx.toast('Kopiert.'), () => ctx.toast('Kopieren geht hier nicht.'));

/* ---------- Teilen-Dialog ---------- */

// cal: { id, name, account?, url?, accountType? } bzw. { id: 'local', name: 'Gemerkte Termine' }
export function openShareCalendar(cal, mode = 'abo') {
  share.cal = cal;
  share.mode = mode;
  $('#sc-msg').hidden = true;
  $('#sc-revoke').dataset.confirm = '';
  $('#sc-revoke').textContent = 'Link widerrufen';
  renderShare();
  $('#dlg-share-cal').showModal();
}

async function renderShare() {
  const cal = share.cal;
  const abo = getAbos()[cal.id];
  $('#sc-title').textContent = `„${cal.name}“ teilen`;
  for (const b of document.querySelectorAll('#dlg-share-cal [data-share-mode]')) b.setAttribute('aria-selected', String(b.dataset.shareMode === share.mode));
  $('#sc-abo').hidden = share.mode !== 'abo';
  $('#sc-edit').hidden = share.mode !== 'edit';
  const fields = abo?.fields || DEFAULT_FIELDS;
  $('#sc-location').checked = fields.location;
  $('#sc-notes').checked = fields.notes;
  $('#sc-bring').checked = fields.bring;

  const canEdit = cal.id !== 'local' && !!inviteTarget(cal, ctx.store.getSetup());
  $('#sc-edit-invite').hidden = !canEdit;
  $('#sc-edit-hint').textContent = canEdit
    ? 'Mitbearbeiten heißt: Zugang zum Konto, in dem der Kalender liegt. Gut für die Familie oder ein kleines Orga-Team, das sich das Konto teilt.'
    : 'Dieser Kalender liegt nicht in einem Konto, das Terminus teilen kann (z. B. Google oder nur auf dem Handy). Abonnieren geht trotzdem.';

  $('#sc-published').hidden = !abo;
  $('#sc-new').hidden = !!abo;
  if (abo) {
    const link = `${ctx.publicUrl()}#abo=${encodeAbo({ url: abo.url, name: abo.name, by: ctx.state.settings.ownerName || '' })}`;
    $('#sc-link').textContent = link;
    $('#sc-direct').textContent = abo.url;
    $('#sc-updated').textContent = `Zuletzt aktualisiert: ${new Date(abo.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
    drawQR($('#sc-qr'), link);
  } else {
    const ready = await serverReady();
    $('#sc-create').hidden = !ready;
    $('#sc-noserver').hidden = ready;
  }
}

function drawQR(canvas, text) {
  const qr = window.qrcode(0, 'L');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), cell = Math.floor(canvas.width / (n + 8)), off = (canvas.width - cell * n) / 2;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#15203a';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(off + c * cell, off + r * cell, cell, cell);
}

const currentFields = () => ({ location: $('#sc-location').checked, notes: $('#sc-notes').checked, bring: $('#sc-bring').checked });

async function fieldsChanged() {
  const abos = getAbos();
  const abo = abos[share.cal.id];
  if (!abo) return;
  abos[share.cal.id] = { ...abo, fields: currentFields() };
  setAbos(abos);
  await run($('#sc-update'), async () => {
    await publish(share.cal.id);
    return 'Freigaben geändert und Abo aktualisiert.';
  });
}

/* ---------- Veröffentlichen ---------- */

async function buildIcs(calId, name, fields) {
  if (calId === 'local') return aboFromLocal(ctx.store.getSaved(), { name, fields });
  const { events } = await ctx.Native.exportCalendar({ id: calId });
  return aboFromDevice(events, { name, calendarId: calId, fields });
}

async function createAbo() {
  const cal = share.cal;
  const fields = currentFields();
  const ics = await buildIcs(cal.id, cal.name, fields);
  const base = serverBase();
  const res = await fetch(`${base}api/abo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: cal.name, ics }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Der Server hat mit Fehler ${res.status} geantwortet.`);
  const r = await res.json();
  const abos = getAbos();
  abos[cal.id] = { id: r.id, key: r.key, url: r.url, name: cal.name, fields, server: base, updated: Date.now() };
  setAbos(abos);
  await renderShare();
  return 'Abo-Link erstellt. Zeig den QR-Code oder schick die Einladung.';
}

async function publish(calId) {
  const abos = getAbos();
  const abo = abos[calId];
  if (!abo) return;
  const ics = await buildIcs(calId, abo.name, abo.fields || DEFAULT_FIELDS);
  const res = await fetch(`${abo.server}api/abo/${abo.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${abo.key}` }, body: JSON.stringify({ title: abo.name, ics }),
  });
  if (res.status === 404) throw new Error('Dieses Abo gibt es auf dem Server nicht mehr. Widerrufe den Link und erstelle einen neuen.');
  if (!res.ok) throw new Error(`Aktualisieren fehlgeschlagen (Fehler ${res.status}).`);
  abos[calId] = { ...abo, updated: Date.now() };
  setAbos(abos);
  if (share.cal?.id === calId && $('#dlg-share-cal').open) $('#sc-updated').textContent = `Zuletzt aktualisiert: ${new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
}

async function revoke() {
  const b = $('#sc-revoke');
  if (b.dataset.confirm !== '1') {
    b.dataset.confirm = '1';
    b.textContent = 'Wirklich widerrufen? Alle Abonnenten verlieren den Kalender.';
    return;
  }
  await run(b, async () => {
    const abos = getAbos();
    const abo = abos[share.cal.id];
    const res = await fetch(`${abo.server}api/abo/${abo.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${abo.key}` } });
    if (!res.ok && res.status !== 404) throw new Error(`Widerrufen fehlgeschlagen (Fehler ${res.status}).`);
    delete abos[share.cal.id];
    setAbos(abos);
    b.dataset.confirm = '';
    b.textContent = 'Link widerrufen';
    await renderShare();
    return 'Widerrufen. Der alte Link funktioniert nicht mehr.';
  });
}

function sendAbo() {
  const abo = getAbos()[share.cal.id];
  const text = `Abonniere den Kalender „${abo.name}“: Alle Termine kommen automatisch in deinen Kalender, Änderungen auch. Geht mit iPhone, Android, Outlook und Google.\n\n${$('#sc-link').textContent}`;
  if (ctx.isNative) ctx.Native.shareText({ text, title: 'Kalender teilen' }).catch(() => copy(text));
  else if (navigator.share) navigator.share({ text }).catch(() => {});
  else copy(text);
}

// Ohne Server: die Termine einmalig als Datei verschicken (aktualisiert sich nicht)
async function sendSnapshot() {
  const cal = share.cal;
  const ics = await buildIcs(cal.id, cal.name, currentFields());
  const fileName = `${cal.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'kalender'}.ics`;
  if (ctx.isNative) {
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(ics)));
    await ctx.Native.shareFile({ base64, mimeType: 'text/calendar', fileName, text: `Termine aus „${cal.name}“`, title: 'Kalenderdatei senden' });
    return '';
  }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'Kalenderdatei erstellt. Sie ist ein Schnappschuss: spätere Änderungen kommen nicht automatisch an.';
}

/* ---------- Automatisch aktualisieren ---------- */

const timers = new Map();

// Nach Änderungen durch Terminus: kurz warten, dann einmal veröffentlichen
export function republishSoon(calId) {
  if (!calId || !getAbos()[calId]) return;
  clearTimeout(timers.get(calId));
  timers.set(calId, setTimeout(() => publish(calId).catch(() => {}), 3000));
}

// Beim Öffnen der App: auch Änderungen aus anderen Apps nachziehen (höchstens stündlich)
export async function republishStale(maxAge = 3600000) {
  const abos = getAbos();
  for (const [calId, abo] of Object.entries(abos)) {
    if (Date.now() - (abo.updated || 0) > maxAge) await publish(calId).catch(() => {});
  }
}

/* ---------- Abo-Seite (Empfänger) ---------- */

export function handleAboCode(code) {
  const info = decodeAbo(code);
  if (!info) {
    ctx.toast('Dieser Abo-Link ist unvollständig.');
    return false;
  }
  ctx.show('abo');
  const l = subscribeLinks(info.url, info.name);
  $('#abo-title').textContent = `„${info.name}“ abonnieren`;
  $('#abo-by').textContent = info.by ? `Geteilt von ${info.by}. ` : '';
  $('#abo-webcal').href = l.webcal;
  $('#abo-google').href = l.google;
  $('#abo-outlook').href = l.outlook;
  $('#abo-url').textContent = info.url;
  $('#abo-terminus').hidden = !ctx.isNative;
  $('#abo-terminus').onclick = () => ctx.Native.openSubscription({ url: info.url }).catch(() => {
    $('#abo-icsx').hidden = false;
    ctx.toast('Installiere zuerst ICSx⁵, dann noch einmal tippen.');
  });
  $('#abo-copy').onclick = () => copy(info.url);
  return true;
}
