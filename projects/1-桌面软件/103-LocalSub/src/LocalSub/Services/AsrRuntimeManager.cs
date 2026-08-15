using System.IO.Compression;
using LocalSub.Models;

namespace LocalSub.Services;

public sealed class AsrRuntimeManager
{
    public const string Version = "1.13.4";
    const string PackageId = "org.k2fsa.sherpa.onnx.runtime.win-x64";

    readonly AppSettings _settings;

    public AsrRuntimeManager(AppSettings settings) => _settings = settings;

    public string RuntimeRoot => Path.Combine(_settings.ResolvedAsrRoot, "_runtime");
    string VersionFile => Path.Combine(RuntimeRoot, "version.txt");
    string CApiDll => Path.Combine(RuntimeRoot, "sherpa-onnx-c-api.dll");

    public bool IsInstalled()
    {
        try
        {
            return File.Exists(CApiDll) && File.Exists(VersionFile) && File.ReadAllText(VersionFile).Trim() == Version;
        }
        catch { return false; }
    }

    public async Task EnsureAsync(IProgress<ModelOperationProgress>? progress = null, CancellationToken ct = default)
    {
        if (IsInstalled())
        {
            progress?.Report(new("ASR 运行库", 100, Detail: $"已安装 sherpa-onnx {Version}"));
            return;
        }

        Directory.CreateDirectory(_settings.ResolvedAsrRoot);
        var cache = Path.Combine(_settings.ResolvedAsrRoot, "._cache");
        Directory.CreateDirectory(cache);
        var package = Path.Combine(cache, $"{PackageId}.{Version}.nupkg");
        var temp = package + ".part";
        var url = $"https://api.nuget.org/v3-flatcontainer/{PackageId}/{Version}/{PackageId}.{Version}.nupkg";

        Exception? last = null;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                progress?.Report(new("ASR 运行库", 0, Detail: $"下载 sherpa-onnx {Version}，第 {attempt}/3 次"));
                using var client = DownloadClientFactory.Create(_settings);
                using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
                response.EnsureSuccessStatusCode();
                var total = response.Content.Headers.ContentLength;
                await using var input = await response.Content.ReadAsStreamAsync(ct);
                await using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.Read, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    var buffer = new byte[128 * 1024];
                    long done = 0;
                    while (true)
                    {
                        var n = await input.ReadAsync(buffer.AsMemory(), ct);
                        if (n == 0) break;
                        await output.WriteAsync(buffer.AsMemory(0, n), ct);
                        done += n;
                        int? percent = total > 0 ? (int)Math.Clamp(done * 100 / total.Value, 0, 100) : null;
                        progress?.Report(new("ASR 运行库", percent, done, total, Detail: "正在下载 native runtime", IsIndeterminate: !percent.HasValue));
                    }
                    await output.FlushAsync(ct);
                }
                File.Move(temp, package, true);
                last = null;
                break;
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception ex)
            {
                last = ex;
                try { if (File.Exists(temp)) File.Delete(temp); } catch { }
                if (attempt < 3) await Task.Delay(attempt * 1500, ct);
            }
        }
        if (last != null) throw new InvalidOperationException("ASR 运行库下载失败。可在设置中启用 SOCKS5 后重试。", last);

        var staging = RuntimeRoot + ".new";
        try
        {
            if (Directory.Exists(staging)) Directory.Delete(staging, true);
            Directory.CreateDirectory(staging);
            progress?.Report(new("ASR 运行库", null, Detail: "正在安装 native runtime", IsIndeterminate: true));

            using var archive = ZipFile.OpenRead(package);
            const string prefix = "runtimes/win-x64/native/";
            foreach (var entry in archive.Entries)
            {
                ct.ThrowIfCancellationRequested();
                if (!entry.FullName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || string.IsNullOrEmpty(entry.Name)) continue;
                var target = Path.Combine(staging, entry.Name);
                entry.ExtractToFile(target, true);
            }

            if (!File.Exists(Path.Combine(staging, "sherpa-onnx-c-api.dll")))
                throw new InvalidDataException("下载的 sherpa-onnx runtime 包缺少 sherpa-onnx-c-api.dll。 ");

            File.WriteAllText(Path.Combine(staging, "version.txt"), Version);
            if (Directory.Exists(RuntimeRoot)) Directory.Delete(RuntimeRoot, true);
            Directory.Move(staging, RuntimeRoot);
            try { File.Delete(package); } catch { }
            progress?.Report(new("ASR 运行库", 100, Detail: $"sherpa-onnx {Version} 安装完成"));
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }
    }
}
