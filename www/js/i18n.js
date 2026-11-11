// Oberfläche in mehreren Sprachen. Deutsch steht im HTML und ist die Vorlage;
// übersetzt sind die Bereiche, die Einsteiger und Empfänger von Links sehen.
// Empfänger ohne Einstellung bekommen automatisch die Sprache ihres Handys.
export const UI_LANGS = { de: 'Deutsch', en: 'English', tr: 'Türkçe', ar: 'العربية', uk: 'Українська' };
const RTL = new Set(['ar']);

let T = {};

// Deutsche Texte, die nur im JavaScript vorkommen
const DE = {
  'tour.next': 'Weiter', 'tour.go': 'Los geht’s',
  'rsvp.q': 'Kommst du?', 'rsvp.ja': 'Ich komme', 'rsvp.vielleicht': 'Vielleicht', 'rsvp.nein': 'Ich kann nicht', 'rsvp.name': 'Dein Name',
  'rsvp.needName': 'Schreib deinen Namen dazu.', 'rsvp.done': '✓ Antwort erstellt. Schick sie an die Person, die eingeladen hat.',
  'poll.ask': 'Wann passt es dir?', 'poll.asks': '{by} fragt: Wann passt es dir?', 'poll.yes': '✓ passt', 'poll.maybe': '? wenn nötig', 'poll.no': '✗ geht nicht',
  'poll.name': 'Dein Name', 'poll.send': 'Antwort zurückschicken', 'poll.needName': 'Schreib deinen Namen dazu, damit man weiß, von wem die Antwort ist.',
  'poll.done': '✓ Antwort erstellt. Schick sie an die Person, die gefragt hat (oder in die Gruppe). Wenn der Termin feststeht, bekommst du ihn als Link.',
};

let lang = 'de';

// Eingestellte Sprache; sonst Deutsch. Nur wer einen Link öffnet (auto), bekommt die Sprache seines Handys –
// die App selbst ist nicht vollständig übersetzt, ein Sprachmix wäre schlechter als Deutsch.
export function pickLang(setting, browser = (typeof navigator !== 'undefined' && navigator.language) || 'de', { auto = false } = {}) {
  if (setting && UI_LANGS[setting]) return setting;
  if (!auto) return 'de';
  const b = String(browser).slice(0, 2).toLowerCase();
  return UI_LANGS[b] ? b : 'de';
}

export const currentLang = () => lang;

export function t(key, vars = {}) {
  const s = T[lang]?.[key] ?? DE[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// Elemente mit data-i18n (Text) bzw. data-i18n-html (mit Auszeichnung) und data-i18n-ph (Platzhalter)
export async function applyLang(code, root = document) {
  lang = UI_LANGS[code] ? code : 'de';
  if (lang !== 'de' && !T[lang]) {
    try {
      T = (await import('./i18n-texte.js')).default;
    } catch {
      lang = 'de';
    }
  }
  if (root === document) {
    document.documentElement.lang = lang;
    document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  }
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.dataset.i18nDe ??= el.textContent;
    el.textContent = T[lang]?.[el.dataset.i18n] ?? el.dataset.i18nDe;
  }
  for (const el of root.querySelectorAll('[data-i18n-html]')) {
    el.dataset.i18nDe ??= el.innerHTML;
    el.innerHTML = T[lang]?.[el.dataset.i18nHtml] ?? el.dataset.i18nDe;
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    el.dataset.i18nDe ??= el.placeholder;
    el.placeholder = T[lang]?.[el.dataset.i18nPh] ?? el.dataset.i18nDe;
  }
}

