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

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    private static int RunSelfTest(string reportPath)
    {
        var errors = new List<string>();
        try
        {
            AppPaths.Initialize();
            var config = new AppConfig
            {
                ConfirmedLabel = "13A",
                CapturePower = true,
                CaptureSpectrum = true,
                CaptureBeam = true,
                CaptureScope = true
            };
            AppConfigStore.Save(config);

            var exp = AppPaths.ResolveExperimentDirectory(config);
            var first = SafeFile.WriteTextAtomicUnique(exp, "120000_power1_13A", ".csv", "x,y\n0,1\n");
            var second = SafeFile.WriteTextAtomicUnique(exp, "120000_power1_13A", ".csv", "x,y\n0,2\n");
            if (!Path.GetFileNameWithoutExtension(second).EndsWith("_1", StringComparison.Ordinal))
                errors.Add("never-overwrite suffix rule failed");

            var provider = new SimulatorProvider();
            var snapshot = provider.Snapshot(config);
            if (snapshot.Power.Count < 2 || snapshot.Spectrum.Count < 100 || snapshot.Beam.Count < 100 || snapshot.ScopeTime.Count < 100)
                errors.Add("simulator payload incomplete");

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
