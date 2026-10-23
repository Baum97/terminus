# Terminus

**Zettel knipsen. Termin steht.**

Du fotografierst einen Elternbrief, ein Plakat, eine Einladung oder einen Chat-Screenshot. Terminus findet Datum, Uhrzeit, Ort, Mitbringliste und Kosten und macht daraus Kalendertermine. Die Termine kannst du per WhatsApp oder E-Mail an andere schicken (Oma, Partner, Tagesmutter). Wer den Link öffnet, übernimmt den Termin mit einem Tipp in den eigenen Kalender, auch ohne Terminus.

- **Open Source** (EUPL-1.2, die Open-Source-Lizenz der EU)
- **Kostenlos**, ohne Konto, ohne Werbung, ohne Tracker
- **Unabhängig von US-Konzernen**: KI über Mistral (Paris) oder ein eigenes Modell. Es gibt auch einen Modus ganz ohne KI, in dem nichts das Gerät verlässt.
- Keine Google Fonts und keine CDNs. Alles wird vom eigenen Server ausgeliefert.

## Funktionen

| | |
|---|---|
| Foto, Bild, Screenshot, eingefügter Text, Strg+V, Drag & Drop | Eingabe |
| Viele Termine aus einem Dokument (Terminplan, Ferienliste) | Erkennung |
| Mehrtägige Termine, Kalenderwoche, Prüfung von Wochentag und Datum | Erkennung |
| `.ics`-Datei (Apple, Outlook, Thunderbird, Android), Google-Kalender-Link | Export |
| Erinnerung und Standarddauer einstellbar | Export |
| WhatsApp, E-Mail, Teilen-Menü des Handys (mit `.ics`-Anhang), gespeicherte Personen | Teilen |
| Termin-Link: Der Termin steckt im `#`-Teil der Adresse und wird nie an einen Server geschickt | Teilen |
| Installierbar als App (PWA), offline nutzbar, unter Android im Teilen-Menü | App |

## Drei Arten der Erkennung

| Modus | Datenschutz | Qualität | Kosten |
|---|---|---|---|
| **Ohne KI**: Tesseract-Texterkennung im Browser plus deutsche Datumsregeln | Foto bleibt auf dem Gerät | gut bei gedruckten, geraden Zetteln | 0 € |
| **Terminus-Server**: der Betreiber stellt die KI bereit (Mistral oder eigenes Modell) | Foto geht an den Server und an Mistral, wird nicht gespeichert | sehr gut, auch Handschrift und Chats | Bruchteile eines Cents pro Foto |
| **Eigener Schlüssel / eigenes Modell**: in den Einstellungen | je nach Anbieter | sehr gut | je nach Anbieter |

## Starten

Voraussetzung: Node.js 18 oder neuer. Es gibt keine Abhängigkeiten, `npm install` ist nicht nötig.

```bash
# Nur Erkennung auf dem Gerät
npm start

# Mit KI über Mistral (Schlüssel von console.mistral.ai)
MISTRAL_API_KEY=dein-schluessel npm start

# Mit eigenem Modell, z. B. Ollama (ollama pull mistral-small3.2)
LLM_URL=http://localhost:11434/v1/chat/completions LLM_MODEL=mistral-small3.2 npm start
```

Danach http://localhost:8080 öffnen. Weitere Einstellungen: `PORT` und `DAILY_LIMIT` (Fotos pro IP und Tag, Standard 30).

**Ohne Server**: Der Ordner funktioniert auch als reine statische Seite, z. B. auf Codeberg Pages (Berlin) oder einem Webspace. Dann gibt es den Modus ohne KI sowie KI mit eigenem Schlüssel.

**Auf dem Handy testen**: Kamera, Teilen und Installation brauchen HTTPS. Am einfachsten: auf einem kleinen Server mit Caddy als Reverse Proxy betreiben, z. B. bei Hetzner oder netcup. Caddy holt das Zertifikat automatisch.

## Tests

```bash
npm test
```

## Aufbau

```
index.html, css/app.css   Oberfläche
js/app.js                 Ablauf und Ansichten
js/parse.js               Erkennung ohne KI (deutsche Datums-, Zeit-, Orts- und Mitbring-Regeln)
js/llm.js                 KI-Anbindung (OpenAI-kompatibel: Mistral, Ollama, vLLM, …)
js/ocr.js                 Texterkennung auf dem Gerät (Tesseract, liegt in vendor/)
js/ics.js                 Kalenderdatei und Google-Link
js/share.js               Termin-Links, WhatsApp, E-Mail
js/store.js               Speicher auf dem Gerät (localStorage)
sw.js, manifest           Offline, Installation, Android-Teilen
proxy/server.mjs          Server: liefert die App aus und reicht KI-Anfragen weiter
```

## Bekannte Grenzen des Prototyps

- **iPhone**: Eine Web-App kann nicht im iOS-Teilen-Menü erscheinen. Bis es eine native App gibt: Screenshot machen und in Terminus „Bild oder Screenshot“ wählen.
- **WhatsApp** ohne Business-API: Die App öffnet WhatsApp mit fertiger Nachricht, absenden muss man selbst.
- **E-Mail** öffnet das Mailprogramm. Echte Kalendereinladungen per Mail brauchen einen Mailversand auf dem Server (nächster Schritt).
- Die Erkennung ohne KI kann keine Handschrift lesen und versteht keine relativen Angaben wie „nächsten Freitag“.

## Ideen für die nächsten Schritte

1. Mailversand mit echter Einladung (`METHOD:REQUEST`) über einen EU-Mailanbieter
2. Familiengruppen: Regeln wie „Kita-Termine immer an beide Eltern“
3. Kalender-Abo (CalDAV/Webcal) statt Einzeldateien
4. Native App mit Expo für das iOS-Teilen-Menü
5. Unterstützung per Spende (Liberapay, Open Collective) oder Pro-Funktionen für Vereine und Kitas

## Lizenz

Terminus steht unter der [EUPL-1.2](LICENSE). Die Texterkennung Tesseract und tesseract.js stehen unter Apache-2.0 (siehe `vendor/tesseract/`).
