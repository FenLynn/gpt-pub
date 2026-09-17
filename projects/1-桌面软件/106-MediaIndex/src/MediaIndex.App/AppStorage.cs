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

        if (!Directory.Exists(target))
        {
            var legacyCurrent =
                LegacyIndexDirectoryFor(full);

            if (Directory.Exists(legacyCurrent)
                && !PathEquals(
                    legacyCurrent,
                    target))
            {
                Directory.Move(
                    legacyCurrent,
                    target);
            }
            else
            {
                TryMigrateRememberedBinding(
                    binding,
                    target,
                    bindings);
            }
        }

        bindings[key] = binding.IndexId;
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

    private void TryMigrateRememberedBinding(
        StorageBinding binding,
        string target,
        Dictionary<string, string> bindings)
    {
        if (string.IsNullOrWhiteSpace(
                _lastLoadedLibraryPath))
        {
            return;
        }

        var previous = NormalizePath(
            _lastLoadedLibraryPath);

        if (PathEquals(previous, binding.LibraryPath))
        {
            return;
        }

        var previousKey = BindingKey(previous);

        if (bindings.TryGetValue(
                previousKey,
                out var previousId)
            && string.Equals(
                previousId,
                binding.IndexId,
                StringComparison.OrdinalIgnoreCase))
        {
            var source = Path.Combine(
                IndexesRoot,
                previousId);

            if (Directory.Exists(source)
                && !Directory.Exists(target)
                && !PathEquals(source, target))
            {
                Directory.Move(
                    source,
                    target);
            }

            bindings[previousKey] =
                binding.IndexId;
        }
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
