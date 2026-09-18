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
            return File.Exists(appPath) && HasDotNetDesktop8() ? 0 : 2;
        }

        if (!File.Exists(appPath))
        {
            MessageBoxW(IntPtr.Zero,
                "LaserBench.App.exe is missing. Re-extract the complete portable package or apply the patch again.",
                "LaserBench", MB_ICONERROR);
            return 3;
        }

        if (!HasDotNetDesktop8())
        {
            var choice = MessageBoxW(IntPtr.Zero,
                ".NET 8 Desktop Runtime (x64) is required.\n\nYes: install online from Microsoft\nNo: open the offline dependency guide\nCancel: exit",
                "LaserBench environment check", MB_YESNOCANCEL | MB_ICONWARNING);

            if (choice == IDYES)
            {
                var script = Path.Combine(root, "tools", "install-dotnet8.ps1");
                if (!File.Exists(script))
                {
                    MessageBoxW(IntPtr.Zero, "Online installer script is missing.", "LaserBench", MB_ICONERROR);
                    return 4;
                }

                try
                {
                    var psi = new ProcessStartInfo("powershell.exe")
                    {
                        UseShellExecute = false,
                        WorkingDirectory = root
                    };
                    psi.ArgumentList.Add("-NoProfile");
                    psi.ArgumentList.Add("-ExecutionPolicy");
                    psi.ArgumentList.Add("Bypass");
                    psi.ArgumentList.Add("-File");
                    psi.ArgumentList.Add(script);
                    using var process = Process.Start(psi);
                    process?.WaitForExit();
                }
                catch (Exception ex)
                {
                    MessageBoxW(IntPtr.Zero, $"Could not start the online installer.\n\n{ex.Message}", "LaserBench", MB_ICONERROR);
                    return 5;
                }

                if (!HasDotNetDesktop8())
                {
                    MessageBoxW(IntPtr.Zero,
                        ".NET 8 Desktop Runtime is still unavailable. Use the offline guide or retry the online installation.",
                        "LaserBench", MB_ICONWARNING);
                    return 6;
                }
            }
            else if (choice == IDNO)
            {
                OpenOfflineGuide(root);
                return 7;
            }
            else
            {
                return 8;
            }
        }

        try
        {
            Process.Start(new ProcessStartInfo(appPath)
            {
                UseShellExecute = true,
                WorkingDirectory = root
            });
            return 0;
        }
        catch (Exception ex)
        {
            MessageBoxW(IntPtr.Zero, $"LaserBench could not start.\n\n{ex.Message}", "LaserBench", MB_ICONERROR);
            return 9;
        }
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
                if (Version.TryParse(name, out var version) && version.Major == 8)
                    return true;
            }
        }
        catch
        {
            return false;
        }

        return false;
    }

    private static void OpenOfflineGuide(string root)
    {
        var guide = Path.Combine(root, "OFFLINE-DEPENDENCIES.txt");
        try
        {
            if (File.Exists(guide))
            {
                Process.Start(new ProcessStartInfo(guide) { UseShellExecute = true });
            }
            else
            {
                Process.Start(new ProcessStartInfo("https://dotnet.microsoft.com/download/dotnet/8.0") { UseShellExecute = true });
            }
        }
        catch
        {
            MessageBoxW(IntPtr.Zero,
                "Install the Microsoft .NET 8 Desktop Runtime for Windows x64, then launch LaserBench again.",
                "LaserBench offline dependency guide", MB_ICONINFORMATION);
        }
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
        var runtime = HasDotNetDesktop8();
        var json = "{\n" +
                   $"  \"ok\": {(appExists && runtime ? "true" : "false")},\n" +
                   $"  \"root\": \"{JsonEscape(root)}\",\n" +
                   $"  \"appExists\": {(appExists ? "true" : "false")},\n" +
                   $"  \"dotnetDesktop8\": {(runtime ? "true" : "false")},\n" +
                   "  \"portable\": true\n" +
                   "}\n";

        var directory = Path.GetDirectoryName(Path.GetFullPath(path));
        if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
        File.WriteAllText(path, json, new UTF8Encoding(false));
    }
}
