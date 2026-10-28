# Terminus

**Zettel knipsen. Termin steht.** Damit deine Daten deine bleiben.

Du fotografierst einen Elternbrief, ein Plakat, eine Einladung oder einen Chat-Screenshot, oder teilst ihn direkt aus WhatsApp an Terminus. Die App findet Datum, Uhrzeit, Ort, Mitbringliste und Kosten und trägt die Termine in deinen Kalender ein. Mit einem Tipp schickst du sie an andere (Oma, Partner, Tagesmutter). Wer den Link öffnet, übernimmt den Termin in den eigenen Kalender, auch ohne Terminus.

- **Android-App** als Hauptprodukt, **Web-Version** für iPhone und PC
- **Open Source** (EUPL-1.2, die Open-Source-Lizenz der EU)
- **Kostenlos**, ohne Konto, ohne Werbung, ohne Tracker
- **Unabhängig von US-Konzernen**: KI über Mistral (Paris) oder ein eigenes Modell. Es gibt auch einen Modus ganz ohne KI, in dem nichts das Gerät verlässt. Keine Google-Dienste, keine Google Fonts, keine CDNs.

## Funktionen

| Bereich | Android-App | Web-Version |
|---|---|---|
| Eingabe | Kamera, Galerie, **Teilen-Menü** (Bilder und Text, z. B. aus WhatsApp) | Kamera, Bild, Text, Strg+V, Drag & Drop |
| Erkennung | viele Termine pro Dokument, mehrtägige Termine, Kalenderwoche, Prüfung von Wochentag und Datum | gleich |
| Kalender | einzelner Termin: Kalender-App öffnet sich ausgefüllt. Mehrere: **direkt eingetragen**, Kalender wählbar | `.ics`-Datei oder Google-Kalender-Link |
| Teilen | Android-Teilen-Menü, WhatsApp, E-Mail, gespeicherte Personen | WhatsApp, E-Mail, Teilen-Menü des Browsers |
| Einladen | Personen aus dem Adressbuch des Handys oder per .vcf-Import wählen, **Einladungs-Mail mit Kalendereinladung** über das eigene Mailprogramm | Personen per .vcf-Import, Kontaktauswahl (Chrome/Android) oder Adresse, Einladungs-Mail mit Link |
| Termin-Link | zeigt auf die Web-Version, der Termin steckt im `#`-Teil der Adresse und erreicht nie einen Server | gleich |

## Komfort im Alltag

| Funktion | Was passiert |
|---|---|
| **Fristen** | „Anmeldung bis 2.11.“ oder „12 € überweisen bis 6.11.“ werden eigene Einträge (ganztägig) mit Erinnerung am Vortag um 9 Uhr |
| **Vorabend-Erinnerung** | Steht eine Mitbringliste oder ein Betrag dabei, erinnert der Kalender am Vorabend um 19 Uhr: „Morgen: Laternenfest. Mitbringen: Laterne, Teelicht“ |
| **Serientermine** | „dienstags 16 Uhr“, „alle zwei Wochen“, „bis 23.03.“ oder „bis zu den Osterferien“ werden ein einziger wiederkehrender Termin |
| **Feiertage und Ferien** | Hinweis auf der Karte, wenn ein Termin auf einen Feiertag oder in die Schulferien des eingestellten Bundeslands fällt |
| **Doppelt und Überschneidung** | Abgleich mit dem Handykalender und den gemerkten Terminen: „Überschneidung: Zahnarzt 8:00–9:00“, „Steht schon in deinem Kalender“ |
| **Weg zum Ort** | Ort antippen öffnet die eigene Karten-App (OsmAnd, Organic Maps, Google Maps …), im Browser OpenStreetMap |
| **Schnellstart** | App-Icon lange drücken: „Zettel knipsen“ oder „Screenshot wählen“ |
| **Sprache** | Mit KI kommen Titel und Hinweise auf Deutsch, Englisch, Türkisch, Arabisch, Ukrainisch, Russisch, Polnisch, Rumänisch oder Persisch |
| **QR-Code** | Im Teilen-Dialog: Code mit Titel und Datum zum Ausdrucken. Wer ihn scannt, übernimmt den Termin |

Feiertage berechnet die App selbst. Die Schulferien kommen von der [OpenHolidays-API](https://www.openholidaysapi.org) (offene Daten, EU-gefördert) und werden beim Build nach `www/data/ferien.json` geladen (`node scripts/ferien.mjs`), danach liegen sie offline in der App.

## Einrichtungsassistent

Beim ersten Start fragt Terminus, was du vorhast, und zeigt nur die nötigen Schritte:

- **Zettel in den Kalender:** 4 Schritte
- **Familie organisieren:** 10 Schritte
- **Unabhängig von Big Tech:** 13 Schritte, dazu eine optionale App-Liste

Jeder Schritt ist eine **Befehls-Karte**: eine kurze Erklärung, ein Code-Fenster „Was passiert“ (z. B. `Kopiere 214 Termine von: anna@gmail.com (Google) nach: „Familie“ (DAVx⁵)`) und ein Knopf **„Ausführen“**. Android fragt höchstens einmal nach, dann erkennt Terminus selbst, dass der Schritt erledigt ist.

| Schritt | Was Terminus selbst macht |
|---|---|
| Anbieter und Konto | findet die Server-Adressen und prüft Name und Passwort |
| DAVx⁵ | führt zur Installation (F-Droid, sonst Play Store) und erkennt sie |
| Verbinden | öffnet DAVx⁵ mit Server, Name und Passwort vorausgefüllt |
| Termine umziehen | kopiert Google-Termine direkt auf dem Gerät in den neuen Kalender, mit Serien, Ausnahmen und Erinnerungen, ohne Doppelte |
| Kontakte umziehen | kopiert Google-Kontakte in das DAVx⁵-Adressbuch (mit Fotos, Nummern, Adressen, Geburtstagen) |
| Google-Sync abschalten | springt direkt in die richtige Einstellung |
| Familie dazuholen | QR-Code oder Link ohne Passwort. Auf dem **iPhone** richtet ein Profil Kalender und Kontakte ein, auf **Android** führt Terminus durch den Beitritt und übernimmt Familie, Bundesland und Kalender. Oma und Opa bekommen den Einfach-Modus vorgeschlagen |
| Akku, Morgen-Überblick, Widget | je ein Tipp, Stand wird geprüft |
| Weitere Apps | Signal, Organic Maps, Thunderbird, Bitwarden … mit „✓ installiert“ oder direktem Link |

**Wiederholbar:** Jeder Schritt lässt sich jederzeit erneut ausführen, auch erledigte. **„Alles neu prüfen“** schaut direkt auf dem Handy nach, statt gespeicherten Häkchen zu vertrauen, und nennt je Schritt den Stand, z. B. „✗ 2 Google-Kalender synchronisieren noch“ oder „✓ 214 Termine im neuen Kalender“. Erreichbar über den Assistenten, die Einstellungen, „Familie“ und das Kalender-Menü („Einrichtung prüfen“).

**Leute einladen geht immer:** Der Knopf mit der Personenfigur oben öffnet sofort einen QR-Code. Kalender (alle, die DAVx⁵ synchronisiert) und Person sind wählbar, den Link gibt es auf Wunsch. Im Kalender-Menü (⋯) hat jeder teilbare Kalender seinen eigenen „Einladen“-Knopf. Ohne geteilten Kalender empfiehlt der Code einfach Terminus weiter, ein QR-Code ist also immer da.

Was Android nicht erlaubt, macht Terminus auch nicht heimlich: Apps installiert, bestätigt und meldet sich der Nutzer selbst an. Das Konto beim Anbieter legt man einmal selbst an. Der Assistent bleibt jederzeit über „Familie“ oder die Einstellungen erreichbar, auf dem Startbildschirm zeigt ein Hinweis den Stand („6 von 10 erledigt“).

## Kalender, Aufgaben und Familie (ohne Big Tech)

Terminus ersetzt Google Kalender, ohne eigene Cloud. Synchronisiert wird über den offenen Standard **CalDAV**: Ein EU-Anbieter (mailbox.org, Posteo, Nextcloud, GMX …) speichert den Kalender, **DAVx⁵** bringt ihn auf Android-Handys, iPhones können CalDAV von Haus aus. Terminus liest und schreibt über den Android-Kalender und sieht damit alle Konten.

| Bereich | Was es kann |
|---|---|
| **Kalender** | Tag, Woche, Monat; Farben der Kalender, Feiertage und Ferien, Geburtstage aus den Kontakten, Filter nach Person, „+“ für neue Termine |
| **Termin-Details** | Mitbringliste abhaken, „Für“ und „Zuständig“ setzen, Ort in der Karten-App, teilen, löschen |
| **Aufgaben** | Fristen und Mitbringlisten aller Termine: überfällig, diese Woche, später, erledigt |
| **Familie** | Mitglieder (Kinder, Erwachsene), Familienkalender wählen, Anleitung für Android und iPhone an alle schicken |
| **Umzugshelfer** | EU-Anbieter mit Server-Adressen, DAVx⁵ einrichten, Google-Export (ZIP) oder .ics importieren, Kontakte mitnehmen, Google-Sync abschalten, Status („2 Kalender laufen noch über Google“) |
| **Widget** | Startbildschirm: Termine von heute und morgen |

**Wie die Familie Häkchen teilt:** Mitbringliste, „Für“ und „Zuständig“ stehen lesbar in der Terminbeschreibung (`☐ Laterne`, `Für: Mia`, `Zuständig: Papa`). Die Beschreibung wird per CalDAV an alle verteilt, und jede Kalender-App zeigt sie verständlich an. Erledigte Fristen bekommen ein „✓“ vor den Titel. So braucht es keinen eigenen Server und keine eigene Datenbank.

In der Web-Version zeigt der Kalender die gemerkten Termine. Der Import landet ebenfalls dort.

## Alltag

| Funktion | Was passiert |
|---|---|
| **Schnelleingabe** | Eine Zeile tippen oder mit dem Tastatur-Mikrofon diktieren: „Mi 16 Uhr Zahnarzt Ben“, „morgen 8:30 Elterngespräch @ Schule“, „dienstags 16 Uhr Schwimmkurs Mia bis 26.01.“. Namen aus der Familie werden zu „Für“ |
| **Morgen-Überblick** | Jeden Tag zur gewählten Uhrzeit eine Benachrichtigung: Termine von heute, offene Mitbringsachen, Fristen von heute und morgen. Läuft auch nach einem Neustart weiter |
| **Kalender abonnieren** | Müllabfuhr, Schule, Verein per Link (.ics/webcal). Auf Android übernimmt ICSx⁵ (Open Source, vom DAVx⁵-Team) das regelmäßige Aktualisieren |
| **Serien setzen in den Ferien aus** | Schwimmkurs oder Training fallen in den Schulferien und an Feiertagen des Bundeslands automatisch aus (als Ausnahmen der Serie, auch in anderen Kalender-Apps sichtbar) |
| **Termine bearbeiten** | Titel, Datum, Uhrzeit und Ort direkt in Terminus ändern, bei Serien wahlweise nur diesen Termin oder alle; einzelne Serientermine absagen |
| **Einfach-Modus** | Große Schrift, nur „Erfassen“ und „Heute“, etwa für Oma und Opa |
| **Sicherung** | Personen, Familie, gemerkte Termine und Einstellungen als Datei sichern und auf einem neuen Handy einlesen (ohne API-Schlüssel) |
| **App-Sperre** | Fingerabdruck oder Display-Sperre beim Öffnen und nach einer Minute im Hintergrund |

## Personen einladen

Auf jeder Terminkarte öffnet der Knopf mit der Personenfigur die Auswahl. Woher die Kontakte kommen:

- **Adressbuch des Handys** (App): Darin stehen die Kontakte aller synchronisierten Konten, also Google, Samsung und auch GMX, Web.de, Posteo oder mailbox.org, wenn sie per CardDAV eingebunden sind (z. B. mit der Open-Source-App DAVx⁵).
- **vCard-Import** (App und Web): Thunderbird: Adressbuch → Exportieren → vCard. GMX/Web.de: Adressbuch → Kontakte exportieren → vCard.
- **Adresse eintippen**: wird für das nächste Mal gemerkt.

„Einladung senden“ öffnet das eigene Mailprogramm mit allen Empfängern, einem Einladungstext und dem Termin-Link. In der App hängt zusätzlich eine Kalenderdatei an. Ist in den Einstellungen die eigene E-Mail hinterlegt, ist das eine echte Kalendereinladung: Outlook, Thunderbird oder Gmail zeigen dann Zusagen und Absagen an. Die Mail geht von der eigenen Adresse raus, Terminus selbst verschickt nichts.

## Drei Arten der Erkennung

Die Texterkennung läuft immer auf dem Handy. Mit KI geht danach nur der erkannte Text an ein kleines Modell (Ministral 8B), ein paar hundert Zeichen statt eines Fotos. Das geht schnell über Mobilfunk und kostet wenig. Nur wenn auf dem Foto kaum Text zu erkennen ist (Handschrift), geht das Bild an ein größeres Modell. Das lässt sich in den Einstellungen abschalten.

| Modus | Datenschutz | Qualität | Kosten |
|---|---|---|---|
| **Ohne KI**: Tesseract-Texterkennung auf dem Gerät plus deutsche Regeln für Datum, Fristen und Wiederholungen | nichts verlässt das Gerät | gut bei gedruckten, geraden Zetteln | 0 € |
| **Terminus-Server**: der Betreiber stellt die KI bereit (Mistral oder eigenes Modell) | nur der erkannte Text geht an den Server und an Mistral, nichts wird gespeichert | sehr gut, auch Chats und ungewöhnliche Formate | Bruchteile eines Cents pro Zettel |
| **Eigener Schlüssel / eigenes Modell**: in den Einstellungen | je nach Anbieter | sehr gut | je nach Anbieter |

## Android-App installieren (Test-Version)

1. Unter [Actions](https://github.com/baum97/terminus/actions/workflows/android.yml) den neuesten grünen Lauf öffnen und unten `terminus-apk` herunterladen (ZIP mit `terminus.apk`). Bei Versionen mit Tag (`v0.2.0` …) liegt die APK direkt unter [Releases](https://github.com/baum97/terminus/releases).
2. Die APK auf dem Handy öffnen und „Installation aus unbekannten Quellen“ für den Browser bzw. Dateimanager erlauben.
3. Neue Test-Versionen lassen sich einfach darüber installieren.

## Web-Version

Die Web-Version wird bei jeder Änderung in `www/` automatisch auf GitHub Pages veröffentlicht: https://baum97.github.io/terminus/

Einmalig nötig: im Repo unter **Settings → Pages → Build and deployment → Source** „GitHub Actions“ auswählen.

## Server mit KI

Voraussetzung: Node.js 18 oder neuer, keine weiteren Abhängigkeiten.

```bash
# Nur Erkennung auf dem Gerät
npm start

# Mit KI über Mistral (Schlüssel von console.mistral.ai)
MISTRAL_API_KEY=dein-schluessel npm start

# Mit eigenem Modell, z. B. Ollama (ollama pull mistral-small3.2)
LLM_URL=http://localhost:11434/v1/chat/completions LLM_MODEL=mistral-small3.2 npm start
```

Danach http://localhost:8080 öffnen. Modelle: `LLM_TEXT_MODEL` für Text (Standard `ministral-8b-latest`) und `LLM_MODEL` für Fotos (Standard `mistral-small-latest`). Weitere Einstellungen: `PORT`, `DAILY_LIMIT` (Fotos pro IP und Tag, Standard 30) und `CORS_ORIGINS` (Standard: die Android-App).

Damit auch die Android-App den Server nutzt, die Adresse in `www/js/config.js` bei `serverUrl` eintragen. Für den Betrieb eignet sich ein kleiner Server bei einem deutschen Anbieter (Hetzner, netcup) mit Caddy als Reverse Proxy für HTTPS.

## Selbst bauen

```bash
npm install
npm test
npm run android:build   # braucht Android SDK und Java 21
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

## Aufbau

```
www/                      Web-App, wird auch in die Android-App gepackt
  js/app.js               Ablauf und Ansichten
  js/parse.js             Erkennung ohne KI (deutsche Datums-, Zeit-, Orts- und Mitbring-Regeln)
  js/llm.js               KI-Anbindung (OpenAI-kompatibel: Mistral, Ollama, vLLM, …)
  js/ocr.js               Texterkennung auf dem Gerät (Tesseract, liegt in www/vendor/)
  js/ics.js               Kalenderdatei und Google-Link
  js/share.js             Termin-Links, WhatsApp, E-Mail, Einladungstext
  js/contacts.js          vCard-Import und Kontaktliste
  js/holidays.js          Feiertage (berechnet) und Schulferien
  js/hub.js               Kalender, Aufgaben, Familie, Umzugshelfer
  js/calendar.js          Einträge vereinheitlichen, Serien aufklappen, Geburtstage
  js/desc.js              gemeinsame Angaben in der Terminbeschreibung
  js/icsimport.js         .ics-Import mit Zeitzonen
  js/unzip.js             ZIP-Leser für den Google-Export
  js/quick.js             Schnelleingabe
  js/backup.js            Sicherung
  js/setup.js             Einrichtungsassistent und Beitritt
  js/setupdata.js         Anbieter, App-Empfehlungen, Beitrittslinks, iPhone-Profil
  data/ferien.json        Schulferien, beim Build erzeugt
  js/native.js            Brücke zur Android-App
  js/config.js            öffentliche Adressen (Web-Version, Server)
android/                  Android-Projekt (Capacitor)
  …/TerminusPlugin.java   Teilen-Menü, Kalender lesen/schreiben, Adressbuch, Geburtstage, Einladungs-Mail
  …/TerminusWidget.java   Startbildschirm-Widget
  …/MorningBrief.java     Morgen-Überblick (Wecker, Neustart, Benachrichtigung)
  …/Setup.java            Umzug von Kalendern und Kontakten auf dem Gerät, Zugangsprüfung
docs/ROADMAP.md           Merkzettel für spätere Ausbaustufen (Listen über VTODO)
proxy/server.mjs          Server: liefert die Web-App aus und reicht KI-Anfragen weiter
scripts/ferien.mjs        lädt die Schulferien aller Bundesländer
.github/workflows/        APK bauen, Web-Version veröffentlichen
```

## Bekannte Grenzen

- Die APK ist mit einem öffentlichen Test-Schlüssel signiert. Für Play Store und F-Droid braucht es einen eigenen, geheimen Schlüssel.
- **iPhone**: Die Web-Version kann nicht im iOS-Teilen-Menü erscheinen. Dort Screenshot machen und in Terminus „Bild oder Screenshot“ wählen.
- **WhatsApp** öffnet sich mit fertiger Nachricht, absenden muss man selbst.
- Die Erkennung ohne KI kann keine Handschrift lesen, versteht keine relativen Angaben wie „nächsten Freitag“ und übersetzt nicht.
- Feiertage einzelner Gemeinden (z. B. Fronleichnam in Teilen Sachsens) fehlen.

## Nächste Schritte

1. Veröffentlichung auf F-Droid und im Play Store
2. Listen und echte Aufgaben über den offenen Standard VTODO (Paket B, siehe docs/ROADMAP.md)
3. Mailversand mit echter Einladung über einen EU-Mailanbieter
4. Unterstützung per Spende (Liberapay, Open Collective) oder Pro-Funktionen für Vereine und Kitas

## Lizenz

Terminus steht unter der [EUPL-1.2](LICENSE). Mitgelieferte Bibliotheken: Tesseract und tesseract.js (Apache-2.0), Capacitor (MIT), qrcode-generator von Kazuhiko Arase (MIT), siehe `www/vendor/`.
