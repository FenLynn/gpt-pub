using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace LaserBench;

internal sealed class BeamSquaredWorker : HardwareWorkerBase
{
    private readonly object _dataGate = new();
    private readonly SortedDictionary<double, BeamPoint> _points = new();
    private BeamHardwareSnapshot? _latest;

    internal BeamSquaredWorker(AppConfig config)
        : base(config, ModuleKind.Beam, "spiricon-beamsquared-sp920", "Ophir Spiricon SP920 / BeamSquared", "Ophir BeamSquared", ".NET Framework automation bridge")
    {
    }

    protected override bool Enabled => Config.BeamInterfaceEnabled;
    protected override string Endpoint => Config.BeamInterfaceEndpoint;

    internal BeamHardwareSnapshot? Latest
    {
        get { lock (_dataGate) return _latest; }
    }

    protected override void ClearData()
    {
        lock (_dataGate)
        {
            _latest = null;
            _points.Clear();
        }
    }

    protected override async Task RunEnabledSessionAsync(string endpointText, CancellationToken token)
    {
        var bridge = ResolveBridge();
        var automationAssembly = ResolveAutomationAssembly(endpointText);
        var generation = ProbeGeneration;

        var start = new ProcessStartInfo
        {
            FileName = bridge,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(bridge) ?? AppContext.BaseDirectory
        };
        start.ArgumentList.Add("--server");
        start.ArgumentList.Add("--assembly");
        start.ArgumentList.Add(automationAssembly);

        using var process = Process.Start(start) ?? throw new InvalidOperationException("无法启动 BeamSquared bridge。");
        var stderr = new StringBuilder();
        process.ErrorDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data))
            {
                lock (stderr)
                {
                    if (stderr.Length < 6000) stderr.AppendLine(e.Data);
                }
            }
        };
        process.BeginErrorReadLine();

        try
        {
            var ready = await ReadProtocolLineAsync(process, token);
            if (ready.StartsWith("FATAL\t", StringComparison.Ordinal))
                throw new InvalidOperationException("BeamSquared bridge: " + DecodeB64(ready.Split('\t').ElementAtOrDefault(1)));
            if (!ready.StartsWith("READY\t", StringComparison.Ordinal))
                throw new InvalidOperationException("BeamSquared bridge 未进入 READY：" + ready);

            var identity = DecodeB64(ready.Split('\t').ElementAtOrDefault(1));
            MarkStatus("streaming", "BeamSquared Automation bridge 已连接，正在读取当前帧/拟合结果…", false, identity);

            while (!token.IsCancellationRequested &&
                   Enabled &&
                   string.Equals(endpointText, Endpoint, StringComparison.OrdinalIgnoreCase) &&
                   generation == ProbeGeneration &&
                   !process.HasExited)
            {
                await process.StandardInput.WriteLineAsync("SNAPSHOT");
                await process.StandardInput.FlushAsync();
                var line = await ReadProtocolLineAsync(process, token);
                if (line.StartsWith("ERR\t", StringComparison.Ordinal))
                    throw new InvalidOperationException("BeamSquared Automation: " + DecodeB64(line.Split('\t').ElementAtOrDefault(1)));
                if (!line.StartsWith("SNAPSHOT\t", StringComparison.Ordinal))
                    throw new InvalidDataException("BeamSquared bridge 返回未知消息：" + line);

                var fields = line.Split('\t');
                if (fields.Length < 7)
                    throw new InvalidDataException("BeamSquared bridge SNAPSHOT 字段不足。");

                var z = Parse(fields[1]);
                var widthXMicrometres = Parse(fields[2]);
                var widthYMicrometres = Parse(fields[3]);
                var m2x = Parse(fields[4]);
                var m2y = Parse(fields[5]);
                var runStatus = DecodeB64(fields[6]);

                if (double.IsFinite(z) && double.IsFinite(widthXMicrometres) && double.IsFinite(widthYMicrometres) &&
                    widthXMicrometres > 0 && widthYMicrometres > 0)
                {
                    // BeamSquared automation reports its displayed spatial beam-width result.
                    // LaserBench caustic storage is mm; the UI converts it back to µm.
                    var point = new BeamPoint(z, widthXMicrometres / 1000.0, widthYMicrometres / 1000.0);
                    lock (_dataGate)
                    {
                        var existingKey = _points.Keys.FirstOrDefault(key => Math.Abs(key - z) < 0.02);
                        if (_points.ContainsKey(existingKey) && Math.Abs(existingKey - z) < 0.02) _points[existingKey] = point;
                        else _points[z] = point;

                        if (_points.Count > 600)
                        {
                            var first = _points.Keys.First();
                            _points.Remove(first);
                        }

                        var old = _latest;
                        var safeM2x = double.IsFinite(m2x) && m2x > 0 ? m2x : old?.M2X ?? double.NaN;
                        var safeM2y = double.IsFinite(m2y) && m2y > 0 ? m2y : old?.M2Y ?? double.NaN;
                        _latest = new BeamHardwareSnapshot(DateTime.Now, _points.Values.ToArray(), safeM2x, safeM2y);
                    }

                    var snapshot = Latest!;
                    var fitText = double.IsFinite(snapshot.M2X) && double.IsFinite(snapshot.M2Y)
                        ? $"M²={Math.Sqrt(snapshot.M2X * snapshot.M2Y):0.###}"
                        : "M² 拟合尚未可用";
                    MarkReady($"BeamSquared 实时结果已接入；RunStatus={runStatus}；{fitText}；caustic 已累计 {snapshot.Caustic.Count} 点。", identity, snapshot.Timestamp);
                }
                else
                {
                    MarkStatus("streaming", $"BeamSquared 已连接；RunStatus={runStatus}；等待有效 BeamWidth/rail position。", false, identity);
                }

                await Task.Delay(180, token);
            }

            if (process.HasExited && !token.IsCancellationRequested)
            {
                string detail;
                lock (stderr) detail = stderr.ToString().Trim();
                throw new InvalidOperationException($"BeamSquared bridge 已退出（code {process.ExitCode}）。{detail}");
            }
        }
        finally
        {
            try
            {
                if (!process.HasExited)
                {
                    await process.StandardInput.WriteLineAsync("SHUTDOWN");
                    await process.StandardInput.FlushAsync();
                    if (!process.WaitForExit(1600)) process.Kill(entireProcessTree: true);
                }
            }
            catch
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
            }
        }
    }

    private static async Task<string> ReadProtocolLineAsync(Process process, CancellationToken token)
    {
        for (var i = 0; i < 20; i++)
        {
            var line = await process.StandardOutput.ReadLineAsync(token);
            if (line is null)
            {
                string stderr = string.Empty;
                try { stderr = await process.StandardError.ReadToEndAsync(token); } catch { }
                throw new IOException("BeamSquared bridge stdout 已关闭。" + stderr);
            }
            if (line.StartsWith("READY\t", StringComparison.Ordinal) ||
                line.StartsWith("SNAPSHOT\t", StringComparison.Ordinal) ||
                line.StartsWith("ERR\t", StringComparison.Ordinal) ||
                line.StartsWith("FATAL\t", StringComparison.Ordinal) ||
                line.StartsWith("OK\t", StringComparison.Ordinal))
                return line;
        }
        throw new InvalidDataException("BeamSquared bridge 输出中未找到协议消息。");
    }

    private static string ResolveBridge()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "runtime", "BeamSquaredBridge", "LaserBench.BeamSquaredBridge.exe"),
            Path.Combine(AppContext.BaseDirectory, "LaserBench.BeamSquaredBridge.exe")
        };
        return candidates.FirstOrDefault(File.Exists)
            ?? throw new FileNotFoundException("LaserBench BeamSquared bridge 未找到。请使用包含 runtime/BeamSquaredBridge 的完整候选包。");
    }

    private static string ResolveAutomationAssembly(string endpoint)
    {
        if (!InstrumentEndpoint.IsAutomatic(endpoint))
        {
            var custom = endpoint.Trim().Trim('"');
            if (Directory.Exists(custom)) custom = Path.Combine(custom, "M2.Automation.dll");
            if (File.Exists(custom)) return Path.GetFullPath(custom);
            throw new FileNotFoundException("配置的 BeamSquared Automation 路径不存在。", custom);
        }

        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)
        };
        foreach (var root in roots.Where(x => !string.IsNullOrWhiteSpace(x)))
        {
            var candidate = Path.Combine(root, "Spiricon", "BeamSquared", "M2.Automation.dll");
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("未检测到 BeamSquared Automation（M2.Automation.dll）。请安装 BeamSquared，并确认 Automation 组件可用。");
    }

    private static double Parse(string value)
        => double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var result) ? result : double.NaN;

    private static string DecodeB64(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        try { return Encoding.UTF8.GetString(Convert.FromBase64String(value)); }
        catch { return value; }
    }
}
