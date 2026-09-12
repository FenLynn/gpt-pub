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

        var launchInBackground = args.Contains("--background", StringComparer.OrdinalIgnoreCase);
        ApplicationConfiguration.Initialize();

        using var singleInstance = SingleInstanceGateV0217.Acquire(signalExisting: !launchInBackground);
        if (!singleInstance.IsPrimary)
        {
            if (!launchInBackground)
            {
                var version = typeof(Program).Assembly.GetName().Version;
                var versionText = version is null ? "当前文件" : $"当前文件 v{version.Major}.{version.Minor}.{version.Build}";
                MessageBox.Show(
                    $"DavBridge 已经在后台运行。\r\n\r\n{versionText} 没有启动为第二个实例，正在运行的 DavBridge 已被唤醒。\r\n\r\n如果你刚刚换用了新的 EXE，请先从系统托盘右键 DavBridge → 退出，再重新启动这个文件。",
                    "DavBridge 已在运行",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            return;
        }

        var fatalPreflight = StartupHealthV044.GetFatalPreflightIssue();
        if (!string.IsNullOrWhiteSpace(fatalPreflight))
        {
            MessageBox.Show(fatalPreflight, "DavBridge 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            using var host = new AppHost();
            var form = new MainForm(host, launchInBackground);
            try
            {
                AppBranding.Apply(form);
                singleInstance.Attach(form);
                using var runtimeSession = RuntimeSessionV046.Attach(host);
                using var resilience = RuntimeResilienceV045.Attach(host);
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

            var recoveryRoot = Path.Combine(paths.LocalRoot, "RecoverySelfTest");
            Directory.CreateDirectory(recoveryRoot);
            var configBackupRecovery = ValidateConfigBackupRecovery(recoveryRoot);
            var stateBackupRecovery = ValidateStateBackupRecovery(recoveryRoot);
            var reconcileBackupRecovery = ValidateReconcileBackupRecovery(recoveryRoot);
            var productSidecarBackupRecovery = ProductExperienceV044.ValidateBackupRecoveryForSelfTest(recoveryRoot);
            var runtimeSessionSelfTest = RuntimeSessionV046.ValidateForSelfTest(paths.LocalRoot, paths.TempRoot);

            using var host = new AppHost();
            host.RequestBackgroundWake();
            host.RequestBackgroundWake();
            using var form = new MainForm(host, launchInBackground: false);
            AppBranding.Apply(form); _ = form.Handle;
            if (form.MinimumSize.Width < 600 || form.MinimumSize.Height < 400) throw new InvalidOperationException("Native host minimum size changed unexpectedly.");
            var windowPlacementSelfTest = WindowPlacementV044.ValidateFourThreeForSelfTest(form);
            var windowFourThreeMigration = windowPlacementSelfTest.Ok;
            WriteReport(reportPath, new {
                product="DavBridge",
                version=typeof(Program).Assembly.GetName().Version?.ToString(),
                roaming=paths.RoamingRoot,
                local=paths.LocalRoot,
                temp=paths.TempRoot,
                nativeHostConstructed=true,
                uiGeneration="v0.4.8-vue3-webview2-sidebar-dashboard",
                webUiEmbedded=true,
                bridgeWhitelistValidated=true,
                coreLogicMovedToJavaScript=false,
                configBackupRecovery,
                stateBackupRecovery,
                reconcileBackupRecovery,
                productSidecarBackupRecovery,
                runtimeSessionSelfTest,
                windowFourThreeMigration,
                windowPlacementSelfTest,
                backgroundWakeSignal=true,
                ok=true
            });
        }
        catch (Exception ex) { TryWriteFailedReport(reportPath, ex); }
    }

    private static bool ValidateConfigBackupRecovery(string root)
    {
        var path = Path.Combine(root, "config.json");
        var store = new ConfigStore(path);
        store.SaveAsync(new DavBridge.Core.DavBridgeConfig { SourceUsername = "backup-config" }).GetAwaiter().GetResult();
        store.SaveAsync(new DavBridge.Core.DavBridgeConfig { SourceUsername = "main-config" }).GetAwaiter().GetResult();
        File.WriteAllText(path, "{broken");
        var recovered = store.LoadAsync().GetAwaiter().GetResult();
        return string.Equals(recovered.SourceUsername, "backup-config", StringComparison.Ordinal);
    }

    private static bool ValidateStateBackupRecovery(string root)
    {
        var path = Path.Combine(root, "state.json");
        var store = new DavBridge.Core.StateStore(path);
        store.SaveAsync(new DavBridge.Core.MigrationState { EngineState = DavBridge.Core.EngineState.WaitNetwork }).GetAwaiter().GetResult();
        store.SaveAsync(new DavBridge.Core.MigrationState { EngineState = DavBridge.Core.EngineState.Complete }).GetAwaiter().GetResult();
        File.WriteAllText(path, "{broken");
        var recovered = store.LoadAsync().GetAwaiter().GetResult();
        return recovered.EngineState == DavBridge.Core.EngineState.WaitNetwork;
    }

    private static bool ValidateReconcileBackupRecovery(string root)
    {
        var store = new ReconciliationStoreV030(root, persistent: true);
        store.SaveAsync(new DavBridge.Core.ReconciliationState { CurrentCycleId = "backup-cycle" }).GetAwaiter().GetResult();
        store.SaveAsync(new DavBridge.Core.ReconciliationState { CurrentCycleId = "main-cycle" }).GetAwaiter().GetResult();
        File.WriteAllText(Path.Combine(root, "reconcile.json"), "{broken");
        return string.Equals(store.Load().CurrentCycleId, "backup-cycle", StringComparison.Ordinal);
    }

    private static void RunUiSelfTest(string reportPath) => RunSelfTest(reportPath);
    private static void WriteReport(string reportPath, object report) => File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    private static void TryWriteFailedReport(string reportPath, Exception ex)
    {
        try { WriteReport(reportPath, new { product="DavBridge", version=typeof(Program).Assembly.GetName().Version?.ToString(), ok=false, error=ex.ToString() }); } catch { }
        Environment.ExitCode = 1;
    }
}
