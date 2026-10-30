// Listen im Aufgaben-Bereich: Einkauf, Packliste, To-dos.
// Android mit Tasks.org/OpenTasks: echte, über DAVx⁵ geteilte Listen (VTODO beim Anbieter).
// Sonst: lokale Listen in Terminus, verschickbar als Nachricht.
import { splitItems, listText, encodeList, decodeList, mergeItem } from './listen.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'terminus.listen';
const PREF = 'terminus.listen.auswahl';
let ctx;
const st = { device: [], app: '', provider: null, current: '', items: [], hideDone: false };

const loadLocal = () => {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Array.isArray(d.lists) ? d.lists : [];
  } catch {
    return [];
  }
};
const saveLocal = (lists) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ lists }));
  } catch {
    ctx.toast('Speicher voll: Die Liste konnte nicht gespeichert werden.');
  }
};
export const getLocalLists = loadLocal;
export const setLocalLists = saveLocal;

export function initListen(c) {
  ctx = c;
  try {
    st.current = localStorage.getItem(PREF) || '';
  } catch {
    // ohne Speicher: erste Liste
  }
  $('#ls-list').addEventListener('change', (e) => {
    if (e.target.value === '+') return newLocalList();
    select(e.target.value);
  });
  $('#ls-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addItems($('#ls-input').value);
  });
  $('#ls-hide').addEventListener('change', (e) => {
    st.hideDone = e.target.checked;
    renderItems();
  });
  $('#ls-send').addEventListener('click', sendList);
  $('#ls-clear').addEventListener('click', clearDone);
  $('#ls-connect').addEventListener('click', connect);
}

const isDevice = (id) => id.startsWith('d:');

export async function renderListen() {
  if (ctx.isNative) {
    const p = await ctx.Native.taskProvider().catch(() => ({ available: false }));
    st.provider = p;
    if (p.available && p.granted) {
      const r = await ctx.Native.requestTasks().catch(() => ({ lists: [] }));
      st.device = r.lists || [];
      st.app = r.app || p.app;
    }
  }
  const local = loadLocal();
  const sel = $('#ls-list');
  const opts = [
    ...st.device.map((l) => new Option(`${l.name} (${l.account || st.app})`, `d:${l.id}`)),
    ...local.map((l) => new Option(st.device.length ? `${l.name} (nur hier)` : l.name, `l:${l.id}`)),
    new Option('+ Neue Liste …', '+'),
  ];
  sel.replaceChildren(...opts);
  const ids = opts.map((o) => o.value).filter((v) => v !== '+');
  if (!ids.includes(st.current)) st.current = ids[0] || '';
  if (!st.current) {
    // Erste Benutzung: eine Einkaufsliste anlegen
    const list = { id: `e${Date.now().toString(36)}`, name: 'Einkauf', items: [] };
    saveLocal([list]);
    return renderListen();
  }
  sel.value = st.current;
  renderConnect();
  await select(st.current);
}

function renderConnect() {
  const box = $('#ls-connect-box');
  const p = st.provider;
  box.hidden = !ctx.isNative || (p?.available && p?.granted);
  if (box.hidden) return;
  $('#ls-connect-hint').textContent = p?.available
    ? `${p.app} ist installiert. Erlaube Terminus den Zugriff, dann erscheinen die Listen, die DAVx⁵ mit deinem Anbieter abgleicht – geteilt mit allen, die dort Zugriff haben.`
    : 'Für Listen, die sich mit der Familie abgleichen: Tasks.org (Open Source) installieren und in DAVx⁵ beim Konto „Aufgaben“ anhaken. Bis dahin speichert Terminus Listen nur auf diesem Handy.';
  $('#ls-connect').textContent = p?.available ? `Mit ${p.app} verbinden` : 'Tasks.org bei F-Droid';
}

async function connect() {
  if (!st.provider?.available) {
    ctx.openUrl('https://f-droid.org/packages/org.tasks/');
    return;
  }
  try {
    await ctx.Native.requestTasks();
    await renderListen();
  } catch (e) {
    ctx.toast(e.message || 'Kein Zugriff auf die Listen.');
  }
}

async function select(id) {
  st.current = id;
  try {
    localStorage.setItem(PREF, id);
  } catch {
    // egal
  }
  if (isDevice(id)) {
    try {
      st.items = (await ctx.Native.listTasks({ listId: id.slice(2) })).items || [];
    } catch (e) {
      st.items = [];
      ctx.toast(e.message || 'Die Liste konnte nicht gelesen werden.');
    }
  } else {
    st.items = loadLocal().find((l) => `l:${l.id}` === id)?.items || [];
  }
  renderItems();
}

function currentName() {
  if (isDevice(st.current)) return st.device.find((l) => `d:${l.id}` === st.current)?.name || 'Liste';
  return loadLocal().find((l) => `l:${l.id}` === st.current)?.name || 'Liste';
}

function storeLocal(items) {
  const lists = loadLocal().map((l) => (`l:${l.id}` === st.current ? { ...l, items } : l));
  saveLocal(lists);
  st.items = items;
}

function renderItems() {
  const ul = $('#ls-items');
  const shown = st.items.filter((i) => !st.hideDone || !i.done).sort((a, b) => Number(a.done) - Number(b.done));
  ul.replaceChildren(...shown.map((item) => {
    const li = document.createElement('li');
    li.className = item.done ? 'done' : '';
    li.innerHTML = '<label><input type="checkbox"><span></span></label><button class="btn ghost small icon" type="button" aria-label="Entfernen">✕</button>';
    const box = $('input', li);
    box.checked = item.done;
    $('span', li).textContent = item.text;
    box.addEventListener('change', () => toggle(item, box.checked));
    $('button', li).addEventListener('click', () => remove(item));
    return li;
  }));
  const open = st.items.filter((i) => !i.done).length;
  $('#ls-count').textContent = st.items.length ? `${open} offen${st.items.length - open ? `, ${st.items.length - open} erledigt` : ''}` : 'Noch leer. Tipp oben ein, mehrere mit Komma: „Milch, Eier, Brot“.';
  $('#ls-clear').hidden = isDevice(st.current) || st.items.every((i) => !i.done);
}

async function addItems(text) {
  const parts = splitItems(text);
  if (!parts.length) return;
  $('#ls-input').value = '';
  if (isDevice(st.current)) {
    for (const t of parts) {
      const hit = st.items.find((i) => i.text.toLowerCase() === t.toLowerCase());
      if (hit) {
        if (hit.done) await ctx.Native.setTaskDone({ id: hit.id, done: false }).catch(() => {});
      } else await ctx.Native.addTask({ listId: st.current.slice(2), text: t }).catch((e) => ctx.toast(e.message));
    }
    return select(st.current);
  }
  let items = st.items;
  for (const t of parts) items = mergeItem(items, t).items;
  storeLocal(items);
  renderItems();
}

async function toggle(item, done) {
  if (isDevice(st.current)) {
    await ctx.Native.setTaskDone({ id: item.id, done }).catch((e) => ctx.toast(e.message));
    return select(st.current);
  }
  storeLocal(st.items.map((i) => (i.id === item.id ? { ...i, done } : i)));
  renderItems();
}

async function remove(item) {
  if (isDevice(st.current)) {
    await ctx.Native.deleteTask({ id: item.id }).catch((e) => ctx.toast(e.message));
    return select(st.current);
  }
  storeLocal(st.items.filter((i) => i.id !== item.id));
  renderItems();
}

function clearDone() {
  storeLocal(st.items.filter((i) => !i.done));
  renderItems();
}

function newLocalList(name = '', items = []) {
  const n = name || prompt('Name der neuen Liste (z. B. Packliste Urlaub):', '')?.trim();
  if (!n) {
    $('#ls-list').value = st.current;
    return null;
  }
  const list = { id: `e${Date.now().toString(36)}`, name: n.slice(0, 60), items: items.map((t) => mergeItem([], t).items[0]) };
  saveLocal([...loadLocal(), list]);
  st.current = `l:${list.id}`;
  try {
    localStorage.setItem(PREF, st.current);
  } catch {
    // egal
  }
  if (!$('#view-tasks').hidden) renderListen();
  return list;
}

async function sendList() {
  const name = currentName();
  const text = `${listText(name, st.items)}\n\nAls eigene Liste in Terminus übernehmen:\n${ctx.publicUrl()}#l=${encodeList(name, st.items)}`;
  try {
    if (ctx.isNative) await ctx.Native.shareText({ text, title: 'Liste schicken' });
    else if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      ctx.toast('Liste kopiert.');
    }
  } catch {
    // abgebrochen
  }
}

// Empfangene Liste (#l=…) als lokale Kopie übernehmen
export function handleListCode(code) {
  const l = decodeList(code);
  if (!l) {
    ctx.toast('Dieser Listen-Link ist unvollständig.');
    return false;
  }
  newLocalList(l.name, l.items);
  ctx.show('tasks');
  ctx.toast(`Liste „${l.name}“ übernommen (${l.items.length} Einträge).`);
  return true;
}
