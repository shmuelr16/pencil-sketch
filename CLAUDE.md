# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is

Pencil Sketch: photo of a person -> hand-drawn-looking pencil sketch, fully on-device. One static web app in `web/`
(Hebrew, RTL) that is served three ways: the Vercel site, the Mac app (`mac/`, Swift + WKWebView) and the Windows app
(`windows/`, C# WinForms + WebView2). There is no bundler and no build step. `package.json` exists only for the dev
tools (`playwright-core`). Reply to the owner in Hebrew.

## Rules

- The project is **open source (MIT) and public** since 2026-11-12: the GitHub repo is public and the website has no login.
  Everything committed is public. Never commit secrets, tokens, `.env*` files, personal e-mail addresses, local paths
  or private notes. Commits use the GitHub noreply address (repo-local `git config user.email`); keep it that way.
- `reference/pencil.py` is the original script the owner brought (written for him by Claude in the phone app, tuned for
  one photo of his). Keep it byte-for-byte; it is the visual ground truth. The owner wrote no code; say so in the docs.
- Photos never leave the device. Do not add analytics, remote fonts, CDNs or any upload. Models and wasm are local files.
- `web/` must keep working from all three hosts: no absolute URLs for its own files, no `file://` assumptions, relative paths only.
- After any change in `web/`, run `./mac/build.sh` so the installed app matches (files are copied into the bundle).
- New bundled third-party files need an entry in `THIRD_PARTY_NOTICES.md` and their license text in `web/licenses/`.
- `README.md` is the owner-facing Hebrew page: short and simple on purpose (download links, install steps, who built it,
  "not an AI tool"). Do not add technical detail there; that goes in `README.en.md`. `.github/release-notes.md` (Hebrew)
  repeats the download and install part for each release.

## Commands

- Serve: `npm run serve` (http://127.0.0.1:5173). `file://` does not work (modules + worker).
- Engine on one image: `node tools/sketch.mjs in.jpg out.png ['{"darkness":1.2}'] [shortSide]` -> JSON with timings and faces.
- Python vs JS: `node tools/compare.mjs [--python <python with cv2>] [--py-out existing.png]` -> `docs/compare.png`.
  The Python takes ~90 s (GrabCut). Its eye boxes are hard-coded, so only `web/samples/sample.jpg` (cropped to put the
  eyes there) is a fair input.
- UI smoke test + screenshots: `node tools/shots.mjs <outDir>` (desktop 1280 and iPhone 13; fails on page errors).
- Mac: `./mac/build.sh` (universal arm64 + x86_64, installs to /Applications), then
  `PENCIL_SELFTEST=1 "/Applications/Pencil Sketch.app/Contents/MacOS/PencilSketch"`. `NO_INSTALL=1` builds into `build/` only;
  `./mac/package.sh` then writes `build/PencilSketch-mac.dmg`.
- Shareable ad: `node tools/make-ad.mjs` renders `docs/ad/ad.html` (site design) to `docs/ad/pencil-sketch-ad-square.png`
  (1080x1080) and `-story.png` (1080x1920). Edit the text in `ad.html`, then rerun.
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
- Windows shell (`windows/PencilSketch/Program.cs`): `web\` mapped to `https://pencil.app/`; opened files served at
  `https://pencil.app/__open/<n>` via `WebResourceRequested`; save = page download -> `DownloadStarting` -> SaveFileDialog;
  self-test result comes back through `chrome.webview.postMessage`. The page detects it with `window.chrome.webview`.
  It cannot be built or run on this Mac (no dotnet): CI builds it. The exe is unsigned.
- CI (`.github/workflows/build.yml`): jobs `windows` (windows-latest) and `mac` (macos-latest) build, run
  `PENCIL_SELFTEST=1` and upload artifacts on every push to `main` that touches `web/`, `mac/` or `windows/`. After a push,
  check with `gh run list --workflow build.yml --limit 1` / `gh run watch <id> --exit-status`.
- Releases: push a tag `vX.Y.Z` -> the same jobs, then job `release` publishes a GitHub Release with
  `PencilSketch-mac.dmg`, `PencilSketch-Setup.exe`, `PencilSketch-windows-x64.zip` and the text of
  `.github/release-notes.md`. The README download links use `releases/latest/download/<name>`, so keep these file names.
- Page hooks used by shells and tools: `window.pencilReady`, `window.pencilOpenURL(url, name)`, `window.pencilSelfTest()`.

## Deployment

Website: Vercel project `pencil-sketch`, linked to the GitHub repo `shmuelr16/pencil-sketch`. Merge to `main` = production
deploy: https://pencil-sketch-zeta.vercel.app . `vercel.json`: no install, no build, output `web/`.
`.vercelignore` drops everything but `web/`. The site is public (no Vercel Authentication).
