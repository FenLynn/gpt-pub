using System.Text;
using System.Text.RegularExpressions;

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
            var detail = BuildSanitizedException(exception);
            File.WriteAllText(path,
                $"{DateTimeOffset.Now:O}{Environment.NewLine}" +
                $"DavBridge {BuildInfoV044.Version} ({BuildInfoV044.ShortCommit}){Environment.NewLine}" +
                "Local diagnostic only. This file is never included in the exported diagnostics ZIP." + Environment.NewLine +
                detail);
            return path;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string BuildSanitizedException(Exception exception)
    {
        var builder = new StringBuilder();
        var current = exception;
        var depth = 0;
        while (current is not null && depth < 6)
        {
            if (depth > 0) builder.AppendLine().AppendLine("Inner exception:");
            builder.AppendLine(current.GetType().FullName ?? current.GetType().Name);
            builder.Append("HResult: 0x").AppendLine(current.HResult.ToString("X8"));
            builder.Append("Message: ").AppendLine(Sanitize(current.Message));
            if (!string.IsNullOrWhiteSpace(current.StackTrace))
            {
                builder.AppendLine("Stack:");
                builder.AppendLine(Sanitize(current.StackTrace));
            }
            current = current.InnerException;
            depth++;
        }
        return builder.ToString();
    }

    private static string Sanitize(string value)
    {
        var result = value;
        foreach (var (path, token) in new[]
        {
            (Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "%USERPROFILE%"),
            (Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "%APPDATA%"),
            (Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "%LOCALAPPDATA%")
        })
        {
            if (!string.IsNullOrWhiteSpace(path))
                result = result.Replace(path, token, StringComparison.OrdinalIgnoreCase);
        }

        result = Regex.Replace(result, @"https?://[^\s\]\)\}\>\"']+", "[URL]", RegexOptions.IgnoreCase);
        return result;
    }
}
