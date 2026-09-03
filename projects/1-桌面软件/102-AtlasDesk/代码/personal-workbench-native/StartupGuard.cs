using System.Text.Json;

namespace PersonalWorkbench;

public sealed class StartupGuardState
{
    public string Version { get; set; } = string.Empty;
    public bool Running { get; set; }
    public bool PreviousSessionUnclean { get; set; }
    public int ConsecutiveUncleanStarts { get; set; }
    public DateTimeOffset LastStartUtc { get; set; }
    public DateTimeOffset? LastCleanExitUtc { get; set; }
}

public static class StartupGuard
{
    private const int SafeModeThreshold = 2;
    private static readonly object Sync = new();
    private static StartupGuardState? _state;

    public static string StatePath => Path.Combine(App.StateDirectory, "startup-state.json");
    public static string BackupPath => StatePath + ".bak";
    public static StartupGuardState Current => _state ?? new StartupGuardState();
    public static bool PreviousSessionUnclean => Current.PreviousSessionUnclean;
    public static bool SafeModeRecommended => ShouldUseSafeMode(Current);

    public static void Begin(string version)
    {
        lock (Sync)
        {
            var previous = ReadState(StatePath) ?? ReadState(BackupPath);
            _state = CreateNext(previous, version, DateTimeOffset.UtcNow);
            WriteState(StatePath, _state);
        }
    }

    public static void Complete()
    {
        lock (Sync)
        {
            if (_state is null) return;
            _state = MarkClean(_state, DateTimeOffset.UtcNow);
            WriteState(StatePath, _state);
        }
    }

    public static bool ShouldUseSafeMode(StartupGuardState state)
        => state.PreviousSessionUnclean
           && state.ConsecutiveUncleanStarts >= SafeModeThreshold;

    public static StartupGuardState CreateNext(StartupGuardState? previous, string version, DateTimeOffset now)
    {
        var wasUnclean = previous?.Running == true;
        return new StartupGuardState
        {
            Version = version,
            Running = true,
            PreviousSessionUnclean = wasUnclean,
            ConsecutiveUncleanStarts = wasUnclean
                ? Math.Max(1, previous!.ConsecutiveUncleanStarts + 1)
                : 0,
            LastStartUtc = now,
            LastCleanExitUtc = previous?.LastCleanExitUtc
        };
    }

    public static StartupGuardState MarkClean(StartupGuardState state, DateTimeOffset now) => new()
    {
        Version = state.Version,
        Running = false,
        PreviousSessionUnclean = state.PreviousSessionUnclean,
        ConsecutiveUncleanStarts = 0,
        LastStartUtc = state.LastStartUtc,
        LastCleanExitUtc = now
    };

    public static StartupGuardState? ReadState(string path)
    {
        try
        {
            if (!File.Exists(path)) return null;
            return JsonSerializer.Deserialize<StartupGuardState>(File.ReadAllText(path), JsonOptions());
        }
        catch (Exception ex)
        {
            App.Log("Startup guard read failed: " + ex.Message);
            AtomicFileStore.Quarantine(path, "corrupt");
            return null;
        }
    }

    private static void WriteState(string path, StartupGuardState state)
    {
        try
        {
            AtomicFileStore.WriteAllText(
                path,
                JsonSerializer.Serialize(state, JsonOptions()),
                BackupPath);
        }
        catch (Exception ex)
        {
            App.Log("Startup guard write failed: " + ex.Message);
        }
    }

    private static JsonSerializerOptions JsonOptions() => new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };
}
