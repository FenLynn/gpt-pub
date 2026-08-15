using System.Net;
using System.Net.Http.Headers;
using LocalSub.Models;
using SharpCompress.Common;
using SharpCompress.Readers;

namespace LocalSub.Services;

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

    public async Task DownloadAsync(ModelDescriptor model, IProgress<int>? progress = null, CancellationToken ct = default)
    {
        Directory.CreateDirectory(_settings.ResolvedAsrRoot);
        var cache = Path.Combine(_settings.ResolvedAsrRoot, "._cache");
        Directory.CreateDirectory(cache);

        if (model.Url.EndsWith(".onnx", StringComparison.OrdinalIgnoreCase))
        {
            var finalDir = GetModelFolder(model);
            Directory.CreateDirectory(finalDir);
            var target = Path.Combine(finalDir, Path.GetFileName(new Uri(model.Url).LocalPath));
            await DownloadFileAsync(model.Url, target, progress, ct);
            if (!IsInstalled(model)) throw new InvalidDataException("模型下载完成，但关键文件不完整。");
            return;
        }

        var archiveName = Path.GetFileName(new Uri(model.Url).LocalPath);
        var archivePath = Path.Combine(cache, archiveName);

        var canReuseCache = File.Exists(archivePath) && new FileInfo(archivePath).Length > 0;
        if (canReuseCache && archivePath.EndsWith(".bz2", StringComparison.OrdinalIgnoreCase))
            canReuseCache = LooksLikeBZip2(archivePath);

        if (!canReuseCache)
        {
            try { if (File.Exists(archivePath)) File.Delete(archivePath); } catch { }
            await DownloadFileAsync(model.Url, archivePath, progress, ct);
        }
        else
        {
            progress?.Report(100);
        }

        if (archivePath.EndsWith(".bz2", StringComparison.OrdinalIgnoreCase) && !LooksLikeBZip2(archivePath))
        {
            try { File.Delete(archivePath); } catch { }
            throw new InvalidDataException("模型缓存不是有效的 .tar.bz2，已删除，请重新点击下载/修复。");
        }

        var staging = Path.Combine(_settings.ResolvedAsrRoot, "._staging", model.Id + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
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
                if (!reader.Entry.IsDirectory)
                    reader.WriteEntryToDirectory(staging, options);
            }

            var extracted = Path.Combine(staging, model.FolderName);
            if (!Directory.Exists(extracted))
            {
                var candidates = Directory.GetDirectories(staging);
                if (candidates.Length == 1) extracted = candidates[0];
            }
            if (!Directory.Exists(extracted)) throw new InvalidDataException("模型压缩包结构与 catalog 不匹配。");

            var finalDir = GetModelFolder(model);
            if (Directory.Exists(finalDir)) Directory.Delete(finalDir, true);
            Directory.Move(extracted, finalDir);
            if (!IsInstalled(model)) throw new InvalidDataException("模型解压完成，但关键文件不完整。");

            try { File.Delete(archivePath); } catch { }
            progress?.Report(100);
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }
    }

    async Task DownloadFileAsync(string url, string target, IProgress<int>? progress, CancellationToken ct)
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
                using var client = DownloadClientFactory.Create(_settings);
                using var request = new HttpRequestMessage(HttpMethod.Get, url);
                if (existing > 0)
                    request.Headers.Range = new RangeHeaderValue(existing, null);

                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);

                if (response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
                {
                    try { File.Delete(temp); } catch { }
                    existing = 0;
                    if (attempt < 3) continue;
                }

                response.EnsureSuccessStatusCode();

                var resumed = existing > 0 && response.StatusCode == HttpStatusCode.PartialContent;
                if (existing > 0 && !resumed)
                {
                    try { File.Delete(temp); } catch { }
                    existing = 0;
                }

                var contentLength = response.Content.Headers.ContentLength;
                var total = contentLength.HasValue ? existing + contentLength.Value : (long?)null;

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
                        if (total > 0)
                            progress?.Report((int)Math.Clamp(readTotal * 100 / total.Value, 0, 100));
                    }
                    await output.FlushAsync(ct);
                }

                if (total.HasValue && new FileInfo(temp).Length < total.Value)
                    throw new IOException($"模型文件下载不完整：{new FileInfo(temp).Length} / {total.Value} bytes");

                if (File.Exists(target)) File.Delete(target);
                File.Move(temp, target);
                progress?.Report(100);
                return;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (TaskCanceledException ex)
            {
                lastError = new TimeoutException(BuildNetworkHint("连接模型服务器超时", url), ex);
            }
            catch (HttpRequestException ex)
            {
                lastError = new HttpRequestException(BuildNetworkHint("模型服务器连接失败", url) + $"\n\n{ex.Message}", ex);
            }
            catch (IOException ex)
            {
                lastError = new IOException($"模型下载中断，第 {attempt}/3 次尝试失败。已保留 .part 文件用于断点续传。\n\n{ex.Message}", ex);
            }

            if (attempt < 3)
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2), ct);
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

        return $"{title}。\n当前模式：{proxy}\n下载源：{new Uri(url).Host}\nGitHub Release 会继续跳转到 release-assets.githubusercontent.com。若当前网络访问 GitHub 大文件受限，请在“设置 → 下载代理”选择 SOCKS5，并填写例如 socks5://127.0.0.1:7890 后保存。";
    }

    public void Delete(ModelDescriptor model)
    {
        var dir = GetModelFolder(model);
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
    }
}
