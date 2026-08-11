using System.Text.Json;

namespace DavBridge.Core;

public sealed class StateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    public string StatePath { get; }
    public string BackupPath => StatePath + ".bak";

    public StateStore(string statePath)
    {
        StatePath = statePath;
    }

    public async Task<MigrationState> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (TryLoad(StatePath, out var state))
            return state;
        if (TryLoad(BackupPath, out state))
            return state;
        return new MigrationState();
    }

    public async Task SaveAsync(MigrationState state, CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            state.UpdatedAt = DateTimeOffset.UtcNow;
            var directory = Path.GetDirectoryName(StatePath);
            if (!string.IsNullOrWhiteSpace(directory))
                Directory.CreateDirectory(directory);

            var temp = StatePath + ".tmp";
            var json = JsonSerializer.Serialize(state, JsonOptions);
            await using (var stream = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024,
                             FileOptions.Asynchronous | FileOptions.WriteThrough))
            await using (var writer = new StreamWriter(stream))
            {
                await writer.WriteAsync(json.AsMemory(), cancellationToken).ConfigureAwait(false);
                await writer.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(true);
            }

            if (File.Exists(StatePath))
            {
                File.Copy(StatePath, BackupPath, overwrite: true);
                File.Move(temp, StatePath, overwrite: true);
            }
            else
            {
                File.Move(temp, StatePath);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private static bool TryLoad(string path, out MigrationState state)
    {
        state = new MigrationState();
        if (!File.Exists(path))
            return false;

        try
        {
            var json = File.ReadAllText(path);
            state = JsonSerializer.Deserialize<MigrationState>(json, JsonOptions) ?? new MigrationState();
            state.Files = new Dictionary<string, TransferRecord>(state.Files, StringComparer.OrdinalIgnoreCase);
            return true;
        }
        catch
        {
            return false;
        }
    }
}

public sealed record QuotaSnapshot(
    long EstimatedUploadUsedBytes,
    long ReservedBytes,
    long SafeRemainingBytes,
    bool IsSprint,
    DateTimeOffset NextResetAt);

public static class QuotaPolicy
{
    public static bool AdvanceCycleIfNeeded(DavBridgeConfig config, MigrationState state, DateTimeOffset now)
    {
        if (config.NextResetAt == default || now < config.NextResetAt)
            return false;

        do
        {
            config.NextResetAt = config.NextResetAt.AddMonths(1);
        } while (now >= config.NextResetAt);

        config.CalibrationAt = now;
        config.CalibrationUploadUsedBytes = 0;
        config.CalibrationDownloadUsedBytes = 0;
        state.UploadAttemptBytesSinceCalibration = 0;
        state.VerifiedDownloadBytesSinceCalibration = 0;
        return true;
    }

    public static QuotaSnapshot GetSnapshot(DavBridgeConfig config, MigrationState state, DateTimeOffset now)
    {
        var remainingToReset = config.NextResetAt == default ? TimeSpan.MaxValue : config.NextResetAt - now;
        var sprint = config.EndOfCycleSprintEnabled && remainingToReset > TimeSpan.Zero &&
                     remainingToReset <= TimeSpan.FromHours(config.SprintWindowHours);
        var reserve = sprint ? config.SprintReserveBytes : config.NormalReserveBytes;
        var estimatedUsed = Math.Max(0, config.CalibrationUploadUsedBytes) +
                            Math.Max(0, state.UploadAttemptBytesSinceCalibration);
        var safeRemaining = Math.Max(0, config.UploadQuotaBytes - reserve - estimatedUsed);
        return new QuotaSnapshot(estimatedUsed, reserve, safeRemaining, sprint, config.NextResetAt);
    }

    public static bool CanStart(long requiredBytes, QuotaSnapshot snapshot) =>
        requiredBytes >= 0 && requiredBytes <= snapshot.SafeRemainingBytes;
}
