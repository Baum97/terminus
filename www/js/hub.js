// Kalender, Aufgaben, Familie und Umzugshelfer.
// In der App kommen die Termine aus dem Handykalender (über DAVx⁵ mit CalDAV synchronisiert),
// in der Web-Version aus den gemerkten Terminen.
import { toISO, fromISO, addDays, fmtDate, fmtWhen, isoWeek, WEEKDAYS, WD_SHORT } from './dates.js';
import { fromDevice, fromLocal, birthdayItems, itemsOnDay, matchesPerson, titleWithDone, weekStart, monthGrid } from './calendar.js';
import { buildDescription } from './desc.js';
import { publicHolidays, schoolHolidays } from './holidays.js';
import { normalizeEvent, newId } from './events.js';
import { parseICS, simpleRepeat } from './icsimport.js';
import { readZip } from './unzip.js';

const $ = (sel, root = document) => root.querySelector(sel);
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAVX = 'bitfire.at.davdroid';

let ctx;
const cal = { mode: 'month', selected: toISO(new Date()), person: '', items: [], granted: true, birthdays: null, current: null };
const tasks = { person: '' };

const localMs = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

export function initHub(c) {
  ctx = c;
  for (const b of document.querySelectorAll('.segmented [data-mode]')) {
    b.addEventListener('click', () => {
      cal.mode = b.dataset.mode;
      renderCalendar();
    });
  }
  $('#cal-prev').addEventListener('click', () => step(-1));
  $('#cal-next').addEventListener('click', () => step(1));
  $('#cal-today').addEventListener('click', () => {
    cal.selected = toISO(new Date());
    renderCalendar();
  });
  $('#cal-add').addEventListener('click', () => ctx.startManual(cal.selected));
  $('#cal-menu').addEventListener('click', openCalendarMenu);
  $('#calm-new').addEventListener('click', () => {
    $('#dlg-calendars').close();
    ctx.startManual(cal.selected);
  });
  $('#calm-subscribe').addEventListener('click', () => {
    $('#dlg-calendars').close();
    ctx.show('family');
    $('#sub-url').focus();
  });
  $('#calm-check').addEventListener('click', () => {
    $('#dlg-calendars').close();
    ctx.show('setup');
    $('#setup-verify').click();
  });
  $('#cal-grant').addEventListener('click', async () => {
    try {
      await ctx.Native.listCalendars();
    } catch (e) {
      ctx.toast(e.message || 'Kein Zugriff auf den Kalender.');
    }
    renderCalendar();
  });
  bindEventDialog();
  bindFamily();
  bindMigrate();
  updateFamilyClass();
}

export function onShow(view) {
  if (view === 'calendar') renderCalendar();
  if (view === 'tasks') renderTasks();
  if (view === 'family') renderFamily();
  if (view === 'migrate') renderMigrate();
}

export function invalidateBirthdays() {
  cal.birthdays = null;
}

/* ---------- Daten ---------- */

async function birthdays() {
  if (cal.birthdays) return cal.birthdays;
  if (ctx.isNative) {
    try {
      cal.birthdays = (await ctx.Native.listBirthdays())?.birthdays || [];
    } catch {
      cal.birthdays = [];
    }
  } else {
    cal.birthdays = ctx.store.getPeople().filter((p) => p.bday).map((p) => ({ name: p.name, date: p.bday }));
  }
  return cal.birthdays;
}

async function loadItems(from, to) {
  const items = [];
  if (ctx.isNative) {
    try {
      const r = await ctx.Native.findEvents({ from: localMs(from), to: localMs(addDays(to, 1)) });
      cal.granted = r.granted;
      const subscribed = ctx.subscribedCalendarIds();
      items.push(...r.events.map(fromDevice).map((it) => (subscribed.has(it.calendarId) ? { ...it, readOnly: true } : it)));
    } catch {
      cal.granted = false;
    }
  } else {
    for (const ev of ctx.store.getSaved()) items.push(...fromLocal(ev, from, to));
    for (const sub of ctx.webSubscriptionEvents()) {
      for (const ev of sub.events) {
        items.push(...fromLocal(ev, from, to).map((it) => ({ ...it, key: `k:${sub.channel}:${it.key}`, source: 'abo', calendarId: `k:${sub.channel}`, calendar: sub.name, color: sub.color, readOnly: true })));
      }
    }
  }
  if (ctx.state.settings.showBirthdays !== false) items.push(...birthdayItems((await birthdays()) || [], from, to));
  return items;
}

function holidayMap(from, to) {
  const map = new Map();
  const st = ctx.state.settings.state || '';
  for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) for (const h of publicHolidays(y, st)) map.set(h.date, h.name);
  return map;
}

function schoolHolidayOn(iso) {
  const st = ctx.state.settings.state;
  return st ? schoolHolidays(st).find((p) => iso >= p.start && iso <= p.end)?.name : null;
}

/* ---------- Kalenderansicht ---------- */

function step(dir) {
  const d = fromISO(cal.selected);
  if (cal.mode === 'month') d.setMonth(d.getMonth() + dir, 1);
  else d.setDate(d.getDate() + (cal.mode === 'week' ? 7 : 1) * dir);
  cal.selected = toISO(d);
  renderCalendar();
}

function range() {
  const d = fromISO(cal.selected);
  if (cal.mode === 'month') {
    const grid = monthGrid(d.getFullYear(), d.getMonth());
    return [grid[0], grid[41]];
  }
  if (cal.mode === 'week') {
    const start = weekStart(cal.selected);
    return [start, addDays(start, 6)];
  }
  return [cal.selected, cal.selected];
}

function renderPeopleFilter(el, current, onPick) {
  const family = ctx.store.getFamily();
  if (!family.length) {
    el.replaceChildren();
    return;
  }
  const opts = [['', 'Alle'], ...family.map((m) => [m.name, m.name])];
  el.replaceChildren(...opts.map(([value, label]) => {
    const li = document.createElement('li');
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label });
    b.setAttribute('aria-pressed', String(value === current));
    b.addEventListener('click', () => onPick(value));
    li.append(b);
    return li;
  }));
}

async function renderCalendar() {
  if (document.documentElement.classList.contains('simple')) cal.mode = 'day';
  const [from, to] = range();
  const d = fromISO(cal.selected);
  for (const b of document.querySelectorAll('.segmented [data-mode]')) b.setAttribute('aria-selected', String(b.dataset.mode === cal.mode));
  $('#cal-title').textContent = cal.mode === 'month'
    ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    : cal.mode === 'week' ? `KW ${isoWeek(from)} · ${fmtDate(from, false).slice(4)}–${fmtDate(to, false).slice(4)}` : fmtDate(cal.selected);
  renderPeopleFilter($('#cal-people'), cal.person, (p) => {
    cal.person = p;
    renderCalendar();
  });

  cal.items = (await loadItems(from, to)).filter((i) => matchesPerson(i, cal.person));
  $('#cal-permission').hidden = !ctx.isNative || cal.granted;
  const holidays = holidayMap(from, to);
  const today = toISO(new Date());

  const month = $('#cal-month');
  if (cal.mode === 'month') {
    const cells = WD_SHORT.slice(1).concat(WD_SHORT[0]).map((w) => Object.assign(document.createElement('div'), { className: 'wd', textContent: w }));
    for (const iso of monthGrid(d.getFullYear(), d.getMonth())) {
      const day = fromISO(iso);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'day';
      b.classList.toggle('other', day.getMonth() !== d.getMonth());
      b.classList.toggle('today', iso === today);
      b.classList.toggle('holiday', holidays.has(iso) || day.getDay() === 0);
      b.setAttribute('aria-selected', String(iso === cal.selected));
      const on = itemsOnDay(cal.items, iso);
      b.setAttribute('aria-label', `${fmtDate(iso)}${on.length ? `, ${on.length} Termine` : ''}${holidays.has(iso) ? `, ${holidays.get(iso)}` : ''}`);
      b.innerHTML = '<span class="n"></span><span class="dots"></span>';
      $('.n', b).textContent = day.getDate();
      $('.dots', b).append(...on.slice(0, 4).map((i) => Object.assign(document.createElement('i'), { style: `background:${i.color}` })));
      b.addEventListener('click', () => {
        cal.selected = iso;
        renderCalendar();
      });
      cells.push(b);
    }
    month.replaceChildren(...cells);
  } else {
    month.replaceChildren();
  }

  const days = cal.mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(from, i)) : [cal.selected];
  $('#cal-agenda').replaceChildren(...days.map((iso) => agendaDay(iso, holidays)));
}

function agendaDay(iso, holidays) {
  const wrap = document.createElement('section');
  wrap.className = 'agenda-day';
  const h = document.createElement('h3');
  const d = fromISO(iso);
  h.textContent = `${WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
  const extra = [holidays.get(iso), schoolHolidayOn(iso)].filter(Boolean).join(' · ');
  if (extra) h.append(Object.assign(document.createElement('small'), { textContent: extra }));
  wrap.append(h);
  const items = itemsOnDay(cal.items, iso);
  if (!items.length) {
    wrap.append(Object.assign(document.createElement('p'), { className: 'agenda-empty', textContent: 'Keine Termine' }));
    return wrap;
  }
  const ul = document.createElement('ul');
  ul.className = 'agenda-list';
  for (const item of items) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = item.done ? 'done' : '';
    b.innerHTML = '<span class="t"></span><span class="c"></span><span class="x"><strong></strong><small></small></span>';
    $('.t', b).textContent = item.allDay ? (item.frist ? 'Frist' : 'ganztags') : item.start;
    $('.c', b).style.background = item.color;
    $('strong', b).textContent = item.title;
    $('small', b).textContent = [
      item.meta.forWhom.length ? `Für ${item.meta.forWhom.join(', ')}` : '',
      item.meta.responsible ? `Zuständig: ${item.meta.responsible}` : '',
      item.meta.bring.length ? `Mitbringen ${item.meta.bring.filter((x) => x.done).length}/${item.meta.bring.length}` : '',
      item.location,
    ].filter(Boolean).join(' · ') || item.calendar || '';
    b.addEventListener('click', () => openEvent(item));
    li.append(b);
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

/* ---------- Kalender-Menü: Kalender des Handys, Leute einladen ---------- */

async function openCalendarMenu() {
  const list = $('#calm-list');
  let cals = [];
  if (ctx.isNative && cal.granted) cals = (await ctx.Native.listCalendars().catch(() => ({ calendars: [] }))).calendars || [];
  if (!ctx.isNative) cals = [{ id: 'local', name: 'Gemerkte Termine', account: 'auf diesem Gerät', color: '#2443C4' }];
  list.replaceChildren(...cals.map((c) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="c"></span><span class="x"><strong></strong><small></small></span>';
    $('.c', li).style.background = c.color || '#2443C4';
    $('strong', li).textContent = c.name;
    $('small', li).textContent = `${c.account}${c.id === ctx.state.settings.familyCalendarId ? ' · Familienkalender' : ''}`;
    // Teilen geht für jeden Kalender (Abonnieren); Mitbearbeiten nur für Kalender in einem teilbaren Konto
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: ctx.isAbo(c.id) ? 'Geteilt ✓' : 'Teilen' });
    b.addEventListener('click', () => {
      $('#dlg-calendars').close();
      ctx.shareCalendar(c);
    });
    li.append(b);
    return li;
  }));
  renderSubscriptions();
  $('#calm-hint').textContent = ctx.isNative
    ? cals.length ? 'Teilen: Andere abonnieren einen Kalender (nur lesen) oder bearbeiten ihn mit (gemeinsames Konto).' : 'Gib Terminus Zugriff auf den Kalender, dann erscheinen hier deine Kalender.'
    : 'In der Web-Version gibt es nur die gemerkten Termine. Den vollen Kalender zeigt die Android-App.';
  $('#dlg-calendars').showModal();
}

// Per Nachricht abonnierte Kalender: nur lesen, beenden entfernt den Kalender vom Gerät
function renderSubscriptions() {
  const subs = Object.entries(ctx.subscriptions());
  $('#calm-subs-box').hidden = !subs.length;
  $('#calm-subs').replaceChildren(...subs.map(([channel, s]) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="c"></span><span class="x"><strong></strong><small></small></span>';
    $('.c', li).style.background = 'var(--ink-soft)';
    $('strong', li).textContent = s.name;
    $('small', li).textContent = `${s.by ? `von ${s.by} · ` : ''}${s.count} Termine · Stand ${new Date(s.seq).toLocaleDateString('de-DE')}`;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small danger', textContent: 'Beenden' });
    b.addEventListener('click', async () => {
      if (b.dataset.confirm !== '1') {
        b.dataset.confirm = '1';
        b.textContent = 'Wirklich?';
        return;
      }
      try {
        await ctx.endSubscription(channel);
        ctx.toast(`„${s.name}“ beendet. Die Termine sind entfernt.`);
        renderSubscriptions();
        renderCalendar();
      } catch (e) {
        ctx.toast(e.message || 'Das hat nicht geklappt.');
      }
    });
    li.append(b);
    return li;
  }));
}

/* ---------- Termin-Detail ---------- */

function bindEventDialog() {
  $('#ev-done').addEventListener('change', (e) => update(cal.current, { done: e.target.checked }));
  $('#ev-for').addEventListener('change', (e) => update(cal.current, { meta: { ...cal.current.meta, forWhom: e.target.value ? [e.target.value] : [] } }));
  $('#ev-resp').addEventListener('change', (e) => update(cal.current, { meta: { ...cal.current.meta, responsible: e.target.value } }));
  $('#ev-loc').addEventListener('click', () => ctx.openMap(cal.current.location));
  $('#ev-share').addEventListener('click', () => {
    $('#dlg-event').close();
    ctx.openShare(toTerminusEvent(cal.current));
  });
  $('#ev-open').addEventListener('click', () => ctx.Native.openEvent({ id: cal.current.id }).catch((e) => ctx.toast(e.message)));
  $('#ee-allday').addEventListener('change', () => syncAllDay());
  $('#ee-save').addEventListener('click', saveEdit);
  $('#ev-delete-one').addEventListener('click', async () => {
    const item = cal.current;
    try {
      if (item.source === 'device') await ctx.Native.cancelOccurrence({ id: item.id, occurrence: item.begin });
      else {
        const ev = ctx.store.getSaved().find((e) => e.id === item.id);
        ev.exdates = [...(ev.exdates || []), item.occurrence];
        ctx.store.addSaved([ev]);
      }
      ctx.republish(item.calendarId);
      $('#dlg-event').close();
      ctx.toast('Dieser Termin fällt aus.');
      refresh();
    } catch (err) {
      ctx.toast(err.message || 'Absagen hat nicht geklappt.');
    }
  });
  $('#ev-delete').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = cal.current.recurring ? 'Ganze Serie löschen?' : 'Wirklich löschen?';
      return;
    }
    const item = cal.current;
    try {
      if (item.source === 'device') await ctx.Native.deleteEvent({ id: item.id });
      else ctx.store.removeSaved(item.id);
      ctx.republish(item.calendarId);
      $('#dlg-event').close();
      ctx.toast('Gelöscht.');
      refresh();
    } catch (err) {
      ctx.toast(err.message || 'Löschen hat nicht geklappt.');
    }
  });
}

function syncAllDay() {
  const allDay = $('#ee-allday').value === '1';
  $('#ee-start').disabled = allDay;
  $('#ee-end').disabled = allDay;
}

function fillEdit(item) {
  $('#ev-edit').open = false;
  $('#ev-edit').hidden = !!item.birthday;
  $('#ee-title').value = item.frist ? `${item.title}` : item.title;
  $('#ee-date').value = item.date;
  $('#ee-allday').value = item.allDay ? '1' : '0';
  $('#ee-start').value = item.start || '';
  $('#ee-end').value = item.end || '';
  $('#ee-loc').value = item.location || '';
  $('#ee-scope').hidden = !item.recurring;
  $('#ee-scope input[value="one"]').checked = true;
  syncAllDay();
}

async function saveEdit() {
  const item = cal.current;
  const allDay = $('#ee-allday').value === '1';
  const title = $('#ee-title').value.trim() || item.title;
  const date = $('#ee-date').value || item.date;
  const start = allDay ? null : $('#ee-start').value || item.start || '10:00';
  let end = allDay ? null : $('#ee-end').value || null;
  if (end && end <= start) end = null;
  const location = $('#ee-loc').value.trim();
  const series = item.recurring && $('#ee-scope input:checked').value === 'all';
  try {
    if (item.source === 'device') {
      const minutes = +ctx.state.settings.defaultMinutes || 60;
      const when = { date, start, end: end || (start ? addMinutesHM(start, minutes) : null), endDate: allDay ? item.endDate : null };
      await ctx.Native.updateEvent({
        id: item.id, title: titleWithDone({ ...item, title }, item.done), location, when,
        ...(item.recurring && !series ? { occurrence: item.begin } : {}),
      });
    } else {
      const ev = ctx.store.getSaved().find((e) => e.id === item.id);
      if (item.recurring && !series) {
        // Einzelner Termin der Serie: aus der Serie nehmen, als eigenen Termin speichern
        ev.exdates = [...(ev.exdates || []), item.occurrence];
        const single = normalizeEvent({ ...ev, id: newId(), title, date, start, end, location, repeat: null, exdates: [] });
        ctx.store.addSaved([ev, single]);
      } else {
        ctx.store.addSaved([normalizeEvent({ ...ev, title, start, end, location, date: series ? ev.date : date })]);
      }
    }
    ctx.republish(item.calendarId);
    $('#dlg-event').close();
    ctx.toast('Gespeichert.');
    refresh();
  } catch (e) {
    ctx.toast(e.message || 'Speichern hat nicht geklappt.');
  }
}

function addMinutesHM(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const t = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function toTerminusEvent(item) {
  return normalizeEvent({
    title: item.title, date: item.date, endDate: item.endDate, start: item.start, end: item.end, location: item.location,
    notes: item.meta.notes, bring: item.meta.bring.map((b) => b.text), cost: item.meta.cost,
    kind: item.frist ? 'frist' : 'termin', forWhom: item.meta.forWhom, responsible: item.meta.responsible,
  });
}

function fillSelect(sel, empty, value) {
  sel.replaceChildren(new Option(empty, ''), ...ctx.store.getFamily().map((m) => new Option(m.name, m.name)));
  sel.value = value || '';
}

function openEvent(item) {
  cal.current = item;
  $('#ev-calendar').textContent = item.birthday ? 'Geburtstag' : item.calendar || '';
  $('#ev-title').textContent = item.title;
  $('#ev-when').textContent = item.frist ? `bis ${fmtDate(item.date)}` : fmtWhen(item);
  $('#ev-done-row').hidden = !item.frist;
  $('#ev-done').checked = item.done;
  $('#ev-loc').hidden = !item.location;
  $('#ev-loc').textContent = item.location ? `Ort: ${item.location} ›` : '';
  $('#ev-notes').textContent = item.meta.notes;
  $('#ev-bring-box').hidden = !item.meta.bring.length;
  $('#ev-bring').replaceChildren(...item.meta.bring.map((b, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<label><input type="checkbox"><span></span></label>';
    const box = $('input', li);
    box.checked = b.done;
    $('span', li).textContent = b.text;
    box.addEventListener('change', () => {
      const bring = item.meta.bring.map((x, k) => (k === i ? { ...x, done: box.checked } : x));
      update(item, { meta: { ...item.meta, bring } });
    });
    return li;
  }));
  const hasFamily = ctx.store.getFamily().length > 0 && !item.birthday;
  $('#ev-family').hidden = !hasFamily;
  if (hasFamily) {
    fillSelect($('#ev-for'), 'alle', item.meta.forWhom[0]);
    fillSelect($('#ev-resp'), 'niemand', item.meta.responsible);
  }
  $('#ev-series').hidden = !item.recurring;
  fillEdit(item);
  const editable = !item.birthday && !item.readOnly;
  $('#ev-delete-one').hidden = !item.recurring || !editable;
  $('#ev-edit').hidden = !editable;
  if (item.readOnly) {
    $('#ev-family').hidden = true;
    for (const box of document.querySelectorAll('#ev-bring input, #ev-done')) box.disabled = true;
  } else for (const box of document.querySelectorAll('#ev-bring input, #ev-done')) box.disabled = false;
  $('#ev-share').hidden = !!item.birthday;
  $('#ev-open').hidden = item.source !== 'device';
  const del = $('#ev-delete');
  del.hidden = !editable;
  del.dataset.confirm = '';
  del.textContent = item.recurring ? 'Ganze Serie löschen' : 'Löschen';
  $('#dlg-event').showModal();
}

async function update(item, { done, meta }) {
  try {
    if (item.source === 'device') {
      const patch = { id: item.id };
      if (done !== undefined) patch.title = titleWithDone(item, done);
      if (meta) patch.description = buildDescription(meta);
      await ctx.Native.updateEvent(patch);
    } else if (item.source === 'local') {
      const ev = ctx.store.getSaved().find((e) => e.id === item.id);
      if (!ev) return;
      if (done !== undefined) ev.completed = done;
      if (meta) {
        ev.forWhom = meta.forWhom;
        ev.responsible = meta.responsible;
        ev.done = meta.bring.filter((b) => b.done).map((b) => b.text);
      }
      ctx.store.addSaved([ev]);
    }
    if (done !== undefined) item.done = done;
    if (meta) item.meta = meta;
    refresh();
  } catch (e) {
    ctx.toast(e.message || 'Ändern hat nicht geklappt.');
  }
}

function refresh() {
  if (!$('#view-calendar').hidden) renderCalendar();
  if (!$('#view-tasks').hidden) renderTasks();
}

/* ---------- Aufgaben ---------- */

async function renderTasks() {
  renderPeopleFilter($('#tasks-people'), tasks.person, (p) => {
    tasks.person = p;
    renderTasks();
  });
  const today = toISO(new Date());
  const items = (await loadItems(addDays(today, -30), addDays(today, 90)))
    .filter((i) => !i.birthday && (i.frist || i.meta.bring.length) && matchesPerson(i, tasks.person))
    .filter((i) => i.frist ? !i.done || i.date >= addDays(today, -14) : (i.endDate || i.date) >= today);
  // Bei Serien nur das nächste Vorkommen
  const seen = new Set();
  const list = items.sort((a, b) => a.date.localeCompare(b.date)).filter((i) => {
    const k = `${i.source}:${i.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const allDone = (i) => (i.frist ? i.done : i.meta.bring.every((b) => b.done));
  const groups = [
    ['overdue', 'Überfällig', list.filter((i) => i.frist && !i.done && i.date < today)],
    ['week', 'Diese Woche', list.filter((i) => !allDone(i) && i.date >= today && i.date <= addDays(today, 7))],
    ['later', 'Später', list.filter((i) => !allDone(i) && i.date > addDays(today, 7))],
    ['done', 'Erledigt', list.filter(allDone)],
  ].filter(([, , g]) => g.length);
  $('#tasks-empty').hidden = groups.length > 0;
  $('#tasks-list').replaceChildren(...groups.map(([cls, label, g]) => {
    const sec = document.createElement('section');
    sec.className = `task-group ${cls}`;
    sec.append(Object.assign(document.createElement('h3'), { textContent: `${label} (${g.length})` }));
    for (const item of g) sec.append(taskCard(item, allDone(item)));
    return sec;
  }));
}

function taskCard(item, done) {
  const div = document.createElement('div');
  div.className = `task${done ? ' done' : ''}`;
  const who = [item.meta.forWhom.length ? `für ${item.meta.forWhom.join(', ')}` : '', item.meta.responsible ? `zuständig: ${item.meta.responsible}` : ''].filter(Boolean).join(' · ');
  const when = item.frist ? `bis ${fmtDate(item.date)}` : `zum ${fmtDate(item.date)}${item.start ? `, ${item.start} Uhr` : ''}`;
  div.innerHTML = '<div class="task-head"><span class="x"><strong></strong><small></small></span></div>';
  $('strong', div).textContent = item.frist ? item.title : `Mitbringen: ${item.title}`;
  $('small', div).textContent = [when, who].filter(Boolean).join(' · ');
  if (item.frist) {
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: item.done, ariaLabel: `${item.title} erledigt` });
    box.addEventListener('change', () => update(item, { done: box.checked }));
    $('.task-head', div).prepend(box);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'checklist';
    item.meta.bring.forEach((b, i) => {
      const li = document.createElement('li');
      li.innerHTML = '<label><input type="checkbox"><span></span></label>';
      const box = $('input', li);
      box.checked = b.done;
      $('span', li).textContent = b.text;
      box.addEventListener('change', () => {
        const bring = item.meta.bring.map((x, k) => (k === i ? { ...x, done: box.checked } : x));
        update(item, { meta: { ...item.meta, bring } });
      });
      ul.append(li);
    });
    div.append(ul);
  }
  return div;
}

/* ---------- Familie ---------- */

function updateFamilyClass() {
  document.documentElement.classList.toggle('has-family', ctx.store.getFamily().length > 0);
}

function bindFamily() {
  $('#sub-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#sub-url').value.trim();
    if (!/^(https?|webcals?):\/\/\S+$/i.test(url)) return ctx.toast('Das sieht nicht wie ein Kalender-Link aus (https://… oder webcal://…).');
    if (ctx.isNative) {
      try {
        await ctx.Native.openSubscription({ url });
        $('#sub-install').hidden = true;
        $('#sub-url').value = '';
      } catch (err) {
        $('#sub-install').hidden = false;
        $('#sub-hint').textContent = 'Installiere zuerst ICSx⁵, dann noch einmal „Abonnieren“ tippen.';
      }
    } else {
      $('#sub-install').hidden = false;
      $('#sub-hint').textContent = 'Am Android-Handy übernimmt das ICSx⁵. Am Computer: im Kalenderprogramm „Kalender abonnieren“ wählen und den Link einfügen. Auf dem iPhone: Einstellungen → Apps → Kalender → Accounts → Account hinzufügen → Andere → Kalenderabo hinzufügen.';
      navigator.clipboard?.writeText(url).then(() => ctx.toast('Link kopiert.'), () => {});
    }
  });
  $('#fm-add').addEventListener('click', () => {
    const name = $('#fm-name').value.trim();
    if (!name) return ctx.toast('Gib einen Namen ein.');
    const family = ctx.store.getFamily();
    if (family.some((m) => m.name.toLowerCase() === name.toLowerCase())) return ctx.toast(`${name} ist schon eingetragen.`);
    ctx.store.setFamily([...family, { id: newId(), name, role: $('#fm-role').value }]);
    $('#fm-name').value = '';
    updateFamilyClass();
    renderFamily();
  });
  $('#family-cal').addEventListener('change', (e) => {
    const s = { ...ctx.state.settings, familyCalendarId: e.target.value, calendarId: e.target.value, calendarName: e.target.selectedOptions[0]?.textContent || '' };
    ctx.saveSettings(s);
    ctx.toast(e.target.value ? 'Neue Termine landen jetzt im Familienkalender.' : 'Neue Termine landen im Hauptkalender.');
    renderFamilyHint();
  });
  $('#family-send').addEventListener('click', () => {
    const text = `Wir nutzen ab jetzt einen gemeinsamen Familienkalender, ohne Big Tech. Damit unsere Daten unsere bleiben.

So kommst du dran:
Android: App „DAVx⁵“ installieren, mit den Zugangsdaten anmelden, die ich dir gebe, und den Kalender „Familie“ anhaken. Dazu die App „Terminus“, damit du Zettel fotografieren und Häkchen setzen kannst.
iPhone: Einstellungen → Apps → Kalender → Accounts → Account hinzufügen → Andere → CalDAV-Account. Server, Name und Passwort trage ich dir ein.

Danach siehst du alle Familientermine in deinem Kalender.`;
    if (ctx.isNative) ctx.Native.shareText({ text, title: 'Anleitung senden' }).catch(() => ctx.toast('Keine App zum Teilen gefunden.'));
    else if (navigator.share) navigator.share({ text }).catch(() => {});
    else navigator.clipboard?.writeText(text).then(() => ctx.toast('Anleitung kopiert.'), () => ctx.toast('Kopieren geht hier nicht.'));
  });
}

let calendarsCache = [];

async function deviceCalendars() {
  try {
    const { granted } = await ctx.Native.findEvents({ from: 0, to: 0 });
    if (!granted) return null;
    calendarsCache = (await ctx.Native.listCalendars()).calendars;
    return calendarsCache;
  } catch {
    return null;
  }
}

const accountLabel = (c) => (c.accountType === DAVX ? 'DAVx⁵' : c.accountType === 'com.google' ? 'Google' : c.accountType === 'LOCAL' ? 'nur auf dem Handy' : c.account || '');

async function renderFamily() {
  const family = ctx.store.getFamily();
  $('#family-list').replaceChildren(...family.map((m) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="avatar" aria-hidden="true"></span><span class="name"></span><small></small>';
    $('.avatar', li).textContent = m.name.slice(0, 2).toUpperCase();
    $('.name', li).textContent = m.name;
    $('small', li).textContent = m.role === 'kind' ? 'Kind' : 'Erwachsen';
    const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small icon', textContent: '✕', ariaLabel: `${m.name} entfernen` });
    del.addEventListener('click', () => {
      ctx.store.setFamily(ctx.store.getFamily().filter((x) => x.id !== m.id));
      updateFamilyClass();
      renderFamily();
    });
    li.append(del);
    return li;
  }));
  if (ctx.isNative) {
    const cals = await deviceCalendars();
    const sel = $('#family-cal');
    if (cals) {
      sel.replaceChildren(new Option('noch nicht gewählt', ''), ...cals.map((c) => new Option(`${c.name} (${accountLabel(c)})`, c.id)));
      sel.value = ctx.state.settings.familyCalendarId || '';
    }
    sel.disabled = !cals;
    renderFamilyHint(cals);
  }
}

function renderFamilyHint(cals = calendarsCache) {
  const hint = $('#family-cal-hint');
  if (!cals) {
    hint.textContent = 'Gib Terminus im Kalender-Bereich Zugriff auf den Kalender, dann erscheinen hier deine Kalender.';
    return;
  }
  const chosen = cals.find((c) => c.id === ctx.state.settings.familyCalendarId);
  if (!chosen) hint.textContent = cals.some((c) => c.accountType === DAVX) ? 'Wähle den gemeinsamen Kalender aus DAVx⁵.' : 'Noch kein DAVx⁵-Kalender gefunden. Richte zuerst DAVx⁵ ein (siehe Umzugshelfer).';
  else if (chosen.accountType !== DAVX) hint.textContent = `„${chosen.name}“ wird nicht über DAVx⁵ geteilt. Für einen Familienkalender ohne Google wähle einen DAVx⁵-Kalender.`;
  else hint.textContent = `Neue Termine landen in „${chosen.name}“ und sind für alle sichtbar, die diesen Kalender abonniert haben.`;
}

/* ---------- Umzugshelfer ---------- */

function bindMigrate() {
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importFile(file);
  });
}

async function renderMigrate() {
  if (!ctx.isNative) {
    $('#migrate-status').hidden = true;
    return;
  }
  const cals = await deviceCalendars();
  const status = $('#migrate-status');
  status.hidden = false;
  if (!cals) {
    status.textContent = 'Tipp: Gib Terminus im Kalender-Bereich Zugriff auf den Kalender, dann zeigt der Helfer hier deinen Stand.';
    return;
  }
  const dav = cals.filter((c) => c.accountType === DAVX);
  const google = cals.filter((c) => c.accountType === 'com.google');
  status.textContent = [
    dav.length ? `✓ ${dav.length} Kalender über DAVx⁵ verbunden.` : 'Noch kein Kalender über DAVx⁵ verbunden.',
    google.length ? `${google.length} Kalender ${google.length === 1 ? 'läuft' : 'laufen'} noch über Google.` : '✓ Kein Google-Kalender mehr aktiv.',
  ].join(' ');
  const sel = $('#import-cal');
  sel.replaceChildren(new Option('Hauptkalender des Geräts', ''), ...cals.map((c) => new Option(`${c.name} (${accountLabel(c)})`, c.id)));
  sel.value = ctx.state.settings.familyCalendarId || dav[0]?.id || '';
}

async function importFile(file) {
  const result = $('#import-result');
  const progress = $('#import-progress');
  result.textContent = 'Lese die Datei …';
  try {
    let texts;
    if (/\.zip$/i.test(file.name) || file.type.includes('zip')) texts = (await readZip(await file.arrayBuffer())).map((f) => f.text);
    else texts = [await file.text()];
    const parsed = texts.map(parseICS);
    const events = parsed.flatMap((p) => p.events);
    const skipped = parsed.reduce((n, p) => n + p.skipped, 0);
    if (!events.length) {
      result.textContent = 'In der Datei wurden keine Termine gefunden.';
      return;
    }
    progress.hidden = false;
    progress.value = 0;
    let done = 0;
    if (ctx.isNative) {
      const calendarId = $('#import-cal').value || undefined;
      for (let i = 0; i < events.length; i += 100) {
        const chunk = events.slice(i, i + 100).map((e) => ({ ...e, summary: e.title, reminders: [], defaultMinutes: 60 }));
        done += (await ctx.Native.insertEvents({ events: chunk, calendarId })).count;
        progress.value = Math.min(1, (i + 100) / events.length);
      }
    } else {
      const evs = events.map((e) => normalizeEvent({ ...e, notes: e.description, repeat: simpleRepeat(e.rrule) })).filter(Boolean);
      ctx.store.addSaved(evs);
      done = evs.length;
      progress.value = 1;
    }
    result.textContent = `${done} Termine importiert${skipped ? `, ${skipped} übersprungen (abgesagt oder geänderte Einzeltermine einer Serie)` : ''}. Bitte jede Datei nur einmal importieren.`;
  } catch (e) {
    result.textContent = `Import fehlgeschlagen: ${e.message || 'unbekannter Fehler'}`;
  } finally {
    progress.hidden = true;
  }
}

