// Ämtchenplan im Familien-Bereich: Aufgabe, Rhythmus, wer macht mit → Serien zum Prüfen und Eintragen.
import { rotationEvents } from './aemtchen.js';
import { toISO, addDays } from './dates.js';

const $ = (sel, root = document) => root.querySelector(sel);
let ctx;

export function initAemtchen(c) {
  ctx = c;
  $('#am-form').addEventListener('toggle', () => $('#am-form').open && renderMembers());
  $('#am-create').addEventListener('click', create);
}

function renderMembers() {
  const fam = ctx.store.getFamily().map((m) => m.name);
  $('#am-members').replaceChildren(...fam.map((n) => {
    const l = document.createElement('label');
    l.className = 'check';
    l.innerHTML = '<input type="checkbox" checked> <span></span>';
    $('input', l).value = n;
    $('span', l).textContent = n;
    return l;
  }));
  $('#am-others').placeholder = fam.length ? 'weitere, mit Komma' : 'Namen mit Komma: Ben, Mia, Jo';
  if (!$('#am-start').value) $('#am-start').value = addDays(toISO(new Date()), 1);
}

function create() {
  const members = [
    ...[...document.querySelectorAll('#am-members input:checked')].map((i) => i.value),
    ...$('#am-others').value.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
  ];
  const task = $('#am-task').value.trim();
  if (!task) return ctx.toast('Welche Aufgabe? z. B. „Müll rausbringen“.');
  if (!members.length) return ctx.toast('Wer macht mit? Mindestens eine Person.');
  const events = rotationEvents({ task, members, freq: $('#am-freq').value, start: $('#am-start').value, time: $('#am-time').value || null });
  ctx.reviewEvents(events, `Ämtchenplan: ${task}`);
}
