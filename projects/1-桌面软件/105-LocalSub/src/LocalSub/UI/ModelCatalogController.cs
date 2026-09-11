using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.UI;

/// <summary>
/// Shell application layer for model catalog state and lightweight default selection.
/// It may inspect local model presence and persist settings, but model download,
/// extraction, verification and large directory replacement belong to LocalSub.Core.
/// </summary>
internal sealed class ModelCatalogController
{
    readonly object _gate = new();

    AppSettings _settings = AppSettings.Load();
    IReadOnlyList<ModelDescriptor> _catalog = [];
    ModelManager _manager;
    ModelCatalogViewState _snapshot = new([], 0, 0, "", "", "", "", "模型目录尚未扫描");

    internal ModelCatalogController()
    {
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
            RefreshLocked();

            var model = _catalog.FirstOrDefault(x =>
                string.Equals(x.Id, modelId, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException("模型 catalog 中不存在该模型。");

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
            $"{installedCount} / {items.Length} 已安装");
    }

    static bool IsComponent(ModelDescriptor model)
        => string.Equals(model.Id, "silero-vad", StringComparison.OrdinalIgnoreCase);
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

internal sealed record ModelCatalogViewState(
    IReadOnlyList<ModelCatalogItem> Catalog,
    int CatalogCount,
    int InstalledCount,
    string LiveModelId,
    string LiveModelName,
    string BatchModelId,
    string BatchModelName,
    string Status);
