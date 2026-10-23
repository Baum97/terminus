// KI-Erkennung über eine OpenAI-kompatible Chat-Schnittstelle.
// Funktioniert mit Mistral (EU), Ollama, vLLM, LocalAI oder dem mitgelieferten Server.
import { WEEKDAYS, toISO } from './dates.js';
import { normalizeEvents } from './events.js';

export const PROVIDERS = {
  server: {
    label: 'Terminus-Server',
    hint: 'Der Betreiber dieser Seite stellt die KI bereit. Du brauchst keinen Schlüssel.',
    endpoint: 'api/chat',
    model: '',
    needsKey: false,
  },
  mistral: {
    label: 'Mistral AI (Paris)',
    hint: 'Eigener API-Schlüssel von console.mistral.ai. Er bleibt nur auf diesem Gerät.',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    needsKey: true,
  },
  custom: {
    label: 'Eigenes Modell',
    hint: 'Ollama, vLLM oder LocalAI im eigenen Netz, z. B. mit Mistral Small 3.2 oder Gemma 3.',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    model: 'mistral-small3.2',
    needsKey: false,
  },
  local: {
    label: 'Ohne KI',
    hint: 'Texterkennung direkt auf dem Gerät. Nichts wird hochgeladen, bei Handschrift und schrägen Fotos aber ungenauer.',
  },
};

export function systemPrompt(today = new Date()) {
  return `Du liest Termine aus Fotos und Texten: Elternbriefe, Plakate, Einladungen, Arztzettel, Chatverläufe, Stunden- und Terminpläne.
Heute ist ${WEEKDAYS[today.getDay()]}, der ${toISO(today)}. Zeitzone: Europe/Berlin.

Antworte ausschließlich mit JSON in dieser Form:
{"events":[{"title":"","date":"YYYY-MM-DD","endDate":null,"start":"HH:MM","end":null,"location":"","bring":[],"cost":"","notes":"","confidence":"hoch"}]}

Regeln:
- Jeder Termin wird ein eigener Eintrag. Ein Terminplan kann viele Einträge ergeben.
- Fehlt das Jahr, nimm das nächste Vorkommen ab heute. Löse relative Angaben wie "morgen" oder "nächsten Freitag" auf.
- Mehrtägige Termine (z. B. Ferien): "endDate" setzen, "start" und "end" auf null.
- Keine Uhrzeit angegeben: "start" null. Keine Endzeit: "end" null.
- "title": kurz und konkret, höchstens 6 Wörter, z. B. "Laternenfest Kita Sonnenschein" oder "Zahnarzt Dr. Weber".
- "bring": Dinge, die mitgebracht oder mitgegeben werden sollen, als einzelne Stichworte.
- "cost": Beitrag oder Preis, z. B. "3 €". Sonst leer.
- "notes": wichtige Zusatzinfos in höchstens zwei Sätzen (Anmeldefrist, Kleidung, Ansprechpartner).
- "confidence": "niedrig", wenn Datum oder Uhrzeit unleserlich oder widersprüchlich sind (z. B. Wochentag passt nicht zum Datum), sonst "hoch".
- Erfinde nichts. Gibt es keinen Termin, antworte {"events":[]}.`;
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

export async function extractWithLLM({ settings, imageDataUrl, text, today = new Date(), signal }) {
  const preset = PROVIDERS[settings.provider];
  const endpoint = settings.endpoint || preset.endpoint;
  const model = settings.model || preset.model;
  const content = [];
  content.push({ type: 'text', text: text ? `Text aus Nachricht oder Zettel:\n\n${text}` : 'Finde alle Termine auf diesem Bild.' });
  if (imageDataUrl) {
    // Mistral dokumentiert image_url als String, OpenAI-kompatible Server erwarten ein Objekt.
    content.push({ type: 'image_url', image_url: settings.provider === 'mistral' ? imageDataUrl : { url: imageDataUrl } });
  }
  const body = {
    model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt(today) },
      { role: 'user', content },
    ],
  };
  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  let res;
  try {
    res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new LLMError('Die KI ist nicht erreichbar. Prüfe die Internetverbindung oder die Adresse in den Einstellungen. Bei einem eigenen Server muss er Anfragen von dieser Seite erlauben (CORS).', 'network');
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
