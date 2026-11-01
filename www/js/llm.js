// KI-Erkennung über eine OpenAI-kompatible Chat-Schnittstelle.
// Funktioniert mit Mistral (EU), Ollama, vLLM, LocalAI oder dem mitgelieferten Server.
import { WEEKDAYS, toISO } from './dates.js';
import { normalizeEvents } from './events.js';

// model: kleines Textmodell für den auf dem Handy erkannten Text (Standardweg).
// visionModel: nur wenn auf dem Foto kein Text erkannt wurde (z. B. Handschrift).
export const PROVIDERS = {
  server: {
    label: 'Terminus-Server',
    hint: 'Der Betreiber stellt die KI bereit. Du brauchst keinen Schlüssel.',
    endpoint: 'api/chat',
    model: '',
    needsKey: false,
  },
  mistral: {
    label: 'Mistral AI (Paris)',
    hint: 'Eigener API-Schlüssel von console.mistral.ai. Er bleibt nur auf diesem Gerät.',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    model: 'ministral-8b-latest',
    visionModel: 'mistral-small-latest',
    needsKey: true,
  },
  custom: {
    label: 'Eigenes Modell',
    hint: 'Ollama, vLLM oder LocalAI im eigenen Netz, z. B. Mistral Small 3.2 oder Qwen 2.5.',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'mistral-small3.2',
    needsKey: false,
  },
  local: {
    label: 'Ohne KI',
    hint: 'Alles läuft auf dem Gerät, nichts wird hochgeladen. Bei Handschrift und schrägen Fotos ungenauer.',
  },
};

export const LANGUAGES = {
  de: 'Deutsch', en: 'English', tr: 'Türkçe', ar: 'العربية', uk: 'Українська', ru: 'Русский', pl: 'Polski', ro: 'Română', fa: 'فارسی',
};

// Bewusst kurz: weniger Eingabe-Token, schnellere Antwort über Mobilfunk.
export function systemPrompt(today = new Date(), lang = 'de') {
  return `Extrahiere Termine und Fristen aus Zettel, Brief, Plakat oder Chat. Heute: ${WEEKDAYS[today.getDay()]}, ${toISO(today)}, Europe/Berlin.
Nur JSON: {"events":[{"title":"","date":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","endDate":"","location":"","bring":[],"cost":"","notes":"","kind":"frist","repeat":"weekly","until":"","unsure":true}]}
Leere oder unbekannte Felder weglassen.
- title: höchstens 5 Wörter, konkret.
- Ohne Jahr: nächstes Vorkommen. "morgen", "nächsten Freitag" auflösen.
- Mehrtägig (Ferien): endDate, ohne Uhrzeit.
- Frist ("Anmeldung bis", "abgeben bis", "überweisen bis"): eigener Eintrag, kind "frist", title z. B. "Anmeldung Ausflug".
- Wiederholt ("dienstags", "jeden Montag", "alle 2 Wochen", "monatlich"): repeat "daily", "weekly", "biweekly" oder "monthly", date = erstes Vorkommen ab heute, until = Ende falls genannt.
- bring: Stichworte. cost: z. B. "3 €". notes: höchstens 1 Satz.
- unsure: true, wenn unleserlich oder Wochentag und Datum nicht zusammenpassen.
- title, bring, notes auf ${LANGUAGES[lang] || 'Deutsch'}.
- Nichts erfinden. Keine Termine: {"events":[]}`;
}

export class LLMError extends Error {
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

function contentText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => p.text || '').join('');
  return '';
}

export function parseReply(text) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new LLMError('Die KI hat keine lesbare Antwort geliefert.', 'format');
  const obj = JSON.parse(cleaned.slice(start, end + 1));
  return normalizeEvents(Array.isArray(obj) ? obj : obj.events);
}

// text: auf dem Gerät erkannter Text (bevorzugt). imageDataUrl: nur als Rückfall.
export async function extractWithLLM({ settings, imageDataUrl, text, today = new Date(), signal }) {
  const preset = PROVIDERS[settings.provider];
  const endpoint = settings.endpoint || preset.endpoint;
  const useImage = !text && imageDataUrl;
  const model = useImage ? preset.visionModel || settings.model || preset.model : settings.model || preset.model;
  const content = [{ type: 'text', text: text ? `Text:\n${text.slice(0, 4000)}` : 'Finde alle Termine auf dem Bild.' }];
  if (useImage) {
    // Mistral dokumentiert image_url als String, OpenAI-kompatible Server erwarten ein Objekt.
    content.push({ type: 'image_url', image_url: settings.provider === 'mistral' ? imageDataUrl : { url: imageDataUrl } });
  }
  const body = {
    model,
    mode: useImage ? 'image' : 'text',
    temperature: 0.1,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt(today, settings.lang) },
      { role: 'user', content },
    ],
  };
  if (settings.provider !== 'server') delete body.mode;
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  let res;
  try {
    res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new LLMError('Die KI ist nicht erreichbar. Prüfe die Internetverbindung oder die Adresse in den Einstellungen.', 'network');
  }
  if (res.status === 401 || res.status === 403) throw new LLMError('Der API-Schlüssel wurde abgelehnt. Trage in den Einstellungen einen gültigen Schlüssel ein.', 'auth');
  if (res.status === 429) throw new LLMError('Zu viele Anfragen in kurzer Zeit. Warte einen Moment oder lies den Zettel ohne KI aus.', 'limit');
  if (!res.ok) throw new LLMError(`Die KI hat mit Fehler ${res.status} geantwortet.`, 'http');
  const data = await res.json();
  try {
    return parseReply(contentText(data.choices?.[0]?.message));
  } catch (e) {
    if (e instanceof LLMError) throw e;
    throw new LLMError('Die Antwort der KI war kein gültiges JSON.', 'format');
  }
}

// „Brief verstehen“: Zusammenfassung in einfacher Sprache, auf Wunsch übersetzt.
export function explainPrompt(lang = 'de') {
  return `Erkläre den Text (Brief, Elternbrief, Aushang) in einfacher Sprache auf ${LANGUAGES[lang] || 'Deutsch'}.
Nur JSON: {"summary":"","todo":[""],"dates":[""]}
- summary: 2 bis 4 kurze Sätze. Worum geht es, wer schreibt, was ist wichtig.
- todo: was der Empfänger tun muss (unterschreiben, zahlen, mitbringen, antworten), je höchstens 12 Wörter. Leer, wenn nichts.
- dates: wichtige Daten und Fristen als kurzer Text, z. B. "Fr 14.11.: Laternenfest 17 Uhr".
- Kurze Sätze, keine Fachwörter. Nichts erfinden.`;
}

export async function explainWithLLM({ settings, text, lang, signal }) {
  const preset = PROVIDERS[settings.provider];
  if (!preset?.endpoint && !settings.endpoint) throw new LLMError('Für „Brief verstehen“ braucht es die KI. Schalte sie in den Einstellungen ein.', 'off');
  const body = {
    model: settings.model || preset.model,
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: explainPrompt(lang || settings.lang) }, { role: 'user', content: `Text:\n${String(text).slice(0, 5000)}` }],
  };
  if (settings.provider === 'server') body.mode = 'text';
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  let res;
  try {
    res = await fetch(settings.endpoint || preset.endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new LLMError('Die KI ist nicht erreichbar. Prüfe die Internetverbindung.', 'network');
  }
  if (!res.ok) throw new LLMError(res.status === 401 || res.status === 403 ? 'Der API-Schlüssel wurde abgelehnt.' : `Die KI hat mit Fehler ${res.status} geantwortet.`, 'http');
  const raw = contentText((await res.json()).choices?.[0]?.message).replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const o = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, 10) : []);
    return { summary: String(o.summary || '').trim().slice(0, 1200), todo: list(o.todo), dates: list(o.dates) };
  } catch {
    throw new LLMError('Die Antwort der KI war nicht lesbar.', 'format');
  }
}
