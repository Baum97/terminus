// Zurück-Taste (Android) und Browser-Verlauf.
// Reihenfolge: offenes Fenster schließen → vorige Ansicht → auf der Startseite die App in den Hintergrund.
// Jede Ansicht ist ein Verlaufseintrag; offene Fenster bekommen einen zusätzlichen Eintrag als Puffer.
let o;
let current = null;
let restoring = false;
let guards = 0; // Einträge für offene Fenster über der aktuellen Ansicht
let ignore = 0; // eigene history.back()-Aufrufe, deren popstate nichts tun soll
const TABS = new Set(['home', 'calendar', 'tasks', 'wallet', 'family']);
const same = (a, b) => a && b && a.view === b.view && (a.hub || null) === (b.hub || null);

// opts: { native, restore(state), leave(), locked() }
export function initNav(opts) {
  o = opts;
  window.addEventListener('popstate', onPop);
  // Jedes Fenster (<dialog>) lässt sich mit „Zurück“ schließen
  const showModal = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    showModal.call(this);
    history.pushState({ ...current, dlg: true }, '');
    guards++;
    this.addEventListener('close', () => {
      if (this.dataset.closedByBack) {
        delete this.dataset.closedByBack;
        return;
      }
      if (guards > 0) {
        guards--;
        ignore++;
        history.back();
      }
    }, { once: true });
  };
}

export const isRestoring = () => restoring;
export const currentNav = () => current;

// Von show() aufgerufen: neuen Eintrag anlegen oder den aktuellen ersetzen
export function navTo(state, { tab = false, replace = false } = {}) {
  if (restoring) {
    current = state;
    return;
  }
  const url = location.pathname + location.search;
  if (!current) {
    if (o.native) {
      history.replaceState({ root: true }, '');
      history.pushState(state, '');
    } else history.replaceState(state, '');
    current = state;
    return;
  }
  if (same(current, state)) return;
  // Laufende Erkennung wird von ihrem Ergebnis ersetzt; Tabs untereinander ersetzen sich (zurück führt zum Start)
  const swap = replace || current.view === 'busy' || (tab && TABS.has(current.view) && current.view !== 'home');
  // under: Ansicht darunter im Verlauf (für den Tab „Erfassen“: zurück statt neuer Eintrag)
  const next = { ...state, under: swap ? current.under : current.view };
  if (swap) history.replaceState(next, '', url);
  else history.pushState(next, '', url);
  current = next;
}

// Zurück zur Startseite per Tab: lieber den Verlauf zurückgehen als einen neuen Eintrag anlegen
export function canGoBackTo(view) {
  return view === 'home' && !!current && current.view !== 'home' && current.under === 'home' && guards === 0;
}

function onPop(e) {
  if (ignore > 0) {
    ignore--;
    return;
  }
  const dlg = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (dlg) {
    guards = Math.max(0, guards - 1);
    dlg.dataset.closedByBack = '1';
    dlg.close();
    if (!e.state?.dlg && !same(e.state, current)) history.pushState(current, '');
    return;
  }
  guards = 0;
  if (o.locked()) {
    history.pushState(current, '');
    return;
  }
  const st = e.state;
  if (!st || st.root) {
    history.pushState(current, '');
    o.leave();
    return;
  }
  if (st.dlg) {
    // Puffer eines Fensters, das schon zu ist: einfach weiter zurück
    history.back();
    return;
  }
  const from = current;
  restoring = true;
  try {
    current = st;
    o.restore(st, from);
  } finally {
    restoring = false;
  }
}
