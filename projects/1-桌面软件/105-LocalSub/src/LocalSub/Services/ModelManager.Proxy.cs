using LocalSub.Models;

namespace LocalSub.Services;

public sealed record ModelOperationProgress(
    string Stage,
    int? Percent = null,
    long BytesDone = 0,
    long? TotalBytes = null,
    double BytesPerSecond = 0,
    string? Detail = null,
    bool IsIndeterminate = false);

/// <summary>
/// Shell-side model proxy. Lightweight catalog and installed-file checks remain in
/// LocalSub.exe, while network download, archive extraction, verification, directory
/// replacement and recursive delete are executed by LocalSub.Core.exe.
/// </summary>
public sealed class ModelManager
{
    readonly AppSettings _settings;

    public ModelManager(AppSettings settings)
    {
        _settings = settings;
        Directory.CreateDirectory(_settings.ResolvedAsrRoot);
    }

    public string GetModelFolder(ModelDescriptor model)
        => Path.Combine(_settings.ResolvedAsrRoot, model.FolderName);

    public bool IsInstalled(ModelDescriptor model)
    {
        var dir = GetModelFolder(model);
        return Directory.Exists(dir) && model.RequiredFiles.All(file =>
        {
            var path = Path.Combine(dir, file.Replace('/', Path.DirectorySeparatorChar));
            return File.Exists(path) || Directory.Exists(path);
        });
    }

    public Task DownloadAsync(
        ModelDescriptor model,
        IProgress<ModelOperationProgress>? progress = null,
        CancellationToken ct = default)
    {
        if (!CoreWorkerBroker.IsAvailable)
            throw new FileNotFoundException(
                "LocalSub.Core.exe 不存在，模型下载已按新架构要求禁用进程内回退。",
                Path.Combine(AppContext.BaseDirectory, "LocalSub.Core.exe"));

        return CoreWorkerBroker.Shared.DownloadModelAsync(model.Id, progress, ct);
    }

    public Task DeleteAsync(
        ModelDescriptor model,
        IProgress<ModelOperationProgress>? progress = null,
        CancellationToken ct = default)
    {
        if (!CoreWorkerBroker.IsAvailable)
            throw new FileNotFoundException(
                "LocalSub.Core.exe 不存在，模型删除已按新架构要求禁用进程内回退。",
                Path.Combine(AppContext.BaseDirectory, "LocalSub.Core.exe"));

        return CoreWorkerBroker.Shared.DeleteModelAsync(model.Id, progress, ct);
    }
}
