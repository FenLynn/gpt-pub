using System.Text.Json;

namespace LaserBench;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        var selfTest = args.FirstOrDefault(x => x.StartsWith("--self-test=", StringComparison.OrdinalIgnoreCase));
        if (selfTest is not null)
        {
            var reportPath = selfTest[(selfTest.IndexOf('=') + 1)..].Trim('"');
            Environment.ExitCode = RunSelfTest(reportPath);
            return;
        }

        try
        {
            AppPaths.Initialize();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"LaserBench cannot write to its portable root.\n\n{ex.Message}\n\nMove the complete LaserBench folder to a writable location and try again.",
                "LaserBench portable root",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        StartupDiagnostics.Initialize();
        StartupDiagnostics.Stage("portable-root", AppPaths.Root);

        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, eventArgs) =>
        {
            StartupDiagnostics.Crash("WinForms UI thread", eventArgs.Exception);
            MessageBox.Show(
                $"LaserBench encountered a UI error but kept the diagnostic record.\n\n{eventArgs.Exception.Message}\n\nLog: {StartupDiagnostics.CrashLogPath}",
                "LaserBench error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
        {
            if (eventArgs.ExceptionObject is Exception exception)
                StartupDiagnostics.Crash("AppDomain unhandled exception", exception);
        };
        TaskScheduler.UnobservedTaskException += (_, eventArgs) =>
        {
            StartupDiagnostics.Crash("Unobserved task exception", eventArgs.Exception);
            eventArgs.SetObserved();
        };

        var safeMode = args.Any(x => x.Equals("--safe", StringComparison.OrdinalIgnoreCase));

        try
        {
            StartupDiagnostics.Stage("application-configuration", "initializing");
            ApplicationConfiguration.Initialize();
            StartupDiagnostics.Stage("application-configuration");

            var form = new MainForm(safeMode);
            StartupDiagnostics.Stage("main-form-created", safeMode ? "safe mode" : "normal mode");
            Application.Run(form);
            StartupDiagnostics.Stage("message-loop-exit");
        }
        catch (Exception ex)
        {
            StartupDiagnostics.Crash("Fatal startup failure", ex);
            MessageBox.Show(
                $"LaserBench could not complete startup.\n\n{ex.Message}\n\nA diagnostic log was written to:\n{StartupDiagnostics.CrashLogPath}\n\nYou can also try: LaserBench.App.exe --safe",
                "LaserBench startup failed",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static int RunSelfTest(string reportPath)
    {
        var errors = new List<string>();
        var webUiEmbedded = false;
        try
        {
            AppPaths.Initialize();
            var config = new AppConfig
            {
                ConfirmedLabel = "13A",
                CapturePower = true,
                CaptureSpectrum = true,
                CaptureBeam = true,
                CaptureScope = true,
                ScopeTimeSpan = 1.25,
                DashboardPower2 = false
            };
            AppConfigStore.Save(config);
            var persistedConfig = AppConfigStore.Load();
            if (persistedConfig.DashboardPower2) errors.Add("dashboard display preference persistence failed");

            try
            {
                var webUiRoot = WebUiAssets.Extract();
                webUiEmbedded = File.Exists(Path.Combine(webUiRoot, "index.html")) &&
                                Directory.Exists(Path.Combine(webUiRoot, "assets")) &&
                                Directory.EnumerateFiles(Path.Combine(webUiRoot, "assets")).Any();
                if (!webUiEmbedded) errors.Add("webui extraction incomplete");
            }
            catch (Exception ex)
            {
                errors.Add("webui resources missing: " + ex.Message);
            }

            var exp = AppPaths.ResolveExperimentDirectory(config);
            var first = SafeFile.WriteTextAtomicUnique(exp, "120000_power1_13A", ".csv", "x,y\n0,1\n");
            var second = SafeFile.WriteTextAtomicUnique(exp, "120000_power1_13A", ".csv", "x,y\n0,2\n");
            if (!Path.GetFileNameWithoutExtension(second).EndsWith("_1", StringComparison.Ordinal))
                errors.Add("never-overwrite suffix rule failed");

            var provider = new SimulatorProvider();
            var snapshot = provider.Snapshot(config);
            if (snapshot.Power.Count < 2 || snapshot.Spectrum.Count < 100 || snapshot.Beam.Count < 100 || snapshot.ScopeTime.Count < 100)
                errors.Add("simulator payload incomplete");
            if (snapshot.ScopeTime.Count == 0 || Math.Abs(snapshot.ScopeTime[^1].X - config.ScopeTimeSpan) > 0.001)
                errors.Add("scope time-span setting not applied");

            var service = new CaptureService(provider);
            var capture = service.CaptureAsync(config, CancellationToken.None).GetAwaiter().GetResult();
            if (capture.Errors.Count > 0 || capture.Files.Count < 7)
                errors.Add("capture pipeline incomplete");

            var picDirect = string.Equals(Path.GetDirectoryName(Path.Combine(AppPaths.PicDir, "test.png")), AppPaths.PicDir, StringComparison.OrdinalIgnoreCase);
            var videoDirect = string.Equals(Path.GetDirectoryName(Path.Combine(AppPaths.VideoDir, "test.avi")), AppPaths.VideoDir, StringComparison.OrdinalIgnoreCase);
            if (!picDirect || !videoDirect) errors.Add("pic/video directory rule failed");

            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (AppPaths.Root.StartsWith(appData, StringComparison.OrdinalIgnoreCase)) errors.Add("portable root incorrectly uses AppData");

            var report = new
            {
                ok = errors.Count == 0,
                errors,
                version = Application.ProductVersion,
                portableRoot = AppPaths.Root,
                webUiEmbedded,
                directories = new
                {
                    exp = AppPaths.ExpDir,
                    pic = AppPaths.PicDir,
                    video = AppPaths.VideoDir,
                    config = AppPaths.ConfigDir
                },
                neverOverwrite = Path.GetFileNameWithoutExtension(second).EndsWith("_1", StringComparison.Ordinal),
                simulator = snapshot.Power.Count >= 2 && snapshot.Spectrum.Count >= 100,
                captureFiles = capture.Files.Select(Path.GetFileName).ToArray(),
                first = Path.GetFileName(first),
                second = Path.GetFileName(second)
            };

            var directory = Path.GetDirectoryName(Path.GetFullPath(reportPath));
            if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
            return errors.Count == 0 ? 0 : 2;
        }
        catch (Exception ex)
        {
            try
            {
                var directory = Path.GetDirectoryName(Path.GetFullPath(reportPath));
                if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(reportPath, JsonSerializer.Serialize(new { ok = false, error = ex.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
            }
            catch { }
            return 3;
        }
    }
}
