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

        try
        {
            ApplicationConfiguration.Initialize();
            using var host = new AppHost();
            var form = new MainForm(host, args.Contains("--background", StringComparer.OrdinalIgnoreCase));
            try
            {
                AppBranding.Apply(form);
                using var dashboard = UiDashboardV027.Attach(form, host);
                using var visualPolish = UiVisualPolishV029.Attach(dashboard);
                using var routeOverall = UiRouteOverallV0215.Attach(dashboard);
                using var currentPulse = UiCurrentPulsePolishV0214.Attach(dashboard);
                using var interactionPolish = UiInteractionCleanV0215.Attach(form, dashboard, host);
                using var resetCountdown = UiResetCountdownV0216.Attach(dashboard, host);
                using var messageBar = UiMessageBarV0216.Attach(form, dashboard, host);
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
        using var host = new AppHost();
        using var form = new MainForm(host, launchInBackground: false);
        AppBranding.Apply(form);
        using var dashboard = UiDashboardV027.Attach(form, host);
        using var visualPolish = UiVisualPolishV029.Attach(dashboard);
        using var routeOverall = UiRouteOverallV0215.Attach(dashboard);
        using var currentPulse = UiCurrentPulsePolishV0214.Attach(dashboard);
        using var interactionPolish = UiInteractionCleanV0215.Attach(form, dashboard, host);
        using var resetCountdown = UiResetCountdownV0216.Attach(dashboard, host);
        using var messageBar = UiMessageBarV0216.Attach(form, dashboard, host);
        _ = form.Handle;
        form.PerformLayout();
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
