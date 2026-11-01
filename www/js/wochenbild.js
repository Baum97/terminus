// Woche als Bild: für die Familiengruppe, den Status oder den Bildschirm im Flur. Hochformat 1080×1350.
import { addDays, fromISO, isoWeek, WD_SHORT, MONTHS_SHORT } from './dates.js';

const W = 1080, H = 1350, PAD = 56;
const INK = '#15203a', SOFT = '#4b5774', PEN = '#2443c4', LINE = '#e3e7f0', BG = '#ffffff', TODAY = '#fff3b0';

function fit(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

// items: Einträge wie in der Kalenderansicht ({ date, start, allDay, title, color, birthday, frist })
export function drawWeek(from, items, { title = '', todayIso = '' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  g.fillStyle = BG;
  g.fillRect(0, 0, W, H);
  const to = addDays(from, 6);
  const f = fromISO(from), t = fromISO(to);
  g.fillStyle = PEN;
  g.font = font(800, 54);
  g.fillText(title || `Woche ${isoWeek(from)}`, PAD, PAD + 44);
  g.fillStyle = SOFT;
  g.font = font(500, 30);
  g.fillText(`${f.getDate()}. ${MONTHS_SHORT[f.getMonth()]} – ${t.getDate()}. ${MONTHS_SHORT[t.getMonth()]} ${t.getFullYear()}`, PAD, PAD + 92);
  const top = PAD + 130, rowH = (H - top - 70) / 7;
  for (let i = 0; i < 7; i++) {
    const iso = addDays(from, i);
    const y = top + i * rowH;
    if (iso === todayIso) {
      g.fillStyle = TODAY;
      g.fillRect(PAD - 16, y, W - 2 * PAD + 32, rowH);
    }
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(PAD, y);
    g.lineTo(W - PAD, y);
    g.stroke();
    const d = fromISO(iso);
    g.fillStyle = d.getDay() === 0 || d.getDay() === 6 ? SOFT : INK;
    g.font = font(800, 34);
    g.fillText(WD_SHORT[d.getDay()], PAD, y + 48);
    g.font = font(500, 26);
    g.fillText(`${d.getDate()}.${d.getMonth() + 1}.`, PAD, y + 82);
    const day = items.filter((it) => it.date <= iso && (it.endDate || it.date) >= iso)
      .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || (a.start || '').localeCompare(b.start || ''));
    const maxLines = Math.max(1, Math.floor((rowH - 16) / 38));
    const shown = day.length > maxLines ? day.slice(0, maxLines - 1) : day;
    shown.forEach((it, k) => {
      const ly = y + 44 + k * 38;
      g.fillStyle = it.color || PEN;
      g.beginPath();
      g.arc(PAD + 150, ly - 9, 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = INK;
      g.font = font(700, 28);
      const time = it.allDay || !it.start ? (it.frist ? 'Frist' : it.birthday ? '🎂' : 'ganzt.') : it.start;
      g.fillText(time, PAD + 172, ly);
      g.font = font(500, 28);
      g.fillText(fit(g, it.title, W - PAD - (PAD + 272)), PAD + 272, ly);
    });
    if (day.length > shown.length) {
      g.fillStyle = SOFT;
      g.font = font(600, 26);
      g.fillText(`+ ${day.length - shown.length} weitere`, PAD + 172, y + 44 + shown.length * 38);
    }
  }
  g.fillStyle = SOFT;
  g.font = font(500, 24);
  g.fillText('Terminus · damit deine Daten deine bleiben', PAD, H - 30);
  return canvas;
}
