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
    public string PythonPath { get; set; } = string.Empty;
    public string CondaPath { get; set; } = string.Empty;
    public string UvPath { get; set; } = string.Empty;
    public string SelectedPythonEnvironment { get; set; } = string.Empty;
    public string GitPath { get; set; } = string.Empty;
    public string CodexDir { get; set; } = string.Empty;
    public string GeminiDir { get; set; } = string.Empty;
    public bool SidebarCollapsed { get; set; }
    public bool DashboardAutoOpen { get; set; } = true;

    public static string SettingsPath => Path.Combine(App.AppDataDirectory, "settings.json");

    public static AppSettings Load()
    {
        try
        {
            if (!File.Exists(SettingsPath))
                return new AppSettings();

            var json = File.ReadAllText(SettingsPath);
            return JsonSerializer.Deserialize<AppSettings>(json, JsonOptions()) ?? new AppSettings();
        }
        catch (Exception ex)
        {
            App.Log("Settings load failed: " + ex);
            return new AppSettings();
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(App.AppDataDirectory);
        File.WriteAllText(SettingsPath, JsonSerializer.Serialize(this, JsonOptions()));
    }

    private static JsonSerializerOptions JsonOptions() => new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };
}
