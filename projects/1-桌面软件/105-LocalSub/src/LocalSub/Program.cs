using System.Diagnostics;
using LocalSub.Core;
using LocalSub.Services;
using LocalSub.UI;
using NAudio.Wave;

namespace LocalSub;

internal static class Program
{
    static string CrashLogPath => Path.Combine(AppContext.BaseDirectory, "LocalSub-crash.log");
    static string StartupLogPath => Path.Combine(AppContext.BaseDirectory, "Logs", "startup.log");
    static bool IsStartupSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_SMOKE_TEST") == "1";
    static bool IsProcessLoopbackSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_PROCESS_LOOPBACK_SMOKE") == "1";
    static bool IsBatchUiSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_BATCH_UI_SMOKE") == "1";
    static bool IsOfflineAsrSmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_OFFLINE_ASR_SMOKE") == "1";
    static bool IsCoreRecoverySmokeTest => Environment.GetEnvironmentVariable("LOCALSUB_CORE_RECOVERY_SMOKE") == "1";
    static bool IsAnySmokeTest => IsStartupSmokeTest || IsProcessLoopbackSmokeTest || IsBatchUiSmokeTest || IsOfflineAsrSmokeTest || IsCoreRecoverySmokeTest;

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

            if (IsOfflineAsrSmokeTest)
            {
                RunOfflineAsrSmokeTest();
                return;
            }

            if (IsCoreRecoverySmokeTest)
            {
                RunCoreRecoverySmokeTestAsync().GetAwaiter().GetResult();
                return;
            }

            var mainForm = new MainForm();
            LogStartup(startup, "main-form-constructed");
            ModelGridVisualStyler.Attach(mainForm);
            LazyBatchWorkspaceLoader.Attach(mainForm);
            BatchQueueVisualFix.Attach(mainForm);
            SettingsFeatureEnhancer.Attach(mainForm);
            TrayController.Attach(mainForm);
            UiResponsivenessMonitor.Attach(mainForm);
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
        finally
        {
            try { CoreWorkerBroker.ShutdownAsync().AsTask().GetAwaiter().GetResult(); } catch { }
        }
    }

    static void RunProcessLoopbackSmokeTest()
    {
        using var capture = new ProcessLoopbackCaptureService();
        capture.StartAsync((uint)Environment.ProcessId).GetAwaiter().GetResult();
        Thread.Sleep(300);
        capture.StopAsync().GetAwaiter().GetResult();
    }

    static void RunOfflineAsrSmokeTest()
    {
        var model = Environment.GetEnvironmentVariable("LOCALSUB_OFFLINE_ASR_MODEL") ?? "";
        var tokens = Environment.GetEnvironmentVariable("LOCALSUB_OFFLINE_ASR_TOKENS") ?? "";
        var wav = Environment.GetEnvironmentVariable("LOCALSUB_OFFLINE_ASR_WAV") ?? "";
        var runtime = Environment.GetEnvironmentVariable("LOCALSUB_OFFLINE_ASR_RUNTIME") ?? "";
        if (!File.Exists(model) || !File.Exists(tokens) || !File.Exists(wav) || !Directory.Exists(runtime))
            throw new InvalidOperationException("Offline ASR smoke test paths are incomplete.");

        using var wave = new WaveFileReader(wav);
        var provider = wave.ToSampleProvider();
        var samples = new List<float>();
        var buffer = new float[4096];
        while (true)
        {
            var n = provider.Read(buffer, 0, buffer.Length);
            if (n <= 0) break;
            for (var i = 0; i < n; i++) samples.Add(buffer[i]);
        }
        if (samples.Count == 0) throw new InvalidDataException("Offline ASR smoke WAV contains no samples.");

        using var recognizer = NativeOfflineRecognizer.CreateTdnnSmoke(model, tokens, runtime);
        var text = recognizer.Decode(samples.ToArray(), provider.WaveFormat.SampleRate);
        if (string.IsNullOrWhiteSpace(text)) throw new InvalidOperationException("Offline ASR smoke decode returned empty text.");
    }

    static async Task RunCoreRecoverySmokeTestAsync()
    {
        await using var client = new CoreWorkerClient();
        await client.PingAsync();
        var firstPid = client.WorkerProcessId ?? throw new InvalidOperationException("Core recovery smoke test could not resolve the first worker PID.");

        var delayedPing = client.PingWithDelayAsync(5000);
        var waitPending = Stopwatch.StartNew();
        while (client.PendingRequestCount == 0 && waitPending.Elapsed < TimeSpan.FromSeconds(2))
            await Task.Delay(10);
        if (client.PendingRequestCount == 0)
            throw new InvalidOperationException("Core recovery smoke test did not observe an in-flight request.");

        await Task.Delay(150);
        using (var worker = Process.GetProcessById(firstPid))
        {
            worker.Kill(true);
            await worker.WaitForExitAsync();
        }

        var failureObserved = false;
        try
        {
            await delayedPing.WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (Exception ex) when (ex is IOException or InvalidOperationException or OperationCanceledException)
        {
            failureObserved = true;
        }
        if (!failureObserved)
            throw new InvalidOperationException("Core recovery smoke test expected the in-flight request to fail after worker termination.");

        using var restartTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        await client.PingAsync(restartTimeout.Token);
        var secondPid = client.WorkerProcessId ?? throw new InvalidOperationException("Core recovery smoke test could not resolve the restarted worker PID.");
        if (secondPid == firstPid)
            throw new InvalidOperationException("Core recovery smoke test did not start a new worker process.");
        if (client.PendingRequestCount != 0)
            throw new InvalidOperationException("Core recovery smoke test left pending requests after reconnection.");
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
