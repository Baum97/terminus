// Oberfläche für Terminfindung („Wann können alle?“) und Zusagen zu Einladungen.
import { newPollId, encodePoll, decodePoll, encodeAnswer, decodeAnswer, tally, eventKey, encodeRsvp, decodeRsvp, RSVP, YES, MAYBE, NO } from './umfrage.js';
import { fmtDate, addDays, toISO } from './dates.js';

const $ = (sel, root = document) => root.querySelector(sel);
const POLLS = 'terminus.umfragen';
const RSVPS = 'terminus.zusagen';
const VOTE_LABEL = { [YES]: '✓ passt', [MAYBE]: '? wenn nötig', [NO]: '✗ geht nicht' };
let ctx;

const load = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
};
const save = (key, v) => {
  try {
    localStorage.setItem(key, JSON.stringify(v || {}));
  } catch {
    // Speicher voll oder gesperrt
  }
};
export const getPolls = () => load(POLLS);
export const getRsvps = () => load(RSVPS);

const optionText = (o) => `${fmtDate(o.date, false)}${o.start ? `, ${o.start}${o.end ? `–${o.end}` : ''} Uhr` : ', ganztägig'}`;

async function send(text, title) {
  try {
    if (ctx.isNative) await ctx.Native.shareText({ text, title });
    else if (navigator.share) await navigator.share({ text });
    else {
      await navigator.clipboard.writeText(text);
      ctx.toast('Text kopiert. Füge ihn in eine Nachricht ein.');
    }
  } catch {
    // abgebrochen
  }
}

export function initUmfrage(c) {
  ctx = c;
  $('#poll-new').addEventListener('click', () => openCreate());
  $('#pc-add').addEventListener('click', () => addOptionRow());
  $('#pc-send').addEventListener('click', createPoll);
  renderPollList();
}

/* ---------- Abstimmung anlegen ---------- */

function addOptionRow(o = {}) {
  const li = document.createElement('li');
  li.className = 'pc-opt';
  li.innerHTML = `<input type="date" aria-label="Tag" required><input type="time" aria-label="Beginn"><input type="time" aria-label="Ende">
    <button class="btn ghost small icon" type="button" aria-label="Vorschlag entfernen">✕</button>`;
  const [d, s, e] = li.querySelectorAll('input');
  d.value = o.date || '';
  s.value = o.start || '';
  e.value = o.end || '';
  $('button', li).addEventListener('click', () => li.remove());
  $('#pc-options').append(li);
}

function openCreate(prefill = {}) {
  $('#pc-title').value = prefill.title || '';
  $('#pc-location').value = prefill.location || '';
  $('#pc-options').replaceChildren();
  const base = prefill.date || addDays(toISO(new Date()), 7);
  for (let i = 0; i < 3; i++) addOptionRow({ date: addDays(base, i), start: prefill.start || '19:00', end: prefill.end || '' });
  $('#pc-msg').hidden = true;
  $('#dlg-poll').showModal();
}

async function createPoll() {
  const title = $('#pc-title').value.trim();
  const options = [...document.querySelectorAll('#pc-options .pc-opt')].map((li) => {
    const [d, s, e] = li.querySelectorAll('input');
    return { date: d.value, start: s.value || null, end: s.value && e.value ? e.value : null };
  }).filter((o) => o.date);
  const msg = $('#pc-msg');
  if (!title || options.length < 2) {
    Object.assign(msg, { hidden: false, textContent: !title ? 'Worum geht es? Gib einen Titel ein.' : 'Mindestens zwei Vorschläge, sonst gibt es nichts abzustimmen.' });
    return;
  }
  const poll = { id: newPollId(), title, location: $('#pc-location').value.trim(), by: ctx.state.settings.ownerName || '', options };
  const polls = getPolls();
  polls[poll.id] = { ...poll, answers: {}, created: Date.now() };
  save(POLLS, polls);
  $('#dlg-poll').close();
  renderPollList();
  const link = `${ctx.publicUrl()}#u=${encodePoll(poll)}`;
  await send(`🗳️ Wann passt es euch? „${title}“${poll.location ? ` (${poll.location})` : ''}\n${options.map((o) => `• ${optionText(o)}`).join('\n')}\n\nAntippen, ankreuzen, Antwort zurückschicken:\n${link}`, 'Abstimmung senden');
  showResults(poll.id);
}

function renderPollList() {
  const polls = Object.values(getPolls()).sort((a, b) => b.created - a.created);
  const ul = $('#poll-list');
  ul.hidden = !polls.length;
  ul.replaceChildren(...polls.map((p) => {
    const li = document.createElement('li');
    const n = Object.keys(p.answers || {}).length;
    li.innerHTML = '<span class="x"><strong></strong><small></small></span>';
    $('strong', li).textContent = p.title;
    $('small', li).textContent = p.closed ? `Festgelegt: ${optionText(p.options[p.closed.index])}` : `${n} ${n === 1 ? 'Antwort' : 'Antworten'} · ${p.options.length} Vorschläge`;
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Ansehen' });
    b.addEventListener('click', () => showResults(p.id));
    li.append(b);
    return li;
  }));
}

/* ---------- Teilnehmen ---------- */

function page({ eyebrow, title, sub }) {
  ctx.show('umfrage');
  $('#uf-eyebrow').textContent = eyebrow;
  $('#uf-title').textContent = title;
  $('#uf-sub').textContent = sub || '';
  $('#uf-msg').hidden = true;
  return $('#uf-body');
}

function message(text, bad = false) {
  const m = $('#uf-msg');
  Object.assign(m, { textContent: text, hidden: !text });
  m.classList.toggle('bad', bad);
}

export function handlePollCode(code) {
  const poll = decodePoll(code);
  if (!poll) {
    ctx.toast('Dieser Abstimmungs-Link ist unvollständig.');
    return false;
  }
  // Eigene Abstimmung: gleich die Ergebnisse zeigen
  if (getPolls()[poll.id]) return showResults(poll.id), true;
  const body = page({ eyebrow: poll.by ? `${poll.by} fragt: Wann passt es dir?` : 'Wann passt es dir?', title: poll.title, sub: poll.location ? `📍 ${poll.location}` : '' });
  const votes = poll.options.map(() => YES);
  const ul = document.createElement('ul');
  ul.className = 'vote-list';
  poll.options.forEach((o, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span class="opt"></span><div class="vote" role="group"></div>';
    $('.opt', li).textContent = optionText(o);
    for (const v of [YES, MAYBE, NO]) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `vote-btn v${v}`, textContent: VOTE_LABEL[v] });
      b.setAttribute('aria-pressed', String(v === YES));
      b.addEventListener('click', () => {
        votes[i] = v;
        for (const x of li.querySelectorAll('.vote-btn')) x.setAttribute('aria-pressed', String(x === b));
      });
      $('.vote', li).append(b);
    }
    ul.append(li);
  });
  const name = Object.assign(document.createElement('label'), { className: 'field' });
  name.innerHTML = '<span>Dein Name</span><input id="uf-name" autocomplete="given-name" maxlength="40">';
  $('input', name).value = ctx.state.settings.ownerName || '';
  const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'btn primary', textContent: 'Antwort zurückschicken' });
  btn.addEventListener('click', async () => {
    const n = $('#uf-name').value.trim();
    if (!n) return message('Schreib deinen Namen dazu, damit man weiß, von wem die Antwort ist.', true);
    const link = `${ctx.publicUrl()}#ua=${encodeAnswer({ id: poll.id, name: n, votes })}`;
    const lines = poll.options.map((o, i) => `${votes[i] === YES ? '✓' : votes[i] === MAYBE ? '?' : '✗'} ${optionText(o)}`);
    await send(`🗳️ ${n} zu „${poll.title}“:\n${lines.join('\n')}\n\nFür ${poll.by || 'die Abstimmung'} zum Eintragen:\n${link}`, 'Antwort senden');
    message('✓ Antwort erstellt. Schick sie an die Person, die gefragt hat (oder in die Gruppe). Wenn der Termin feststeht, bekommst du ihn als Link.');
  });
  body.replaceChildren(ul, name, btn);
  return true;
}

/* ---------- Ergebnisse (Organisator) ---------- */

export function handleAnswerCode(code) {
  const a = decodeAnswer(code);
  if (!a) {
    ctx.toast('Diese Antwort ist unvollständig.');
    return false;
  }
  const polls = getPolls();
  const poll = polls[a.id];
  if (!poll) {
    page({ eyebrow: 'Antwort auf eine Abstimmung', title: 'Nicht deine Abstimmung' });
    $('#uf-body').replaceChildren();
    message('Diese Antwort gehört zu einer Abstimmung, die auf einem anderen Gerät erstellt wurde. Nur dort kann sie eingetragen werden.', true);
    return true;
  }
  poll.answers = { ...poll.answers, [a.name]: a.votes };
  save(POLLS, polls);
  renderPollList();
  showResults(a.id);
  message(`✓ Antwort von ${a.name} eingetragen.`);
  return true;
}

function showResults(id) {
  const poll = getPolls()[id];
  if (!poll) return;
  const t = tally(poll, poll.answers);
  const body = page({ eyebrow: 'Deine Abstimmung', title: poll.title, sub: `${t.people} ${t.people === 1 ? 'Antwort' : 'Antworten'}${poll.location ? ` · 📍 ${poll.location}` : ''}` });
  const ul = document.createElement('ul');
  ul.className = 'vote-list results';
  for (const r of t.rows) {
    const li = document.createElement('li');
    li.classList.toggle('best', t.best.includes(r.index));
    li.classList.toggle('chosen', poll.closed?.index === r.index);
    li.innerHTML = '<span class="opt"></span><span class="count"></span><small class="names"></small>';
    $('.opt', li).textContent = optionText(r);
    $('.count', li).textContent = `✓ ${r.yes.length}${r.maybe.length ? ` · ? ${r.maybe.length}` : ''}${r.no.length ? ` · ✗ ${r.no.length}` : ''}`;
    $('.names', li).textContent = [r.yes.length && `passt: ${r.yes.join(', ')}`, r.maybe.length && `wenn nötig: ${r.maybe.join(', ')}`, r.no.length && `geht nicht: ${r.no.join(', ')}`].filter(Boolean).join(' · ');
    const pick = Object.assign(document.createElement('button'), { type: 'button', className: `btn small${t.best.includes(r.index) ? ' primary' : ''}`, textContent: 'Diesen Termin nehmen' });
    pick.addEventListener('click', () => finalize(poll, r.index));
    li.append(pick);
    ul.append(li);
  }
  const again = Object.assign(document.createElement('button'), { type: 'button', className: 'btn small', textContent: 'Abstimmung nochmal senden' });
  again.addEventListener('click', () => send(`🗳️ Wann passt es euch? „${poll.title}“\n\n${ctx.publicUrl()}#u=${encodePoll(poll)}`, 'Abstimmung senden'));
  const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn ghost small danger', textContent: 'Abstimmung löschen' });
  del.addEventListener('click', () => {
    if (del.dataset.confirm !== '1') {
      del.dataset.confirm = '1';
      del.textContent = 'Wirklich löschen?';
      return;
    }
    const polls = getPolls();
    delete polls[id];
    save(POLLS, polls);
    renderPollList();
    ctx.show('family');
  });
  const hint = Object.assign(document.createElement('p'), { className: 'hint', textContent: 'Antworten kommen als Link zurück. Tippe jeden an, dann steht er hier. Wer zweimal antwortet, wird überschrieben.' });
  const row = Object.assign(document.createElement('div'), { className: 'row' });
  row.append(again, del);
  body.replaceChildren(ul, hint, row);
}

// Termin festlegen: wie ein erkannter Termin prüfen, eintragen und an alle schicken
function finalize(poll, index) {
  const polls = getPolls();
  polls[poll.id] = { ...poll, closed: { index, at: Date.now() } };
  save(POLLS, polls);
  renderPollList();
  const o = poll.options[index];
  const guests = Object.entries(poll.answers || {}).filter(([, v]) => v[index] !== NO).map(([n]) => n);
  ctx.reviewEvent({ title: poll.title, date: o.date, start: o.start, end: o.end, location: poll.location, notes: guests.length ? `Dabei: ${guests.join(', ')}` : '' }, 'Ergebnis der Abstimmung');
}

/* ---------- Zusagen zu Einladungen ---------- */

// Auf der Empfängerseite eines Termins (#t=): „Ich komme / vielleicht / nicht“
export function rsvpButtons(ev, from = '') {
  const box = document.createElement('div');
  box.className = 'rsvp';
  box.innerHTML = '<p class="rsvp-q">Kommst du?</p><div class="row"></div><label class="field"><span>Dein Name</span><input maxlength="40" autocomplete="given-name"></label><p class="hint"></p>';
  $('input', box).value = ctx.state.settings.ownerName || '';
  for (const [status, label] of [['ja', 'Ich komme'], ['vielleicht', 'Vielleicht'], ['nein', 'Ich kann nicht']]) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: `btn${status === 'ja' ? ' primary' : ''}`, textContent: label });
    b.addEventListener('click', async () => {
      const name = $('input', box).value.trim();
      if (!name) {
        $('.hint', box).textContent = 'Schreib deinen Namen dazu.';
        return;
      }
      const link = `${ctx.publicUrl()}#z=${encodeRsvp({ ev, name, status })}`;
      const word = { ja: 'komme', vielleicht: 'komme vielleicht', nein: 'kann leider nicht' }[status];
      await send(`${status === 'ja' ? '👍' : status === 'nein' ? '👎' : '🤔'} ${name}: Ich ${word} – „${ev.title}“ am ${fmtDate(ev.date, false)}\n\n${from ? `Für ${from} zum Eintragen` : 'Zum Eintragen'}:\n${link}`, 'Antwort senden');
      $('.hint', box).textContent = '✓ Antwort erstellt. Schick sie an die Person, die eingeladen hat.';
    });
    $('.row', box).append(b);
  }
  return box;
}

export function handleRsvpCode(code) {
  const r = decodeRsvp(code);
  if (!r) {
    ctx.toast('Diese Zusage ist unvollständig.');
    return false;
  }
  const all = getRsvps();
  const entry = all[r.key] || { title: r.title, date: r.date, start: r.start, answers: {} };
  entry.answers[r.name] = { status: r.status, at: Date.now() };
  all[r.key] = entry;
  save(RSVPS, all);
  showRsvp(r.key);
  message(`✓ ${r.name} ${RSVP[r.status]}. Eingetragen.`);
  return true;
}

function showRsvp(key) {
  const e = getRsvps()[key];
  const body = page({ eyebrow: 'Zusagen', title: e.title, sub: `${fmtDate(e.date)}${e.start ? `, ${e.start} Uhr` : ''}` });
  body.replaceChildren(rsvpList(e));
}

function rsvpList(e) {
  const ul = document.createElement('ul');
  ul.className = 'rsvp-list';
  const order = { ja: 0, vielleicht: 1, nein: 2 };
  for (const [name, a] of Object.entries(e.answers).sort((x, y) => order[x[1].status] - order[y[1].status])) {
    const li = document.createElement('li');
    li.textContent = `${a.status === 'ja' ? '✓' : a.status === 'nein' ? '✗' : '?'} ${name} ${RSVP[a.status]}`;
    li.className = `rsvp-${a.status}`;
    ul.append(li);
  }
  return ul;
}

// Für die Termin-Ansicht im Kalender: "3 kommen, 1 vielleicht, 1 nicht"
export function rsvpSummary(ev) {
  const e = getRsvps()[eventKey(ev)];
  if (!e) return '';
  const n = { ja: 0, vielleicht: 0, nein: 0 };
  for (const a of Object.values(e.answers)) n[a.status]++;
  return [n.ja && `${n.ja} ${n.ja === 1 ? 'kommt' : 'kommen'}`, n.vielleicht && `${n.vielleicht} vielleicht`, n.nein && `${n.nein} ${n.nein === 1 ? 'kommt' : 'kommen'} nicht`].filter(Boolean).join(', ')
    + ` (${Object.keys(e.answers).join(', ')})`;
}

export { openCreate as openPollCreate };
