using System.IO;
using System.Text.Json;

namespace PersonalWorkbench;

public sealed class AppSettings
{
    private static readonly string[] DefaultZoteroColumns =
    {
        "type", "title", "authors", "year", "publication", "dateAdded", "pdf"
    };

    private static readonly HashSet<string> AllowedZoteroColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        "type", "title", "authors", "year", "publication", "dateAdded", "dateModified",
        "tags", "notes", "attachments", "pdf"
    };

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

    public int EffectiveZoteroLimit => ZoteroLoadFullLibrary
        ? 0
        : Math.Clamp(ZoteroCalibrationLimit <= 0 ? 250 : ZoteroCalibrationLimit, 50, 5000);

    public static string SettingsPath => Path.Combine(App.AppDataDirectory, "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (!File.Exists(SettingsPath))
                return Normalize(new AppSettings());

            var json = File.ReadAllText(SettingsPath);
            return Normalize(JsonSerializer.Deserialize<AppSettings>(json, JsonOptions()) ?? new AppSettings());
        }
        catch (Exception ex)
        {
            App.Log("Settings load failed: " + ex);
            return Normalize(new AppSettings());
        }
    }

    public void Save()
    {
        Normalize(this);
        Directory.CreateDirectory(App.AppDataDirectory);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(this, JsonOptions()));
    }

    private static AppSettings Normalize(AppSettings value)
    {
        value.ZoteroCalibrationLimit = Math.Clamp(value.ZoteroCalibrationLimit <= 0 ? 250 : value.ZoteroCalibrationLimit, 50, 5000);
        value.WorkspaceEditorFontSize = Math.Clamp(value.WorkspaceEditorFontSize <= 0 ? 14 : value.WorkspaceEditorFontSize, 11, 24);
        value.WorkspaceRecentLimit = Math.Clamp(value.WorkspaceRecentLimit <= 0 ? 12 : value.WorkspaceRecentLimit, 4, 50);
        value.RecentWorkspaceFiles ??= new List<string>();
        value.RecentWorkspaceFiles = value.RecentWorkspaceFiles
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(value.WorkspaceRecentLimit)
            .ToList();

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

    private static JsonSerializerOptions JsonOptions() => new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}
