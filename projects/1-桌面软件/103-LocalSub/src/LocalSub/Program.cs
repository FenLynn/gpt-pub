using LocalSub.Core;
using LocalSub.Services;
using LocalSub.UI;

namespace LocalSub;

internal static class Program
{
    static string CrashLogPath => Path.Combine(AppContext.BaseDirectory, "LocalSub-crash.log");
    static bool IsStartupSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_SMOKE_TEST") == "1";
    static bool IsProcessLoopbackSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_PROCESS_LOOPBACK_SMOKE") == "1";
    static bool IsAnySmokeTest => IsStartupSmokeTest || IsProcessLoopbackSmokeTest;

    [STAThread]
    static void Main()
    {
        try
        {
            ApplicationConfiguration.Initialize();
            PortablePaths.EnsureBaseFolders();

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

            Application.Run(new MainForm());
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
