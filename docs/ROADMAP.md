# Terminus: Merkzettel für spätere Ausbaustufen

## Paket B: Listen und echte Aufgaben (ersetzt Google Keep)

**Stand:** umgesetzt (Oktober 2026): Listen über die OpenTasks-Schnittstelle (Tasks.org, OpenTasks) bzw. lokal. Noch offen: Test auf echten Handys, Fristen wahlweise als echte Aufgabe, Mitbringlisten als Aufgabenliste je Termin.

**Ziel:** Aufgaben und eine geteilte Einkaufsliste, die sich in der Familie synchronisieren. Wer im Supermarkt „Milch“ abhakt, sieht das bei allen sofort.

**Weg:** Der offene Standard für Aufgaben (VTODO in CalDAV). Der Speicher liegt beim selben Anbieter wie der Kalender (mailbox.org, Posteo, Nextcloud …), DAVx⁵ synchronisiert. Auf Android landen die Aufgaben in einem Aufgaben-Speicher, den Tasks.org, OpenTasks oder jtx Board bereitstellen. Terminus liest und schreibt dort mit (Inhalts-Schnittstelle `org.tasks.opentasks` bzw. `org.dmfs.tasks`, Berechtigungen READ_TASKS/WRITE_TASKS).

**Umfang:**
- Listen anzeigen, anlegen, abhaken, sortieren, „erledigte ausblenden“
- Einkaufsliste als eigene Liste mit großen Einträgen und Schnelleingabe
- Fristen aus Zetteln wahlweise als echte Aufgabe statt als Kalendereintrag
- Mitbringlisten optional als Aufgabenliste je Termin

**Warum später:** Die Schnittstelle zu Tasks.org/OpenTasks lässt sich nur auf einem echten Handy verlässlich prüfen, und die Fragen zur Bedienung (welche Liste, wer darf was) klärt man am besten mit echten Nutzerinnen und Nutzern.

**Bis dahin:** Fristen und Mitbringlisten laufen über die Terminbeschreibung (`☐ Laterne`) und sind über CalDAV bereits geteilt.
