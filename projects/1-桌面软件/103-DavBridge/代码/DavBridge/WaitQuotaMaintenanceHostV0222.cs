using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// User-started NO-WRITE maintenance for the WaitQuota period.
/// Normal migration remains automatic. This optional sweep is explicit because it may consume
/// a meaningful amount of the remaining target download quota.
/// </summary>
internal sealed class WaitQuotaMaintenanceHostV0222 : IDisposable
{
    private readonly AppHost _host;
    private readonly CancellationTokenSource _lifetime = new();
    private readonly object _sync = new();
    private CancellationTokenSource? _runCts;
    private Task? _runTask;
    private bool _previousAutoResume;
    private bool _disposed;

    private WaitQuotaMaintenanceHostV0222(AppHost host) => _host = host;

    public static WaitQuotaMaintenanceHostV0222 Attach(AppHost host) => new(host);

    public bool IsRunning
    {
        get
        {
            lock (_sync) return _runTask is { IsCompleted: false };
        }
    }

    public bool CanStart
    {
        get
        {
            if (_disposed || !_host.IsConfigured || !_host.Config.MigrationEnabled || _host.IsRunning)
                return false;
            if (_host.State.EngineState != EngineState.WaitQuota)
                return false;
            return QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now).SafeDownloadRemainingBytes > 0;
        }
    }

    public void StartManual()
    {
        lock (_sync)
        {
            if (_disposed || _runTask is { IsCompleted: false } || !CanStart)
                return;

            _previousAutoResume = _host.Config.AutoResume;
            // Prevent AppHost.BackgroundLoopAsync from entering a normal WebDAV pass while the
            // explicitly started maintenance sweep owns the connections. This is in-memory only.
            _host.Config.AutoResume = false;
            _runCts = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
            _runTask = Task.Run(() => RunManualAsync(_runCts.Token));
        }
    }

    public void StopManual()
    {
        lock (_sync)
            _runCts?.Cancel();
    }

    private async Task RunManualAsync(CancellationToken cancellationToken)
    {
        try
        {
            Publish("[维护] 手动既有副本校验已启动。将遍历全部可安全检查的未验证 Zotero 组，达到下载安全预留线、全部扫描完成或你手动停止时结束。", active: true);

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

            var summary = await WaitQuotaReplicaMaintenance.ExecuteManualAsync(
                _host.Config,
                _host.State,
                stateStore,
                source,
                target,
                progress => WaitQuotaMaintenanceActivity.Publish(progress, active: true),
                cancellationToken).ConfigureAwait(false);

            if (_host.Config.MigrationEnabled && _host.State.EngineState == EngineState.WaitQuota)
            {
                _host.State.CurrentGroupKey = null;
                await stateStore.SaveAsync(_host.State, CancellationToken.None).ConfigureAwait(false);
            }

            Publish(summary.Message, active: false);
        }
        catch (OperationCanceledException)
        {
            Publish("[维护] 手动既有副本校验已停止。已经完成的强校验结果和下载记账均已保存，未主动上传任何文件。", active: false);
        }
        catch (Exception ex)
        {
            Publish($"[维护] 手动既有副本校验遇到异常，已安全停止且未主动写入目标：{ex.Message}", active: false);
        }
        finally
        {
            lock (_sync)
            {
                _host.Config.AutoResume = _previousAutoResume;
                _runCts?.Dispose();
                _runCts = null;
                _runTask = null;
            }
        }
    }

    private void Publish(string message, bool active)
    {
        WaitQuotaMaintenanceActivity.Publish(
            new EngineProgress(
                EngineState.WaitQuota,
                null,
                null,
                message,
                QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now)),
            active);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _lifetime.Cancel();
        StopManual();
        Task? running;
        lock (_sync) running = _runTask;
        try { running?.Wait(TimeSpan.FromSeconds(2)); } catch { }
        _lifetime.Dispose();
        WaitQuotaMaintenanceActivity.Clear();
    }
}
