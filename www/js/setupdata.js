// Daten und reine Funktionen für den Einrichtungsassistenten (ohne Oberfläche, damit testbar).

// Anbieter für Kalender und Kontakte (CalDAV/CardDAV). Adressen Stand Oktober 2026.
export const DAV_PROVIDERS = [
  { id: 'mailbox', name: 'mailbox.org', where: 'Berlin', price: 'ab ca. 3 € im Monat', signup: 'https://mailbox.org/', caldav: 'https://dav.mailbox.org/', carddav: 'https://dav.mailbox.org/', share: 'Im Web-Kalender von mailbox.org: Kalender „Familie“ anlegen, dann „Freigeben“.' },
  { id: 'posteo', name: 'Posteo', where: 'Berlin', price: 'ca. 1 € im Monat', signup: 'https://posteo.de/', caldav: 'https://posteo.de:8443/', carddav: 'https://posteo.de:8843/', share: 'Am einfachsten: ein gemeinsames Familien-Postfach, das alle Handys nutzen.' },
  { id: 'gmx', name: 'GMX', where: 'Montabaur', price: 'kostenlos mit Werbung', signup: 'https://www.gmx.net/', caldav: 'https://caldav.gmx.net/', carddav: 'https://carddav.gmx.net/', share: 'Am einfachsten: ein gemeinsames Familien-Postfach, das alle Handys nutzen.' },
  { id: 'webde', name: 'WEB.DE', where: 'Montabaur', price: 'kostenlos mit Werbung', signup: 'https://web.de/', caldav: 'https://caldav.web.de/', carddav: 'https://carddav.web.de/', share: 'Am einfachsten: ein gemeinsames Familien-Postfach, das alle Handys nutzen.' },
  { id: 'nextcloud', name: 'Nextcloud', where: 'eigener Server oder Hoster', price: 'je nach Hoster', custom: true, path: 'remote.php/dav/', share: 'In Nextcloud: Kalender „Familie“ anlegen, dann bei „Teilen“ die anderen Konten eintragen.' },
  { id: 'other', name: 'Anderer Anbieter', where: '', price: '', custom: true, path: '', share: 'Beim Anbieter einen Kalender „Familie“ anlegen und freigeben.' },
];

export function providerById(id) {
  return DAV_PROVIDERS.find((p) => p.id === id) || null;
}

// Server-Adressen für einen Anbieter; bei eigenen Servern aus der eingegebenen Adresse gebaut
export function davUrls(provider, custom = '') {
  if (!provider) return null;
  if (!provider.custom) return { caldav: provider.caldav, carddav: provider.carddav };
  let base = String(custom || '').trim();
  if (!base) return null;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  base = base.replace(/\/+$/, '/');
  if (!base.endsWith('/')) base += '/';
  const url = provider.path && !base.includes(provider.path) ? base + provider.path : base;
  return { caldav: url, carddav: url };
}

// Empfohlene Apps: Ersatz für die Dienste von Big Tech
export const APPS = [
  { pkg: 'at.bitfire.davdroid', name: 'DAVx⁵', why: 'bringt Kalender und Kontakte vom Anbieter aufs Handy', fdroid: true, core: true },
  { pkg: 'at.bitfire.icsdroid', name: 'ICSx⁵', why: 'Kalender abonnieren: Müllabfuhr, Schule, Verein', fdroid: true },
  { pkg: 'org.tasks', name: 'Tasks.org', why: 'Aufgaben und Listen', fdroid: true },
  { pkg: 'org.thoughtcrime.securesms', name: 'Signal', why: 'Messenger statt WhatsApp', fdroid: false },
  { pkg: 'app.organicmaps', name: 'Organic Maps', why: 'Karten und Navigation, auch offline', fdroid: true },
  { pkg: 'net.thunderbird.android', also: ['com.fsck.k9'], name: 'Thunderbird', why: 'E-Mail-App für jeden Anbieter', fdroid: true },
  { pkg: 'com.x8bit.bitwarden', also: ['com.kunzisoft.keepass.libre'], name: 'Bitwarden', why: 'Passwörter sicher speichern', fdroid: true },
  { pkg: 'com.beemdevelopment.aegis', name: 'Aegis', why: 'Zwei-Faktor-Codes', fdroid: true },
  { pkg: 'com.nextcloud.client', name: 'Nextcloud', why: 'Dateien und Fotos sichern', fdroid: true },
  { pkg: 'org.mozilla.firefox', name: 'Firefox', why: 'Browser statt Chrome', fdroid: false },
];

export function storeLink(app, preferFdroid) {
  return preferFdroid && app.fdroid
    ? `https://f-droid.org/packages/${app.pkg}/`
    : `https://play.google.com/store/apps/details?id=${app.pkg}`;
}

/* ---------- Beitritt zur Familie ---------- */
// Der Link enthält Server, Benutzername, Familienmitglieder und Bundesland, aber nie ein Passwort.

const b64url = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export function encodeJoin({ family = 'Familie', from = '', provider = '', caldav, carddav, user, calendar = '', member = '', members = [], state = '' }) {
  const full = { v: 1, f: family, by: from, p: provider, c: caldav, d: carddav === caldav ? '' : carddav, u: user, k: calendar, m: member, ms: members.map((x) => [x.name, x.role === 'kind' ? 'k' : 'e']), s: state };
  // Leere Angaben weglassen: kürzerer Link, gröberer und leichter scanbarer QR-Code
  const data = Object.fromEntries(Object.entries(full).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length)));
  if ('password' in arguments[0]) throw new Error('Passwörter gehören nicht in einen Beitrittslink.');
  return b64url(JSON.stringify(data));
}

export function decodeJoin(code) {
  try {
    const d = JSON.parse(unb64url(code));
    if (d.v !== 1 || !/^https:\/\//.test(d.c || '') || typeof d.u !== 'string') return null;
    return {
      family: String(d.f || 'Familie').slice(0, 60), from: String(d.by || '').slice(0, 60), provider: String(d.p || ''),
      caldav: d.c, carddav: /^https:\/\//.test(d.d || '') ? d.d : d.c, user: d.u.slice(0, 120), calendar: String(d.k || '').slice(0, 80), member: String(d.m || '').slice(0, 40),
      members: Array.isArray(d.ms) ? d.ms.filter((x) => Array.isArray(x) && typeof x[0] === 'string').map(([name, r]) => ({ name: name.slice(0, 40), role: r === 'k' ? 'kind' : 'erw' })) : [],
      state: typeof d.s === 'string' ? d.s.slice(0, 2) : '',
    };
  } catch {
    return null;
  }
}

// Wohin eine Einladung für einen Kalender des Handys zeigt. Kennt der Assistent das Konto schon,
// nimmt er dessen Adressen, sonst die Server-Adresse, die DAVx⁵ zum Kalender ablegt.
export function inviteTarget(cal, setup = {}) {
  const sameHost = (a, b) => {
    try {
      return new URL(a).host === new URL(b).host;
    } catch {
      return false;
    }
  };
  if (setup.caldav && setup.user && (!cal?.url || sameHost(cal.url, setup.caldav))) {
    return { caldav: setup.caldav, carddav: setup.carddav || setup.caldav, user: setup.user, provider: setup.provider || '' };
  }
  if (!cal?.url) return null;
  const u = new URL(cal.url);
  const base = `${u.origin}${/\/remote\.php\/dav\//.test(u.pathname) ? '/remote.php/dav/' : '/'}`;
  return { caldav: base, carddav: base, user: cal.account || '', provider: '' };
}

export const joinWebLink = (code, base) => `${base}#j=${code}`;
export const joinAppLink = (code) => `terminus://join?d=${code}`;

/* ---------- iPhone: Einrichtungsprofil (.mobileconfig) ---------- */

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function hostParts(url) {
  const u = new URL(url);
  return { host: u.hostname, port: u.port ? +u.port : 443, path: u.pathname && u.pathname !== '/' ? u.pathname : '' };
}

// Ohne Passwort: iOS fragt bei der Installation danach.
export function mobileconfig({ family, caldav, carddav, user }, uuid = () => crypto.randomUUID()) {
  const cal = hostParts(caldav);
  const card = hostParts(carddav || caldav);
  const payload = (type, prefix, p, label) => `
    <dict>
      <key>${prefix}AccountDescription</key><string>${xml(`${family}: ${label}`)}</string>
      <key>${prefix}HostName</key><string>${xml(p.host)}</string>
      <key>${prefix}Port</key><integer>${p.port}</integer>${p.path ? `
      <key>${prefix}PrincipalURL</key><string>${xml(p.path)}</string>` : ''}
      <key>${prefix}UseSSL</key><true/>
      <key>${prefix}Username</key><string>${xml(user)}</string>
      <key>PayloadDisplayName</key><string>${xml(label)}</string>
      <key>PayloadIdentifier</key><string>io.github.baum97.terminus.${prefix.toLowerCase()}</string>
      <key>PayloadType</key><string>${type}</string>
      <key>PayloadUUID</key><string>${uuid()}</string>
      <key>PayloadVersion</key><integer>1</integer>
    </dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>${payload('com.apple.caldav.account', 'CalDAV', cal, 'Kalender')}${payload('com.apple.carddav.account', 'CardDAV', card, 'Kontakte')}
  </array>
  <key>PayloadDescription</key><string>${xml(`Richtet den gemeinsamen Kalender und die Kontakte von „${family}“ ein. Das Passwort wird bei der Installation abgefragt.`)}</string>
  <key>PayloadDisplayName</key><string>${xml(`${family}: Kalender und Kontakte`)}</string>
  <key>PayloadIdentifier</key><string>io.github.baum97.terminus.profile</string>
  <key>PayloadOrganization</key><string>Terminus</string>
  <key>PayloadType</key><string>Configuration</string>
  <key>PayloadUUID</key><string>${uuid()}</string>
  <key>PayloadVersion</key><integer>1</integer>
</dict>
</plist>
`;
}

/* ---------- Schritte ---------- */
// goal: 'zettel' (nur Zettel → Kalender), 'familie' (gemeinsamer Kalender), 'komplett' (unabhängig von Big Tech)
export const STEPS = [
  { id: 'calendar', goals: ['zettel', 'familie', 'komplett'], title: 'Kalender freigeben' },
  { id: 'state', goals: ['zettel', 'familie', 'komplett'], title: 'Bundesland für Ferien und Feiertage' },
  { id: 'provider', goals: ['familie', 'komplett'], title: 'Zuhause für Kalender und Kontakte' },
  { id: 'davx5', goals: ['familie', 'komplett'], title: 'DAVx⁵ installieren' },
  { id: 'connect', goals: ['familie', 'komplett'], title: 'Konto mit dem Handy verbinden' },
  { id: 'familycal', goals: ['familie', 'komplett'], title: 'Familienkalender wählen' },
  { id: 'movecal', goals: ['komplett'], title: 'Termine von Google mitnehmen' },
  { id: 'movecontacts', goals: ['komplett'], title: 'Kontakte von Google mitnehmen' },
  { id: 'googleoff', goals: ['komplett'], title: 'Google den Zugriff entziehen' },
  { id: 'members', goals: ['familie', 'komplett'], title: 'Familie dazuholen' },
  { id: 'battery', goals: ['familie', 'komplett'], title: 'Akku-Sparen für Terminus und DAVx⁵ abschalten' },
  { id: 'brief', goals: ['zettel', 'familie', 'komplett'], title: 'Morgen-Überblick' },
  { id: 'widget', goals: ['zettel', 'familie', 'komplett'], title: 'Widget auf den Startbildschirm' },
  { id: 'apps', goals: ['komplett'], title: 'Weitere Apps ohne Big Tech', optional: true },
];

export function stepsFor(goal) {
  return STEPS.filter((s) => s.goals.includes(goal));
}

// Fortschritt ohne optionale Schritte
export function progress(steps, done) {
  const required = steps.filter((s) => !s.optional);
  const n = required.filter((s) => done[s.id]).length;
  return { done: n, total: required.length, next: required.find((s) => !done[s.id])?.id || null };
}
