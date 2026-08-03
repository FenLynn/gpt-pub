using System.Text.Json;
using System.Text.Json.Serialization;

namespace PersonalWorkbench;

public enum SettingsLoadSource
{
    Primary,
    Backup,
    Defaults
}

public sealed record SettingsLoadReport(
    SettingsLoadSource Source,
    string Detail,
    string? QuarantinedPath = null)
{
    public bool Recovered => Source == SettingsLoadSource.Backup;
}

public sealed class AppSettings
{
    private const int CurrentSchemaVersion = 2;
    private static readonly object FileGate = new();
    private static SettingsLoadReport _lastLoadReport = new(SettingsLoadSource.Defaults, "尚未读取配置");

    private static readonly string[] DefaultZoteroColumns =
    {
        "type", "title", "authors", "year", "publication", "dateAdded", "pdf"
    };

    private static readonly HashSet<string> AllowedZoteroColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        "type", "title", "authors", "year", "publication", "dateAdded", "dateModified",
        "tags", "notes", "attachments", "pdf"
    };

    public int SettingsSchemaVersion { get; set; } = CurrentSchemaVersion;
    public string UserName { get; set; } = "Fenlynn";
    public string DashboardName { get; set; } = "Cloudflare Dashboard";
    public string DashboardUrl { get; set; } = string.Empty;
    public string Accent { get; set; } = "blue";
    public string WorkspaceRoot { get; set; } = string.Empty;
    public bool WorkspaceAutoSave { get; set; } = true;
    public bool WorkspaceShowHiddenFiles { get; set; }
    public bool WorkspaceWordWrap { get; set; } = true;
    public int WorkspaceEditorFontSize { get; set; } = 14;
    public int WorkspaceRecentLimit { get; set; } = 12;
    public string LastWorkspaceFile { get; set; } = string.Empty;
    public List<string> RecentWorkspaceFiles { get; set; } = new();

    public int ProjectRecentLimit { get; set; } = 12;
    public List<string> PinnedProjectPaths { get; set; } = new();
    public List<string> RecentProjectPaths { get; set; } = new();

    public string ZoteroDbPath { get; set; } = string.Empty;
    public bool ZoteroLoadFullLibrary { get; set; }
    public int ZoteroCalibrationLimit { get; set; } = 250;
    public List<string> ZoteroVisibleColumns { get; set; } = DefaultZoteroColumns.ToList();
    public string PdfReaderPath { get; set; } = string.Empty;
    public bool UseSystemPdfReader { get; set; } = true;

    public string PythonPath { get; set; } = string.Empty;
    public string CondaPath { get; set; } = string.Empty;
    public string UvPath { get; set; } = string.Empty;
    public string SelectedPythonEnvironment { get; set; } = string.Empty;
    public string DefaultShell { get; set; } = "powershell";
    public int TerminalFontSize { get; set; } = 14;
    public int TerminalScrollback { get; set; } = 8000;
    public int TerminalDrawerHeight { get; set; } = 320;
    public string LastTerminalShell { get; set; } = string.Empty;
    public string LastTerminalWorkingDirectory { get; set; } = string.Empty;
    public string LastTerminalTitle { get; set; } = string.Empty;

    public string GitPath { get; set; } = string.Empty;
    public string CodexDir { get; set; } = string.Empty;
    public string GeminiDir { get; set; } = string.Empty;
    public bool SidebarCollapsed { get; set; }
    public bool DashboardAutoOpen { get; set; } = true;

    [JsonIgnore]
    private bool RuntimeDashboardAutoOpenSuppressed { get; set; }

    [JsonIgnore]
    private bool RuntimeDashboardAutoOpenOriginal { get; set; }

    public int EffectiveZoteroLimit => ZoteroLoadFullLibrary
        ? 0
        : Math.Clamp(ZoteroCalibrationLimit <= 0 ? 250 : ZoteroCalibrationLimit, 50, 5000);

    public static string SettingsPath => Path.Combine(App.AppDataDirectory, "settings.json");
    public static string BackupPath => SettingsPath + ".bak";
    public static SettingsLoadReport LastLoadReport => _lastLoadReport;

    public static AppSettings Load()
    {
        lock (FileGate)
        {
            if (TryRead(SettingsPath, out var primary, out var primaryError))
            {
                _lastLoadReport = new SettingsLoadReport(SettingsLoadSource.Primary, "已读取主配置");
                return ApplyRuntimeOverrides(Normalize(primary!));
            }

            string? quarantined = null;
            if (File.Exists(SettingsPath))
            {
                quarantined = AtomicFileStore.Quarantine(SettingsPath, "corrupt");
                App.Log("Settings primary load failed: " + primaryError);
            }

            if (TryRead(BackupPath, out var backup, out var backupError))
            {
                var recovered = Normalize(backup!);
                try
                {
                    AtomicFileStore.WriteAllText(SettingsPath, SerializePersistent(recovered));
                }
                catch (Exception ex)
                {
                    App.Log("Settings primary reconstruction failed: " + ex);
                }

                _lastLoadReport = new SettingsLoadReport(
                    SettingsLoadSource.Backup,
                    "主配置不可用，已从最近有效备份恢复",
                    quarantined);
                return ApplyRuntimeOverrides(recovered);
            }

            if (File.Exists(BackupPath))
            {
                var backupQuarantine = AtomicFileStore.Quarantine(BackupPath, "corrupt-backup");
                quarantined ??= backupQuarantine;
                App.Log("Settings backup load failed: " + backupError);
            }

            _lastLoadReport = new SettingsLoadReport(
                SettingsLoadSource.Defaults,
                File.Exists(SettingsPath) || File.Exists(BackupPath)
                    ? "主配置和备份均不可用，已使用安全默认值"
                    : "首次启动，使用默认配置",
                quarantined);
            return ApplyRuntimeOverrides(Normalize(new AppSettings()));
        }
    }

    public void Save()
    {
        lock (FileGate)
        {
            Normalize(this);
            SettingsSchemaVersion = CurrentSchemaVersion;
            AtomicFileStore.WriteAllText(SettingsPath, SerializePersistent(this), BackupPath);
            _lastLoadReport = new SettingsLoadReport(SettingsLoadSource.Primary, "配置已原子保存并保留最近有效备份");
        }
    }

    private static bool TryRead(string path, out AppSettings? value, out string error)
    {
        value = null;
        error = string.Empty;
        try
        {
            if (!File.Exists(path))
            {
                error = "文件不存在";
                return false;
            }

            var json = File.ReadAllText(path);
            value = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions());
            if (value is null)
            {
                error = "反序列化结果为空";
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            error = ex.GetType().Name + ": " + ex.Message;
            return false;
        }
    }

    private static AppSettings ApplyRuntimeOverrides(AppSettings value)
    {
        if (!App.IsSafeMode) return value;
        value.RuntimeDashboardAutoOpenOriginal = value.DashboardAutoOpen;
        value.RuntimeDashboardAutoOpenSuppressed = true;
        value.DashboardAutoOpen = false;
        return value;
    }

    private static string SerializePersistent(AppSettings value)
    {
        var current = value.DashboardAutoOpen;
        try
        {
            if (value.RuntimeDashboardAutoOpenSuppressed)
                value.DashboardAutoOpen = value.RuntimeDashboardAutoOpenOriginal;
            return JsonSerializer.Serialize(value, JsonOptions());
        }
        finally
        {
            value.DashboardAutoOpen = current;
        }
    }

    private static AppSettings Normalize(AppSettings value)
    {
        value.SettingsSchemaVersion = CurrentSchemaVersion;
        value.ZoteroCalibrationLimit = Math.Clamp(value.ZoteroCalibrationLimit <= 0 ? 250 : value.ZoteroCalibrationLimit, 50, 5000);
        value.WorkspaceEditorFontSize = Math.Clamp(value.WorkspaceEditorFontSize <= 0 ? 14 : value.WorkspaceEditorFontSize, 11, 24);
        value.WorkspaceRecentLimit = Math.Clamp(value.WorkspaceRecentLimit <= 0 ? 12 : value.WorkspaceRecentLimit, 4, 50);
        value.RecentWorkspaceFiles ??= new List<string>();
        value.RecentWorkspaceFiles = NormalizePaths(value.RecentWorkspaceFiles, value.WorkspaceRecentLimit);

        value.ProjectRecentLimit = Math.Clamp(value.ProjectRecentLimit <= 0 ? 12 : value.ProjectRecentLimit, 4, 40);
        value.PinnedProjectPaths ??= new List<string>();
        value.RecentProjectPaths ??= new List<string>();
        value.PinnedProjectPaths = NormalizePaths(value.PinnedProjectPaths, 100);
        value.RecentProjectPaths = NormalizePaths(value.RecentProjectPaths, value.ProjectRecentLimit);

        value.ZoteroVisibleColumns ??= DefaultZoteroColumns.ToList();
        value.ZoteroVisibleColumns = value.ZoteroVisibleColumns
            .Where(column => !string.IsNullOrWhiteSpace(column) && AllowedZoteroColumns.Contains(column))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (!value.ZoteroVisibleColumns.Contains("title", StringComparer.OrdinalIgnoreCase))
            value.ZoteroVisibleColumns.Insert(0, "title");
        if (value.ZoteroVisibleColumns.Count == 0)
            value.ZoteroVisibleColumns = DefaultZoteroColumns.ToList();

        value.TerminalFontSize = Math.Clamp(value.TerminalFontSize <= 0 ? 14 : value.TerminalFontSize, 10, 24);
        value.TerminalScrollback = Math.Clamp(value.TerminalScrollback <= 0 ? 8000 : value.TerminalScrollback, 1000, 100000);
        value.TerminalDrawerHeight = Math.Clamp(value.TerminalDrawerHeight <= 0 ? 320 : value.TerminalDrawerHeight, 180, 700);
        value.DefaultShell = string.Equals(value.DefaultShell, "cmd", StringComparison.OrdinalIgnoreCase) ? "cmd" : "powershell";
        value.LastTerminalShell = string.Equals(value.LastTerminalShell, "cmd", StringComparison.OrdinalIgnoreCase)
            ? "cmd"
            : string.IsNullOrWhiteSpace(value.LastTerminalShell) ? string.Empty : "powershell";
        if (!Directory.Exists(value.LastTerminalWorkingDirectory))
            value.LastTerminalWorkingDirectory = string.Empty;
        value.LastTerminalTitle = (value.LastTerminalTitle ?? string.Empty).Trim();
        return value;
    }

    private static List<string> NormalizePaths(IEnumerable<string> paths, int limit)
    {
        var result = new List<string>();
        foreach (var path in paths)
        {
            if (string.IsNullOrWhiteSpace(path))
                continue;
            try
            {
                var full = Path.GetFullPath(path.Trim());
                if (!result.Contains(full, StringComparer.OrdinalIgnoreCase))
                    result.Add(full);
            }
            catch { }
            if (result.Count >= limit)
                break;
        }
        return result;
    }

    private static JsonSerializerOptions JsonOptions() => new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}
