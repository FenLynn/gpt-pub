using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using DavBridge.Core;

namespace DavBridge;

internal sealed class V2CompatibilityState
{
    public int SchemaVersion { get; set; } = 1;
    public string? LegacySafetyFingerprint { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

internal sealed class V2CompatibilityStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private readonly string _path;
    private string BackupPath => _path + ".bak";

    public V2CompatibilityStore(string roamingRoot)
    {
        _path = Path.Combine(roamingRoot, "v2-compat.json");
    }

    public V2CompatibilityState Load()
    {
        if (TryLoad(_path, out var state)) return state;
        if (TryLoad(BackupPath, out state)) return state;
        return new V2CompatibilityState();
    }

    public void Save(V2CompatibilityState state)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        state.UpdatedAt = DateTimeOffset.UtcNow;
        var temp = _path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(state, JsonOptions));
        using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            stream.Flush(true);

        if (File.Exists(_path))
            File.Copy(_path, BackupPath, true);
        File.Move(temp, _path, true);
    }

    private static bool TryLoad(string path, out V2CompatibilityState state)
    {
        state = new V2CompatibilityState();
        if (!File.Exists(path)) return false;
        try
        {
            state = JsonSerializer.Deserialize<V2CompatibilityState>(File.ReadAllText(path), JsonOptions)
                    ?? new V2CompatibilityState();
            return true;
        }
        catch
        {
            return false;
        }
    }
}

internal static class LegacySafetyFingerprint
{
    public static string Compute(DavBridgeConfig config)
    {
        var canonical = string.Join("\n", new[]
        {
            Normalize(config.SourceBaseUrl),
            NormalizePath(config.SourceRootPath),
            Normalize(config.SourceUsername),
            Normalize(config.TargetBaseUrl),
            NormalizePath(config.TargetRootPath),
            Normalize(config.TargetUsername)
        });
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    private static string Normalize(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant();
    private static string NormalizePath(string? value) => (value ?? string.Empty).Trim().Trim('/').ToLowerInvariant();
}
