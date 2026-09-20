using System.Globalization;

namespace LaserBench;

internal sealed class TektronixMso44Worker : HardwareWorkerBase
{
    private readonly object _dataGate = new();
    private ScopeHardwareSnapshot? _latest;

    internal TektronixMso44Worker(AppConfig config)
        : base(config, ModuleKind.Scope, "tektronix-mso44", "Tektronix MSO44", "Tektronix", "Ethernet raw TCP/SCPI :4000")
    {
    }

    protected override bool Enabled => Config.ScopeInterfaceEnabled;
    protected override string Endpoint => Config.ScopeInterfaceEndpoint;

    internal ScopeHardwareSnapshot? Latest
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
            throw new InvalidOperationException("MSO44 的 LAN 接口需要填写示波器 IP，例如 192.168.1.50 或 TCPIP0::192.168.1.50::4000::SOCKET。");

        var endpoint = InstrumentEndpoint.Parse(endpointText, 4000);
        var generation = ProbeGeneration;
        await using var connection = await ScpiTcpConnection.ConnectAsync(endpoint, TimeSpan.FromSeconds(4), token);

        var identity = await connection.QueryAsync("*IDN?", token);
        if (!identity.Contains("TEKTRONIX", StringComparison.OrdinalIgnoreCase) ||
            !identity.Contains("MSO4", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"目标设备不是预期的 Tektronix 4 Series MSO：{identity}");

        await connection.WriteLineAsync("*CLS", token);
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

            var ch1 = await ReadChannelAsync(connection, "CH1", token);
            var ch2 = await ReadChannelAsync(connection, "CH2", token);
            var count = Math.Min(ch1.Values.Length, ch2.Values.Length);
            if (count < 16) throw new InvalidDataException($"MSO44 波形点数不足：CH1={ch1.Values.Length}, CH2={ch2.Values.Length}");

            var xIncrement = ch1.XIncrement > 0 ? ch1.XIncrement : ch2.XIncrement;
            if (xIncrement <= 0) throw new InvalidDataException("MSO44 返回的 XINCR 无效。");
            var sampleRate = 1.0 / xIncrement;
            var xZero = double.IsFinite(ch1.XZero) ? ch1.XZero : 0.0;
            var pointOffset = double.IsFinite(ch1.PointOffset) ? ch1.PointOffset : 0.0;

            var time = new ScopePoint[count];
            var a = new double[count];
            var b = new double[count];
            for (var i = 0; i < count; i++)
            {
                var milliseconds = (xZero + (i - pointOffset) * xIncrement) * 1000.0;
                a[i] = ch1.Values[i];
                b[i] = ch2.Values[i];
                time[i] = new ScopePoint(milliseconds, a[i], b[i]);
            }

            var fft = SignalMath.Fft(a, b, sampleRate);
            var sample = new ScopeHardwareSnapshot(DateTime.Now, time, fft, sampleRate);
            lock (_dataGate) _latest = sample;
            MarkReady($"MSO44 CH1/CH2 实时波形已接入（{count} 点，本地 FFT）。", identity, sample.Timestamp);

            await Task.Delay(250, token);
        }
    }

    private string SettingsSignature() => string.Join("|",
        Config.ScopeTimeSpan.ToString("R", CultureInfo.InvariantCulture),
        Config.ScopeVoltsDiv.ToString("R", CultureInfo.InvariantCulture),
        Config.ScopeOffset.ToString("R", CultureInfo.InvariantCulture),
        Config.ScopeCoupling,
        Config.ScopeTriggerSource,
        Config.ScopeTriggerLevel.ToString("R", CultureInfo.InvariantCulture),
        Config.ScopeTriggerSlope,
        Config.ScopeAcquisition,
        Config.ScopeAverage);

    private async Task ApplySettingsAsync(ScpiTcpConnection connection, CancellationToken token)
    {
        var secondsPerDivision = Math.Max(1e-9, Config.ScopeTimeSpan / 1000.0 / 10.0);
        var voltsPerDivision = Math.Max(1e-6, Config.ScopeVoltsDiv);
        var coupling = (Config.ScopeCoupling ?? "DC").Trim().ToUpperInvariant();
        if (coupling is not ("DC" or "AC" or "GND")) coupling = "DC";
        var triggerSource = Config.ScopeTriggerSource.Equals("CH2", StringComparison.OrdinalIgnoreCase) ? "CH2" : "CH1";
        var slope = Config.ScopeTriggerSlope.Equals("FALLING", StringComparison.OrdinalIgnoreCase) ? "FALL" : "RISE";
        var acquisition = (Config.ScopeAcquisition ?? "SAMPLE").Trim().ToUpperInvariant();

        await connection.WriteLineAsync($":HORIZONTAL:SCALE {InstrumentParse.ScpiNumber(secondsPerDivision)}", token);
        foreach (var channel in new[] { "CH1", "CH2" })
        {
            await connection.WriteLineAsync($":{channel}:SCALE {InstrumentParse.ScpiNumber(voltsPerDivision)}", token);
            await connection.WriteLineAsync($":{channel}:OFFSET {InstrumentParse.ScpiNumber(Config.ScopeOffset)}", token);
            await connection.WriteLineAsync($":{channel}:COUPLING {coupling}", token);
        }

        await connection.WriteLineAsync($":TRIGGER:A:EDGE:SOURCE {triggerSource}", token);
        await connection.WriteLineAsync($":TRIGGER:A:LEVEL:{triggerSource} {InstrumentParse.ScpiNumber(Config.ScopeTriggerLevel)}", token);
        await connection.WriteLineAsync($":TRIGGER:A:EDGE:SLOPE {slope}", token);

        var mode = acquisition switch
        {
            "AVERAGE" => "AVERAGE",
            "PEAK" => "PEAKDETECT",
            _ => "SAMPLE"
        };
        await connection.WriteLineAsync($":ACQUIRE:MODE {mode}", token);
        if (mode == "AVERAGE")
            await connection.WriteLineAsync($":ACQUIRE:NUMAVG {Math.Clamp(Config.ScopeAverage, 2, 1024)}", token);
    }

    private static async Task<TekWaveform> ReadChannelAsync(ScpiTcpConnection connection, string channel, CancellationToken token)
    {
        await connection.WriteLineAsync($":DATA:SOURCE {channel}", token);
        await connection.WriteLineAsync(":DATA:START 1", token);
        await connection.WriteLineAsync(":DATA:STOP 4096", token);
        await connection.WriteLineAsync(":DATA:ENCDG ASCII", token);

        var xIncrement = InstrumentParse.Double(await connection.QueryAsync(":WFMOUTPRE:XINCR?", token), "XINCR");
        var xZero = InstrumentParse.Double(await connection.QueryAsync(":WFMOUTPRE:XZERO?", token), "XZERO");
        var pointOffset = InstrumentParse.Double(await connection.QueryAsync(":WFMOUTPRE:PT_OFF?", token), "PT_OFF");
        var yMult = InstrumentParse.Double(await connection.QueryAsync(":WFMOUTPRE:YMULT?", token), "YMULT");
        var yOff = InstrumentParse.Double(await connection.QueryAsync(":WFMOUTPRE:YOFF?", token), "YOFF");
        var yZero = InstrumentParse.Double(await connection.QueryAsync(":WFMOUTPRE:YZERO?", token), "YZERO");
        var raw = InstrumentParse.CsvDoubles(await connection.QueryAsync(":CURVE?", token));
        if (raw.Length == 0) throw new InvalidDataException($"{channel} CURVE? 没有返回数据。");

        var values = new double[raw.Length];
        for (var i = 0; i < raw.Length; i++)
            values[i] = (raw[i] - yOff) * yMult + yZero;
        return new TekWaveform(xIncrement, xZero, pointOffset, values);
    }

    private sealed record TekWaveform(double XIncrement, double XZero, double PointOffset, double[] Values);
}
