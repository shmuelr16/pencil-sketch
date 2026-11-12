# Windows shell (not built yet)

Plan: a small C#/.NET app with a WebView2 control that shows the same `web/` folder the website and the Mac app use.
Nothing in `web/` needs to change.

## What to build

1. **Project**: `windows/PencilSketch/` , a WinForms or WPF app on .NET 8 with the `Microsoft.Web.WebView2` NuGet package.
2. **Serve `web/` locally, without a server**: copy `web/` next to the exe at build time and map it to a virtual host:
   `webView.CoreWebView2.SetVirtualHostNameToFolderMapping("pencil.app", webDir, CoreWebView2HostResourceAccessKind.Allow);`
   then navigate to `https://pencil.app/index.html`. A virtual https host is needed (not `file://`) so the Web Worker,
   the ES modules and WebAssembly load. This is the same job `pencil://app/` does in `mac/PencilSketch.swift`.
3. **Save**: the page saves through a plain `<a download>` when no native bridge exists, and WebView2 shows its own
   download UI. For a real "Save As" dialog, handle `CoreWebView2.DownloadStarting` (set `ResultFilePath` from a
   `SaveFileDialog`). No change to the page is needed.
4. **Open a file dropped on the exe / "Open with"**: read `args[0]`, expose the file through a second folder mapping
   (or `AddWebResourceRequestedFilter`), then call the page hook that already exists:
   `ExecuteScriptAsync("window.pencilOpenURL('https://pencil.app/__open/1', 'name.jpg')")` once `window.pencilReady` is true.
5. **Drag onto the window**: works by itself, the page handles `drop`.
6. **Self-test**: `PENCIL_SELFTEST=1` → wait for `window.pencilReady`, run `await window.pencilSelfTest()`
   (returns a JSON string), print one line, exit. Same contract as the Mac app.
7. **Packaging**: `dotnet publish -r win-x64 --self-contained` plus the Evergreen WebView2 runtime (preinstalled on
   Windows 11). Icon: make an `.ico` from the SVG in `tools/make-icons.mjs`.

## Page hooks the shell can rely on

| Hook | Meaning |
| --- | --- |
| `window.pencilReady === true` | page script finished loading |
| `window.pencilOpenURL(url, name)` | fetch a picture from `url` and draw it |
| `window.pencilSelfTest()` | runs the bundled sample, resolves to a JSON string `{ok, width, height, engineMs, totalMs, faces, person, mean}` |
| `window.webkit.messageHandlers.pencil` | Mac-only save bridge. On Windows leave it undefined, the page falls back to a normal download |
