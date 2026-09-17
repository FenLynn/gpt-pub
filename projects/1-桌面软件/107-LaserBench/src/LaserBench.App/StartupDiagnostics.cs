using System.Text;

namespace LaserBench;

internal static class StartupDiagnostics
{
    private static readonly object Sync = new();

    public static string StartupLogPath => Path.Combine(AppPaths.LogsDir, "startup.log");
    public static string CrashLogPath => Path.Combine(AppPaths.LogsDir, "crash.log");

    public static void Initialize()
    {
        Directory.CreateDirectory(AppPaths.LogsDir);
        Write("BOOT", $"LaserBench {Application.ProductVersion}");
        Write("BOOT", $"OS={Environment.OSVersion}; 64bit={Environment.Is64BitProcess}");
        Write("BOOT", $"Runtime={Environment.Version}; Base={AppContext.BaseDirectory}");
    }

    public static void Stage(string name, string detail = "OK") => Write("STAGE", $"{name}: {detail}");

    public static void Crash(string context, Exception exception)
    {
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(AppPaths.LogsDir);
                File.AppendAllText(
                    CrashLogPath,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] {context}{Environment.NewLine}{exception}{Environment.NewLine}{Environment.NewLine}",
                    new UTF8Encoding(false));
            }
        }
        catch
        {
        }
    }

    private static void Write(string category, string text)
    {
        try
        {
            lock (Sync)
            {
                Directory.CreateDirectory(AppPaths.LogsDir);
                File.AppendAllText(
                    StartupLogPath,
                    $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] [{category}] {text}{Environment.NewLine}",
                    new UTF8Encoding(false));
            }
        }
        catch
        {
        }
    }
}
