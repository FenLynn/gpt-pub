using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LocalSub.Services;

/// <summary>
/// Keeps PotPlayer process-loopback capture alive across media changes, seeks,
/// renderer recreation and transient Windows activation failures. The ASR model
/// remains loaded while only the audio session is recovered.
/// </summary>
public sealed class ResilientPotPlayerCaptureService : IDisposable
{
    const int InitialStartAttempts = 6;
    static readonly TimeSpan NormalInactivity = TimeSpan.FromSeconds(2.6);
    static readonly TimeSpan TransitionInactivity = TimeSpan.FromSeconds(1.8);
    static readonly TimeSpan TransitionWindow = TimeSpan.FromSeconds(5);

    readonly object _gate = new();
    ProcessLoopbackCaptureService? _inner;
    CancellationTokenSource? _cts;
    Task? _supervisor;
    TaskCompletionSource<bool>? _firstReady;
    uint _processId;
    string _lastTitle = "";
    DateTime _lastSamplesAtUtc;
    DateTime _lastMediaTransitionAtUtc;
    bool _hasSeenSamples;
    bool _recovering;
    int _successfulSessions;
    int _consecutiveStartFailures;

    public event Action<float>? LevelChanged;
    public event Action<float[]>? SamplesAvailable;
    public event Action<string>? StatusChanged;
    public event Action? SessionDiscontinuity;

    public static void EnsureSupported() => ProcessLoopbackCaptureService.EnsureSupported();

    public async Task StartAsync(uint processId, CancellationToken ct = default)
    {
        if (_supervisor != null) return;
        EnsureSupported();

        _processId = processId;
        _lastTitle = ReadTitle(processId);
        _lastSamplesAtUtc = DateTime.UtcNow;
        _lastMediaTransitionAtUtc = DateTime.MinValue;
        _hasSeenSamples = false;
        _recovering = false;
        _successfulSessions = 0;
        _consecutiveStartFailures = 0;
        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        _firstReady = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _supervisor = Task.Run(() => SupervisorLoopAsync(_cts.Token), _cts.Token);

        using var registration = ct.Register(() => _firstReady.TrySetCanceled(ct));
        await _firstReady.Task.ConfigureAwait(false);
    }

    async Task SupervisorLoopAsync(CancellationToken ct)
    {
        Exception? lastStartError = null;
        var settleBeforeNextStart = false;
        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (TryResolvePotPlayer(out var resolvedPid, out var resolvedTitle) && resolvedPid != _processId)
                {
                    _processId = resolvedPid;
                    _lastTitle = resolvedTitle;
                    _recovering = _successfulSessions > 0;
                    if (_recovering) SessionDiscontinuity?.Invoke();
                    StatusChanged?.Invoke($"PotPlayer 进程变化，等待音频稳定后重新绑定 PID {_processId}");
                    settleBeforeNextStart = true;
                }

                if (settleBeforeNextStart)
                {
                    try { await Task.Delay(420, ct).ConfigureAwait(false); }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                    settleBeforeNextStart = false;
                }

                ProcessLoopbackCaptureService? capture = null;
                var sessionWasStarted = false;
                try
                {
                    capture = new ProcessLoopbackCaptureService();
                    capture.LevelChanged += ForwardLevel;
                    capture.SamplesAvailable += ForwardSamples;
                    lock (_gate) _inner = capture;

                    if (_successfulSessions == 0 && _consecutiveStartFailures == 0)
                        StatusChanged?.Invoke($"连接 PotPlayer 音频，PID {_processId}");
                    else if (_consecutiveStartFailures == 0)
                        StatusChanged?.Invoke("正在恢复 PotPlayer 音频，不重新加载识别模型");

                    await capture.StartAsync(_processId, ct).ConfigureAwait(false);
                    sessionWasStarted = true;
                    lastStartError = null;
                    _consecutiveStartFailures = 0;
                    _successfulSessions++;
                    _firstReady?.TrySetResult(true);
                    _lastSamplesAtUtc = DateTime.UtcNow;
                    _hasSeenSamples = false;

                    var sessionTitle = ReadTitle(_processId);
                    if (!string.IsNullOrWhiteSpace(sessionTitle)) _lastTitle = sessionTitle;
                    StatusChanged?.Invoke(_recovering
                        ? "PotPlayer 音频会话已重新建立，等待声音恢复"
                        : "PotPlayer 音频已连接，快进、快退和换片会自动容错");

                    var restartReason = await WatchSessionAsync(ct).ConfigureAwait(false);
                    if (ct.IsCancellationRequested) break;

                    _recovering = true;
                    SessionDiscontinuity?.Invoke();
                    StatusChanged?.Invoke(restartReason);
                    settleBeforeNextStart = true;
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    lastStartError = ex;
                    _consecutiveStartFailures++;
                    _recovering = _successfulSessions > 0;

                    if (_successfulSessions == 0 && _consecutiveStartFailures >= InitialStartAttempts)
                    {
                        _firstReady?.TrySetException(new InvalidOperationException(
                            $"PotPlayer 音频暂时无法建立，已自动重试 {_consecutiveStartFailures} 次。最后错误：{ShortError(ex)}", ex));
                        break;
                    }

                    var delay = RetryDelay(_consecutiveStartFailures);
                    var prefix = _successfulSessions > 0
                        ? "PotPlayer 音频正在恢复"
                        : "PotPlayer 音频尚未就绪";
                    StatusChanged?.Invoke($"{prefix}，{delay.TotalSeconds:0.0} 秒后自动重试（{_consecutiveStartFailures}）{ErrorSuffix(ex)}");

                    try { await Task.Delay(delay, ct).ConfigureAwait(false); }
                    catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                }
                finally
                {
                    if (capture != null)
                    {
                        capture.LevelChanged -= ForwardLevel;
                        capture.SamplesAvailable -= ForwardSamples;
                        try { await capture.StopAsync().ConfigureAwait(false); } catch { }
                        try { capture.Dispose(); } catch { }
                    }
                    lock (_gate)
                    {
                        if (ReferenceEquals(_inner, capture)) _inner = null;
                    }
                    if (sessionWasStarted && _recovering) LevelChanged?.Invoke(0);
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
        // A title change no longer tears down process loopback immediately. Process
        // loopback is PID-scoped, so the existing session is kept while PotPlayer
        // switches files or seeks. We rebuild only when PCM actually stops arriving.
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(220, ct).ConfigureAwait(false);

            bool currentAlive;
            string title;
            try
            {
                using var current = Process.GetProcessById((int)_processId);
                currentAlive = !current.HasExited;
                title = currentAlive ? SafeTitle(current) : "";
            }
            catch
            {
                currentAlive = false;
                title = "";
            }

            if (!currentAlive)
            {
                if (TryResolvePotPlayer(out var replacementPid, out var replacementTitle))
                {
                    _processId = replacementPid;
                    _lastTitle = replacementTitle;
                    return $"PotPlayer 进程已切换，准备自动绑定 PID {_processId}";
                }
                return "PotPlayer 暂时不可用，等待播放器恢复";
            }

            if (!string.IsNullOrWhiteSpace(title) &&
                !string.IsNullOrWhiteSpace(_lastTitle) &&
                !string.Equals(title, _lastTitle, StringComparison.Ordinal))
            {
                _lastTitle = title;
                _lastMediaTransitionAtUtc = DateTime.UtcNow;
                StatusChanged?.Invoke("检测到 PotPlayer 媒体变化，保持当前音频会话并等待声音自然恢复");
            }
            else if (!string.IsNullOrWhiteSpace(title))
            {
                _lastTitle = title;
            }

            if (_hasSeenSamples)
            {
                var now = DateTime.UtcNow;
                var nearTransition = _lastMediaTransitionAtUtc != DateTime.MinValue && now - _lastMediaTransitionAtUtc <= TransitionWindow;
                var threshold = nearTransition ? TransitionInactivity : NormalInactivity;
                if (now - _lastSamplesAtUtc > threshold)
                {
                    _hasSeenSamples = false;
                    return nearTransition
                        ? "换片或跳转后音频暂未恢复，准备重新建立捕获会话"
                        : "检测到 PotPlayer 音频流中断，准备自动恢复";
                }
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
        if (_recovering)
        {
            _recovering = false;
            StatusChanged?.Invoke("PotPlayer 音频已恢复，继续实时识别");
        }
        SamplesAvailable?.Invoke(samples);
    }

    bool TryResolvePotPlayer(out uint pid, out string title)
    {
        pid = 0;
        title = "";
        try
        {
            using var current = Process.GetProcessById((int)_processId);
            if (!current.HasExited)
            {
                pid = (uint)current.Id;
                title = SafeTitle(current);
                return true;
            }
        }
        catch { }

        Process? replacement = null;
        try
        {
            replacement = PotPlayerWatcher.FindRunning();
            if (replacement == null || replacement.HasExited) return false;
            pid = (uint)replacement.Id;
            title = SafeTitle(replacement);
            return true;
        }
        catch { return false; }
        finally { replacement?.Dispose(); }
    }

    static TimeSpan RetryDelay(int failures) => failures switch
    {
        <= 1 => TimeSpan.FromMilliseconds(350),
        2 => TimeSpan.FromMilliseconds(700),
        3 => TimeSpan.FromMilliseconds(1200),
        4 => TimeSpan.FromMilliseconds(2000),
        _ => TimeSpan.FromMilliseconds(3000)
    };

    static string ErrorSuffix(Exception ex)
    {
        var hr = ex.HResult;
        return ex is COMException || hr < 0 ? $"，HRESULT 0x{hr:X8}" : "";
    }

    static string ShortError(Exception ex)
    {
        var text = ex.Message.Replace('\r', ' ').Replace('\n', ' ').Trim();
        if (text.Length > 150) text = text[..147] + "...";
        return text;
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
        _recovering = false;
        _consecutiveStartFailures = 0;
        LevelChanged?.Invoke(0);
    }

    public void Dispose() => StopAsync().GetAwaiter().GetResult();
}
