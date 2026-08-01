using System.IO;

namespace PersonalWorkbench;

/// <summary>
/// AtlasDesk has one public runtime root and two private data roots.
/// The runtime directory is the folder that contains AtlasDesk.exe and is never
/// used for generated user data. Roaming data stays small and important;
/// machine-local browser state, logs and caches stay under LocalAppData.
/// </summary>
public static class ProductIdentity
{
    public const string ProductName = "AtlasDesk";

    public static string RuntimeDirectory { get; } = Path.GetFullPath(AppContext.BaseDirectory);

    public static string RoamingDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        ProductName);

    public static string LocalDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        ProductName);

    public static string DashboardProfileDirectory { get; } = Path.Combine(LocalDataDirectory, "WebView2");
    public static string TerminalProfileDirectory { get; } = Path.Combine(LocalDataDirectory, "Terminal", "WebView2");
    public static string CacheDirectory { get; } = Path.Combine(LocalDataDirectory, "Cache");
    public static string LogDirectory { get; } = Path.Combine(LocalDataDirectory, "Logs");
    public static string StateDirectory { get; } = Path.Combine(LocalDataDirectory, "State");
    public static string CrashDirectory { get; } = Path.Combine(LocalDataDirectory, "Crash");
    public static string TerminalAssetsDirectory { get; } = Path.Combine(RuntimeDirectory, "Assets", "Terminal");

    public static void EnsureDataDirectories()
    {
        Directory.CreateDirectory(RoamingDataDirectory);
        Directory.CreateDirectory(LocalDataDirectory);
        Directory.CreateDirectory(DashboardProfileDirectory);
        Directory.CreateDirectory(TerminalProfileDirectory);
        Directory.CreateDirectory(CacheDirectory);
        Directory.CreateDirectory(LogDirectory);
        Directory.CreateDirectory(StateDirectory);
        Directory.CreateDirectory(CrashDirectory);
    }
}
