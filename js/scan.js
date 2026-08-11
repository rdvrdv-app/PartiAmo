/* scan.js — extracts text from photos and PDFs.
   PDF: pdf.js text layer first (digital tickets/vouchers), rasterise + OCR only if the page has no text.
   Images: Tesseract.js (ita+eng) on a Sauvola-binarised copy — phone photos have uneven lighting,
   a global threshold loses whole paragraphs in the shadowed half of the page.
   All libraries and language data are vendored in vendor/ so nothing is fetched at runtime. */

const Scan = (function () {

  const V = p => new URL("vendor/" + p, document.baseURI).href;
  const MRZ_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";
  const MAX_PDF_PAGES = 5;
  const MAX_SIDE = 2400;   // OCR gains nothing above this and gets much slower
  const MIN_SIDE = 1400;   // below this small print falls apart: upscale first

  let workerP = null;

  function available() {
    return typeof Tesseract !== "undefined" && typeof pdfjsLib !== "undefined";
  }

  function getWorker(onProgress) {
    if (!workerP) {
      workerP = Tesseract.createWorker("ita+eng", 1, {
        workerPath: V("worker.min.js"),
        corePath: V(""),
        langPath: V("lang"),
        gzip: true,
        logger: m => {
          if (!Scan._progress) return;
          const pct = Math.round((m.progress || 0) * 100);
          const label = { "loading tesseract core": "Carico il motore OCR",
                          "initializing tesseract": "Inizializzo",
                          "loading language traineddata": "Carico il dizionario",
                          "initializing api": "Preparo il riconoscimento",
                          "recognizing text": "Riconosco il testo" }[m.status] || m.status;
          Scan._progress(`${label}… ${pct}%`);
        }
      }).then(async w => {
        // Scans carry no DPI metadata: without this Tesseract guesses badly and warns.
        await w.setParameters({ user_defined_dpi: "300", preserve_interword_spaces: "1" });
        return w;
      });
    }
    Scan._progress = onProgress || null;
    return workerP;
  }

  /* ---------- image preparation ---------- */

  function canvasOf(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  /* Scale into [MIN_SIDE, MAX_SIDE] and return the grey channel. */
  function prepare(source, w, h) {
    const big = Math.max(w, h);
    const scale = big > MAX_SIDE ? MAX_SIDE / big : (big < MIN_SIDE ? Math.min(2, MIN_SIDE / big) : 1);
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const c = canvasOf(cw, ch);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, cw, ch);
    const img = ctx.getImageData(0, 0, cw, ch);
    const d = img.data;
    const grey = new Uint8ClampedArray(cw * ch);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      grey[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    return { grey, w: cw, h: ch };
  }

  function greyCanvas(grey, w, h) {
    const c = canvasOf(w, h);
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = grey[p];
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* Sauvola adaptive threshold over integral images: local mean and deviation per pixel,
     so a page half in shadow still binarises correctly. */
  function binarise(grey, w, h) {
    const W = w + 1;
    const I = new Float64Array(W * (h + 1));
    const I2 = new Float64Array(W * (h + 1));
    for (let y = 1; y <= h; y++) {
      let rs = 0, rs2 = 0;
      for (let x = 1; x <= w; x++) {
        const v = grey[(y - 1) * w + (x - 1)];
        rs += v; rs2 += v * v;
        I[y * W + x] = I[(y - 1) * W + x] + rs;
        I2[y * W + x] = I2[(y - 1) * W + x] + rs2;
      }
    }
    const r = Math.max(7, Math.round(w / 24) | 1);
    const k = 0.28, R = 128;
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const a = (y1 + 1) * W + (x1 + 1), b = y0 * W + (x1 + 1), c2 = (y1 + 1) * W + x0, d2 = y0 * W + x0;
        const m = (I[a] - I[b] - I[c2] + I[d2]) / area;
        const varr = Math.max(0, (I2[a] - I2[b] - I2[c2] + I2[d2]) / area - m * m);
        const t = m * (1 + k * (Math.sqrt(varr) / R - 1));
        out[y * w + x] = grey[y * w + x] > t ? 255 : 0;
      }
    }
    return out;
  }

  function loadBitmap(file) {
    // createImageBitmap applies the EXIF orientation: phone photos are rarely upright.
    if (self.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => loadImgTag(file));
    }
    return loadImgTag(file);
  }

  function loadImgTag(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => {
        URL.revokeObjectURL(url);
        rej(new Error(/heic|heif/i.test(file.type + file.name)
          ? "formato HEIC non supportato dal browser: converti in JPEG"
          : "immagine non leggibile"));
      };
      im.src = url;
    });
  }

  /* ---------- recognition ---------- */

  const score = r => (r.text.match(/[A-Za-z0-9]/g) || []).length * Math.max(0.3, r.confidence / 100);

  async function recognize(canvas, psm) {
    const w = await getWorker();
    if (psm) await w.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await w.recognize(canvas);
    if (psm) await w.setParameters({ tessedit_pageseg_mode: "3" });
    return { text: data.text || "", confidence: data.confidence || 0 };
  }

  /* Two attempts: binarised page in auto layout mode, then the grey original as a single
     block. Documents shot at an angle often fail layout analysis but read fine as one block. */
  async function ocrPrepared(prep, mrz, onProgress) {
    await getWorker(onProgress);
    const bin = binarise(prep.grey, prep.w, prep.h);
    const binC = greyCanvas(bin, prep.w, prep.h);

    let best = await recognize(binC, "3");
    if (score(best) < 40) {
      onProgress && onProgress("Riprovo con un'altra segmentazione…");
      const alt = await recognize(greyCanvas(prep.grey, prep.w, prep.h), "6");
      if (score(alt) > score(best)) best = alt;
    }
    let out = best.text;

    if (mrz) {
      // The MRZ sits in the bottom third; cropping it out beats whitelisting the whole page.
      onProgress && onProgress("Rileggo la zona MRZ…");
      const y0 = Math.round(prep.h * 0.6), ch = prep.h - y0;
      const crop = canvasOf(prep.w, ch);
      crop.getContext("2d").drawImage(binC, 0, y0, prep.w, ch, 0, 0, prep.w, ch);
      const up = canvasOf(prep.w * 1.5, ch * 1.5);
      const uc = up.getContext("2d");
      uc.imageSmoothingQuality = "high";
      uc.drawImage(crop, 0, 0, up.width, up.height);

      const w = await getWorker();
      await w.setParameters({ tessedit_char_whitelist: MRZ_CHARS, tessedit_pageseg_mode: "6" });
      try {
        const raw = (await w.recognize(up)).data.text || "";
        const lines = raw.split("\n").map(l => l.replace(/\s+/g, ""))
          .filter(l => l.length >= 25 && (l.match(/</g) || []).length >= 3);
        if (lines.length) out += "\n" + lines.join("\n");
      } finally {
        await w.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" });
      }
    }
    return { text: out, confidence: Math.round(best.confidence) };
  }

  async function fromImage(file, opts, onProgress) {
    onProgress && onProgress("Preparo l'immagine…");
    const bmp = await loadBitmap(file);
    const prep = prepare(bmp, bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight);
    if (bmp.close) bmp.close();
    const r = await ocrPrepared(prep, opts && opts.mrz, onProgress);
    return { text: r.text, mode: `OCR immagine (affidabilità ${r.confidence}%)` };
  }

  async function fromPdf(file, opts, onProgress) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = V("pdf.worker.min.js");
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);

    let text = "";
    for (let i = 1; i <= pages; i++) {
      onProgress && onProgress(`Leggo il PDF, pagina ${i}/${pages}…`);
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      // Rebuild line breaks: pdf.js emits items with a new Y position per line.
      let last = null, line = [];
      const lines = [];
      tc.items.forEach(it => {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (last !== null && y !== null && Math.abs(y - last) > 3) { lines.push(line.join(" ")); line = []; }
        line.push(it.str);
        last = y;
      });
      if (line.length) lines.push(line.join(" "));
      text += lines.join("\n") + "\n";
    }

    if (text.replace(/\s/g, "").length >= 40) return { text, mode: `testo PDF (${pages} pag.)` };

    // No text layer → scanned document: rasterise each page and OCR it.
    let ocr = "";
    for (let i = 1; i <= pages; i++) {
      onProgress && onProgress(`PDF scansionato: OCR pagina ${i}/${pages}…`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const c = canvasOf(vp.width, vp.height);
      // intent "print" keeps pdf.js off requestAnimationFrame: a display render never
      // finishes in a background/hidden tab, where no frames are produced.
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp, intent: "print" }).promise;
      const r = await ocrPrepared(prepare(c, c.width, c.height), opts && opts.mrz, onProgress);
      ocr += r.text + "\n";
    }
    return { text: ocr, mode: `OCR PDF scansionato (${pages} pag.)` };
  }

  /* Entry point: returns { text, mode, seconds }. */
  async function fromFile(file, opts, onProgress) {
    if (location.protocol === "file:") {
      throw new Error("apri l'app da http://localhost, non con doppio clic sul file: il browser blocca il motore OCR sulle pagine file://");
    }
    if (!available()) throw new Error("librerie OCR non caricate (cartella vendor/ mancante)");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const t0 = performance.now();
    const r = isPdf ? await fromPdf(file, opts, onProgress) : await fromImage(file, opts, onProgress);
    r.seconds = ((performance.now() - t0) / 1000).toFixed(1);
    r.text = r.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    return r;
  }

  async function terminate() {
    if (!workerP) return;
    const w = await workerP; workerP = null;
    try { await w.terminate(); } catch (e) { }
  }

  return { fromFile, available, terminate };
})();
