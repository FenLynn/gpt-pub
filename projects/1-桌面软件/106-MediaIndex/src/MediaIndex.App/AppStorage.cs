using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MediaIndex.App;

internal sealed class AppStorage
{
    private string _lastLoadedLibraryPath = string.Empty;

    public AppStorage()
    {
        Root = Path.Combine(
            Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData),
            "FenLynn",
            "MediaIndex");
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(IndexesRoot);
        Directory.CreateDirectory(ResultsRoot);
    }

    public string Root { get; }
    public string SettingsPath =>
        Path.Combine(Root, "settings.json");
    public string BindingsPath =>
        Path.Combine(Root, "storage-bindings.json");
    public string IndexesRoot =>
        Path.Combine(Root, "Indexes");
    public string ResultsRoot =>
        Path.Combine(Root, "Results");

    public AppSettings LoadSettings()
    {
        if (!File.Exists(SettingsPath))
        {
            return new AppSettings();
        }

        try
        {
            var settings =
                JsonSerializer.Deserialize<AppSettings>(
                    File.ReadAllText(
                        SettingsPath,
                        Encoding.UTF8),
                    JsonModel.Options)
                ?? new AppSettings();

            _lastLoadedLibraryPath =
                settings.ImageLibraryPath;

            return settings;
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
        var full = NormalizePath(library);
        var bindings = LoadBindings();
        var key = BindingKey(full);

        if (!Directory.Exists(full))
        {
            if (bindings.TryGetValue(
                    key,
                    out var rememberedId)
                && !string.IsNullOrWhiteSpace(
                    rememberedId))
            {
                return Path.Combine(
                    IndexesRoot,
                    rememberedId);
            }

            return LegacyIndexDirectoryFor(full);
        }

        var binding = StorageIdentity.Resolve(full);
        var target = Path.Combine(
            IndexesRoot,
            binding.IndexId);

        var previousIsSameLibrary =
            IsDriveLetterRebind(
                _lastLoadedLibraryPath,
                full);

        if (!Directory.Exists(target))
        {
            TryMigrateLegacyIndex(
                binding,
                target,
                previousIsSameLibrary
                    ? _lastLoadedLibraryPath
                    : null);
        }

        bindings[key] = binding.IndexId;

        if (previousIsSameLibrary)
        {
            try
            {
                bindings[
                    BindingKey(_lastLoadedLibraryPath)
                ] = binding.IndexId;
            }
            catch
            {
            }
        }

        SaveBindings(bindings);
        _lastLoadedLibraryPath = full;

        return target;
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

    private void TryMigrateLegacyIndex(
        StorageBinding binding,
        string target,
        string? previousLibraryPath)
    {
        var currentLegacy =
            LegacyIndexDirectoryFor(
                binding.LibraryPath);

        if (Directory.Exists(currentLegacy)
            && !PathEquals(
                currentLegacy,
                target))
        {
            Directory.Move(
                currentLegacy,
                target);
            return;
        }

        if (string.IsNullOrWhiteSpace(
                previousLibraryPath))
        {
            return;
        }

        var previousLegacy =
            LegacyIndexDirectoryFor(
                previousLibraryPath);

        if (Directory.Exists(previousLegacy)
            && !PathEquals(
                previousLegacy,
                target))
        {
            Directory.Move(
                previousLegacy,
                target);
        }
    }

    private static bool IsDriveLetterRebind(
        string previous,
        string current)
    {
        if (!OperatingSystem.IsWindows()
            || string.IsNullOrWhiteSpace(previous)
            || string.IsNullOrWhiteSpace(current))
        {
            return false;
        }

        try
        {
            var oldPath = NormalizePath(previous);
            var newPath = NormalizePath(current);

            if (PathEquals(oldPath, newPath))
            {
                return true;
            }

            var oldRoot = Path.GetPathRoot(oldPath);
            var newRoot = Path.GetPathRoot(newPath);

            if (!IsDriveLetterRoot(oldRoot)
                || !IsDriveLetterRoot(newRoot))
            {
                return false;
            }

            var oldRelative = oldPath[oldRoot!.Length..]
                .TrimStart(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar);
            var newRelative = newPath[newRoot!.Length..]
                .TrimStart(
                    Path.DirectorySeparatorChar,
                    Path.AltDirectorySeparatorChar);

            return string.Equals(
                oldRelative,
                newRelative,
                StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static bool IsDriveLetterRoot(
        string? root)
    {
        return !string.IsNullOrWhiteSpace(root)
            && root.Length >= 2
            && root[1] == ':';
    }

    private Dictionary<string, string> LoadBindings()
    {
        if (!File.Exists(BindingsPath))
        {
            return new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
        }

        try
        {
            var value =
                JsonSerializer.Deserialize<
                    Dictionary<string, string>>(
                    File.ReadAllText(
                        BindingsPath,
                        Encoding.UTF8),
                    JsonModel.Options);

            return value is null
                ? new Dictionary<string, string>(
                    StringComparer.OrdinalIgnoreCase)
                : new Dictionary<string, string>(
                    value,
                    StringComparer.OrdinalIgnoreCase);
        }
        catch
        {
            return new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
        }
    }

    private void SaveBindings(
        Dictionary<string, string> bindings)
    {
        var temp =
            BindingsPath
            + ".tmp-"
            + Guid.NewGuid().ToString("N");

        try
        {
            using (var stream = new FileStream(
                       temp,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None))
            {
                JsonSerializer.Serialize(
                    stream,
                    bindings,
                    new JsonSerializerOptions
                    {
                        WriteIndented = true
                    });
                stream.Flush(true);
            }

            File.Move(
                temp,
                BindingsPath,
                true);
        }
        finally
        {
            try
            {
                if (File.Exists(temp))
                {
                    File.Delete(temp);
                }
            }
            catch
            {
            }
        }
    }

    private string LegacyIndexDirectoryFor(
        string library)
    {
        var normalized = NormalizePath(library)
            .ToUpperInvariant();

        var bytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(normalized));

        var id = Convert
            .ToHexString(bytes)
            .ToLowerInvariant()[..16];

        return Path.Combine(
            IndexesRoot,
            id);
    }

    private static string NormalizePath(
        string value)
    {
        return Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(value));
    }

    private static string BindingKey(
        string value)
    {
        return NormalizePath(value)
            .ToUpperInvariant();
    }

    private static bool PathEquals(
        string left,
        string right)
    {
        return string.Equals(
            NormalizePath(left),
            NormalizePath(right),
            StringComparison.OrdinalIgnoreCase);
    }
}
