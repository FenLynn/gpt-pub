using System.Text.Json;

namespace DavBridge;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var selfTest = GetArgumentPath(args, "--self-test=");
        if (selfTest is not null) { RunSelfTest(selfTest); return; }
        var uiSelfTest = GetArgumentPath(args, "--ui-self-test=");
        if (uiSelfTest is not null) { RunUiSelfTest(uiSelfTest); return; }

        using var singleInstance = SingleInstanceGateV0217.Acquire();
        if (!singleInstance.IsPrimary) return;
        try
        {
            ApplicationConfiguration.Initialize();
            using var host = new AppHost();
            var launchInBackground = args.Contains("--background", StringComparer.OrdinalIgnoreCase);
            var form = new MainForm(host, launchInBackground);
            try
            {
                AppBranding.Apply(form);
                singleInstance.Attach(form);
                using var reconciliation = ReconciliationRuntimeV030.Attach(host);
                using var webUi = WebUiHostV040.Attach(form, host, reconciliation);
                using var homeController = WindowHomeControllerV040.Attach(form, host, webUi, launchInBackground);
                Application.Run(form);
            }
            finally { if (!form.IsDisposed) form.Dispose(); }
        }
        catch (Exception ex)
        {
            var logPath = StartupDiagnosticsV0210.TryWrite(ex);
            try
            {
                var suffix = string.IsNullOrWhiteSpace(logPath) ? string.Empty : $"\r\n\r\n诊断日志：{logPath}";
                MessageBox.Show($"DavBridge 在启动、运行或退出过程中发生异常。\r\n\r\n{ex.Message}{suffix}", "DavBridge 异常", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
            Directory.CreateDirectory(paths.RoamingRoot); Directory.CreateDirectory(paths.LocalRoot); Directory.CreateDirectory(paths.TempRoot);
            WebUiAssetsV040.ValidateEmbeddedResources();
            WebUiHostV040.ValidateBridgeContract();
            ApplicationConfiguration.Initialize();
            using var host = new AppHost();
            using var form = new MainForm(host, launchInBackground: false);
            AppBranding.Apply(form); _ = form.Handle;
            if (form.MinimumSize.Width < 600 || form.MinimumSize.Height < 400) throw new InvalidOperationException("Native host minimum size changed unexpectedly.");
            WriteReport(reportPath, new { product="DavBridge", version=typeof(Program).Assembly.GetName().Version?.ToString(), roaming=paths.RoamingRoot, local=paths.LocalRoot, temp=paths.TempRoot, nativeHostConstructed=true, uiGeneration="v0.4.0-vue3-webview2-csharp-core", webUiEmbedded=true, bridgeWhitelistValidated=true, coreLogicMovedToJavaScript=false, ok=true });
        }
        catch (Exception ex) { TryWriteFailedReport(reportPath, ex); }
    }

    private static void RunUiSelfTest(string reportPath) => RunSelfTest(reportPath);
    private static void WriteReport(string reportPath, object report) => File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    private static void TryWriteFailedReport(string reportPath, Exception ex)
    {
        try { WriteReport(reportPath, new { product="DavBridge", version=typeof(Program).Assembly.GetName().Version?.ToString(), ok=false, error=ex.ToString() }); } catch { }
        Environment.ExitCode = 1;
    }
}
