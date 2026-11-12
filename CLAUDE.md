# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

Pencil Sketch: photo of a person -> hand-drawn-looking pencil sketch, fully on-device. One static web app in `web/`
(Hebrew, RTL) that is served three ways: the Vercel site, the Mac app (`mac/`, Swift + WKWebView) and later a Windows
WebView2 shell (`windows/README.md`). There is no bundler and no build step. `package.json` exists only for the dev
tools (`playwright-core`). Reply to the owner in Hebrew.

## Rules

- **The GitHub repo stays private and Vercel Authentication stays on** until the owner says otherwise. Never run
  `gh repo edit --visibility public` or loosen `ssoProtection` on your own. Going open source has its own checklist
  (MIT license, English + Hebrew README with screenshots and a free-to-use before/after photo, secret scan) and needs
  the owner's explicit yes first.
- `reference/pencil.py` is the owner's original script. Keep it byte-for-byte; it is the visual ground truth.
- Photos never leave the device. Do not add analytics, remote fonts, CDNs or any upload. Models and wasm are local files.
- `web/` must keep working from all three hosts: no absolute URLs, no `file://` assumptions, relative paths only.
- After any change in `web/`, run `./mac/build.sh` so the installed app matches (files are copied into the bundle).

## Commands

- Serve: `npm run serve` (http://127.0.0.1:5173). `file://` does not work (modules + worker).
- Engine on one image: `node tools/sketch.mjs in.jpg out.png ['{"darkness":1.2}'] [shortSide]` -> JSON with timings and faces.
- Python vs JS: `node tools/compare.mjs [--python <python with cv2>] [--py-out existing.png]` -> `docs/compare.png`.
  The Python takes ~90 s (GrabCut). Its eye boxes are hard-coded, so only `web/samples/sample.jpg` (cropped to put the
  eyes there) is a fair input.
- UI smoke test + screenshots: `node tools/shots.mjs <outDir>` (desktop 1280 and iPhone 13; fails on page errors).
- Mac: `./mac/build.sh`, then `PENCIL_SELFTEST=1 "/Applications/Pencil Sketch.app/Contents/MacOS/PencilSketch"`.
- Syntax: `node --check web/js/engine.js` (classic script). The others are ES modules.
- Headless tools use the installed Google Chrome (`channel: 'chrome'`).

## Architecture

- `js/app.js` (module, UI) -> `js/pencil.js` (`PencilSketch` class) -> main thread: decode + `js/detect.js` (MediaPipe);
  worker: `js/worker.js` -> `js/engine.js` (global `PencilEngine`, needs global `cv`).
- MediaPipe runs on the main thread on purpose: WebGL in workers is missing on older iOS. Two short CPU inferences,
  plus 9 tile passes when no large face is found (small faces in group shots).
- `engine.js` stages, cached in the worker so sliders stay fast:
  `prepare` (photo-only: gray, bilateral, mask, Sobel magnitude, tone, eyes, paper) ->
  `computeStrokes` + `applyThickness` (thickness slider) -> `computeHatch` (density slider) ->
  `compose` (darkness + paper sliders, ~0.1 s).
- Scale: `k = kImg * kFace`. `kImg` = short side / 1400. `kFace` = sqrt(eye distance / reference 190 px), clamped
  0.6..1.15; without faces it comes from mask coverage. All kernel sizes, blurs and hatch spacings multiply by `k`.
- Fidelity notes: `cv.line(..., LINE_AA)` on a float image is a plain 8-connected line in OpenCV, so kernels and hatch
  lines are 1 px non-antialiased, softened only by the rotation. Stroke filtering is done in JS as a sparse
  gather/scatter over edge pixels (same maths as the 16 `filter2D` calls, far faster). Slow paper blotches are
  generated at 1/8 size. The RNG differs from numpy, so hatch lines and grain match statistically, not pixel by pixel.
- Mac shell: custom scheme `pencil://app/` (WKURLSchemeHandler) serves `Resources/web`; opened files are served at
  `pencil://app/__open/<n>` and handed to `window.pencilOpenURL`. Save goes page -> `messageHandlers.pencil` -> NSSavePanel.
- Page hooks used by shells and tools: `window.pencilReady`, `window.pencilOpenURL(url, name)`, `window.pencilSelfTest()`.

## Deployment

Vercel team Edinova (`team_1bFqCa7vlBk88KhFH9OOvQfZ`), project `pencil-sketch` (`prj_t0WzKPzErtwsfVHuMgzjriTXwW58`), linked to
`shmuelr16/pencil-sketch`. Merge to `main` = production deploy: https://pencil-sketch-zeta.vercel.app
(also `pencil-sketch-edinova.vercel.app`).
`vercel.json`: no install, no build, output `web/`. `.vercelignore` drops everything but `web/`.
`ssoProtection` is `all` (even production needs a Vercel login), so headless checks against the live URL get a login
redirect; test locally instead.
