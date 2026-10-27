// Einrichtungsassistent: jeder Schritt ist eine Befehls-Karte mit Erklärung, einem Code-Fenster,
// das genau zeigt, was passiert, und einem Knopf "Ausführen". Terminus erkennt selbst, was erledigt ist.
import { STATES } from './holidays.js';
import { DAV_PROVIDERS, providerById, davUrls, APPS, storeLink, stepsFor, progress, encodeJoin, decodeJoin, joinWebLink, joinAppLink, mobileconfig } from './setupdata.js';
import { newId } from './events.js';

const $ = (sel, root = document) => root.querySelector(sel);
const DAVX = 'at.bitfire.davdroid';
const SELF = 'io.github.baum97.terminus';

let ctx;
// Nur im Speicher, nie gespeichert: das Passwort für die Übergabe an DAVx⁵
const mem = { password: '', books: null, status: null, open: null, counts: null };

export function initSetup(c) {
  ctx = c;
  for (const b of document.querySelectorAll('#view-setup [data-goal]')) {
    b.addEventListener('click', () => {
      ctx.store.setSetup({ ...ctx.store.getSetup(), goal: b.dataset.goal });
      mem.open = null;
      renderSetup();
    });
  }
  $('#setup-close').addEventListener('click', () => {
    ctx.store.setSetup({ ...ctx.store.getSetup(), later: true });
    ctx.show('home');
  });
  $('#invite-family-share').addEventListener('click', shareInvite);
  $('#invite-family-copy').addEventListener('click', () => copy($('#invite-family-link').textContent));
  $('#invite-family-member').addEventListener('change', drawInvite);
  // Zurück aus Play Store, DAVx⁵ oder Einstellungen: Stand neu prüfen
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('#view-setup').hidden) renderSetup();
    if (!document.hidden && !$('#view-join').hidden && joinState.info) renderJoin(joinState.info);
  });
}

export function setupNeeded() {
  const s = ctx.store.getSetup();
  return ctx.isNative && !s.goal && !s.later;
}

export async function setupSummary() {
  const s = ctx.store.getSetup();
  if (!s.goal) return null;
  const done = await computeDone(s);
  return progress(stepsFor(s.goal), done);
}

/* ---------- Status ---------- */

async function deviceInfo() {
  if (!ctx.isNative) return { calendar: false, cals: [], installed: {}, batteryFree: {}, widgets: 0 };
  const pkgs = [...new Set(APPS.flatMap((a) => [a.pkg, ...(a.also || [])]).concat(['org.fdroid.fdroid']))];
  const [dev, inst] = await Promise.all([
    ctx.Native.deviceStatus({ packages: [SELF, DAVX] }).catch(() => ({})),
    ctx.Native.isInstalled({ packages: pkgs }).catch(() => ({ installed: {} })),
  ]);
  let cals = [];
  if (dev.calendar) cals = (await ctx.Native.listCalendars().catch(() => ({ calendars: [] }))).calendars || [];
  return { ...dev, cals, installed: inst.installed || {} };
}

const isInstalled = (st, app) => [app.pkg, ...(app.also || [])].some((p) => st.installed[p]);
const davCals = (st) => st.cals.filter((c) => c.accountType === 'bitfire.at.davdroid');
const googleCals = (st) => st.cals.filter((c) => c.accountType === 'com.google');

async function computeDone(s, st) {
  st = st || (mem.status = await deviceInfo());
  const set = ctx.state.settings;
  return {
    calendar: !!st.calendar,
    state: !!set.state,
    provider: !!s.loginOk,
    davx5: !!st.installed[DAVX],
    connect: davCals(st).length > 0,
    familycal: !!set.familyCalendarId && st.cals.some((c) => c.id === set.familyCalendarId),
    movecal: !!s.movedCal || (st.calendar && googleCals(st).length === 0),
    movecontacts: !!s.movedContacts || s.noGoogleContacts === true,
    googleoff: !!s.googleOff || (st.calendar && googleCals(st).length === 0),
    members: ctx.store.getFamily().length > 0 && !!s.invited,
    battery: !!st.batteryFree?.[SELF] && (!st.installed[DAVX] || !!st.batteryFree?.[DAVX]),
    brief: !!set.brief,
    widget: (st.widgets || 0) > 0,
    apps: false,
  };
}

/* ---------- Darstellung ---------- */

export async function renderSetup() {
  const s = ctx.store.getSetup();
  for (const b of document.querySelectorAll('#view-setup [data-goal]')) b.setAttribute('aria-pressed', String(b.dataset.goal === s.goal));
  $('#setup-web-note').hidden = ctx.isNative;
  const list = $('#setup-steps');
  if (!s.goal) {
    list.replaceChildren();
    $('#setup-progress-text').textContent = 'Wähle zuerst, was du vorhast. Du kannst es jederzeit ändern.';
    $('#setup-progress').value = 0;
    return;
  }
  const st = (mem.status = await deviceInfo());
  const done = await computeDone(s, st);
  const steps = stepsFor(s.goal);
  const p = progress(steps, done);
  $('#setup-progress-text').textContent = p.next ? `${p.done} von ${p.total} erledigt` : `Fertig: alle ${p.total} Schritte erledigt.`;
  $('#setup-progress').value = p.total ? p.done / p.total : 1;
  const open = mem.open && steps.some((x) => x.id === mem.open && !done[x.id]) ? mem.open : p.next;
  list.replaceChildren(...steps.map((step, i) => card(step, i + 1, done[step.id], step.id === open, st, s)));
}

function card(step, n, done, open, st, s) {
  const li = document.createElement('li');
  li.className = `step${done ? ' done' : ''}${step.optional ? ' optional' : ''}`;
  const det = document.createElement('details');
  det.open = open;
  det.addEventListener('toggle', () => det.open && (mem.open = step.id));
  const sum = document.createElement('summary');
  sum.innerHTML = '<span class="num" aria-hidden="true"></span><span class="t"></span><span class="state"></span>';
  $('.num', sum).textContent = done ? '✓' : n;
  $('.t', sum).textContent = step.title;
  $('.state', sum).textContent = done ? 'erledigt' : step.optional ? 'optional' : '';
  det.append(sum);
  const body = document.createElement('div');
  body.className = 'step-body';
  const view = STEP_VIEWS[step.id](st, s, done);
  if (view.explain) body.append(Object.assign(document.createElement('p'), { textContent: view.explain }));
  if (view.extra) body.append(view.extra);
  if (view.cmd) {
    const pre = document.createElement('pre');
    pre.className = 'cmd';
    pre.dataset.label = 'Was passiert';
    pre.textContent = view.cmd;
    body.append(pre);
  }
  const msg = Object.assign(document.createElement('p'), { className: 'step-msg', hidden: true });
  if (view.actions?.length) {
    const row = document.createElement('div');
    row.className = 'row';
    for (const a of view.actions) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: `btn ${a.primary === false ? '' : 'primary'}`, textContent: a.label });
      b.addEventListener('click', async () => {
        b.disabled = true;
        msg.hidden = true;
        msg.classList.remove('bad');
        let failed = false;
        try {
          const text = await a.run(msg);
          if (text) {
            msg.textContent = text;
            msg.hidden = false;
          }
        } catch (e) {
          failed = true;
          msg.textContent = e.message || 'Das hat nicht geklappt.';
          msg.hidden = false;
          msg.classList.add('bad');
        } finally {
          b.disabled = false;
        }
        mem.open = step.id;
        // Bei Fehlern bleibt die Karte stehen, damit die Meldung lesbar bleibt
        if (!a.stay && !failed) renderSetup();
      });
      row.append(b);
    }
    body.append(row);
  }
  body.append(msg);
  det.append(body);
  li.append(det);
  return li;
}

const field = (label, input) => {
  const l = document.createElement('label');
  l.className = 'field';
  l.append(Object.assign(document.createElement('span'), { textContent: label }), input);
  return l;
};
const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const openUrl = (url) => {
  const a = el('a', { href: url, target: '_blank', rel: 'noopener' });
  document.body.append(a);
  a.click();
  a.remove();
};
const preferFdroid = (st) => !!st.installed['org.fdroid.fdroid'];
const copy = (text) => navigator.clipboard?.writeText(text).then(() => ctx.toast('Kopiert.'), () => ctx.toast('Kopieren geht hier nicht.'));
const saveSetup = (patch) => ctx.store.setSetup({ ...ctx.store.getSetup(), ...patch });

function currentProvider(s) {
  const p = providerById(s.provider || 'mailbox');
  const urls = davUrls(p, s.server);
  return { p, urls };
}

/* ---------- Die einzelnen Schritte ---------- */

const STEP_VIEWS = {
  calendar: (st) => ({
    explain: 'Damit Terminus Termine anzeigen, eintragen und mit der Familie abgleichen kann.',
    cmd: 'Android-Berechtigung anfragen\n→ Terminus darf Kalender lesen und schreiben',
    actions: st.calendar ? [] : [{ label: 'Ausführen', run: async () => { await ctx.Native.listCalendars(); } }],
  }),

  state: () => {
    const sel = el('select');
    sel.append(new Option('bitte wählen', ''), ...Object.entries(STATES).map(([k, v]) => new Option(v, k)));
    sel.value = ctx.state.settings.state || '';
    return {
      explain: 'Für Schulferien, Feiertage und damit Kurse in den Ferien automatisch ausfallen.',
      extra: field('Bundesland', sel),
      cmd: `Bundesland = ${STATES[ctx.state.settings.state] || '…'}\n→ Ferien und Feiertage im Kalender\n→ Serien pausieren in den Ferien`,
      actions: [{ label: 'Übernehmen', run: async () => {
        if (!sel.value) throw new Error('Bitte ein Bundesland wählen.');
        ctx.saveSettings({ ...ctx.state.settings, state: sel.value });
      } }],
    };
  },

  provider: (st, s) => {
    const { p, urls } = currentProvider(s);
    const box = el('div', { className: 'grid2' });
    const sel = el('select');
    sel.append(...DAV_PROVIDERS.map((x) => new Option(`${x.name}${x.where ? ` (${x.where})` : ''}${x.price ? ` · ${x.price}` : ''}`, x.id)));
    sel.value = p.id;
    sel.addEventListener('change', () => {
      saveSetup({ provider: sel.value, loginOk: false });
      renderSetup();
    });
    const server = el('input', { type: 'url', value: s.server || '', placeholder: 'cloud.beispiel.de' });
    const user = el('input', { type: 'email', value: s.user || '', autocomplete: 'username', placeholder: 'familie.becker@…' });
    const pass = el('input', { type: 'password', value: mem.password, autocomplete: 'current-password' });
    const wide = (f) => {
      f.classList.add('wide');
      return f;
    };
    box.append(wide(field('Anbieter', sel)));
    if (p.custom) box.append(wide(field('Server-Adresse', server)));
    box.append(wide(field('E-Mail bzw. Benutzername', user)), wide(field('Passwort (bleibt nur kurz im Speicher)', pass)));
    const actions = [];
    if (p.signup) actions.push({ label: `Konto bei ${p.name} anlegen`, primary: false, stay: true, run: async () => openUrl(p.signup) });
    actions.push({ label: 'Verbindung prüfen', run: async () => {
      const u = davUrls(p, server.value);
      if (!u) throw new Error('Bitte die Server-Adresse eintragen.');
      if (!user.value.trim() || !pass.value) throw new Error('Bitte Benutzername und Passwort eintragen.');
      mem.password = pass.value;
      saveSetup({ provider: p.id, server: server.value.trim(), user: user.value.trim(), caldav: u.caldav, carddav: u.carddav });
      const r = await ctx.Native.checkLogin({ url: u.caldav, user: user.value.trim(), password: pass.value });
      if (!r.ok) {
        saveSetup({ loginOk: false });
        throw new Error(r.status === 401 || r.status === 403 ? 'Name oder Passwort stimmen nicht.' : 'Der Server ist nicht erreichbar. Internet und Adresse prüfen.');
      }
      saveSetup({ loginOk: true });
      return 'Verbindung klappt.';
    } });
    return {
      explain: `Hier liegen Kalender und Kontakte, in Europa statt bei Google. Am einfachsten für Familien: ein gemeinsames Konto, z. B. „familie.becker@…“. ${p.share}`,
      extra: box,
      cmd: `Anbieter: ${p.name}${p.where ? ` (${p.where})` : ''}\nKalender: ${urls?.caldav || '…'}\nKontakte: ${urls?.carddav || '…'}\nKonto:    ${s.user || '…'}\n→ Anmeldung testen`,
      actions,
    };
  },

  davx5: (st) => {
    const app = APPS.find((a) => a.pkg === DAVX);
    return {
      explain: 'DAVx⁵ (Open Source, aus Österreich) hält Kalender und Kontakte zwischen Handy und Anbieter aktuell. Bei F-Droid kostenlos, im Play Store kostet es einmalig ein paar Euro.',
      cmd: `Installiere DAVx⁵ (${DAVX})\nQuelle: ${preferFdroid(st) ? 'F-Droid' : 'Play Store'}\n→ danach automatisch erkannt`,
      actions: st.installed[DAVX] ? [] : [{ label: 'Ausführen', run: async () => openUrl(storeLink(app, preferFdroid(st))) }],
    };
  },

  connect: (st, s) => ({
    explain: 'DAVx⁵ öffnet sich mit Server und Name. Dort „Anmelden“ tippen, dann die Kalender und Adressbücher anhaken, die aufs Handy sollen (vor allem „Familie“). Danach hierher zurück.',
    cmd: `Öffne DAVx⁵ → Neues Konto\nServer:   ${s.caldav || '(Schritt „Zuhause“ zuerst)'}\nName:     ${s.user || '…'}\nPasswort: ${mem.password ? '•••••• (wird übergeben)' : 'in DAVx⁵ eingeben'}`,
    actions: davCals(st).length ? [] : [{ label: 'Ausführen', run: async () => {
      if (!s.caldav) throw new Error('Bitte zuerst Schritt „Zuhause für Kalender und Kontakte“ erledigen.');
      const r = await ctx.Native.openDavx5({ url: s.caldav, username: s.user, ...(mem.password ? { password: mem.password } : {}) });
      return r.prefilled ? '' : `DAVx⁵ ist offen. Trag dort ein: Server ${s.caldav}, Name ${s.user}.`;
    } }],
  }),

  familycal: (st) => {
    const sel = el('select');
    const cals = davCals(st);
    sel.append(new Option(cals.length ? 'bitte wählen' : 'noch kein DAVx⁵-Kalender', ''), ...cals.map((c) => new Option(`${c.name} (${c.account})`, c.id)));
    sel.value = ctx.state.settings.familyCalendarId || '';
    const chosen = cals.find((c) => c.id === sel.value);
    return {
      explain: 'In diesen Kalender trägt Terminus neue Termine ein. Alle, die ihn abonniert haben, sehen sie.',
      extra: field('Familienkalender', sel),
      cmd: `Neue Termine → ${chosen ? `„${chosen.name}“` : '…'} (DAVx⁵)\nHäkchen, „Für“, „Zuständig“ → für alle sichtbar`,
      actions: [{ label: 'Übernehmen', run: async () => {
        const c = cals.find((x) => x.id === sel.value);
        if (!c) throw new Error('Bitte einen Kalender wählen. Fehlt er, in DAVx⁵ anhaken.');
        ctx.saveSettings({ ...ctx.state.settings, familyCalendarId: c.id, calendarId: c.id, calendarName: c.name });
      } }],
    };
  },

  movecal: (st, s, done) => {
    const google = googleCals(st);
    const target = st.cals.find((c) => c.id === ctx.state.settings.familyCalendarId) || davCals(st)[0];
    if (!done && google.length && mem.counts == null) {
      ctx.Native.countEvents({ calendars: google.map((c) => c.id) }).then((r) => {
        mem.counts = r.count;
        renderSetup();
      }, () => {});
    }
    return {
      explain: google.length
        ? 'Terminus kopiert alle Google-Termine, die auf dem Handy liegen, in deinen neuen Kalender: mit Serien, Ausnahmen und Erinnerungen. Doppelte werden übersprungen. Bei Google wird nichts gelöscht.'
        : 'Auf diesem Handy gibt es keine Google-Kalender. Nichts zu tun.',
      cmd: s.movedCal
        ? `Erledigt: ${s.movedCal.copied} Termine kopiert, ${s.movedCal.skipped} übersprungen`
        : `Kopiere ${mem.counts ?? '…'} Termine\nvon:  ${google.map((c) => c.name).join(', ') || '–'} (Google)\nnach: ${target ? `„${target.name}“ (DAVx⁵)` : '(Schritt „Familienkalender“ zuerst)'}`,
      actions: !google.length || s.movedCal ? [] : [{ label: 'Ausführen', run: async () => {
        if (!target) throw new Error('Bitte zuerst den Familienkalender wählen.');
        const r = await ctx.Native.copyCalendars({ from: google.map((c) => c.id), to: target.id });
        saveSetup({ movedCal: r });
        return `${r.copied} Termine kopiert, ${r.skipped} waren schon da${r.exceptions ? `, ${r.exceptions} Einzeländerungen von Serien` : ''}.`;
      } }],
    };
  },

  movecontacts: (st, s) => {
    const books = mem.books;
    const google = books?.filter((b) => b.type === 'com.google') || [];
    const dav = books?.filter((b) => b.type.includes('davdroid')) || [];
    const from = el('select');
    from.append(...google.map((b, i) => new Option(`${b.name} (${b.count} Kontakte)`, i)));
    const to = el('select');
    to.append(...dav.map((b, i) => new Option(b.name, i)));
    const box = el('div', { className: 'grid2' });
    if (google.length > 1) box.append(field('Von (Google)', from));
    if (dav.length > 1) box.append(field('Nach (DAVx⁵)', to));
    const g = google[0], d = dav[0];
    let cmd;
    if (s.movedContacts) cmd = `Erledigt: ${s.movedContacts.copied} Kontakte kopiert, ${s.movedContacts.skipped} übersprungen`;
    else if (!books) cmd = 'Adressbücher auf dem Handy suchen\n→ Android fragt nach Zugriff auf Kontakte';
    else cmd = `Kopiere ${g?.count ?? 0} Kontakte\nvon:  ${g ? g.name : '– (kein Google-Adressbuch)'} (Google)\nnach: ${d ? d.name : '– (in DAVx⁵ Adressbuch anhaken)'} (DAVx⁵)\nGleiche Namen werden übersprungen.`;
    const actions = [];
    if (!s.movedContacts && !books) {
      actions.push({ label: 'Adressbücher suchen', run: async () => {
        mem.books = (await ctx.Native.addressBooks()).books;
        if (!mem.books.some((b) => b.type === 'com.google')) saveSetup({ noGoogleContacts: true });
      } });
    } else if (!s.movedContacts && g && d) {
      actions.push({ label: 'Ausführen', run: async () => {
        const src = google[+from.value || 0], dst = dav[+to.value || 0];
        const r = await ctx.Native.copyContacts({ fromName: src.name, fromType: src.type, toName: dst.name, toType: dst.type });
        saveSetup({ movedContacts: r });
        return `${r.copied} Kontakte kopiert, ${r.skipped} waren schon da.`;
      } });
    }
    return {
      explain: 'Terminus kopiert die Google-Kontakte in dein neues Adressbuch. Fotos, Nummern, Adressen und Geburtstage kommen mit, Gruppen nicht.',
      extra: books && (google.length > 1 || dav.length > 1) ? box : null,
      cmd,
      actions,
    };
  },

  googleoff: (st, s, done) => ({
    explain: 'Erst wenn die beiden Umzüge erledigt sind: In den Android-Einstellungen beim Google-Konto „Kalender“ und „Kontakte“ ausschalten. Das Google-Konto selbst kann bleiben, etwa für den Play Store.',
    cmd: 'Öffne Einstellungen → Konten → Google\n→ Synchronisieren: Kalender AUS, Kontakte AUS',
    actions: done ? [] : [
      { label: 'Ausführen', run: async () => ctx.Native.openSettings({ which: 'sync' }) },
      { label: 'Erledigt', primary: false, run: async () => saveSetup({ googleOff: true }) },
    ],
  }),

  members: (st, s) => {
    const family = ctx.store.getFamily();
    const box = el('div', { className: 'members-inline' });
    const ul = el('ul', { className: 'chips-row' });
    ul.append(...family.map((m) => el('li', { className: 'chip', textContent: `${m.name} · ${m.role === 'kind' ? 'Kind' : 'Erwachsen'}` })));
    const name = el('input', { placeholder: 'Name, z. B. Oma Gisela' });
    const role = el('select');
    role.append(new Option('Erwachsen', 'erw'), new Option('Kind', 'kind'));
    const add = el('div', { className: 'add-member' });
    add.append(field('Name', name), field('Rolle', role));
    const fam = el('input', { value: ctx.state.settings.familyName || '', placeholder: 'Familie Becker' });
    fam.addEventListener('change', () => ctx.saveSettings({ ...ctx.state.settings, familyName: fam.value.trim() }));
    const famField = field('Name der Familie (steht in der Einladung)', fam);
    const me = el('input', { value: ctx.state.settings.ownerName || '', placeholder: 'Anna' });
    me.addEventListener('change', () => ctx.saveSettings({ ...ctx.state.settings, ownerName: me.value.trim() }));
    const names = el('div', { className: 'grid2' });
    names.append(famField, field('Dein Name', me));
    box.append(names, ul, add);
    return {
      explain: 'Wer soll mitmachen? Jede Person bekommt einen Link oder QR-Code: Auf dem iPhone richtet ein Profil Kalender und Kontakte ein, auf Android führt Terminus durch die Schritte. Das Passwort sagst du der Person selbst, es steht nie im Link.',
      extra: box,
      cmd: `Familie: ${family.map((m) => m.name).join(', ') || '…'}\nEinladung → QR-Code oder Nachricht\niPhone: Profil installieren · Android: Terminus + DAVx⁵`,
      actions: [
        { label: 'Hinzufügen', primary: false, run: async () => {
          if (!name.value.trim()) throw new Error('Bitte einen Namen eintragen.');
          ctx.store.setFamily([...ctx.store.getFamily(), { id: newId(), name: name.value.trim(), role: role.value }]);
          document.documentElement.classList.add('has-family');
        } },
        { label: 'Einladen', stay: true, run: async () => openInvite() },
      ],
    };
  },

  battery: (st) => ({
    explain: 'Sonst verschiebt Android im Energiesparmodus den Abgleich und den Morgen-Überblick. In der Liste „Alle Apps“ wählen, dann Terminus und DAVx⁵ auf „Nicht optimieren“ stellen.',
    cmd: `Akku-Optimierung AUS für:\n  Terminus ${st.batteryFree?.[SELF] ? '✓' : '✗'}\n  DAVx⁵    ${st.installed[DAVX] ? (st.batteryFree?.[DAVX] ? '✓' : '✗') : '(nicht installiert)'}`,
    actions: [{ label: 'Ausführen', run: async () => ctx.Native.openSettings({ which: 'battery' }) }],
  }),

  brief: () => {
    const time = el('input', { type: 'time', value: ctx.state.settings.briefTime || '07:00' });
    return {
      explain: 'Jeden Morgen eine Benachrichtigung: Termine von heute, offene Mitbringsachen, Fristen.',
      extra: field('Uhrzeit', time),
      cmd: `Jeden Tag ${ctx.state.settings.briefTime || '07:00'} Uhr → Benachrichtigung „Heute in Terminus“`,
      actions: [{ label: ctx.state.settings.brief ? 'Uhrzeit ändern' : 'Ausführen', run: async () => {
        const [hour, minute] = time.value.split(':').map(Number);
        await ctx.Native.setMorningBrief({ enabled: true, hour, minute });
        ctx.saveSettings({ ...ctx.state.settings, brief: true, briefTime: time.value });
      } }],
    };
  },

  widget: (st) => ({
    explain: 'Die Termine von heute und morgen direkt auf dem Startbildschirm.',
    cmd: 'Widget „Terminus: Heute“ → Startbildschirm\n→ Android fragt einmal „Hinzufügen?“',
    actions: [{ label: 'Ausführen', run: async () => {
      const r = await ctx.Native.pinWidget();
      if (!r.requested) return 'Lange auf den Startbildschirm drücken → Widgets → Terminus.';
      return '';
    } }],
  }),

  apps: (st) => {
    const ul = el('ul', { className: 'apps' });
    for (const app of APPS) {
      const li = el('li');
      li.innerHTML = '<span class="x"><strong></strong><small></small></span>';
      $('strong', li).textContent = app.name;
      $('small', li).textContent = app.why;
      if (isInstalled(st, app)) li.append(el('span', { className: 'ok', textContent: '✓ installiert' }));
      else {
        const b = el('button', { type: 'button', className: 'btn small', textContent: 'Installieren' });
        b.addEventListener('click', () => openUrl(storeLink(app, preferFdroid(st))));
        li.append(b);
      }
      ul.append(li);
    }
    const missing = APPS.filter((a) => !isInstalled(st, a)).length;
    return {
      explain: 'Ersatz für die übrigen Google-Dienste. Jede Installation bestätigt Android einzeln, Terminus führt dich direkt zur richtigen Seite.',
      extra: ul,
      cmd: `${APPS.length - missing} von ${APPS.length} installiert${preferFdroid(st) ? '\nQuelle: F-Droid (wo möglich)' : ''}`,
      actions: [],
    };
  },
};

/* ---------- Einladen ---------- */

function inviteCode(memberName) {
  const s = ctx.store.getSetup();
  if (!s.caldav || !s.user) return null;
  return encodeJoin({
    family: ctx.state.settings.familyName || 'Familie', from: ctx.state.settings.ownerName || '', provider: s.provider || '',
    caldav: s.caldav, carddav: s.carddav || s.caldav, user: s.user, member: memberName || '',
    members: ctx.store.getFamily(), state: ctx.state.settings.state || '',
  });
}

export function openInvite() {
  const sel = $('#invite-family-member');
  sel.replaceChildren(new Option('jemand anderes', ''), ...ctx.store.getFamily().map((m) => new Option(m.name, m.name)));
  drawInvite();
  $('#dlg-join-invite').showModal();
}

function drawInvite() {
  const code = inviteCode($('#invite-family-member').value);
  $('#invite-family-missing').hidden = !!code;
  $('#invite-family-ready').hidden = !code;
  if (!code) return;
  const link = joinWebLink(code, ctx.publicUrl());
  $('#invite-family-link').textContent = link;
  const canvas = $('#invite-family-qr');
  const qr = window.qrcode(0, 'L');
  qr.addData(link);
  qr.make();
  const n = qr.getModuleCount(), cell = Math.floor(canvas.width / (n + 8)), off = (canvas.width - cell * n) / 2;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#15203a';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(off + c * cell, off + r * cell, cell, cell);
  saveSetup({ invited: true });
}

function shareInvite() {
  const who = $('#invite-family-member').value;
  const link = $('#invite-family-link').textContent;
  const text = `${who ? `Hallo ${who.split(' ')[0]}, ` : ''}ich lade dich in unseren Familienkalender ein, ohne Google und Apple.\n\nÖffne diesen Link auf deinem Handy und folge den Schritten:\n${link}\n\nDas Passwort sage ich dir persönlich.`;
  if (ctx.isNative) ctx.Native.shareText({ text, title: 'Einladung senden' }).catch(() => copy(text));
  else if (navigator.share) navigator.share({ text }).catch(() => {});
  else copy(text);
}

/* ---------- Beitreten (Empfänger) ---------- */

const joinState = { info: null, code: '' };

export function handleJoinCode(code) {
  const info = decodeJoin(code);
  if (!info) {
    ctx.toast('Dieser Einladungslink ist unvollständig.');
    return false;
  }
  joinState.info = info;
  joinState.code = code;
  ctx.show('join');
  renderJoin(info);
  return true;
}

export function handleJoinLink(link) {
  const m = String(link).match(/[?&#](?:d|j)=([\w-]+)/);
  return m ? handleJoinCode(m[1]) : false;
}

const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;

async function renderJoin(info) {
  $('#join-title').textContent = info.from ? `${info.from} lädt dich in „${info.family}“ ein` : `Einladung in „${info.family}“`;
  const body = $('#join-body');
  body.replaceChildren();
  const pw = el('p', { className: 'hint', textContent: 'Das Passwort steht aus Sicherheitsgründen nicht im Link. Du bekommst es persönlich.' });

  if (!ctx.isNative) {
    const ios = el('section', { className: 'panel' });
    ios.innerHTML = '<h3>iPhone oder iPad</h3><ol class="steps"><li>Auf „Kalender einrichten“ tippen und „Zulassen“ wählen.</li><li>Einstellungen öffnen → oben „Profil geladen“ → Installieren.</li><li>Das Passwort eingeben. Fertig, der Familienkalender ist in der Kalender-App.</li></ol>';
    const b = el('button', { type: 'button', className: 'btn primary', textContent: 'Kalender einrichten' });
    b.addEventListener('click', () => {
      const blob = new Blob([mobileconfig(info)], { type: 'application/x-apple-aspen-config' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'familienkalender.mobileconfig' });
      document.body.append(a);
      a.click();
      a.remove();
    });
    ios.append(b);
    const android = el('section', { className: 'panel' });
    android.innerHTML = '<h3>Android</h3><ol class="steps"><li>Terminus installieren.</li><li>Dann hier „In Terminus öffnen“ tippen. Terminus führt durch den Rest.</li></ol>';
    const row = el('div', { className: 'row' });
    row.append(
      el('a', { className: 'btn', href: 'https://github.com/Baum97/terminus/releases', target: '_blank', rel: 'noopener', textContent: 'Terminus laden' }),
      el('a', { className: 'btn primary', href: joinAppLink(joinState.code), textContent: 'In Terminus öffnen' }),
    );
    android.append(row);
    body.append(...(isApple() ? [ios, android] : [android, ios]), pw);
    return;
  }

  // In der App: dieselben Befehls-Karten wie im Assistenten, nur für den Beitritt
  const st = (mem.status = await deviceInfo());
  const cals = davCals(st);
  const steps = el('ol', { className: 'setup-steps' });
  const add = (title, done, view) => {
    const li = el('li', { className: `step${done ? ' done' : ''}` });
    const det = el('details', { open: !done && !steps.querySelector('details[open]') });
    det.innerHTML = '<summary><span class="num"></span><span class="t"></span><span class="state"></span></summary><div class="step-body"></div>';
    $('.num', det).textContent = done ? '✓' : steps.children.length + 1;
    $('.t', det).textContent = title;
    $('.state', det).textContent = done ? 'erledigt' : '';
    const b = $('.step-body', det);
    b.append(el('p', { textContent: view.explain }));
    if (view.extra) b.append(view.extra);
    const pre = el('pre', { className: 'cmd', textContent: view.cmd });
    pre.dataset.label = 'Was passiert';
    b.append(pre);
    const msg = el('p', { className: 'step-msg', hidden: true });
    if (!done && view.run) {
      const btn = el('button', { type: 'button', className: 'btn primary', textContent: 'Ausführen' });
      btn.addEventListener('click', async () => {
        try {
          const t = await view.run();
          if (t) Object.assign(msg, { textContent: t, hidden: false });
          else renderJoin(info);
        } catch (e) {
          Object.assign(msg, { textContent: e.message, hidden: false });
        }
      });
      b.append(btn);
    }
    b.append(msg);
    li.append(det);
    steps.append(li);
  };
  add('Kalender freigeben', !!st.calendar, { explain: 'Damit Terminus die Familientermine zeigen kann.', cmd: 'Android-Berechtigung: Kalender lesen und schreiben', run: () => ctx.Native.listCalendars() });
  add('DAVx⁵ installieren', !!st.installed[DAVX], { explain: 'Hält den Familienkalender auf diesem Handy aktuell.', cmd: `Installiere DAVx⁵ (${DAVX})`, run: async () => openUrl(storeLink(APPS[0], preferFdroid(st))) });
  add('Mit dem Familienkonto verbinden', cals.length > 0, {
    explain: 'DAVx⁵ öffnet sich mit Server und Name. Passwort eingeben, „Anmelden“, dann den Kalender „Familie“ anhaken.',
    cmd: `Öffne DAVx⁵ → Neues Konto\nServer: ${info.caldav}\nName:   ${info.user}\nPasswort: bekommst du persönlich`,
    run: async () => {
      const r = await ctx.Native.openDavx5({ url: info.caldav, username: info.user });
      return r.prefilled ? '' : `Trag in DAVx⁵ ein: Server ${info.caldav}, Name ${info.user}.`;
    },
  });
  const sel = el('select');
  sel.append(new Option('bitte wählen', ''), ...cals.map((c) => new Option(`${c.name} (${c.account})`, c.id)));
  const simple = el('label', { className: 'check' });
  simple.innerHTML = '<input type="checkbox"> <span>Einfach-Modus: große Schrift, nur das Wichtigste</span>';
  $('input', simple).checked = /oma|opa/i.test(info.member);
  const extra = el('div', { className: 'grid2' });
  const f = field('Familienkalender', sel);
  f.classList.add('wide');
  extra.append(f, simple);
  add('Einstellungen übernehmen', !!ctx.state.settings.familyCalendarId && ctx.store.getFamily().length > 0, {
    explain: 'Familie, Bundesland und Kalender von der Einladung übernehmen.',
    extra,
    cmd: `Familie:  ${info.members.map((m) => m.name).join(', ') || '–'}\nBundesland: ${STATES[info.state] || '–'}\nDu bist: ${info.member || '–'}`,
    run: async () => {
      const c = cals.find((x) => x.id === sel.value);
      if (!c) throw new Error('Bitte den Familienkalender wählen. Fehlt er, in DAVx⁵ anhaken.');
      ctx.store.setFamily(info.members.map((m) => ({ id: newId(), ...m })));
      document.documentElement.classList.toggle('has-family', info.members.length > 0);
      ctx.saveSettings({ ...ctx.state.settings, familyCalendarId: c.id, calendarId: c.id, calendarName: c.name, state: info.state || ctx.state.settings.state, simple: $('input', simple).checked, ownerName: info.member || ctx.state.settings.ownerName, familyName: info.family });
      ctx.store.setSetup({ ...ctx.store.getSetup(), goal: 'familie', provider: info.provider, caldav: info.caldav, carddav: info.carddav, user: info.user, loginOk: true, joined: true, invited: true });
      ctx.applySimple();
      ctx.toast(`Willkommen bei „${info.family}“!`);
      ctx.show('calendar');
      return '';
    },
  });
  body.append(steps, pw);
}
