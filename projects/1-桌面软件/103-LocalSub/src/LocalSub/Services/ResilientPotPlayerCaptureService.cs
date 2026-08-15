using System.Diagnostics;

namespace LocalSub.Services;

/// <summary>
/// Keeps PotPlayer process-loopback capture alive across file changes, audio renderer
/// recreation and an occasional capture-session failure. The ASR recognizer is not
/// restarted, so switching videos does not reload the model.
/// </summary>
public sealed class ResilientPotPlayerCaptureService : IDisposable
{
    readonly object _gate = new();
    ProcessLoopbackCaptureService? _inner;
    CancellationTokenSource? _cts;
    Task? _supervisor;
    TaskCompletionSource<bool>? _firstReady;
    uint _processId;
    string _lastTitle = "";
    DateTime _lastSamplesAtUtc;
    bool _hasSeenSamples;
    int _generation;

    public event Action<float>? LevelChanged;
    public event Action<float[]>? SamplesAvailable;
    public event Action<string>? StatusChanged;

    public static void EnsureSupported() => ProcessLoopbackCaptureService.EnsureSupported();

    public async Task StartAsync(uint processId, CancellationToken ct = default)
    {
        if (_supervisor != null) return;
        EnsureSupported();

        _processId = processId;
        _lastTitle = ReadTitle(processId);
        _lastSamplesAtUtc = DateTime.UtcNow;
        _hasSeenSamples = false;
        _generation = 0;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _firstReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _supervisor = Task.Run(() => SupervisorLoopAsync(_cts.Token), _cts.Token);

        using var registration = ct.Register(() => _firstReady.TrySetCanceled(ct));
        await _firstReady.Task.ConfigureAwait(false);
    }

    async Task SupervisorLoopAsync(CancellationToken ct)
    {
        Exception? lastStartError = null;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var running = ResolvePotPlayerProcess();
                if (running != null && (uint)running.Id != _processId)
                {
                    _processId = (uint)running.Id;
                    _lastTitle = SafeTitle(running);
                    StatusChanged?.Invoke($"检测到 PotPlayer 进程变化，自动重新绑定 PID {_processId}");
                }

                ProcessLoopbackCaptureService? capture = null;
                try
                {
                    capture = new ProcessLoopbackCaptureService();
                    capture.LevelChanged += ForwardLevel;
                    capture.SamplesAvailable += ForwardSamples;
                    lock (_gate) _inner = capture;

                    _generation++;
                    StatusChanged?.Invoke(_generation == 1
                        ? $"连接 PotPlayer 音频，PID {_processId}"
                        : $"重新连接 PotPlayer 音频，第 {_generation - 1} 次恢复");

                    await capture.StartAsync(_processId, ct).ConfigureAwait(false);
                    lastStartError = null;
                    _firstReady?.TrySetResult(true);
                    _lastSamplesAtUtc = DateTime.UtcNow;
                    _hasSeenSamples = false;

                    var sessionTitle = ReadTitle(_processId);
                    if (!string.IsNullOrWhiteSpace(sessionTitle)) _lastTitle = sessionTitle;
                    StatusChanged?.Invoke("PotPlayer 音频已连接，切换视频会自动续接");

                    var restartReason = await WatchSessionAsync(ct).ConfigureAwait(false);
                    if (ct.IsCancellationRequested) break;
                    StatusChanged?.Invoke(restartReason);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    lastStartError = ex;
                    if (_generation == 1) _firstReady?.TrySetException(ex);
                    StatusChanged?.Invoke("PotPlayer 音频捕获中断，正在自动恢复：" + ex.Message);
                }
                finally
                {
                    if (capture != null)
                    {
                        capture.LevelChanged -= ForwardLevel;
                        capture.SamplesAvailable -= ForwardSamples;
                        try { await capture.StopAsync().ConfigureAwait(false); } catch { }
                        capture.Dispose();
                    }
                    lock (_gate)
                    {
                        if (ReferenceEquals(_inner, capture)) _inner = null;
                    }
                    LevelChanged?.Invoke(0);
                }

                if (!ct.IsCancellationRequested)
                {
                    try { await Task.Delay(lastStartError == null ? 120 : 650, ct).ConfigureAwait(false); }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                }
            }
        }
        finally
        {
            if (_firstReady != null && !_firstReady.Task.IsCompleted)
            {
                if (lastStartError != null) _firstReady.TrySetException(lastStartError);
                else _firstReady.TrySetCanceled();
            }
        }
    }

    async Task<string> WatchSessionAsync(CancellationToken ct)
    {
        // Title changes are the cleanest signal for playlist / next-file transitions.
        // An inactivity recovery is kept as a second line of defence for a silently
        // faulted WASAPI session. It triggers only after this session has actually
        // delivered samples, so a long pause does not cause endless reconnect loops.
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(300, ct).ConfigureAwait(false);

            Process? current = null;
            try { current = Process.GetProcessById((int)_processId); } catch { }
            if (current == null || current.HasExited)
            {
                var replacement = ResolvePotPlayerProcess();
                if (replacement != null)
                {
                    _processId = (uint)replacement.Id;
                    _lastTitle = SafeTitle(replacement);
                    return $"PotPlayer 进程已切换，自动绑定 PID {_processId}";
                }
                return "PotPlayer 进程暂时不可用，等待自动恢复";
            }

            current.Refresh();
            var title = SafeTitle(current);
            if (!string.IsNullOrWhiteSpace(title) &&
                !string.IsNullOrWhiteSpace(_lastTitle) &&
                !string.Equals(title, _lastTitle, StringComparison.Ordinal))
            {
                var old = _lastTitle;
                _lastTitle = title;
                _hasSeenSamples = false;
                return $"检测到 PotPlayer 视频切换，自动续接音频：{ShortTitle(old)} → {ShortTitle(title)}";
            }
            if (!string.IsNullOrWhiteSpace(title)) _lastTitle = title;

            if (_hasSeenSamples && DateTime.UtcNow - _lastSamplesAtUtc > TimeSpan.FromSeconds(7))
            {
                // One recovery attempt for a session that used to be active but then
                // stopped producing PCM. After restart _hasSeenSamples is false until
                // audio returns, so a paused player will not churn continuously.
                _hasSeenSamples = false;
                return "PotPlayer 音频超过 7 秒无新数据，自动重建捕获会话";
            }
        }
        throw new OperationCanceledException(ct);
    }

    void ForwardLevel(float value) => LevelChanged?.Invoke(value);

    void ForwardSamples(float[] samples)
    {
        if (samples.Length == 0) return;
        _hasSeenSamples = true;
        _lastSamplesAtUtc = DateTime.UtcNow;
        SamplesAvailable?.Invoke(samples);
    }

    Process? ResolvePotPlayerProcess()
    {
        try
        {
            var current = Process.GetProcessById((int)_processId);
            if (!current.HasExited) return current;
        }
        catch { }
        return PotPlayerWatcher.FindRunning();
    }

    static string ReadTitle(uint processId)
    {
        try
        {
            using var p = Process.GetProcessById((int)processId);
            return SafeTitle(p);
        }
        catch { return ""; }
    }

    static string SafeTitle(Process p)
    {
        try { p.Refresh(); return p.MainWindowTitle?.Trim() ?? ""; }
        catch { return ""; }
    }

    static string ShortTitle(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "未知";
        return value.Length <= 28 ? value : value[..25] + "...";
    }

    public async Task StopAsync()
    {
        var cts = _cts;
        if (cts != null)
        {
            try { cts.Cancel(); } catch { }
        }

        ProcessLoopbackCaptureService? inner;
        lock (_gate) inner = _inner;
        if (inner != null)
        {
            try { await inner.StopAsync().ConfigureAwait(false); } catch { }
        }

        if (_supervisor != null)
        {
            try { await _supervisor.ConfigureAwait(false); } catch (OperationCanceledException) { } catch { }
        }

        _supervisor = null;
        _firstReady = null;
        _cts?.Dispose();
        _cts = null;
        lock (_gate) _inner = null;
        _hasSeenSamples = false;
        LevelChanged?.Invoke(0);
    }

    public void Dispose() => StopAsync().GetAwaiter().GetResult();
}
