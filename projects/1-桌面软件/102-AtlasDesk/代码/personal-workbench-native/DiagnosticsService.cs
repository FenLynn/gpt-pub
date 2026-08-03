using Microsoft.Web.WebView2.Core;
using System.IO.Compression;
using System.Net;
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
                    || key.Equals("recentProjectPaths", StringComparison.OrdinalIgnoreCase)
                    || key.Equals("pinnedProjectPaths", StringComparison.OrdinalIgnoreCase)
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
    public static async Task<IReadOnlyList<DiagnosticCheck>> RunAsync(
        AppSettings settings,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var checks = await Task.Run(() => Run(settings), cancellationToken);
        cancellationToken.ThrowIfCancellationRequested();
        checks.Add(await CheckDashboardReachabilityAsync(settings.DashboardUrl, cancellationToken));
        return checks;
    }

    public static List<DiagnosticCheck> Run(AppSettings settings)
    {
        var checks = new List<DiagnosticCheck>
        {
            CheckRuntimeBoundary(),
            CheckRoamingData(),
            CheckLocalData(),
            new()
            {
                Name = "应用版本",
                Severity = DiagnosticSeverity.Ok,
                Detail = $"AtlasDesk {WorkbenchVersion.Current} · .NET {Environment.Version} · {Environment.OSVersion.VersionString}"
            },
            CheckSettingsState(),
            CheckStartupState(),
            CheckSafeMode(),
            CheckWebView2(),
            CheckPath("工作区", settings.WorkspaceRoot, Directory.Exists(settings.WorkspaceRoot), "尚未配置默认工作目录"),
            CheckZotero(settings.ZoteroDbPath),
            CheckDashboardConfiguration(settings.DashboardUrl),
            CheckTerminalHost(),
            CheckExecutable("CMD", null, "cmd.exe", "cmd"),
            CheckExecutable("PowerShell", null, "powershell.exe", "pwsh.exe", "powershell", "pwsh"),
            CheckExecutable("Git", settings.GitPath, "git.exe", "git"),
            CheckConfiguredExecutable("Conda", settings.CondaPath, "conda.exe", "conda.bat", "conda"),
            CheckConfiguredExecutable("uv", settings.UvPath, "uv.exe", "uv"),
            CheckLog()
        };
        return checks;
    }

    public static async Task ExportSupportBundleAsync(
        AppSettings settings,
        string destination,
        CancellationToken cancellationToken = default)
    {
        var checks = await RunAsync(settings, cancellationToken);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? App.AppDataDirectory);
        await using var stream = new FileStream(destination, FileMode.Create, FileAccess.ReadWrite, FileShare.None);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false);
        WriteText(archive, "diagnostics.txt", BuildSummary(checks));
        WriteText(archive, "environment.txt", BuildEnvironmentSummary());
        WriteText(archive, "settings-load.txt", BuildSettingsLoadSummary());
        if (File.Exists(AppSettings.SettingsPath))
            WriteText(archive, "settings.sanitized.json", SupportBundleSanitizer.SanitizeSettingsJson(await File.ReadAllTextAsync(AppSettings.SettingsPath, cancellationToken)));
        if (File.Exists(StartupGuard.StatePath))
            WriteText(archive, "startup-state.json", await File.ReadAllTextAsync(StartupGuard.StatePath, cancellationToken));
        if (File.Exists(App.LogPath))
            WriteText(archive, "logs/atlasdesk.tail.log", await ReadTailAsync(App.LogPath, 2 * 1024 * 1024, cancellationToken));
    }

    public static string BuildSummary(IEnumerable<DiagnosticCheck> checks)
    {
        var builder = new StringBuilder();
        builder.AppendLine($"AtlasDesk {WorkbenchVersion.Current} diagnostics");
        builder.AppendLine($"Generated: {DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}");
        builder.AppendLine();
        foreach (var check in checks) builder.AppendLine($"[{check.Status}] {check.Name}: {check.Detail}");
        return builder.ToString();
    }

    private static DiagnosticCheck CheckRuntimeBoundary()
    {
        try
        {
            var executable = Path.Combine(App.RuntimeDirectory, "AtlasDesk.exe");
            var forbidden = new[] { "settings.json", "security.json", "vault.bin", "atlasdesk.log" }
                .Where(name => File.Exists(Path.Combine(App.RuntimeDirectory, name)))
                .ToArray();
            if (forbidden.Length > 0)
                return new DiagnosticCheck { Name = "Runtime 边界", Severity = DiagnosticSeverity.Error, Detail = "程序目录出现私人数据文件：" + string.Join("、", forbidden) };
            return new DiagnosticCheck
            {
                Name = "Runtime 边界",
                Severity = File.Exists(executable) ? DiagnosticSeverity.Ok : DiagnosticSeverity.Warning,
                Detail = File.Exists(executable) ? "程序目录与私人 Data 分离" : "当前可能从开发构建目录运行"
            };
        }
        catch (Exception ex) { return new DiagnosticCheck { Name = "Runtime 边界", Severity = DiagnosticSeverity.Warning, Detail = ex.Message }; }
    }

    private static DiagnosticCheck CheckRoamingData()
        => CheckWritableDirectory("轻量配置目录", App.AppDataDirectory);

    private static DiagnosticCheck CheckLocalData()
        => CheckWritableDirectory("本机数据目录", App.LocalDataDirectory);

    private static DiagnosticCheck CheckWritableDirectory(string name, string directory)
    {
        try
        {
            if (!Directory.Exists(directory))
                return new DiagnosticCheck { Name = name, Severity = DiagnosticSeverity.Warning, Detail = "目录尚未建立" };
            var probe = Path.Combine(directory, ".write-test-" + Guid.NewGuid().ToString("N"));
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            return new DiagnosticCheck { Name = name, Severity = DiagnosticSeverity.Ok, Detail = "可读写" };
        }
        catch (Exception ex) { return new DiagnosticCheck { Name = name, Severity = DiagnosticSeverity.Error, Detail = ex.Message }; }
    }

    private static DiagnosticCheck CheckSettingsState()
    {
        var report = AppSettings.LastLoadReport;
        var primary = File.Exists(AppSettings.SettingsPath);
        var backup = File.Exists(AppSettings.BackupPath);
        var suffix = $" · 主配置{(primary ? "存在" : "缺失")} · 备份{(backup ? "存在" : "缺失")}";
        return new DiagnosticCheck
        {
            Name = "配置保护",
            Severity = report.Source switch
            {
                SettingsLoadSource.Primary => backup ? DiagnosticSeverity.Ok : DiagnosticSeverity.Warning,
                SettingsLoadSource.Backup => DiagnosticSeverity.Warning,
                _ => primary || backup ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning
            },
            Detail = report.Detail + suffix
        };
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

    private static DiagnosticCheck CheckSafeMode() => new()
    {
        Name = "安全启动",
        Severity = App.IsSafeMode ? DiagnosticSeverity.Warning : DiagnosticSeverity.Ok,
        Detail = App.IsSafeMode
            ? "已抑制 Dashboard 自动打开；原设置未被改写"
            : "未触发安全启动"
    };

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

    private static DiagnosticCheck CheckZotero(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return new DiagnosticCheck { Name = "Zotero 数据库", Severity = DiagnosticSeverity.Warning, Detail = "尚未连接 zotero.sqlite" };
        if (!File.Exists(path))
            return new DiagnosticCheck { Name = "Zotero 数据库", Severity = DiagnosticSeverity.Warning, Detail = "路径不存在 · " + path };
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            return new DiagnosticCheck
            {
                Name = "Zotero 数据库",
                Severity = DiagnosticSeverity.Ok,
                Detail = $"只读可访问 · {stream.Length / 1024d / 1024d:0.0} MB"
            };
        }
        catch (Exception ex)
        {
            return new DiagnosticCheck { Name = "Zotero 数据库", Severity = DiagnosticSeverity.Warning, Detail = "当前不可只读访问 · " + ex.Message };
        }
    }

    private static DiagnosticCheck CheckDashboardConfiguration(string value)
    {
        var valid = TryGetHttpUri(value, out var uri);
        return new DiagnosticCheck
        {
            Name = "Dashboard 地址",
            Severity = valid ? DiagnosticSeverity.Ok : DiagnosticSeverity.Warning,
            Detail = valid ? uri!.GetLeftPart(UriPartial.Authority) : "尚未配置有效的 HTTP/HTTPS 地址"
        };
    }

    private static async Task<DiagnosticCheck> CheckDashboardReachabilityAsync(string value, CancellationToken cancellationToken)
    {
        if (!TryGetHttpUri(value, out var uri))
            return new DiagnosticCheck { Name = "Dashboard 连接", Severity = DiagnosticSeverity.Warning, Detail = "未执行：地址无效或未配置" };

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        linked.CancelAfter(TimeSpan.FromSeconds(4));
        try
        {
            using var handler = new HttpClientHandler { AllowAutoRedirect = false };
            using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
            using var request = new HttpRequestMessage(HttpMethod.Head, uri);
            request.Headers.UserAgent.ParseAdd("AtlasDesk-Diagnostics/" + WorkbenchVersion.Current);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, linked.Token);
            return new DiagnosticCheck
            {
                Name = "Dashboard 连接",
                Severity = (int)response.StatusCode >= 500 ? DiagnosticSeverity.Warning : DiagnosticSeverity.Ok,
                Detail = $"服务器可达 · HTTP {(int)response.StatusCode} {response.StatusCode}"
            };
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new DiagnosticCheck { Name = "Dashboard 连接", Severity = DiagnosticSeverity.Warning, Detail = "4 秒内未收到响应" };
        }
        catch (HttpRequestException ex)
        {
            return new DiagnosticCheck { Name = "Dashboard 连接", Severity = DiagnosticSeverity.Warning, Detail = "连接失败 · " + ex.Message };
        }
    }

    private static bool TryGetHttpUri(string value, out Uri? uri)
    {
        var valid = Uri.TryCreate(value, UriKind.Absolute, out uri)
                    && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
        if (!valid) uri = null;
        return valid;
    }

    private static DiagnosticCheck CheckTerminalHost()
    {
        var configured = Environment.GetEnvironmentVariable("PWB_TERMINAL_HOST_PATH");
        var path = string.IsNullOrWhiteSpace(configured)
            ? Path.Combine(App.RuntimeDirectory, "AtlasDesk.TerminalHost.exe")
            : configured;
        return new DiagnosticCheck
        {
            Name = "原生终端宿主",
            Severity = File.Exists(path) ? DiagnosticSeverity.Ok : DiagnosticSeverity.Error,
            Detail = File.Exists(path) ? "文件存在 · ConPTY 桥接可启动" : "缺少 AtlasDesk.TerminalHost.exe"
        };
    }

    private static DiagnosticCheck CheckExecutable(string name, string? configured, params string[] candidates)
    {
        var path = ExecutableLocator.Resolve(configured, candidates);
        return new DiagnosticCheck
        {
            Name = name,
            Severity = path is null ? DiagnosticSeverity.Warning : DiagnosticSeverity.Ok,
            Detail = path ?? "未在保存路径或 PATH 中找到"
        };
    }

    private static DiagnosticCheck CheckConfiguredExecutable(string name, string configured, params string[] candidates)
    {
        if (string.IsNullOrWhiteSpace(configured))
            return new DiagnosticCheck { Name = name, Severity = DiagnosticSeverity.Warning, Detail = "尚未配置；未自动扫描磁盘" };
        return CheckExecutable(name, configured, candidates);
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

    private static string BuildSettingsLoadSummary()
    {
        var report = AppSettings.LastLoadReport;
        return string.Join(Environment.NewLine, new[]
        {
            "Source=" + report.Source,
            "Recovered=" + report.Recovered,
            "Detail=" + report.Detail,
            "Quarantined=" + (string.IsNullOrWhiteSpace(report.QuarantinedPath) ? "false" : "true")
        });
    }

    private static string BuildEnvironmentSummary() => string.Join(Environment.NewLine, new[]
    {
        "Version=" + WorkbenchVersion.Current,
        "SafeMode=" + App.IsSafeMode,
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

    private static async Task<string> ReadTailAsync(
        string path,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        if (stream.Length > maxBytes) stream.Seek(-maxBytes, SeekOrigin.End);
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return await reader.ReadToEndAsync(cancellationToken);
    }
}
