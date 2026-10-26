// Minimaler ZIP-Leser für den Google-Kalender-Export (eine .ics-Datei je Kalender).
// Nutzt die im Browser eingebaute Entpackung (DecompressionStream), keine Bibliothek.

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Liefert [{ name, text }] für alle Dateien, deren Name zu filter passt
export async function readZip(buffer, filter = /\.ics$/i) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Ende des Inhaltsverzeichnisses suchen (Signatur 0x06054b50), von hinten
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = [];
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!filter.test(name)) continue;
    const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(dataStart, dataStart + size);
    const content = method === 0 ? raw : method === 8 ? await inflate(raw) : null;
    if (content) files.push({ name, text: decoder.decode(content) });
  }
  return files;
}
