using System.IO.Compression;
using System.Net;
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
    public string ManagedBinDir => Path.Combine(Root, "bin");
    public string ManagedFfmpegPath => Path.Combine(ManagedBinDir, "ffmpeg.exe");
    public string ManagedFfprobePath => Path.Combine(ManagedBinDir, "ffprobe.exe");

    public bool IsInstalled => TryResolveActivePair(out _, out _, out _);
    public string FfmpegPath => TryResolveActivePair(out var ffmpeg, out _, out _) ? ffmpeg : ManagedFfmpegPath;
    public string FfprobePath => TryResolveActivePair(out _, out var ffprobe, out _) ? ffprobe : ManagedFfprobePath;
    public string BinDir => Path.GetDirectoryName(FfmpegPath) ?? ManagedBinDir;
    public string SourceName => TryResolveActivePair(out _, out _, out var source) ? source : "未找到";

    public async Task EnsureAsync(IProgress<ComponentDownloadProgress>? progress = null, CancellationToken ct = default)
    {
        if (IsInstalled) return;
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(ManagedBinDir);
        var cacheDir = Path.Combine(PortablePaths.BaseDir, "Components", "._cache");
        Directory.CreateDirectory(cacheDir);
        var archive = Path.Combine(cacheDir, "ffmpeg-release-essentials.zip");
        try
        {
            await DownloadAsync(archive, progress, ct);
        }
        catch
        {
            progress?.Report(new(0, 0, null, 0, "FFmpeg 下载失败"));
            throw;
        }

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

            Directory.CreateDirectory(ManagedBinDir);
            File.Move(stagedFfmpeg, ManagedFfmpegPath, true);
            File.Move(stagedFfprobe, ManagedFfprobePath, true);
            File.WriteAllText(Path.Combine(Root, "source.txt"), DownloadUrl + Environment.NewLine);
            progress?.Report(new(100, 0, null, 0, "FFmpeg 已安装"));
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }
    }

    public void DeleteManaged()
    {
        if (Directory.Exists(Root)) Directory.Delete(Root, true);
    }

    public static bool ValidatePair(string path, out string ffmpegPath, out string ffprobePath)
    {
        ffmpegPath = string.Empty;
        ffprobePath = string.Empty;
        if (string.IsNullOrWhiteSpace(path)) return false;
        try
        {
            var candidate = path.Trim().Trim('"');
            if (!Path.IsPathRooted(candidate)) candidate = Path.Combine(PortablePaths.BaseDir, candidate);
            candidate = Path.GetFullPath(candidate);
            if (Directory.Exists(candidate)) candidate = Path.Combine(candidate, "ffmpeg.exe");
            if (!File.Exists(candidate) || new FileInfo(candidate).Length <= 0) return false;
            var dir = Path.GetDirectoryName(candidate);
            if (string.IsNullOrWhiteSpace(dir)) return false;
            var probe = Path.Combine(dir, "ffprobe.exe");
            if (!File.Exists(probe) || new FileInfo(probe).Length <= 0) return false;
            ffmpegPath = candidate;
            ffprobePath = probe;
            return true;
        }
        catch { return false; }
    }

    bool TryResolveActivePair(out string ffmpeg, out string ffprobe, out string source)
    {
        if (ValidatePair(_settings.FfmpegPath, out ffmpeg, out ffprobe))
        {
            source = "手动指定";
            return true;
        }
        if (ValidatePair(ManagedFfmpegPath, out ffmpeg, out ffprobe))
        {
            source = "LocalSub 组件";
            return true;
        }

        var mediovaRuntime = Environment.GetEnvironmentVariable("MEDIOVA_RUNTIME_DIR");
        if (!string.IsNullOrWhiteSpace(mediovaRuntime))
        {
            var candidate = Path.Combine(mediovaRuntime, "Components", "FFmpeg", "bin", "ffmpeg.exe");
            if (ValidatePair(candidate, out ffmpeg, out ffprobe))
            {
                source = "Mediova";
                return true;
            }
        }

        foreach (var candidate in NearbyMediovaCandidates())
        {
            if (ValidatePair(candidate, out ffmpeg, out ffprobe))
            {
                source = "Mediova";
                return true;
            }
        }

        var pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var dir in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (ValidatePair(Path.Combine(dir.Trim('"'), "ffmpeg.exe"), out ffmpeg, out ffprobe))
            {
                source = "系统 PATH";
                return true;
            }
        }

        ffmpeg = string.Empty;
        ffprobe = string.Empty;
        source = "未找到";
        return false;
    }

    static IEnumerable<string> NearbyMediovaCandidates()
    {
        var roots = new List<string>();
        var parent = Directory.GetParent(PortablePaths.BaseDir)?.FullName;
        if (!string.IsNullOrWhiteSpace(parent)) roots.Add(parent);
        var grand = !string.IsNullOrWhiteSpace(parent) ? Directory.GetParent(parent)?.FullName : null;
        if (!string.IsNullOrWhiteSpace(grand)) roots.Add(grand);

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var direct = new[]
            {
                Path.Combine(root, "Mediova", "Components", "FFmpeg", "bin", "ffmpeg.exe"),
                Path.Combine(root, "101-Mediova", "Components", "FFmpeg", "bin", "ffmpeg.exe")
            };
            foreach (var candidate in direct)
                if (seen.Add(candidate)) yield return candidate;

            try
            {
                var count = 0;
                foreach (var dir in Directory.EnumerateDirectories(root))
                {
                    if (++count > 80) break;
                    var name = Path.GetFileName(dir);
                    if (!name.Contains("Mediova", StringComparison.OrdinalIgnoreCase)) continue;
                    var candidate = Path.Combine(dir, "Components", "FFmpeg", "bin", "ffmpeg.exe");
                    if (seen.Add(candidate)) yield return candidate;
                }
            }
            catch { }
        }
    }

    async Task DownloadAsync(string target, IProgress<ComponentDownloadProgress>? progress, CancellationToken ct)
    {
        if (File.Exists(target))
        {
            if (IsUsableArchive(target))
            {
                var size = new FileInfo(target).Length;
                progress?.Report(new(100, size, size, 0, "复用已下载 FFmpeg 压缩包"));
                return;
            }
            try { File.Delete(target); } catch { }
        }

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

                if (existing > 0 && response.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable)
                {
                    if (IsUsableArchive(part))
                    {
                        File.Move(part, target, true);
                        var completed = new FileInfo(target).Length;
                        progress?.Report(new(100, completed, completed, 0, "FFmpeg 缓存已完整，直接复用"));
                        return;
                    }
                    try { File.Delete(part); } catch { }
                    if (attempt < 3) continue;
                    throw new InvalidDataException("FFmpeg 断点缓存与服务器文件不一致，已清理缓存，请重试。");
                }

                if (existing > 0 && response.StatusCode == HttpStatusCode.OK)
                {
                    File.Delete(part);
                    existing = 0;
                }
                response.EnsureSuccessStatusCode();

                long? total = response.Content.Headers.ContentLength.HasValue ? existing + response.Content.Headers.ContentLength.Value : null;
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

                if (!IsUsableArchive(part))
                    throw new InvalidDataException("FFmpeg 下载完成但 ZIP 校验失败，将自动重新下载。");

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

    static bool IsUsableArchive(string path)
    {
        if (!File.Exists(path) || new FileInfo(path).Length <= 0) return false;
        try
        {
            using var zip = ZipFile.OpenRead(path);
            var hasFfmpeg = false;
            var hasFfprobe = false;
            foreach (var entry in zip.Entries)
            {
                var name = entry.FullName.Replace('\\', '/');
                if (name.EndsWith("/bin/ffmpeg.exe", StringComparison.OrdinalIgnoreCase)) hasFfmpeg = true;
                if (name.EndsWith("/bin/ffprobe.exe", StringComparison.OrdinalIgnoreCase)) hasFfprobe = true;
                if (hasFfmpeg && hasFfprobe) return true;
            }
            return false;
        }
        catch { return false; }
    }
}
