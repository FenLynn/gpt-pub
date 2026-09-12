using System.Diagnostics;
using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.UI;

/// <summary>
/// Shell application layer for realtime subtitles. It owns Windows-only coordination
/// such as PotPlayer discovery and Overlay placement while delegating audio capture
/// and ASR computation to LocalSub.Core through LiveAsrPipeline.
/// </summary>
internal sealed class LiveSessionController : IAsyncDisposable
{
    readonly object _stateGate = new();
    readonly LiveAsrPipeline _pipeline;
    readonly System.Windows.Forms.Timer _overlayFollowTimer = new() { Interval = 60 };
    readonly SynchronizationContext _uiContext;

    AppSettings _settings = AppSettings.Load();
    ModelManager _models;
    IReadOnlyList<ModelDescriptor> _catalog;
    LiveModelOption[] _availableModels = [];
    SubtitleOverlayForm? _overlay;
    string _state = "idle";
    string _sourceId = "potplayer";
    string _modelId = "";
    string _modelName = "";
    string _status = "等待开始";
    string? _lastError;
    string _currentText = "";
    string _previousText = "";
    string _lastFinalText = "";
    float _level;
    bool _disposed;

    internal event Action? Changed;

    internal LiveSessionController(CoreWorkerClient core)
    {
        _uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _models = new ModelManager(_settings);
        _catalog = new ModelCatalogService().Load();
        _pipeline = new LiveAsrPipeline(core);

        _pipeline.LevelChanged += OnLevelChanged;
        _pipeline.StatusChanged += OnStatusChanged;
        _pipeline.PartialResult += OnPartialResult;
        _pipeline.FinalResult += OnFinalResult;
        _pipeline.Failed += OnFailed;
        _overlayFollowTimer.Tick += (_, _) => FollowOverlayToPotPlayer();

        RefreshConfiguration();
    }

    internal LiveSessionViewState Snapshot
    {
        get
        {
            lock (_stateGate)
            {
                return new LiveSessionViewState(
                    _state,
                    _sourceId,
                    SourceLabel(_sourceId),
                    _modelId,
                    _modelName,
                    _availableModels,
                    _level,
                    _status,
                    _currentText,
                    _previousText,
                    _lastError,
                    _availableModels.Length > 0 && _state is "idle" or "failed");
            }
        }
    }

    internal async Task StartAsync(string sourceId, string modelId, CancellationToken ct = default)
    {
        ThrowIfDisposed();

        var normalizedSource = NormalizeSource(sourceId);
        RefreshConfiguration();
        var model = _catalog.FirstOrDefault(x =>
            x.LiveCapable &&
            string.Equals(x.Id, modelId, StringComparison.OrdinalIgnoreCase));

        if (model == null)
            throw new InvalidOperationException("请选择有效的实时识别模型。");
        if (!_models.IsInstalled(model))
            throw new InvalidOperationException($"实时模型“{model.Name}”尚未安装，请先在“模型”页面下载。");

        lock (_stateGate)
        {
            if (_state is "starting" or "running" or "stopping")
                throw new InvalidOperationException("实时字幕正在运行或切换状态，请稍候。");

            _state = "starting";
            _sourceId = normalizedSource;
            _modelId = model.Id;
            _modelName = model.Name;
            _status = "正在启动";
            _lastError = null;
            _level = 0;
            _currentText = "";
            _previousText = "";
            _lastFinalText = "";
        }
        NotifyChanged();

        _settings.AudioSource = normalizedSource == "potplayer" ? AudioSourceMode.PotPlayer : AudioSourceMode.AllAudio;
        _settings.LiveModelId = model.Id;
        _settings.Save();
        _models = new ModelManager(_settings);

        try
        {
            await RunOnUiAsync(async () =>
            {
                EnsureOverlay();
                _overlay!.ApplySettings(_settings);
                FollowOverlayToPotPlayer();
                if (!_overlay.Visible) _overlay.Show();
                await _overlay.SetTextAsync("正在启动实时识别…", "", ParseKeywords());
            });

            var progress = new Progress<ModelOperationProgress>(p =>
            {
                var text = p.Percent.HasValue ? $"{p.Stage} {p.Percent}%" : p.Stage;
                if (!string.IsNullOrWhiteSpace(p.Detail)) text += "  " + p.Detail;
                UpdateStatus(text);
            });

            if (normalizedSource == "potplayer")
            {
                using var potPlayer = PotPlayerWatcher.FindRunning();
                if (potPlayer == null)
                    throw new InvalidOperationException("未检测到正在运行的 PotPlayer。");

                await _pipeline.StartPotPlayerAsync(
                    _settings,
                    model,
                    _models,
                    (uint)potPlayer.Id,
                    progress,
                    ct);
            }
            else
            {
                await _pipeline.StartAllAudioAsync(
                    _settings,
                    model,
                    _models,
                    progress,
                    ct);
            }

            lock (_stateGate)
            {
                _state = "running";
                if (string.IsNullOrWhiteSpace(_status) || _status == "正在启动")
                    _status = "实时识别中";
            }
            await RunOnUiAsync(() =>
            {
                _overlayFollowTimer.Start();
                FollowOverlayToPotPlayer();
                return Task.CompletedTask;
            });
            NotifyChanged();
        }
        catch (Exception ex)
        {
            try { await _pipeline.StopAsync(); } catch { }
            await RunOnUiAsync(() =>
            {
                _overlayFollowTimer.Stop();
                _overlay?.Hide();
                return Task.CompletedTask;
            });
            lock (_stateGate)
            {
                _state = "failed";
                _level = 0;
                _lastError = ex.Message;
                _status = "启动失败";
            }
            NotifyChanged();
            throw;
        }
    }

    internal async Task StopAsync()
    {
        if (_disposed) return;

        lock (_stateGate)
        {
            if (_state == "idle") return;
            _state = "stopping";
            _status = "正在停止";
            _lastError = null;
        }
        NotifyChanged();

        await RunOnUiAsync(() =>
        {
            _overlayFollowTimer.Stop();
            return Task.CompletedTask;
        });

        try
        {
            await _pipeline.StopAsync();
            lock (_stateGate)
            {
                _state = "idle";
                _level = 0;
                _status = _availableModels.Length > 0 ? "已停止" : "请先安装实时模型";
                _lastError = null;
            }
        }
        catch (Exception ex)
        {
            lock (_stateGate)
            {
                _state = "failed";
                _level = 0;
                _status = "停止失败";
                _lastError = ex.Message;
            }
            throw;
        }
        finally
        {
            await RunOnUiAsync(() =>
            {
                _overlay?.Hide();
                return Task.CompletedTask;
            });
            NotifyChanged();
        }
    }

    internal async Task ApplySettingsAsync(bool preview = false)
    {
        _settings = AppSettings.Load();
        _models = new ModelManager(_settings);

        await RunOnUiAsync(async () =>
        {
            if (_overlay == null || _overlay.IsDisposed)
            {
                if (!preview) return;
                EnsureOverlay();
            }

            _overlay!.ApplySettings(_settings);
            var snapshot = Snapshot;
            if (snapshot.State == "running")
            {
                if (!_overlay.Visible) _overlay.Show();
                await _overlay.SetTextAsync(snapshot.CurrentText, snapshot.PreviousText, ParseKeywords());
            }
            else if (preview)
            {
                await _overlay.PreviewAsync();
            }
        });
    }

    internal void RefreshConfiguration()
    {
        _settings = AppSettings.Load();
        _catalog = new ModelCatalogService().Load();
        _models = new ModelManager(_settings);

        var available = _catalog
            .Where(x => x.LiveCapable && _models.IsInstalled(x))
            .Select(x => new LiveModelOption(x.Id, x.Name))
            .ToArray();

        lock (_stateGate)
        {
            _availableModels = available;
            _sourceId = _settings.AudioSource == AudioSourceMode.PotPlayer ? "potplayer" : "allAudio";

            var selected = available.FirstOrDefault(x =>
                string.Equals(x.Id, _settings.LiveModelId, StringComparison.OrdinalIgnoreCase))
                ?? available.FirstOrDefault();

            if (_state is "idle" or "failed")
            {
                _modelId = selected?.Id ?? "";
                _modelName = selected?.Name ?? "未安装实时模型";
                if (_state == "idle")
                    _status = available.Length > 0 ? "等待开始" : "请先安装实时模型";
            }
        }
        NotifyChanged();
    }

    void OnLevelChanged(float value)
    {
        lock (_stateGate) _level = Math.Clamp(value, 0, 1);
        NotifyChanged();
    }

    void OnStatusChanged(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        lock (_stateGate) _status = text;
        NotifyChanged();
    }

    void OnPartialResult(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        string previous;
        lock (_stateGate)
        {
            if (_state != "running") return;
            _currentText = text;
            _previousText = _lastFinalText;
            previous = _previousText;
        }
        NotifyChanged();
        _ = RunOnUiAsync(async () =>
        {
            EnsureOverlay();
            _overlay!.ApplySettings(_settings);
            if (!_overlay.Visible) _overlay.Show();
            await _overlay.SetTextAsync(text, previous, ParseKeywords());
        });
    }

    void OnFinalResult(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return;
        string previous;
        lock (_stateGate)
        {
            if (_state != "running") return;
            if (!string.Equals(text, _lastFinalText, StringComparison.Ordinal))
            {
                _previousText = _lastFinalText;
                _lastFinalText = text;
            }
            _currentText = text;
            previous = _previousText;
        }
        NotifyChanged();
        _ = RunOnUiAsync(async () =>
        {
            EnsureOverlay();
            _overlay!.ApplySettings(_settings);
            if (!_overlay.Visible) _overlay.Show();
            await _overlay.SetTextAsync(text, previous, ParseKeywords());
        });
    }

    void OnFailed(string error)
    {
        lock (_stateGate)
        {
            _state = "failed";
            _level = 0;
            _status = "实时识别失败";
            _lastError = error;
        }
        _ = RunOnUiAsync(() =>
        {
            _overlayFollowTimer.Stop();
            _overlay?.Hide();
            return Task.CompletedTask;
        });
        NotifyChanged();
    }

    void UpdateStatus(string text)
    {
        lock (_stateGate) _status = text;
        NotifyChanged();
    }

    void NotifyChanged()
    {
        try { Changed?.Invoke(); } catch { }
    }

    void EnsureOverlay()
    {
        if (_overlay != null && !_overlay.IsDisposed) return;
        _overlay = new SubtitleOverlayForm();
        _overlay.ApplySettings(_settings);
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        _overlay.Location = new Point(
            area.Left + (area.Width - _overlay.Width) / 2,
            area.Bottom - _overlay.Height - 40);
    }

    void FollowOverlayToPotPlayer()
    {
        if (_overlay == null || _overlay.IsDisposed) return;
        _overlay.ApplySettings(_settings);

        using var process = PotPlayerWatcher.FindRunning();
        if (process != null && PotPlayerWatcher.TryGetWindowState(process, out var bounds, out var minimized))
        {
            if (minimized)
            {
                _overlay.Hide();
                return;
            }

            _overlay.FollowPlayer(bounds);
            if (Snapshot.State == "running" && !_overlay.Visible) _overlay.Show();
            return;
        }

        if (Snapshot.State == "running" && Snapshot.SourceId == "potplayer")
            _overlay.Hide();
    }

    string[] ParseKeywords()
        => (_settings.Keywords ?? "").Split(
            [',', '，', ';', '；', '\r', '\n'],
            StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    Task RunOnUiAsync(Func<Task> action)
    {
        if (SynchronizationContext.Current == _uiContext)
            return action();

        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _uiContext.Post(async _ =>
        {
            try
            {
                await action();
                completion.TrySetResult(true);
            }
            catch (Exception ex)
            {
                completion.TrySetException(ex);
            }
        }, null);
        return completion.Task;
    }

    static string NormalizeSource(string sourceId)
        => sourceId switch
        {
            "potplayer" => "potplayer",
            "allAudio" => "allAudio",
            _ => throw new InvalidOperationException("不支持的实时音源。")
        };

    static string SourceLabel(string sourceId)
        => sourceId == "allAudio" ? "所有音频" : "PotPlayer";

    void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(LiveSessionController));
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        try { await StopAsync(); } catch { }
        _disposed = true;

        _pipeline.LevelChanged -= OnLevelChanged;
        _pipeline.StatusChanged -= OnStatusChanged;
        _pipeline.PartialResult -= OnPartialResult;
        _pipeline.FinalResult -= OnFinalResult;
        _pipeline.Failed -= OnFailed;
        await _pipeline.DisposeAsync();

        await RunOnUiAsync(() =>
        {
            _overlayFollowTimer.Stop();
            _overlayFollowTimer.Dispose();
            if (_overlay != null && !_overlay.IsDisposed) _overlay.Close();
            return Task.CompletedTask;
        });
    }
}

internal sealed record LiveModelOption(string Id, string Name);

internal sealed record LiveSessionViewState(
    string State,
    string SourceId,
    string Source,
    string ModelId,
    string ModelName,
    IReadOnlyList<LiveModelOption> AvailableModels,
    float Level,
    string Status,
    string CurrentText,
    string PreviousText,
    string? LastError,
    bool CanStart);
