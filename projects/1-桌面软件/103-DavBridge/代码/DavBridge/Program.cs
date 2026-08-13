using System.Text.Json;

namespace DavBridge;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var selfTest = args.FirstOrDefault(x => x.StartsWith("--self-test=", StringComparison.OrdinalIgnoreCase));
        if (selfTest is not null)
        {
            var path = selfTest[(selfTest.IndexOf('=') + 1)..].Trim('"');
            RunSelfTest(path);
            return;
        }

        ApplicationConfiguration.Initialize();
        using var host = new AppHost();
        using var form = new MainForm(host, args.Contains("--background", StringComparer.OrdinalIgnoreCase));
        AppBranding.Apply(form);
        using var dashboard = UiDashboardV026.Attach(form, host);
        Application.Run(form);
    }

    private static void RunSelfTest(string reportPath)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(reportPath)!);
            var paths = AppPaths.Create();
            Directory.CreateDirectory(paths.RoamingRoot);
            Directory.CreateDirectory(paths.LocalRoot);
            Directory.CreateDirectory(paths.TempRoot);
            var report = new
            {
                product = "DavBridge",
                version = typeof(Program).Assembly.GetName().Version?.ToString(),
                roaming = paths.RoamingRoot,
                local = paths.LocalRoot,
                temp = paths.TempRoot,
                ok = true
            };
            File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            try
            {
                File.WriteAllText(reportPath, JsonSerializer.Serialize(new { product = "DavBridge", ok = false, error = ex.ToString() }));
            }
            catch { }
            Environment.ExitCode = 1;
        }
    }
}
