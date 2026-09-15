using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MediaIndex.Acceptance;

internal sealed class BackendRunner
{
    private const string WorkerResourceName = "MediaIndex.Acceptance.Worker.exe";

    private readonly string _runtimeDirectory;

    public BackendRunner()
    {
        _runtimeDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FenLynn",
            "MediaIndex",
            "Acceptance",
            "Runtime");
    }

    public string WorkerPath =>
        Path.Combine(_runtimeDirectory, WorkerResourceName);

    public bool EmbeddedWorkerAvailable =>
        Assembly.GetExecutingAssembly()
            .GetManifestResourceNames()
            .Contains(WorkerResourceName, StringComparer.Ordinal);

    public bool IsReady =>
        File.Exists(WorkerPath) || EmbeddedWorkerAvailable;

    public void EnsureWorkerExtracted()
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var resource = assembly.GetManifestResourceStream(WorkerResourceName);

        if (resource is null)
        {
            if (File.Exists(WorkerPath))
            {
                return;
            }

            throw new FileNotFoundException(
                "Embedded acceptance worker is missing.",
                WorkerResourceName);
        }

        Directory.CreateDirectory(_runtimeDirectory);

        var embeddedHash = HashStream(resource);
        resource.Position = 0;

        if (File.Exists(WorkerPath))
        {
            using var existing = File.OpenRead(WorkerPath);
            var existingHash = HashStream(existing);
            if (CryptographicOperations.FixedTimeEquals(
                embeddedHash,
                existingHash))
            {
                return;
            }
        }

        var tempPath = WorkerPath + ".tmp-" + Guid.NewGuid().ToString("N");

        try
        {
            using (var output = new FileStream(
                tempPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None))
            {
                resource.CopyTo(output);
                output.Flush(true);
            }

            File.Move(tempPath, WorkerPath, true);
        }
        finally
        {
            try
            {
                if (File.Exists(tempPath))
                {
                    File.Delete(tempPath);
                }
            }
            catch
            {
            }
        }
    }

    public async Task<bool> SelfTestAsync(CancellationToken cancellationToken)
    {
        EnsureWorkerExtracted();

        var output = new StringBuilder();
        var progress = new Progress<string>(line => output.AppendLine(line));
        var exitCode = await RunWorkerAsync(
            ["selftest"],
            progress,
            cancellationToken);

        return exitCode == 0
            && output.ToString().Contains(
                "\"ok\":true",
                StringComparison.OrdinalIgnoreCase);
    }

    public async Task<int> RunAutoSmokeAsync(
        string imageLibrary,
        string videoLibrary,
        string workDirectory,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        var arguments = new List<string>
        {
            "auto",
            "--workdir", workDirectory,
            "--max-images", "8",
            "--max-videos", "4"
        };

        if (!string.IsNullOrWhiteSpace(imageLibrary))
        {
            arguments.Add("--image-library");
            arguments.Add(imageLibrary);
        }

        if (!string.IsNullOrWhiteSpace(videoLibrary))
        {
            arguments.Add("--video-library");
            arguments.Add(videoLibrary);
        }

        return await RunWorkerAsync(
            arguments,
            progress,
            cancellationToken);
    }

    public async Task<int> RunImageAsync(
        string library,
        string manifest,
        string output,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        return await RunWorkerAsync(
            [
                "image",
                "--library", library,
                "--manifest", manifest,
                "--topk", "50",
                "--output", output
            ],
            progress,
            cancellationToken);
    }

    public async Task<int> RunVideoAsync(
        string library,
        string manifest,
        string output,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        return await RunWorkerAsync(
            [
                "video",
                "--library", library,
                "--manifest", manifest,
                "--interval", "1.0",
                "--output", output
            ],
            progress,
            cancellationToken);
    }

    public async Task<int> RunSummaryAsync(
        string imageResult,
        string videoResult,
        string output,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        return await RunWorkerAsync(
            [
                "summary",
                "--image", imageResult,
                "--video", videoResult,
                "--output", output
            ],
            progress,
            cancellationToken);
    }

    public AcceptanceSummary? ReadSummary(string path)
    {
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(
                File.ReadAllText(path, Encoding.UTF8));
            var root = document.RootElement;

            return new AcceptanceSummary
            {
                Image = root.TryGetProperty("image", out var image)
                    ? image.Clone()
                    : null,
                Video = root.TryGetProperty("video", out var video)
                    ? video.Clone()
                    : null,
                PrivateMediaCommitted =
                    root.TryGetProperty(
                        "private_media_committed",
                        out var committed)
                    && committed.ValueKind == JsonValueKind.True,
                PhaseGate =
                    root.TryGetProperty("phase_gate", out var gate)
                        ? gate.GetString() ?? string.Empty
                        : string.Empty
            };
        }
        catch
        {
            return null;
        }
    }

    private async Task<int> RunWorkerAsync(
        IReadOnlyList<string> arguments,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        EnsureWorkerExtracted();

        var startInfo = new ProcessStartInfo
        {
            FileName = WorkerPath,
            WorkingDirectory = _runtimeDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };

        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        using var process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        process.OutputDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrWhiteSpace(eventArgs.Data))
            {
                progress.Report(eventArgs.Data);
            }
        };
        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (!string.IsNullOrWhiteSpace(eventArgs.Data))
            {
                progress.Report(eventArgs.Data);
            }
        };

        if (!process.Start())
        {
            throw new InvalidOperationException(
                "Could not start acceptance worker.");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await process.WaitForExitAsync(cancellationToken);
        return process.ExitCode;
    }

    private static byte[] HashStream(Stream stream)
    {
        using var sha = SHA256.Create();
        return sha.ComputeHash(stream);
    }
}
