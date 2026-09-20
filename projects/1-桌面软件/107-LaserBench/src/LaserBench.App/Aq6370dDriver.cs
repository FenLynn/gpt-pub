using System.Globalization;

namespace LaserBench;

internal sealed class Aq6370dWorker : HardwareWorkerBase
{
    private readonly object _dataGate = new();
    private SpectrumHardwareSnapshot? _latest;

    internal Aq6370dWorker(AppConfig config)
        : base(config, ModuleKind.Spectrum, "yokogawa-aq6370d", "Yokogawa AQ6370D", "Yokogawa", "Ethernet TCP/SCPI :10001")
    {
    }

    protected override bool Enabled => Config.SpectrumInterfaceEnabled;
    protected override string Endpoint => Config.SpectrumInterfaceEndpoint;

    internal SpectrumHardwareSnapshot? Latest
    {
        get { lock (_dataGate) return _latest; }
    }

    protected override void ClearData()
    {
        lock (_dataGate) _latest = null;
    }

    protected override async Task RunEnabledSessionAsync(string endpointText, CancellationToken token)
    {
        if (InstrumentEndpoint.IsAutomatic(endpointText))
            throw new InvalidOperationException("AQ6370D 无法仅凭 AUTO 安全确定目标设备；请填写仪器 IP，例如 192.168.1.100 或 TCPIP0::192.168.1.100::10001::SOCKET。");

        var endpoint = InstrumentEndpoint.Parse(endpointText, 10001);
        var generation = ProbeGeneration;
        await using var connection = await ScpiTcpConnection.ConnectAsync(endpoint, TimeSpan.FromSeconds(4), token);

        MarkStatus("authenticating", $"已连接 {endpoint}，正在执行 AQ6370D LAN 用户认证…");
        await connection.WriteLineAsync("open \"anonymous\"", token);
        _ = await connection.ReadLineAsync(token);
        await connection.WriteLineAsync(" ", token);
        var ready = await connection.ReadLineAsync(token);
        if (!ready.StartsWith("ready", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"AQ6370D LAN 认证失败：{ready}");

        await connection.WriteLineAsync("CFORM1", token);
        await connection.WriteLineAsync(":FORMAT:DATA ASCII", token);
        var identity = await connection.QueryAsync("*IDN?", token);
        if (!identity.Contains("YOKOGAWA", StringComparison.OrdinalIgnoreCase) ||
            !identity.Contains("AQ6370", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"目标设备不是预期的 Yokogawa AQ6370 系列：{identity}");

        string? appliedSignature = null;
        while (!token.IsCancellationRequested &&
               Enabled &&
               string.Equals(endpointText, Endpoint, StringComparison.OrdinalIgnoreCase) &&
               generation == ProbeGeneration)
        {
            var signature = SettingsSignature();
            if (!string.Equals(signature, appliedSignature, StringComparison.Ordinal))
            {
                await ApplySettingsAsync(connection, token);
                appliedSignature = signature;
            }

            var xRaw = await connection.QueryAsync(":TRACE:DATA:X? TRA", token);
            var yRaw = await connection.QueryAsync(":TRACE:DATA:Y? TRA", token);
            var x = InstrumentParse.CsvDoubles(xRaw);
            var y = InstrumentParse.CsvDoubles(yRaw);
            if (x.Length < 3 || y.Length < 3 || x.Length != y.Length)
                throw new InvalidDataException($"AQ6370D TRA 数据长度异常：X={x.Length}, Y={y.Length}");

            var points = new SpectrumPoint[x.Length];
            for (var i = 0; i < x.Length; i++)
                points[i] = new SpectrumPoint(x[i] * 1e9, y[i]); // instrument returns wavelength in metres.

            var sample = SignalMath.AnalyzeSpectrum(points, DateTime.Now);
            lock (_dataGate) _latest = sample;
            MarkReady($"AQ6370D 实时 TRA 已接入（{points.Length} 点）。", identity, sample.Timestamp);

            await Task.Delay(650, token);
        }
    }

    private string SettingsSignature() => string.Join("|",
        Config.OsaStart.ToString("R", CultureInfo.InvariantCulture),
        Config.OsaStop.ToString("R", CultureInfo.InvariantCulture),
        Config.OsaResolution.ToString("R", CultureInfo.InvariantCulture),
        Config.OsaSensitivity,
        Config.OsaAverage,
        Config.OsaSamplePoints,
        Config.OsaTraceMode,
        Config.OsaSweepMode,
        Config.OsaWavelengthReference);

    private async Task ApplySettingsAsync(ScpiTcpConnection connection, CancellationToken token)
    {
        var start = Math.Min(Config.OsaStart, Config.OsaStop);
        var stop = Math.Max(Config.OsaStart, Config.OsaStop);
        var sensitivity = NormalizeSensitivity(Config.OsaSensitivity);
        var points = Math.Clamp(Config.OsaSamplePoints, 101, 50001);
        var average = Math.Clamp(Config.OsaAverage, 1, 999);

        await connection.WriteLineAsync($":SENSE:WAVELENGTH:START {InstrumentParse.ScpiNumber(start)}NM", token);
        await connection.WriteLineAsync($":SENSE:WAVELENGTH:STOP {InstrumentParse.ScpiNumber(stop)}NM", token);
        await connection.WriteLineAsync($":SENSE:BANDWIDTH:RESOLUTION {InstrumentParse.ScpiNumber(Math.Max(0.001, Config.OsaResolution))}NM", token);
        await connection.WriteLineAsync($":SENSE:SENSE {sensitivity}", token);
        await connection.WriteLineAsync($":SENSE:AVERAGE:COUNT {average}", token);
        await connection.WriteLineAsync(":SENSE:SWEEP:POINTS:AUTO OFF", token);
        await connection.WriteLineAsync($":SENSE:SWEEP:POINTS {points}", token);
        await connection.WriteLineAsync($":SENSE:CORRECTION:RVELOCITY:MEDIUM {(Config.OsaWavelengthReference.Equals("VACUUM", StringComparison.OrdinalIgnoreCase) ? "VACUUM" : "AIR")}", token);

        switch ((Config.OsaTraceMode ?? "WRITE").Trim().ToUpperInvariant())
        {
            case "MAXHOLD":
                await connection.WriteLineAsync(":TRACE:ATTRIBUTE:TRA MAX", token);
                break;
            case "AVERAGE":
                await connection.WriteLineAsync($":TRACE:ATTRIBUTE:RAVG:TRA {Math.Max(2, average)}", token);
                break;
            default:
                await connection.WriteLineAsync(":TRACE:ATTRIBUTE:TRA WRITE", token);
                break;
        }

        var repeat = Config.OsaSweepMode.Equals("REPEAT", StringComparison.OrdinalIgnoreCase);
        await connection.WriteLineAsync($":INITIATE:SMODE {(repeat ? "REPEAT" : "SINGLE")}", token);
        await connection.WriteLineAsync(":INITIATE", token);
    }

    private static string NormalizeSensitivity(string value)
    {
        var normalized = (value ?? "MID").Trim().ToUpperInvariant();
        return normalized switch
        {
            "LOW" => "NORM",
            "MID" => "MID",
            "HIGH1" => "HIGH1",
            "HIGH2" => "HIGH2",
            "HIGH3" => "HIGH3",
            _ => "MID"
        };
    }
}
