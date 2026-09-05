using DavBridge.Core;

namespace DavBridge;

internal sealed record WaitQuotaMaintenanceActivitySnapshot(
    EngineProgress Progress,
    DateTimeOffset UpdatedAt,
    bool IsActive);

internal static class WaitQuotaMaintenanceActivity
{
    private static readonly object Sync = new();
    private static WaitQuotaMaintenanceActivitySnapshot? _current;

    public static WaitQuotaMaintenanceActivitySnapshot? Current
    {
        get
        {
            lock (Sync) return _current;
        }
    }

    public static void Publish(EngineProgress progress, bool active)
    {
        lock (Sync)
            _current = new WaitQuotaMaintenanceActivitySnapshot(progress, DateTimeOffset.Now, active);
    }

    public static void Clear()
    {
        lock (Sync)
            _current = null;
    }
}

internal sealed class WaitQuotaMaintenanceHostV0221 : IDisposable
{
    private readonly AppHost _host;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _loop;
    private DateTimeOffset _nextAllowedAt = DateTimeOffset.Now.AddSeconds(10);
    private bool _maintenanceRunning;
    private bool _disposed;

    private WaitQuotaMaintenanceHostV0221(AppHost host)
    {
        _host = host;
        _host.StateChanged += OnHostStateChanged;
        _loop = Task.Run(() => LoopAsync(_cts.Token));
    }

    public static WaitQuotaMaintenanceHostV0221 Attach(AppHost host) => new(host);

    private void OnHostStateChanged(object? sender, EventArgs e)
    {
        if (_disposed) return;
        if (_host.State.EngineState == EngineState.WaitQuota && !_host.IsRunning)
        {
            // The normal AppHost pass has finished and owns no active WebDAV run now.
            // Schedule direct-path maintenance a few seconds later instead of running concurrently.
            _nextAllowedAt = DateTimeOffset.Now.AddSeconds(8);
        }
        else if (_host.State.EngineState != EngineState.WaitQuota)
        {
            WaitQuotaMaintenanceActivity.Clear();
        }
    }

    private async Task LoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if (CanRunNow())
                    await RunMaintenanceAsync(cancellationToken).ConfigureAwait(false);

                await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // Maintenance is advisory to the normal migration loop. Never crash the application.
        }
    }

    private bool CanRunNow()
    {
        if (_disposed || _maintenanceRunning || !_host.IsConfigured || !_host.Config.MigrationEnabled || !_host.Config.AutoResume)
            return false;
        if (_host.IsRunning || _host.State.EngineState != EngineState.WaitQuota)
            return false;
        return DateTimeOffset.Now >= _nextAllowedAt;
    }

    private async Task RunMaintenanceAsync(CancellationToken cancellationToken)
    {
        _maintenanceRunning = true;
        // Do not schedule by an independent periodic clock. The next run is armed only after
        // AppHost finishes its next normal WaitQuota pass, which avoids overlapping WebDAV work.
        _nextAllowedAt = DateTimeOffset.MaxValue;
        try
        {
            var secrets = await _host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
            using var source = new WebDavReadClient(
                _host.Config.SourceBaseUrl,
                _host.Config.SourceUsername,
                secrets.SourcePassword);
            var gate = new RequestGate(TimeSpan.FromMilliseconds(_host.Config.TargetMinimumRequestIntervalMs));
            using var target = new WebDavWriteClient(
                _host.Config.TargetBaseUrl,
                _host.Config.TargetUsername,
                secrets.TargetPassword,
                gate);
            var stateStore = new StateStore(_host.Paths.StatePath);

            var startProgress = new EngineProgress(
                EngineState.WaitQuota,
                null,
                null,
                "[维护] 已进入额度等待期后台维护，准备直接按目标路径寻找坚果云既有副本。",
                QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now));
            WaitQuotaMaintenanceActivity.Publish(startProgress, active: true);

            var summary = await WaitQuotaReplicaMaintenance.ExecuteAsync(
                _host.Config,
                _host.State,
                stateStore,
                source,
                target,
                progress => WaitQuotaMaintenanceActivity.Publish(progress, active: true),
                cancellationToken).ConfigureAwait(false);

            // The normal migration loop owns the WaitQuota state. This maintenance path never
            // turns the task into Running or Complete by itself.
            _host.State.EngineState = EngineState.WaitQuota;
            _host.State.CurrentGroupKey = null;
            await stateStore.SaveAsync(_host.State, cancellationToken).ConfigureAwait(false);

            var finalProgress = new EngineProgress(
                EngineState.WaitQuota,
                null,
                null,
                summary.Message,
                QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now));
            WaitQuotaMaintenanceActivity.Publish(finalProgress, active: false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            var progress = new EngineProgress(
                EngineState.WaitQuota,
                null,
                null,
                $"[维护] 本轮既有副本校验遇到异常，已安全停止且未主动写入：{ex.Message}",
                QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now));
            WaitQuotaMaintenanceActivity.Publish(progress, active: false);
        }
        finally
        {
            _maintenanceRunning = false;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _host.StateChanged -= OnHostStateChanged;
        _cts.Cancel();
        try { _loop.Wait(TimeSpan.FromSeconds(1)); } catch { }
        _cts.Dispose();
        WaitQuotaMaintenanceActivity.Clear();
    }
}
