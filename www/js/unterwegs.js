// Fahrzeit zum Termin über offene Dienste aus der OpenStreetMap-Welt:
// Ortssuche Nominatim, Routen für Auto/Rad/zu Fuß vom FOSSGIS e.V. (Server in Deutschland),
// Bus und Bahn über Transitous (gemeinschaftlich betrieben, offene Fahrplandaten).
export const MODES = {
  auto: { label: 'Auto', icon: '🚗', profile: 'routed-car', osrm: 'driving' },
  rad: { label: 'Rad', icon: '🚲', profile: 'routed-bike', osrm: 'driving' },
  fuss: { label: 'zu Fuß', icon: '🚶', profile: 'routed-foot', osrm: 'driving' },
  oepnv: { label: 'Bus und Bahn', icon: '🚆' },
};

const cache = new Map();

export async function geocode(query, fetchImpl = fetch) {
  const q = String(query || '').trim();
  if (!q) return null;
  if (cache.has(q)) return cache.get(q);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=de,at,ch&accept-language=de&q=${encodeURIComponent(q)}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Ortssuche nicht erreichbar (${res.status})`);
  const [hit] = await res.json();
  const point = hit ? { lat: +hit.lat, lon: +hit.lon, name: hit.display_name } : null;
  cache.set(q, point);
  return point;
}

// Minuten von a nach b. arrive: Ankunftszeit (Date), nur für Bus und Bahn wichtig.
export async function travelMinutes(a, b, mode, arrive, fetchImpl = fetch) {
  if (mode === 'oepnv') {
    const url = `https://api.transitous.org/api/v1/plan?fromPlace=${a.lat},${a.lon}&toPlace=${b.lat},${b.lon}&time=${arrive.toISOString()}&arriveBy=true`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Fahrplanauskunft nicht erreichbar (${res.status})`);
    const data = await res.json();
    const best = (data.itineraries || []).filter((i) => new Date(i.endTime) <= arrive).sort((x, y) => new Date(y.startTime) - new Date(x.startTime))[0];
    if (!best) return null;
    return { minutes: Math.ceil((arrive - new Date(best.startTime)) / 60000), depart: new Date(best.startTime), legs: (best.legs || []).filter((l) => l.mode !== 'WALK').map((l) => l.routeShortName || l.mode) };
  }
  const m = MODES[mode] || MODES.auto;
  const url = `https://routing.openstreetmap.de/${m.profile}/route/v1/${m.osrm}/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Routenplaner nicht erreichbar (${res.status})`);
  const data = await res.json();
  const sec = data.routes?.[0]?.duration;
  return sec == null ? null : { minutes: Math.max(1, Math.ceil(sec / 60)) };
}

// "Losfahren um 9:35 (🚲 25 Min.)"
export function leaveText(start, minutes, mode) {
  const [h, mi] = start.split(':').map(Number);
  const t = (h * 60 + mi - minutes - 5 + 1440) % 1440;
  const hhmm = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  return `Losfahren um ${hhmm} (${MODES[mode]?.icon || ''} ${minutes} Min.)`;
}
