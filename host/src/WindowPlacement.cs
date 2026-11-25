using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace NewsCenter;

// Remembers where the window was, so News Center reopens in the same place.
static class WindowPlacement
{
    static string FilePath => Path.Combine(Program.DataFolder, "window.json");

    public static void Restore(Form form)
    {
        var area = Screen.PrimaryScreen.WorkingArea;
        var bounds = new Rectangle(area.X + area.Width / 10, area.Y + area.Height / 10, area.Width * 8 / 10, area.Height * 8 / 10);
        var maximized = false;
        var saved = Read();
        if (saved != null)
        {
            if (saved.Value.Bounds.Width >= 400 && saved.Value.Bounds.Height >= 300 && IsOnScreen(saved.Value.Bounds)) bounds = saved.Value.Bounds;
            maximized = saved.Value.Maximized;
        }
        form.Bounds = bounds;
        if (maximized) form.WindowState = FormWindowState.Maximized;
    }

    public static void Save(Form form, bool minimizedFromMaximized)
    {
        var bounds = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
        var data = new Dictionary<string, object>
        {
            ["x"] = bounds.X,
            ["y"] = bounds.Y,
            ["width"] = bounds.Width,
            ["height"] = bounds.Height,
            ["maximized"] = form.WindowState == FormWindowState.Maximized || minimizedFromMaximized,
        };
        var temp = FilePath + ".tmp";
        try
        {
            // Written to a temporary file first, so an interrupted save never leaves a broken file behind.
            File.WriteAllText(temp, new JavaScriptSerializer().Serialize(data));
            if (File.Exists(FilePath)) File.Replace(temp, FilePath, null);
            else File.Move(temp, FilePath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    static (Rectangle Bounds, bool Maximized)? Read()
    {
        try
        {
            if (new JavaScriptSerializer().DeserializeObject(File.ReadAllText(FilePath)) is not Dictionary<string, object> data) return null;
            var bounds = new Rectangle(ToInt(data["x"]), ToInt(data["y"]), ToInt(data["width"]), ToInt(data["height"]));
            return (bounds, data.TryGetValue("maximized", out var value) && value is true);
        }
        catch (Exception)
        {
            // A missing or damaged file just means the default placement.
            return null;
        }
    }

    internal static bool IsOnScreen(Rectangle bounds) =>
        Screen.AllScreens.Any(screen =>
        {
            var visible = Rectangle.Intersect(screen.WorkingArea, bounds);
            return visible.Width >= 200 && visible.Height >= 120;
        });

    static int ToInt(object value) => Convert.ToInt32(value);
}
