// Lädt die Schulferien aller Bundesländer von der OpenHolidays-API (offene Daten, EU-gefördert)
// und schreibt www/data/ferien.json. Läuft beim Build auf GitHub; die App liest die Datei offline.
//   node scripts/ferien.mjs
import { writeFile } from 'node:fs/promises';

const API = 'https://openholidaysapi.org/SchoolHolidays';
const year = new Date().getFullYear();
const out = {};

for (const y of [year - 1, year, year + 1, year + 2]) {
  const url = `${API}?countryIsoCode=DE&languageIsoCode=DE&validFrom=${y}-01-01&validTo=${y}-12-31`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`OpenHolidays ${y}: HTTP ${res.status}`);
  for (const h of await res.json()) {
    const name = (h.name.find((n) => n.language === 'DE') || h.name[0])?.text || 'Ferien';
    // Nur Ferien, die ein ganzes Bundesland betreffen (Code "DE-BY"), keine einzelnen Orte.
    const states = h.nationwide ? ['BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV', 'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH']
      : (h.subdivisions || []).map((s) => s.code).filter((c) => /^DE-[A-Z]{2}$/.test(c)).map((c) => c.slice(3));
    for (const st of states) {
      out[st] ||= [];
      if (!out[st].some((p) => p.start === h.startDate && p.end === h.endDate)) {
        out[st].push({ name, start: h.startDate, end: h.endDate });
      }
    }
  }
}
for (const st of Object.keys(out)) out[st].sort((a, b) => a.start.localeCompare(b.start));
if (Object.keys(out).length < 16) throw new Error(`Nur ${Object.keys(out).length} Bundesländer erhalten`);
await writeFile(new URL('../www/data/ferien.json', import.meta.url), JSON.stringify(out));
console.log(`Ferien gespeichert: ${Object.values(out).reduce((n, l) => n + l.length, 0)} Zeiträume für ${Object.keys(out).length} Bundesländer`);
