// Abfuhrkalender vom Foto oder PDF: „Restmüll: 07.01., 21.01. …“, Blöcke je Tonne oder Zeilen je Datum.
// Jede Abholung wird ein ganztägiger Termin mit Erinnerung am Vorabend („rausstellen“).
import { findDates } from './parse.js';
import { normalizeEvent } from './events.js';

export const BINS = [
  [/restm[üu]ll|restabfall|graue tonne|schwarze tonne/i, 'Restmüll', '⚫'],
  [/bio(m[üu]ll|tonne|abfall)?\b|braune tonne/i, 'Biomüll', '🟤'],
  [/(alt)?papier|blaue tonne|pappe/i, 'Papier', '🔵'],
  [/gelbe[rn]? (sack|tonne)|wertstoff|leichtverpackung|verpackung|\blvp\b/i, 'Gelber Sack', '🟡'],
  [/(alt)?glas\b/i, 'Glas', '🟢'],
  [/sperrm[üu]ll/i, 'Sperrmüll', '🛋️'],
  [/schadstoff|problemm[üu]ll|giftmobil/i, 'Schadstoffmobil', '☣️'],
  [/gr[üu]nschnitt|gartenabf[äa]ll|laub/i, 'Grünschnitt', '🌿'],
  [/weihnachtsb[äa]um|tannenb[äa]um|christb[äa]um/i, 'Weihnachtsbäume', '🎄'],
];

const binsIn = (line) => BINS.filter(([re]) => re.test(line));

export function parseWaste(text, today = new Date()) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!lines.some((l) => binsIn(l).length) || !/abfuhr|abfall|tonne|m[üu]ll|entsorgung|abholung/i.test(text)) return [];
  const hits = new Map();
  let current = [];
  const add = (bin, date) => hits.set(`${bin[1]}|${date}`, { bin, date });
  for (const line of lines) {
    const bins = binsIn(line);
    const dates = findDates(line, today).dates.filter((d) => d.date && !d.endDate).map((d) => d.date);
    if (bins.length && !dates.length) {
      current = bins; // Überschrift eines Blocks
      continue;
    }
    if (!dates.length) continue;
    if (bins.length && dates.length === 1) bins.forEach((b) => add(b, dates[0])); // "Mi 07.01. Restmüll, Papier"
    else if (bins.length) dates.forEach((d) => add(bins[0], d)); // "Restmüll: 07.01., 21.01."
    else if (current.length) dates.forEach((d) => current.forEach((b) => add(b, d)));
  }
  if (hits.size < 4) return [];
  return [...hits.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.bin[1].localeCompare(b.bin[1]))
    .map(({ bin, date }) => normalizeEvent({ title: `${bin[2]} ${bin[1]}`, date, notes: 'Abfuhrkalender: am Vorabend rausstellen', eveAlarm: true }))
    .filter(Boolean);
}
