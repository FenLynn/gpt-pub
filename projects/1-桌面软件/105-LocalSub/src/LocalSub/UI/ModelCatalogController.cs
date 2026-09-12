using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.UI;

/// <summary>
/// Shell application layer for model catalog state and user intent. Catalog scanning
/// and default selection stay lightweight in the Shell. Download, extraction, repair
/// and recursive deletion execute through LocalSub.Core.exe.
/// </summary>
internal sealed class ModelCatalogController : IDisposable
{
    readonly object _gate = new();
    readonly CoreWorkerClient _core;

    AppSettings _settings = AppSettings.Load();
    IReadOnlyList<ModelDescriptor> _catalog = [];
    ModelManager _manager;
    CancellationTokenSource? _operationCts;
    ModelOperationViewState _operation = ModelOperationViewState.Idle;
    ModelCatalogViewState _snapshot = new([], 0, 0, "", "", "", "", "模型目录尚未扫描", ModelOperationViewState.Idle);

    internal event Action? Changed;

    internal ModelCatalogController(CoreWorkerClient core)
    {
        _core = core;
        _manager = new ModelManager(_settings);
        Refresh();
    }

    internal ModelCatalogViewState Snapshot
    {
        get
        {
            lock (_gate) return _snapshot;
        }
    }

    internal ModelCatalogViewState Refresh()
    {
        lock (_gate)
        {
            RefreshLocked();
            return _snapshot;
        }
    }

    internal ModelCatalogViewState SelectDefault(string target, string modelId)
    {
        lock (_gate)
        {
            EnsureNoOperationLocked();
            RefreshLocked();

            var model = FindModelLocked(modelId);
            if (IsComponent(model))
                throw new InvalidOperationException("组件不能设为 ASR 默认模型。");
            if (!_manager.IsInstalled(model))
                throw new InvalidOperationException($"模型“{model.Name}”尚未安装。");

            switch (target)
            {
                case "live":
                    if (!model.LiveCapable)
                        throw new InvalidOperationException($"模型“{model.Name}”不支持实时字幕。");
                    _settings.LiveModelId = model.Id;
                    break;

                case "batch":
                    if (!model.BatchCapable)
                        throw new InvalidOperationException($"模型“{model.Name}”不支持后台转写。");
                    _settings.BatchModelId = model.Id;
                    break;

                default:
                    throw new InvalidOperationException("不支持的模型默认用途。");
            }

            _settings.Save();
            RefreshLocked();
            return _snapshot;
        }
    }

    internal Task DownloadAsync(string modelId)
        => RunOperationAsync("download", modelId, (model, progress, ct) => _core.DownloadModelAsync(model.Id, progress, ct));

    internal Task DeleteAsync(string modelId)
        => RunOperationAsync("delete", modelId, (model, progress, ct) => _core.DeleteModelAsync(model.Id, progress, ct));

    internal bool Cancel()
    {
        lock (_gate)
        {
            if (_operationCts == null || _operation.State != "running" || !_operation.CanCancel) return false;
            _operation = _operation with { Stage = "取消中", Detail = "正在请求 LocalSub.Core 停止当前模型任务", CanCancel = false };
            try { _operationCts.Cancel(); } catch { }
            RefreshLocked();
        }
        RaiseChanged();
        return true;
    }

    async Task RunOperationAsync(
        string kind,
        string modelId,
        Func<ModelDescriptor, IProgress<ModelOperationProgress>, CancellationToken, Task> operation)
    {
        ModelDescriptor model;
        CancellationTokenSource cts;
        lock (_gate)
        {
            EnsureNoOperationLocked();
            RefreshLocked();
            model = FindModelLocked(modelId);
            cts = new CancellationTokenSource();
            _operationCts = cts;
            _operation = new(
                "running",
                kind,
                model.Id,
                model.Name,
                kind == "delete" ? "准备删除" : "准备下载",
                0,
                kind == "delete" ? "正在启动 Core 删除任务" : "正在启动 Core 下载任务",
                false,
                null,
                kind == "download");
            RefreshLocked();
        }
        RaiseChanged();

        var progress = new Progress<ModelOperationProgress>(OnProgress);
        try
        {
            await operation(model, progress, cts.Token);
            lock (_gate)
            {
                _operation = _operation with
                {
                    State = "idle",
                    Kind = null,
                    Stage = kind == "delete" ? "已删除" : "已完成",
                    Percent = 100,
                    Detail = kind == "delete" ? $"{model.Name} 已从本地模型目录清理" : $"{model.Name} 已安装并通过关键文件检查",
                    IsIndeterminate = false,
                    LastError = null,
                    CanCancel = false
                };
                RefreshLocked();
            }
        }
        catch (OperationCanceledException)
        {
            lock (_gate)
            {
                _operation = _operation with
                {
                    State = "idle",
                    Kind = null,
                    Stage = "已取消",
                    Percent = null,
                    Detail = "模型任务已取消，重新扫描后可继续操作",
                    IsIndeterminate = false,
                    LastError = null,
                    CanCancel = false
                };
                RefreshLocked();
            }
        }
        catch (Exception ex)
        {
            lock (_gate)
            {
                _operation = _operation with
                {
                    State = "failed",
                    Kind = null,
                    Stage = "失败",
                    Percent = null,
                    Detail = ex.Message.Split('\n')[0],
                    IsIndeterminate = false,
                    LastError = ex.Message,
                    CanCancel = false
                };
                RefreshLocked();
            }
            throw;
        }
        finally
        {
            lock (_gate)
            {
                if (ReferenceEquals(_operationCts, cts)) _operationCts = null;
            }
            cts.Dispose();
            RaiseChanged();
        }
    }

    void OnProgress(ModelOperationProgress progress)
    {
        lock (_gate)
        {
            if (_operation.State != "running") return;
            _operation = _operation with
            {
                Stage = progress.Stage,
                Percent = progress.Percent,
                Detail = string.IsNullOrWhiteSpace(progress.Detail) ? progress.Stage : progress.Detail!,
                IsIndeterminate = progress.IsIndeterminate || !progress.Percent.HasValue
            };
            RefreshLocked();
        }
        RaiseChanged();
    }

    void RefreshLocked()
    {
        _settings = AppSettings.Load();
        _catalog = new ModelCatalogService().Load();
        _manager = new ModelManager(_settings);

        var items = _catalog.Select(model =>
        {
            var component = IsComponent(model);
            var installed = _manager.IsInstalled(model);
            return new ModelCatalogItem(
                model.Id,
                model.Name,
                model.Purpose,
                model.Languages,
                model.SizeText,
                model.RealtimeScore,
                model.AccuracyScore,
                model.ValueScore,
                model.Recommended,
                model.LiveCapable && !component,
                model.BatchCapable && !component,
                component,
                installed,
                !component && string.Equals(model.Id, _settings.LiveModelId, StringComparison.OrdinalIgnoreCase),
                !component && string.Equals(model.Id, _settings.BatchModelId, StringComparison.OrdinalIgnoreCase));
        }).ToArray();

        var liveName = _catalog.FirstOrDefault(x =>
            string.Equals(x.Id, _settings.LiveModelId, StringComparison.OrdinalIgnoreCase))?.Name ?? "未设置";
        var batchName = _catalog.FirstOrDefault(x =>
            string.Equals(x.Id, _settings.BatchModelId, StringComparison.OrdinalIgnoreCase))?.Name ?? "未设置";
        var installedCount = items.Count(x => x.Installed);

        _snapshot = new ModelCatalogViewState(
            items,
            items.Length,
            installedCount,
            _settings.LiveModelId,
            liveName,
            _settings.BatchModelId,
            batchName,
            $"{installedCount} / {items.Length} 已安装",
            _operation);
    }

    ModelDescriptor FindModelLocked(string modelId)
        => _catalog.FirstOrDefault(x => string.Equals(x.Id, modelId, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("模型 catalog 中不存在该模型。");

    void EnsureNoOperationLocked()
    {
        if (_operationCts != null || _operation.State == "running")
            throw new InvalidOperationException("已有模型任务正在执行，请先等待完成或取消。");
    }

    void RaiseChanged()
    {
        try { Changed?.Invoke(); } catch { }
    }

    static bool IsComponent(ModelDescriptor model)
        => string.Equals(model.Id, "silero-vad", StringComparison.OrdinalIgnoreCase);

    public void Dispose()
    {
        lock (_gate)
        {
            try { _operationCts?.Cancel(); } catch { }
            _operationCts?.Dispose();
            _operationCts = null;
        }
    }
}

internal sealed record ModelCatalogItem(
    string Id,
    string Name,
    string Purpose,
    string Languages,
    string SizeText,
    int RealtimeScore,
    int AccuracyScore,
    int ValueScore,
    bool Recommended,
    bool LiveCapable,
    bool BatchCapable,
    bool IsComponent,
    bool Installed,
    bool LiveSelected,
    bool BatchSelected);

internal sealed record ModelOperationViewState(
    string State,
    string? Kind,
    string ModelId,
    string ModelName,
    string Stage,
    int? Percent,
    string Detail,
    bool IsIndeterminate,
    string? LastError,
    bool CanCancel)
{
    internal static ModelOperationViewState Idle { get; } = new(
        "idle", null, "", "", "就绪", null, "模型重任务由 LocalSub.Core 执行", false, null, false);
}

internal sealed record ModelCatalogViewState(
    IReadOnlyList<ModelCatalogItem> Catalog,
    int CatalogCount,
    int InstalledCount,
    string LiveModelId,
    string LiveModelName,
    string BatchModelId,
    string BatchModelName,
    string Status,
    ModelOperationViewState Operation);
