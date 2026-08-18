namespace LocalSub.Core;

public static class PortablePaths
{
    public static string BaseDir => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    public static string ConfigFile => Path.Combine(BaseDir, "config.json");
    public static string AssetsDir => Path.Combine(BaseDir, "Assets");
    public static string LogsDir => Path.Combine(BaseDir, "Logs");
    public static string DataDir => Path.Combine(BaseDir, "Data");

    public static void EnsureBaseFolders()
    {
        Directory.CreateDirectory(LogsDir);
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(Path.Combine(BaseDir, "ASR"));
    }

    public static string ResolvePortablePath(string configured)
    {
        if (string.IsNullOrWhiteSpace(configured)) configured = "ASR";
        return Path.GetFullPath(Path.IsPathRooted(configured) ? configured : Path.Combine(BaseDir, configured));
    }
}
