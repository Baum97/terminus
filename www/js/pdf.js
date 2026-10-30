// PDFs auf dem Gerät lesen (pdf.js, wird erst beim ersten PDF geladen).
// Text-PDFs liefern ihren Text direkt; eingescannte PDFs werden als Bild der ersten Seite erkannt.
let lib;

async function load() {
  if (!lib) {
    lib = await import('../vendor/pdfjs/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  return lib;
}

// { text, pages, canvas? } – canvas nur, wenn kaum Text im PDF steckt (Scan)
export async function readPdf(data, { maxPages = 6 } = {}) {
  const pdfjs = await load();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = Math.min(doc.numPages, maxPages);
  const out = [];
  for (let n = 1; n <= pages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let line = '';
    for (const item of content.items) {
      line += item.str;
      if (item.hasEOL) {
        out.push(line);
        line = '';
      } else if (item.str && !line.endsWith(' ')) line += ' ';
    }
    if (line) out.push(line);
  }
  const text = out.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  if ((text.match(/\p{L}/gu) || []).length >= 25) return { text, pages: doc.numPages };
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return { text: '', pages: doc.numPages, canvas };
}
