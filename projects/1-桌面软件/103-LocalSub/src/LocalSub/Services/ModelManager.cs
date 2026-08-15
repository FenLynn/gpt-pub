using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using LocalSub.Models;
using SharpCompress.Common;
using SharpCompress.Readers;

namespace LocalSub.Services;

public sealed record ModelOperationProgress(
    string Stage,
    int? Percent = null,
    long BytesDone = 0,
    long? TotalBytes = null,
    double BytesPerSecond = 0,
    string? Detail = null,
    bool IsIndeterminate = false);

public sealed class ModelManager
{
    readonly AppSettings _settings;

    public ModelManager(AppSettings settings)
    {
        _settings = settings;
        Directory.CreateDirectory(_settings.ResolvedAsrRoot);
    }

    public string GetModelFolder(ModelDescriptor m) => Path.Combine(_settings.ResolvedAsrRoot, m.FolderName);

    public bool IsInstalled(ModelDescriptor m)
    {
        var dir = GetModelFolder(m);
        return Directory.Exists(dir) && m.RequiredFiles.All(f =>
        {
            var p = Path.Combine(dir, f.Replace('/', Path.DirectorySeparatorChar));
            return File.Exists(p) || Directory.Exists(p);
        });
    }

    public async Task DownloadAsync(ModelDescriptor model, IProgress<ModelOperationProgress>? progress = null, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_settings.ResolvedAsrRoot);
        var cache = Path.Combine(_settings.ResolvedAsrRoot, "._cache");
        Directory.CreateDirectory(cache);
        progress?.Report(new("准备", 0, Detail: $"准备 {model.Name}"));

        if (model.Files.Length > 0)
        {
            var finalDir = GetModelFolder(model);
            Directory.CreateDirectory(finalDir);
            for (var i = 0; i < model.Files.Length; i++)
            {
                ct.ThrowIfCancellationRequested();
                var file = model.Files[i];
                if (string.IsNullOrWhiteSpace(file.FileName) || string.IsNullOrWhiteSpace(file.Url))
                    throw new InvalidDataException($"模型 {model.Name} 的第 {i + 1} 个下载文件配置无效。");

                progress?.Report(new("下载", i * 100 / model.Files.Length, Detail: $"文件 {i + 1}/{model.Files.Length}：{file.FileName}"));
                var target = Path.Combine(finalDir, file.FileName.Replace('/', Path.DirectorySeparatorChar));
                var parent = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                var fileProgress = progress == null ? null : new AggregateFileProgress(progress, i, model.Files.Length, file.FileName);
                await DownloadFileAsync(file.Url, target, fileProgress, ct);
            }

            progress?.Report(new("校验", 100, Detail: "检查模型关键文件"));
            if (!IsInstalled(model)) throw new InvalidDataException("模型下载完成，但关键文件不完整。");
            progress?.Report(new("完成", 100, Detail: $"已安装到 {finalDir}"));
            return;
        }

        if (model.Url.EndsWith(".onnx", StringComparison.OrdinalIgnoreCase))
        {
            var finalDir = GetModelFolder(model);
            Directory.CreateDirectory(finalDir);
            var target = Path.Combine(finalDir, Path.GetFileName(new Uri(model.Url).LocalPath));
            await DownloadFileAsync(model.Url, target, progress, ct);
            progress?.Report(new("校验", 100, Detail: "检查模型关键文件"));
            if (!IsInstalled(model)) throw new InvalidDataException("模型下载完成，但关键文件不完整。");
            progress?.Report(new("完成", 100, Detail: $"已安装到 {finalDir}"));
            return;
        }

        if (string.IsNullOrWhiteSpace(model.Url))
            throw new InvalidDataException($"模型 {model.Name} 没有可用下载地址。");

        var archiveName = Path.GetFileName(new Uri(model.Url).LocalPath);
        var archivePath = Path.Combine(cache, archiveName);
        var canReuseCache = File.Exists(archivePath) && new FileInfo(archivePath).Length > 0;
        if (canReuseCache && archivePath.EndsWith(".bz2", StringComparison.OrdinalIgnoreCase))
            canReuseCache = LooksLikeBZip2(archivePath);

        if (canReuseCache)
        {
            var size = new FileInfo(archivePath).Length;
            progress?.Report(new("使用缓存", 100, size, size, Detail: $"复用已下载缓存：{archiveName}"));
        }
        else
        {
            TryDeleteFile(archivePath);
            await DownloadFileAsync(model.Url, archivePath, progress, ct);
        }

        if (archivePath.EndsWith(".bz2", StringComparison.OrdinalIgnoreCase) && !LooksLikeBZip2(archivePath))
        {
            TryDeleteFile(archivePath);
            throw new InvalidDataException("模型缓存不是有效的 .tar.bz2，已自动删除，请重新下载。");
        }

        var stagingRoot = Path.Combine(_settings.ResolvedAsrRoot, "._staging");
        var staging = Path.Combine(stagingRoot, model.Id + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        try
        {
            progress?.Report(new("解压", null, Detail: archiveName, IsIndeterminate: true));
            try
            {
                using var stream = File.OpenRead(archivePath);
                using var reader = ReaderFactory.OpenReader(stream);
                var options = new ExtractionOptions
                {
                    ExtractFullPath = true,
                    Overwrite = true,
                    CheckCrc = true,
                    BufferSize = 1024 * 256
                };

                while (reader.MoveToNextEntry())
                {
                    ct.ThrowIfCancellationRequested();
                    if (reader.Entry.IsDirectory) continue;
                    progress?.Report(new("解压", null, Detail: reader.Entry.Key, IsIndeterminate: true));
                    reader.WriteEntryToDirectory(staging, options);
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex) when (ex is InvalidDataException || ex is InvalidFormatException)
            {
                TryDeleteFile(archivePath);
                throw new InvalidDataException("模型压缩包损坏或格式无效，已删除缓存。再次点击下载/修复会重新下载。", ex);
            }

            var extracted = Path.Combine(staging, model.FolderName);
            if (!Directory.Exists(extracted))
            {
                var candidates = Directory.GetDirectories(staging);
                if (candidates.Length == 1) extracted = candidates[0];
            }
            if (!Directory.Exists(extracted)) throw new InvalidDataException("模型压缩包结构与 catalog 不匹配。");

            progress?.Report(new("安装", null, Detail: "移动模型文件到 ASR 目录", IsIndeterminate: true));
            var finalDir = GetModelFolder(model);
            if (Directory.Exists(finalDir)) Directory.Delete(finalDir, true);
            Directory.Move(extracted, finalDir);

            progress?.Report(new("校验", 100, Detail: "检查模型关键文件"));
            if (!IsInstalled(model)) throw new InvalidDataException("模型解压完成，但关键文件不完整。");

            TryDeleteFile(archivePath);
            progress?.Report(new("完成", 100, Detail: $"已安装到 {finalDir}"));
        }
        finally
        {
            TryDeleteDirectory(staging);
        }
    }

    async Task DownloadFileAsync(string url, string target, IProgress<ModelOperationProgress>? progress, CancellationToken ct)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temp = target + ".part";
        Exception? lastError = null;

        for (var attempt = 1; attempt <= 3; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var existing = File.Exists(temp) ? new FileInfo(temp).Length : 0L;
                progress?.Report(new("连接", 0, existing, null, 0, $"连接模型服务器，第 {attempt}/3 次"));

                using var client = DownloadClientFactory.Create(_settings);
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                if (existing > 0) request.Headers.Range = new RangeHeaderValue(existing, null);

                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
                if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
                {
                    TryDeleteFile(temp);
                    if (attempt < 3) continue;
                    throw new HttpRequestException("服务器拒绝断点续传，请重新开始下载。", null, response.StatusCode);
                }

                response.EnsureSuccessStatusCode();
                var resumed = existing > 0 && response.StatusCode == HttpStatusCode.PartialContent;
                if (existing > 0 && !resumed)
                {
                    TryDeleteFile(temp);
                    existing = 0;
                }

                var contentLength = response.Content.Headers.ContentLength;
                var total = contentLength.HasValue ? existing + contentLength.Value : (long?)null;
                var finalHost = response.RequestMessage?.RequestUri?.Host ?? new Uri(url).Host;
                int? initialPercent = total > 0 ? (int)Math.Clamp(existing * 100 / total.Value, 0, 100) : null;
                progress?.Report(new("下载", initialPercent, existing, total, 0, $"已连接 {finalHost}"));

                var watch = Stopwatch.StartNew();
                var lastReport = TimeSpan.Zero;
                await using var input = await response.Content.ReadAsStreamAsync(ct);
                await using (var output = new FileStream(
                    temp,
                    resumed ? FileMode.Append : FileMode.Create,
                    FileAccess.Write,
                    FileShare.Read,
                    1024 * 256,
                    FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    var buffer = new byte[1024 * 256];
                    var readTotal = existing;
                    while (true)
                    {
                        var n = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), ct);
                        if (n == 0) break;
                        await output.WriteAsync(buffer.AsMemory(0, n), ct);
                        readTotal += n;

                        if (watch.Elapsed - lastReport >= TimeSpan.FromMilliseconds(250))
                        {
                            var speed = watch.Elapsed.TotalSeconds > 0 ? (readTotal - existing) / watch.Elapsed.TotalSeconds : 0;
                            int? percent = total > 0 ? (int)Math.Clamp(readTotal * 100 / total.Value, 0, 100) : null;
                            progress?.Report(new("下载", percent, readTotal, total, speed, resumed ? "断点续传中" : "下载中"));
                            lastReport = watch.Elapsed;
                        }
                    }
                    await output.FlushAsync(ct);
                    var finalSpeed = watch.Elapsed.TotalSeconds > 0 ? (readTotal - existing) / watch.Elapsed.TotalSeconds : 0;
                    progress?.Report(new("下载", 100, readTotal, total ?? readTotal, finalSpeed, "下载完成"));
                }

                if (total.HasValue && new FileInfo(temp).Length < total.Value)
                    throw new IOException($"模型文件下载不完整：{new FileInfo(temp).Length} / {total.Value} bytes");

                File.Move(temp, target, true);
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (TaskCanceledException ex)
            {
                lastError = new TimeoutException(BuildNetworkHint("连接模型服务器超时", url), ex);
                progress?.Report(new("重试", null, Detail: $"连接超时，第 {attempt}/3 次", IsIndeterminate: true));
            }
            catch (HttpRequestException ex)
            {
                lastError = new HttpRequestException(BuildNetworkHint("模型服务器连接失败", url) + $"\n\n{ex.Message}", ex);
                progress?.Report(new("重试", null, Detail: $"网络失败，第 {attempt}/3 次：{ex.Message}", IsIndeterminate: true));
            }
            catch (IOException ex)
            {
                lastError = new IOException($"模型下载中断，第 {attempt}/3 次尝试失败。已保留 .part 文件用于断点续传。\n\n{ex.Message}", ex);
                progress?.Report(new("重试", null, Detail: $"下载中断，第 {attempt}/3 次：{ex.Message}", IsIndeterminate: true));
            }

            if (attempt < 3) await Task.Delay(TimeSpan.FromSeconds(attempt * 2), ct);
        }

        throw lastError ?? new IOException("模型下载失败。");
    }

    static bool LooksLikeBZip2(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            Span<byte> header = stackalloc byte[3];
            if (stream.Read(header) != 3) return false;
            return header[0] == (byte)'B' && header[1] == (byte)'Z' && header[2] == (byte)'h';
        }
        catch { return false; }
    }

    string BuildNetworkHint(string title, string url)
    {
        var proxy = _settings.ProxyMode switch
        {
            ProxyMode.Socks5 => $"SOCKS5：{_settings.Socks5Url}",
            ProxyMode.Direct => "直连",
            _ => "系统代理"
        };

        return $"{title}。\n当前模式：{proxy}\n下载源：{new Uri(url).Host}\n若当前网络访问该模型源受限，请在“设置 → 下载代理”选择 SOCKS5 后重试。";
    }

    public void Delete(ModelDescriptor model)
    {
        TryDeleteDirectory(GetModelFolder(model));

        if (!string.IsNullOrWhiteSpace(model.Url))
        {
            var archiveName = Path.GetFileName(new Uri(model.Url).LocalPath);
            var cache = Path.Combine(_settings.ResolvedAsrRoot, "._cache");
            TryDeleteFile(Path.Combine(cache, archiveName));
            TryDeleteFile(Path.Combine(cache, archiveName + ".part"));
        }

        var stagingRoot = Path.Combine(_settings.ResolvedAsrRoot, "._staging");
        if (Directory.Exists(stagingRoot))
        {
            foreach (var dir in Directory.GetDirectories(stagingRoot, model.Id + "-*"))
                TryDeleteDirectory(dir);
        }
    }

    sealed class AggregateFileProgress : IProgress<ModelOperationProgress>
    {
        readonly IProgress<ModelOperationProgress> _outer;
        readonly int _index;
        readonly int _count;
        readonly string _fileName;

        public AggregateFileProgress(IProgress<ModelOperationProgress> outer, int index, int count, string fileName)
        {
            _outer = outer;
            _index = index;
            _count = Math.Max(1, count);
            _fileName = fileName;
        }

        public void Report(ModelOperationProgress value)
        {
            int? overall = value.Percent.HasValue
                ? Math.Clamp((_index * 100 + value.Percent.Value) / _count, 0, 100)
                : null;
            var detail = string.IsNullOrWhiteSpace(value.Detail) ? _fileName : $"{_fileName}：{value.Detail}";
            _outer.Report(value with { Percent = overall, Detail = detail });
        }
    }

    static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { }
    }
}
