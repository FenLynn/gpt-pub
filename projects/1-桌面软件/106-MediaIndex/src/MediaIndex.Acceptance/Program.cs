using System.Reflection;
using System.Text.Json;

namespace MediaIndex.Acceptance;

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
            var backend = new BackendRunner();
            var ok = backend
                .SelfTestAsync(CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            var report = new
            {
                ok,
                version = Assembly
                    .GetExecutingAssembly()
                    .GetName()
                    .Version?
                    .ToString() ?? string.Empty,
                embeddedWorker = backend.EmbeddedWorkerAvailable,
                extractedWorker = File.Exists(backend.WorkerPath)
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
