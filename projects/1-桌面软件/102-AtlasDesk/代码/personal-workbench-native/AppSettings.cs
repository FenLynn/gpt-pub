using System.IO;
using System.Text.Json;

namespace PersonalWorkbench;

public sealed class AppSettings
{
    public string UserName { get; set; } = "Fenlynn";
    public string DashboardName { get; set; } = "Cloudflare Dashboard";
    public string DashboardUrl { get; set; } = string.Empty;
    public string Accent { get; set; } = "blue";
    public string WorkspaceRoot { get; set; } = string.Empty;

    public string ZoteroDbPath { get; set; } = string.Empty;
    public bool ZoteroLoadFullLibrary { get; set; }
    public int ZoteroCalibrationLimit { get; set; } = 250;
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
        value.TerminalFontSize = Math.Clamp(value.TerminalFontSize <= 0 ? 14 : value.TerminalFontSize, 10, 24);
        value.TerminalScrollback = Math.Clamp(value.TerminalScrollback <= 0 ? 8000 : value.TerminalScrollback, 1000, 100000);
        value.TerminalDrawerHeight = Math.Clamp(value.TerminalDrawerHeight <= 0 ? 320 : value.TerminalDrawerHeight, 180, 700);
        value.DefaultShell = string.Equals(value.DefaultShell, "cmd", StringComparison.OrdinalIgnoreCase) ? "cmd" : "powershell";
        return value;
    }

    private static JsonSerializerOptions JsonOptions() => new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}
