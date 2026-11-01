// Brückentage-Planer: Vorschläge fürs eingestellte Bundesland, eintragen oder teilen.
import { bridgeDays } from './bruecken.js';
import { STATES } from './holidays.js';
import { fmtDate, toISO } from './dates.js';

const $ = (sel, root = document) => root.querySelector(sel);
let ctx;
let year = new Date().getFullYear();

export function initBruecken(c) {
  ctx = c;
  $('#br-prev').addEventListener('click', () => render(year - 1));
  $('#br-next').addEventListener('click', () => render(year + 1));
  $('#br-share').addEventListener('click', share);
}

export function openBruecken() {
  ctx.show('bruecken');
  // Ab Herbst lohnt der Blick aufs nächste Jahr
  render(new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear());
}

const range = (o) => `${fmtDate(o.start, false)} bis ${fmtDate(o.end)}`;

function list() {
  const st = ctx.state.settings.state || '';
  return bridgeDays(year, st, { from: toISO(new Date()) });
}

function render(y) {
  year = y;
  const st = ctx.state.settings.state;
  $('#br-year').textContent = year;
  $('#br-state').textContent = st ? `Feiertage in ${STATES[st] || st}` : 'Nur bundesweite Feiertage. Stell in den Einstellungen dein Bundesland ein, dann kommen die regionalen dazu.';
  const items = list();
  $('#br-empty').hidden = !!items.length;
  $('#br-list').replaceChildren(...items.map((o) => {
    const li = document.createElement('li');
    li.innerHTML = '<p class="br-gain"><strong></strong><span></span></p><p class="br-when"></p><p class="hint"></p><button class="btn small" type="button">Als Urlaub eintragen</button>';
    $('strong', li).textContent = `${o.vacation.length} ${o.vacation.length === 1 ? 'Urlaubstag' : 'Urlaubstage'} → ${o.free} Tage frei`;
    $('span', li).textContent = o.alt ? ' · längere Variante' : '';
    $('.br-when', li).textContent = range(o);
    $('.hint', li).textContent = `${o.holidays.join(', ')} · Urlaub nehmen: ${o.vacation.map((d) => fmtDate(d, false)).join(', ')}`;
    $('button', li).addEventListener('click', () => ctx.reviewEvents([{ title: 'Urlaub', date: o.start, endDate: o.end, notes: `Brückentage: ${o.vacation.length} Urlaubstage, ${o.free} Tage frei (${o.holidays.join(', ')})` }], 'Brückentage'));
    return li;
  }));
}

function share() {
  const items = list();
  const text = `🌴 Brückentage ${year}${ctx.state.settings.state ? ` (${STATES[ctx.state.settings.state]})` : ''}:\n${items.map((o) => `• ${o.vacation.length} Urlaub → ${o.free} frei: ${range(o)}`).join('\n')}\n\nAusgerechnet mit Terminus: ${ctx.publicUrl()}`;
  ctx.shareText(text, 'Brückentage teilen');
}
