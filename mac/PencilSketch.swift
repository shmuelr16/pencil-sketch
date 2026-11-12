// Pencil Sketch for macOS: a native window around the shared web UI (web/ copied into Resources/web).
// No Electron and no network: the files are served to a WKWebView through the private scheme
// pencil://app/..., which (unlike file://) lets the page start a Web Worker and load WebAssembly.
//
//   drop a picture on the window        -> handled by the page itself
//   drop a picture on the Dock icon     -> application(_:open:) -> pencil://app/__open/<n> -> the page fetches it
//   save                                -> the page posts the PNG/JPG bytes -> NSSavePanel
//   PENCIL_SELFTEST=1                   -> runs the engine on the bundled sample, prints one line, exits
import Cocoa
import WebKit
import UniformTypeIdentifiers

let scheme = "pencil"
let origin = "pencil://app/"

/// Serves Resources/web and the pictures the user opened.
final class Files: NSObject, WKURLSchemeHandler {
    let root: URL
    var opened: [String: URL] = [:]
    private var counter = 0
    private let lock = NSLock()

    init(root: URL) { self.root = root.standardizedFileURL }

    func register(_ url: URL) -> String {
        lock.lock(); defer { lock.unlock() }
        counter += 1
        opened[String(counter)] = url
        return origin + "__open/\(counter)"
    }

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json"
        case "wasm": return "application/wasm"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "gif": return "image/gif"
        case "tif", "tiff": return "image/tiff"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(URLError(.badURL)) }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        var file: URL
        if path.hasPrefix("/__open/") {
            lock.lock(); let found = opened[String(path.dropFirst(8))]; lock.unlock()
            guard let f = found else { return respond(task, url, 404, Data(), "text/plain") }
            file = f
        } else {
            file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
            guard file.path.hasPrefix(root.path + "/") else { return respond(task, url, 403, Data(), "text/plain") }
        }
        guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return respond(task, url, 404, Data(), "text/plain") }
        respond(task, url, 200, data, Files.mime(file.pathExtension))
    }

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ status: Int, _ data: Data, _ type: String) {
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var files: Files!
    var pageReady = false
    var pending: [URL] = []
    let selfTest = ProcessInfo.processInfo.environment["PENCIL_SELFTEST"] == "1"

    func applicationDidFinishLaunching(_ notification: Notification) {
        files = Files(root: Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true))
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(files, forURLScheme: scheme)
        config.userContentController.add(self, name: "pencil")
        config.userContentController.addUserScript(WKUserScript(source: """
            window.addEventListener('error', function (e) {
              try { window.webkit.messageHandlers.pencil.postMessage({ error: String(e.message) + ' @ ' + e.filename + ':' + e.lineno }); } catch (x) {}
            });
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = self
        web.navigationDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Pencil Sketch"
        window.minSize = NSSize(width: 420, height: 560)
        window.backgroundColor = NSColor(red: 0.953, green: 0.925, blue: 0.863, alpha: 1)
        window.contentView = web
        window.setFrameAutosaveName("PencilSketchMainWindow")
        if !window.setFrameUsingName("PencilSketchMainWindow") { window.center() }
        window.makeKeyAndOrderFront(nil)
        web.load(URLRequest(url: URL(string: origin + "index.html")!))
        if !selfTest { NSApp.activate(ignoringOtherApps: true) }

        if selfTest {   // never hang: give up after two minutes
            DispatchQueue.main.asyncAfter(deadline: .now() + 120) { self.finishSelfTest("selftest: FAIL timeout", 1) }
        }
    }

    /* ---------- opening pictures (Dock icon, Finder "Open With", File > Open) ---------- */
    func application(_ application: NSApplication, open urls: [URL]) {
        pending.append(contentsOf: urls)
        flushPending()
    }

    func flushPending() {
        guard pageReady, let url = pending.last else { return }
        pending.removeAll()
        let address = files.register(url)
        web.callAsyncJavaScript("window.pencilOpenURL(address, name)", arguments: ["address": address, "name": url.lastPathComponent],
                                in: nil, in: .page, completionHandler: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func openDocument(_ sender: Any?) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { response in
            if response == .OK, let url = panel.url { self.pending.append(url); self.flushPending() }
        }
    }

    /* <input type="file"> in the page */
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    /* ---------- messages from the page ---------- */
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let err = body["error"] as? String { if !selfTest { print("page error: \(err)"); fflush(stdout) }; return }
        if let save = body["save"] as? [String: Any], let name = save["name"] as? String,
           let b64 = save["base64"] as? String, let data = Data(base64Encoded: b64) {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = name
            panel.canCreateDirectories = true
            if let type = UTType(filenameExtension: (name as NSString).pathExtension) { panel.allowedContentTypes = [type] }
            panel.beginSheetModal(for: window) { response in
                guard response == .OK, let url = panel.url else { return }
                do { try data.write(to: url, options: .atomic) } catch {
                    let alert = NSAlert(error: error)
                    alert.beginSheetModal(for: self.window, completionHandler: nil)
                }
            }
        }
    }

    @objc func saveDocument(_ sender: Any?) { web.evaluateJavaScript("document.getElementById('savePng').click()", completionHandler: nil) }

    /* ---------- page life cycle ---------- */
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { waitForPage(tries: 0) }

    func waitForPage(tries: Int) {
        web.evaluateJavaScript("window.pencilReady === true") { value, _ in
            if (value as? Bool) == true {
                self.pageReady = true
                if self.selfTest { self.runSelfTest() } else { self.flushPending() }
            } else if tries < 200 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.waitForPage(tries: tries + 1) }
            } else if self.selfTest {
                self.finishSelfTest("selftest: FAIL page did not start", 1)
            }
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.scheme != scheme, url.scheme != "about", url.scheme != "blob", url.scheme != "data" {
            if url.scheme == "http" || url.scheme == "https" { NSWorkspace.shared.open(url) }
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    /* ---------- PENCIL_SELFTEST=1 ---------- */
    func runSelfTest() {
        web.callAsyncJavaScript("return await window.pencilSelfTest()", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value):
                guard let text = value as? String, let json = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else {
                    return self.finishSelfTest("selftest: FAIL bad answer", 1)
                }
                if (json["ok"] as? Bool) == true {
                    let w = json["width"] as? Int ?? 0, h = json["height"] as? Int ?? 0
                    let engine = Double(json["engineMs"] as? Int ?? 0) / 1000, total = Double(json["totalMs"] as? Int ?? 0) / 1000
                    self.finishSelfTest(String(format: "selftest: OK %dx%d engine=%.1fs total=%.1fs faces=%d person=%@ mean=%d",
                                               w, h, engine, total, json["faces"] as? Int ?? 0,
                                               (json["person"] as? Bool ?? false) ? "yes" : "no", json["mean"] as? Int ?? 0), 0)
                } else {
                    self.finishSelfTest("selftest: FAIL \(json["error"] as? String ?? text)", 1)
                }
            case .failure(let error):
                self.finishSelfTest("selftest: FAIL \(error.localizedDescription)", 1)
            }
        }
    }

    var finished = false
    func finishSelfTest(_ line: String, _ code: Int32) {
        guard !finished else { return }
        finished = true
        print(line)
        fflush(stdout)
        exit(code)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)

/* menu bar: app, File (Open, Save), Edit (so Cmd+V can paste a picture), Window */
let mainMenu = NSMenu()
func addMenu(_ title: String, _ build: (NSMenu) -> Void) {
    let item = NSMenuItem()
    let menu = NSMenu(title: title)
    build(menu)
    item.submenu = menu
    mainMenu.addItem(item)
}
addMenu("Pencil Sketch") { m in
    m.addItem(withTitle: "About Pencil Sketch", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    m.addItem(.separator())
    m.addItem(withTitle: "Hide Pencil Sketch", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    m.addItem(withTitle: "Quit Pencil Sketch", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
}
addMenu("File") { m in
    m.addItem(withTitle: "Open…", action: #selector(AppDelegate.openDocument(_:)), keyEquivalent: "o").target = delegate
    m.addItem(withTitle: "Save as PNG…", action: #selector(AppDelegate.saveDocument(_:)), keyEquivalent: "s").target = delegate
    m.addItem(.separator())
    m.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
}
addMenu("Edit") { m in
    m.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    m.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    m.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
}
addMenu("Window") { m in
    m.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    m.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    let full = m.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
    full.keyEquivalentModifierMask = [.command, .control]
}
app.mainMenu = mainMenu
app.run()
