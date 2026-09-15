using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace MediaIndex.Acceptance;

internal sealed class BackendRunner
{
    private readonly string _appDirectory;

    public BackendRunner()
    {
        _appDirectory = AppContext.BaseDirectory;
    }

    public string WorkerPath =>
        Path.Combine(_appDirectory, "Runtime", "MediaIndex.Acceptance.Worker.exe");

    public bool IsReady => File.Exists(WorkerPath);

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
            using var document = JsonDocument.Parse(File.ReadAllText(path, Encoding.UTF8));
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
                    root.TryGetProperty("private_media_committed", out var committed)
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
        if (!IsReady)
        {
            throw new FileNotFoundException(
                "Acceptance worker is missing.",
                WorkerPath);
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = WorkerPath,
            WorkingDirectory = _appDirectory,
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
            throw new InvalidOperationException("Could not start acceptance worker.");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await process.WaitForExitAsync(cancellationToken);
        return process.ExitCode;
    }
}
