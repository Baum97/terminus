import { parseText } from './parse.js';
import { PROVIDERS, LANGUAGES, extractWithLLM, LLMError } from './llm.js';
import { recognize } from './ocr.js';
import { buildICS, googleLink, icsFileName, description, alarms, rrule, summary } from './ics.js';
import { STATES, loadSchoolHolidays, holidayNotes, holidayStartFinder, holidayExdates } from './holidays.js';
import { eventLink, decodeEvent, messageText, whatsappLink, mailLink, normalizePhone, inviteMail, mailtoMany } from './share.js';
import { normalizeEvent, normalizeGuests, newId, isEmail } from './events.js';
import { parseVCards, contactsToPeople, mergePeople, matches, initials } from './contacts.js';
import { fromISO, isoWeek, fmtWhen, fmtDate, fmtRepeat, WD_SHORT, MONTHS_SHORT, toISO, pad, addDays } from './dates.js';
import * as store from './store.js';
import { CONFIG } from './config.js';
import { isNative, Native } from './native.js';
import { initHub, onShow, invalidateBirthdays } from './hub.js';
import { quickParse } from './quick.js';
import { initAbo, openShareCalendar, getAbos, setAbos, republishSoon, republishStale, handleAboCode } from './abo.js';
import { initSetup, renderSetup, setupNeeded, setupSummary, openInvite as openFamilyInvite, handleJoinCode, handleJoinLink } from './setup.js';
import { berlinUtcStamp } from './icsimport.js';
import { buildBackup, parseBackup, backupFileName } from './backup.js';

const $ = (sel, root = document) => root.querySelector(sel);

const DEMO_TEXT = `Kita Sonnenschein · Lindenstraße 4
Einladung zum Laternenfest

Liebe Eltern,
am Freitag, den 13.11. feiern wir unser Laternenfest.
Beginn: 17:00 Uhr, Ende ca. 18:30 Uhr
Treffpunkt: Garten der Kita, Lindenstraße 4
Bitte mitbringen:
- Laterne
- Teelicht
Wir sammeln 3 € für Punsch.

Elternabend der Igelgruppe: Mi, 25.11., 19:30 Uhr
Schließtage: 22.12.–2.1.`;

const state = {
  settings: store.getSettings(),
  serverAvailable: false,
  drafts: [],
  input: null, // { canvas, dataUrl, text, label }
  abort: null,
};

/* ---------- Ansichten ---------- */

const TAB_OF = { abo: 'calendar', home: 'home', busy: 'home', review: 'home', calendar: 'calendar', tasks: 'tasks', family: 'family', migrate: 'family', setup: 'family', join: 'family' };

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  document.documentElement.classList.toggle('tabbar-off', view === 'busy' || view === 'received');
  for (const form of document.querySelectorAll('[data-quick]')) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleQuick($('input', form));
    });
  }
  $('#s-brief-test').addEventListener('click', () => Native.showMorningBrief().then((r) => !r.shown && toast('Benachrichtigungen sind nicht erlaubt.'), () => {}));
  $('#s-lock').addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    const { available } = await Native.lockAvailable().catch(() => ({ available: false }));
    if (!available) {
      e.target.checked = false;
      toast('Richte zuerst in den Android-Einstellungen eine Displaysperre ein.');
    }
  });
  $('#backup-save').addEventListener('click', saveBackup);
  $('#backup-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) readBackup(await file.text());
  });
  $('#backup-apply').addEventListener('click', applyBackup);
  $('#backup-cancel').addEventListener('click', () => ($('#backup-confirm').hidden = true));
  $('#lock-open').addEventListener('click', unlock);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) lockState.hiddenAt = Date.now();
    else if (state.settings.lock && isNative && Date.now() - lockState.hiddenAt > 60000) lock();
  });
  for (const b of document.querySelectorAll('#tabbar [data-tab]')) {
    if (b.dataset.tab === TAB_OF[view]) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  window.scrollTo({ top: 0 });
  onShow(view);
  if (view === 'setup') renderSetup();
  if (view === 'home') renderSetupBanner();
}

async function renderSetupBanner() {
  const b = $('#home-setup');
  if (!isNative) return;
  const p = await setupSummary().catch(() => null);
  b.hidden = !p || !p.next;
  if (p?.next) b.textContent = `Einrichtung: ${p.done} von ${p.total} erledigt · weiter ›`;
}

// Leerer Termin zum Ausfüllen, z. B. über "+" im Kalender
function startManual(date) {
  state.input = { canvas: null, dataUrl: null, text: '', label: 'Neuer Termin' };
  state.drafts = [{ ...normalizeEvent({ title: 'Neuer Termin', date, start: '10:00' }), picked: true }];
  renderReview('');
  const li = $('#cards > li');
  $('.edit', li).open = true;
  $('[data-f="title"]', li).select();
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function usesLLM() {
  return state.settings.provider && state.settings.provider !== 'local';
}

function renderMode() {
  const p = PROVIDERS[state.settings.provider] || PROVIDERS.local;
  $('#mode-line').textContent = usesLLM()
    ? `Erkennung mit KI: ${p.label}`
    : 'Erkennung ohne KI, direkt auf diesem Gerät';
  $('#mode-dot').classList.toggle('off', !usesLLM());
}

/* ---------- Eingabe: Bild und Text ---------- */

async function fileToCanvas(file, max = 2000) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await img.decode();
    src = img;
  }
  const scale = Math.min(1, max / Math.max(src.width, src.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(src.width * scale);
  canvas.height = Math.round(src.height * scale);
  canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('Bitte ein Bild auswählen.');
    return;
  }
  let canvas;
  try {
    canvas = await fileToCanvas(file);
  } catch {
    toast('Dieses Bildformat kann der Browser nicht öffnen. Mach am besten einen Screenshot davon.');
    return;
  }
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  state.input = { canvas, dataUrl, text: '', label: 'Erkannt aus deinem Foto' };
  run();
}

function handleText(text) {
  text = text.trim();
  if (!text) {
    toast('Füge zuerst einen Text ein.');
    return;
  }
  state.input = { canvas: null, dataUrl: null, text, label: 'Erkannt aus deinem Text' };
  run();
}

/* ---------- Erkennung ---------- */

async function run(forceLocal = false) {
  const { canvas, dataUrl, text } = state.input;
  const busyImg = $('#busy-img');
  if (dataUrl) busyImg.src = dataUrl;
  else busyImg.removeAttribute('src');
  $('.sheet').hidden = !dataUrl;
  $('#busy-error').hidden = true;
  $('#busy-progress').hidden = false;
  $('#busy-progress').removeAttribute('value');
  $('#btn-cancel').hidden = false;
  show('busy');

  state.abort?.abort();
  const abort = (state.abort = new AbortController());
  const local = forceLocal || !usesLLM();
  let rawText = text;

  try {
    // 1. Text auf dem Gerät lesen. Das Foto selbst bleibt auf dem Handy.
    if (canvas) {
      $('#busy-status').textContent = 'Lese den Text auf dem Foto …';
      rawText = await recognize(canvas, (m) => {
        if (m.status === 'recognizing text') $('#busy-progress').value = m.progress;
        else if (m.status?.startsWith('loading')) $('#busy-status').textContent = 'Lade die Texterkennung (einmalig) …';
      });
      if (abort.signal.aborted) return;
    }
    let events;
    if (local) {
      events = parseText(rawText, new Date(), { holidayStart: holidayStartFinder(state.settings.state) });
    } else {
      // 2. Nur den Text an die KI. Das Foto nur, wenn kaum Text erkannt wurde (Handschrift).
      $('#busy-progress').removeAttribute('value');
      $('#busy-status').textContent = 'Die KI sortiert die Termine …';
      const readable = (rawText.match(/\p{L}/gu) || []).length >= 25;
      const photoOk = canvas && state.settings.photoFallback !== false;
      if (readable || !photoOk) {
        events = await extractWithLLM({ settings: state.settings, text: rawText, signal: abort.signal });
      }
      if ((!events || !events.length) && photoOk) {
        $('#busy-status').textContent = 'Die KI schaut sich das Foto an …';
        events = await extractWithLLM({ settings: state.settings, imageDataUrl: dataUrl, signal: abort.signal });
      }
    }
    if (abort.signal.aborted) return;
    state.drafts = events.map((e) => applySkip({ ...e, picked: true, skipHolidays: !!(e.repeat && state.settings.state) }));
    renderReview(canvas || local ? rawText : '');
  } catch (e) {
    if (e.name === 'AbortError' || abort.signal.aborted) return;
    console.error(e);
    $('#busy-status').textContent = 'Das hat nicht geklappt.';
    $('#busy-progress').hidden = true;
    $('#btn-cancel').hidden = true;
    $('#busy-error-text').textContent = e instanceof LLMError ? e.message : `Fehler: ${e.message}`;
    $('#btn-local').hidden = local;
    $('#busy-error').hidden = false;
  }
}

/* ---------- Ergebnis prüfen ---------- */

function fillCard(li, ev) {
  const d = fromISO(ev.date);
  $('.leaf-wd', li).textContent = WD_SHORT[d.getDay()];
  $('.leaf-day', li).textContent = d.getDate();
  $('.leaf-mon', li).textContent = MONTHS_SHORT[d.getMonth()];
  $('.kw', li).textContent = `KW ${isoWeek(ev.date)}`;
  $('.title', li).textContent = ev.title;
  li.classList.toggle('is-frist', ev.kind === 'frist');
  $('.pill.frist', li).hidden = ev.kind !== 'frist';
  $('.when', li).textContent = ev.kind === 'frist' ? `bis ${fmtDate(ev.date)}` : fmtWhen(ev);
  const rep = $('.repeat', li);
  rep.hidden = !ev.repeat;
  rep.textContent = ev.repeat
    ? `Wiederholt sich ${fmtRepeat(ev)}${ev.exdates?.length ? `, in Ferien und an Feiertagen nicht (${ev.exdates.length} ${ev.exdates.length === 1 ? 'Termin fällt' : 'Termine fallen'} aus)` : ''}`
    : '';
  const skipRow = $('.skip-row', li);
  if (skipRow) skipRow.hidden = !ev.repeat || !state.settings.state;
  const loc = $('.loc', li);
  loc.hidden = !ev.location;
  loc.textContent = ev.location ? `Ort: ${ev.location} ›` : '';
  loc.ariaLabel = ev.location ? `Weg zu ${ev.location} in der Karten-App zeigen` : '';
  const notes = [...holidayNotes(ev, state.settings.state), ...(ev._notes || [])];
  const ul = $('.notes', li);
  ul.hidden = !notes.length;
  ul.replaceChildren(...notes.map((n) => Object.assign(document.createElement('li'), { textContent: n.text, className: n.type === 'info' ? 'info' : '' })));
  const bring = $('.bring', li);
  const parts = [];
  if (ev.bring.length) parts.push(`Mitbringen: ${ev.bring.join(', ')}`);
  if (ev.cost) parts.push(`Kosten: ${ev.cost}`);
  if (ev.forWhom?.length) parts.push(`Für: ${ev.forWhom.join(', ')}`);
  if (ev.responsible) parts.push(`Zuständig: ${ev.responsible}`);
  bring.hidden = !parts.length;
  bring.textContent = parts.join(' · ');
  $('.pill.warn', li).hidden = !ev.unsure;
  $('[data-act="google"]', li).href = googleLink(ev, state.settings.defaultMinutes);
  const guests = $('.guests', li);
  if (guests) {
    guests.hidden = !ev.guests.length;
    $('.guest-chips', guests).replaceChildren(...ev.guests.map((g) => chip(g, () => {
      ev.guests = ev.guests.filter((x) => x.email !== g.email);
      fillCard(li, ev);
    })));
  }
}

// Ausfälle einer Serie in Ferien und an Feiertagen neu berechnen
function applySkip(ev) {
  ev.exdates = ev.skipHolidays && ev.repeat ? holidayExdates(ev, state.settings.state) : [];
  return ev;
}

function handleQuick(input) {
  const text = input.value.trim();
  if (!text) return toast('Schreib z. B. „Mi 16 Uhr Zahnarzt“.');
  const ev = quickParse(text, new Date(), { family: store.getFamily().map((m) => m.name) });
  if (!ev) {
    if (usesLLM()) return handleText(text);
    return toast('Kein Datum erkannt. Beispiel: „morgen 15 Uhr Kinderarzt“.');
  }
  input.value = '';
  state.input = { canvas: null, dataUrl: null, text, label: 'Schnelleingabe' };
  state.drafts = [applySkip({ ...ev, picked: true, skipHolidays: !!(ev.repeat && state.settings.state) })];
  renderReview('');
}

function editValue(ev, f) {
  if (f === 'bring') return ev.bring.join(', ');
  if (f === 'repeatFreq') return !ev.repeat ? '' : ev.repeat.freq === 'weekly' && ev.repeat.interval === 2 ? 'biweekly' : ev.repeat.freq;
  if (f === 'until') return ev.repeat?.until || '';
  return ev[f] || '';
}

const normalizeRepeatInput = (v) => (v === 'biweekly' ? { freq: 'weekly', interval: 2 } : { freq: v, interval: 1 });

function openMap(query) {
  if (!query) return;
  if (isNative) {
    Native.openMap({ query }).catch((e) => toast(e.message || 'Keine Karten-App gefunden.'));
    return;
  }
  const a = Object.assign(document.createElement('a'), { href: `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`, target: '_blank', rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
}

/* ---------- Abgleich: doppelt und Überschneidungen ---------- */

const simpleTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function sameTitle(a, b) {
  const x = simpleTitle(a), y = simpleTitle(b);
  return x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));
}
const localMs = (iso, time = '00:00') => {
  const [y, m, d] = iso.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
};
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

async function checkConflicts() {
  const drafts = state.drafts;
  if (!drafts.length) return;
  const saved = store.getSaved();
  for (const ev of drafts) {
    ev._notes = [];
    if (saved.some((x) => x.id !== ev.id && x.date === ev.date && sameTitle(x.title, ev.title))) ev._notes.push({ type: 'info', text: 'Schon gemerkt' });
  }
  if (isNative) {
    const from = localMs(drafts.reduce((m, e) => (e.date < m ? e.date : m), drafts[0].date));
    const to = localMs(addDays(drafts.reduce((m, e) => ((e.endDate || e.date) > m ? e.endDate || e.date : m), drafts[0].date), 1));
    try {
      const { granted, events } = await Native.findEvents({ from, to });
      $('#btn-check-calendar').hidden = granted;
      for (const ev of granted ? drafts : []) {
        const start = ev.start ? localMs(ev.date, ev.start) : null;
        const end = ev.start ? (ev.end ? localMs(ev.date, ev.end) : start + (+state.settings.defaultMinutes || 60) * 60000) : null;
        for (const cal of events) {
          const calDay = cal.allDay ? new Date(cal.begin).toISOString().slice(0, 10) : toISO(new Date(cal.begin));
          if (calDay === ev.date && sameTitle(cal.title || '', ev.title)) {
            ev._notes.push({ type: 'info', text: 'Steht schon in deinem Kalender' });
            break;
          }
          if (start && !cal.allDay && cal.begin < end && cal.end > start) {
            ev._notes.push({ type: 'warn', text: `Überschneidung: ${cal.title || 'Termin'} ${hhmm(cal.begin)}–${hhmm(cal.end)}` });
          }
        }
      }
    } catch {
      // Abgleich ist eine Hilfe, kein Muss.
    }
  }
  for (const li of document.querySelectorAll('#cards > li')) {
    const ev = drafts.find((d) => d.id === li.dataset.id);
    if (ev) fillCard(li, ev);
  }
}

/* ---------- QR-Code ---------- */

function drawQR(ev) {
  const canvas = $('#qr-canvas');
  const ctx = canvas.getContext('2d');
  const qr = window.qrcode(0, 'L');
  qr.addData(eventLink(ev, isNative ? CONFIG.publicUrl : undefined));
  qr.make();
  const n = qr.getModuleCount();
  const size = 520, cell = Math.floor(size / n), offset = (canvas.width - cell * n) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#15203a';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, 30 + r * cell, cell, cell);
  const y = 30 + cell * n + 50;
  ctx.textAlign = 'center';
  ctx.font = '700 32px system-ui, sans-serif';
  let title = ev.title;
  while (ctx.measureText(title).width > canvas.width - 60 && title.length > 4) title = title.slice(0, -2);
  ctx.fillText(title === ev.title ? title : `${title}…`, canvas.width / 2, y);
  ctx.font = '400 24px system-ui, sans-serif';
  ctx.fillText(ev.kind === 'frist' ? `bis ${fmtDate(ev.date)}` : fmtWhen(ev), canvas.width / 2, y + 38);
  ctx.fillStyle = '#4b5774';
  ctx.font = '400 20px system-ui, sans-serif';
  ctx.fillText('Mit der Handykamera scannen: Termin in den Kalender', canvas.width / 2, y + 74);
  $('#qr-download').href = canvas.toDataURL('image/png');
}

async function shareQR() {
  const canvas = $('#qr-canvas');
  const dataUrl = canvas.toDataURL('image/png');
  if (isNative) {
    Native.shareFile({ base64: dataUrl.split(',')[1], mimeType: 'image/png', fileName: 'termin-qr.png', text: shareEvent.title, title: 'QR-Code teilen' })
      .catch((e) => toast(e.message || 'Teilen hat nicht geklappt.'));
    return;
  }
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], 'termin-qr.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], text: shareEvent.title }).catch(() => {});
  } else {
    toast('Teilen geht in diesem Browser nicht. Nutze „Bild speichern“.');
  }
}

/* ---------- Kamera und Galerie in der App ---------- */

async function nativeCapture(kind) {
  try {
    const r = kind === 'camera' ? await Native.takePhoto() : await Native.pickImage();
    if (!r.image) return;
    state.input = { canvas: await dataUrlToCanvas(r.image), dataUrl: r.image, text: '', label: kind === 'camera' ? 'Erkannt aus deinem Foto' : 'Erkannt aus deinem Bild' };
    run();
  } catch (e) {
    toast(e.message || 'Das Bild konnte nicht geöffnet werden.');
  }
}

function chip(person, onRemove) {
  const li = document.createElement('li');
  li.className = 'chip';
  li.title = person.email;
  li.innerHTML = '<span class="avatar" aria-hidden="true"></span><span class="who"></span>';
  $('.avatar', li).textContent = initials(person.name || person.email);
  $('.who', li).textContent = person.name || person.email;
  if (onRemove) {
    const x = Object.assign(document.createElement('button'), { type: 'button', textContent: '✕', ariaLabel: `${person.name || person.email} entfernen` });
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    li.append(x);
  }
  return li;
}

function cardFor(ev, { editable = true, onRemove } = {}) {
  const li = $('#tpl-card').content.firstElementChild.cloneNode(true);
  li.dataset.id = ev.id;
  fillCard(li, ev);
  if (!editable) {
    $('.edit', li).remove();
    $('.pick', li).remove();
    $('.card-actions', li).remove();
    $('.guests', li).remove();
    return li;
  }
  const pick = $('.pick input', li);
  pick.checked = ev.picked !== false;
  li.classList.toggle('off', !pick.checked);
  pick.addEventListener('change', () => {
    ev.picked = pick.checked;
    li.classList.toggle('off', !pick.checked);
    updateActionbar();
  });
  const family = store.getFamily();
  const resp = $('[data-f="responsible"]', li);
  resp.append(...family.map((m) => new Option(m.name, m.name)));
  const forChips = $('.for-chips', li);
  const renderFor = () => forChips.replaceChildren(...family.map((m) => {
    const item = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: m.name });
    b.setAttribute('aria-pressed', String((ev.forWhom || []).includes(m.name)));
    b.addEventListener('click', () => {
      const on = (ev.forWhom || []).includes(m.name);
      ev.forWhom = on ? ev.forWhom.filter((n) => n !== m.name) : [...(ev.forWhom || []), m.name];
      renderFor();
      fillCard(li, ev);
    });
    item.append(b);
    return item;
  }));
  renderFor();
  for (const input of li.querySelectorAll('[data-f]')) {
    const f = input.dataset.f;
    if (input.type === 'checkbox') input.checked = !!ev[f];
    else input.value = editValue(ev, f);
    input.addEventListener('change', () => {
      const raw = { ...ev, unsure: false };
      if (f === 'repeatFreq') raw.repeat = input.value ? { ...normalizeRepeatInput(input.value), until: ev.repeat?.until || null } : null;
      else if (f === 'until') {
        if (!ev.repeat) {
          toast('Wähle zuerst, wie oft sich der Termin wiederholt.');
          input.value = '';
          return;
        }
        raw.repeat = { ...ev.repeat, until: input.value || null };
      } else raw[f] = input.type === 'checkbox' ? input.checked : input.value;
      const next = normalizeEvent(raw);
      if (!next) {
        toast('Bitte ein gültiges Datum eintragen.');
        input.value = ev[f] || '';
        return;
      }
      Object.assign(ev, next);
      applySkip(ev);
      fillCard(li, ev);
      for (const other of li.querySelectorAll('[data-f]')) {
        if (other === input) continue;
        if (other.type === 'checkbox') other.checked = !!ev[other.dataset.f];
        else other.value = editValue(ev, other.dataset.f);
      }
    });
  }
  li.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'share') openShare(ev);
    if (act === 'invite') openInvite(ev, li);
    if (act === 'map') openMap(ev.location);
    if (act === 'send-invite') sendInvite(ev);
    if (act === 'ics') addToCalendar([ev]);
    if (act === 'remove') onRemove?.(ev, li);
  });
  return li;
}

function renderReview(rawText) {
  const list = $('#cards');
  list.replaceChildren(...state.drafts.map((ev) => cardFor(ev, { onRemove: removeDraft })));
  $('#review-source').textContent = state.input?.label || 'Erkannt';
  $('#raw-box').hidden = !rawText;
  $('#raw-text').textContent = rawText || '';
  updateActionbar();
  show('review');
  checkConflicts();
}

function removeDraft(ev, li) {
  state.drafts = state.drafts.filter((d) => d !== ev);
  li.remove();
  updateActionbar();
}

function updateActionbar() {
  const n = state.drafts.length;
  const picked = state.drafts.filter((d) => d.picked !== false).length;
  $('#review-title').textContent = n === 0 ? 'Kein Termin gefunden' : n === 1 ? '1 Termin gefunden' : `${n} Termine gefunden`;
  $('#review-hint').textContent = n === 0
    ? 'Auf dem Bild wurde kein Datum erkannt. Lege den Termin von Hand an oder versuche ein schärferes Foto.'
    : 'Prüfe die Angaben kurz. Unter „Bearbeiten“ kannst du alles ändern.';
  $('#btn-ics-all').textContent = picked > 1 ? `${picked} Termine in den Kalender` : 'In den Kalender';
  $('#btn-ics-all').disabled = picked === 0;
  $('#btn-save').disabled = picked === 0;
  $('.actionbar').hidden = n === 0;
}

/* ---------- Kalender ---------- */

function icsFor(events) {
  const alarm = state.settings.alarmMinutes;
  return buildICS(events, { defaultMinutes: +state.settings.defaultMinutes || 60, alarmMinutes: alarm === '' || alarm == null ? null : +alarm, eveReminder: state.settings.eveReminder !== false });
}

// Termine für die Android-Brücke: Beschreibung fertig zusammengesetzt, fehlende Werte als null.
function nativeEvent(ev) {
  const alarm = state.settings.alarmMinutes;
  return {
    title: ev.title, summary: summary(ev), date: ev.date, endDate: ev.endDate, start: ev.start, end: ev.end,
    location: ev.location, description: description(ev),
    defaultMinutes: +state.settings.defaultMinutes || 60,
    rrule: rrule(ev),
    exdate: (ev.exdates || []).map((d) => (ev.start ? berlinUtcStamp(d, ev.start) : `${d.replace(/-/g, '')}T000000Z`)).join(','),
    reminders: alarms(ev, { alarmMinutes: alarm === '' || alarm == null ? null : +alarm, eveReminder: state.settings.eveReminder !== false }).map((a) => a.minutes),
  };
}

// Im Browser: Kalenderdatei. In der App: einzelner Termin öffnet die Kalender-App,
// mehrere werden nach einmaliger Erlaubnis direkt eingetragen.
// In der App werden Termine direkt eingetragen (in den Familien- bzw. gewählten Kalender).
// Ohne Kalender-Erlaubnis öffnet sich bei einem einzelnen Termin die Kalender-App ausgefüllt.
async function addToCalendar(events) {
  if (!isNative) return downloadICS(events);
  try {
    const { count, calendarId } = await Native.insertEvents({ events: events.map(nativeEvent), calendarId: state.settings.calendarId || undefined });
    republishSoon(calendarId);
    toast(count === 1 ? `Eingetragen${state.settings.calendarName ? ` in „${state.settings.calendarName}“` : ''}.` : `${count} Termine eingetragen.`);
  } catch (e) {
    if (e.code === 'denied' && events.length === 1) {
      Native.openInCalendar({ event: nativeEvent(events[0]) }).catch(() => toast(e.message));
      return;
    }
    toast(e.message || 'Eintragen hat nicht geklappt.');
  }
}

function downloadICS(events) {
  const blob = new Blob([icsFor(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: icsFileName(events) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast(events.length > 1 ? `${events.length} Termine als Kalenderdatei erstellt. Öffne sie, um sie zu übernehmen.` : 'Kalenderdatei erstellt. Öffne sie, um den Termin zu übernehmen.');
}

/* ---------- Teilen ---------- */

let shareEvent = null;

function openShare(ev) {
  shareEvent = ev;
  $('#share-text').value = messageText(ev, eventLink(ev, isNative ? CONFIG.publicUrl : undefined));
  $('#qr-box').open = false;
  renderPeople();
  updateShareLinks();
  const native = $('#share-native');
  native.hidden = !isNative && !navigator.share;
  $('#dlg-share').showModal();
}

function currentShareText() {
  return $('#share-text').value;
}

function updateShareLinks() {
  const text = currentShareText();
  $('#share-wa').href = whatsappLink(text);
  $('#share-mail').href = mailLink(text, `Termin: ${shareEvent.title}`);
  for (const li of document.querySelectorAll('#people-list li')) {
    const p = store.getPeople().find((x) => x.id === li.dataset.id);
    if (!p) continue;
    const wa = $('[data-ch="wa"]', li);
    const mail = $('[data-ch="mail"]', li);
    if (wa) wa.href = whatsappLink(text, p.phone);
    if (mail) mail.href = mailLink(text, `Termin: ${shareEvent.title}`, p.email);
  }
}

function renderPeople() {
  const people = store.getPeople();
  $('#people-empty').hidden = people.length > 0;
  $('#people-list').replaceChildren(...people.map((p) => {
    const li = document.createElement('li');
    li.dataset.id = p.id;
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: p.name });
    li.append(name);
    if (p.phone) li.append(Object.assign(document.createElement('a'), { className: 'btn small primary', textContent: 'WhatsApp', target: '_blank', rel: 'noopener', ariaLabel: `WhatsApp an ${p.name}` }));
    if (p.email) li.append(Object.assign(document.createElement('a'), { className: 'btn small', textContent: 'E-Mail', ariaLabel: `E-Mail an ${p.name}` }));
    const links = li.querySelectorAll('a');
    if (p.phone) links[0].dataset.ch = 'wa';
    if (p.email) links[links.length - 1].dataset.ch = 'mail';
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small icon', textContent: '✕', ariaLabel: `${p.name} löschen`, title: 'Person löschen' });
    del.addEventListener('click', () => {
      store.setPeople(store.getPeople().filter((x) => x.id !== p.id));
      renderPeople();
      updateShareLinks();
    });
    li.append(del);
    return li;
  }));
}

function addPerson() {
  const name = $('#p-name').value.trim();
  const phoneRaw = $('#p-phone').value.trim();
  const email = $('#p-mail').value.trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : '';
  if (!name) return toast('Gib einen Namen ein.');
  if (phoneRaw && !phone) return toast('Die Handynummer sieht nicht vollständig aus.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Die E-Mail-Adresse sieht nicht vollständig aus.');
  if (!phone && !email) return toast('Gib eine Handynummer oder eine E-Mail-Adresse an.');
  store.setPeople([...store.getPeople(), { id: newId(), name, phone, email }]);
  $('#p-name').value = $('#p-phone').value = $('#p-mail').value = '';
  $('#add-person').open = false;
  renderPeople();
  updateShareLinks();
  toast(`${name} gespeichert.`);
}

async function shareNative() {
  const text = currentShareText();
  if (isNative) {
    Native.shareText({ text, title: 'Termin teilen' }).catch(() => toast('Keine App zum Teilen gefunden.'));
    return;
  }
  const file = new File([icsFor([shareEvent])], icsFileName([shareEvent]), { type: 'text/calendar' });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ text, files: [file] });
    else await navigator.share({ text });
  } catch (e) {
    if (e.name !== 'AbortError') toast('Teilen wurde vom Gerät abgelehnt. Nutze WhatsApp oder E-Mail.');
  }
}

async function copyShareText() {
  const ta = $('#share-text');
  try {
    await navigator.clipboard.writeText(ta.value);
    toast('Text kopiert.');
  } catch {
    ta.select();
    toast('Text markiert. Jetzt kopieren.');
  }
}

/* ---------- Personen einladen ---------- */

const invite = { ev: null, card: null, device: [], deviceAsked: false };

function openInvite(ev, card) {
  invite.ev = ev;
  invite.card = card;
  $('#invite-event').textContent = `${ev.title} · ${fmtWhen(ev)}`;
  $('#invite-search').value = '';
  $('#invite-picker').hidden = !('contacts' in navigator && 'select' in navigator.contacts);
  renderInvite();
  $('#dlg-invite').showModal();
  if (isNative && !invite.deviceAsked) loadDeviceContacts(true);
}

function invitePool() {
  const byEmail = new Map();
  for (const p of [...store.getPeople(), ...invite.device]) {
    if (p.email && !byEmail.has(p.email)) byEmail.set(p.email, p);
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function renderInvite() {
  const ev = invite.ev;
  const q = $('#invite-search').value.trim();
  $('#invite-chosen').replaceChildren(...ev.guests.map((g) => chip(g, () => toggleGuest(g, false))));
  const pool = invitePool();
  const hits = pool.filter((p) => matches(p, q));
  const chosen = new Set(ev.guests.map((g) => g.email));
  $('#invite-list').replaceChildren(...hits.slice(0, 150).map((p) => {
    const li = document.createElement('li');
    li.innerHTML = '<label><input type="checkbox"><span class="avatar" aria-hidden="true"></span><span class="t"><strong></strong><small></small></span></label>';
    const box = $('input', li);
    box.checked = chosen.has(p.email);
    box.addEventListener('change', () => toggleGuest(p, box.checked));
    $('.avatar', li).textContent = initials(p.name || p.email);
    $('strong', li).textContent = p.name || p.email;
    $('small', li).textContent = p.email;
    return li;
  }));
  const typed = q.toLowerCase();
  const addBtn = $('#invite-add-address');
  addBtn.hidden = !isEmail(typed) || chosen.has(typed);
  addBtn.textContent = `+ ${typed} einladen`;
  $('#invite-empty').textContent = !pool.length
    ? 'Noch keine Kontakte hier. Gib eine E-Mail-Adresse ein oder importiere deine Kontakte.'
    : !hits.length ? 'Kein Treffer. Gib die vollständige E-Mail-Adresse ein.' : '';
  $('#invite-empty').hidden = !$('#invite-empty').textContent;
  const n = ev.guests.length;
  $('#invite-send').textContent = n ? `Einladung per E-Mail senden (${n})` : 'Einladung per E-Mail senden';
  $('#invite-send').disabled = !n;
}

function toggleGuest(person, on) {
  const ev = invite.ev;
  ev.guests = on
    ? normalizeGuests([...ev.guests, { name: person.name, email: person.email }])
    : ev.guests.filter((g) => g.email !== person.email);
  if (invite.card) fillCard(invite.card, ev);
  renderInvite();
}

function addTypedAddress() {
  const email = $('#invite-search').value.trim().toLowerCase();
  if (!isEmail(email)) return toast('Das ist noch keine vollständige E-Mail-Adresse.');
  const known = invitePool().find((p) => p.email === email);
  const person = known || { id: newId(), name: email, email, phone: '' };
  if (!known) store.setPeople(mergePeople(store.getPeople(), [person]).people);
  $('#invite-search').value = '';
  toggleGuest(person, true);
}

async function loadDeviceContacts(quiet = false) {
  invite.deviceAsked = true;
  try {
    const { contacts } = await Native.listContacts();
    invite.device = contacts.map((c) => ({ id: `d:${c.email}`, name: c.name, email: c.email, phone: '' }));
    if (!quiet) toast(`${invite.device.length} Adressen aus dem Adressbuch.`);
    renderInvite();
  } catch (e) {
    if (!quiet) toast(e.message || 'Das Adressbuch konnte nicht gelesen werden.');
  }
}

async function pickBrowserContacts() {
  try {
    const picked = await navigator.contacts.select(['name', 'email'], { multiple: true });
    const people = contactsToPeople(picked.map((c) => ({ name: c.name?.[0] || '', emails: (c.email || []).map((e) => e.toLowerCase()).filter(isEmail), phone: '' })));
    store.setPeople(mergePeople(store.getPeople(), people).people);
    invite.ev.guests = normalizeGuests([...invite.ev.guests, ...people]);
    if (invite.card) fillCard(invite.card, invite.ev);
    renderInvite();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Die Kontaktauswahl ist in diesem Browser nicht verfügbar.');
  }
}

async function importVCard(file) {
  if (!file) return;
  try {
    const contacts = parseVCards(await file.text());
    const { people, added } = mergePeople(store.getPeople(), contactsToPeople(contacts));
    if (!contacts.length) return toast('In der Datei wurden keine Kontakte gefunden.');
    store.setPeople(people);
    renderInvite();
    toast(added ? `${added} Kontakte importiert.` : 'Alle Kontakte waren schon vorhanden.');
  } catch {
    toast('Die Datei konnte nicht gelesen werden. Exportiere die Kontakte als vCard (.vcf).');
  }
}

async function sendInvite(ev) {
  if (!ev.guests.length) return toast('Wähle zuerst mindestens eine Person aus.');
  const { ownerName = '', ownerEmail = '' } = state.settings;
  const link = eventLink(ev, isNative ? CONFIG.publicUrl : undefined);
  const { subject, body } = inviteMail(ev, ev.guests, { ownerName, link, withAttachment: isNative });
  const to = ev.guests.map((g) => g.email);
  if (isNative) {
    const ics = buildICS([ev], { defaultMinutes: +state.settings.defaultMinutes || 60, organizer: ownerEmail ? { name: ownerName, email: ownerEmail } : null });
    try {
      await Native.sendEmail({ to, subject, body, ics, fileName: icsFileName([ev]) });
    } catch (e) {
      return toast(e.message || 'Das Mailprogramm konnte nicht geöffnet werden.');
    }
  } else {
    const a = Object.assign(document.createElement('a'), { href: mailtoMany(to, subject, body) });
    document.body.append(a);
    a.click();
    a.remove();
  }
  toast('Dein Mailprogramm ist geöffnet. Prüfe die Nachricht und tippe auf Senden.');
}

/* ---------- Gemerkte Termine ---------- */

function renderSaved() {
  const today = toISO(new Date());
  const saved = store.getSaved().filter((e) => (e.endDate || e.date) >= today);
  $('#saved-empty').hidden = saved.length > 0;
  $('#saved-list').replaceChildren(...saved.map((ev) => {
    const li = document.createElement('li');
    const d = fromISO(ev.date);
    li.innerHTML = `<span class="d"><b>${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</b>${WD_SHORT[d.getDay()]} · KW ${isoWeek(ev.date)}</span>
      <span class="t"><strong></strong><small></small></span>
      <span class="acts"><button class="btn ghost small" type="button" data-a="share">Teilen</button><button class="btn ghost small" type="button" data-a="del" aria-label="Entfernen">✕</button></span>`;
    $('strong', li).textContent = ev.title;
    $('small', li).textContent = [ev.start ? `${ev.start} Uhr` : ev.endDate ? 'mehrtägig' : 'ganztägig', ev.location].filter(Boolean).join(' · ');
    li.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'share') openShare(ev);
      if (a === 'del') {
        store.removeSaved(ev.id);
        renderSaved();
      }
    });
    return li;
  }));
}

/* ---------- Einstellungen ---------- */

function renderProviders() {
  const fs = $('#providers');
  fs.querySelectorAll('.provider').forEach((n) => n.remove());
  const order = state.serverAvailable ? ['server', 'mistral', 'custom', 'local'] : ['mistral', 'custom', 'local'];
  for (const key of order) {
    const p = PROVIDERS[key];
    const label = document.createElement('label');
    label.className = 'provider';
    label.innerHTML = `<input type="radio" name="provider" value="${key}"><strong></strong><small></small>`;
    $('strong', label).textContent = p.label;
    if (key === 'mistral') $('strong', label).insertAdjacentHTML('beforeend', '<span class="tag">EU</span>');
    if (key === 'local') $('strong', label).insertAdjacentHTML('beforeend', '<span class="tag">offline</span>');
    $('small', label).textContent = p.hint;
    fs.append(label);
  }
  fs.onchange = syncProviderFields;
}

function syncProviderFields(fromSaved = false) {
  const key = $('#providers input:checked')?.value || 'local';
  const p = PROVIDERS[key];
  const fields = $('#llm-fields');
  fields.hidden = key === 'local' || key === 'server';
  const same = fromSaved === true && state.settings.provider === key;
  $('#s-endpoint').value = same && state.settings.endpoint ? state.settings.endpoint : p.endpoint || '';
  $('#s-model').value = same && state.settings.model ? state.settings.model : p.model || '';
  $('#s-key').value = same ? state.settings.apiKey : '';
  $('#s-key').placeholder = p.needsKey ? 'erforderlich' : 'optional';
}

function openSettings() {
  const current = state.settings.provider || 'local';
  const radio = $(`#providers input[value="${current}"]`) || $('#providers input[value="local"]');
  radio.checked = true;
  syncProviderFields(true);
  $('#s-alarm').value = state.settings.alarmMinutes ?? '';
  $('#s-duration').value = String(state.settings.defaultMinutes || 60);
  $('#s-state').value = state.settings.state || '';
  $('#s-lang').value = state.settings.lang || 'de';
  $('#s-eve').checked = state.settings.eveReminder !== false;
  $('#s-photo').checked = state.settings.photoFallback !== false;
  $('#s-bdays').checked = state.settings.showBirthdays !== false;
  $('#s-simple').checked = !!state.settings.simple;
  $('#s-brief').checked = !!state.settings.brief;
  $('#s-brief-time').value = state.settings.briefTime || '07:00';
  $('#s-lock').checked = !!state.settings.lock;
  $('#backup-confirm').hidden = true;
  $('#s-owner-name').value = state.settings.ownerName || '';
  $('#s-abo-server').value = state.settings.aboServer || '';
  $('#s-owner-email').value = state.settings.ownerEmail || '';
  if (isNative) {
    const sel = $('#s-calendar');
    if (state.settings.calendarId && !sel.querySelector(`option[value="${CSS.escape(state.settings.calendarId)}"]`)) {
      sel.append(new Option(state.settings.calendarName || 'Gewählter Kalender', state.settings.calendarId));
    }
    sel.value = state.settings.calendarId || '';
  }
  $('#dlg-settings').showModal();
}

async function pickCalendar() {
  try {
    const { calendars } = await Native.listCalendars();
    const sel = $('#s-calendar');
    const current = sel.value;
    sel.replaceChildren(new Option('Hauptkalender des Geräts', ''), ...calendars.map((c) => new Option(`${c.name}${c.account && c.account !== c.name ? ` (${c.account})` : ''}`, c.id)));
    sel.value = calendars.some((c) => c.id === current) ? current : '';
    toast(calendars.length ? `${calendars.length} Kalender gefunden.` : 'Kein beschreibbarer Kalender gefunden.');
  } catch (e) {
    toast(e.message || 'Kalender konnten nicht geladen werden.');
  }
}

function saveSettings() {
  const provider = $('#providers input:checked')?.value || 'local';
  const p = PROVIDERS[provider];
  const s = {
    ...state.settings,
    provider,
    endpoint: $('#s-endpoint').value.trim() === p.endpoint ? '' : $('#s-endpoint').value.trim(),
    model: $('#s-model').value.trim() === p.model ? '' : $('#s-model').value.trim(),
    apiKey: $('#s-key').value.trim(),
    alarmMinutes: $('#s-alarm').value === '' ? '' : +$('#s-alarm').value,
    defaultMinutes: +$('#s-duration').value,
    state: $('#s-state').value,
    lang: $('#s-lang').value,
    eveReminder: $('#s-eve').checked,
    photoFallback: $('#s-photo').checked,
    showBirthdays: $('#s-bdays').checked,
    simple: $('#s-simple').checked,
    brief: $('#s-brief').checked,
    briefTime: $('#s-brief-time').value || '07:00',
    lock: $('#s-lock').checked,
    ownerName: $('#s-owner-name').value.trim(),
    aboServer: $('#s-abo-server').value.trim(),
    ownerEmail: $('#s-owner-email').value.trim().toLowerCase(),
  };
  if (s.ownerEmail && !isEmail(s.ownerEmail)) {
    toast('Deine E-Mail-Adresse sieht nicht vollständig aus.');
    return false;
  }
  if (isNative) {
    const sel = $('#s-calendar');
    s.calendarId = sel.value;
    s.calendarName = sel.value ? sel.selectedOptions[0]?.textContent : '';
  }
  if (p.needsKey && !s.apiKey) {
    toast('Für Mistral wird ein API-Schlüssel gebraucht.');
    return false;
  }
  const briefChanged = s.brief !== !!state.settings.brief || s.briefTime !== state.settings.briefTime;
  state.settings = s;
  store.setSettings(s);
  invalidateBirthdays();
  applySimple();
  renderMode();
  if (isNative && briefChanged) {
    const [hour, minute] = s.briefTime.split(':').map(Number);
    Native.setMorningBrief({ enabled: s.brief, hour, minute })
      .then(() => s.brief && toast(`Morgen-Überblick jeden Tag um ${s.briefTime} Uhr.`))
      .catch((e) => toast(e.message || 'Benachrichtigungen sind nicht erlaubt.'));
  }
  toast('Gespeichert.');
  return true;
}

/* ---------- Empfänger-Ansicht und geteilte Bilder ---------- */

function showReceived(ev) {
  $('#received-card').replaceChildren(cardFor(ev, { editable: false }));
  $('#btn-recv-google').href = googleLink(ev, state.settings.defaultMinutes);
  $('#btn-recv-ics').onclick = () => addToCalendar([ev]);
  document.title = `${ev.title} · Terminus`;
  show('received');
}

async function takeSharedFile() {
  // Android: Bild über "Teilen → Terminus" (Service Worker legt es im Cache ab)
  if (!('caches' in window)) return false;
  const cache = await caches.open('terminus-share');
  const img = await cache.match('shared-image');
  const txt = await cache.match('shared-text');
  await cache.delete('shared-image');
  await cache.delete('shared-text');
  history.replaceState(null, '', location.pathname);
  if (img) {
    const blob = await img.blob();
    await handleFile(new File([blob], 'geteilt', { type: blob.type || 'image/jpeg' }));
    return true;
  }
  if (txt) {
    handleText(await txt.text());
    return true;
  }
  return false;
}

async function takeNativeShare() {
  try {
    const shared = await Native.takeShared();
    if (shared.action === 'join') {
      handleJoinLink(shared.link);
      return true;
    }
    if (shared.action === 'calendar') {
      show('calendar');
      return true;
    }
    if (shared.action) {
      nativeCapture(shared.action);
      return true;
    }
    if (shared.image) {
      state.input = { canvas: await dataUrlToCanvas(shared.image), dataUrl: shared.image, text: '', label: 'Erkannt aus dem geteilten Bild' };
      run();
      return true;
    }
    if (shared.text) {
      $('#in-text').value = shared.text;
      handleText(shared.text);
      return true;
    }
  } catch (e) {
    toast(e.message || 'Das Geteilte konnte nicht gelesen werden.');
  }
  return false;
}

async function dataUrlToCanvas(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

async function detectServer() {
  const base = CONFIG.serverUrl || (isNative ? '' : './');
  PROVIDERS.server.endpoint = `${base}api/chat`;
  if (!base) {
    state.serverAvailable = false;
  } else try {
    const res = await fetch(`${base}api/health`, { cache: 'no-store' });
    state.serverAvailable = res.ok && (await res.json()).ok === true;
  } catch {
    state.serverAvailable = false;
  }
  if (!state.settings.provider) {
    state.settings.provider = state.serverAvailable ? 'server' : 'local';
  }
  if (state.settings.provider === 'server' && !state.serverAvailable) state.settings.provider = 'local';
}

/* ---------- Einfach-Modus, Sicherung, App-Sperre ---------- */

function applySimple() {
  document.documentElement.classList.toggle('simple', !!state.settings.simple);
}

let pendingBackup = null;

function saveBackup() {
  const json = buildBackup({ settings: state.settings, people: store.getPeople(), family: store.getFamily(), saved: store.getSaved(), abos: getAbos() });
  const name = backupFileName();
  if (isNative) {
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
    Native.shareFile({ base64, mimeType: 'application/json', fileName: name, title: 'Sicherung speichern' }).catch((e) => toast(e.message));
    return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  toast('Sicherung gespeichert.');
}

function readBackup(text) {
  try {
    pendingBackup = parseBackup(text);
  } catch (e) {
    toast(e.message);
    return;
  }
  const b = pendingBackup;
  const when = b.created ? ` vom ${new Date(b.created).toLocaleDateString('de-DE')}` : '';
  $('#backup-confirm-text').textContent = `Sicherung${when}: ${b.people.length} Personen, ${b.family.length} Familienmitglieder, ${b.saved.length} gemerkte Termine. Das ersetzt die Daten auf diesem Gerät.`;
  $('#backup-confirm').hidden = false;
}

function applyBackup() {
  if (!pendingBackup) return;
  const b = pendingBackup;
  store.setPeople(b.people);
  store.setFamily(b.family);
  if (b.abos) setAbos(b.abos);
  store.clearSaved();
  store.addSaved(b.saved);
  state.settings = { ...state.settings, ...b.settings, apiKey: state.settings.apiKey };
  store.setSettings(state.settings);
  pendingBackup = null;
  $('#backup-confirm').hidden = true;
  $('#dlg-settings').close();
  applySimple();
  renderMode();
  renderSaved();
  document.documentElement.classList.toggle('has-family', b.family.length > 0);
  toast('Sicherung eingelesen.');
}

const lockState = { hiddenAt: 0 };

function lock() {
  $('#lock').hidden = false;
  unlock();
}

async function unlock() {
  try {
    await Native.authenticate({ reason: 'Familientermine sind privat.' });
    $('#lock').hidden = true;
  } catch {
    // bleibt gesperrt, "Entsperren" versucht es erneut
  }
}

/* ---------- Start ---------- */

function bind() {
  for (const id of ['#in-camera', '#in-file']) {
    $(id).addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      handleFile(file);
    });
  }
  $('#btn-text').addEventListener('click', () => handleText($('#in-text').value));
  $('#btn-demo').addEventListener('click', () => {
    $('#in-text').value = DEMO_TEXT;
    $('#paste-box').open = true;
    state.input = { canvas: null, dataUrl: null, text: DEMO_TEXT, label: 'Beispiel: Elternbrief der Kita' };
    run(true);
  });
  // Screenshot direkt einfügen (Strg+V / Einfügen)
  document.addEventListener('paste', (e) => {
    if (!$('#view-home').hidden && !e.target.closest('textarea, input')) {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        handleFile(file);
      }
    }
  });
  const sheet = $('#view-home');
  sheet.addEventListener('dragover', (e) => e.preventDefault());
  sheet.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  });

  $('#btn-cancel').addEventListener('click', () => {
    state.abort?.abort();
    show('home');
  });
  $('#btn-retry').addEventListener('click', () => run());
  $('#btn-local').addEventListener('click', () => run(true));
  $('#btn-error-settings').addEventListener('click', openSettings);
  $('#btn-back').addEventListener('click', () => {
    renderSaved();
    show('home');
  });
  $('#btn-add').addEventListener('click', () => {
    const ev = { ...normalizeEvent({ title: 'Neuer Termin', date: toISO(new Date()) }), picked: true };
    state.drafts.push(ev);
    const li = cardFor(ev, { onRemove: removeDraft });
    $('#cards').append(li);
    $('.edit', li).open = true;
    $('[data-f="title"]', li).select();
    updateActionbar();
  });
  $('#btn-ics-all').addEventListener('click', () => addToCalendar(state.drafts.filter((d) => d.picked !== false)));
  $('#btn-save').addEventListener('click', () => {
    const picked = state.drafts.filter((d) => d.picked !== false);
    republishSoon('local');
    if (store.addSaved(picked)) toast(picked.length > 1 ? `${picked.length} Termine gemerkt.` : 'Termin gemerkt.');
    else toast('Speichern ist in diesem Browser nicht möglich (privater Modus?).');
    renderSaved();
  });

  $('#share-text').addEventListener('input', updateShareLinks);
  $('#share-native').addEventListener('click', shareNative);
  $('#share-copy').addEventListener('click', copyShareText);
  $('#btn-person-add').addEventListener('click', addPerson);

  if (isNative) {
    // In der App: Kamera und Galerie direkt über Android statt über das Dateifeld.
    $('label[for="in-camera"]').addEventListener('click', (e) => {
      e.preventDefault();
      nativeCapture('camera');
    });
    $('label[for="in-file"]').addEventListener('click', (e) => {
      e.preventDefault();
      nativeCapture('pick');
    });
  }
  for (const b of document.querySelectorAll('#tabbar [data-tab]')) {
    b.addEventListener('click', () => {
      if (b.dataset.tab === 'home') renderSaved();
      show(b.dataset.tab);
    });
  }
  for (const id of ['#home-migrate', '#open-migrate']) $(id).addEventListener('click', () => show('migrate'));
  for (const id of ['#home-setup', '#open-setup']) $(id).addEventListener('click', () => show('setup'));
  $('#s-open-setup').addEventListener('click', () => {
    $('#dlg-settings').close();
    show('setup');
  });
  $('#open-invite').addEventListener('click', () => openFamilyInvite());
  $('#btn-invite-top').addEventListener('click', () => openFamilyInvite());
  $('#s-open-migrate').addEventListener('click', () => {
    $('#dlg-settings').close();
    show('migrate');
  });
  $('#migrate-back').addEventListener('click', () => show('family'));
  $('#btn-check-calendar').addEventListener('click', async () => {
    try {
      await Native.listCalendars();
      await checkConflicts();
    } catch (e) {
      toast(e.message || 'Kein Zugriff auf den Kalender.');
    }
  });
  $('#qr-box').addEventListener('toggle', () => $('#qr-box').open && drawQR(shareEvent));
  $('#qr-share').addEventListener('click', shareQR);
  $('#s-state').append(...Object.entries(STATES).map(([k, v]) => new Option(v, k)));
  $('#s-lang').append(...Object.entries(LANGUAGES).map(([k, v]) => new Option(v, k)));
  $('#invite-search').addEventListener('input', renderInvite);
  $('#invite-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTypedAddress();
    }
  });
  $('#invite-add-address').addEventListener('click', addTypedAddress);
  $('#invite-send').addEventListener('click', () => sendInvite(invite.ev));
  $('#invite-device').addEventListener('click', () => loadDeviceContacts());
  $('#invite-picker').addEventListener('click', pickBrowserContacts);
  $('#invite-vcf').addEventListener('change', (e) => {
    importVCard(e.target.files?.[0]);
    e.target.value = '';
  });
  $('#dlg-invite').addEventListener('close', () => invite.card && fillCard(invite.card, invite.ev));

  $('#btn-settings').addEventListener('click', openSettings);
  $('#settings-form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'save' && !saveSettings()) e.preventDefault();
  });

  window.addEventListener('hashchange', route);
}

async function route() {
  const j = location.hash.match(/^#j=([\w-]+)/);
  if (j && handleJoinCode(j[1])) return;
  const abo = location.hash.match(/^#abo=([\w-]+)/);
  if (abo && handleAboCode(abo[1])) return;
  const m = location.hash.match(/^#t=([\w-]+)/);
  if (m) {
    const ev = decodeEvent(m[1]);
    if (ev) return showReceived(ev);
    toast('Dieser Termin-Link ist unvollständig.');
  }
  if (isNative && (await takeNativeShare())) return;
  if (setupNeeded()) return show('setup');
  if (new URLSearchParams(location.search).has('shared') && (await takeSharedFile())) return;
  renderSaved();
  show('home');
}

async function init() {
  document.documentElement.classList.toggle('native', isNative);
  applySimple();
  if (isNative && state.settings.lock) lock();
  bind();
  initHub({
    state, store, Native, isNative, toast, show, openShare, openMap, startManual, openInvite: (id) => openFamilyInvite(id),
    shareCalendar: (cal) => openShareCalendar(cal), isAbo: (id) => !!getAbos()[id], republish: (id) => republishSoon(id),
    saveSettings: (s) => {
      state.settings = s;
      store.setSettings(s);
    },
  });
  initAbo({
    state, store, Native, isNative, toast, show, config: CONFIG,
    openInvite: (id) => openFamilyInvite(id),
    publicUrl: () => (isNative ? CONFIG.publicUrl : location.origin + location.pathname),
  });
  initSetup({
    state, store, Native, isNative, toast, show, applySimple,
    publicUrl: () => (isNative ? CONFIG.publicUrl : location.origin + location.pathname),
    saveSettings: (s) => {
      state.settings = s;
      store.setSettings(s);
    },
  });
  if (isNative) {
    Native.addListener('shared', () => takeNativeShare());
    $('#btn-calendar-pick').addEventListener('click', pickCalendar);
  }
  await Promise.all([detectServer(), loadSchoolHolidays()]);
  renderProviders();
  renderMode();
  await route();
  republishStale().catch(() => {});
  if (!isNative && 'serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
