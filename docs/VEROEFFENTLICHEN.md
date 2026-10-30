# Terminus veröffentlichen

**Brauche ich einen Server? Nein.** Terminus ist eine Handy-App, die alles Wichtige auf dem Gerät erledigt:

| Funktion | ohne Server | mit Terminus-Server |
|---|---|---|
| Foto, Screenshot, PDF, Sprache → Termin (ohne KI) | ✓ auf dem Gerät | ✓ |
| KI-Erkennung | ✓ mit eigenem Mistral-Schlüssel des Nutzers | ✓ für alle, ohne eigenen Schlüssel (du zahlst die KI) |
| Termine und Kalender verschicken, Terminfindung, Zusagen | ✓ über Messenger-Links | ✓ |
| Kalender, Kontakte, Listen synchronisieren | ✓ über DAVx⁵ beim Mail-Anbieter | ✓ |
| Abo-Links, die sich selbst aktualisieren (auch iPhone, Outlook) | – | ✓ |
| Web-Version | statischer Webspeicher reicht (kostenlos) | ✓ liefert sie gleich mit aus |

Empfehlung: **Erst ohne Server starten** (Schritte 1–7). Den Server (Schritt 8) erst, wenn Leute danach fragen.

---

## Schritt 1: Eigenen App-Schlüssel erzeugen (einmalig, 5 Minuten)

Android-Apps werden signiert. Wer den Schlüssel hat, kann Updates veröffentlichen. **Verlierst du ihn, kann niemand mehr ein Update installieren**, alle müssten neu installieren. Darum: gut aufbewahren, nie ins Repo.

Auf deinem Rechner (Java muss installiert sein, z. B. `sudo apt install openjdk-21-jdk`):

```bash
keytool -genkeypair -v -keystore terminus-release.jks -alias terminus \
  -keyalg RSA -keysize 4096 -validity 10000
```

- Fragt zweimal nach einem Passwort: ein langes, zufälliges nehmen, im Passwortmanager speichern (z. B. KeePassXC).
- Name/Organisation: Dein Name reicht.
- Die Datei `terminus-release.jks` **zweimal sichern** (USB-Stick + Passwortmanager-Anhang).

## Schritt 2: Schlüssel in GitHub hinterlegen

GitHub baut die App automatisch. Damit es signieren kann, bekommt es den Schlüssel als geheime Variable:

```bash
base64 -w0 terminus-release.jks > keystore.txt     # macOS: base64 -i terminus-release.jks > keystore.txt
```

Im Repo auf GitHub: **Settings → Secrets and variables → Actions → New repository secret**

| Name | Wert |
|---|---|
| `TERMINUS_KEYSTORE_BASE64` | Inhalt von `keystore.txt` |
| `TERMINUS_KEYSTORE_PASSWORD` | dein Passwort |

Danach `keystore.txt` löschen.

## Schritt 3: Web-Version einschalten

GitHub: **Settings → Pages → Build and deployment → Source: „GitHub Actions“**. Dann unter **Actions → „Web-Version veröffentlichen“ → Run workflow**.
Nach etwa einer Minute läuft Terminus unter `https://baum97.github.io/terminus/`. Diese Adresse steckt in allen Einladungs-, Kalender- und Abstimmungslinks.

> **Unabhängig von US-Diensten?** GitHub gehört Microsoft. Gleichwertige Alternative aus Deutschland: **Codeberg** (gemeinnütziger Verein, Berlin). Repo dort spiegeln und **Codeberg Pages** nutzen; dann in `www/js/config.js` `publicUrl` auf die neue Adresse ändern. Kann man jederzeit später machen. Alte Links funktionieren dann aber nicht mehr, also am besten vor dem großen Start entscheiden.

## Schritt 4: Version festlegen und veröffentlichen

1. In `android/app/build.gradle` `versionCode` um 1 erhöhen und `versionName` setzen (z. B. `1.0.0`). In `package.json` dieselbe `version`.
2. Kurz in `fastlane/metadata/android/de-DE/changelogs/<versionCode>.txt` schreiben, was neu ist.
3. Committen, dann ein Tag setzen und pushen:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub baut jetzt eine **signierte APK** und legt unter **Releases** eine Version an. Den Link zur APK kann man schon weitergeben (Installation aus „unbekannten Quellen“ erlauben).

## Schritt 5: In App-Stores bringen

| Store | Wer nutzt das | Aufwand | Empfehlung |
|---|---|---|---|
| **IzzyOnDroid** (F-Droid-Paketquelle) | Open-Source-Fans | gering: holt die APK automatisch aus GitHub-Releases | **zuerst** |
| **F-Droid** (Hauptquelle) | Open-Source-Fans, datenschutzbewusst | mittel: F-Droid baut selbst aus dem Quellcode, Prüfung dauert Wochen | danach |
| **Google Play** | fast alle Android-Nutzer | 25 $ einmalig, Google-Konto, Identitätsprüfung, Datenschutz-Fragebogen | wenn du Reichweite willst |

**IzzyOnDroid:** Auf <https://gitlab.com/IzzyOnDroid/repo> ein Issue „Inclusion request: Terminus“ mit Link zum GitHub-Repo eröffnen. Voraussetzungen erfüllt Terminus: Open-Source-Lizenz (EUPL), signierte APK im Release, keine Tracker. Beschreibungen und Screenshots liest IzzyOnDroid aus `fastlane/metadata/`.

**F-Droid:** Anleitung <https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/>. Kurz: `fdroiddata` auf GitLab forken, Datei `metadata/io.github.baum97.terminus.yml` anlegen, Merge Request stellen. Die Prüfer fragen eventuell nach den mitgelieferten Bibliotheken in `www/vendor/` (Tesseract, pdf.js, QR-Code); alle sind Open Source, die Quellen stehen in `www/vendor/README.md`.

**Google Play:** <https://play.google.com/console> → App erstellen → „App-Signatur durch Google Play“ akzeptieren und `./gradlew bundleRelease` (AAB statt APK) hochladen. Datenschutz-URL: `https://baum97.github.io/terminus/datenschutz.html`. Beim Fragebogen „Datensicherheit“: keine Daten erfasst, keine Daten geteilt (die KI ist optional und wird vom Nutzer selbst eingestellt).

## Schritt 6: Rechtliches (Deutschland)

- **Datenschutzerklärung:** liegt fertig in `www/datenschutz.html`. Im gelben Feld **deinen Namen, deine Anschrift und E-Mail** eintragen. Pflicht für Google Play und für die Web-Version.
- **Impressum:** Sobald das Angebot „geschäftsmäßig“ ist (Spenden, Werbung, Verkauf, also auch beim Nebenverdienst), brauchst du nach § 5 DDG ein Impressum mit ladungsfähiger Anschrift. Wer die Privatadresse nicht veröffentlichen will, nutzt einen Impressums-Service (eine Postanschrift, ca. 5–15 €/Monat).
- **Einnahmen:** Spenden über Liberapay oder Ko-fi sind am einfachsten. Kleine Einnahmen beim Finanzamt angeben; bis 25 000 € Umsatz im Vorjahr gilt meist die Kleinunternehmerregelung (keine Umsatzsteuer). Im Zweifel kurz bei einer Steuerberatung nachfragen.
- **Lizenz:** EUPL-1.2 steht im Repo. Jeder darf die App nutzen und verändern, Änderungen müssen offen bleiben.

## Schritt 7: Testen vor dem großen Start

Auf **mindestens zwei echten Handys** (ideal: ein älteres mit Android 8–10, ein neues):

- [ ] Installieren, Einrichtungsassistent komplett durchlaufen
- [ ] Zettel fotografieren → Termin; Screenshot aus WhatsApp teilen → Termin; PDF teilen → Termin
- [ ] Spracheingabe
- [ ] Kalender verschicken, auf dem zweiten Handy antippen, Update senden
- [ ] Terminfindung: Abstimmung schicken, vom zweiten Handy antworten, Ergebnis übernehmen
- [ ] Morgen-Überblick (Benachrichtigung am nächsten Morgen), Widget, App-Sperre
- [ ] Sicherung erstellen, App löschen, neu installieren, Sicherung einspielen

Fehler am besten als GitHub-Issue sammeln.

## Schritt 8 (optional): Eigener Server

Nur nötig für **KI ohne eigenen Schlüssel** und **Abo-Links**. Ein kleiner Server in Deutschland reicht (z. B. Hetzner CX22 in Nürnberg/Falkenstein, ca. 4 €/Monat, oder Netcup).

```bash
# auf dem Server (Debian/Ubuntu)
sudo apt install docker.io caddy git
git clone https://github.com/Baum97/terminus.git && cd terminus
sudo docker build -t terminus .
sudo docker run -d --restart unless-stopped --name terminus -p 127.0.0.1:8080:8080 \
  -v terminus-data:/data \
  -e MISTRAL_API_KEY=dein-schluessel \
  -e PUBLIC_URL=https://terminus.deine-domain.de \
  -e DAILY_LIMIT=30 \
  terminus
```

HTTPS mit Caddy (`/etc/caddy/Caddyfile`), danach `sudo systemctl reload caddy`:

```
terminus.deine-domain.de {
  reverse_proxy 127.0.0.1:8080
}
```

Dann in `www/js/config.js` `serverUrl: 'https://terminus.deine-domain.de/'` eintragen und eine neue Version veröffentlichen (Schritt 4).

| Einstellung | Bedeutung |
|---|---|
| `MISTRAL_API_KEY` | Schlüssel von <https://console.mistral.ai> (Mistral AI, Paris). Ohne: Server läuft ohne KI |
| `DAILY_LIMIT` | KI-Anfragen pro Nutzer und Tag (schützt deine Rechnung) |
| `PUBLIC_URL` | öffentliche Adresse für Abo-Links |
| `ABO_DAILY` | neue Abo-Links pro IP und Tag |
| `CORS_ORIGINS` | weitere erlaubte Web-Adressen, kommagetrennt |

**Kosten der KI:** Ein Text kostet mit `ministral-8b` etwa 0,0001 €, also 10 000 Erkennungen ≈ 1 €. Bilder (nur wenn der Text unlesbar ist) etwa das Zehnfache.
