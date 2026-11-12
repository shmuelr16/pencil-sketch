// Pencil Sketch for Windows: a native window (WinForms + WebView2) around the shared web UI in web\.
// No Electron and no network: the folder is mapped to the virtual host https://pencil.app/, which
// (unlike file://) lets the page start a Web Worker and load WebAssembly.
//
//   drop a picture on the window          -> handled by the page itself
//   "Open with" / drop on the exe         -> args[0] -> https://pencil.app/__open/<n> -> the page fetches it
//   save                                  -> the page starts a download -> a normal Save As dialog
//   PENCIL_SELFTEST=1                     -> runs the engine on the bundled sample, prints one line, exits
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PencilSketch;

internal static class Program
{
    [DllImport("kernel32.dll")]
    private static extern bool AttachConsole(int processId);

    [STAThread]
    private static int Main(string[] args)
    {
        bool selfTest = Environment.GetEnvironmentVariable("PENCIL_SELFTEST") == "1";
        if (selfTest && !Console.IsOutputRedirected) AttachConsole(-1);     // print to the terminal that started us
        ApplicationConfiguration.Initialize();
        using var form = new MainForm(args.FirstOrDefault(File.Exists), selfTest);
        Application.Run(form);
        return form.ExitCode;
    }
}

internal sealed class MainForm : Form
{
    private const string Host = "pencil.app";
    private const string Origin = "https://pencil.app/";

    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly Dictionary<string, string> opened = new();
    private readonly bool selfTest;
    private string? pendingFile;
    private int counter;
    private bool pageReady;
    public int ExitCode { get; private set; }

    public MainForm(string? fileToOpen, bool selfTest)
    {
        this.selfTest = selfTest;
        pendingFile = fileToOpen;
        Text = "Pencil Sketch";
        ClientSize = new Size(1240, 900);
        MinimumSize = new Size(440, 600);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(243, 236, 220);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { /* keep the default icon */ }
        Controls.Add(web);
        Load += async (_, _) => await StartAsync();
        if (selfTest)
        {   // never hang: give up after three minutes
            var timer = new System.Windows.Forms.Timer { Interval = 180_000 };
            timer.Tick += (_, _) => Finish("selftest: FAIL timeout", 1);
            timer.Start();
        }
    }

    private async Task StartAsync()
    {
        string webDir = Path.Combine(AppContext.BaseDirectory, "web");
        try
        {
            string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PencilSketch", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, data);
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            if (selfTest) { Finish("selftest: FAIL WebView2: " + ex.Message, 1); return; }
            MessageBox.Show(this, "Pencil Sketch needs the Microsoft Edge WebView2 Runtime.\n" +
                "It is part of Windows 11. On Windows 10, install it from:\nhttps://developer.microsoft.com/microsoft-edge/webview2/\n\n" + ex.Message,
                "Pencil Sketch", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
            return;
        }

        var core = web.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping(Host, webDir, CoreWebView2HostResourceAccessKind.Allow);
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;

        /* pictures opened from outside are served to the page at https://pencil.app/__open/<n> */
        core.AddWebResourceRequestedFilter(Origin + "__open/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            string id = new Uri(e.Request.Uri).AbsolutePath["/__open/".Length..];
            if (opened.TryGetValue(id, out string? path) && File.Exists(path))
            {
                var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
                e.Response = core.Environment.CreateWebResourceResponse(stream, 200, "OK",
                    $"Content-Type: {Mime(path)}\nAccess-Control-Allow-Origin: *\nCache-Control: no-store");
            }
            else
            {
                e.Response = core.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
            }
        };

        /* stay inside the app; real links open in the default browser */
        core.NavigationStarting += (_, e) =>
        {
            if (e.Uri.StartsWith(Origin, StringComparison.OrdinalIgnoreCase) || e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase)) return;
            e.Cancel = true;
            OpenExternal(e.Uri);
        };
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };

        /* saving: the page starts a download, we show the normal Save As dialog instead of the download bar */
        core.DownloadStarting += (_, e) =>
        {
            var deferral = e.GetDeferral();
            e.Handled = true;
            BeginInvoke(() =>
            {
                try
                {
                    string name = Path.GetFileName(e.ResultFilePath);
                    string ext = Path.GetExtension(name).TrimStart('.').ToLowerInvariant();
                    using var dialog = new SaveFileDialog
                    {
                        FileName = name,
                        Filter = ext == "png" ? "PNG image|*.png" : ext is "jpg" or "jpeg" ? "JPEG image|*.jpg" : "All files|*.*",
                        OverwritePrompt = true,
                    };
                    if (dialog.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = dialog.FileName;
                    else e.Cancel = true;
                }
                finally { deferral.Complete(); }
            });
        };

        core.WebMessageReceived += (_, e) =>
        {
            if (!selfTest) return;
            string text;
            try { text = e.TryGetWebMessageAsString(); } catch { return; }
            ReportSelfTest(text);
        };

        core.NavigationCompleted += async (_, e) =>
        {
            if (!e.IsSuccess) { if (selfTest) Finish("selftest: FAIL page did not load (" + e.WebErrorStatus + ")", 1); return; }
            for (int i = 0; i < 300 && !pageReady; i++)
            {
                pageReady = await core.ExecuteScriptAsync("window.pencilReady === true") == "true";
                if (!pageReady) await Task.Delay(100);
            }
            if (!pageReady) { if (selfTest) Finish("selftest: FAIL page did not start", 1); return; }
            if (selfTest)
                await core.ExecuteScriptAsync("window.pencilSelfTest().then(function (r) { window.chrome.webview.postMessage(r); })");
            else
                await OpenPendingAsync();
        };

        core.Navigate(Origin + "index.html");
    }

    private async Task OpenPendingAsync()
    {
        if (!pageReady || pendingFile is null) return;
        string path = pendingFile;
        pendingFile = null;
        string id = (++counter).ToString(CultureInfo.InvariantCulture);
        opened[id] = path;
        await web.CoreWebView2.ExecuteScriptAsync(
            $"window.pencilOpenURL({JsonSerializer.Serialize(Origin + "__open/" + id)}, {JsonSerializer.Serialize(Path.GetFileName(path))})");
    }

    private static string Mime(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" or ".jfif" => "image/jpeg",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        ".bmp" => "image/bmp",
        ".avif" => "image/avif",
        _ => "application/octet-stream",
    };

    private static void OpenExternal(string uri)
    {
        if (!uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri) { UseShellExecute = true }); } catch { /* nothing to do */ }
    }

    /* ---------- PENCIL_SELFTEST=1 ---------- */
    private void ReportSelfTest(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var r = doc.RootElement;
            if (r.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True)
            {
                Finish(string.Format(CultureInfo.InvariantCulture, "selftest: OK {0}x{1} engine={2:0.0}s total={3:0.0}s faces={4} person={5} mean={6}",
                    r.GetProperty("width").GetInt32(), r.GetProperty("height").GetInt32(),
                    r.GetProperty("engineMs").GetInt32() / 1000.0, r.GetProperty("totalMs").GetInt32() / 1000.0,
                    r.GetProperty("faces").GetInt32(), r.GetProperty("person").GetBoolean() ? "yes" : "no", r.GetProperty("mean").GetInt32()), 0);
            }
            else
            {
                Finish("selftest: FAIL " + (r.TryGetProperty("error", out var err) ? err.GetString() : text), 1);
            }
        }
        catch (Exception ex) { Finish("selftest: FAIL bad answer: " + ex.Message, 1); }
    }

    private bool finished;
    private void Finish(string line, int code)
    {
        if (finished) return;
        finished = true;
        Console.Out.WriteLine(line);
        Console.Out.Flush();
        ExitCode = code;
        Close();
    }
}
