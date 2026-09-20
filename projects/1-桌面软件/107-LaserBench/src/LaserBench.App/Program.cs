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
                DashboardPower2 = false,
                PowerAverageSamples = 8,
                PowerScale = 1.25,
                OsaResolution = 0.1,
                OsaSensitivity = "HIGH1",
                OsaSamplePoints = 2001,
                OsaVideoBandwidthHz = 10000,
                OsaTraceMode = "MAXHOLD",
                OsaSmoothingPoints = 5,
                OsaWavelengthOffsetNm = 0.125,
                OsaWavelengthReference = "VACUUM",
                OsaAutoPeakSearch = false,
                OsaPeakThresholdDb = 6.5,
                BeamWidthMethod = "FWHM",
                ScopeVoltsDiv = 0.5,
                ScopeTriggerSource = "CH2",
                SpectrumInterfaceEnabled = true,
                SpectrumInterfaceEndpoint = "TCPIP0::192.0.2.10::inst0::INSTR",
                ScopeInterfaceEnabled = true,
                ScopeInterfaceEndpoint = "TCPIP0::192.0.2.20::inst0::INSTR"
            };
            AppConfigStore.Save(config);
            var persistedConfig = AppConfigStore.Load();
            if (persistedConfig.DashboardPower2) errors.Add("dashboard display preference persistence failed");
            if (persistedConfig.PowerAverageSamples != 8 || Math.Abs(persistedConfig.PowerScale - 1.25) > 1e-9)
                errors.Add("power workstation preference persistence failed");
            if (Math.Abs(persistedConfig.OsaResolution - 0.1) > 1e-9 || persistedConfig.OsaSensitivity != "HIGH1" ||
                persistedConfig.OsaSamplePoints != 2001 || Math.Abs(persistedConfig.OsaVideoBandwidthHz - 10000) > 1e-9 ||
                persistedConfig.OsaTraceMode != "MAXHOLD" || persistedConfig.OsaSmoothingPoints != 5 ||
                Math.Abs(persistedConfig.OsaWavelengthOffsetNm - 0.125) > 1e-9 || persistedConfig.OsaWavelengthReference != "VACUUM" ||
                persistedConfig.OsaAutoPeakSearch || Math.Abs(persistedConfig.OsaPeakThresholdDb - 6.5) > 1e-9)
                errors.Add("OSA workstation preference persistence failed");
            if (persistedConfig.BeamWidthMethod != "FWHM")
                errors.Add("beam workstation preference persistence failed");
            if (Math.Abs(persistedConfig.ScopeVoltsDiv - 0.5) > 1e-9 || persistedConfig.ScopeTriggerSource != "CH2")
                errors.Add("scope workstation preference persistence failed");
            if (!persistedConfig.SpectrumInterfaceEnabled || persistedConfig.SpectrumInterfaceEndpoint != "TCPIP0::192.0.2.10::inst0::INSTR" ||
                !persistedConfig.ScopeInterfaceEnabled || persistedConfig.ScopeInterfaceEndpoint != "TCPIP0::192.0.2.20::inst0::INSTR")
                errors.Add("instrument interface preference persistence failed");
            var interfaceStates = InstrumentBackendRegistry.InspectAll(persistedConfig);
            if (interfaceStates.Count != 4 || interfaceStates.Single(x => x.Kind == ModuleKind.Spectrum).State != "configured" ||
                interfaceStates.Single(x => x.Kind == ModuleKind.Scope).State != "configured" ||
                interfaceStates.Any(x => x.DataPlaneReady))
                errors.Add("instrument interface registry contract failed");

            var aqEndpoint = InstrumentEndpoint.Parse("TCPIP0::192.0.2.10::10001::SOCKET", 10001);
            var tekEndpoint = InstrumentEndpoint.Parse("192.0.2.20:4000", 4000);
            if (aqEndpoint.Host != "192.0.2.10" || aqEndpoint.Port != 10001 ||
                tekEndpoint.Host != "192.0.2.20" || tekEndpoint.Port != 4000 ||
                !InstrumentEndpoint.IsAutomatic("TCPIP::AUTO"))
                errors.Add("instrument endpoint parser contract failed");

            var csvProbe = InstrumentParse.CsvDoubles("1.0,2.5,-3.25");
            if (csvProbe.Length != 3 || Math.Abs(csvProbe[1] - 2.5) > 1e-9)
                errors.Add("SCPI CSV parser contract failed");

            var syntheticSpectrum = Enumerable.Range(0, 801)
                .Select(i =>
                {
                    var x = 1078.0 + i * 0.005;
                    var linearPower = Math.Exp(-0.5 * Math.Pow((x - 1080.0) / 0.32, 2));
                    var y = -5.0 + 10.0 * Math.Log10(Math.Max(linearPower, 1e-12));
                    return new SpectrumPoint(x, y);
                }).ToArray();
            var spectrumAnalysis = SignalMath.AnalyzeSpectrum(syntheticSpectrum, DateTime.Now);
            if (Math.Abs(spectrumAnalysis.CenterWavelength - 1080.0) > 0.02 ||
                spectrumAnalysis.Linewidth3Db < 0.6 || spectrumAnalysis.Linewidth3Db > 0.9)
                errors.Add("hardware spectrum analysis contract failed");

            const int fftCount = 2048;
            const double fftRate = 100000.0;
            var fftA = Enumerable.Range(0, fftCount).Select(i => Math.Sin(2 * Math.PI * 5000.0 * i / fftRate)).ToArray();
            var fftB = Enumerable.Range(0, fftCount).Select(i => 0.5 * Math.Sin(2 * Math.PI * 12000.0 * i / fftRate)).ToArray();
            var fft = SignalMath.Fft(fftA, fftB, fftRate);
            var peakA = fft.OrderByDescending(x => x.Ch1).FirstOrDefault();
            var peakB = fft.OrderByDescending(x => x.Ch2).FirstOrDefault();
            if (Math.Abs(peakA.X - 5.0) > 0.15 || Math.Abs(peakB.X - 12.0) > 0.15)
                errors.Add("local FFT contract failed");

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
                driverCore = new
                {
                    aqEndpoint = aqEndpoint.ToString(),
                    tekEndpoint = tekEndpoint.ToString(),
                    spectrumCenterNm = spectrumAnalysis.CenterWavelength,
                    spectrum3DbNm = spectrumAnalysis.Linewidth3Db,
                    fftPeakCh1Khz = peakA.X,
                    fftPeakCh2Khz = peakB.X
                },
                interfaces = interfaceStates.Select(x => new { kind=x.Kind.ToString(), x.State, x.Enabled, x.DataPlaneReady, x.Endpoint }).ToArray(),
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
