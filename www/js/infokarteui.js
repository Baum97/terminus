// Infokarte im Bereich „Gemeinsam“: anlegen, ansehen, an Babysitter oder Großeltern schicken, Vorsorge eintragen.
import { FIELDS, cleanCard, phones, checkups, encodeCards, decodeCards } from './infokarte.js';
import { fmtDate } from './dates.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'terminus.infokarten';
let ctx;
let editing = null;

export const getCards = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
export const setCards = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    ctx.toast('Speicher voll.');
  }
};

export function initInfokarte(c) {
  ctx = c;
  $('#ik-form-fields').replaceChildren(...FIELDS.map(([k, label]) => {
    const l = document.createElement('label');
    l.className = 'field';
    l.innerHTML = `<span></span>${k === 'emergency' || k === 'notes' ? '<textarea rows="3"></textarea>' : `<input${k === 'birth' ? ' type="date"' : k.endsWith('Phone') ? ' type="tel"' : ''}>`}`;
    $('span', l).textContent = label;
    l.lastElementChild.dataset.f = k;
    return l;
  }));
  $('#ik-new').addEventListener('click', () => edit(null));
  $('#ik-save').addEventListener('click', save);
  $('#ik-share-all').addEventListener('click', () => share(getCards()));
  renderCards();
}

export function renderCards() {
  const cards = getCards();
  $('#ik-share-all').hidden = !cards.length;
  $('#ik-list').replaceChildren(...cards.map((c) => cardView(c, { own: true })));
}

function cardView(c, { own }) {
  const art = document.createElement('article');
  art.className = 'ik-card';
  const h = document.createElement('h4');
  h.textContent = c.name + (c.birth ? ` · ${fmtDate(c.birth)}` : '');
  art.append(h);
  const dl = document.createElement('dl');
  for (const [k, label] of FIELDS) {
    if (k === 'birth' || !c[k]) continue;
    const dt = Object.assign(document.createElement('dt'), { textContent: label.replace(/ \(.*\)$/, '') });
    const dd = document.createElement('dd');
    if (k === 'doctorPhone' || k === 'emergency') {
      // Telefonnummern antippbar
      let rest = c[k];
      for (const p of phones(c[k])) {
        const [before, ...after] = rest.split(p.shown);
        dd.append(before, Object.assign(document.createElement('a'), { href: `tel:${p.tel}`, textContent: p.shown }));
        rest = after.join(p.shown);
      }
      dd.append(rest);
      dd.style.whiteSpace = 'pre-line';
    } else {
      dd.textContent = c[k];
      dd.style.whiteSpace = 'pre-line';
    }
    dl.append(dt, dd);
  }
  art.append(dl);
  const row = document.createElement('div');
  row.className = 'row';
  const btn = (label, fn, cls = 'btn small') => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: cls, textContent: label });
    b.addEventListener('click', fn);
    row.append(b);
    return b;
  };
  if (own) {
    btn('Bearbeiten', () => edit(c));
    btn('Schicken', () => share([c]));
    if (checkups(c).length) btn('Vorsorge-Termine eintragen', () => ctx.reviewEvents(checkups(c), `Vorsorge für ${c.name}`));
    const del = btn('Löschen', () => {
      if (del.dataset.confirm !== '1') {
        del.dataset.confirm = '1';
        del.textContent = 'Wirklich löschen?';
        return;
      }
      setCards(getCards().filter((x) => x.id !== c.id));
      renderCards();
    }, 'btn ghost small danger');
  }
  art.append(row);
  return art;
}

function edit(c) {
  editing = c;
  $('#ik-name').value = c?.name || '';
  for (const el of document.querySelectorAll('#ik-form-fields [data-f]')) el.value = c?.[el.dataset.f] || '';
  // Neue Karte: Namen aus der Familie vorschlagen
  $('#ik-names').replaceChildren(...ctx.store.getFamily().map((m) => new Option(m.name)));
  $('#dlg-info').showModal();
}

function save() {
  const raw = { id: editing?.id, name: $('#ik-name').value };
  for (const el of document.querySelectorAll('#ik-form-fields [data-f]')) raw[el.dataset.f] = el.value;
  const card = cleanCard(raw);
  if (!card) return ctx.toast('Für wen ist die Karte? Name eintragen.');
  const list = getCards().filter((x) => x.id !== card.id);
  setCards([...list, card]);
  $('#dlg-info').close();
  renderCards();
}

async function share(cards) {
  if (!cards.length) return;
  const text = `🩺 Infokarte ${cards.map((c) => c.name).join(', ')} (Arzt, Allergien, Notfallkontakte)\nBitte vertraulich behandeln.\n\n${ctx.publicUrl()}#ik=${await encodeCards(cards)}`;
  if (!confirm('Die Infokarte enthält Gesundheitsdaten. Schick sie nur an Menschen, denen du vertraust (z. B. Babysitter, Großeltern). Weiter?')) return;
  ctx.shareText(text, 'Infokarte schicken');
}

// Empfangene Karte (#ik=…): ansehen, auf Wunsch behalten
export async function handleCardsCode(code) {
  const cards = await decodeCards(code);
  if (!cards?.length) {
    ctx.toast('Dieser Link ist unvollständig.');
    return false;
  }
  ctx.show('infokarte');
  $('#ikv-list').replaceChildren(...cards.map((c) => cardView(c, { own: false })));
  $('#ikv-keep').onclick = () => {
    const own = getCards().filter((x) => !cards.some((c) => c.id === x.id));
    setCards([...own, ...cards]);
    ctx.toast('Auf diesem Gerät gespeichert.');
    renderCards();
  };
  return true;
}
