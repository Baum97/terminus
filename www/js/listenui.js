// Listen im Aufgaben-Bereich: Einkauf, Packliste, To-dos.
// Android mit Tasks.org/OpenTasks: echte, über DAVx⁵ geteilte Listen (VTODO beim Anbieter).
// Sonst: lokale Listen in Terminus, verschickbar als Nachricht.
import { ask } from './ask.js';
import { splitItems, splitTitled, listText, encodeList, decodeList, mergeItem, parseChecklist, checklistNotes, addSubs, subProgress, sameList } from './listen.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'terminus.listen';
const PREF = 'terminus.listen.auswahl';
let ctx;
const st = { device: [], app: '', provider: null, current: '', items: [], hideDone: false, tabs: [], open: new Set() };

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
  // Listen als Reiter; der letzte Reiter legt eine neue Liste an
  $('#ls-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-list]');
    if (!b) return;
    if (b.dataset.list === '+') return newLocalList();
    select(b.dataset.list).then(renderTabs);
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
  $('#ls-widget').addEventListener('click', async () => {
    const r = await ctx.Native.pinWidget({ kind: 'list' }).catch(() => ({}));
    if (!r.requested) ctx.toast('Lange auf den Startbildschirm drücken → Widgets → Terminus: Liste.');
  });
}

const isDevice = (id) => id.startsWith('d:');
// Fälligkeit: ISO-Datum (lokale Listen) oder Millisekunden (Tasks.org/OpenTasks)
const fmtShort = (d) => (typeof d === 'number' ? new Date(d) : new Date(`${d}T12:00:00`)).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });

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
  st.tabs = [
    ...st.device.map((l) => ({ id: `d:${l.id}`, name: l.name, shared: true })),
    ...local.map((l) => ({ id: `l:${l.id}`, name: l.name, shared: false })),
  ];
  const ids = st.tabs.map((t) => t.id);
  if (!ids.includes(st.current)) st.current = ids[0] || '';
  if (!st.current) {
    // Erste Benutzung: eine Einkaufsliste anlegen
    const list = { id: `e${Date.now().toString(36)}`, name: 'Einkauf', items: [] };
    saveLocal([list]);
    return renderListen();
  }
  renderTabs();
  renderConnect();
  await select(st.current);
}

function renderTabs() {
  const box = $('#ls-tabs');
  box.replaceChildren(...st.tabs.map((t) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: t.name });
    b.dataset.list = t.id;
    b.setAttribute('aria-pressed', String(t.id === st.current));
    if (t.shared) b.title = `Geteilt über ${st.app || 'DAVx⁵'}`;
    return b;
  }), Object.assign(document.createElement('button'), { type: 'button', className: 'new', textContent: '+ Liste' }));
  box.lastElementChild.dataset.list = '+';
  box.lastElementChild.setAttribute('aria-label', 'Neue Liste');
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
      // Unterpunkte stehen bei Tasks.org/OpenTasks als Checkliste in der Beschreibung
      st.items = ((await ctx.Native.listTasks({ listId: id.slice(2) })).items || []).map((i) => ({ ...i, ...parseChecklist(i.notes) }));
    } catch (e) {
      st.items = [];
      ctx.toast(e.message || 'Die Liste konnte nicht gelesen werden.');
    }
  } else {
    st.items = loadLocal().find((l) => `l:${l.id}` === id)?.items || [];
    // Häkchen aus dem Widget übernehmen
    if (ctx.isNative) {
      const { changes = {}, listId } = await ctx.Native.takeListWidgetChanges().catch(() => ({}));
      if (listId === id && Object.keys(changes).length) storeLocal(st.items.map((i) => (i.id in changes ? { ...i, done: !!changes[i.id] } : i)));
    }
  }
  renderItems();
}

// Startbildschirm-Widget mit der gerade gewählten Liste
function pushWidget() {
  if (!ctx.isNative || !st.current) return;
  ctx.Native.setListWidget({
    name: currentName(), source: isDevice(st.current) ? 'd' : 'l', listId: st.current,
    items: st.items.slice(0, 40).map((i) => ({ id: isDevice(st.current) ? String(i.id) : i.id, text: i.sub?.length ? `${i.text} · ${subProgress(i.sub)}` : i.text, done: !!i.done })),
  }).catch(() => {});
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

const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;

// Ein Eintrag: Kreis zum Abhaken, Tippen auf den Text klappt Unterpunkte und Löschen auf
function renderItems(focus) {
  const ul = $('#ls-items');
  const shown = st.items.filter((i) => !st.hideDone || !i.done).sort((a, b) => Number(a.done) - Number(b.done));
  ul.replaceChildren(...shown.map(itemRow));
  const open = st.items.filter((i) => !i.done).length;
  $('#ls-count').textContent = st.items.length ? `${open} offen${st.items.length - open ? `, ${st.items.length - open} erledigt` : ''}` : 'Noch leer. Mehrere mit Komma: „Milch, Eier, Brot“. Mit Unterpunkten: „Einkauf: Milch, Eier“.';
  $('#ls-clear').hidden = isDevice(st.current) || !st.items.some((i) => i.done || i.sub?.some((x) => x.done));
  pushWidget();
  // Fokus bleibt beim selben Bedienelement, auch wenn die Liste neu gezeichnet wird
  if (focus) ul.querySelector(`li[data-id="${CSS.escape(String(focus.id))}"] ${focus.sel}`)?.focus();
}

function itemRow(item) {
  const id = String(item.id);
  const sub = item.sub || [];
  const open = st.open.has(id);
  const li = document.createElement('li');
  li.dataset.id = id;
  li.className = [item.done && 'done', open && 'open'].filter(Boolean).join(' ');
  li.innerHTML = `<div class="ls-row"><label class="ck"><input type="checkbox"></label><button class="ls-open" type="button"><span class="ls-text"></span><span class="ls-meta"></span>${icon('chevron')}</button></div>`;
  const box = $('input', li);
  box.checked = !!item.done;
  box.setAttribute('aria-label', `${item.text} erledigt`);
  box.addEventListener('change', () => toggle(item, box.checked));
  $('.ls-text', li).textContent = item.text;
  const meta = $('.ls-meta', li);
  if (sub.length) meta.append(Object.assign(document.createElement('span'), { className: 'prog', textContent: subProgress(sub) }));
  if (item.due) meta.append(Object.assign(document.createElement('small'), { className: 'due', textContent: `bis ${fmtShort(item.due)}` }));
  const btn = $('.ls-open', li);
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', `${item.text}${sub.length ? `, ${subProgress(sub)} Unterpunkte erledigt` : ''}: Details`);
  btn.addEventListener('click', () => {
    if (open) st.open.delete(id);
    else st.open.add(id);
    renderItems({ id, sel: open ? '.ls-open' : '.ls-subadd input' });
  });
  if (open) li.append(subPanel(item));
  return li;
}

function subPanel(item) {
  const id = String(item.id);
  const sub = item.sub || [];
  const box = document.createElement('div');
  box.className = 'ls-sub';
  box.innerHTML = `<ul class="ls-subs"></ul>
    <form class="ls-subadd"><input autocomplete="off" enterkeyhint="done"><button class="icon-btn small" type="submit" aria-label="Unterpunkt dazu">${icon('plus')}</button></form>
    <div class="ls-subfoot"><button class="text-btn danger" type="button">${icon('trash')}Löschen</button></div>`;
  $('.ls-subs', box).replaceChildren(...sub.map((s, n) => {
    const row = document.createElement('li');
    row.className = s.done ? 'done' : '';
    row.innerHTML = `<label><input type="checkbox"><span></span></label><button class="icon-btn small" type="button">${icon('x')}</button>`;
    const c = $('input', row);
    c.checked = s.done;
    $('span', row).textContent = s.text;
    c.addEventListener('change', () => saveSub(item, sub.map((x, k) => (k === n ? { ...x, done: c.checked } : x)), { id, sel: `.ls-subs li:nth-child(${n + 1}) input` }));
    const x = $('button', row);
    x.setAttribute('aria-label', `„${s.text}“ entfernen`);
    x.addEventListener('click', () => saveSub(item, sub.filter((_, k) => k !== n), { id, sel: '.ls-subadd input' }));
    return row;
  }));
  const input = $('.ls-subadd input', box);
  input.placeholder = sub.length ? 'Noch etwas dazu' : 'Unterpunkte, mehrere mit Komma';
  input.setAttribute('aria-label', `Unterpunkt zu „${item.text}“`);
  $('.ls-subadd', box).addEventListener('submit', (e) => {
    e.preventDefault();
    const parts = splitItems(input.value);
    if (parts.length) saveSub(item, addSubs(sub, parts), { id, sel: '.ls-subadd input' });
  });
  $('.ls-subfoot button', box).addEventListener('click', () => remove(item));
  return box;
}

// Unterpunkte speichern. Sind alle abgehakt, ist die Aufgabe erledigt; ein offener Punkt öffnet sie wieder.
async function saveSub(item, sub, focus) {
  const before = (item.sub || []).filter((s) => !s.done).length;
  const left = sub.filter((s) => !s.done).length;
  const done = sub.length && !left ? true : left > before ? false : !!item.done;
  const finished = done && !item.done;
  if (isDevice(st.current)) {
    try {
      await ctx.Native.setTaskNotes({ id: item.id, notes: checklistNotes(sub, item.rest) });
      if (done !== !!item.done) await ctx.Native.setTaskDone({ id: item.id, done });
    } catch (e) {
      ctx.toast(e.message || 'Die Unterpunkte konnten nicht gespeichert werden.');
    }
    await select(st.current);
  } else storeLocal(st.items.map((i) => (i.id === item.id ? { ...i, sub, done } : i)));
  renderItems(focus);
  if (finished) ctx.toast(`„${item.text}“ ist komplett erledigt.`, { undo: () => toggle({ ...item, sub }, false) });
}

async function addItems(text) {
  // „Einkauf: Milch, Eier“ → ein Eintrag mit Unterpunkten (gibt es ihn schon, kommen sie dazu)
  const titled = splitTitled(text);
  const parts = titled ? [titled.title] : splitItems(text);
  if (!parts.length) return;
  $('#ls-input').value = '';
  if (isDevice(st.current)) {
    for (const t of parts) {
      const hit = st.items.find((i) => i.text.toLowerCase() === t.toLowerCase());
      try {
        if (hit) {
          if (titled) await ctx.Native.setTaskNotes({ id: hit.id, notes: checklistNotes(addSubs(hit.sub, titled.items), hit.rest) });
          if (hit.done) await ctx.Native.setTaskDone({ id: hit.id, done: false });
          if (titled) st.open.add(String(hit.id));
        } else {
          const r = await ctx.Native.addTask({ listId: st.current.slice(2), text: t, ...(titled ? { notes: checklistNotes(addSubs([], titled.items)) } : {}) });
          if (titled && r?.id) st.open.add(String(r.id));
        }
      } catch (e) {
        ctx.toast(e.message);
      }
    }
    return select(st.current);
  }
  let items = st.items;
  for (const t of parts) items = mergeItem(items, t).items;
  if (titled) {
    const key = titled.title.toLowerCase();
    items = items.map((i) => (i.text.toLowerCase() === key ? { ...i, sub: addSubs(i.sub, titled.items), done: false } : i));
    const hit = items.find((i) => i.text.toLowerCase() === key);
    if (hit) st.open.add(String(hit.id));
  }
  storeLocal(items);
  renderItems();
}

async function toggle(item, done) {
  if (isDevice(st.current)) {
    await ctx.Native.setTaskDone({ id: item.id, done }).catch((e) => ctx.toast(e.message));
    await select(st.current);
  } else {
    storeLocal(st.items.map((i) => (i.id === item.id ? { ...i, done } : i)));
    renderItems();
  }
  $(`#ls-items li[data-id="${CSS.escape(String(item.id))}"] .ck input`)?.focus();
}

async function remove(item) {
  st.open.delete(String(item.id));
  if (isDevice(st.current)) {
    const listId = st.current.slice(2);
    await ctx.Native.deleteTask({ id: item.id }).catch((e) => ctx.toast(e.message));
    ctx.toast(`„${item.text}“ entfernt.`, { undo: async () => {
      await ctx.Native.addTask({ listId, text: item.text, ...(item.notes ? { notes: item.notes } : {}) }).catch(() => {});
      select(st.current);
    } });
    return select(st.current);
  }
  const before = st.items;
  storeLocal(st.items.filter((i) => i.id !== item.id));
  renderItems();
  ctx.toast(`„${item.text}“ entfernt.`, { undo: () => (storeLocal(before), renderItems()) });
}

// Erledigte löschen: abgehakte Einträge und abgehakte Unterpunkte
function clearDone() {
  const before = st.items;
  const count = before.reduce((n, i) => n + (i.done ? 1 : (i.sub || []).filter((x) => x.done).length), 0);
  storeLocal(st.items.filter((i) => !i.done).map((i) => (i.sub ? { ...i, sub: i.sub.filter((x) => !x.done) } : i)));
  renderItems();
  ctx.toast(`${count} erledigte gelöscht.`, { undo: () => (storeLocal(before), renderItems()) });
}

async function newLocalList(name = '', items = [], sub = {}) {
  const n = name || (await ask({ title: 'Neue Liste', label: 'Name', placeholder: 'Packliste Urlaub, Baumarkt …', ok: 'Anlegen' }));
  if (!n) {
    renderTabs();
    return null;
  }
  const list = { id: `e${Date.now().toString(36)}`, name: n.slice(0, 60), items: items.map((t, k) => ({ ...mergeItem([], t).items[0], ...(sub[k]?.length ? { sub: addSubs([], sub[k]) } : {}) })) };
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

// Aufgaben aus der Erkennung: in die zuletzt gewählte Liste (geteilt oder lokal), sonst „Aufgaben“.
// items: [{ text, due (ISO oder null), sub: [Texte] }] → { name, flat }
// Heißt die Aufgabe wie die Liste („Einkauf“ in „Einkauf“), kommen die Unterpunkte direkt in die Liste (flat).
export async function addTasks(items) {
  if (!st.current) {
    try {
      st.current = localStorage.getItem(PREF) || '';
    } catch {
      // ohne Speicher
    }
  }
  let flat = false;
  if (isDevice(st.current) && ctx.isNative) {
    const listId = st.current.slice(2);
    const name = st.device.find((l) => `d:${l.id}` === st.current)?.name || 'deine geteilte Liste';
    for (const it of items) {
      const due = it.due ? new Date(`${it.due}T00:00:00Z`).getTime() : undefined;
      if (it.sub?.length && sameList(it.text, name)) {
        flat = true;
        for (const t of it.sub) await ctx.Native.addTask({ listId, text: t, ...(due ? { due } : {}) });
        continue;
      }
      await ctx.Native.addTask({ listId, text: it.text, ...(due ? { due } : {}), ...(it.sub?.length ? { notes: checklistNotes(addSubs([], it.sub)) } : {}) });
    }
    if (!$('#view-tasks').hidden) select(st.current);
    return { name, flat };
  }
  let lists = loadLocal();
  let list = lists.find((l) => `l:${l.id}` === st.current) || lists[0];
  if (!list) {
    list = { id: `e${Date.now().toString(36)}`, name: 'Aufgaben', items: [] };
    lists = [list];
  }
  let next = list.items;
  const put = (text, due, sub) => {
    next = mergeItem(next, text).items;
    const key = text.toLowerCase();
    next = next.map((x) => (x.text.toLowerCase() === key ? { ...x, ...(due ? { due } : {}), ...(sub?.length ? { sub: addSubs(x.sub, sub) } : {}) } : x));
  };
  for (const it of items) {
    if (it.sub?.length && sameList(it.text, list.name)) {
      flat = true;
      for (const t of it.sub) put(t, it.due);
    } else put(it.text, it.due, it.sub);
  }
  saveLocal(lists.some((l) => l.id === list.id) ? lists.map((l) => (l.id === list.id ? { ...l, items: next } : l)) : [...lists, { ...list, items: next }]);
  st.current = `l:${list.id}`;
  try {
    localStorage.setItem(PREF, st.current);
  } catch {
    // egal
  }
  if (!$('#view-tasks').hidden) select(st.current);
  return { name: list.name, flat };
}

// Empfangene Liste (#l=…) als lokale Kopie übernehmen
export function handleListCode(code) {
  const l = decodeList(code);
  if (!l) {
    ctx.toast('Dieser Listen-Link ist unvollständig.');
    return false;
  }
  newLocalList(l.name, l.items, l.sub);
  ctx.show('tasks');
  ctx.toast(`Liste „${l.name}“ übernommen (${l.items.length} Einträge).`);
  return true;
}
