Turn a photo of a person into a pencil sketch that looks hand-drawn. Everything runs on your computer; the photo is never uploaded.

## Downloads

| System | File | Direct link |
| --- | --- | --- |
| **macOS** 12 or newer (Apple silicon and Intel) | `PencilSketch-mac.dmg` | https://github.com/shmuelr16/pencil-sketch/releases/latest/download/PencilSketch-mac.dmg |
| **Windows** 10 / 11 (64-bit), installer | `PencilSketch-Setup.exe` | https://github.com/shmuelr16/pencil-sketch/releases/latest/download/PencilSketch-Setup.exe |
| **Windows** 10 / 11 (64-bit), portable | `PencilSketch-windows-x64.zip` | https://github.com/shmuelr16/pencil-sketch/releases/latest/download/PencilSketch-windows-x64.zip |

No install at all: use it in the browser at https://pencil-sketch-zeta.vercel.app

## Install on macOS

1. Open `PencilSketch-mac.dmg` and drag **Pencil Sketch** onto **Applications**.
2. The app is not notarized by Apple, so the first launch is blocked. Open it once, then go to
   **System Settings > Privacy & Security**, scroll down and click **Open Anyway**.
   Or run this once in Terminal: `xattr -dr com.apple.quarantine "/Applications/Pencil Sketch.app"`
3. After that it opens like any app (Launchpad, Spotlight, Dock). You can drop a photo on the window or on the Dock icon.

## Install on Windows

1. Run `PencilSketch-Setup.exe`. No administrator rights needed.
2. The installer is not code-signed, so SmartScreen may say "Windows protected your PC": click **More info**, then **Run anyway**.
3. Start **Pencil Sketch** from the Start menu. You can drop a photo on the window, or right-click a photo > Open with > Pencil Sketch.

Portable: unzip `PencilSketch-windows-x64.zip` anywhere and run `PencilSketch.exe`.
Needs the Microsoft Edge WebView2 Runtime, which is already part of Windows 11 and of updated Windows 10.

## How it was made

Built by [Claude Code](https://claude.com/claude-code), Anthropic's coding agent, from a written brief and one hand-tuned Python script.
Libraries: OpenCV.js (WebAssembly) for the drawing engine, MediaPipe Tasks Vision for face landmarks and person segmentation,
Swift + WKWebView for the Mac app, C# .NET 8 + WebView2 for the Windows app. Full list in the README.
