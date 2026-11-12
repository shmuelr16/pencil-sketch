# Third-party software and assets

Pencil Sketch itself is MIT licensed (see `LICENSE`). It ships these third-party files, each under its own license.
Full license texts are in `web/licenses/` (and therefore inside the Mac and Windows apps too).

| What | Where | License |
| --- | --- | --- |
| OpenCV.js 4.9.0 (OpenCV compiled to WebAssembly) | `web/vendor/opencv.js` | Apache License 2.0, © OpenCV team |
| MediaPipe Tasks Vision 0.10.14 (JS bundle + WebAssembly runtime) | `web/vendor/mediapipe/` | Apache License 2.0, © Google LLC / The MediaPipe Authors |
| MediaPipe Face Landmarker model | `web/models/face_landmarker.task` | Apache License 2.0, © Google LLC |
| MediaPipe Selfie Multiclass segmentation model (256×256) | `web/models/selfie_multiclass_256x256.tflite` | Apache License 2.0, © Google LLC |
| Rubik font | `web/fonts/rubik-*.woff2` | SIL Open Font License 1.1, © The Rubik Project Authors |
| Playpen Sans Hebrew font | `web/fonts/playpen-sans-hebrew-*.woff2` | SIL Open Font License 1.1, © The Playpen Sans Project Authors |
| Sample photo "Outdoors-man-portrait (cropped)" | `web/samples/sample.jpg`, `docs/` | CC0 1.0 (public domain), Wikimedia Commons |

Used at build time only, not shipped in `web/`:

| What | Used for | License |
| --- | --- | --- |
| Microsoft.Web.WebView2 (NuGet) and .NET 8 runtime | Windows app (bundled in the exe) | Microsoft Software License / MIT |
| Inno Setup | Windows installer | Inno Setup License |
| playwright-core | dev tools (headless checks, screenshots, icons) | Apache License 2.0 |
