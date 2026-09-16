using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MediaIndex.App;

internal sealed class AppStorage
{
    public AppStorage()
    {
        Root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FenLynn",
            "MediaIndex");
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(IndexesRoot);
        Directory.CreateDirectory(ResultsRoot);
    }

    public string Root { get; }
    public string SettingsPath => Path.Combine(Root, "settings.json");
    public string IndexesRoot => Path.Combine(Root, "Indexes");
    public string ResultsRoot => Path.Combine(Root, "Results");

    public AppSettings LoadSettings()
    {
        if (!File.Exists(SettingsPath))
        {
            return new AppSettings();
        }

        try
        {
            return JsonSerializer.Deserialize<AppSettings>(
                File.ReadAllText(SettingsPath, Encoding.UTF8),
                JsonModel.Options) ?? new AppSettings();
        }
        catch
        {
            return new AppSettings();
        }
    }

    public void SaveSettings(AppSettings settings)
    {
        File.WriteAllText(
            SettingsPath,
            JsonSerializer.Serialize(
                settings,
                new JsonSerializerOptions
                {
                    WriteIndented = true
                }),
            new UTF8Encoding(false));
    }

    public string IndexDirectoryFor(string library)
    {
        var normalized = Path.GetFullPath(library)
            .TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar)
            .ToUpperInvariant();

        var bytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(normalized));

        var id = Convert
            .ToHexString(bytes)
            .ToLowerInvariant()[..16];

        return Path.Combine(IndexesRoot, id);
    }

    public string NewResultPath(string prefix)
    {
        return Path.Combine(
            ResultsRoot,
            $"{prefix}-{DateTime.Now:yyyyMMdd-HHmmssfff}.json");
    }

    public string NewValidationDirectory()
    {
        return Path.Combine(
            ResultsRoot,
            $"Validation-{DateTime.Now:yyyyMMdd-HHmmss}");
    }
}
