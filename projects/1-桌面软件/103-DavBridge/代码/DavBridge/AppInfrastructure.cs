using System.Net;
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

internal sealed record ConnectionDiagnosticResult(
    bool SourceOk,
    string SourceMessage,
    bool TargetBaseOk,
    string TargetBaseMessage,
    bool TargetRootOk,
    string TargetRootMessage)
{
    public bool AllOk => SourceOk && TargetBaseOk && TargetRootOk;
}

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
    private bool _manualPaused = true;

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
        _manualPaused = !Config.MigrationEnabled;
        if (!Config.MigrationEnabled && State.EngineState != EngineState.Paused)
            State.EngineState = EngineState.Paused;
        AutoStartManager.SetEnabled(Config.AutoStartWithWindows);
    }

    public async Task<WebDavSecrets> GetSecretsAsync(CancellationToken cancellationToken = default) =>
        await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);

    public async Task<(bool SourceSaved, bool TargetSaved)> GetCredentialStatusAsync(CancellationToken cancellationToken = default)
    {
        var secrets = await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        return (!string.IsNullOrWhiteSpace(secrets.SourcePassword), !string.IsNullOrWhiteSpace(secrets.TargetPassword));
    }

    public async Task SaveSettingsAsync(DavBridgeConfig config, string? sourcePassword, string? targetPassword, CancellationToken cancellationToken = default)
    {
        var previous = await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        var secrets = new WebDavSecrets(
            MergeSecret(sourcePassword, previous.SourcePassword),
            MergeSecret(targetPassword, previous.TargetPassword));

        Config = config;
        _manualPaused = !Config.MigrationEnabled;
        await _configStore.SaveAsync(Config, cancellationToken).ConfigureAwait(false);
        await _credentialStore.SaveAsync(secrets, cancellationToken).ConfigureAwait(false);
        AutoStartManager.SetEnabled(Config.AutoStartWithWindows);
        IsConfigured = HasConnectionFields(Config) && !string.IsNullOrWhiteSpace(secrets.SourcePassword) && !string.IsNullOrWhiteSpace(secrets.TargetPassword);
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public async Task<ConnectionDiagnosticResult> DiagnoseConnectionsAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var secrets = await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);

        var sourceOk = false;
        var sourceMessage = "尚未测试";
        try
        {
            using var source = new WebDavReadClient(Config.SourceBaseUrl, Config.SourceUsername, secrets.SourcePassword);
            var entries = await source.ListDirectoryAsync(Config.SourceRootPath, cancellationToken).ConfigureAwait(false);
            sourceOk = true;
            sourceMessage = $"连接成功，源目录可访问，本次目录响应包含 {entries.Count:N0} 个可见对象。";
        }
        catch (Exception ex)
        {
            sourceMessage = DescribeConnectionFailure("InfiniCLOUD", ex);
        }

        var targetBaseOk = false;
        var targetRootOk = false;
        var targetBaseMessage = "尚未测试";
        var targetRootMessage = "尚未测试";
        var gate = new RequestGate(TimeSpan.FromMilliseconds(Config.TargetMinimumRequestIntervalMs));
        try
        {
            using var target = new WebDavWriteClient(Config.TargetBaseUrl, Config.TargetUsername, secrets.TargetPassword, gate);
            try
            {
                var rootEntries = await target.ListDirectoryAsync(string.Empty, cancellationToken).ConfigureAwait(false);
                targetBaseOk = true;
                targetBaseMessage = $"认证成功，WebDAV 根目录可访问，本次响应包含 {rootEntries.Count:N0} 个可见对象。";
            }
            catch (Exception ex)
            {
                targetBaseMessage = DescribeConnectionFailure("坚果云", ex);
            }

            if (targetBaseOk)
            {
                try
                {
                    var entries = await target.ListDirectoryAsync(Config.TargetRootPath, cancellationToken).ConfigureAwait(false);
                    targetRootOk = true;
                    targetRootMessage = $"目标目录 /{Config.TargetRootPath.Trim('/')}/ 可访问，本次响应包含 {entries.Count:N0} 个可见对象。";
                }
                catch (Exception ex)
                {
                    targetRootMessage = DescribeConnectionFailure("坚果云目标目录", ex);
                }
            }
            else
            {
                targetRootMessage = "未测试，因为坚果云 WebDAV 根目录认证尚未通过。";
            }
        }
        catch (Exception ex)
        {
            targetBaseMessage = DescribeConnectionFailure("坚果云", ex);
            targetRootMessage = "未测试，因为坚果云客户端初始化失败。";
        }

        return new ConnectionDiagnosticResult(
            sourceOk, sourceMessage,
            targetBaseOk, targetBaseMessage,
            targetRootOk, targetRootMessage);
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

    public async Task<int> GetVisibleTargetObjectCountAsync(CancellationToken cancellationToken = default)
    {
        EnsureConfigured();
        var secrets = await _credentialStore.LoadAsync(cancellationToken).ConfigureAwait(false);
        var gate = new RequestGate(TimeSpan.FromMilliseconds(Config.TargetMinimumRequestIntervalMs));
        using var target = new WebDavWriteClient(Config.TargetBaseUrl, Config.TargetUsername, secrets.TargetPassword, gate);
        var entries = await target.ListDirectoryAsync(Config.TargetRootPath, cancellationToken).ConfigureAwait(false);
        return entries.Count(x => !x.IsCollection);
    }

    public async Task SetMigrationEnabledAsync(bool enabled, CancellationToken cancellationToken = default)
    {
        Config.MigrationEnabled = enabled;
        _manualPaused = !enabled;
        if (!enabled)
        {
            _activeRun?.Cancel();
            State.EngineState = EngineState.Paused;
            await _stateStore.SaveAsync(State, CancellationToken.None).ConfigureAwait(false);
        }
        await _configStore.SaveAsync(Config, cancellationToken).ConfigureAwait(false);
        StateChanged?.Invoke(this, EventArgs.Empty);
    }

    public async Task RunOnceAsync(CancellationToken cancellationToken = default)
    {
        if (!Config.MigrationEnabled || _manualPaused || IsRunning)
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
            if (_manualPaused || !Config.MigrationEnabled)
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
            if (Config.AutoResume && Config.MigrationEnabled && !_manualPaused && IsConfigured)
            {
                try { await RunOnceAsync(cancellationToken).ConfigureAwait(false); }
                catch { }
            }

            var delay = GetNextBackgroundDelay();
            try { await Task.Delay(delay, cancellationToken).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }
    }

    public Task ResumeAsync(CancellationToken cancellationToken = default) =>
        SetMigrationEnabledAsync(true, cancellationToken);

    public Task PauseAsync(CancellationToken cancellationToken = default) =>
        SetMigrationEnabledAsync(false, cancellationToken);

    private TimeSpan GetNextBackgroundDelay()
    {
        if (!Config.MigrationEnabled)
            return TimeSpan.FromMinutes(30);

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

        var now = DateTimeOffset.Now;
        var remaining = Config.NextResetAt - now;
        if (remaining <= TimeSpan.Zero)
            return TimeSpan.FromMinutes(1);

        if (Config.EndOfCycleSprintEnabled)
        {
            var sprintStartsAt = Config.NextResetAt - TimeSpan.FromHours(Config.SprintWindowHours);
            if (now < sprintStartsAt)
            {
                var untilSprint = sprintStartsAt - now;
                if (untilSprint < TimeSpan.FromHours(6))
                    return untilSprint + TimeSpan.FromMinutes(1);
            }
        }

        return remaining < TimeSpan.FromHours(6) ? remaining + TimeSpan.FromMinutes(1) : TimeSpan.FromHours(6);
    }

    private void EnsureConfigured()
    {
        if (!IsConfigured)
            throw new InvalidOperationException("DavBridge is not configured. Set both WebDAV connections and application passwords first.");
    }

    private static string MergeSecret(string? candidate, string previous)
    {
        if (string.IsNullOrWhiteSpace(candidate))
            return previous;
        return candidate.Trim();
    }

    private static string DescribeConnectionFailure(string side, Exception ex)
    {
        if (ex is WebDavException webDav)
        {
            if (webDav.StatusCode == HttpStatusCode.Unauthorized)
            {
                if (side.StartsWith("坚果云", StringComparison.Ordinal))
                    return $"已到达坚果云 WebDAV，但认证被拒绝（401）。请确认用户名是坚果云注册邮箱，密码是当前有效的第三方应用密码。详细信息：{webDav.Message}";
                return $"已到达 {side}，但认证被拒绝（401）。请重新核对该端专用的 WebDAV 用户名和应用密码。详细信息：{webDav.Message}";
            }

            if (webDav.StatusCode == HttpStatusCode.NotFound)
                return $"认证请求已到达服务器，但路径不存在或不匹配（404）。详细信息：{webDav.Message}";

            return webDav.Message;
        }

        if (ex is HttpRequestException)
            return $"网络连接失败：{ex.Message}";

        return ex.Message;
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
