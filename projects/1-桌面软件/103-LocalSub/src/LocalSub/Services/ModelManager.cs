using LocalSub.Models;
using SharpCompress.Archives;
using SharpCompress.Common;

namespace LocalSub.Services;

public sealed class ModelManager
{
    readonly AppSettings _settings;
    public ModelManager(AppSettings settings) { _settings = settings; Directory.CreateDirectory(_settings.ResolvedAsrRoot); }
    public string GetModelFolder(ModelDescriptor m) => Path.Combine(_settings.ResolvedAsrRoot, m.FolderName);
    public bool IsInstalled(ModelDescriptor m)
    {
        var dir = GetModelFolder(m);
        return Directory.Exists(dir) && m.RequiredFiles.All(f => { var p = Path.Combine(dir, f.Replace('/', Path.DirectorySeparatorChar)); return File.Exists(p) || Directory.Exists(p); });
    }

    public async Task DownloadAsync(ModelDescriptor model, IProgress<int>? progress = null, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_settings.ResolvedAsrRoot);
        var cache = Path.Combine(_settings.ResolvedAsrRoot, "._cache"); Directory.CreateDirectory(cache);
        if (model.Url.EndsWith(".onnx", StringComparison.OrdinalIgnoreCase))
        {
            var finalDir = GetModelFolder(model); Directory.CreateDirectory(finalDir);
            await DownloadFileAsync(model.Url, Path.Combine(finalDir, Path.GetFileName(new Uri(model.Url).LocalPath)), progress, ct); return;
        }
        var archivePath = Path.Combine(cache, Path.GetFileName(new Uri(model.Url).LocalPath));
        await DownloadFileAsync(model.Url, archivePath, progress, ct);
        var staging = Path.Combine(_settings.ResolvedAsrRoot, "._staging", model.Id + "-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(staging);
        try
        {
            using var archive = ArchiveFactory.Open(archivePath);
            foreach (var entry in archive.Entries.Where(e => !e.IsDirectory)) { ct.ThrowIfCancellationRequested(); entry.WriteToDirectory(staging, new ExtractionOptions { ExtractFullPath = true, Overwrite = true }); }
            var extracted = Path.Combine(staging, model.FolderName);
            if (!Directory.Exists(extracted)) { var candidates = Directory.GetDirectories(staging); if (candidates.Length == 1) extracted = candidates[0]; }
            if (!Directory.Exists(extracted)) throw new InvalidDataException("模型压缩包结构与 catalog 不匹配。");
            var finalDir = GetModelFolder(model); if (Directory.Exists(finalDir)) Directory.Delete(finalDir, true); Directory.Move(extracted, finalDir);
            if (!IsInstalled(model)) throw new InvalidDataException("模型解压完成，但关键文件不完整。");
        }
        finally { try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { } }
    }

    async Task DownloadFileAsync(string url, string target, IProgress<int>? progress, CancellationToken ct)
    {
        using var client = DownloadClientFactory.Create(_settings);
        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct); response.EnsureSuccessStatusCode();
        var total = response.Content.Headers.ContentLength; var temp = target + ".part";
        await using var input = await response.Content.ReadAsStreamAsync(ct);
        await using var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 128, true);
        var buffer = new byte[1024 * 128]; long readTotal = 0;
        while (true) { var n = await input.ReadAsync(buffer, ct); if (n == 0) break; await output.WriteAsync(buffer.AsMemory(0, n), ct); readTotal += n; if (total > 0) progress?.Report((int)Math.Clamp(readTotal * 100 / total.Value, 0, 100)); }
        await output.FlushAsync(ct); if (File.Exists(target)) File.Delete(target); File.Move(temp, target); progress?.Report(100);
    }

    public void Delete(ModelDescriptor model) { var dir = GetModelFolder(model); if (Directory.Exists(dir)) Directory.Delete(dir, true); }
}
