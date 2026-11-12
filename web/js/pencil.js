/* The whole pipeline behind one small API, shared by the page, the Mac self-test and tools/compare.mjs.
 *   const ps = new PencilSketch({ onProgress });   await ps.process(blob, params);   await ps.update(params);
 * Nothing leaves the device: decoding, detection and drawing all happen here. */
import { initDetect, detect } from './detect.js';

export const DEFAULTS = { darkness: 1, thickness: 1, density: 1, paper: 1 };

const MAX_INPUT = 3000;      // long side handed to the worker (it resizes to the working size itself)
const DETECT_SIDE = 1024;    // long side handed to MediaPipe

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

async function decode(source) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(source, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode')); img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function isSmallDevice() {
  const mem = navigator.deviceMemory || 8;
  return mem <= 4 || /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
}

export class PencilSketch {
  constructor(opts = {}) {
    this.onProgress = opts.onProgress || (() => {});
    this.shortSide = opts.shortSide || (isSmallDevice() ? 1000 : 1400);
    this.seq = 0;
    this.current = null;         // id of the photo the worker holds
    this.waiting = new Map();    // id -> {resolve, reject, base}
    this.queued = null;          // latest slider values waiting for the worker
    this.busy = false;
    this.worker = new Worker(new URL('./worker.js', import.meta.url));
    this.ready = new Promise((resolve, reject) => {
      this.worker.addEventListener('message', (ev) => { if (ev.data.type === 'ready') resolve(); });
      this.worker.addEventListener('error', (ev) => reject(new Error(ev.message || 'worker failed')));
    });
    this.worker.addEventListener('message', (ev) => this._onMessage(ev.data));
    initDetect().catch(() => {});      // warm up in the background
  }

  _onMessage(msg) {
    const w = this.waiting.get(msg.id);
    if (!w) return;
    if (msg.type === 'progress') {
      this.onProgress(w.base + (1 - w.base) * msg.p, msg.label);
    } else if (msg.type === 'result') {
      this.waiting.delete(msg.id);
      w.resolve({ width: msg.width, height: msg.height, ms: msg.ms, stats: msg.stats,
        imageData: new ImageData(msg.rgba, msg.width, msg.height) });
    } else if (msg.type === 'error') {
      this.waiting.delete(msg.id);
      w.reject(new Error(msg.message));
    }
  }

  /** Full run on a new photo (Blob / File). Resolves to { imageData, width, height, ms, stats }. */
  async process(source, params = {}) {
    const t0 = performance.now();
    const id = ++this.seq;
    this.current = null;
    this.queued = null;
    this.onProgress(0.01, 'load');
    const bmp = await decode(source);
    const bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight;
    if (!bw || !bh) throw new Error('decode');

    const s = Math.min(1, MAX_INPUT / Math.max(bw, bh));
    const cw = Math.max(1, Math.round(bw * s)), ch = Math.max(1, Math.round(bh * s));
    const canvas = makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, cw, ch);
    const image = ctx.getImageData(0, 0, cw, ch);

    const ds = Math.min(1, DETECT_SIDE / Math.max(bw, bh));
    const dc = makeCanvas(Math.max(1, Math.round(bw * ds)), Math.max(1, Math.round(bh * ds)));
    const dctx = dc.getContext('2d');
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(bmp, 0, 0, dc.width, dc.height);
    if (bmp.close) bmp.close();

    this.onProgress(0.04, 'detect');
    await new Promise((r) => setTimeout(r, 30));        // let the progress bar paint first
    const found = await detect(dc, canvas);
    const detectMs = Math.round(performance.now() - t0);
    if (id !== this.seq) throw new Error('superseded');

    await this.ready;
    this.onProgress(0.12, 'resize');
    const result = await new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject, base: 0.12 });
      const transfer = [image.data.buffer];
      if (found.mask) transfer.push(found.mask.data.buffer);
      this.worker.postMessage({
        type: 'job', id, image: { rgba: image.data, width: cw, height: ch },
        mask: found.mask, faces: found.faces, shortSide: this.shortSide,
        params: Object.assign({}, DEFAULTS, params),
      }, transfer);
    });
    this.current = id;
    result.stats.detectMs = detectMs;
    result.faces = found.faces;
    result.totalMs = Math.round(performance.now() - t0);
    return result;
  }

  /** Re-render the current photo with new slider values. Only the latest request is kept. */
  update(params) {
    if (!this.current) return Promise.resolve(null);
    return new Promise((resolve) => {
      if (this.queued) this.queued.resolve(null);
      this.queued = { params: Object.assign({}, DEFAULTS, params), resolve };
      this._pump();
    });
  }

  _pump() {
    if (this.busy || !this.queued || !this.current) return;
    const { params, resolve } = this.queued;
    this.queued = null;
    this.busy = true;
    const id = this.current;
    const done = (r) => { this.busy = false; resolve(r); this._pump(); };
    this.waiting.set(id, { resolve: done, reject: () => done(null), base: 0 });
    this.worker.postMessage({ type: 'params', id, params });
  }
}
