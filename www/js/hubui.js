// „Gemeinsam“: Übersicht mit Kacheln statt aller Bereiche untereinander.
const $ = (sel, root = document) => root.querySelector(sel);
let ctx;
let keep = false;

export function initGemeinsam(c) {
  ctx = c;
  for (const b of document.querySelectorAll('[data-hub-open]')) b.addEventListener('click', () => openHub(b.dataset.hubOpen));
  $('#hub-back').addEventListener('click', () => ctx.show('family'));
}

// Bei jedem Aufruf der Ansicht: Übersicht, außer ein Bereich wurde gezielt geöffnet
export function onShowFamily() {
  if (keep) {
    keep = false;
    return;
  }
  section(null);
}

export function openHub(key) {
  keep = true;
  ctx.show('family');
  section(key);
}

function section(key) {
  $('#hub-tiles').hidden = !!key;
  $('#hub-back').hidden = !key;
  for (const el of document.querySelectorAll('#view-family [data-hub]')) el.hidden = el.dataset.hub !== key;
  const tile = key && $(`[data-hub-open="${key}"]`);
  $('#hub-title').textContent = tile ? $('strong', tile).textContent : 'Gemeinsam';
  $('#hub-hint').hidden = !!key;
  ctx.onSection?.(key);
}
