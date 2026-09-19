using Microsoft.Win32;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace LaserBench.Launcher;

internal static class Program
{
    private const uint MB_YESNOCANCEL = 0x00000003;
    private const uint MB_ICONWARNING = 0x00000030;
    private const uint MB_ICONERROR = 0x00000010;
    private const uint MB_ICONINFORMATION = 0x00000040;
    private const int IDYES = 6;
    private const int IDNO = 7;
    private const string DotNetDownloadUrl = "https://dotnet.microsoft.com/download/dotnet/8.0";
    private const string WebView2DownloadUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";
    private const string WebView2ClientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

    [STAThread]
    private static int Main(string[] args)
    {
        var root = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var appPath = Path.Combine(root, "LaserBench.App.exe");

        var checkArg = args.FirstOrDefault(x => x.StartsWith("--check=", StringComparison.OrdinalIgnoreCase));
        if (checkArg is not null)
        {
            var path = checkArg[(checkArg.IndexOf('=') + 1)..].Trim('"');
            WriteCheck(path, root, appPath);
            return File.Exists(appPath) && HasDotNetDesktop8() && HasWebView2Runtime() ? 0 : 2;
        }

        if (!File.Exists(appPath))
        {
            MessageBoxW(IntPtr.Zero, "LaserBench.App.exe is missing. Re-extract the complete portable package or apply the patch again.", "LaserBench", MB_ICONERROR);
            return 3;
        }

        var dependencyResult = EnsureDependency(root, ".NET 8 Desktop Runtime (x64)", "install-dotnet8.ps1", HasDotNetDesktop8, DotNetDownloadUrl, "Install the Microsoft .NET 8 Desktop Runtime for Windows x64, then launch LaserBench again.", 10);
        if (dependencyResult != 0) return dependencyResult;

        dependencyResult = EnsureDependency(root, "Microsoft Edge WebView2 Runtime", "install-webview2.ps1", HasWebView2Runtime, WebView2DownloadUrl, "Install the Microsoft Edge WebView2 Evergreen Runtime, then launch LaserBench again.", 20);
        if (dependencyResult != 0) return dependencyResult;

        try
        {
            Process.Start(new ProcessStartInfo(appPath) { UseShellExecute = true, WorkingDirectory = root });
            return 0;
        }
        catch (Exception ex)
        {
            MessageBoxW(IntPtr.Zero, $"LaserBench could not start.\n\n{ex.Message}", "LaserBench", MB_ICONERROR);
            return 9;
        }
    }

    private static int EnsureDependency(string root, string displayName, string scriptName, Func<bool> probe, string fallbackUrl, string fallbackText, int codeBase)
    {
        if (probe()) return 0;
        var choice = MessageBoxW(IntPtr.Zero, $"{displayName} is required.\n\nYes: install online from Microsoft\nNo: open the offline dependency guide\nCancel: exit", "LaserBench environment check", MB_YESNOCANCEL | MB_ICONWARNING);

        if (choice == IDYES)
        {
            var script = Path.Combine(root, "tools", scriptName);
            if (!File.Exists(script))
            {
                MessageBoxW(IntPtr.Zero, $"Online installer script is missing: {scriptName}", "LaserBench", MB_ICONERROR);
                return codeBase + 1;
            }
            try
            {
                var psi = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, WorkingDirectory = root };
                psi.ArgumentList.Add("-NoProfile"); psi.ArgumentList.Add("-ExecutionPolicy"); psi.ArgumentList.Add("Bypass"); psi.ArgumentList.Add("-File"); psi.ArgumentList.Add(script);
                using var process = Process.Start(psi);
                if (process is null) throw new InvalidOperationException("PowerShell installer process could not be created.");
                process.WaitForExit();
                if (process.ExitCode != 0)
                {
                    MessageBoxW(IntPtr.Zero, $"{displayName} installer exited with code {process.ExitCode}. Use the offline guide or retry.", "LaserBench", MB_ICONWARNING);
                    return codeBase + 2;
                }
            }
            catch (Exception ex)
            {
                MessageBoxW(IntPtr.Zero, $"Could not start the online installer.\n\n{ex.Message}", "LaserBench", MB_ICONERROR);
                return codeBase + 3;
            }
            if (!probe())
            {
                MessageBoxW(IntPtr.Zero, $"{displayName} is still unavailable. Use the offline guide or retry the online installation.", "LaserBench", MB_ICONWARNING);
                return codeBase + 4;
            }
            return 0;
        }

        if (choice == IDNO)
        {
            OpenOfflineGuide(root, fallbackUrl, fallbackText);
            return codeBase + 5;
        }
        return codeBase + 6;
    }

    private static bool HasDotNetDesktop8()
    {
        try
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var shared = Path.Combine(programFiles, "dotnet", "shared", "Microsoft.WindowsDesktop.App");
            if (!Directory.Exists(shared)) return false;
            foreach (var directory in Directory.EnumerateDirectories(shared))
            {
                var name = Path.GetFileName(directory);
                if (Version.TryParse(name, out var version) && version.Major == 8) return true;
            }
        }
        catch { return false; }
        return false;
    }

    private static bool HasWebView2Runtime()
    {
        var keys = new[]
        {
            $@"HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WebView2ClientId}",
            $@"HKEY_CURRENT_USER\Software\Microsoft\EdgeUpdate\Clients\{WebView2ClientId}"
        };
        foreach (var key in keys)
        {
            try
            {
                var value = Registry.GetValue(key, "pv", null)?.ToString();
                if (Version.TryParse(value, out var version) && version.CompareTo(new Version(0, 0, 0, 0)) > 0) return true;
            }
            catch { }
        }
        return false;
    }

    private static void OpenOfflineGuide(string root, string fallbackUrl, string fallbackText)
    {
        var guide = Path.Combine(root, "OFFLINE-DEPENDENCIES.txt");
        try { Process.Start(new ProcessStartInfo(File.Exists(guide) ? guide : fallbackUrl) { UseShellExecute = true }); }
        catch { MessageBoxW(IntPtr.Zero, fallbackText, "LaserBench offline dependency guide", MB_ICONINFORMATION); }
    }

    private static void WriteCheck(string path, string root, string appPath)
    {
        static string JsonEscape(string value)
        {
            var sb = new StringBuilder(value.Length + 8);
            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\t': sb.Append("\\t"); break;
                    default: sb.Append(ch); break;
                }
            }
            return sb.ToString();
        }

        var appExists = File.Exists(appPath);
        var dotnet = HasDotNetDesktop8();
        var webView2 = HasWebView2Runtime();
        var json = "{\n" +
                   $"  \"ok\": {(appExists && dotnet && webView2 ? "true" : "false")},\n" +
                   $"  \"root\": \"{JsonEscape(root)}\",\n" +
                   $"  \"appExists\": {(appExists ? "true" : "false")},\n" +
                   $"  \"dotnetDesktop8\": {(dotnet ? "true" : "false")},\n" +
                   $"  \"webView2Runtime\": {(webView2 ? "true" : "false")},\n" +
                   "  \"portable\": true\n" +
                   "}\n";
        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
        File.WriteAllText(path, json, new UTF8Encoding(false));
    }
}
