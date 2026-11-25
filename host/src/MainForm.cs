using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NewsCenter;

// A borderless window that hosts the dashboard. The page draws its own title bar and
// window controls; this class keeps native behavior such as Snap, resizing and the taskbar.
sealed class MainForm : Form
{
    internal const string AppHost = "newscenter.example";
    internal const string AppOrigin = "https://" + AppHost;
    const int MaxFetchBytes = 4 * 1024 * 1024;
    const int MaxRedirects = 5;

    // Sites News Center never contacts: no page, frame, image, fetch, redirect or browser link.
    static readonly string[] BlockedDomains = { "srugim.co.il" };

    static readonly HttpClient Http = CreateHttpClient();
    static readonly Regex DeclaredCharset = new(@"<\?xml[^>]*?\bencoding\s*=\s*[""']([\w.:-]+)|<meta[^>]+?charset\s*=\s*[""']?([\w.:-]+)", RegexOptions.IgnoreCase);
    static readonly HashSet<string> EditMenuItems = new(StringComparer.OrdinalIgnoreCase)
    {
        "undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll",
    };

    readonly JavaScriptSerializer json = new() { MaxJsonLength = 16 * 1024 * 1024 };
    readonly string appFolder;
    readonly WebView2 view;
    readonly RegisteredWaitHandle activateRegistration;
    readonly bool debug;
    // Channels shown in their own windows, by channel id (see ChannelWindow).
    readonly Dictionary<string, ChannelWindow> channelWindows = new(StringComparer.Ordinal);
    CoreWebView2Environment environment;
    bool closingApp;
    FormWindowState lastState;
    FormWindowState stateBeforeMinimize = FormWindowState.Normal;
    string userAgent;
    bool pageSaved;
    bool handlingWindowPosChanged;

    public MainForm(string appFolder, EventWaitHandle activateSignal)
    {
        this.appFolder = appFolder;
        debug = int.TryParse(Environment.GetEnvironmentVariable("NEWSCENTER_DEBUG_PORT"), out var port) && port > 0;
        Text = "News Center";
        Icon = Program.AppIcon;
        BackColor = Color.FromArgb(7, 9, 13);
        FormBorderStyle = FormBorderStyle.Sizable;
        StartPosition = FormStartPosition.Manual;
        view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = BackColor };
        Controls.Add(view);
        WindowPlacement.Restore(this);
        lastState = WindowState;
        activateRegistration = ThreadPool.RegisterWaitForSingleObject(activateSignal, (_, _) => OnActivateSignal(), null, Timeout.Infinite, false);
    }

    /* ---------- Window frame ---------- */

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        UpdateMinimumSize((int)Native.GetDpiForWindow(Handle));
        SetDwmAttribute(Native.DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
        SetDwmAttribute(Native.DWMWA_WINDOW_CORNER_PREFERENCE, Native.DWMWCP_ROUND);
        SetDwmAttribute(Native.DWMWA_BORDER_COLOR, 0x0046342A);
        // A one-pixel frame keeps the system shadow even though the page covers the whole window.
        var margins = new Native.MARGINS { Top = 1 };
        Native.DwmExtendFrameIntoClientArea(Handle, ref margins);
        Native.SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0,
            Native.SWP_FRAMECHANGED | Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Native.WM_NCCALCSIZE && m.WParam != IntPtr.Zero)
        {
            // No native title bar or border: the client area is the whole window.
            if (Native.IsZoomed(Handle))
            {
                var parameters = Marshal.PtrToStructure<Native.NCCALCSIZE_PARAMS>(m.LParam);
                parameters.Proposed = MaximizedClientArea(parameters.Proposed);
                Marshal.StructureToPtr(parameters, m.LParam, false);
            }
            m.Result = IntPtr.Zero;
            return;
        }
        if (m.Msg == Native.WM_DPICHANGED)
        {
            UpdateMinimumSize((int)((long)m.WParam & 0xFFFF));
            var suggested = Marshal.PtrToStructure<Native.RECT>(m.LParam);
            Native.SetWindowPos(Handle, IntPtr.Zero, suggested.Left, suggested.Top,
                suggested.Right - suggested.Left, suggested.Bottom - suggested.Top,
                Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
            m.Result = IntPtr.Zero;
            return;
        }
        if (m.Msg == Native.WM_WINDOWPOSCHANGED)
        {
            handlingWindowPosChanged = true;
            try
            {
                base.WndProc(ref m);
            }
            finally
            {
                handlingWindowPosChanged = false;
            }
            return;
        }
        base.WndProc(ref m);
    }

    // When the window returns from maximized or minimized, Windows has already restored its
    // exact size. WinForms would then re-apply the client size it saved earlier, adding a
    // standard window frame that this window doesn't have, so the window grew on every restore.
    protected override void SetBoundsCore(int x, int y, int width, int height, BoundsSpecified specified)
    {
        if (handlingWindowPosChanged) return;
        base.SetBoundsCore(x, y, width, height, specified);
    }

    void UpdateMinimumSize(int dpi)
    {
        var scale = (dpi > 0 ? dpi : 96) / 96.0;
        MinimumSize = new Size((int)(760 * scale), (int)(460 * scale));
    }

    // A maximized window is larger than the screen by its (invisible) border, so the content
    // is fitted to the monitor's work area instead.
    static Native.RECT MaximizedClientArea(Native.RECT proposed)
    {
        var monitor = Native.MonitorFromRect(ref proposed, Native.MONITOR_DEFAULTTONEAREST);
        var info = new Native.MONITORINFO { Size = Marshal.SizeOf<Native.MONITORINFO>() };
        if (!Native.GetMonitorInfo(monitor, ref info)) return proposed;
        var area = info.Work;
        // Leave a pixel free so an auto-hidden taskbar can still slide in.
        if (Native.HasAutoHideTaskbar(Native.ABE_BOTTOM, info.Monitor)) area.Bottom -= 1;
        else if (Native.HasAutoHideTaskbar(Native.ABE_TOP, info.Monitor)) area.Top += 1;
        else if (Native.HasAutoHideTaskbar(Native.ABE_LEFT, info.Monitor)) area.Left += 1;
        else if (Native.HasAutoHideTaskbar(Native.ABE_RIGHT, info.Monitor)) area.Right -= 1;
        return area;
    }

    void SetDwmAttribute(int attribute, int value) =>
        Native.DwmSetWindowAttribute(Handle, attribute, ref value, sizeof(int));

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (WindowState == lastState) return;
        if (WindowState == FormWindowState.Minimized) stateBeforeMinimize = lastState;
        lastState = WindowState;
        SendWindowState(ActiveForm == this);
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        SendWindowState(true);
    }

    protected override void OnDeactivate(EventArgs e)
    {
        base.OnDeactivate(e);
        SendWindowState(false);
    }

    void SendWindowState(bool active) => Post(new Dictionary<string, object>
    {
        ["type"] = "window-state",
        ["maximized"] = WindowState == FormWindowState.Maximized,
        ["active"] = active,
    });

    void RunWindowCommand(string action, string edge)
    {
        switch (action)
        {
            case "minimize":
                WindowState = FormWindowState.Minimized;
                break;
            case "toggle-maximize":
                WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                break;
            case "close":
                Close();
                break;
            case "resize":
                StartResize(edge);
                break;
        }
    }

    // Hands an edge drag that started in the page over to the native sizing loop.
    void StartResize(string edge)
    {
        var hitTest = edge switch
        {
            "left" => Native.HTLEFT,
            "right" => Native.HTRIGHT,
            "top" => Native.HTTOP,
            "bottom" => Native.HTBOTTOM,
            "top-left" => Native.HTTOPLEFT,
            "top-right" => Native.HTTOPRIGHT,
            "bottom-left" => Native.HTBOTTOMLEFT,
            "bottom-right" => Native.HTBOTTOMRIGHT,
            _ => 0,
        };
        if (hitTest == 0 || WindowState != FormWindowState.Normal || !IsPrimaryButtonDown()) return;
        Native.ReleaseCapture();
        var cursor = Cursor.Position;
        Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)hitTest, Native.MakePoint(cursor.X, cursor.Y));
    }

    static bool IsPrimaryButtonDown()
    {
        var button = SystemInformation.MouseButtonsSwapped ? Native.VK_RBUTTON : Native.VK_LBUTTON;
        return (Native.GetAsyncKeyState(button) & 0x8000) != 0;
    }

    void OnActivateSignal()
    {
        if (!IsHandleCreated || IsDisposed) return;
        BeginInvoke(new Action(() =>
        {
            if (WindowState == FormWindowState.Minimized) WindowState = stateBeforeMinimize;
            Activate();
            Native.SetForegroundWindow(Handle);
        }));
    }

    protected override async void OnFormClosing(FormClosingEventArgs e)
    {
        if (!pageSaved && view.CoreWebView2 != null && e.CloseReason != CloseReason.WindowsShutDown)
        {
            // Give the page a moment to save its settings before the window goes away.
            e.Cancel = true;
            pageSaved = true;
            try
            {
                await Task.WhenAny(view.CoreWebView2.ExecuteScriptAsync("window.newscenter && window.newscenter.flush()"), Task.Delay(1000));
            }
            catch (Exception error) when (error is InvalidOperationException or COMException)
            {
            }
            Close();
            return;
        }
        // The channels' own windows close with News Center and reopen with it next time.
        closingApp = true;
        foreach (var window in new List<ChannelWindow>(channelWindows.Values)) window.CloseByApp();
        WindowPlacement.Save(this, WindowState == FormWindowState.Minimized && stateBeforeMinimize == FormWindowState.Maximized);
        activateRegistration.Unregister(null);
        base.OnFormClosing(e);
    }

    /* ---------- Browser ---------- */

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            await InitializeBrowserAsync();
        }
        catch (WebView2RuntimeNotFoundException)
        {
            MessageBox.Show(this,
                "News Center needs the Microsoft Edge WebView2 Runtime. Install it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start News Center again.",
                "News Center", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
        catch (Exception error)
        {
            Program.ReportError("News Center could not start", error);
            Close();
        }
    }

    async Task InitializeBrowserAsync()
    {
        var arguments = "--autoplay-policy=no-user-gesture-required --disable-features=HardwareMediaKeyHandling";
        if (debug) arguments += " --remote-debugging-port=" + Environment.GetEnvironmentVariable("NEWSCENTER_DEBUG_PORT");
        var options = new CoreWebView2EnvironmentOptions(arguments);
        environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataFolder, "WebView2"), options);
        await view.EnsureCoreWebView2Async(environment);

        var core = view.CoreWebView2;
        await PrepareBrowserAsync(core, environment, appFolder, debug);
        // The page draws the title bar; CSS app-region marks where it moves the window.
        core.Settings.IsNonClientRegionSupportEnabled = true;
        userAgent = core.Settings.UserAgent;
        core.WebMessageReceived += OnWebMessageReceived;
        core.ProcessFailed += OnProcessFailed;
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? "News Center" : core.DocumentTitle;
        core.Navigate(AppOrigin + "/index.html");
    }

    // What every News Center browser view shares – the dashboard and the channels' own windows:
    // the app folder as https://newscenter.example, blocked sites, links in the user's browser,
    // autoplay, an editing-only context menu, and the helper for web-page channels.
    internal static async Task PrepareBrowserAsync(CoreWebView2 core, CoreWebView2Environment environment, string appFolder, bool debug)
    {
        var settings = core.Settings;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.AreDevToolsEnabled = debug;
        settings.IsStatusBarEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsPinchZoomEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;

        core.SetVirtualHostNameToFolderMapping(AppHost, appFolder, CoreWebView2HostResourceAccessKind.Allow);
        foreach (var domain in BlockedDomains)
        {
            foreach (var pattern in new[] { "*://" + domain + "/*", "*://*." + domain + "/*" })
            {
                core.AddWebResourceRequestedFilter(pattern, CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
            }
        }
        core.WebResourceRequested += (_, e) =>
        {
            if (IsBlocked(e.Request.Uri)) e.Response = environment.CreateWebResourceResponse(null, 403, "Blocked", "Content-Type: text/plain");
        };
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += OnNewWindowRequested;
        core.PermissionRequested += OnPermissionRequested;
        core.ContextMenuRequested += (_, e) => TrimContextMenu(e, debug);

        // Runs in every frame; it only acts inside web pages that the dashboard shows as channels.
        var helper = Path.Combine(appFolder, "page-helper.js");
        if (File.Exists(helper)) await core.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(helper));
    }

    void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(AppOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
        Dictionary<string, object> message;
        try
        {
            message = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
        }
        catch (Exception error) when (error is ArgumentException or InvalidOperationException)
        {
            return;
        }
        if (message == null) return;

        switch (GetString(message, "type"))
        {
            case "ready":
                SendWindowState(ActiveForm == this);
                break;
            case "window":
                var action = GetString(message, "action");
                var edge = GetString(message, "edge");
                // Run after the event returns: window commands can start modal sizing loops.
                BeginInvoke(new Action(() => RunWindowCommand(action, edge)));
                break;
            case "fetch":
                _ = FetchAsync(GetString(message, "id"), GetString(message, "url"));
                break;
            case "channel-window":
                var windowAction = GetString(message, "action");
                var channelId = GetString(message, "id");
                var channelName = GetString(message, "name");
                var activate = message.TryGetValue("activate", out var activateValue) && activateValue is true;
                BeginInvoke(new Action(() => RunChannelWindowCommand(windowAction, channelId, channelName, activate)));
                break;
        }
    }

    // The dashboard opens a channel's own window when the channel moves there (or comes back on
    // air), and closes it when the channel leaves it (or goes off air).
    void RunChannelWindowCommand(string action, string id, string name, bool activate)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 300) return;
        switch (action)
        {
            case "open":
                if (channelWindows.TryGetValue(id, out var existing))
                {
                    if (!activate) return;
                    if (existing.WindowState == FormWindowState.Minimized) existing.WindowState = FormWindowState.Normal;
                    existing.Activate();
                    return;
                }
                if (environment == null || closingApp || IsDisposed) return;
                var window = new ChannelWindow(this, environment, appFolder, debug, id, name, activate, channelWindows.Count);
                channelWindows[id] = window;
                window.Show();
                break;
            case "close":
                if (channelWindows.TryGetValue(id, out var open)) open.CloseByApp();
                break;
        }
    }

    // When the user closes a channel's window, the dashboard puts the channel back in the grid.
    internal void OnChannelWindowClosed(ChannelWindow window, bool byUser)
    {
        if (channelWindows.TryGetValue(window.ChannelId, out var current) && current == window) channelWindows.Remove(window.ChannelId);
        if (byUser && !closingApp) Post(new Dictionary<string, object> { ["type"] = "channel-window-closed", ["id"] = window.ChannelId });
    }

    // Fetches a page or a news feed for the dashboard without the browser's cross-site
    // restrictions, which is how it reads the knesset.tv live listings and RSS feeds.
    async Task FetchAsync(string id, string url)
    {
        var result = new Dictionary<string, object> { ["type"] = "fetch-result", ["id"] = id };
        try
        {
            var uri = HttpUri(url) ?? throw new ArgumentException("Only http and https addresses can be fetched.");
            for (var redirects = 0; ; redirects++)
            {
                if (IsBlocked(uri.AbsoluteUri)) throw new ArgumentException("This site is blocked in News Center.");
                using var request = new HttpRequestMessage(HttpMethod.Get, uri);
                if (!string.IsNullOrEmpty(userAgent)) request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
                request.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml;q=0.9,text/xml;q=0.9,application/json;q=0.9,*/*;q=0.8");
                request.Headers.TryAddWithoutValidation("Accept-Language", "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7");
                using var response = await Http.SendAsync(request);
                // Redirects are followed here, one by one, so none can lead to a blocked site.
                // A relative address counts from where the earlier redirects led.
                var status = (int)response.StatusCode;
                if ((status is 301 or 302 or 303 or 307 or 308) && response.Headers.Location != null && redirects < MaxRedirects)
                {
                    uri = HttpUri(new Uri(uri, response.Headers.Location).AbsoluteUri) ?? throw new ArgumentException("The address redirects somewhere that can't be fetched.");
                    continue;
                }
                result["ok"] = response.IsSuccessStatusCode;
                result["status"] = (int)response.StatusCode;
                result["url"] = response.RequestMessage?.RequestUri?.AbsoluteUri ?? uri.AbsoluteUri;
                result["text"] = DecodeText(await response.Content.ReadAsByteArrayAsync(), response.Content.Headers.ContentType?.CharSet);
                break;
            }
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or ArgumentException or InvalidOperationException)
        {
            result["ok"] = false;
            result["status"] = 0;
            result["error"] = error.GetBaseException().Message;
        }
        Post(result);
    }

    // Feeds often name their encoding only inside the document, as in
    // <?xml version="1.0" encoding="windows-1255"?>, so that counts when the server doesn't say.
    static string DecodeText(byte[] bytes, string headerCharset)
    {
        var encoding = EncodingNamed(headerCharset) ?? EncodingFromBom(bytes) ?? EncodingDeclared(bytes) ?? new UTF8Encoding(false);
        var text = encoding.GetString(bytes);
        return text.Length > 0 && text[0] == '\uFEFF' ? text.Substring(1) : text;
    }

    static Encoding EncodingNamed(string name)
    {
        name = name?.Trim().Trim('"', '\'').ToLowerInvariant();
        if (string.IsNullOrEmpty(name)) return null;
        if (name == "utf8") name = "utf-8";
        try
        {
            return Encoding.GetEncoding(name);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    static Encoding EncodingFromBom(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) return new UTF8Encoding(false);
        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) return Encoding.Unicode;
        if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) return Encoding.BigEndianUnicode;
        return null;
    }

    static Encoding EncodingDeclared(byte[] bytes)
    {
        var match = DeclaredCharset.Match(Encoding.ASCII.GetString(bytes, 0, Math.Min(bytes.Length, 2048)));
        if (!match.Success) return null;
        return EncodingNamed(match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value);
    }

    static void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri.StartsWith(AppOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
        // Keep the dashboard in the window; anything that tries to replace it opens in the browser.
        e.Cancel = true;
        if (e.IsUserInitiated) OpenExternal(e.Uri);
    }

    static void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (e.IsUserInitiated) OpenExternal(e.Uri);
    }

    static void OnPermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        e.State = e.PermissionKind == CoreWebView2PermissionKind.Autoplay
            ? CoreWebView2PermissionState.Allow
            : CoreWebView2PermissionState.Deny;
    }

    // Keeps only editing commands, so the window feels like an app rather than a browser.
    static void TrimContextMenu(CoreWebView2ContextMenuRequestedEventArgs e, bool debug)
    {
        if (debug) return;
        var items = e.MenuItems;
        for (var i = items.Count - 1; i >= 0; i--)
        {
            if (!EditMenuItems.Contains(items[i].Name)) items.RemoveAt(i);
        }
        if (items.Count == 0) e.Handled = true;
    }

    void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
    {
        switch (e.ProcessFailedKind)
        {
            case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                BeginInvoke(new Action(() =>
                {
                    MessageBox.Show(this, "The browser engine behind News Center stopped. Start News Center again to continue.",
                        "News Center", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    pageSaved = true;
                    Close();
                }));
                break;
            case CoreWebView2ProcessFailedKind.RenderProcessExited:
            case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                view.CoreWebView2?.Reload();
                break;
        }
    }

    void Post(Dictionary<string, object> message)
    {
        try
        {
            view.CoreWebView2?.PostWebMessageAsJson(json.Serialize(message));
        }
        catch (Exception error) when (error is InvalidOperationException or COMException)
        {
        }
    }

    internal static string GetString(Dictionary<string, object> message, string key) =>
        message.TryGetValue(key, out var value) ? Convert.ToString(value) : null;

    static void OpenExternal(string address)
    {
        var uri = HttpUri(address);
        if (uri == null || IsBlocked(uri.AbsoluteUri)) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Win32Exception)
        {
        }
    }

    static Uri HttpUri(string address) =>
        Uri.TryCreate(address, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) ? uri : null;

    static bool IsBlocked(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri)) return false;
        var host = uri.Host.TrimEnd('.').ToLowerInvariant();
        foreach (var domain in BlockedDomains)
        {
            if (host == domain || host.EndsWith("." + domain, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    static HttpClient CreateHttpClient()
    {
        var handler = new HttpClientHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            UseCookies = false,
        };
        return new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20), MaxResponseContentBufferSize = MaxFetchBytes };
    }
}
