// Wallet-Ansicht: Tickets ablegen, groß und hell zeigen, Original-App öffnen.
import { putItem, deleteItem, getItem, allItems, sortItems, matchEvent } from './wallet.js';
import { fmtDate, toISO } from './dates.js';

const $ = (sel, root = document) => root.querySelector(sel);
let ctx;
let pendingFile = null;
let shownId = null;
let cache = [];

export const KINDS = { ticket: 'Fahrkarte', flug: 'Bordkarte', event: 'Eintrittskarte', karte: 'Karte / Ausweis', sonst: 'Sonstiges' };

export function initWallet(c) {
  ctx = c;
  $('#wl-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) openAdd(f);
  });
  $('#wa-kind').replaceChildren(...Object.entries(KINDS).map(([k, v]) => new Option(v, k)));
  $('#wa-save').addEventListener('click', saveAdd);
  $('#wa-app-pick').addEventListener('click', pickApp);
  $('#wt-app').addEventListener('click', () => ctx.Native.openApp({ package: $('#wt-app').dataset.pkg }).catch((e) => ctx.toast(e.message)));
  $('#wt-delete').addEventListener('click', remove);
  $('#dlg-ticket').addEventListener('close', () => {
    if (ctx.isNative) ctx.Native.setBrightness({ level: -1 }).catch(() => {});
    $('#wt-pages').replaceChildren();
  });
  $('#wa-app-row').hidden = !ctx.isNative;
}

export async function renderWallet() {
  try {
    cache = sortItems(await allItems(), toISO(new Date()));
  } catch {
    cache = [];
    $('#wl-empty').textContent = 'Der Speicher für die Wallet ist in diesem Browser nicht verfügbar (z. B. privater Modus).';
  }
  const today = toISO(new Date());
  $('#wl-empty').hidden = !!cache.length;
  $('#wl-list').replaceChildren(...cache.map((i) => {
    const li = document.createElement('li');
    li.className = i.date && i.date < today ? 'old' : '';
    li.innerHTML = '<button type="button" class="wl-item"><span class="wl-kind"></span><strong></strong><small></small></button>';
    $('.wl-kind', li).textContent = KINDS[i.kind] || 'Dokument';
    $('strong', li).textContent = i.title;
    $('small', li).textContent = [i.date ? fmtDate(i.date) : 'ohne Datum', i.appLabel ? `App: ${i.appLabel}` : ''].filter(Boolean).join(' · ');
    $('button', li).addEventListener('click', () => show(i.id));
    return li;
  }));
}

/* ---------- Hinzufügen ---------- */

// Auch von außen: nach erkanntem Ticket-PDF ("In die Wallet")
export function openAdd(file, prefill = {}) {
  pendingFile = file;
  $('#wa-title').value = prefill.title || file.name.replace(/\.(pdf|png|jpe?g|webp)$/i, '').slice(0, 80);
  $('#wa-date').value = prefill.date || '';
  $('#wa-kind').value = prefill.kind || (/\.pdf$/i.test(file.name) ? 'ticket' : 'event');
  $('#wa-note').value = '';
  $('#wa-app').textContent = 'keine';
  $('#wa-app').dataset.pkg = '';
  $('#wa-app').dataset.label = '';
  $('#wa-file-name').textContent = file.name;
  $('#dlg-wallet-add').dataset.eventKey = prefill.eventKey || '';
  $('#dlg-wallet-add').showModal();
}

async function pickApp() {
  try {
    const { apps } = await ctx.Native.listApps();
    const sel = $('#wa-app-list');
    sel.replaceChildren(new Option('keine', ''), ...apps.map((a) => new Option(a.label, a.package)));
    sel.hidden = false;
    sel.onchange = () => {
      $('#wa-app').dataset.pkg = sel.value;
      $('#wa-app').dataset.label = sel.selectedOptions[0].textContent;
      $('#wa-app').textContent = sel.value ? sel.selectedOptions[0].textContent : 'keine';
    };
  } catch (e) {
    ctx.toast(e.message || 'Apps konnten nicht gelesen werden.');
  }
}

async function saveAdd() {
  const title = $('#wa-title').value.trim();
  if (!title) return ctx.toast('Gib dem Ticket einen Namen.');
  if (pendingFile.size > 15 * 1024 * 1024) return ctx.toast('Die Datei ist zu groß (höchstens 15 MB).');
  const item = {
    id: `w${Date.now().toString(36)}`, title: title.slice(0, 80), date: $('#wa-date').value || null, kind: $('#wa-kind').value,
    app: $('#wa-app').dataset.pkg || null, appLabel: $('#wa-app').dataset.label || null, note: $('#wa-note').value.trim().slice(0, 300),
    mime: pendingFile.type || (/\.pdf$/i.test(pendingFile.name) ? 'application/pdf' : 'image/jpeg'), name: pendingFile.name, added: Date.now(),
    eventKey: $('#dlg-wallet-add').dataset.eventKey || null, blob: pendingFile,
  };
  try {
    await putItem(item);
  } catch (e) {
    return ctx.toast(e.message || 'Speichern fehlgeschlagen.');
  }
  $('#dlg-wallet-add').close();
  ctx.toast('In der Wallet abgelegt.');
  renderWallet();
}

/* ---------- Zeigen ---------- */

export async function show(id) {
  const item = await getItem(id);
  if (!item) return;
  shownId = id;
  $('#wt-title').textContent = item.title;
  $('#wt-meta').textContent = [item.date ? fmtDate(item.date) : '', KINDS[item.kind], item.note].filter(Boolean).join(' · ');
  const appBtn = $('#wt-app');
  appBtn.hidden = !(ctx.isNative && item.app);
  appBtn.dataset.pkg = item.app || '';
  appBtn.textContent = `${item.appLabel || 'Original-App'} öffnen`;
  $('#wt-hint').hidden = item.kind !== 'ticket';
  const pages = $('#wt-pages');
  pages.replaceChildren(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Lade …' }));
  $('#dlg-ticket').showModal();
  if (ctx.isNative) ctx.Native.setBrightness({ level: 1 }).catch(() => {});
  try {
    if (item.mime === 'application/pdf') {
      const { renderPdfPages } = await import('./pdf.js');
      const canvases = await renderPdfPages(await item.blob.arrayBuffer(), { maxPages: 4, width: 1400 });
      pages.replaceChildren(...canvases);
    } else {
      const img = new Image();
      img.alt = item.title;
      img.src = URL.createObjectURL(item.blob);
      img.onload = () => URL.revokeObjectURL(img.src);
      pages.replaceChildren(img);
    }
  } catch (e) {
    pages.replaceChildren(Object.assign(document.createElement('p'), { className: 'hint', textContent: `Anzeigen fehlgeschlagen: ${e.message || e}` }));
  }
}

async function remove() {
  const item = await getItem(shownId);
  await deleteItem(shownId);
  $('#dlg-ticket').close();
  renderWallet();
  ctx.toast(`„${item?.title || 'Ticket'}“ gelöscht.`, { undo: async () => {
    if (item) await putItem(item);
    renderWallet();
  } });
}

// Für den Termin-Dialog im Kalender: passendes Ticket finden
export async function ticketFor(ev) {
  try {
    if (!cache.length) cache = await allItems();
  } catch {
    return null;
  }
  return matchEvent(cache, ev);
}
