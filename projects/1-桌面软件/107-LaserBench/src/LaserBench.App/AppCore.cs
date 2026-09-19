using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LaserBench;

internal enum ModuleKind
{
    Power,
    Spectrum,
    Beam,
    Scope
}

internal sealed class AppConfig
{
    public string ConfirmedLabel { get; set; } = string.Empty;
    public string CurrentExperimentFolder { get; set; } = string.Empty;
    public bool CapturePower { get; set; } = true;
    public bool CaptureSpectrum { get; set; } = true;
    public bool CaptureBeam { get; set; } = true;
    public bool CaptureScope { get; set; } = false;
    public bool AutoScreenshot { get; set; }
    public bool SidebarExpanded { get; set; }
    public double BeamZ { get; set; }
    public double BeamAttenuation { get; set; }
    public string Power1Alias { get; set; } = "power1";
    public string Power2Alias { get; set; } = "power2";
    public string Math1Alias { get; set; } = "math1";
    public string Osa1Alias { get; set; } = "osa1";
    public string BeamAlias { get; set; } = "beam";
    public string Scope1Alias { get; set; } = "ch1";
    public string Scope2Alias { get; set; } = "ch2";
    public double PowerWindow { get; set; } = 600;
    public double OsaStart { get; set; } = 1060;
    public double OsaStop { get; set; } = 1100;
    public double ScopeTimeSpan { get; set; } = 0.24;
    public double ScopeFftMax { get; set; } = 50;
    public bool ScopeCh1 { get; set; } = true;
    public bool ScopeCh2 { get; set; } = true;
}

internal static class AppPaths
{
    public static string Root { get; private set; } = string.Empty;
    public static string ConfigDir => Path.Combine(Root, "config");
    public static string DataDir => Path.Combine(Root, "data");
    public static string ExpDir => Path.Combine(DataDir, "exp");
    public static string PicDir => Path.Combine(DataDir, "pic");
    public static string VideoDir => Path.Combine(DataDir, "video");
    public static string LogsDir => Path.Combine(Root, "logs");
    public static string RuntimeDir => Path.Combine(Root, "runtime");
    public static string ConfigFile => Path.Combine(ConfigDir, "app.json");

    public static void Initialize()
    {
        Root = Environment.GetEnvironmentVariable("LASERBENCH_ROOT")?.Trim()
            ?? AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        Root = Path.GetFullPath(Root);
        EnsureDirectories();
        VerifyWritable();
    }

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(ConfigDir);
        Directory.CreateDirectory(ExpDir);
        Directory.CreateDirectory(PicDir);
        Directory.CreateDirectory(VideoDir);
        Directory.CreateDirectory(LogsDir);
        Directory.CreateDirectory(RuntimeDir);
    }

    public static string ResolveExperimentDirectory(AppConfig config)
    {
        var folder = string.IsNullOrWhiteSpace(config.CurrentExperimentFolder)
            ? DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : SafeFile.SanitizeToken(config.CurrentExperimentFolder);
        var path = Path.Combine(ExpDir, folder);
        Directory.CreateDirectory(path);
        return path;
    }

    public static bool IsWritable()
    {
        try
        {
            VerifyWritable();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void VerifyWritable()
    {
        var probe = Path.Combine(Root, $".laserbench-write-{Guid.NewGuid():N}.tmp");
        try
        {
            File.WriteAllText(probe, "ok", Encoding.UTF8);
        }
        finally
        {
            try
            {
                if (File.Exists(probe)) File.Delete(probe);
            }
            catch
            {
            }
        }
    }
}

internal static class AppConfigStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static AppConfig Load()
    {
        try
        {
            if (!File.Exists(AppPaths.ConfigFile))
            {
                var fresh = new AppConfig();
                Save(fresh);
                return fresh;
            }

            return JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(AppPaths.ConfigFile), Options) ?? new AppConfig();
        }
        catch
        {
            return new AppConfig();
        }
    }

    public static void Save(AppConfig config)
    {
        Directory.CreateDirectory(AppPaths.ConfigDir);
        var temp = AppPaths.ConfigFile + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(config, Options), new UTF8Encoding(false));
        if (File.Exists(AppPaths.ConfigFile))
        {
            File.Copy(AppPaths.ConfigFile, AppPaths.ConfigFile + ".bak", true);
            File.Move(temp, AppPaths.ConfigFile, true);
        }
        else
        {
            File.Move(temp, AppPaths.ConfigFile);
        }
    }
}

internal static class SafeFile
{
    private static readonly Regex Spaces = new(@"\s+", RegexOptions.Compiled);

    public static string SanitizeToken(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var invalid = Path.GetInvalidFileNameChars().ToHashSet();
        var builder = new StringBuilder(value.Length);
        foreach (var c in value.Trim())
            builder.Append(invalid.Contains(c) || char.IsControl(c) ? '_' : c);

        var safe = Spaces.Replace(builder.ToString(), "_").Trim('_', '.', ' ');
        return safe.Length > 64 ? safe[..64] : safe;
    }

    public static string ComposeBaseName(DateTime timestamp, string source, string label)
    {
        var safeSource = SanitizeToken(source);
        var safeLabel = SanitizeToken(label);
        return string.IsNullOrWhiteSpace(safeLabel)
            ? $"{timestamp:HHmmss}_{safeSource}"
            : $"{timestamp:HHmmss}_{safeSource}_{safeLabel}";
    }

    public static string WriteTextAtomicUnique(string directory, string baseName, string extension, string content)
    {
        Directory.CreateDirectory(directory);
        var partial = Path.Combine(directory, $".{Guid.NewGuid():N}.partial");
        File.WriteAllText(partial, content, new UTF8Encoding(false));
        return MovePartialToUnique(partial, directory, baseName, extension);
    }

    public static string MovePartialToUnique(string partialPath, string directory, string baseName, string extension)
    {
        extension = extension.StartsWith('.') ? extension : "." + extension;
        for (var i = 0; ; i++)
        {
            var suffix = i == 0 ? string.Empty : $"_{i}";
            var candidate = Path.Combine(directory, baseName + suffix + extension);
            try
            {
                File.Move(partialPath, candidate, false);
                return candidate;
            }
            catch (IOException) when (File.Exists(candidate))
            {
            }
        }
    }
}

internal sealed record DeviceStatus(string Alias, ModuleKind Kind, bool Connected = true);
internal sealed record NumericTrace(string Name, string Unit, double Value, double MaxValue);
internal sealed record SpectrumPoint(double X, double Y);
internal sealed record BeamPoint(double Z, double X, double Y);
internal sealed record ScopePoint(double X, double Ch1, double Ch2);

internal sealed class MeasurementSnapshot
{
    public required DateTime Timestamp { get; init; }
    public required IReadOnlyList<NumericTrace> Power { get; init; }
    public required IReadOnlyList<SpectrumPoint> Spectrum { get; init; }
    public required IReadOnlyList<BeamPoint> Beam { get; init; }
    public required IReadOnlyList<ScopePoint> ScopeTime { get; init; }
    public required IReadOnlyList<ScopePoint> ScopeFft { get; init; }
    public double CenterWavelength { get; init; }
    public double Linewidth3Db { get; init; }
    public double LinewidthRms { get; init; }
    public double SpectrumPower { get; init; }
    public double M2X { get; init; }
    public double M2Y { get; init; }
    public double M2Mean => Math.Sqrt(M2X * M2Y);
}

internal interface IInstrumentProvider
{
    bool IsSimulator { get; }
    IReadOnlyList<DeviceStatus> Devices { get; }
    MeasurementSnapshot Snapshot(AppConfig config);
    IReadOnlyList<(double Time, double Value)> PowerHistory(int traceIndex, double seconds, int count);
}

internal sealed class SimulatorProvider : IInstrumentProvider
{
    private readonly DateTime _started = DateTime.UtcNow;
    public bool IsSimulator => true;

    public IReadOnlyList<DeviceStatus> Devices => new[]
    {
        new DeviceStatus("power1", ModuleKind.Power),
        new DeviceStatus("power2", ModuleKind.Power),
        new DeviceStatus("osa1", ModuleKind.Spectrum),
        new DeviceStatus("beam", ModuleKind.Beam),
        new DeviceStatus("scope", ModuleKind.Scope)
    };

    private double Now => (DateTime.UtcNow - _started).TotalSeconds;

    public MeasurementSnapshot Snapshot(AppConfig config)
    {
        var t = Now;
        var power = new[]
        {
            new NumericTrace(config.Power1Alias, "kW", PowerValue(0, t), SampleMax(0, t, 120)),
            new NumericTrace(config.Power2Alias, "kW", PowerValue(1, t), SampleMax(1, t, 120)),
            new NumericTrace(config.Math1Alias, "%", PowerValue(2, t), SampleMax(2, t, 120))
        };

        var center = 1080.22 + 0.025 * Math.Sin(t / 80.0);
        var linewidth = 2.04 + 0.025 * Math.Sin(t / 52.0);
        var sigma = linewidth / 2.35482;
        var spectrum = Enumerable.Range(0, 560).Select(i =>
        {
            var x = 1060.0 + i * (40.0 / 559.0);
            var main = 74.5 * Gaussian(x, center, sigma);
            var shoulder = 10.5 * Gaussian(x, center + 3.8, 0.72);
            var ripple = 0.65 * Math.Sin(i * 0.23 + t * 0.18) + 0.35 * Math.Sin(i * 0.071);
            var y = Math.Min(-3.0, -79.0 + main + shoulder + ripple);
            return new SpectrumPoint(x, y);
        }).ToArray();

        // The caustic is fixed. BeamZ is a browser position in the UI, not a curve control.
        var beam = Enumerable.Range(0, 260).Select(i =>
        {
            var z = -24.0 + i * (48.0 / 259.0);
            var wx = 0.30 * Math.Sqrt(1.0 + Math.Pow((z + 0.45) / 6.9, 2));
            var wy = 0.34 * Math.Sqrt(1.0 + Math.Pow((z - 0.55) / 7.7, 2));
            return new BeamPoint(z, wx, wy);
        }).ToArray();

        var scopeSpanMs = Math.Clamp(config.ScopeTimeSpan, 0.01, 1000.0);
        var scopeTime = Enumerable.Range(0, 560).Select(i =>
        {
            var ms = i * (scopeSpanMs / 559.0);
            var s = ms / 1000.0;
            var ch1 = 0.73 * Math.Sin(2 * Math.PI * 1200 * s) + 0.10 * Math.Sin(2 * Math.PI * 2400 * s + 0.32);
            var ch2 = 0.46 * Math.Sin(2 * Math.PI * 1200 * s + 0.82) + 0.075 * Math.Sin(2 * Math.PI * 3100 * s);
            return new ScopePoint(ms, ch1, ch2);
        }).ToArray();

        var scopeFft = Enumerable.Range(0, 460).Select(i =>
        {
            var khz = i * (50000.0 / 459.0);
            var ch1 = 0.95 * Gaussian(khz, 1.20, 0.085) + 0.15 * Gaussian(khz, 2.40, 0.14) + 0.010;
            var ch2 = 0.69 * Gaussian(khz, 1.20, 0.105) + 0.12 * Gaussian(khz, 3.10, 0.18) + 0.008;
            return new ScopePoint(khz, ch1, ch2);
        }).ToArray();

        return new MeasurementSnapshot
        {
            Timestamp = DateTime.Now,
            Power = power,
            Spectrum = spectrum,
            Beam = beam,
            ScopeTime = scopeTime,
            ScopeFft = scopeFft,
            CenterWavelength = center,
            Linewidth3Db = linewidth,
            LinewidthRms = 2.20 + 0.02 * Math.Cos(t / 68.0),
            SpectrumPower = -3.1 + 0.08 * Math.Sin(t / 33.0),
            M2X = 1.08 + 0.012 * Math.Sin(t / 35.0),
            M2Y = 1.12 + 0.011 * Math.Cos(t / 42.0)
        };
    }

    public IReadOnlyList<(double Time, double Value)> PowerHistory(int traceIndex, double seconds, int count)
    {
        var end = Now;
        var start = Math.Max(0, end - seconds);
        var result = new (double Time, double Value)[count];
        for (var i = 0; i < count; i++)
        {
            var x = start + (end - start) * i / Math.Max(1, count - 1);
            result[i] = (x, PowerValue(traceIndex, x));
        }
        return result;
    }

    private static double PowerValue(int index, double t) => index switch
    {
        0 => 18.42 + 0.18 * Math.Sin(t / 12.0) + 0.035 * Math.Sin(t * 1.7),
        1 => 0.32 + 0.012 * Math.Sin(t / 9.0 + 1.2) + 0.004 * Math.Sin(t * 2.1),
        _ => 87.2 + 0.22 * Math.Sin(t / 15.0 + 0.4)
    };

    private static double SampleMax(int index, double t, double windowSeconds)
    {
        var max = double.MinValue;
        for (var i = 0; i < 240; i++)
        {
            var x = Math.Max(0, t - windowSeconds + windowSeconds * i / 239.0);
            max = Math.Max(max, PowerValue(index, x));
        }
        return max;
    }

    private static double Gaussian(double x, double center, double sigma)
        => Math.Exp(-0.5 * Math.Pow((x - center) / sigma, 2));
}

internal sealed class CaptureResult
{
    public DateTime RequestedAt { get; init; }
    public List<string> Files { get; } = new();
    public List<string> Errors { get; } = new();
    public bool Cancelled { get; set; }
}

internal sealed class CaptureService
{
    private readonly IInstrumentProvider _provider;

    public CaptureService(IInstrumentProvider provider) => _provider = provider;

    public async Task<CaptureResult> CaptureAsync(AppConfig config, CancellationToken cancellationToken)
    {
        var requestedAt = DateTime.Now;
        var result = new CaptureResult { RequestedAt = requestedAt };
        var directory = AppPaths.ResolveExperimentDirectory(config);
        var snapshot = _provider.Snapshot(config);
        var label = config.ConfirmedLabel;

        try
        {
            if (config.CapturePower)
            {
                foreach (var (trace, index) in snapshot.Power.Select((value, index) => (value, index)))
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var baseName = SafeFile.ComposeBaseName(requestedAt, trace.Name, label);
                    var history = _provider.PowerHistory(index, 2.0, 41);
                    var csv = new StringBuilder("time_s,value,unit\n");
                    var t0 = history[0].Time;
                    foreach (var point in history)
                        csv.AppendLine($"{(point.Time - t0).ToString("F3", CultureInfo.InvariantCulture)},{point.Value.ToString("F6", CultureInfo.InvariantCulture)},{trace.Unit}");
                    result.Files.Add(SafeFile.WriteTextAtomicUnique(directory, baseName, ".csv", csv.ToString()));
                }
                await Task.Delay(100, cancellationToken);
            }

            if (config.CaptureSpectrum)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var baseName = SafeFile.ComposeBaseName(requestedAt, config.Osa1Alias, label);
                var csv = new StringBuilder("wavelength_nm,intensity_dbm\n");
                foreach (var point in snapshot.Spectrum)
                    csv.AppendLine($"{point.X.ToString("F6", CultureInfo.InvariantCulture)},{point.Y.ToString("F6", CultureInfo.InvariantCulture)}");
                result.Files.Add(SafeFile.WriteTextAtomicUnique(directory, baseName, ".csv", csv.ToString()));
                await Task.Delay(180, cancellationToken);
            }

            if (config.CaptureBeam)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var baseName = SafeFile.ComposeBaseName(requestedAt, config.BeamAlias, label);
                var csv = new StringBuilder();
                csv.AppendLine($"# M2x={snapshot.M2X.ToString("F4", CultureInfo.InvariantCulture)}");
                csv.AppendLine($"# M2y={snapshot.M2Y.ToString("F4", CultureInfo.InvariantCulture)}");
                csv.AppendLine($"# M2mean={snapshot.M2Mean.ToString("F4", CultureInfo.InvariantCulture)}");
                csv.AppendLine("z_mm,width_x_mm,width_y_mm");
                foreach (var point in snapshot.Beam)
                    csv.AppendLine($"{point.Z.ToString("F6", CultureInfo.InvariantCulture)},{point.X.ToString("F6", CultureInfo.InvariantCulture)},{point.Y.ToString("F6", CultureInfo.InvariantCulture)}");
                result.Files.Add(SafeFile.WriteTextAtomicUnique(directory, baseName, ".csv", csv.ToString()));
                await Task.Delay(220, cancellationToken);
            }

            if (config.CaptureScope)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var timeBase = SafeFile.ComposeBaseName(requestedAt, "scope_time", label);
                var timeCsv = new StringBuilder("time_ms,ch1,ch2\n");
                foreach (var point in snapshot.ScopeTime)
                    timeCsv.AppendLine($"{point.X.ToString("F6", CultureInfo.InvariantCulture)},{point.Ch1.ToString("F6", CultureInfo.InvariantCulture)},{point.Ch2.ToString("F6", CultureInfo.InvariantCulture)}");
                result.Files.Add(SafeFile.WriteTextAtomicUnique(directory, timeBase, ".csv", timeCsv.ToString()));

                var fftBase = SafeFile.ComposeBaseName(requestedAt, "scope_fft", label);
                var fftCsv = new StringBuilder("frequency_khz,ch1,ch2\n");
                foreach (var point in snapshot.ScopeFft)
                    fftCsv.AppendLine($"{point.X.ToString("F6", CultureInfo.InvariantCulture)},{point.Ch1.ToString("F6", CultureInfo.InvariantCulture)},{point.Ch2.ToString("F6", CultureInfo.InvariantCulture)}");
                result.Files.Add(SafeFile.WriteTextAtomicUnique(directory, fftBase, ".csv", fftCsv.ToString()));
                await Task.Delay(100, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
            result.Cancelled = true;
        }
        catch (Exception ex)
        {
            result.Errors.Add(ex.Message);
        }

        return result;
    }
}
