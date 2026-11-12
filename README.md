# Pencil Sketch · סקיצה בעיפרון

Turns a photo of a person into a pencil sketch that looks hand-drawn. Everything runs on the device
(opencv.js + MediaPipe, WebAssembly). The photo is never uploaded.

- **Website**: https://pencil-sketch-zeta.vercel.app , static, on Vercel (team Edinova, project `pencil-sketch`). Private for now (Vercel Authentication).
- **Mac app**: `/Applications/Pencil Sketch.app`, a Swift `WKWebView` shell around the same files. No Electron.
- **Windows**: planned, see [`windows/README.md`](windows/README.md).

![Original, Python reference and JavaScript engine side by side](docs/compare.png)

## Layout

```
web/                  the whole app: UI + engine. Shared by the website, the Mac app and (later) Windows
  index.html style.css
  js/app.js           page logic: picking a photo, before/after slider, sliders, saving
  js/pencil.js        pipeline API (decode -> detect -> worker). Used by app.js and by the tools
  js/detect.js        MediaPipe face landmarks + selfie segmentation (main thread, local model files)
  js/worker.js        Web Worker that owns opencv.js
  js/engine.js        the algorithm: a port of reference/pencil.py
  vendor/             opencv.js 4.9.0, @mediapipe/tasks-vision 0.10.14 (bundle + wasm)
  models/             face_landmarker.task, selfie_multiclass_256x256.tflite
  fonts/ icons/ samples/
mac/                  PencilSketch.swift, Info.plist, AppIcon.icns, build.sh
windows/              plan for the WebView2 shell
reference/pencil.py   the original hand-tuned Python script, kept as is
tools/                dev tools (Node + headless Chrome): serve, sketch, compare, shots, make-icons
docs/compare.png      Python vs JavaScript on the same photo
vercel.json           serves web/ as a static site, no build
```

## How the engine works

Same look as the Python script: outline strokes smeared along one of 8 directions, four hatching layers at
45°/-45°/15°/80° that switch on as the tone gets darker, dense graphite for brows/hair/beard, eyes rendered
softly from the real pixels, warm paper with grain, and edges that fade into the page.

What was hand-tuned for one photo is now automatic:

| Python (one photo) | Here (any photo) |
| --- | --- |
| eye boxes at fixed pixels | MediaPipe Face Landmarker, up to 8 faces, small faces found through close-up tiles. No face: eye step skipped |
| GrabCut + fixed "backdrop" zones | MediaPipe selfie segmentation (multiclass). No person: the whole picture is drawn |
| sizes tuned for 1400 px | every size is multiplied by `k` = image scale × face scale |
| 86 s | about 2.5 s for 1400 px (Chrome, M-series Mac), in a Web Worker with progress |

Sliders: darkness, line thickness, hatch density, paper tone. Defaults (all 100 %) reproduce the Python output.
Work size: short side 1400 px (1000 px on phones). Downloads are PNG or JPG at that full size.

## Run and develop

No build step. Any static server works:

```
npm install            # only for the dev tools (playwright-core)
npm run serve          # http://127.0.0.1:5173
```

Opening `web/index.html` straight from disk does not work (ES modules and workers need http).

Checks:

```
node tools/sketch.mjs in.jpg out.png        # run the real engine headlessly on one image, prints timings
node tools/compare.mjs                      # python vs JS -> docs/compare.png (needs python3 with opencv-python, numpy)
node tools/shots.mjs /tmp/shots             # UI smoke test (desktop + phone) with screenshots
```

## Mac app

```
./mac/build.sh
```

Compiles `mac/PencilSketch.swift` with `swiftc`, copies `web/` into the bundle, signs ad-hoc and reinstalls
`/Applications/Pencil Sketch.app`. **Run it again after every change in `web/`** (files are copied, not linked).

- Drop a picture on the window or on the Dock icon, or File > Open (⌘O). Save opens the normal macOS save dialog (⌘S = PNG).
- Self-test: `PENCIL_SELFTEST=1 "/Applications/Pencil Sketch.app/Contents/MacOS/PencilSketch"` prints one line,
  for example `selftest: OK 1400x1867 engine=3.6s total=6.4s faces=1 person=yes mean=180`, and exits (0 = ok).

## Website

Vercel serves `web/` as is (`vercel.json`). The GitHub repo is connected to the Vercel project, so every merge to
`main` deploys production. All URLs sit behind Vercel Authentication until the project goes public.

## Updating

- **UI or engine**: edit `web/`, run `node tools/shots.mjs`, then `./mac/build.sh`, commit, push.
- **Engine look**: after touching `web/js/engine.js`, run `node tools/compare.mjs` and look at `docs/compare.png`.
- **Icon**: edit the SVG in `tools/make-icons.mjs`, run it, rebuild the Mac app.
- **opencv.js / MediaPipe**: replace the files in `web/vendor/` and `web/models/` (versions above), then run all checks.

## Credits

- [OpenCV.js](https://opencv.org) (Apache 2.0), [MediaPipe Tasks Vision](https://developers.google.com/mediapipe) and its models (Apache 2.0).
- Fonts: Playpen Sans Hebrew, Rubik (SIL OFL 1.1).
- Sample photo: "Outdoors-man-portrait (cropped)", Wikimedia Commons, CC0.
