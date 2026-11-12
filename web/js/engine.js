/* Pencil Sketch engine: a port of reference/pencil.py to opencv.js.
 * Classic script for a Web Worker (needs the global `cv`). Exposes `PencilEngine`.
 *
 * Three cached stages, so a slider change only redoes what it touches:
 *   prepare()  everything that depends only on the photo (tone, masks, eyes, paper)
 *   strokes    directional outline strokes          <- "line thickness"
 *   hatch      four hatching layers                 <- "hatch density"
 *   compose()  mixes the layers into RGBA           <- "darkness", "paper tone"
 *
 * Every pixel size in the Python script was tuned for a 1400 px wide portrait.
 * Here they are multiplied by `k` (image size and face size), see prepare().
 */
(function (root) {
  'use strict';

  const REF_SHORT = 1400;   // the reference script resizes to 1400 px wide
  const REF_IOD = 190;      // distance between the eye centres in the reference photo, px
  const REF_EYE_W = 90;     // eye width (corner to corner) in the reference photo, px

  /* ---------- small helpers ---------- */

  function makeRng(seed) {
    let a = seed | 0;
    const u = function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    return {
      random: u,
      uniform: (lo, hi) => lo + (hi - lo) * u(),
      int: (lo, hi) => lo + Math.floor(u() * (hi - lo)),          // [lo, hi)
      normal: (mean, sd) => {
        if (spare !== null) { const v = spare; spare = null; return mean + sd * v; }
        let x, y, r;
        do { x = u() * 2 - 1; y = u() * 2 - 1; r = x * x + y * y; } while (r >= 1 || r === 0);
        const f = Math.sqrt(-2 * Math.log(r) / r);
        spare = y * f;
        return mean + sd * x * f;
      },
    };
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const odd = (v) => { const n = Math.max(3, Math.round(v)); return n % 2 ? n : n + 1; };

  function f32ToMat(arr, W, H) {
    const m = new cv.Mat(H, W, cv.CV_32FC1);
    m.data32F.set(arr);
    return m;
  }
  function gblur(arr, W, H, sigma) {
    const m = f32ToMat(arr, W, H);
    const d = new cv.Mat();
    cv.GaussianBlur(m, d, new cv.Size(0, 0), sigma, sigma, cv.BORDER_DEFAULT);
    const out = new Float32Array(d.data32F);
    m.delete(); d.delete();
    return out;
  }

  /* ---------- stage 1: everything that depends only on the photo ---------- */

  /**
   * input: { rgba, width, height, mask: {data: Float32Array, width, height} | null,
   *          faces: [{ eyes: [{x, y, w, angle}] , iod }]  (normalised 0..1 coords, w and iod as a fraction of image width),
   *          shortSide }
   */
  function prepare(input, progress) {
    const t0 = performance.now();
    const short = input.shortSide || REF_SHORT;
    const w = input.width, h = input.height;
    let W, H;
    if (w <= h) { W = short; H = Math.floor(h * short / w); } else { H = short; W = Math.floor(w * short / h); }
    const maxLong = Math.round(short * 1.6);            // very long panoramas: cap the long side
    if (Math.max(W, H) > maxLong) { const r = maxLong / Math.max(W, H); W = Math.round(W * r); H = Math.round(H * r); }
    const N = W * H;
    const kImg = Math.min(W, H) / REF_SHORT;

    /* faces -> pixel units; stroke scale follows the biggest face (small faces get finer strokes) */
    const faces = (input.faces || []).map((f) => ({
      iod: f.iod * W,
      eyes: f.eyes.map((e) => ({ x: e.x * W, y: e.y * H, w: e.w * W, angle: e.angle })),
    })).filter((f) => f.eyes.length);
    let kFace = 1;
    if (faces.length) {
      const maxIod = Math.max.apply(null, faces.map((f) => f.iod));
      kFace = Math.min(1.15, Math.max(0.6, Math.sqrt(maxIod / (REF_IOD * kImg))));
    }
    else if (input.mask && input.mask.data) {
      /* no face to measure: small figures in a wide shot still get finer strokes */
      const m = input.mask.data;
      let sum = 0;
      for (let i = 0; i < m.length; i++) sum += m[i] > 0.5 ? 1 : 0;
      const cov = sum / m.length;
      if (cov >= 0.02) kFace = Math.min(1, Math.max(0.6, Math.sqrt(cov / 0.5)));
    }
    const k = kImg * kFace;

    progress(0.03, 'resize');
    const src = new cv.Mat(h, w, cv.CV_8UC4);
    src.data.set(input.rgba);
    const small = new cv.Mat();
    cv.resize(src, small, new cv.Size(W, H), 0, 0, (W < w) ? cv.INTER_AREA : cv.INTER_CUBIC);
    src.delete();
    const gray8 = new cv.Mat();
    cv.cvtColor(small, gray8, cv.COLOR_RGBA2GRAY);
    small.delete();
    const gray = new Float32Array(N);
    { const g = gray8.data; for (let i = 0; i < N; i++) gray[i] = g[i] / 255; }

    /* smooth tone source: 3 x bilateral(9, 35, 9) */
    progress(0.08, 'smooth');
    let a = gray8.clone(), b = new cv.Mat();
    const d9 = odd(9 * k), d7 = odd(7 * k);
    for (let i = 0; i < 3; i++) {
      cv.bilateralFilter(a, b, d9, 35, 9 * k, cv.BORDER_DEFAULT);
      const t = a; a = b; b = t;
      progress(0.08 + 0.09 * (i + 1), 'smooth');
    }
    const smooth = new Float32Array(N);
    { const g = a.data; for (let i = 0; i < N; i++) smooth[i] = g[i] / 255; }
    a.delete(); b.delete();

    /* edge source: bilateral(7, 25, 7) */
    const edge8 = new cv.Mat();
    cv.bilateralFilter(gray8, edge8, d7, 25, 7 * k, cv.BORDER_DEFAULT);
    gray8.delete();
    const edgeM = new cv.Mat();
    edge8.convertTo(edgeM, cv.CV_32F, 1 / 255);
    edge8.delete();
    progress(0.42, 'edges');

    /* person mask (MediaPipe selfie segmentation instead of GrabCut) */
    let person = null, coverage = 0;
    if (input.mask && input.mask.data) {
      const mm = f32ToMat(input.mask.data, input.mask.width, input.mask.height);
      const up = new cv.Mat();
      cv.resize(mm, up, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR);
      mm.delete();
      const hard = new Float32Array(N);
      const u = up.data32F;
      for (let i = 0; i < N; i++) {
        let t = (u[i] - 0.35) / 0.3; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const v = t * t * (3 - 2 * t);
        hard[i] = v; coverage += v;
      }
      up.delete();
      coverage /= N;
      if (coverage >= 0.02) person = gblur(hard, W, H, 3 * k);
    }
    const hasPerson = !!person;
    if (!person) { person = new Float32Array(N); person.fill(1); }   // no person found: draw the whole picture

    /* gradient magnitude -> stroke seeds */
    const gx = new cv.Mat(), gy = new cv.Mat(), magM = new cv.Mat();
    cv.Sobel(edgeM, gx, cv.CV_32F, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.Sobel(edgeM, gy, cv.CV_32F, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.magnitude(gx, gy, magM);
    gx.delete(); gy.delete();
    const magMax = cv.minMaxLoc(magM).maxVal + 1e-6;
    const mag = new Float32Array(N);
    { const m = magM.data32F; for (let i = 0; i < N; i++) { const v = (m[i] / magMax - 0.045) * 2.6; mag[i] = v <= 0 ? 0 : (v > 1 ? 1 : v) * person[i]; } }
    magM.delete();
    progress(0.5, 'tone');

    /* tone map: lighten like graphite on paper, keep the dark masses; background -> blank paper */
    const tone = gblur(smooth, W, H, 2.5 * k);
    for (let i = 0; i < N; i++) {
      const t = Math.pow(clamp01((tone[i] - 0.02) / 0.7), 0.7);
      tone[i] = t * person[i] + (1 - person[i]);
    }

    /* fine = slightly blurred edge source, drives the dense graphite */
    const fineM = new cv.Mat();
    cv.GaussianBlur(edgeM, fineM, new cv.Size(0, 0), 1.2 * k, 1.2 * k, cv.BORDER_DEFAULT);
    edgeM.delete();
    const fine = new Float32Array(fineM.data32F);
    fineM.delete();
    progress(0.56, 'eyes');

    /* eyes: one region per face holding the soft eye masks and the softly rendered real pixels */
    const eye = new Float32Array(N);
    const eyeRois = [];
    for (const f of faces) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const e of f.eyes) {
        const s = e.w / REF_EYE_W;
        const pad = 0.7 * e.w + 3 * (6 + 4 + 8) * s + 2;
        x0 = Math.min(x0, e.x - pad); y0 = Math.min(y0, e.y - pad);
        x1 = Math.max(x1, e.x + pad); y1 = Math.max(y1, e.y + pad);
      }
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
      const rw = x1 - x0, rh = y1 - y0;
      if (rw < 8 || rh < 8) continue;
      const s = (f.eyes.reduce((acc, e) => acc + e.w, 0) / f.eyes.length) / REF_EYE_W;
      const em = cv.Mat.zeros(rh, rw, cv.CV_32FC1);
      for (const e of f.eyes) {
        cv.ellipse(em, new cv.Point(Math.round(e.x - x0), Math.round(e.y - y0)),
          new cv.Size(Math.max(1, Math.round(e.w * 0.70)), Math.max(1, Math.round(e.w * 0.27))),
          e.angle * 180 / Math.PI, 0, 360, new cv.Scalar(1), -1, cv.LINE_8, 0);
      }
      const e1 = new cv.Mat(), e2 = new cv.Mat();
      cv.GaussianBlur(em, e1, new cv.Size(0, 0), 6 * s, 6 * s, cv.BORDER_DEFAULT);
      cv.GaussianBlur(e1, e2, new cv.Size(0, 0), 4 * s, 4 * s, cv.BORDER_DEFAULT);
      const mask = new Float32Array(e1.data32F), soft = new Float32Array(e2.data32F);
      em.delete(); e1.delete(); e2.delete();
      /* dodge-style soft graphite from the real photo */
      const g = new Float32Array(rw * rh), inv = new Float32Array(rw * rh);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        const v = gray[(y0 + y) * W + x0 + x]; g[y * rw + x] = v; inv[y * rw + x] = 1 - v;
      }
      const invB = gblur(inv, rw, rh, 8 * s);
      let px = new Float32Array(rw * rh);
      for (let i = 0; i < px.length; i++) {
        const den = Math.min(1, Math.max(1e-3, 1 - invB[i]));
        const dodge = clamp01(g[i] / den);
        px[i] = dodge * (0.35 + 0.65 * clamp01(g[i] / 0.55));
      }
      px = gblur(px, rw, rh, Math.max(0.3, 0.7 * s));
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
        const gi = (y0 + y) * W + x0 + x;
        eye[gi] = Math.min(1, eye[gi] + mask[y * rw + x]);
      }
      eyeRois.push({ x0, y0, rw, rh, mask, soft, px });
    }
    progress(0.62, 'paper');

    /* rest = every static multiplier of the shade layer */
    const rng = makeRng(3);
    const rnd = new Float32Array(N);
    for (let i = 0; i < N; i++) rnd[i] = rng.random();
    const grain = gblur(rnd, W, H, 0.8 * kImg);
    const rest = rnd;   // reuse the buffer
    for (let i = 0; i < N; i++) {
      const p = person[i], f = fine[i], e = eye[i];
      let dark = Math.pow(clamp01((0.42 - f) / 0.3), 0.9) * p;
      const iris = clamp01((0.28 - f) / 0.18);
      dark = dark * (1 - e) + iris * 0.55 * e;
      const mid = clamp01((0.62 - f) / 0.35) * p;
      rest[i] = (0.9 + 0.1 * tone[i]) * (1 - 0.62 * dark * (0.85 + 0.15 * grain[i])) * (1 - 0.18 * mid * (1 - 0.8 * e));
    }

    /* paper: fine grain + slow blotches (the slow part is made at 1/8 size, same statistics) */
    const base = new Float32Array(N);
    for (let i = 0; i < N; i++) base[i] = rng.normal(0, 1);
    const fineP = gblur(base, W, H, 1.0 * kImg);
    const DS = 8, sw = Math.ceil(W / DS) + 2, sh = Math.ceil(H / DS) + 2;
    const low = new Float32Array(sw * sh);
    for (let i = 0; i < low.length; i++) low[i] = rng.normal(0, 1);
    const lowB = f32ToMat(gblur(low, sw, sh, 25 * kImg / DS), sw, sh);
    const lowUp = new cv.Mat();
    cv.resize(lowB, lowUp, new cv.Size(W, H), 0, 0, cv.INTER_CUBIC);
    { const l = lowUp.data32F; for (let i = 0; i < N; i++) base[i] = clamp01(0.97 + fineP[i] * 0.025 + l[i] * (0.05 / DS)); }
    lowB.delete(); lowUp.delete();
    progress(0.66, 'paper');

    return {
      W, H, N, k, kImg, mag, tone, rest, base, eyeRois,
      strokes: null, strokesT: null, hatch: null, lastThickness: null, lastDensity: null,
      stats: { faces: faces.length, hasPerson, coverage: +coverage.toFixed(3), k: +k.toFixed(3), prepareMs: Math.round(performance.now() - t0) },
    };
  }

  /* ---------- stage 2: outline strokes ---------- */

  function buildKernels(L) {
    const c = L >> 1, out = [];
    for (let i = 0; i < 8; i++) {
      const m = cv.Mat.zeros(L, L, cv.CV_32FC1);
      const ang = Math.PI * i / 8, dx = Math.cos(ang), dy = Math.sin(ang);
      /* LINE_AA on a float image falls back to a plain 8-connected line in OpenCV, same as here */
      cv.line(m, new cv.Point(Math.trunc(c - dx * c), Math.trunc(c - dy * c)),
        new cv.Point(Math.trunc(c + dx * c), Math.trunc(c + dy * c)), new cv.Scalar(1), 1, cv.LINE_8, 0);
      const d = m.data32F, taps = [];
      let sum = 0;
      for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) { const v = d[y * L + x]; if (v !== 0) { sum += v; taps.push(x - c, y - c, v); } }
      m.delete();
      out.push({ taps, sum });
    }
    return out;
  }

  /** Classify each edge pixel into one of 8 directions, then smear it along that direction. */
  function computeStrokes(st) {
    const { W, H, N, mag } = st;
    const L = odd(25 * st.k), c = L >> 1;
    const PW = W + 2 * c, PH = H + 2 * c;
    const magP = new Float32Array(PW * PH);
    for (let y = 0; y < H; y++) magP.set(mag.subarray(y * W, y * W + W), (y + c) * PW + c);
    const kernels = buildKernels(L).map((kk) => {
      const n = kk.taps.length / 3;
      const off = new Int32Array(n), wt = new Float32Array(n);
      for (let j = 0; j < n; j++) { off[j] = kk.taps[j * 3 + 1] * PW + kk.taps[j * 3]; wt[j] = kk.taps[j * 3 + 2] / kk.sum; }
      return { off, wt, n };
    });
    const outP = new Float32Array(PW * PH);
    const gain = L * 0.55;
    for (let y = 0; y < H; y++) {
      const row = (y + c) * PW + c;
      for (let x = 0; x < W; x++) {
        const p = row + x, v = magP[p];
        if (v === 0) continue;
        let best = 0, bestV = -1;
        for (let i = 0; i < 8; i++) {
          const kk = kernels[i], off = kk.off, wt = kk.wt;
          let s = 0;
          for (let j = 0; j < kk.n; j++) s += magP[p + off[j]] * wt[j];
          if (s > bestV) { bestV = s; best = i; }
        }
        const kk = kernels[best], off = kk.off, wt = kk.wt, vg = v * gain;
        for (let j = 0; j < kk.n; j++) outP[p - off[j]] += vg * wt[j];
      }
    }
    const strokes = new Float32Array(N);
    for (let y = 0; y < H; y++) strokes.set(outP.subarray((y + c) * PW + c, (y + c) * PW + c + W), y * W);
    st.strokes = strokes;
    st.lastThickness = null;
  }

  /** "Line thickness": below 1 the strokes get lighter, above 1 they get darker and wider. */
  function applyThickness(st, t) {
    if (st.lastThickness === t && st.strokesT) return;
    const { W, H, N, strokes } = st;
    const out = st.strokesT || new Float32Array(N);
    if (t <= 1) {
      for (let i = 0; i < N; i++) out[i] = strokes[i] * t;
    } else {
      const wgt = Math.min(1, t - 1), g = 1 + 0.3 * (t - 1);
      const m = f32ToMat(strokes, W, H), d = new cv.Mat();
      const ker = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
      cv.dilate(m, d, ker);
      const dd = d.data32F;
      for (let i = 0; i < N; i++) out[i] = (strokes[i] * (1 - wgt) + dd[i] * wgt) * g;
      m.delete(); d.delete(); ker.delete();
    }
    st.strokesT = out;
    st.lastThickness = t;
  }

  /* ---------- stage 3: hatching, drawn as real random pencil lines ---------- */

  const HATCH = [   // angle, spacing, jitter, alpha, tone threshold
    [45, 8, 0.8, 0.42, 0.72],
    [-45, 7, 0.8, 0.42, 0.52],
    [15, 6, 0.6, 0.45, 0.34],
    [80, 5, 0.6, 0.5, 0.18],
  ];

  function computeHatch(st, density, progress) {
    const { W, H, N, tone, k } = st;
    const rng = makeRng(7);
    const hatch = st.hatch || new Float32Array(N);
    hatch.fill(1);
    const big = Math.trunc(Math.hypot(H, W)) + 40;
    const ox = (big - W) >> 1, oy = (big - H) >> 1;
    const tex = new cv.Mat(big, big, cv.CV_32FC1);
    const dst = new cv.Mat();
    for (let li = 0; li < HATCH.length; li++) {
      const [angle, spacing0, jitter, alpha, thr] = HATCH[li];
      const spacing = spacing0 * k / density;
      const d = tex.data32F;
      d.fill(1);
      let y = 0;
      while (y < big) {
        let x = rng.int(-60, 0) * k;
        while (x < big) {
          const seg = rng.int(40, 160) * k;
          const yy = y + rng.normal(0, jitter * k);
          const wob = rng.normal(0, 1.2 * k);
          const val = 1 - alpha * rng.uniform(0.55, 1.0);
          const xa = Math.trunc(x), xb = Math.trunc(x + seg), ya = Math.trunc(yy), yb = Math.trunc(yy + wob);
          const span = Math.max(1, xb - xa);
          for (let xi = Math.max(0, xa), xe = Math.min(big - 1, xb); xi <= xe; xi++) {
            const yi = Math.round(ya + (yb - ya) * (xi - xa) / span);
            if (yi >= 0 && yi < big) d[yi * big + xi] = val;
          }
          x += seg + rng.int(2, 18) * k;
        }
        y += Math.max(1.5, spacing + rng.normal(0, 0.6 * k));
      }
      const M = cv.getRotationMatrix2D(new cv.Point(big / 2, big / 2), angle, 1);
      M.data64F[2] -= ox; M.data64F[5] -= oy;       // rotate and crop to the picture in one go
      cv.warpAffine(tex, dst, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(1));
      M.delete();
      const t = dst.data32F;
      for (let i = 0; i < N; i++) {
        const m = (thr - tone[i]) / 0.12;
        if (m > 0) hatch[i] *= 1 - (m > 1 ? 1 : m) * (1 - t[i]);
      }
      if (progress) progress((li + 1) / HATCH.length);
    }
    tex.delete(); dst.delete();
    st.hatch = hatch;
    st.lastDensity = density;
  }

  /* ---------- stage 4: combine with paper ---------- */

  function compose(st, params) {
    const { W, H, N, rest, base, hatch, strokesT } = st;
    const darkness = params.darkness, paper = params.paper;
    const pencil = st.pencil || (st.pencil = new Float32Array(N));
    for (let i = 0; i < N; i++) {
      const s = strokesT[i];
      const o = 1 - (s <= 0 ? 0 : Math.pow(s > 1 ? 1 : s, 1.1)) * 0.85;
      const p = o * hatch[i] * rest[i];
      pencil[i] = p < 0 ? 0 : p > 1 ? 1 : p;
    }
    /* eyes: softer outline, then blend in the softly rendered real pixels */
    for (const r of st.eyeRois) {
      for (let y = 0; y < r.rh; y++) {
        for (let x = 0; x < r.rw; x++) {
          const li = y * r.rw + x, soft = r.soft[li];
          if (soft < 0.002) continue;
          const gi = (r.y0 + y) * W + r.x0 + x;
          const s = strokesT[gi];
          let o = 1 - (s <= 0 ? 0 : Math.pow(s > 1 ? 1 : s, 1.1)) * 0.85;
          o = 1 - (1 - o) * (1 - 0.45 * r.mask[li]);
          const p = clamp01(o * hatch[gi] * rest[gi]);
          pencil[gi] = p * (1 - soft) + r.px[li] * soft;
        }
      }
    }
    const out = new Uint8ClampedArray(N * 4);
    const tb = 1 - 0.08 * paper, tg = 1 - 0.04 * paper;       // warm paper: B * 0.92, G * 0.96
    const cx = W / 2, cy = H * 0.45, rx = 1 / (W * 0.55), ry = 1 / (H * 0.6);
    const usePow = Math.abs(darkness - 1) > 1e-3;
    let i = 0;
    for (let y = 0; y < H; y++) {
      const dy = (y - cy) * ry, dy2 = dy * dy;
      for (let x = 0; x < W; x++, i++) {
        let p = pencil[i];
        if (usePow) p = Math.pow(p, darkness);
        const b = base[i];
        let v = p * b;
        const dx = (x - cx) * rx;
        const d2 = dx * dx + dy2;
        if (d2 > 0.5625) {                                    // fade the edges into bare paper
          let f = (Math.sqrt(d2) - 0.75) / 0.35; if (f > 1) f = 1;
          v = v * (1 - f) + b * f;
        }
        v *= 255;
        const j = i * 4;
        out[j] = v; out[j + 1] = v * tg; out[j + 2] = v * tb; out[j + 3] = 255;
      }
    }
    return out;
  }

  const DEFAULTS = { darkness: 1, thickness: 1, density: 1, paper: 1 };

  /** Runs whatever stages the given params need and returns RGBA pixels. */
  function render(st, params, progress) {
    const p = Object.assign({}, DEFAULTS, params);
    progress = progress || function () {};
    if (!st.strokes) { progress(0.68, 'strokes'); computeStrokes(st); }
    applyThickness(st, p.thickness);
    if (!st.hatch || st.lastDensity !== p.density) {
      progress(0.8, 'hatch');
      computeHatch(st, p.density, (f) => progress(0.8 + 0.15 * f, 'hatch'));
    }
    progress(0.96, 'compose');
    const rgba = compose(st, p);
    progress(1, 'done');
    return rgba;
  }

  root.PencilEngine = { prepare, render, DEFAULTS, REF_SHORT };
})(typeof self !== 'undefined' ? self : this);
