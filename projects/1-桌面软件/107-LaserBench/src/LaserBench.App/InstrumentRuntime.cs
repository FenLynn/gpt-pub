using System.Globalization;
using System.Net.Sockets;
using System.Numerics;
using System.Text;

namespace LaserBench;

internal sealed record InstrumentInterfaceStatus(
    ModuleKind Kind,
    string DriverId,
    string DeviceName,
    string VendorSoftware,
    string InterfaceName,
    bool Enabled,
    bool DataPlaneReady,
    string Endpoint,
    string State,
    string Message,
    string Identity = "",
    DateTime? LastSampleAt = null,
    int FailureCount = 0);

internal interface IInstrumentRuntimeStatusSource
{
    IReadOnlyList<InstrumentInterfaceStatus> InterfaceStatuses { get; }
    string DataPlaneMode { get; }
}

internal interface IInstrumentRuntimeControl
{
    void RequestProbe(ModuleKind? kind = null);
}

internal sealed record SpectrumHardwareSnapshot(
    DateTime Timestamp,
    IReadOnlyList<SpectrumPoint> Points,
    double CenterWavelength,
    double Linewidth3Db,
    double LinewidthRms,
    double IntegratedPowerDbm);

internal sealed record ScopeHardwareSnapshot(
    DateTime Timestamp,
    IReadOnlyList<ScopePoint> Time,
    IReadOnlyList<ScopePoint> Fft,
    double SampleRateSaPerSecond);

internal sealed record BeamHardwareSnapshot(
    DateTime Timestamp,
    IReadOnlyList<BeamPoint> Caustic,
    double M2X,
    double M2Y);

internal readonly record struct InstrumentEndpoint(string Host, int Port)
{
    internal static bool IsAutomatic(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        return string.IsNullOrWhiteSpace(text) ||
               text.Equals("AUTO", StringComparison.OrdinalIgnoreCase) ||
               text.Contains("::AUTO", StringComparison.OrdinalIgnoreCase);
    }

    internal static InstrumentEndpoint Parse(string value, int defaultPort)
    {
        var text = (value ?? string.Empty).Trim();
        if (IsAutomatic(text))
            throw new InvalidOperationException("接口地址仍为 AUTO；LAN 仪器需要填写 IP 地址或 TCPIP::... 地址。");

        if (text.StartsWith("TCPIP", StringComparison.OrdinalIgnoreCase))
        {
            var parts = text.Split(new[] { "::" }, StringSplitOptions.None);
            if (parts.Length < 2 || string.IsNullOrWhiteSpace(parts[1]))
                throw new FormatException("TCPIP 地址缺少主机名/IP。");
            var host = parts[1].Trim();
            var port = defaultPort;
            for (var i = 2; i < parts.Length; i++)
                if (int.TryParse(parts[i], NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
                {
                    port = parsed;
                    break;
                }
            return new InstrumentEndpoint(host, port);
        }

        var colon = text.LastIndexOf(':');
        if (colon > 0 && colon < text.Length - 1 &&
            int.TryParse(text[(colon + 1)..], NumberStyles.Integer, CultureInfo.InvariantCulture, out var explicitPort))
            return new InstrumentEndpoint(text[..colon].Trim(), explicitPort);

        return new InstrumentEndpoint(text, defaultPort);
    }

    public override string ToString() => $"{Host}:{Port}";
}

internal sealed class ScpiTcpConnection : IAsyncDisposable
{
    private readonly TcpClient _client;
    private readonly NetworkStream _stream;
    private readonly StreamReader _reader;
    private readonly StreamWriter _writer;
    private readonly TimeSpan _timeout;

    private ScpiTcpConnection(TcpClient client, TimeSpan timeout)
    {
        _client = client;
        _stream = client.GetStream();
        _reader = new StreamReader(_stream, Encoding.ASCII, false, 65536, leaveOpen: true);
        _writer = new StreamWriter(_stream, new UTF8Encoding(false), 65536, leaveOpen: true)
        {
            AutoFlush = true,
            NewLine = "\n"
        };
        _timeout = timeout;
    }

    internal static async Task<ScpiTcpConnection> ConnectAsync(InstrumentEndpoint endpoint, TimeSpan timeout, CancellationToken token)
    {
        var client = new TcpClient { NoDelay = true };
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeoutCts.CancelAfter(timeout);
        try
        {
            await client.ConnectAsync(endpoint.Host, endpoint.Port, timeoutCts.Token);
            return new ScpiTcpConnection(client, timeout);
        }
        catch
        {
            client.Dispose();
            throw;
        }
    }

    internal async Task WriteLineAsync(string command, CancellationToken token)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeoutCts.CancelAfter(_timeout);
        await _writer.WriteLineAsync(command.AsMemory(), timeoutCts.Token);
        await _writer.FlushAsync(timeoutCts.Token);
    }

    internal async Task<string> ReadLineAsync(CancellationToken token)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeoutCts.CancelAfter(_timeout);
        var line = await _reader.ReadLineAsync(timeoutCts.Token);
        if (line is null) throw new IOException("仪器关闭了 TCP 连接。");
        return line.Trim();
    }

    internal async Task<string> QueryAsync(string command, CancellationToken token)
    {
        await WriteLineAsync(command, token);
        return await ReadLineAsync(token);
    }

    public ValueTask DisposeAsync()
    {
        try { _writer.Dispose(); } catch { }
        try { _reader.Dispose(); } catch { }
        try { _stream.Dispose(); } catch { }
        try { _client.Dispose(); } catch { }
        return ValueTask.CompletedTask;
    }
}

internal static class InstrumentParse
{
    internal static double[] CsvDoubles(string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return Array.Empty<double>();
        var payload = text.Trim();
        var firstSpace = payload.IndexOf(' ');
        if (payload.StartsWith(":", StringComparison.Ordinal) && firstSpace > 0)
            payload = payload[(firstSpace + 1)..];

        var values = new List<double>();
        foreach (var token in payload.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                values.Add(value);
        return values.ToArray();
    }

    internal static double Double(string text, string name)
    {
        var cleaned = text.Trim();
        var lastSpace = cleaned.LastIndexOf(' ');
        if (lastSpace >= 0) cleaned = cleaned[(lastSpace + 1)..];
        if (!double.TryParse(cleaned, NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
            throw new InvalidDataException($"{name} 返回了无法解析的数值：{text}");
        return value;
    }

    internal static string ScpiNumber(double value) => value.ToString("0.############", CultureInfo.InvariantCulture);
}

internal static class SignalMath
{
    internal static SpectrumHardwareSnapshot AnalyzeSpectrum(IReadOnlyList<SpectrumPoint> points, DateTime timestamp)
    {
        if (points.Count < 3) throw new InvalidDataException("OSA 返回的光谱点数不足。");
        var peakIndex = 0;
        for (var i = 1; i < points.Count; i++)
            if (points[i].Y > points[peakIndex].Y) peakIndex = i;

        var peak = points[peakIndex];
        var threshold = peak.Y - 3.0;
        var left = peak.X;
        var right = peak.X;
        for (var i = peakIndex; i > 0; i--)
            if (points[i - 1].Y < threshold)
            {
                left = InterpolateX(points[i - 1], points[i], threshold);
                break;
            }
        for (var i = peakIndex; i < points.Count - 1; i++)
            if (points[i + 1].Y < threshold)
            {
                right = InterpolateX(points[i], points[i + 1], threshold);
                break;
            }

        double sumW = 0, sumX = 0, sumX2 = 0, sumMw = 0;
        foreach (var point in points)
        {
            var weight = Math.Pow(10.0, point.Y / 10.0);
            sumW += weight;
            sumX += weight * point.X;
            sumX2 += weight * point.X * point.X;
            sumMw += weight;
        }
        var mean = sumW > 0 ? sumX / sumW : peak.X;
        var variance = sumW > 0 ? Math.Max(0, sumX2 / sumW - mean * mean) : 0;
        var rmsFwhm = 2.354820045 * Math.Sqrt(variance);
        var integratedDbm = sumMw > 0 ? 10.0 * Math.Log10(sumMw) : double.NegativeInfinity;

        return new SpectrumHardwareSnapshot(timestamp, points.ToArray(), peak.X, Math.Max(0, right - left), rmsFwhm, integratedDbm);
    }

    private static double InterpolateX(SpectrumPoint a, SpectrumPoint b, double targetY)
    {
        var dy = b.Y - a.Y;
        if (Math.Abs(dy) < 1e-12) return (a.X + b.X) * 0.5;
        return a.X + (targetY - a.Y) * (b.X - a.X) / dy;
    }

    internal static IReadOnlyList<ScopePoint> Fft(double[] ch1, double[] ch2, double sampleRate)
    {
        var count = Math.Min(ch1.Length, ch2.Length);
        if (count < 16 || sampleRate <= 0) return Array.Empty<ScopePoint>();
        var n = 1;
        while ((n << 1) <= count && (n << 1) <= 4096) n <<= 1;

        var a = new Complex[n];
        var b = new Complex[n];
        for (var i = 0; i < n; i++)
        {
            var w = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / Math.Max(1, n - 1));
            a[i] = new Complex(ch1[i] * w, 0);
            b[i] = new Complex(ch2[i] * w, 0);
        }
        FftInPlace(a);
        FftInPlace(b);

        var result = new ScopePoint[n / 2 + 1];
        for (var i = 0; i < result.Length; i++)
        {
            var frequencyKhz = (sampleRate * i / n) / 1000.0;
            var scale = i == 0 ? 1.0 / n : 2.0 / n;
            result[i] = new ScopePoint(frequencyKhz, a[i].Magnitude * scale, b[i].Magnitude * scale);
        }
        return result;
    }

    private static void FftInPlace(Complex[] data)
    {
        var n = data.Length;
        for (int i = 1, j = 0; i < n; i++)
        {
            var bit = n >> 1;
            for (; (j & bit) != 0; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) (data[i], data[j]) = (data[j], data[i]);
        }
        for (var len = 2; len <= n; len <<= 1)
        {
            var angle = -2 * Math.PI / len;
            var wLen = new Complex(Math.Cos(angle), Math.Sin(angle));
            for (var i = 0; i < n; i += len)
            {
                var w = Complex.One;
                for (var j = 0; j < len / 2; j++)
                {
                    var u = data[i + j];
                    var v = data[i + j + len / 2] * w;
                    data[i + j] = u + v;
                    data[i + j + len / 2] = u - v;
                    w *= wLen;
                }
            }
        }
    }
}

internal abstract class HardwareWorkerBase : IDisposable
{
    protected readonly AppConfig Config;
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _loop;
    private readonly object _statusGate = new();
    private InstrumentInterfaceStatus _status;
    private int _failureCount;
    private int _probeGeneration;

    protected HardwareWorkerBase(
        AppConfig config,
        ModuleKind kind,
        string driverId,
        string deviceName,
        string vendorSoftware,
        string interfaceName)
    {
        Config = config;
        _status = new InstrumentInterfaceStatus(kind, driverId, deviceName, vendorSoftware, interfaceName, false, false, "", "disabled", "真实接口未启用。");
        _loop = Task.Run(LoopAsync);
    }

    protected abstract bool Enabled { get; }
    protected abstract string Endpoint { get; }
    protected abstract Task RunEnabledSessionAsync(string endpoint, CancellationToken token);
    protected virtual void ClearData() { }

    internal InstrumentInterfaceStatus Status
    {
        get { lock (_statusGate) return _status; }
    }

    internal void RequestProbe() => Interlocked.Increment(ref _probeGeneration);

    protected int ProbeGeneration => Volatile.Read(ref _probeGeneration);

    protected void MarkStatus(string state, string message, bool ready = false, string identity = "", DateTime? sampleAt = null)
    {
        lock (_statusGate)
        {
            _status = _status with
            {
                Enabled = Enabled,
                DataPlaneReady = ready,
                Endpoint = Endpoint,
                State = state,
                Message = message,
                Identity = identity,
                LastSampleAt = sampleAt ?? (ready ? DateTime.Now : _status.LastSampleAt),
                FailureCount = _failureCount
            };
        }
    }

    protected void MarkReady(string message, string identity, DateTime sampleAt)
    {
        _failureCount = 0;
        MarkStatus("ready", message, true, identity, sampleAt);
    }

    private async Task LoopAsync()
    {
        while (!_cts.IsCancellationRequested)
        {
            if (!Enabled)
            {
                _failureCount = 0;
                ClearData();
                MarkStatus("disabled", "真实接口未启用。");
                await DelaySafe(400, _cts.Token);
                continue;
            }

            try
            {
                MarkStatus("connecting", "正在探测并建立设备连接…");
                await RunEnabledSessionAsync(Endpoint, _cts.Token);
                if (!_cts.IsCancellationRequested) await DelaySafe(250, _cts.Token);
            }
            catch (OperationCanceledException) when (_cts.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _failureCount++;
                ClearData();
                var state = ex is FileNotFoundException or TypeLoadException ? "dependency_missing" : "faulted";
                MarkStatus(state, ex.Message);
                var delay = Math.Min(5000, 600 + _failureCount * 500);
                await DelaySafe(delay, _cts.Token);
            }
        }
    }

    private static async Task DelaySafe(int milliseconds, CancellationToken token)
    {
        try { await Task.Delay(milliseconds, token); } catch (OperationCanceledException) { }
    }

    public virtual void Dispose()
    {
        _cts.Cancel();
        try { _loop.Wait(TimeSpan.FromSeconds(2)); } catch { }
        _cts.Dispose();
    }
}
