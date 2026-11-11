// Geschenkideen im Bereich „Gemeinsam“.
import { monthDay, nextBirthday, daysUntil, giftReminder } from './geschenke.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'terminus.geschenke';
let ctx;

export const getGifts = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
export const setGifts = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    ctx.toast('Speicher voll.');
  }
};
const id = () => `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function initGeschenke(c) {
  ctx = c;
  $('#gs-add').addEventListener('click', addPerson);
  $('#gs-import').addEventListener('click', importBirthdays);
}

export function renderGifts() {
  const list = getGifts().map((p) => ({ ...p, next: nextBirthday(p.md) })).sort((a, b) => (a.next || '9').localeCompare(b.next || '9'));
  $('#gs-empty').hidden = !!list.length;
  $('#gs-list').replaceChildren(...list.map((p) => {
    const li = document.createElement('li');
    li.className = 'gs-person';
    const d = p.next ? daysUntil(p.next) : null;
    li.innerHTML = '<div class="gs-head"><strong></strong><small></small></div><ul class="checklist"></ul><form class="quick"><input placeholder="Idee: Buch, Konzertkarte …" maxlength="80"><button class="btn small">Dazu</button></form><div class="row"></div>';
    $('strong', li).textContent = p.name;
    $('small', li).textContent = d == null ? '' : d === 0 ? '🎉 heute Geburtstag' : `Geburtstag in ${d} ${d === 1 ? 'Tag' : 'Tagen'} (${+p.md.slice(3, 5)}.${+p.md.slice(0, 2)}.)`;
    $('ul', li).replaceChildren(...(p.ideas || []).map((idea) => {
      const r = document.createElement('li');
      r.innerHTML = '<label><input type="checkbox"><span></span></label>';
      $('input', r).checked = idea.done;
      $('span', r).textContent = idea.text;
      $('input', r).addEventListener('change', (e) => update(p.id, (x) => ({ ...x, ideas: x.ideas.map((i) => (i.id === idea.id ? { ...i, done: e.target.checked } : i)) })));
      return r;
    }));
    $('form', li).addEventListener('submit', (e) => {
      e.preventDefault();
      const text = $('form input', li).value.trim();
      if (text) update(p.id, (x) => ({ ...x, ideas: [...(x.ideas || []), { id: id(), text, done: false }] }));
    });
    const remind = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Erinnerung eine Woche vorher' });
    remind.addEventListener('click', () => {
      const ev = giftReminder(p);
      if (ev) ctx.reviewEvents([ev], `Geschenk für ${p.name}`);
    });
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small danger', textContent: 'Entfernen' });
    del.addEventListener('click', () => {
      const before = getGifts();
      setGifts(before.filter((x) => x.id !== p.id));
      renderGifts();
      ctx.toast(`${p.name} entfernt.`, { undo: () => (setGifts(before), renderGifts()) });
    });
    $('.row', li).append(remind, del);
    return li;
  }));
}

function update(pid, fn) {
  setGifts(getGifts().map((p) => (p.id === pid ? fn(p) : p)));
  renderGifts();
}

function addPerson() {
  const name = $('#gs-name').value.trim().slice(0, 40);
  const md = monthDay($('#gs-date').value);
  if (!name || !md) return ctx.toast('Name und Geburtstag eintragen.');
  setGifts([...getGifts(), { id: id(), name, md, ideas: [] }]);
  $('#gs-name').value = '';
  $('#gs-date').value = '';
  renderGifts();
}

// Geburtstage aus dem Adressbuch (App) bzw. den gespeicherten Personen übernehmen
async function importBirthdays() {
  let list = [];
  if (ctx.isNative) list = (await ctx.Native.listBirthdays().catch(() => ({})))?.birthdays || [];
  else list = ctx.store.getPeople().filter((p) => p.bday).map((p) => ({ name: p.name, date: p.bday }));
  const have = new Set(getGifts().map((p) => p.name.toLowerCase()));
  const add = list.map((b) => ({ name: b.name, md: monthDay(b.date) })).filter((b) => b.md && !have.has(b.name.toLowerCase()));
  setGifts([...getGifts(), ...add.map((b) => ({ id: id(), ...b, ideas: [] }))]);
  ctx.toast(add.length ? `${add.length} Geburtstage übernommen.` : 'Keine neuen Geburtstage gefunden.');
  renderGifts();
}
