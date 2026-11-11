// Baut die ausgelieferte Fassung nach dist/: JavaScript gebündelt und verkleinert (selten genutzte
// Teile als eigene Dateien, die erst bei Bedarf laden), CSS verkleinert, Offline-Liste mit Prüfsumme.
// Entwickelt wird weiter in www/ (ohne Build lauffähig).
import { build } from 'esbuild';
import { cp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

const SRC = 'www', OUT = 'dist';
await rm(OUT, { recursive: true, force: true });
await cp(SRC, OUT, { recursive: true, filter: (p) => !/^www[/\\]js([/\\]|$)/.test(p) && !p.endsWith('.css') });

const js = await build({
  entryPoints: [`${SRC}/js/app.js`],
  outdir: `${OUT}/js`,
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: ['es2020'],
  entryNames: '[name]',
  chunkNames: '[name]-[hash]',
  // Mitgelieferte Bibliotheken (pdf.js) bleiben eigene Dateien und laden erst bei Bedarf
  external: ['../vendor/*'],
  legalComments: 'none',
  metafile: true,
});
await build({ entryPoints: [`${SRC}/css/app.css`], outdir: `${OUT}/css`, minify: true, bundle: true, target: ['chrome80'] });

// HTML: nur Kommentare entfernen (gzip erledigt den Rest)
const html = await readFile(`${OUT}/index.html`, 'utf8');
await writeFile(`${OUT}/index.html`, html.replace(/<!--[\s\S]*?-->\s*/g, ''));

// Offline-Liste: alles außer den großen Bibliotheken (die werden beim ersten Gebrauch gespeichert)
async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}
const files = (await walk(OUT)).map((p) => relative(OUT, p).split('\\').join('/'))
  .filter((f) => !/^vendor\/(tesseract|pdfjs)\//.test(f) && !/\.(txt|md|map)$/.test(f) && f !== 'sw.js' && !f.startsWith('icons/icon-'));
const hash = createHash('sha256');
for (const f of files.sort()) hash.update(f).update(await readFile(join(OUT, f)));
const version = `terminus-${hash.digest('hex').slice(0, 10)}`;
let sw = await readFile(`${OUT}/sw.js`, 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = ${JSON.stringify(['./', ...files])};`);
await writeFile(`${OUT}/sw.js`, sw);

const sizes = Object.entries(js.metafile.outputs).map(([f, o]) => `${relative(OUT, f)} ${(o.bytes / 1024).toFixed(1)} KB`);
console.log(`dist/ gebaut (${version})\n  ${sizes.join('\n  ')}`);
