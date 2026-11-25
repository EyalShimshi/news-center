using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace NewsCenter;

// A channel in its own window: the dashboard page in single-channel mode (index.html?channel=<id>)
// in an ordinary window that can go anywhere – another monitor, on top of other apps, or filling
// its screen. The main window keeps the channel's sound rules; when the user closes this window,
// the channel goes back to the grid.
sealed class ChannelWindow : Form
{
    readonly MainForm main;
    readonly CoreWebView2Environment environment;
    readonly string appFolder;
    readonly bool debug;
    readonly bool activateOnShow;
    readonly WebView2 view;
    readonly JavaScriptSerializer json = new();
    bool closingByApp;
    bool fullscreen;
    bool maximizedBeforeFullscreen;
    Rectangle boundsBeforeFullscreen;

    public string ChannelId { get; }

    public ChannelWindow(MainForm main, CoreWebView2Environment environment, string appFolder, bool debug, string channelId, string name, bool activate, int cascade)
    {
        this.main = main;
        this.environment = environment;
        this.appFolder = appFolder;
        this.debug = debug;
        activateOnShow = activate;
        ChannelId = channelId;
        Text = string.IsNullOrWhiteSpace(name) ? "News Center" : name + " – News Center";
        Icon = Program.AppIcon;
        BackColor = Color.Black;
        StartPosition = FormStartPosition.Manual;
        view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
        Controls.Add(view);
        var scale = main.DeviceDpi / 96.0;
        MinimumSize = new Size((int)(320 * scale), (int)(220 * scale));
        var saved = ChannelWindowPlacement.Read(channelId);
        Bounds = saved?.Bounds ?? DefaultBounds(main, cascade, scale);
        TopMost = saved?.TopMost ?? false;
        if (saved?.Maximized == true) WindowState = FormWindowState.Maximized;
    }

    // Next to the main window's right edge, on its screen; each further window a little lower.
    static Rectangle DefaultBounds(Form main, int cascade, double scale)
    {
        var area = Screen.FromControl(main).WorkingArea;
        var width = Math.Min((int)(640 * scale), area.Width);
        var height = Math.Min((int)(440 * scale), area.Height);
        var step = (int)(28 * scale) * (cascade % 8);
        var x = Math.Max(area.Left, area.Right - width - (int)(24 * scale) - step);
        var y = Math.Max(area.Top, Math.Min(area.Top + (int)(72 * scale) + step, area.Bottom - height));
        return new Rectangle(x, y, width, height);
    }

    // A window that reopens by itself (at start, or when its channel is back on air) doesn't take
    // the focus from what the user is doing.
    protected override bool ShowWithoutActivation => !activateOnShow;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        // A dark title bar, like the rest of News Center.
        var dark = 1;
        Native.DwmSetWindowAttribute(Handle, Native.DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, sizeof(int));
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            await view.EnsureCoreWebView2Async(environment);
            var core = view.CoreWebView2;
            await MainForm.PrepareBrowserAsync(core, environment, appFolder, debug);
            core.WebMessageReceived += OnWebMessageReceived;
            core.DocumentTitleChanged += (_, _) =>
            {
                if (!string.IsNullOrWhiteSpace(core.DocumentTitle)) Text = core.DocumentTitle;
            };
            core.ProcessFailed += (_, args) =>
            {
                if (args.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive) core.Reload();
            };
            core.Navigate(MainForm.AppOrigin + "/index.html?channel=" + Uri.EscapeDataString(ChannelId));
        }
        catch (Exception error) when (error is COMException or InvalidOperationException or ArgumentException or WebView2RuntimeNotFoundException)
        {
            // Without its browser view the window is of no use: the channel goes back to the grid.
            Close();
        }
    }

    void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!e.Source.StartsWith(MainForm.AppOrigin + "/", StringComparison.OrdinalIgnoreCase)) return;
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
        switch (MainForm.GetString(message, "type"))
        {
            case "ready":
                SendState();
                break;
            case "window":
                var action = MainForm.GetString(message, "action");
                BeginInvoke(new Action(() => RunWindowCommand(action)));
                break;
        }
    }

    void RunWindowCommand(string action)
    {
        switch (action)
        {
            case "fullscreen":
                SetFullscreen(!fullscreen);
                break;
            case "exit-fullscreen":
                SetFullscreen(false);
                break;
            case "pin":
                TopMost = !TopMost;
                SendState();
                break;
            case "close":
                Close();
                break;
        }
    }

    // Fills the monitor the window is on, without a frame; the same again brings the window back.
    void SetFullscreen(bool on)
    {
        if (on == fullscreen) return;
        if (on)
        {
            maximizedBeforeFullscreen = WindowState == FormWindowState.Maximized;
            boundsBeforeFullscreen = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            var screen = Screen.FromControl(this).Bounds;
            WindowState = FormWindowState.Normal;
            FormBorderStyle = FormBorderStyle.None;
            Bounds = screen;
        }
        else
        {
            FormBorderStyle = FormBorderStyle.Sizable;
            Bounds = boundsBeforeFullscreen;
            if (maximizedBeforeFullscreen) WindowState = FormWindowState.Maximized;
        }
        fullscreen = on;
        SendState();
    }

    // Closed by News Center itself (it is closing, or the channel went off air): the channel stays
    // in its own window for next time.
    public void CloseByApp()
    {
        closingByApp = true;
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing or CloseReason.ApplicationExitCall) closingByApp = true;
        var maximized = fullscreen ? maximizedBeforeFullscreen : WindowState == FormWindowState.Maximized;
        var bounds = fullscreen ? boundsBeforeFullscreen : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        ChannelWindowPlacement.Save(ChannelId, bounds, maximized, TopMost);
        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        base.OnFormClosed(e);
        main.OnChannelWindowClosed(this, !closingByApp);
    }

    void SendState() => Post(new Dictionary<string, object>
    {
        ["type"] = "window-state",
        ["pinned"] = TopMost,
        ["fullscreen"] = fullscreen,
    });

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
}

// Where each channel's window was, and whether it stayed on top, so it reopens the same way
// (channel-windows.json in the data folder).
static class ChannelWindowPlacement
{
    const int MaxEntries = 100;

    static string FilePath => Path.Combine(Program.DataFolder, "channel-windows.json");

    public sealed class Entry
    {
        public Rectangle Bounds { get; set; }
        public bool Maximized { get; set; }
        public bool TopMost { get; set; }
    }

    public static Entry Read(string id)
    {
        try
        {
            if (ReadAll().TryGetValue(id, out var value) && value is Dictionary<string, object> data)
            {
                var bounds = new Rectangle(ToInt(data["x"]), ToInt(data["y"]), ToInt(data["width"]), ToInt(data["height"]));
                if (bounds.Width >= 200 && bounds.Height >= 120 && WindowPlacement.IsOnScreen(bounds))
                {
                    return new Entry
                    {
                        Bounds = bounds,
                        Maximized = data.TryGetValue("maximized", out var maximized) && maximized is true,
                        TopMost = data.TryGetValue("topMost", out var topMost) && topMost is true,
                    };
                }
            }
        }
        catch (Exception)
        {
            // A damaged entry just means the default placement.
        }
        return null;
    }

    public static void Save(string id, Rectangle bounds, bool maximized, bool topMost)
    {
        var all = ReadAll();
        all.Remove(id);
        // Plenty for every channel a user moves out; the oldest ones go first.
        while (all.Count >= MaxEntries)
        {
            using var keys = all.Keys.GetEnumerator();
            if (!keys.MoveNext()) break;
            all.Remove(keys.Current);
        }
        all[id] = new Dictionary<string, object>
        {
            ["x"] = bounds.X,
            ["y"] = bounds.Y,
            ["width"] = bounds.Width,
            ["height"] = bounds.Height,
            ["maximized"] = maximized,
            ["topMost"] = topMost,
        };
        var temp = FilePath + ".tmp";
        try
        {
            // Written to a temporary file first, so an interrupted save never leaves a broken file behind.
            File.WriteAllText(temp, new JavaScriptSerializer().Serialize(all));
            if (File.Exists(FilePath)) File.Replace(temp, FilePath, null);
            else File.Move(temp, FilePath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    static Dictionary<string, object> ReadAll()
    {
        try
        {
            if (File.Exists(FilePath) && new JavaScriptSerializer().DeserializeObject(File.ReadAllText(FilePath)) is Dictionary<string, object> data) return data;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or InvalidOperationException)
        {
        }
        return new Dictionary<string, object>(StringComparer.Ordinal);
    }

    static int ToInt(object value) => Convert.ToInt32(value);
}
