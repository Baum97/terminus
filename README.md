# Terminus

**Zettel knipsen. Termin steht.**

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

## Personen einladen

Auf jeder Terminkarte öffnet der Knopf mit der Personenfigur die Auswahl. Woher die Kontakte kommen:

- **Adressbuch des Handys** (App): Darin stehen die Kontakte aller synchronisierten Konten, also Google, Samsung und auch GMX, Web.de, Posteo oder mailbox.org, wenn sie per CardDAV eingebunden sind (z. B. mit der Open-Source-App DAVx⁵).
- **vCard-Import** (App und Web): Thunderbird: Adressbuch → Exportieren → vCard. GMX/Web.de: Adressbuch → Kontakte exportieren → vCard.
- **Adresse eintippen**: wird für das nächste Mal gemerkt.

„Einladung senden“ öffnet das eigene Mailprogramm mit allen Empfängern, einem Einladungstext und dem Termin-Link. In der App hängt zusätzlich eine Kalenderdatei an. Ist in den Einstellungen die eigene E-Mail hinterlegt, ist das eine echte Kalendereinladung: Outlook, Thunderbird oder Gmail zeigen dann Zusagen und Absagen an. Die Mail geht von der eigenen Adresse raus, Terminus selbst verschickt nichts.

## Drei Arten der Erkennung

| Modus | Datenschutz | Qualität | Kosten |
|---|---|---|---|
| **Ohne KI**: Tesseract-Texterkennung auf dem Gerät plus deutsche Datumsregeln | Foto bleibt auf dem Gerät | gut bei gedruckten, geraden Zetteln | 0 € |
| **Terminus-Server**: der Betreiber stellt die KI bereit (Mistral oder eigenes Modell) | Foto geht an den Server und an Mistral, wird nicht gespeichert | sehr gut, auch Handschrift und Chats | Bruchteile eines Cents pro Foto |
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

Danach http://localhost:8080 öffnen. Weitere Einstellungen: `PORT`, `DAILY_LIMIT` (Fotos pro IP und Tag, Standard 30) und `CORS_ORIGINS` (Standard: die Android-App).

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
  js/native.js            Brücke zur Android-App
  js/config.js            öffentliche Adressen (Web-Version, Server)
android/                  Android-Projekt (Capacitor)
  …/TerminusPlugin.java   Teilen-Menü, Kalender, Adressbuch, Einladungs-Mail
proxy/server.mjs          Server: liefert die Web-App aus und reicht KI-Anfragen weiter
.github/workflows/        APK bauen, Web-Version veröffentlichen
```

## Bekannte Grenzen

- Die APK ist mit einem öffentlichen Test-Schlüssel signiert. Für Play Store und F-Droid braucht es einen eigenen, geheimen Schlüssel.
- **iPhone**: Die Web-Version kann nicht im iOS-Teilen-Menü erscheinen. Dort Screenshot machen und in Terminus „Bild oder Screenshot“ wählen.
- **WhatsApp** öffnet sich mit fertiger Nachricht, absenden muss man selbst.
- Die Erkennung ohne KI kann keine Handschrift lesen und versteht keine relativen Angaben wie „nächsten Freitag“.

## Nächste Schritte

1. Veröffentlichung auf F-Droid und im Play Store
2. Gruppen („Kita-Termine immer an beide Eltern“) und Zusagen in der App anzeigen
3. Mailversand mit echter Einladung über einen EU-Mailanbieter
4. Unterstützung per Spende (Liberapay, Open Collective) oder Pro-Funktionen für Vereine und Kitas

## Lizenz

Terminus steht unter der [EUPL-1.2](LICENSE). Mitgelieferte Bibliotheken: Tesseract und tesseract.js (Apache-2.0), Capacitor (MIT), siehe `www/vendor/`.
