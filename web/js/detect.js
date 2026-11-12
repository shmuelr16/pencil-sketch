/* Face + person detection with MediaPipe (tasks-vision), fully local: the wasm runtime and the
 * models are files in this repo. Runs on the main thread (two short inferences per photo),
 * because WebGL in a worker is still missing on older phones. */
import { FaceLandmarker, ImageSegmenter } from '../vendor/mediapipe/vision_bundle.mjs';

const WASM = new URL('../vendor/mediapipe/wasm/', import.meta.url).href;
const MODELS = new URL('../models/', import.meta.url).href;

let pending = null;

export function initDetect() {
  if (!pending) {
    pending = (async () => {
      const fileset = {
        wasmLoaderPath: WASM + 'vision_wasm_internal.js',
        wasmBinaryPath: WASM + 'vision_wasm_internal.wasm',
      };
      const segmenter = await ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS + 'selfie_multiclass_256x256.tflite', delegate: 'CPU' },
        runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
      });
      const faces = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS + 'face_landmarker.task', delegate: 'CPU' },
        runningMode: 'IMAGE', numFaces: 8, minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4,
      });
      return { segmenter, faces };
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/* landmark indices: [outer corner, inner corner] of each eye */
const EYES = [[33, 133], [362, 263]];

/* Faces inside one canvas that shows the part (ox, oy, sw, sh) of the whole picture, all as fractions. */
function facesIn(tools, canvas, ox, oy, sw, sh) {
  const cw = canvas.width / sw, ch = canvas.height / sh;      // size of the whole picture at this canvas' scale
  const found = [];
  const res = tools.faces.detect(canvas);
  for (const lm of res.faceLandmarks || []) {
    const eyes = EYES.map(([i, j]) => {
      let ax = (ox + lm[i].x * sw) * cw, ay = (oy + lm[i].y * sh) * ch, bx = (ox + lm[j].x * sw) * cw, by = (oy + lm[j].y * sh) * ch;
      if (ax > bx) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
      return { px: (ax + bx) / 2, py: (ay + by) / 2, pw: Math.hypot(bx - ax, by - ay), angle: Math.atan2(by - ay, bx - ax),
        edge: Math.min(lm[i].x, lm[j].x, lm[i].y, lm[j].y) < 0.02 || Math.max(lm[i].x, lm[j].x, lm[i].y, lm[j].y) > 0.98 };
    });
    if (sw < 1 && eyes.some((e) => e.edge)) continue;         // cut by the tile border: a neighbouring tile has it whole
    const iod = Math.hypot(eyes[0].px - eyes[1].px, eyes[0].py - eyes[1].py);
    const list = eyes.filter((e) => e.pw > 3).map((e) => ({ x: e.px / cw, y: e.py / ch, w: e.pw / cw, angle: e.angle }));
    if (list.length) found.push({ iod: iod / cw, eyes: list });
  }
  return found;
}

/**
 * canvas: the photo, long side around 1000 px. hires (optional): a larger copy, used to find small faces.
 * Returns { mask: {data, width, height} | null, faces: [{ iod, eyes: [{x, y, w, angle}] }] }.
 * x/y are 0..1, w and iod are fractions of the image width, angle is radians.
 */
export async function detect(canvas, hires) {
  const out = { mask: null, faces: [] };
  let tools;
  try { tools = await initDetect(); } catch (err) { console.warn('detector unavailable', err); out.error = String(err); return out; }
  const cw = canvas.width, ch = canvas.height;

  try {
    const res = tools.segmenter.segment(canvas);
    const bg = res.confidenceMasks && res.confidenceMasks[0];      // class 0 = background
    if (bg) {
      const f = bg.getAsFloat32Array();
      const data = new Float32Array(f.length);
      for (let i = 0; i < f.length; i++) data[i] = 1 - f[i];
      out.mask = { data, width: bg.width, height: bg.height };
    }
    if (res.close) res.close();
  } catch (err) { console.warn('segmentation failed', err); }

  try {
    for (const f of facesIn(tools, canvas, 0, 0, 1, 1)) out.faces.push(f);
    /* The detector misses faces that are small in the frame (group photos, full-body shots).
       If no large face was found, look again through nine overlapping close-up tiles. */
    const big = out.faces.some((f) => f.iod > 0.08);
    const src = hires || canvas;
    if (!big && Math.max(src.width, src.height) >= 900) {
      const SIZE = 0.4, STEPS = [0, 0.3, 0.6];
      const tw = Math.round(src.width * SIZE), th = Math.round(src.height * SIZE);
      const scale = Math.min(1, 768 / Math.max(tw, th));
      const tile = document.createElement('canvas');
      tile.width = Math.max(1, Math.round(tw * scale)); tile.height = Math.max(1, Math.round(th * scale));
      const tctx = tile.getContext('2d');
      for (const oy of STEPS) for (const ox of STEPS) {
        tctx.drawImage(src, Math.round(ox * src.width), Math.round(oy * src.height), tw, th, 0, 0, tile.width, tile.height);
        for (const f of facesIn(tools, tile, ox, oy, SIZE, SIZE)) {
          const mx = (f.eyes[0].x + f.eyes[f.eyes.length - 1].x) / 2, my = (f.eyes[0].y + f.eyes[f.eyes.length - 1].y) / 2;
          const dup = out.faces.some((g) => {
            const gx = (g.eyes[0].x + g.eyes[g.eyes.length - 1].x) / 2, gy = (g.eyes[0].y + g.eyes[g.eyes.length - 1].y) / 2;
            return Math.hypot((gx - mx) * cw, (gy - my) * ch) < 0.8 * Math.max(f.iod, g.iod) * cw;
          });
          if (!dup) out.faces.push(f);
        }
      }
    }
  } catch (err) { console.warn('face detection failed', err); }
  return out;
}
