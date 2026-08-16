using System.IO.Compression;
using LocalSub.Core;
using LocalSub.Models;

namespace LocalSub.Services;

public sealed record ComponentDownloadProgress(int Percent, long BytesDone, long? TotalBytes, double BytesPerSecond, string Stage);

public sealed class FfmpegManager
{
    const string DownloadUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
    readonly AppSettings _settings;

    public FfmpegManager(AppSettings settings) => _settings = settings;

    public string Root => Path.Combine(PortablePaths.BaseDir, "Components", "FFmpeg");
    public string BinDir => Path.Combine(Root, "bin");
    public string FfmpegPath => Path.Combine(BinDir, "ffmpeg.exe");
    public string FfprobePath => Path.Combine(BinDir, "ffprobe.exe");
    public bool IsInstalled => File.Exists(FfmpegPath) && File.Exists(FfprobePath);

    public async Task EnsureAsync(IProgress<ComponentDownloadProgress>? progress = null, CancellationToken ct = default)
    {
        if (IsInstalled) return;
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(BinDir);
        var cacheDir = Path.Combine(PortablePaths.BaseDir, "Components", "._cache");
        Directory.CreateDirectory(cacheDir);
        var archive = Path.Combine(cacheDir, "ffmpeg-release-essentials.zip");
        await DownloadAsync(archive, progress, ct);

        progress?.Report(new(100, new FileInfo(archive).Length, new FileInfo(archive).Length, 0, "解压 FFmpeg"));
        var staging = Path.Combine(Root, ".staging");
        if (Directory.Exists(staging)) Directory.Delete(staging, true);
        Directory.CreateDirectory(staging);

        try
        {
            using var zip = ZipFile.OpenRead(archive);
            foreach (var entry in zip.Entries)
            {
                ct.ThrowIfCancellationRequested();
                var name = entry.FullName.Replace('\\', '/');
                if (!name.EndsWith("/bin/ffmpeg.exe", StringComparison.OrdinalIgnoreCase) &&
                    !name.EndsWith("/bin/ffprobe.exe", StringComparison.OrdinalIgnoreCase)) continue;
                var target = Path.Combine(staging, Path.GetFileName(name));
                entry.ExtractToFile(target, true);
            }

            var stagedFfmpeg = Path.Combine(staging, "ffmpeg.exe");
            var stagedFfprobe = Path.Combine(staging, "ffprobe.exe");
            if (!File.Exists(stagedFfmpeg) || !File.Exists(stagedFfprobe))
                throw new InvalidDataException("FFmpeg 压缩包中未找到 ffmpeg.exe / ffprobe.exe。");

            Directory.CreateDirectory(BinDir);
            File.Move(stagedFfmpeg, FfmpegPath, true);
            File.Move(stagedFfprobe, FfprobePath, true);
            File.WriteAllText(Path.Combine(Root, "source.txt"), DownloadUrl + Environment.NewLine);
            progress?.Report(new(100, 0, null, 0, "FFmpeg 已安装"));
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }
    }

    public void Delete()
    {
        if (Directory.Exists(Root)) Directory.Delete(Root, true);
    }

    async Task DownloadAsync(string target, IProgress<ComponentDownloadProgress>? progress, CancellationToken ct)
    {
        var part = target + ".part";
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var existing = File.Exists(part) ? new FileInfo(part).Length : 0;
                using var client = DownloadClientFactory.Create(_settings, TimeSpan.FromSeconds(60));
                using var request = new HttpRequestMessage(HttpMethod.Get, DownloadUrl);
                if (existing > 0) request.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(existing, null);
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
                if (existing > 0 && response.StatusCode == System.Net.HttpStatusCode.OK)
                {
                    File.Delete(part);
                    existing = 0;
                }
                response.EnsureSuccessStatusCode();

                var total = response.Content.Headers.ContentLength.HasValue ? existing + response.Content.Headers.ContentLength.Value : null;
                await using var src = await response.Content.ReadAsStreamAsync(ct);
                await using var dst = new FileStream(part, existing > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None, 1024 * 128, true);
                var buffer = new byte[1024 * 128];
                var done = existing;
                var sw = System.Diagnostics.Stopwatch.StartNew();
                var lastBytes = done;
                var lastAt = sw.Elapsed;
                while (true)
                {
                    var read = await src.ReadAsync(buffer, ct);
                    if (read <= 0) break;
                    await dst.WriteAsync(buffer.AsMemory(0, read), ct);
                    done += read;
                    var now = sw.Elapsed;
                    if ((now - lastAt).TotalMilliseconds >= 350)
                    {
                        var speed = (done - lastBytes) / Math.Max(0.001, (now - lastAt).TotalSeconds);
                        var percent = total.HasValue && total.Value > 0 ? (int)Math.Clamp(done * 100 / total.Value, 0, 99) : 0;
                        progress?.Report(new(percent, done, total, speed, attempt == 1 ? "下载 FFmpeg" : $"下载 FFmpeg，第 {attempt} 次尝试"));
                        lastBytes = done;
                        lastAt = now;
                    }
                }
                await dst.FlushAsync(ct);
                File.Move(part, target, true);
                progress?.Report(new(100, done, total, 0, "FFmpeg 下载完成"));
                return;
            }
            catch when (attempt < 3 && !ct.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(attempt * 2), ct);
            }
        }
    }
}
