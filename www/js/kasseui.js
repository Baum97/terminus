// Gemeinsame Kasse: Ausgaben erfassen, Stand per Link teilen, ausgleichen (auch per GiroCode).
import { ask } from './ask.js';
import { newId, parseAmount, euro, balances, settle, merge, encodeGroup, decodeGroup, validIban, cleanIban, epcPayload } from './kasse.js';

const $ = (sel, root = document) => root.querySelector(sel);
const KEY = 'terminus.kassen';
let ctx;
let current = null;

export const getGroups = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
};
export const setGroups = (v) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v || {}));
  } catch {
    ctx.toast('Speicher voll.');
  }
};
const saveGroup = (g) => setGroups({ ...getGroups(), [g.id]: g });

export function initKasse(c) {
  ctx = c;
  $('#kasse-new').addEventListener('click', createGroup);
  $('#ka-add').addEventListener('click', addExpense);
  $('#ka-share').addEventListener('click', shareState);
  $('#ka-member-add').addEventListener('click', addMember);
  $('#ka-delete').addEventListener('click', deleteGroup);
  renderGroupList();
}

function renderGroupList() {
  const groups = Object.values(getGroups()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const ul = $('#kasse-list');
  ul.hidden = !groups.length;
  ul.replaceChildren(...groups.map((g) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="c"></span><span class="x"><strong></strong><small></small></span>';
    $('strong', li).textContent = g.name;
    const total = g.expenses.filter((e) => !e.deleted && !e.settle).reduce((n, e) => n + e.amount, 0);
    $('small', li).textContent = `${g.members.length} Personen · ${euro(total)} ausgegeben`;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Öffnen' });
    b.addEventListener('click', () => openGroup(g.id));
    li.append(b);
    return li;
  }));
}

async function createGroup() {
  const name = await ask({ title: 'Neue Kasse', label: 'Name', placeholder: 'Ausflug Gardasee, WG, Kita-Kasse …', ok: 'Anlegen' });
  if (!name) return;
  const me = ctx.state.settings.ownerName || 'Ich';
  const g = { id: newId(), name: name.slice(0, 60), members: [{ name: me }], expenses: [], updated: Date.now(), me };
  saveGroup(g);
  renderGroupList();
  openGroup(g.id);
}

export function openGroup(id) {
  current = getGroups()[id];
  if (!current) return;
  ctx.show('kasse');
  render();
}

function render() {
  const g = current;
  $('#ka-title').textContent = g.name;
  const sel = $('#ka-by');
  const prev = sel.value;
  sel.replaceChildren(...g.members.map((m) => new Option(m.name, m.name)));
  sel.value = g.members.some((m) => m.name === prev) ? prev : g.me && g.members.some((m) => m.name === g.me) ? g.me : g.members[0]?.name;
  $('#ka-for').replaceChildren(...g.members.map((m) => {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = '<input type="checkbox" checked> <span></span>';
    $('input', l).value = m.name;
    $('span', l).textContent = m.name;
    return l;
  }));
  // Salden und Ausgleich
  const bal = balances(g);
  $('#ka-balances').replaceChildren(...Object.entries(bal).map(([name, v]) => {
    const li = document.createElement('li');
    li.className = v > 0 ? 'plus' : v < 0 ? 'minus' : '';
    li.textContent = v > 0 ? `${name} bekommt ${euro(v)}` : v < 0 ? `${name} schuldet ${euro(-v)}` : `${name} ist ausgeglichen`;
    return li;
  }));
  const plan = settle(bal);
  $('#ka-settle-box').hidden = !plan.length;
  $('#ka-settle').replaceChildren(...plan.map((t) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><div class="row"></div>';
    $('span', li).textContent = `${t.from} → ${t.to}: ${euro(t.amount)}`;
    const iban = g.members.find((m) => m.name === t.to)?.iban;
    if (iban) {
      const qr = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'GiroCode' });
      qr.addEventListener('click', () => showGiro(t, iban));
      $('.row', li).append(qr);
    }
    const done = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Bezahlt' });
    done.addEventListener('click', () => {
      g.expenses.push({ id: newId(), by: t.from, amount: t.amount, text: `Ausgleich an ${t.to}`, for: [t.to], at: Date.now(), settle: true });
      persist();
      ctx.toast('Eingetragen. Teile den neuen Stand, damit alle ihn haben.');
    });
    $('.row', li).append(done);
    return li;
  }));
  // Ausgaben
  const list = g.expenses.filter((e) => !e.deleted).slice().reverse();
  $('#ka-expenses').replaceChildren(...list.map((e) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="x"><strong></strong><small></small></span><button class="btn ghost small icon" type="button" aria-label="Löschen">✕</button>';
    $('strong', li).textContent = `${e.text || 'Ausgabe'} · ${euro(e.amount)}`;
    $('small', li).textContent = `${e.by} hat bezahlt${e.for?.length && e.for.length < g.members.length ? ` für ${e.for.join(', ')}` : ''} · ${new Date(e.at).toLocaleDateString('de-DE')}`;
    $('button', li).addEventListener('click', () => {
      e.deleted = true;
      persist();
      ctx.toast(`„${e.text || 'Ausgabe'}“ gelöscht.`, { undo: () => {
        delete e.deleted;
        persist();
      } });
    });
    return li;
  }));
  $('#ka-empty').hidden = !!list.length;
  // Neue Kasse: erst die Leute eintragen
  if (g.members.length < 2) $('#ka-people').open = true;
  $('#ka-members').textContent = g.members.map((m) => `${m.name}${m.iban ? ' (IBAN)' : ''}`).join(', ');
}

function persist() {
  current.updated = Date.now();
  saveGroup(current);
  renderGroupList();
  render();
}

function addMember() {
  const name = $('#ka-member').value.trim().slice(0, 40);
  const iban = cleanIban($('#ka-iban').value);
  if (!name) return ctx.toast('Name fehlt.');
  if (iban && !validIban(iban)) return ctx.toast('Die IBAN stimmt nicht. Bitte prüfen.');
  const hit = current.members.find((m) => m.name.toLowerCase() === name.toLowerCase());
  if (hit) {
    if (iban) hit.iban = iban;
  } else current.members.push({ name, ...(iban ? { iban } : {}) });
  $('#ka-member').value = '';
  $('#ka-iban').value = '';
  persist();
}

function addExpense() {
  const amount = parseAmount($('#ka-amount').value);
  if (!amount) return ctx.toast('Betrag eingeben, z. B. 12,50.');
  const forWhom = [...document.querySelectorAll('#ka-for input:checked')].map((i) => i.value);
  if (!forWhom.length) return ctx.toast('Für wen? Mindestens eine Person anhaken.');
  current.expenses.push({
    id: newId(), by: $('#ka-by').value, amount, text: $('#ka-text').value.trim().slice(0, 80),
    for: forWhom.length === current.members.length ? [] : forWhom, at: Date.now(),
  });
  $('#ka-amount').value = '';
  $('#ka-text').value = '';
  persist();
}

async function shareState() {
  const code = await encodeGroup(current);
  const bal = balances(current);
  const lines = Object.entries(bal).filter(([, v]) => v).map(([n, v]) => (v > 0 ? `${n} bekommt ${euro(v)}` : `${n} schuldet ${euro(-v)}`));
  const text = `💶 Kasse „${current.name}“\n${lines.length ? lines.join('\n') : 'Alle sind ausgeglichen.'}\n\nStand öffnen und eigene Ausgaben eintragen:\n${ctx.publicUrl()}#ka=${code}`;
  try {
    if (ctx.isNative) await ctx.Native.shareText({ text, title: 'Kasse teilen' });
    else if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      ctx.toast('Kopiert.');
    }
  } catch {
    // abgebrochen
  }
}

function deleteGroup() {
  const before = getGroups();
  const all = { ...before };
  delete all[current.id];
  setGroups(all);
  renderGroupList();
  ctx.openHub('kasse');
  ctx.toast(`Kasse „${current.name}“ gelöscht.`, { undo: () => (setGroups(before), renderGroupList()) });
}

function showGiro(t, iban) {
  const dlg = $('#dlg-giro');
  $('#giro-text').textContent = `${t.from} überweist ${euro(t.amount)} an ${t.to}. Mit der Banking-App scannen (Fotoüberweisung / GiroCode).`;
  ctx.drawQR($('#giro-qr'), epcPayload({ name: t.to, iban, amount: t.amount, text: current.name }));
  dlg.showModal();
}

// Empfangener Stand (#ka=…): mit dem eigenen zusammenführen
export async function handleGroupCode(code) {
  const incoming = await decodeGroup(code);
  if (!incoming) {
    ctx.toast('Dieser Kassen-Link ist unvollständig.');
    return false;
  }
  const all = getGroups();
  const mine = all[incoming.id];
  const merged = merge(mine, incoming);
  merged.updated = Date.now();
  if (!merged.me) merged.me = ctx.state.settings.ownerName && merged.members.some((m) => m.name === ctx.state.settings.ownerName) ? ctx.state.settings.ownerName : '';
  saveGroup(merged);
  renderGroupList();
  openGroup(merged.id);
  const added = mine ? merged.expenses.length - mine.expenses.length : merged.expenses.length;
  ctx.toast(mine ? (added ? `${added} ${added === 1 ? 'neue Ausgabe' : 'neue Ausgaben'} übernommen.` : 'Du hast schon diesen Stand.') : `Kasse „${merged.name}“ übernommen.`);
  return true;
}
