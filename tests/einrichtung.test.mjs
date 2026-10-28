import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAV_PROVIDERS, providerById, davUrls, APPS, storeLink, encodeJoin, decodeJoin, joinWebLink, joinAppLink, mobileconfig, stepsFor, progress, inviteTarget } from '../www/js/setupdata.js';

test('Anbieter: Adressen, eigene Server', () => {
  assert.deepEqual(davUrls(providerById('posteo')), { caldav: 'https://posteo.de:8443/', carddav: 'https://posteo.de:8843/' });
  assert.deepEqual(davUrls(providerById('nextcloud'), 'cloud.example.de'), { caldav: 'https://cloud.example.de/remote.php/dav/', carddav: 'https://cloud.example.de/remote.php/dav/' });
  assert.deepEqual(davUrls(providerById('nextcloud'), 'https://cloud.example.de/remote.php/dav'), { caldav: 'https://cloud.example.de/remote.php/dav/', carddav: 'https://cloud.example.de/remote.php/dav/' });
  assert.equal(davUrls(providerById('other'), ''), null);
  for (const p of DAV_PROVIDERS.filter((x) => !x.custom)) assert.match(p.caldav, /^https:\/\/[^/]+(:\d+)?\/$/);
});

test('App-Empfehlungen verlinken F-Droid oder Play Store', () => {
  const dav = APPS.find((a) => a.pkg === 'at.bitfire.davdroid');
  assert.equal(storeLink(dav, true), 'https://f-droid.org/packages/at.bitfire.davdroid/');
  assert.equal(storeLink(APPS.find((a) => a.name === 'Signal'), true), 'https://play.google.com/store/apps/details?id=org.thoughtcrime.securesms');
});

test('Beitrittslink: ohne Passwort, mit Familie und Bundesland', () => {
  const info = { family: 'Familie Becker', from: 'Anna', provider: 'mailbox', caldav: 'https://dav.mailbox.org/', carddav: 'https://dav.mailbox.org/', user: 'familie.becker@mailbox.org', calendar: 'Familie', member: 'Oma Gisela', members: [{ name: 'Mia', role: 'kind' }, { name: 'Papa', role: 'erw' }], state: 'NI' };
  const code = encodeJoin(info);
  const back = decodeJoin(code);
  assert.deepEqual(back, info);
  assert.throws(() => encodeJoin({ ...info, password: 'x' }), /Passwörter/);
  assert.equal(joinWebLink(code, 'https://baum97.github.io/terminus/'), `https://baum97.github.io/terminus/#j=${code}`);
  assert.equal(joinAppLink(code), `terminus://join?d=${code}`);
  assert.equal(decodeJoin('kaputt'), null);
  assert.equal(decodeJoin(encodeJoin({ ...info, caldav: 'http://unsicher.de/' })), null);
});

test('iPhone-Profil für Kalender und Kontakte', () => {
  let n = 0;
  const xml = mobileconfig({ family: 'Familie <Becker>', caldav: 'https://posteo.de:8443/', carddav: 'https://posteo.de:8843/', user: 'familie@posteo.de' }, () => `UUID-${++n}`);
  assert.match(xml, /<key>CalDAVHostName<\/key><string>posteo\.de<\/string>/);
  assert.match(xml, /<key>CalDAVPort<\/key><integer>8443<\/integer>/);
  assert.match(xml, /<key>CardDAVPort<\/key><integer>8843<\/integer>/);
  assert.match(xml, /<key>CalDAVUsername<\/key><string>familie@posteo\.de<\/string>/);
  assert.match(xml, /Familie &lt;Becker&gt;/);
  assert.doesNotMatch(xml, /Password/);
  assert.equal(new Set(xml.match(/UUID-\d+/g)).size, 3);
  const nc = mobileconfig({ family: 'F', caldav: 'https://cloud.example.de/remote.php/dav/', user: 'u' }, () => 'x');
  assert.match(nc, /<key>CalDAVPrincipalURL<\/key><string>\/remote\.php\/dav\/<\/string>/);
});

test('Schritte je Ziel und Fortschritt', () => {
  assert.deepEqual(stepsFor('zettel').map((s) => s.id), ['calendar', 'state', 'brief', 'widget']);
  assert.equal(stepsFor('komplett').length, 14);
  const p = progress(stepsFor('familie'), { calendar: true, state: true, provider: true });
  assert.deepEqual(p, { done: 3, total: 10, next: 'davx5' });
});

test('Einladung für einen Kalender des Handys', () => {
  const setup = { caldav: 'https://posteo.de:8443/', carddav: 'https://posteo.de:8843/', user: 'familie@posteo.de', provider: 'posteo' };
  assert.deepEqual(inviteTarget({ url: 'https://posteo.de:8443/calendars/familie/default/', account: 'familie@posteo.de' }, setup), { caldav: 'https://posteo.de:8443/', carddav: 'https://posteo.de:8843/', user: 'familie@posteo.de', provider: 'posteo' });
  assert.deepEqual(inviteTarget({ url: 'https://cloud.example.de/remote.php/dav/calendars/anna/familie/', account: 'anna' }, setup), { caldav: 'https://cloud.example.de/remote.php/dav/', carddav: 'https://cloud.example.de/remote.php/dav/', user: 'anna', provider: '' });
  assert.deepEqual(inviteTarget({ url: 'https://dav.mailbox.org/caldav/Y2FsOi8vMC8z', account: 'a@mailbox.org' }), { caldav: 'https://dav.mailbox.org/', carddav: 'https://dav.mailbox.org/', user: 'a@mailbox.org', provider: '' });
  assert.equal(inviteTarget({ name: 'Google', account: 'a@gmail.com' }), null);
  assert.deepEqual(inviteTarget(null, setup).user, 'familie@posteo.de');
});
