using System.Diagnostics;
using LocalSub.Core;
using LocalSub.Services;
using LocalSub.UI;

namespace LocalSub;

internal static class Program
{
    static string CrashLogPath => Path.Combine(AppContext.BaseDirectory, "LocalSub-crash.log");
    static string StartupLogPath => Path.Combine(AppContext.BaseDirectory, "Logs", "startup.log");
    static bool IsStartupSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_SMOKE_TEST") == "1";
    static bool IsProcessLoopbackSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_PROCESS_LOOPBACK_SMOKE") == "1";
    static bool IsBatchUiSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_BATCH_UI_SMOKE") == "1";
    static bool IsAnySmokeTest => IsStartupSmokeTest || IsProcessLoopbackSmokeTest || IsBatchUiSmokeTest;

    [STAThread]
    static void Main()
    {
        var startup = Stopwatch.StartNew();
        try
        {
            ApplicationConfiguration.Initialize();
            PortablePaths.EnsureBaseFolders();
            LogStartup(startup, "runtime-init");

            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, e) => ReportCrash("UI thread exception", e.Exception);
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            {
                if (e.ExceptionObject is Exception ex) ReportCrash("Unhandled exception", ex, showDialog: false);
            };

            if (IsProcessLoopbackSmokeTest)
            {
                RunProcessLoopbackSmokeTest();
                return;
            }

            var mainForm = new MainForm();
            LogStartup(startup, "main-form-constructed");
            ModelGridVisualStyler.Attach(mainForm);
            LazyBatchWorkspaceLoader.Attach(mainForm);
            BatchQueueVisualFix.Attach(mainForm);
            SettingsFeatureEnhancer.Attach(mainForm);
            TrayController.Attach(mainForm);
            LogStartup(startup, "lightweight-enhancers-attached");

            if (IsBatchUiSmokeTest)
            {
                mainForm.Shown += (_, _) =>
                {
                    var tabs = mainForm.Controls.OfType<TabControl>().FirstOrDefault();
                    var batch = tabs?.TabPages.Cast<TabPage>().FirstOrDefault(x => x.Text == "后台转写");
                    if (tabs != null && batch != null) tabs.SelectedTab = batch;
                };
            }

            mainForm.Shown += (_, _) => LogStartup(startup, "window-shown", final: true);
            Application.Run(mainForm);
        }
        catch (Exception ex)
        {
            ReportCrash("Startup exception", ex);
            Environment.ExitCode = 1;
        }
    }

    static void RunProcessLoopbackSmokeTest()
    {
        using var capture = new ProcessLoopbackCaptureService();
        capture.StartAsync((uint)Environment.ProcessId).GetAwaiter().GetResult();
        Thread.Sleep(300);
        capture.StopAsync().GetAwaiter().GetResult();
    }

    static void LogStartup(Stopwatch sw, string stage, bool final = false)
    {
        if (IsAnySmokeTest && !final) return;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StartupLogPath)!);
            var prefix = stage == "runtime-init" ? Environment.NewLine + $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] " : "";
            File.AppendAllText(StartupLogPath, $"{prefix}{stage}={sw.ElapsedMilliseconds}ms{(final ? Environment.NewLine : " | ")}");
        }
        catch { }
    }

    static void ReportCrash(string stage, Exception ex, bool showDialog = true)
    {
        var text = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {stage}{Environment.NewLine}{ex}{Environment.NewLine}{new string('=', 72)}{Environment.NewLine}";
        try { File.AppendAllText(CrashLogPath, text); } catch { }

        if (showDialog && !IsAnySmokeTest)
        {
            try
            {
                MessageBox.Show(
                    $"LocalSub 启动或运行时发生错误。\n\n{ex.Message}\n\n详细信息已写入：\n{CrashLogPath}",
                    "LocalSub 错误",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
            catch { }
        }
    }
}
