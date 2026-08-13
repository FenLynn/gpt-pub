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
            using var form = new MainForm(host, args.Contains("--background", StringComparer.OrdinalIgnoreCase));
            AppBranding.Apply(form);
            using var dashboard = UiDashboardV027.Attach(form, host);
            using var visualPolish = UiVisualPolishV029.Attach(dashboard);
            Application.Run(form);
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
                    $"DavBridge 无法完成界面启动。\r\n\r\n{ex.Message}{suffix}",
                    "DavBridge 启动失败",
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
            WriteReport(reportPath, new
            {
                product = "DavBridge",
                version = typeof(Program).Assembly.GetName().Version?.ToString(),
                roaming = paths.RoamingRoot,
                local = paths.LocalRoot,
                temp = paths.TempRoot,
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
            ApplicationConfiguration.Initialize();
            using var host = new AppHost();
            using var form = new MainForm(host, launchInBackground: false);
            AppBranding.Apply(form);
            using var dashboard = UiDashboardV027.Attach(form, host);
            using var visualPolish = UiVisualPolishV029.Attach(dashboard);
            _ = form.Handle;
            form.PerformLayout();
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
