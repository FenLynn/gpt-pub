using System.Reflection;
using System.Text.Json;

namespace MediaIndex.App;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var selfTest = args.FirstOrDefault(
            arg => arg.StartsWith(
                "--self-test=",
                StringComparison.OrdinalIgnoreCase));

        if (selfTest is not null)
        {
            return RunSelfTest(
                selfTest["--self-test=".Length..]);
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
        return 0;
    }

    private static int RunSelfTest(string reportPath)
    {
        try
        {
            var core = new CoreRunner();
            var workerOk = core
                .SelfTestAsync(CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            var binding = StorageIdentity.Resolve(
                Path.GetTempPath());

            var storageIdentityOk =
                !string.IsNullOrWhiteSpace(
                    binding.StorageId)
                && !string.IsNullOrWhiteSpace(
                    binding.IndexId);

            var ok = workerOk && storageIdentityOk;

            var report = new
            {
                ok,
                version = Assembly
                    .GetExecutingAssembly()
                    .GetName()
                    .Version?
                    .ToString() ?? string.Empty,
                embeddedWorker = core.EmbeddedWorkerAvailable,
                extractedWorker = File.Exists(core.WorkerPath),
                storageIdentity = binding.StorageId,
                storageIndexId = binding.IndexId,
                storageIdentityOk
            };

            var fullPath = Path.GetFullPath(reportPath);
            Directory.CreateDirectory(
                Path.GetDirectoryName(fullPath)!);
            File.WriteAllText(
                fullPath,
                JsonSerializer.Serialize(
                    report,
                    new JsonSerializerOptions
                    {
                        WriteIndented = true
                    }));

            return ok ? 0 : 2;
        }
        catch (Exception exception)
        {
            try
            {
                var fullPath = Path.GetFullPath(reportPath);
                Directory.CreateDirectory(
                    Path.GetDirectoryName(fullPath)!);
                File.WriteAllText(
                    fullPath,
                    JsonSerializer.Serialize(
                        new
                        {
                            ok = false,
                            error = exception.ToString()
                        },
                        new JsonSerializerOptions
                        {
                            WriteIndented = true
                        }));
            }
            catch
            {
            }

            return 1;
        }
    }
}
