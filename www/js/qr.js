// QR-Codes: die Bibliothek lädt erst, wenn zum ersten Mal ein Code gebraucht wird.
let loading;

export function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  loading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: 'vendor/qrcode/qrcode.js', async: true });
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => {
      loading = null;
      reject(new Error('QR-Code konnte nicht geladen werden.'));
    };
    document.head.append(s);
  });
  return loading;
}
