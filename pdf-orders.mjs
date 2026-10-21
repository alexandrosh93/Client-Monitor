import { parseSoftwareOrder, itemsToLines } from './software-orders.mjs?v=proposal-pdf-20261021';

export async function readOrderPdf(data, { name, signal, onProgress } = {}) {
  if (!(data instanceof Uint8Array) || data.length > 20 * 1024 * 1024) throw new Error('Choose a PDF no larger than 20 MB.');
  const { getDocument, GlobalWorkerOptions } = await import('./vendor/pdf/pdf.mjs');
  GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf/pdf.worker.mjs', import.meta.url).href;
  const loading = getDocument({ data, isEvalSupported: false, useSystemFonts: true });
  let doc, ocrWorker;
  const cancel = () => { loading.destroy(); if (ocrWorker) ocrWorker.terminate(); };
  signal?.addEventListener('abort', cancel, { once: true });
  const check = () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  function cancellable(promise) {
    if (!signal) return promise;
    check();
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }
  try {
    check(); doc = await loading.promise;
    const pages = [];
    let usedOcr = false;
    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
      check(); onProgress?.('Reading ' + name + ' · page ' + i + '/' + doc.numPages);
      const page = await doc.getPage(i), content = await page.getTextContent();
      let pageText = itemsToLines(content.items);
      if (pageText.replace(/\s/g, '').length < 40) {
        // Scanned pages are rendered and recognized locally. No PDF is uploaded.
        if (i > 5) { pages.push(''); continue; }
        usedOcr = true;
        if (!ocrWorker) {
          onProgress?.('Preparing English / Greek scan reader…');
          const { default: Tesseract } = await import('./vendor/ocr/tesseract.mjs');
          const workerReady = Tesseract.createWorker(['eng', 'ell'], 1, {
            workerPath: new URL('./vendor/ocr/worker.min.js', import.meta.url).href,
            corePath: new URL('./vendor/ocr/', import.meta.url).href,
            langPath: new URL('./vendor/ocr/lang/', import.meta.url).href.replace(/\/$/, ''),
            gzip: false, cacheMethod: 'none', workerBlobURL: false,
          });
          workerReady.then(worker => { if (signal?.aborted) worker.terminate(); }, () => {});
          ocrWorker = await cancellable(workerReady);
          check(); await ocrWorker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
        }
        const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(page.getViewport({scale:1}).width, page.getViewport({scale:1}).height)) });
        const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        check(); onProgress?.('Scanning ' + name + ' · page ' + i);
        let result = (await cancellable(ocrWorker.recognize(canvas, { rotateAuto: true }))).data;
        if (result.confidence < 65) {
          const rotated = document.createElement('canvas'); rotated.width = canvas.width; rotated.height = canvas.height;
          const ctx = rotated.getContext('2d'); ctx.translate(rotated.width, rotated.height); ctx.rotate(Math.PI); ctx.drawImage(canvas, 0, 0);
          check(); const alternative = (await cancellable(ocrWorker.recognize(rotated, { rotateAuto: true }))).data;
          if (alternative.confidence > result.confidence) result = alternative;
          rotated.width = rotated.height = 0;
        }
        pageText = result.text; canvas.width = canvas.height = 0;
      }
      pages.push(pageText); page.cleanup();
    }
    check(); const order = parseSoftwareOrder(pages, { name, totalPages: doc.numPages, ocr: usedOcr });
    if (usedOcr && doc.numPages > 5) order.issues.push('OCR is limited to the first 5 scanned pages.');
    return order;
  } catch (e) {
    check();
    if (e.name === 'PasswordException') throw new Error('This PDF is password protected. Open it manually to review the order.');
    throw e;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (ocrWorker) await ocrWorker.terminate();
    await loading.destroy();
  }
}
