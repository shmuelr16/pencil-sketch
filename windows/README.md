# Windows app

A small C# app (WinForms + WebView2, .NET 8) that shows the same `web/` folder the website and the Mac app use.
No Electron. Nothing in `web/` is Windows-specific.

```
windows/
  PencilSketch/PencilSketch.csproj   self-contained single exe (win-x64), copies ..\..\web next to it as web\
  PencilSketch/Program.cs            the whole shell
  PencilSketch/app.ico               made by tools/make-icons.mjs
  installer.iss                      Inno Setup: per-user install, Start menu shortcut, "Open with" entries
```

## Getting a build

Download the latest release:
[PencilSketch-Setup.exe](https://github.com/shmuelr16/pencil-sketch/releases/latest/download/PencilSketch-Setup.exe) ·
[portable zip](https://github.com/shmuelr16/pencil-sketch/releases/latest/download/PencilSketch-windows-x64.zip)

**GitHub Actions builds and tests it** (`.github/workflows/build.yml`, job `windows`). Every push to `main` that touches
`web/` or `windows/` does:

1. `dotnet publish` on `windows-latest`
2. the self-test on that real Windows machine (`PENCIL_SELFTEST=1`, must print `selftest: OK ...`)
3. uploads the artifact `PencilSketch-windows`: `PencilSketch-Setup.exe` (installer) and `PencilSketch-windows-x64.zip` (portable)

A version tag (`v1.2.3`) also publishes them in a GitHub Release.

To build on a Windows PC instead: install the .NET 8 SDK, then
`dotnet publish windows/PencilSketch/PencilSketch.csproj -c Release -o out/PencilSketch`.

## Installing

Run `PencilSketch-Setup.exe`. No admin rights needed; it installs to `%LOCALAPPDATA%\Programs\Pencil Sketch` and adds
a Start menu entry. The exe is **not code-signed**, so SmartScreen shows "Windows protected your PC": More info > Run anyway.
Needs the WebView2 Runtime, which is part of Windows 11 (and of updated Windows 10).

## How it works

- `web\` is mapped to the virtual host `https://pencil.app/` (`SetVirtualHostNameToFolderMapping`). A real https origin
  (not `file://`) is what lets the Web Worker, ES modules and WebAssembly load. Same job as `pencil://app/` on the Mac.
- **Drop on the window**: handled by the page.
- **Open with / drop on the exe**: `args[0]` is served at `https://pencil.app/__open/<n>` through `WebResourceRequested`,
  then `window.pencilOpenURL(url, name)` is called once `window.pencilReady` is true.
- **Save**: the page starts a normal download (`<a download>`); `DownloadStarting` replaces the download bar with a
  Save As dialog. Ctrl+S saves a PNG, Ctrl+O opens a picture (both handled by the page).
- **Self-test**: `PENCIL_SELFTEST=1` runs `window.pencilSelfTest()`, gets the JSON back through
  `chrome.webview.postMessage`, prints one line and exits (0 = ok). It is a GUI exe, so redirect its output:
  `Start-Process PencilSketch.exe -RedirectStandardOutput out.txt -Wait`.
- WebView2 keeps its data in `%LOCALAPPDATA%\PencilSketch\WebView2`.

## Not done

- Code signing (needs a certificate), auto-update, ARM64 build.
- A second launch opens a second window (no single-instance hand-off).
