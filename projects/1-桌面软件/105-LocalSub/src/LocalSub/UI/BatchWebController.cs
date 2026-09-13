using LocalSub.Services;

namespace LocalSub.UI;

/// <summary>
/// Shell application layer for the Web batch workspace.
/// Real file paths remain in the Shell. Heavy media analysis and transcription
/// execute in LocalSub.Core.exe through CoreWorkerClient.
/// </summary>
internal sealed class BatchWebController : IDisposable
{
    readonly object _gate = new();
    readonly CoreWorkerClient _core;
    readonly List<QueueItem> _queue = [];
    readonly Dictionary<string, MediaAnalysisResult> _analysis = new(StringComparer.Ordinal);
    readonly Dictionary<string, BatchTranscriptionResult> _results = new(StringComparer.Ordinal);

    CancellationTokenSource? _operationCts;
    string? _selectedId;
    string _state = "idle";
    string _status = "添加媒体后开始分析";
    string _stage = "待命";
    string _detail = "";
    string? _lastError;
    string? _operationKind;
    int? _percent;

    internal event Action? Changed;

    internal BatchWebController(CoreWorkerClient core) => _core = core;

    internal bool IsBusy
    {
        get { lock (_gate) return _operationCts != null; }
    }

    internal string? LastError
    {
        get { lock (_gate) return _lastError; }
    }

    internal string? OperationKind
    {
        get { lock (_gate) return _operationKind; }
    }

    internal void AddFiles(IEnumerable<string> paths)
    {
        lock (_gate)
        {
            EnsureIdleLocked();
            QueueItem? firstNew = null;
            foreach (var path in paths.Where(File.Exists))
            {
                if (_queue.Any(x => string.Equals(x.Path, path, StringComparison.OrdinalIgnoreCase))) continue;
                var item = new QueueItem(Guid.NewGuid().ToString("N"), path, Path.GetFileName(path), "等待分析");
                _queue.Add(item);
                firstNew ??= item;
            }

            if (firstNew != null) _selectedId = firstNew.Id;
            else if (_selectedId == null && _queue.Count > 0) _selectedId = _queue[0].Id;

            _state = "idle";
            _stage = "待命";
            _percent = null;
            _lastError = null;
            _status = _queue.Count == 0 ? "没有添加媒体" : $"已添加 {_queue.Count} 个媒体文件";
        }
        RaiseChanged();
    }

    internal async Task SelectAndAnalyzeAsync(string? id)
    {
        QueueItem item;
        CancellationTokenSource? cts = null;
        var cached = false;

        lock (_gate)
        {
            EnsureIdleLocked();
            item = SelectLocked(id);
            if (_analysis.ContainsKey(item.Id))
            {
                _state = "idle";
                _stage = "分析完成";
                _detail = item.Name;
                _percent = 100;
                _lastError = null;
                _status = "声音轨道已就绪";
                cached = true;
            }
            else
            {
                cts = BeginOperationLocked("analyze", "analyzing", "正在分析媒体", "准备读取声音轨道");
                item.State = "分析中";
            }
        }

        RaiseChanged();
        if (cached || cts == null) return;

        var progress = new Progress<MediaAnalysisProgress>(p =>
        {
            lock (_gate)
            {
                _percent = Math.Clamp(p.Percent, 0, 100);
                _stage = string.IsNullOrWhiteSpace(p.Stage) ? "分析媒体" : p.Stage;
                _detail = p.Detail ?? "";
                _status = _stage;
            }
            RaiseChanged();
        });

        try
        {
            var result = await _core.AnalyzeAsync(item.Path, progress, cts.Token);
            lock (_gate)
            {
                _analysis[item.Id] = result;
                item.State = _results.ContainsKey(item.Id) ? $"完成 {_results[item.Id].Items.Count} 段" : "波形就绪";
                FinishOperationLocked("声音轨道已就绪", "分析完成", item.Name, 100);
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
            {
                item.State = "等待分析";
                FinishOperationLocked("媒体分析已取消", "已取消", item.Name, null);
            }
        }
        catch (Exception ex)
        {
            lock (_gate)
            {
                item.State = "分析失败";
                FailOperationLocked(ex);
            }
            throw;
        }
        finally
        {
            EndOperation(cts);
            RaiseChanged();
        }
    }

    internal async Task TranscribeAsync(string? id, string modelId, IEnumerable<string> keywords)
    {
        QueueItem item;
        CancellationTokenSource cts;
        lock (_gate)
        {
            EnsureIdleLocked();
            item = SelectLocked(id);
            cts = BeginOperationLocked("transcribe", "transcribing", "正在后台转写", "准备识别");
            item.State = "转写中";
        }
        RaiseChanged();

        var batchProgress = new Progress<BatchTranscriptionProgress>(p =>
        {
            lock (_gate)
            {
                _percent = Math.Clamp(p.Percent, 0, 100);
                _stage = string.IsNullOrWhiteSpace(p.Stage) ? "后台转写" : p.Stage;
                _detail = p.Detail ?? "";
                _status = _stage;
                item.State = p.Percent >= 100 ? "整理结果" : $"转写 {Math.Clamp(p.Percent, 0, 100)}%";
            }
            RaiseChanged();
        });

        var modelProgress = new Progress<ModelOperationProgress>(p =>
        {
            lock (_gate)
            {
                _stage = string.IsNullOrWhiteSpace(p.Stage) ? "准备模型" : p.Stage;
                if (!string.IsNullOrWhiteSpace(p.Detail)) _detail = p.Detail!;
            }
            RaiseChanged();
        });

        try
        {
            var result = await _core.TranscribeAsync(item.Path, modelId, keywords, batchProgress, modelProgress, cts.Token);
            SaveAutomaticJson(result, modelId);
            lock (_gate)
            {
                _results[item.Id] = result;
                item.State = $"完成 {result.Items.Count} 段";
                FinishOperationLocked($"已完成 {result.Items.Count} 段转写", "转写完成", $"RTF {result.RealTimeFactor:0.00}", 100);
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
            {
                item.State = _results.ContainsKey(item.Id) ? $"完成 {_results[item.Id].Items.Count} 段" : "已取消";
                FinishOperationLocked("后台转写已取消", "已取消", item.Name, null);
            }
        }
        catch (Exception ex)
        {
            lock (_gate)
            {
                item.State = "转写失败";
                FailOperationLocked(ex);
            }
            throw;
        }
        finally
        {
            EndOperation(cts);
            RaiseChanged();
        }
    }

    internal bool Cancel()
    {
        lock (_gate)
        {
            if (_operationCts == null) return false;
            _stage = "取消中";
            _detail = "正在请求 LocalSub.Core 停止当前任务";
            _status = "正在取消";
            try { _operationCts.Cancel(); } catch { }
        }
        RaiseChanged();
        return true;
    }

    internal object BuildSnapshot(string modelId, string modelName, string keywords)
    {
        lock (_gate)
        {
            var selected = SelectedLocked();
            _analysis.TryGetValue(selected?.Id ?? "", out var analysis);
            _results.TryGetValue(selected?.Id ?? "", out var result);

            return new
            {
                queued = _queue.Count,
                state = _state,
                status = _status,
                selectedId = selected?.Id ?? "",
                selectedName = selected?.Name ?? "",
                queue = _queue.Select(x => new
                {
                    id = x.Id,
                    name = x.Name,
                    state = x.State,
                    analyzed = _analysis.ContainsKey(x.Id),
                    transcribed = _results.ContainsKey(x.Id)
                }).ToArray(),
                media = analysis == null ? null : new
                {
                    durationMs = (long)Math.Round(analysis.Duration.TotalMilliseconds),
                    analysis.SampleRate,
                    analysis.Channels,
                    decoderName = analysis.DecoderName,
                    waveform = Downsample(analysis.Waveform, 480)
                },
                transcript = result?.Items.Select(x => new
                {
                    startMs = (long)Math.Round(x.Start.TotalMilliseconds),
                    endMs = (long)Math.Round(x.End.TotalMilliseconds),
                    x.Text,
                    keywords = x.Keywords.ToArray()
                }).ToArray() ?? [],
                result = result == null ? null : new
                {
                    durationMs = (long)Math.Round(result.Duration.TotalMilliseconds),
                    processingMs = (long)Math.Round(result.ProcessingTime.TotalMilliseconds),
                    decoderName = result.DecoderName,
                    realTimeFactor = Math.Round(result.RealTimeFactor, 3),
                    segments = result.Items.Count
                },
                progress = new
                {
                    percent = _percent,
                    stage = _stage,
                    detail = _detail
                },
                canAnalyze = selected != null && _operationCts == null,
                canTranscribe = selected != null && _operationCts == null,
                canCancel = _operationCts != null,
                batchModelId = modelId,
                batchModelName = modelName,
                keywords,
                lastError = _lastError
            };
        }
    }

    QueueItem SelectLocked(string? id)
    {
        QueueItem? item = null;
        if (!string.IsNullOrWhiteSpace(id))
            item = _queue.FirstOrDefault(x => string.Equals(x.Id, id, StringComparison.Ordinal));
        item ??= SelectedLocked();
        item ??= _queue.FirstOrDefault();
        if (item == null) throw new InvalidOperationException("请先添加媒体文件。");
        _selectedId = item.Id;
        return item;
    }

    QueueItem? SelectedLocked()
        => _selectedId == null ? null : _queue.FirstOrDefault(x => string.Equals(x.Id, _selectedId, StringComparison.Ordinal));

    CancellationTokenSource BeginOperationLocked(string kind, string state, string status, string detail)
    {
        var cts = new CancellationTokenSource();
        _operationCts = cts;
        _operationKind = kind;
        _state = state;
        _status = status;
        _stage = status;
        _detail = detail;
        _percent = 0;
        _lastError = null;
        return cts;
    }

    void FinishOperationLocked(string status, string stage, string detail, int? percent)
    {
        _state = "idle";
        _status = status;
        _stage = stage;
        _detail = detail;
        _percent = percent;
        _lastError = null;
        _operationKind = null;
    }

    void FailOperationLocked(Exception ex)
    {
        _state = "failed";
        _status = ex.Message.Split('\n')[0];
        _stage = "失败";
        _detail = _status;
        _percent = null;
        _lastError = ex.Message;
        _operationKind = null;
    }

    void EndOperation(CancellationTokenSource cts)
    {
        lock (_gate)
        {
            if (ReferenceEquals(_operationCts, cts)) _operationCts = null;
        }
        cts.Dispose();
    }

    void EnsureIdleLocked()
    {
        if (_operationCts != null)
            throw new InvalidOperationException("已有后台任务正在执行，请先等待完成或取消。");
    }

    void SaveAutomaticJson(BatchTranscriptionResult result, string modelId)
    {
        var dir = Path.Combine(PortablePaths.DataDir, "Transcripts");
        Directory.CreateDirectory(dir);
        var name = Path.GetFileNameWithoutExtension(result.FilePath);
        foreach (var ch in Path.GetInvalidFileNameChars()) name = name.Replace(ch, '_');
        if (string.IsNullOrWhiteSpace(name)) name = "transcript";
        TranscriptPersistenceService.SaveJson(
            Path.Combine(dir, name + ".localsub.json"),
            result.FilePath,
            modelId,
            result.Duration,
            result.ProcessingTime,
            result.Items);
    }

    static float[] Downsample(float[] source, int maxPoints)
    {
        if (source.Length <= maxPoints) return source.ToArray();
        var result = new float[maxPoints];
        var step = source.Length / (double)maxPoints;
        for (var i = 0; i < maxPoints; i++)
        {
            var start = (int)Math.Floor(i * step);
            var end = Math.Min(source.Length, Math.Max(start + 1, (int)Math.Ceiling((i + 1) * step)));
            var best = 0f;
            for (var j = start; j < end; j++)
                if (Math.Abs(source[j]) > Math.Abs(best)) best = source[j];
            result[i] = best;
        }
        return result;
    }

    void RaiseChanged()
    {
        try { Changed?.Invoke(); } catch { }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            try { _operationCts?.Cancel(); } catch { }
            _operationCts?.Dispose();
            _operationCts = null;
        }
    }

    sealed class QueueItem(string id, string path, string name, string state)
    {
        internal string Id { get; } = id;
        internal string Path { get; } = path;
        internal string Name { get; } = name;
        internal string State { get; set; } = state;
    }
}
