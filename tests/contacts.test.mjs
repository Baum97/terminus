import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVCards, contactsToPeople, mergePeople, initials } from '../www/js/contacts.js';
import { buildICS } from '../www/js/ics.js';
import { inviteMail, mailtoMany } from '../www/js/share.js';
import { normalizeEvent } from '../www/js/events.js';

// Export, wie ihn Thunderbird (vCard 4.0) und GMX (vCard 3.0) erzeugen, plus altes vCard 2.1
const VCF = `BEGIN:VCARD\r
VERSION:4.0\r
FN:Gisela Becker\r
N:Becker;Gisela;;;\r
EMAIL;PREF=1:gisela.becker@gmx.de\r
EMAIL:oma@posteo.de\r
TEL;TYPE=cell:0171 2345678\r
END:VCARD\r
BEGIN:VCARD\r
VERSION:3.0\r
N:Müller;Jörg;;;\r
item1.EMAIL;type=INTERNET;type=pref:JOERG@WEB.DE\r
NOTE:Sehr lange Notiz, die auf meh\r
 rere Zeilen umgebrochen wurde\r
END:VCARD\r
BEGIN:VCARD\r
VERSION:2.1\r
N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:K=C3=B6nig;Bj=C3=B6rn;;;\r
FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Bj=C3=B6rn K=C3=B6nig=\r
=20(Tagesvater)\r
EMAIL;INTERNET:bjoern@example.de\r
END:VCARD\r
BEGIN:VCARD\r
VERSION:3.0\r
FN:Nur Foto\r
PHOTO;ENCODING=b;TYPE=JPEG:QUJD==\r
END:VCARD\r
`;

test('vCard-Import aus Thunderbird, GMX und alten Exporten', () => {
  const contacts = parseVCards(VCF);
  assert.equal(contacts.length, 3);
  assert.deepEqual(contacts[0], { name: 'Gisela Becker', emails: ['gisela.becker@gmx.de', 'oma@posteo.de'], phone: '0171 2345678' });
  assert.equal(contacts[1].name, 'Jörg Müller');
  assert.deepEqual(contacts[1].emails, ['joerg@web.de']);
  assert.equal(contacts[2].name, 'Björn König (Tagesvater)');
});

test('Eine Person je Adresse, Dubletten werden zusammengeführt', () => {
  const people = contactsToPeople(parseVCards(VCF));
  assert.equal(people.length, 4);
  assert.equal(people[0].phone, '491712345678');
  const existing = [{ id: 'a', name: 'oma@posteo.de', email: 'oma@posteo.de', phone: '' }];
  const { people: merged, added } = mergePeople(existing, people);
  assert.equal(added, 3);
  assert.equal(merged.find((p) => p.email === 'oma@posteo.de').name, 'Gisela Becker');
  assert.equal(initials('Björn König (Tagesvater)'), 'BT');
});

const ev = normalizeEvent({
  id: 'e1', title: 'Grillabend', date: '2026-11-13', start: '18:00', location: 'Bei uns im Garten',
  guests: [{ name: 'Gisela Becker', email: 'Gisela.Becker@gmx.de' }, { name: 'Jörg', email: 'joerg@web.de' }, { email: 'kaputt' }],
});

test('Gäste werden geprüft und als Einladung in die Kalenderdatei geschrieben', () => {
  assert.deepEqual(ev.guests.map((g) => g.email), ['gisela.becker@gmx.de', 'joerg@web.de']);
  const invite = buildICS([ev], { organizer: { name: 'Anna Becker', email: 'anna@gmx.de' } });
  assert.match(invite, /METHOD:REQUEST/);
  assert.match(invite, /ORGANIZER;CN="Anna Becker":mailto:anna@gmx.de/);
  assert.match(invite.replace(/\r\n /g, ''), /ATTENDEE;CN="Gisela Becker";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:gisela.becker@gmx.de/);
  const plain = buildICS([ev]);
  assert.match(plain, /METHOD:PUBLISH/);
  assert.doesNotMatch(plain, /ATTENDEE/);
});

test('Einladungs-Mail in Du-Form mit Link', () => {
  const one = inviteMail(ev, [ev.guests[0]], { ownerName: 'Anna', link: 'https://x.de/#t=abc' });
  assert.equal(one.subject, 'Einladung: Grillabend (Fr, 13.11.2026)');
  assert.match(one.body, /^Hallo Gisela,\n\nich lade dich zu folgendem Termin ein:/);
  assert.match(one.body, /Mit einem Klick in deinen Kalender:\nhttps:\/\/x\.de\/#t=abc/);
  assert.match(one.body, /Viele Grüße\nAnna$/);
  const many = inviteMail(ev, ev.guests, { withAttachment: true });
  assert.match(many.body, /^Hallo zusammen,\n\nich lade euch/);
  assert.match(many.body, /Kalenderdatei hängt außerdem an/);
  assert.match(mailtoMany(['a@b.de', 'c@d.de'], 'S', 'B'), /^mailto:a@b\.de,c@d\.de\?subject=S&body=B$/);
});
