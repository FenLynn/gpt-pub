using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace MediaIndex.App;

internal sealed class CoreRunner
{
    private const string WorkerResourceName = "MediaIndex.Worker.exe";
    private readonly string _runtimeDirectory;

    public CoreRunner()
    {
        _runtimeDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FenLynn",
            "MediaIndex",
            "Runtime");
    }

    public string WorkerPath =>
        Path.Combine(_runtimeDirectory, WorkerResourceName);

    public bool EmbeddedWorkerAvailable =>
        Assembly.GetExecutingAssembly()
            .GetManifestResourceNames()
            .Contains(WorkerResourceName, StringComparer.Ordinal);

    public void EnsureWorkerExtracted()
    {
        var assembly = Assembly.GetExecutingAssembly();
        using var resource = assembly.GetManifestResourceStream(
            WorkerResourceName);

        if (resource is null)
        {
            if (File.Exists(WorkerPath))
            {
                return;
            }

            throw new FileNotFoundException(
                "Embedded MediaIndex worker is missing.",
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

    public async Task<bool> SelfTestAsync(
        CancellationToken cancellationToken)
    {
        var output = new StringBuilder();
        var progress = new Progress<string>(
            line => output.AppendLine(line));

        var exit = await RunAsync(
            ["selftest"],
            progress,
            cancellationToken);

        return exit == 0
            && output.ToString().Contains(
                "\"ok\":true",
                StringComparison.OrdinalIgnoreCase);
    }

    public Task<int> BuildIndexAsync(
        string library,
        string indexDir,
        string output,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        var binding = StorageIdentity.Resolve(library);

        return RunAsync(
            [
                "build-index",
                "--library", library,
                "--index-dir", indexDir,
                "--output", output,
                "--storage-id", binding.StorageId,
                "--storage-root", binding.StorageRoot,
                "--library-relative", binding.LibraryRelativePath
            ],
            progress,
            cancellationToken);
    }

    public Task<int> QueryImageAsync(
        string indexDir,
        string query,
        string output,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        return RunAsync(
            [
                "query-image",
                "--index-dir", indexDir,
                "--query", query,
                "--output", output,
                "--topk", "50",
                "--verify-k", "8"
            ],
            progress,
            cancellationToken);
    }

    public Task<int> RunAutoValidationAsync(
        string imageLibrary,
        string workDirectory,
        IProgress<string> progress,
        CancellationToken cancellationToken)
    {
        return RunAsync(
            [
                "auto",
                "--image-library", imageLibrary,
                "--workdir", workDirectory,
                "--max-images", "8",
                "--max-videos", "1"
            ],
            progress,
            cancellationToken);
    }

    private async Task<int> RunAsync(
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

        process.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data))
            {
                progress.Report(e.Data);
            }
        };
        process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data))
            {
                progress.Report(e.Data);
            }
        };

        if (!process.Start())
        {
            throw new InvalidOperationException(
                "Could not start MediaIndex worker.");
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
