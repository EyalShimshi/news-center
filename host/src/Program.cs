using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Threading;
using System.Windows.Forms;

[assembly: TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]
[assembly: AssemblyTitle("News Center")]
[assembly: AssemblyProduct("News Center")]
[assembly: AssemblyDescription("Multiview dashboard for live TV")]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

namespace NewsCenter;

static class Program
{
    const string InstanceName = @"Local\NewsCenter.Instance";
    const string ActivateEventName = @"Local\NewsCenter.Activate";

    static readonly Dictionary<string, Assembly> embeddedAssemblies = new(StringComparer.OrdinalIgnoreCase);

    public static string DataFolder { get; } =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NewsCenter");

    public static Icon AppIcon { get; private set; }

    [STAThread]
    static void Main()
    {
        using var instance = new Mutex(true, InstanceName, out var isFirstInstance);
        if (!isFirstInstance)
        {
            // Bring the running window forward instead of opening a second one.
            Native.AllowSetForegroundWindow(-1);
            try
            {
                using var signal = EventWaitHandle.OpenExisting(ActivateEventName);
                signal.Set();
            }
            catch (WaitHandleCannotBeOpenedException)
            {
            }
            return;
        }

        using var activate = new EventWaitHandle(false, EventResetMode.AutoReset, ActivateEventName);
        AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbeddedAssembly;
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => ReportError("News Center ran into a problem", e.Exception);

        var appFolder = FindAppFolder();
        if (appFolder == null)
        {
            MessageBox.Show(
                "News Center could not find its \"app\" folder. Keep NewsCenter.exe next to the app folder.",
                "News Center", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            Directory.CreateDirectory(DataFolder);
            AppIcon = LoadIcon();
            Run(appFolder, activate);
        }
        catch (Exception error)
        {
            ReportError("News Center could not start", error);
        }
    }

    // Kept separate so WebView2 types are only loaded after the embedded-assembly resolver is registered.
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Run(string appFolder, EventWaitHandle activate)
    {
        PrepareWebView2Loader();
        Application.Run(new MainForm(appFolder, activate));
    }

    static string FindAppFolder()
    {
        var folder = AppDomain.CurrentDomain.BaseDirectory;
        for (var depth = 0; depth < 4 && folder != null; depth++)
        {
            var candidate = Path.Combine(folder, "app");
            if (File.Exists(Path.Combine(candidate, "index.html"))) return candidate;
            folder = Path.GetDirectoryName(folder.TrimEnd(Path.DirectorySeparatorChar));
        }
        return null;
    }

    static Assembly ResolveEmbeddedAssembly(object sender, ResolveEventArgs args)
    {
        var name = new AssemblyName(args.Name).Name;
        lock (embeddedAssemblies)
        {
            if (embeddedAssemblies.TryGetValue(name, out var loaded)) return loaded;
            var bytes = ReadResource("lib." + name + ".dll");
            if (bytes == null) return null;
            var assembly = Assembly.Load(bytes);
            embeddedAssemblies[name] = assembly;
            return assembly;
        }
    }

    // WebView2Loader.dll is native, so it is unpacked once to a versioned folder and loaded from there.
    static void PrepareWebView2Loader()
    {
        var bytes = ReadResource("lib.WebView2Loader.dll") ?? throw new FileNotFoundException("WebView2Loader.dll is missing from NewsCenter.exe.");
        string version;
        using (var sha = SHA256.Create())
        {
            version = BitConverter.ToString(sha.ComputeHash(bytes), 0, 6).Replace("-", "").ToLowerInvariant();
        }
        var folder = Path.Combine(DataFolder, "runtime", version);
        var path = Path.Combine(folder, "WebView2Loader.dll");
        if (!File.Exists(path))
        {
            Directory.CreateDirectory(folder);
            var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllBytes(temp, bytes);
            try
            {
                File.Move(temp, path);
            }
            catch (IOException)
            {
                File.Delete(temp);
            }
        }
        if (Native.LoadLibrary(path) == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not load " + path);
        }
    }

    static Icon LoadIcon()
    {
        using var stream = typeof(Program).Assembly.GetManifestResourceStream("NewsCenter.ico");
        return stream == null ? SystemIcons.Application : new Icon(stream);
    }

    static byte[] ReadResource(string name)
    {
        using var stream = typeof(Program).Assembly.GetManifestResourceStream(name);
        if (stream == null) return null;
        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return memory.ToArray();
    }

    public static void ReportError(string title, Exception error)
    {
        try
        {
            Directory.CreateDirectory(DataFolder);
            File.AppendAllText(Path.Combine(DataFolder, "error.log"), $"[{DateTime.Now:u}] {title}{Environment.NewLine}{error}{Environment.NewLine}{Environment.NewLine}");
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
        MessageBox.Show(error.GetBaseException().Message, title, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
