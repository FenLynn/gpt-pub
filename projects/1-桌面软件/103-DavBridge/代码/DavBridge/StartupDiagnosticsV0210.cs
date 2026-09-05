namespace DavBridge;

internal static class StartupDiagnosticsV0210
{
    public static string TryWrite(Exception exception)
    {
        try
        {
            var paths = AppPaths.Create();
            Directory.CreateDirectory(paths.LocalRoot);
            var path = Path.Combine(paths.LocalRoot, "startup-error.log");
            File.WriteAllText(path,
                $"{DateTimeOffset.Now:O}{Environment.NewLine}" +
                $"DavBridge {typeof(StartupDiagnosticsV0210).Assembly.GetName().Version}{Environment.NewLine}" +
                exception);
            return path;
        }
        catch
        {
            return string.Empty;
        }
    }
}
