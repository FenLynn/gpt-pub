using System.Text.Json;

namespace DavBridge;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var selfTest = GetArgumentPath(args, "--self-test=");
        if (selfTest is not null)
        {
            RunSelfTest(selfTest);
            return;
        }

        var uiSelfTest = GetArgumentPath(args, "--ui-self-test=");
        if (uiSelfTest is not null)
        {
            RunUiSelfTest(uiSelfTest);
            return;
        }

        using var singleInstance = SingleInstanceGateV0217.Acquire();
        if (!singleInstance.IsPrimary) return;

        try
        {
            ApplicationConfiguration.Initialize();
            using var host = new AppHost();
            var form = new MainForm(host, args.Contains("--background", StringComparer.OrdinalIgnoreCase));
            try
            {
                AppBranding.Apply(form);
                singleInstance.Attach(form);
                using var reconciliation = ReconciliationRuntimeV030.Attach(host);
                using var shell = UiShellV032.Attach(form, host, reconciliation);
                using var density = UiDensityV033.Attach(shell);
                Application.Run(form);
            }
            finally
            {
                if (!form.IsDisposed)
                    form.Dispose();
            }
        }
        catch (Exception ex)
        {
            var logPath = StartupDiagnosticsV0210.TryWrite(ex);
            try
            {
                var suffix = string.IsNullOrWhiteSpace(logPath)
                    ? string.Empty
                    : $"\r\n\r\n诊断日志：{logPath}";
                MessageBox.Show(
                    $"DavBridge 在启动、运行或退出过程中发生异常。\r\n\r\n{ex.Message}{suffix}",
                    "DavBridge 异常",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch { }
            Environment.ExitCode = 1;
        }
    }

    private static string? GetArgumentPath(string[] args, string prefix)
    {
        var argument = args.FirstOrDefault(x => x.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        return argument is null ? null : argument[prefix.Length..].Trim('"');
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
            ConstructUiForStartupTest();
            WriteReport(reportPath, new
            {
                product = "DavBridge",
                version = typeof(Program).Assembly.GetName().Version?.ToString(),
                roaming = paths.RoamingRoot,
                local = paths.LocalRoot,
                temp = paths.TempRoot,
                uiConstructed = true,
                uiGeneration = "v0.3.3-inline-density",
                layoutScenarios = 5,
                defaultScrollbarExpected = false,
                routeLogosExpected = true,
                docsTabExpected = true,
                inlineMeterTextExpected = true,
                compactStageStripExpected = true,
                densityLayerConstructed = true,
                ok = true
            });
        }
        catch (Exception ex)
        {
            TryWriteFailedReport(reportPath, ex);
        }
    }

    private static void RunUiSelfTest(string reportPath)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(reportPath)!);
            ConstructUiForStartupTest();
            WriteReport(reportPath, new
            {
                product = "DavBridge",
                version = typeof(Program).Assembly.GetName().Version?.ToString(),
                uiConstructed = true,
                uiGeneration = "v0.3.3-inline-density",
                layoutScenarios = 5,
                defaultScrollbarExpected = false,
                routeLogosExpected = true,
                docsTabExpected = true,
                inlineMeterTextExpected = true,
                compactStageStripExpected = true,
                densityLayerConstructed = true,
                ok = true
            });
        }
        catch (Exception ex)
        {
            TryWriteFailedReport(reportPath, ex);
        }
    }

    private static void ConstructUiForStartupTest()
    {
        ApplicationConfiguration.Initialize();
        var scenarios = new (string Name, int Width, int Height, float Scale)[]
        {
            ("compact-100", 700, 520, 1.00f),
            ("default-100", 900, 620, 1.00f),
            ("large-100", 1200, 760, 1.00f),
            ("default-125", 900, 620, 1.25f),
            ("default-150", 900, 620, 1.50f)
        };

        foreach (var scenario in scenarios)
            ConstructUiScenario(scenario.Name, scenario.Width, scenario.Height, scenario.Scale);
    }

    private static void ConstructUiScenario(string name, int width, int height, float scale)
    {
        using var host = new AppHost();
        using var form = new MainForm(host, launchInBackground: false);
        AppBranding.Apply(form);
        using var reconciliation = ReconciliationRuntimeV030.Attach(host, persistent: false);
        using var shell = UiShellV032.Attach(form, host, reconciliation);
        using var density = UiDensityV033.Attach(shell);

        _ = form.Handle;
        if (Math.Abs(scale - 1f) > 0.001f)
            form.Scale(new SizeF(scale, scale));
        form.ClientSize = new Size((int)Math.Round(width * scale), (int)Math.Round(height * scale));
        form.PerformLayout();
        if (!name.StartsWith("compact", StringComparison.OrdinalIgnoreCase))
            shell.ValidateLayout(name);

        using var settings = new SettingsDialog(host.Config, string.Empty, string.Empty);
        _ = settings.Handle;
        if (Math.Abs(scale - 1f) > 0.001f)
            settings.Scale(new SizeF(scale, scale));
        settings.ClientSize = new Size((int)Math.Round(800 * scale), (int)Math.Round(580 * scale));
        settings.PerformLayout();
        UiLayoutSelfTestV0217.ValidateSettings(settings, name);
    }

    private static void WriteReport(string reportPath, object report) =>
        File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));

    private static void TryWriteFailedReport(string reportPath, Exception ex)
    {
        try
        {
            WriteReport(reportPath, new
            {
                product = "DavBridge",
                version = typeof(Program).Assembly.GetName().Version?.ToString(),
                ok = false,
                error = ex.ToString()
            });
        }
        catch { }
        Environment.ExitCode = 1;
    }
}
