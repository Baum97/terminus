// Ablauf-Wächter im Aufgaben-Bereich: Dokumente und Verträge mit Ablaufdatum.
import { KINDS, reminderFor, endOfMonth, guessExpiry } from './ablauf.js';
import { fmtDate } from './dates.js';
import { findDates } from './parse.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'terminus.ablauf';
let ctx;

export const getExpiries = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
export const setExpiries = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    ctx.toast('Speicher voll.');
  }
};

export function initAblauf(c) {
  ctx = c;
  $('#ab-kind').replaceChildren(...Object.entries(KINDS).map(([k, v]) => new Option(v.label, k)));
  $('#ab-kind').addEventListener('change', syncForm);
  $('#ab-add').addEventListener('click', add);
  $('#ab-photo').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) scan(file);
  });
  syncForm();
  renderAblauf();
}

function syncForm() {
  const k = KINDS[$('#ab-kind').value];
  $('#ab-notice-row').hidden = k.notice == null;
  $('#ab-date').type = k.month ? 'month' : 'date';
  $('#ab-date-label').textContent = k.month ? 'Fällig im Monat (steht auf der Plakette)' : k.notice != null ? 'Endet am' : 'Gültig bis';
  if (k.notice != null && !$('#ab-notice').value) $('#ab-notice').value = k.notice;
}

// Foto vom Ausweis o. Ä.: Text auf dem Gerät lesen, spätestes Datum in der Zukunft vorschlagen. Das Foto wird nicht gespeichert.
async function scan(file) {
  const hint = $('#ab-msg');
  Object.assign(hint, { hidden: false, textContent: 'Lese das Datum …' });
  try {
    const text = await ctx.ocrFile(file);
    const dates = text.split(/\n/).flatMap((l) => findDates(l, new Date()).map((d) => d.date));
    const best = guessExpiry(dates);
    if (!best) throw new Error('Kein Datum in der Zukunft gefunden. Bitte von Hand eintragen.');
    $('#ab-date').value = $('#ab-date').type === 'month' ? best.slice(0, 7) : best;
    hint.textContent = `Erkannt: ${fmtDate(best)}. Bitte prüfen.`;
  } catch (e) {
    hint.textContent = e.message || 'Das Foto konnte nicht gelesen werden.';
  }
}

async function add() {
  const kind = $('#ab-kind').value;
  const raw = $('#ab-date').value;
  const msg = $('#ab-msg');
  if (!raw) {
    Object.assign(msg, { hidden: false, textContent: 'Bitte das Ablaufdatum eintragen.' });
    return;
  }
  const item = {
    id: `a${Date.now().toString(36)}`, kind, name: $('#ab-name').value.trim().slice(0, 60),
    expires: KINDS[kind].month ? endOfMonth(raw) : raw, notice: KINDS[kind].notice != null ? +$('#ab-notice').value || 0 : undefined,
  };
  const ev = reminderFor(item);
  if (!ev) return;
  setExpiries([...getExpiries(), { ...item, remind: ev.date }]);
  $('#ab-name').value = '';
  $('#ab-date').value = '';
  await ctx.addToCalendar([ev]);
  Object.assign(msg, { hidden: false, textContent: `✓ Erinnerung am ${fmtDate(ev.date)} eingetragen.` });
  renderAblauf();
}

export function renderAblauf() {
  const list = getExpiries().sort((a, b) => a.expires.localeCompare(b.expires));
  const ul = $('#ab-list');
  ul.hidden = !list.length;
  ul.replaceChildren(...list.map((item) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="c"></span><span class="x"><strong></strong><small></small></span>';
    $('strong', li).textContent = item.name ? `${KINDS[item.kind]?.label}: ${item.name}` : KINDS[item.kind]?.label || 'Dokument';
    $('small', li).textContent = `bis ${fmtDate(item.expires)} · Erinnerung ${fmtDate(item.remind)}`;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small', textContent: 'Erledigt' });
    b.title = 'Aus der Liste nehmen (z. B. nach Verlängerung). Den Kalendereintrag löschst du im Kalender.';
    b.addEventListener('click', () => {
      setExpiries(getExpiries().filter((x) => x.id !== item.id));
      renderAblauf();
    });
    li.append(b);
    return li;
  }));
}
