using Microsoft.Web.WebView2.Core;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PersonalWorkbench;

public enum DiagnosticSeverity { Ok, Warning, Error }

public sealed class DiagnosticCheck
{
    public string Name { get; init; } = string.Empty;
    public string Detail { get; init; } = string.Empty;
    public DiagnosticSeverity Severity { get; init; }
    public string Status => Severity switch { DiagnosticSeverity.Ok => "正常", DiagnosticSeverity.Warning => "注意", _ => "异常" };
    public string BadgeBackground => Severity switch { DiagnosticSeverity.Ok => "#E7F7F0", DiagnosticSeverity.Warning => "#FFF4DF", _ => "#FDEAEA" };
    public string BadgeForeground => Severity switch { DiagnosticSeverity.Ok => "#187A58", DiagnosticSeverity.Warning => "#A86812", _ => "#B13D48" };
}

public static class SupportBundleSanitizer
{
    public static string SanitizeSettingsJson(string json)
    {
        try
        {
            var root = JsonNode.Parse(json) as JsonObject;
            if (root is null) return "{}";
            foreach (var key in root.Select(item => item.Key).ToArray())
            {
                if (key.Equals("dashboardUrl", StringComparison.OrdinalIgnoreCase))
                {
                    var raw = root[key]?.GetValue<string>();
                    root[key] = Uri.TryCreate(raw, UriKind.Absolute, out var uri)
                        ? uri.GetLeftPart(UriPartial.Authority)
                        : string.Empty;
                    continue;
                }
                if (key.Equals("userName", StringComparison.OrdinalIgnoreCase))
                {
                    root[key] = "<redacted>";
                    continue;
                }
                if (key.Contains("path", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("root", StringComparison.OrdinalIgnoreCase)
                    || key.Contains("dir", StringComparison.OrdinalIgnoreCase)
                    || key.Equals("recentWorkspaceFiles", StringComparison.OrdinalIgnoreCase)
                    || key.Equals("lastWorkspaceFile", StringComparison.OrdinalIgnoreCase)
                    || key.Equals("selectedPythonEnvironment", StringComparison.OrdinalIgnoreCase))
                {
                    root[key] = root[key] is JsonArray array
                        ? new JsonArray(array.Select(_ => JsonValue.Create("<redacted-path>")).ToArray())
                        : JsonValue.Create("<redacted-path>");
                }
            }
            return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true });
        }
        catch { return "{}"; }
    }
}

public static class DiagnosticsService
{
    public static async Task<IReadOnlyList<DiagnosticCheck>> RunAsync(AppSettings settings)
        => await Task.Run(() => Run(settings));

    public static IReadOnlyList<DiagnosticCheck> Run(AppSettings settings)
    {
        var checks = new List<DiagnosticCheck>();
        checks.Add(CheckAppData());
        checks.Add(new DiagnosticCheck
        {
            Name = "应用版本",
            Severity = DiagnosticSeverity.Ok,
            Detail = $"Personal Workbench {WorkbenchVersion.Current} · .NET {Environment.Version} · {Environment.OSVersion.VersionString}"
        });
        checks.Add(CheckStartupState());
        checks.Add(CheckWebView2());
        checks.Add(CheckPath("工作区", settings.WorkspaceRoot, Directory.Exists(settings.WorkspaceRoot), "尚未配置默认工作目录"));
        checks.Add(CheckPath("Zotero 数据库", settings.ZoteroDbPath, File.Exists(settings.ZoteroDbPath), "尚未连接 zotero.sqlite"));
        checks.Add(CheckDashboard(settings.DashboardUrl));
        checks.Add(new DiagnosticCheck
        {
            Name = "内置终端",
            Severity = OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763) ? DiagnosticSeverity.Ok : DiagnosticSeverity.Error,
            Detail = OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763) ? "Windows ConPTY 可用" : "需要 Windows 10 1809 或更高版本"
        });
        checks.Add(CheckLog());
        return checks;
    }

    public static async Task ExportSupportBundleAsync(AppSettings settings, string destination)
    {
        var checks = await RunAsync(settings);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? App.AppDataDirectory);
        await using var stream = new FileStream(destination, FileMode.Create, FileAccess.ReadWrite, FileShare.None);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false);
        WriteText(archive, "diagnostics.txt", BuildSummary(checks));
        WriteText(archive, "environment.txt", BuildEnvironmentSummary());
        if (File.Exists(AppSettings.SettingsPath))
            WriteText(archive, "settings.sanitized.json", SupportBundleSanitizer.SanitizeSettingsJson(await File.ReadAllTextAsync(AppSettings.SettingsPath)));
        if (File.Exists(StartupGuard.StatePath))
            WriteText(archive, "startup-state.json", await File.ReadAllTextAsync(StartupGuard.StatePath));
        if (File.Exists(App.LogPath))
            WriteText(archive, "logs/workbench-native.tail.log", await ReadTailAsync(App.LogPath, 2 * 1024 * 1024));
    }

    public static string BuildSummary(IEnumerable<DiagnosticCheck> checks)
    {
        var builder = new StringBuilder();
        builder.AppendLine($"Personal Workbench {WorkbenchVersion.Current} diagnostics");
        builder.AppendLine($"Generated: {DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}");
        builder.AppendLine();
        foreach (var check in checks) builder.AppendLine($"[{check.Status}] {check.Name}: {check.Detail}");
        return builder.ToString();
    }

    private static DiagnosticCheck CheckAppData()
    {
        try
        {
            Directory.CreateDirectory(App.AppDataDirectory);
            var probe = Path.Combine(App.AppDataDirectory, ".write-test-" + Guid.NewGuid().ToString("N"));
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            return new DiagnosticCheck { Name = "配置目录", Severity = DiagnosticSeverity.Ok, Detail = "可读写 · " + App.AppDataDirectory };
        }
        catch (Exception ex) { return new DiagnosticCheck { Name = "配置目录", Severity = DiagnosticSeverity.Error, Detail = ex.Message }; }
    }

    private static DiagnosticCheck CheckStartupState()
    {
        if (!StartupGuard.PreviousSessionUnclean)
            return new DiagnosticCheck { Name = "上次退出", Severity = DiagnosticSeverity.Ok, Detail = "检测到正常退出标记" };
        return new DiagnosticCheck
        {
            Name = "上次退出",
            Severity = StartupGuard.Current.ConsecutiveUncleanStarts >= 2 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            Detail = $"上一次运行未写入正常退出标记 · 连续 {StartupGuard.Current.ConsecutiveUncleanStarts} 次"
        };
    }

    private static DiagnosticCheck CheckWebView2()
    {
        try
        {
            var version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            return new DiagnosticCheck { Name = "WebView2 Runtime", Severity = DiagnosticSeverity.Ok, Detail = version };
        }
        catch (Exception ex) { return new DiagnosticCheck { Name = "WebView2 Runtime", Severity = DiagnosticSeverity.Error, Detail = ex.Message }; }
    }

    private static DiagnosticCheck CheckPath(string name, string path, bool exists, string emptyDetail)
        => new()
        {
            Name = name,
            Severity = exists ? DiagnosticSeverity.Ok : DiagnosticSeverity.Warning,
            Detail = exists ? path : string.IsNullOrWhiteSpace(path) ? emptyDetail : "路径不存在 · " + path
        };

    private static DiagnosticCheck CheckDashboard(string value)
    {
        var valid = Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
        return new DiagnosticCheck
        {
            Name = "Dashboard 地址",
            Severity = valid ? DiagnosticSeverity.Ok : DiagnosticSeverity.Warning,
            Detail = valid ? uri!.GetLeftPart(UriPartial.Authority) : "尚未配置有效的 HTTP/HTTPS 地址"
        };
    }

    private static DiagnosticCheck CheckLog()
    {
        try
        {
            if (!File.Exists(App.LogPath)) return new DiagnosticCheck { Name = "运行日志", Severity = DiagnosticSeverity.Warning, Detail = "日志文件尚未生成" };
            var info = new FileInfo(App.LogPath);
            return new DiagnosticCheck { Name = "运行日志", Severity = DiagnosticSeverity.Ok, Detail = $"{info.Length / 1024d:0.0} KB · {info.LastWriteTime:yyyy-MM-dd HH:mm:ss}" };
        }
        catch (Exception ex) { return new DiagnosticCheck { Name = "运行日志", Severity = DiagnosticSeverity.Warning, Detail = ex.Message }; }
    }

    private static string BuildEnvironmentSummary() => string.Join(Environment.NewLine, new[]
    {
        "Version=" + WorkbenchVersion.Current,
        "OS=" + Environment.OSVersion.VersionString,
        "Architecture=" + System.Runtime.InteropServices.RuntimeInformation.OSArchitecture,
        "ProcessArchitecture=" + System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture,
        "DotNet=" + Environment.Version,
        "MachineName=<redacted>",
        "UserName=<redacted>"
    });

    private static void WriteText(ZipArchive archive, string name, string content)
    {
        var entry = archive.CreateEntry(name, CompressionLevel.Optimal);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }

    private static async Task<string> ReadTailAsync(string path, int maxBytes)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        if (stream.Length > maxBytes) stream.Seek(-maxBytes, SeekOrigin.End);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return await reader.ReadToEndAsync();
    }
}
