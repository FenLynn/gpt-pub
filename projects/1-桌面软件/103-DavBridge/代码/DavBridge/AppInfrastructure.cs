using System.Security.Cryptography;
using System.Text.Json;
using DavBridge.Core;
using Microsoft.Win32;

namespace DavBridge;

internal sealed record AppPaths(
    string RoamingRoot,
    string LocalRoot,
    string TempRoot,
    string ConfigPath,
    string StatePath,
    string SecretsPath)
{
    public static AppPaths Create()
    {
        var roamingBase = Environment.GetEnvironmentVariable("APPDATA");
        if (string.IsNullOrWhiteSpace(roamingBase))
            roamingBase = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        var localBase = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (string.IsNullOrWhiteSpace(localBase))
            localBase = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        var roaming = Path.Combine(roamingBase, "DavBridge");
        var local = Path.Combine(localBase, "DavBridge");
        return new AppPaths(
            roaming,
            local,
            Path.Combine(local, "Temp"),
            Path.Combine(roaming, "config.json"),
            Path.Combine(roaming, "state.json"),
            Path.Combine(roaming, "secrets.dat"));
    }
}

internal sealed record WebDavSecrets(string SourcePassword, string TargetPassword);

internal sealed class ConfigStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
    private readonly string _path;

    public ConfigStore(string path) => _path = path;

    public async Task<DavBridgeConfig> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_path))
            return new DavBridgeConfig();
        try
        {
            var json = await File.ReadAllTextAsync(_path, cancellationToken).ConfigureAwait(false);
            return JsonSerializer.Deserialize<DavBridgeConfig>(json, JsonOptions) ?? new DavBridgeConfig();
        }
        catch
        {
            var backup = _path + ".bak";
            if (!File.Exists(backup))
                return new DavBridgeConfig();
            var json = await File.ReadAllTextAsync(backup, cancellationToken).ConfigureAwait(false);
            return JsonSerializer.Deserialize<DavBridgeConfig>(json, JsonOptions) ?? new DavBridgeConfig();
        }
    }

    public async Task SaveAsync(DavBridgeConfig config, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temp = _path + ".tmp";
        var backup = _path + ".bak";
        var json = JsonSerializer.Serialize(config, JsonOptions);
        await File.WriteAllTextAsync(temp, json, cancellationToken).ConfigureAwait(false);
        using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            stream.Flush(true);
        if (File.Exists(_path))
            File.Copy(_path, backup, true);
        File.Move(temp, _path, true);
    }
}

internal sealed class CredentialStore
{
    private readonly string _path;

    public CredentialStore(string path) => _path = path;

    public async Task<WebDavSecrets> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(_path))
            return new WebDavSecrets(string.Empty, string.Empty);
        try
        {
            var protectedBytes = await File.ReadAllBytesAsync(_path, cancellationToken).ConfigureAwait(false);
            var clear = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
            var secrets = JsonSerializer.Deserialize<WebDavSecrets>(clear);
            return secrets ?? new WebDavSecrets(string.Empty, string.Empty);
        }
        catch
        {
            return new WebDavSecrets(string.Empty, string.Empty);
        }
    }

    public async Task SaveAsync(WebDavSecrets secrets, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var clear = JsonSerializer.SerializeToUtf8Bytes(secrets);
        var protectedBytes = ProtectedData.Protect(clear, null, DataProtectionScope.CurrentUser);
        var temp = _path + ".tmp";
        await File.WriteAllBytesAsync(temp, protectedBytes, cancellationToken).ConfigureAwait(false);
        File.Move(temp, _path, true);
    }
}

internal static class AutoStartManager
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "DavBridge";

    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true) ?? Registry.CurrentUser.CreateSubKey(RunKey, writable: true);
        if (enabled)
        {
            var exe = Environment.ProcessPath ?? Application.ExecutablePath;
            key.SetValue(ValueName, $"\"{exe}\" --background", RegistryValueKind.String);
        }
        else
        {
            key.DeleteValue(ValueName, throwOnMissingValue: false);
        }
    }
}

internal sealed class AppHost : IDisposable
{
    private readonly AppPaths _paths = AppPaths.Create();
    private readonly ConfigStore _configStore;
    private readonly CredentialStore _credentialStore;
    private readonly StateStore _stateStore;
    private CancellationTokenSource? _activeRun;
    private bool _manualPaused;

    public DavBridgeConfig Config { get; private set; } = new();
    public MigrationState State { get; private set; } = new();
    public AppPaths Paths => _paths;
    public bool IsRunning => _activeRun is not null;
    public bool IsConfigured { get; private set; }

    public event EventHandler<EngineProgress>? ProgressChanged;
    public event EventHandler? StateChanged;

    public AppHost()
    {
        _configStore = new ConfigStore(_paths.ConfigPath);
        _credentialStore = new CredentialStore(_paths.SecretsPath);
        _stateStore = new StateStore(_paths.StatePath);
    }

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_paths.RoamingRoot);
        Directory.CreateDirectory(_paths.LocalRoot);
        Directory.CreateDirectory(_paths.TempRoot);
        Config = await _configStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        State = await _stateStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        var secrets = await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        IsConfigured = HasConnectionFields(Config) && !string.IsNullOrWhiteSpace(secrets.SourcePassword) && !string.IsNullOrWhiteSpace(secrets.TargetPassword);
        AutoStartManager.SetEnabled(Config.AutoStartWithWindows);
    }

    public async Task<WebDavSecrets> GetSecretsAsync(CancellationToken cancellationToken = default) =>
        await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);

    public async Task SaveSettingsAsync(DavBridgeConfig config, string? sourcePassword, string? targetPassword, CancellationToken cancellationToken = default)
    {
        var previous = await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        var secrets = new WebDavSecrets(
            string.IsNullOrEmpty(sourcePassword) ? previous.SourcePassword : sourcePassword,
            string.IsNullOrEmpty(targetPassword) ? previous.TargetPassword : targetPassword);

        Config = config;
        await _configStore.SaveAsync(Config, cancellationToken).ConfigureAwait(false);
        await _credentialStore.SaveAsync(secrets, cancellationToken).ConfigureAwait(false);
        AutoStartManager.SetEnabled(Config.AutoStartWithWindows);
        IsConfigured = HasConnectionFields(Config) && !string.IsNullOrWhiteSpace(secrets.SourcePassword) && !string.IsNullOrWhiteSpace(secrets.TargetPassword);
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public async Task CalibrateAsync(long officialUploadUsedBytes, long officialDownloadUsedBytes, DateTimeOffset nextResetAt, CancellationToken cancellationToken = default)
    {
        Config.CalibrationAt = DateTimeOffset.Now;
        Config.CalibrationUploadUsedBytes = Math.Max(0, officialUploadUsedBytes);
        Config.CalibrationDownloadUsedBytes = Math.Max(0, officialDownloadUsedBytes);
        Config.NextResetAt = nextResetAt;
        State.UploadAttemptBytesSinceCalibration = 0;
        State.VerifiedDownloadBytesSinceCalibration = 0;
        await _configStore.SaveAsync(Config, cancellationToken).ConfigureAwait(false);
        await _stateStore.SaveAsync(State, cancellationToken).ConfigureAwait(false);
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public async Task<ReadinessReport> ScanReadinessAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var secrets = await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        using var source = new WebDavReadClient(Config.SourceBaseUrl, Config.SourceUsername, secrets.SourcePassword);
        var gate = new RequestGate(TimeSpan.FromMilliseconds(Config.TargetMinimumRequestIntervalMs));
        using var target = new WebDavWriteClient(Config.TargetBaseUrl, Config.TargetUsername, secrets.TargetPassword, gate);
        var engine = new MigrationEngine(Config, State, _stateStore, source, target, _paths.TempRoot);
        return await engine.ScanReadinessAsync(cancellationToken).ConfigureAwait(false);
    }

    public async Task RunOnceAsync(CancellationToken cancellationToken = default)
    {
        if (_manualPaused || IsRunning)
            return;
        EnsureConfigured();

        _activeRun = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        try
        {
            var secrets = await _credentialStore.LoadAsync(_activeRun.Token).ConfigureAwait(false);
            using var source = new WebDavReadClient(Config.SourceBaseUrl, Config.SourceUsername, secrets.SourcePassword);
            var gate = new RequestGate(TimeSpan.FromMilliseconds(Config.TargetMinimumRequestIntervalMs));
            using var target = new WebDavWriteClient(Config.TargetBaseUrl, Config.TargetUsername, secrets.TargetPassword, gate);
            var engine = new MigrationEngine(Config, State, _stateStore, source, target, _paths.TempRoot);
            engine.ProgressChanged += (_, progress) => ProgressChanged?.Invoke(this, progress);
            await engine.RunAsync(_activeRun.Token).ConfigureAwait(false);
            await _configStore.SaveAsync(Config, _activeRun.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            if (_manualPaused)
            {
                State.EngineState = EngineState.Paused;
                await _stateStore.SaveAsync(State, CancellationToken.None).ConfigureAwait(false);
            }
        }
        finally
        {
            _activeRun.Dispose();
            _activeRun = null;
            StateChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public async Task BackgroundLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            if (Config.AutoResume && !_manualPaused && IsConfigured)
            {
                try { await RunOnceAsync(cancellationToken).ConfigureAwait(false); }
                catch { }
            }

            var delay = GetNextBackgroundDelay();
            try { await Task.Delay(delay, cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }
    }

    public void Resume()
    {
        _manualPaused = false;
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Pause()
    {
        _manualPaused = true;
        _activeRun?.Cancel();
        State.EngineState = EngineState.Paused;
        _ = _stateStore.SaveAsync(State, CancellationToken.None);
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    private TimeSpan GetNextBackgroundDelay()
    {
        return State.EngineState switch
        {
            EngineState.WaitNetwork => TimeSpan.FromMinutes(10),
            EngineState.WaitRetry => TimeSpan.FromMinutes(10),
            EngineState.WaitQuota => GetQuotaDelay(),
            EngineState.Complete => TimeSpan.FromHours(24),
            EngineState.Paused => TimeSpan.FromMinutes(30),
            _ => TimeSpan.FromMinutes(5)
        };
    }

    private TimeSpan GetQuotaDelay()
    {
        if (Config.NextResetAt == default)
            return TimeSpan.FromHours(6);
        var remaining = Config.NextResetAt - DateTimeOffset.Now;
        if (remaining <= TimeSpan.Zero)
            return TimeSpan.FromMinutes(1);
        return remaining < TimeSpan.FromHours(6) ? remaining + TimeSpan.FromMinutes(1) : TimeSpan.FromHours(6);
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured)
            throw new InvalidOperationException("DavBridge is not configured. Set both WebDAV connections and application passwords first.");
    }

    private static bool HasConnectionFields(DavBridgeConfig config) =>
        Uri.TryCreate(config.SourceBaseUrl, UriKind.Absolute, out _) &&
        Uri.TryCreate(config.TargetBaseUrl, UriKind.Absolute, out _) &&
        !string.IsNullOrWhiteSpace(config.SourceUsername) &&
        !string.IsNullOrWhiteSpace(config.TargetUsername) &&
        !string.IsNullOrWhiteSpace(config.SourceRootPath) &&
        !string.IsNullOrWhiteSpace(config.TargetRootPath);

    public void Dispose()
    {
        _activeRun?.Cancel();
        _activeRun?.Dispose();
    }
}
