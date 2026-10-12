import { mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pdf = dirname(require.resolve('pdfjs-dist/package.json'));
const tess = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json', { paths: [tess] }));
await mkdir('vendor/pdf', { recursive: true });
await mkdir('vendor/ocr/lang', { recursive: true });
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) await copyFile(join(pdf, 'legacy/build', file), 'vendor/pdf/' + file);
await copyFile(join(pdf, 'LICENSE'), 'vendor/pdf/LICENSE.txt');
await copyFile(join(tess, 'dist/tesseract.esm.min.js'), 'vendor/ocr/tesseract.mjs');
for (const file of ['worker.min.js', 'worker.min.js.LICENSE.txt']) await copyFile(join(tess, 'dist', file), 'vendor/ocr/' + file);
await copyFile(join(tess, 'LICENSE.md'), 'vendor/ocr/LICENSE.txt');
await copyFile(join(core, 'LICENSE'), 'vendor/ocr/CORE-LICENSE.txt');
// LSTM-only engine builds; Tesseract selects the best available SIMD support.
for (const file of await readdir(core)) {
  if (/^tesseract-core(?:-simd|-relaxedsimd)?-lstm\.wasm(?:\.js)?$/.test(file)) await copyFile(join(core, file), 'vendor/ocr/' + file);
}
const revision = '87416418657359cb625c412a48b6e1d6d41c29bd';
for (const name of ['eng.traineddata', 'ell.traineddata', 'LICENSE']) {
  const response = await fetch('https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/' + revision + '/' + name);
  if (!response.ok) throw new Error('Could not download OCR language data: ' + name);
  await writeFile('vendor/ocr/lang/' + (name === 'LICENSE' ? 'LICENSE.txt' : name), new Uint8Array(await response.arrayBuffer()));
}
