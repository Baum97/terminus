// Texterkennung auf dem Gerät mit Tesseract (Apache-2.0). Alle Dateien liegen in vendor/,
// es wird nichts von fremden Servern nachgeladen.
const abs = (p) => new URL(p, document.baseURI).href;

let workerPromise = null;
let progressCb = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Texterkennung konnte nicht geladen werden.'));
    document.head.append(s);
  });
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      if (!window.Tesseract) await loadScript(abs('vendor/tesseract/tesseract.min.js'));
      return window.Tesseract.createWorker('deu', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract/'),
        langPath: abs('vendor/tesseract/lang'),
        logger: (m) => progressCb?.(m),
      });
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

export async function recognize(canvas, onProgress) {
  progressCb = onProgress;
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  progressCb = null;
  return data.text;
}
