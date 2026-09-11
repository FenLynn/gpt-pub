using System.Net.NetworkInformation;
using DavBridge.Core;
using Microsoft.Win32;

namespace DavBridge;

internal sealed class RuntimeResilienceV045 : IDisposable
{
    private readonly AppHost _host;
    private readonly CancellationTokenSource _cts = new();
    private bool _powerHooked;
    private bool _networkHooked;
    private DateTimeOffset _lastResumeAt = DateTimeOffset.MinValue;
    private bool _disposed;

    private RuntimeResilienceV045(AppHost host)
    {
        _host = host;
        TryHook();
    }

    public static RuntimeResilienceV045 Attach(AppHost host) => new(host);

    private void TryHook()
    {
        try
        {
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
            _powerHooked = true;
        }
        catch
        {
            ProductExperienceV044.Record("电源恢复监听不可用", "后台轮询仍会继续运行，但系统唤醒后不能立即提前调度。", "warning");
        }

        try
        {
            NetworkChange.NetworkAvailabilityChanged += OnNetworkAvailabilityChanged;
            _networkHooked = true;
        }
        catch
        {
            ProductExperienceV044.Record("网络恢复监听不可用", "后台轮询仍会继续运行，但网络恢复后不能立即提前重试。", "warning");
        }
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        if (_disposed || e.Mode != PowerModes.Resume) return;

        var now = DateTimeOffset.Now;
        if (now - _lastResumeAt < TimeSpan.FromSeconds(10)) return;
        _lastResumeAt = now;

        ProductExperienceV044.Record("系统已唤醒", "DavBridge 将提前唤醒后台调度并重新检查当前安全状态。", "info");
        ScheduleWake(TimeSpan.FromSeconds(4));

        if (_host.IsRunning)
            ScheduleWake(TimeSpan.FromSeconds(30));
    }

    private void OnNetworkAvailabilityChanged(object? sender, NetworkAvailabilityEventArgs e)
    {
        if (_disposed) return;

        if (!e.IsAvailable)
        {
            if (_host.Config.MigrationEnabled && _host.State.EngineState != EngineState.Paused)
                ProductExperienceV044.Record("网络已断开", "当前任务会按既有安全机制进入等待或重试状态。", "warning");
            return;
        }

        if (_host.Config.MigrationEnabled && _host.State.EngineState == EngineState.WaitNetwork)
        {
            ProductExperienceV044.Record("网络已恢复", "已提前唤醒后台调度，无需等待下一次 10 分钟轮询。", "success");
            ScheduleWake(TimeSpan.FromSeconds(2));
        }
    }

    private void ScheduleWake(TimeSpan delay)
    {
        var token = _cts.Token;
        _ = Task.Run(async () =>
        {
            try
            {
                if (delay > TimeSpan.Zero)
                    await Task.Delay(delay, token).ConfigureAwait(false);
                if (!token.IsCancellationRequested)
                    _host.RequestBackgroundWake();
            }
            catch (OperationCanceledException) { }
        }, token);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        if (_powerHooked)
        {
            try { SystemEvents.PowerModeChanged -= OnPowerModeChanged; } catch { }
        }
        if (_networkHooked)
        {
            try { NetworkChange.NetworkAvailabilityChanged -= OnNetworkAvailabilityChanged; } catch { }
        }

        _cts.Cancel();
        _cts.Dispose();
    }
}
