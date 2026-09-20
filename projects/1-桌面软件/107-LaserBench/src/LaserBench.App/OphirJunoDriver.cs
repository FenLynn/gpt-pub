using System.Collections;
using System.Globalization;
using System.Runtime.InteropServices;

namespace LaserBench;

internal sealed record PowerHardwareSnapshot(DateTime Timestamp, IReadOnlyList<NumericTrace> Traces);

internal sealed class OphirJunoWorker : IDisposable
{
    private readonly AppConfig _config;
    private readonly CancellationTokenSource _cts = new();
    private readonly Thread _thread;
    private readonly object _statusGate = new();
    private readonly object _dataGate = new();
    private readonly Dictionary<int, List<(double Time, double Value)>> _history = new();
    private InstrumentInterfaceStatus _status;
    private PowerHardwareSnapshot? _latest;
    private int _failureCount;
    private int _probeGeneration;

    internal OphirJunoWorker(AppConfig config)
    {
        _config = config;
        _status = new InstrumentInterfaceStatus(
            ModuleKind.Power,
            "ophir-juno-lmmeasurement",
            "Ophir Juno",
            "Ophir StarLab / OphirLMMeasurement",
            "USB + COM Automation",
            false, false, "AUTO", "disabled", "真实接口未启用。");

        _thread = new Thread(WorkerLoop)
        {
            IsBackground = true,
            Name = "LaserBench.OphirJuno"
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
    }

    internal InstrumentInterfaceStatus Status
    {
        get { lock (_statusGate) return _status; }
    }

    internal PowerHardwareSnapshot? Latest
    {
        get { lock (_dataGate) return _latest; }
    }

    internal void RequestProbe() => Interlocked.Increment(ref _probeGeneration);

    internal IReadOnlyList<(double Time, double Value)> PowerHistory(int traceIndex, double seconds, int count)
    {
        lock (_dataGate)
        {
            if (!_history.TryGetValue(traceIndex, out var source) || source.Count == 0)
                return Array.Empty<(double Time, double Value)>();

            var end = source[^1].Time;
            var start = end - Math.Max(0.1, seconds);
            var window = source.Where(x => x.Time >= start).ToArray();
            if (window.Length <= count) return window;
            var result = new (double Time, double Value)[count];
            for (var i = 0; i < count; i++)
            {
                var index = (int)Math.Round(i * (window.Length - 1.0) / Math.Max(1, count - 1));
                result[i] = window[index];
            }
            return result;
        }
    }

    private void WorkerLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            if (!_config.PowerInterfaceEnabled)
            {
                _failureCount = 0;
                ClearData();
                SetStatus("disabled", "真实接口未启用。", false);
                Sleep(400);
                continue;
            }

            try
            {
                SetStatus("connecting", "正在通过 OphirLMMeasurement 扫描 USB 功率计…", false);
                RunSession(_config.PowerInterfaceEndpoint, Volatile.Read(ref _probeGeneration));
            }
            catch (Exception ex)
            {
                _failureCount++;
                ClearData();
                var state = ex is FileNotFoundException or TypeLoadException ? "dependency_missing" : "faulted";
                SetStatus(state, ex.Message, false);
                Sleep(Math.Min(5000, 600 + _failureCount * 500));
            }
        }
    }

    private void RunSession(string requestedEndpoint, int generation)
    {
        var comType = Type.GetTypeFromProgID("OphirLMMeasurement.CoLMMeasurement", throwOnError: false);
        if (comType is null)
            throw new FileNotFoundException("未检测到 OphirLMMeasurement COM。请安装当前 StarLab/Ophir 软件及 Juno USB 驱动后重新探测。");

        object? comObject = null;
        var opened = new List<(int Handle, string Serial)>();
        try
        {
            comObject = Activator.CreateInstance(comType)
                ?? throw new InvalidOperationException("OphirLMMeasurement COM 创建失败。");
            dynamic lm = comObject;

            object serialObject;
            lm.ScanUSB(out serialObject);
            var serials = ToStrings(serialObject);
            if (serials.Length == 0)
                throw new InvalidOperationException("OphirLMMeasurement 已加载，但 ScanUSB 未发现 Juno/兼容 USB 功率计。");

            var selected = SelectSerials(serials, requestedEndpoint);
            if (selected.Length == 0)
                throw new InvalidOperationException($"未找到配置的 Ophir 序列号：{requestedEndpoint}");

            foreach (var serial in selected.Take(4))
            {
                int handle;
                lm.OpenUSBDevice(serial, out handle);
                lm.StartStream(handle, 0);
                opened.Add((handle, serial));
            }

            SetStatus("streaming", $"已打开 {opened.Count} 台 Ophir USB 设备，等待首个测量包…", false, string.Join(", ", opened.Select(x => x.Serial)));

            var latestValues = new double[opened.Count];
            var haveValue = new bool[opened.Count];
            while (!_cts.IsCancellationRequested &&
                   _config.PowerInterfaceEnabled &&
                   string.Equals(requestedEndpoint, _config.PowerInterfaceEndpoint, StringComparison.OrdinalIgnoreCase) &&
                   generation == Volatile.Read(ref _probeGeneration))
            {
                var nowSeconds = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
                for (var i = 0; i < opened.Count; i++)
                {
                    object valuesObject, timestampsObject, statusObject;
                    lm.GetData(opened[i].Handle, 0, out valuesObject, out timestampsObject, out statusObject);
                    var values = ToDoubles(valuesObject);
                    var statuses = ToInts(statusObject);
                    for (var j = 0; j < values.Length; j++)
                    {
                        if (j < statuses.Length && statuses[j] != 0) continue;
                        latestValues[i] = values[j];
                        haveValue[i] = true;
                        AddHistory(i, nowSeconds, values[j]);
                    }
                }

                if (haveValue.Any(x => x))
                {
                    var traces = new List<NumericTrace>();
                    for (var i = 0; i < opened.Count; i++)
                    {
                        if (!haveValue[i]) continue;
                        var alias = i switch
                        {
                            0 => _config.Power1Alias,
                            1 => _config.Power2Alias,
                            _ => $"power{i + 1}"
                        };
                        traces.Add(new NumericTrace(alias, "W", latestValues[i], WindowMax(i, _config.PowerWindow, latestValues[i])));
                    }

                    if (opened.Count >= 2 && haveValue[0] && haveValue[1] && Math.Abs(latestValues[0]) > 1e-18)
                    {
                        var ratio = latestValues[1] / latestValues[0] * 100.0;
                        AddHistory(2, nowSeconds, ratio);
                        traces.Add(new NumericTrace(_config.Math1Alias, "%", ratio, WindowMax(2, _config.PowerWindow, ratio)));
                    }

                    var snapshot = new PowerHardwareSnapshot(DateTime.Now, traces);
                    lock (_dataGate) _latest = snapshot;
                    _failureCount = 0;
                    SetStatus(
                        "ready",
                        $"Ophir Juno 实时流已接入（{traces.Count} 条真实/数学通道，COM GetData）。",
                        true,
                        string.Join(", ", opened.Select(x => x.Serial)),
                        snapshot.Timestamp);
                }

                Sleep(80);
            }
        }
        finally
        {
            if (comObject is not null)
            {
                dynamic lm = comObject;
                foreach (var device in opened)
                {
                    try { lm.StopStream(device.Handle, 0); } catch { }
                    try { lm.Close(device.Handle); } catch { }
                }
                try
                {
                    if (Marshal.IsComObject(comObject)) Marshal.FinalReleaseComObject(comObject);
                }
                catch { }
            }
        }
    }

    private static string[] SelectSerials(string[] serials, string endpoint)
    {
        if (InstrumentEndpoint.IsAutomatic(endpoint)) return serials;
        var requested = endpoint.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return serials.Where(s => requested.Any(r => string.Equals(r, s, StringComparison.OrdinalIgnoreCase))).ToArray();
    }

    private static string[] ToStrings(object value)
    {
        if (value is not IEnumerable enumerable) return Array.Empty<string>();
        return enumerable.Cast<object?>().Select(x => x?.ToString() ?? string.Empty).Where(x => x.Length > 0).ToArray();
    }

    private static double[] ToDoubles(object value)
    {
        if (value is not IEnumerable enumerable) return Array.Empty<double>();
        var list = new List<double>();
        foreach (var item in enumerable)
            if (item is not null)
                try { list.Add(Convert.ToDouble(item, CultureInfo.InvariantCulture)); } catch { }
        return list.ToArray();
    }

    private static int[] ToInts(object value)
    {
        if (value is not IEnumerable enumerable) return Array.Empty<int>();
        var list = new List<int>();
        foreach (var item in enumerable)
            if (item is not null)
                try { list.Add(Convert.ToInt32(item, CultureInfo.InvariantCulture)); } catch { }
        return list.ToArray();
    }

    private void AddHistory(int index, double time, double value)
    {
        lock (_dataGate)
        {
            if (!_history.TryGetValue(index, out var list))
            {
                list = new List<(double Time, double Value)>();
                _history[index] = list;
            }
            list.Add((time, value));
            var cutoff = time - 7200;
            var remove = 0;
            while (remove < list.Count && list[remove].Time < cutoff) remove++;
            if (remove > 0) list.RemoveRange(0, remove);
            if (list.Count > 100000) list.RemoveRange(0, list.Count - 100000);
        }
    }

    private double WindowMax(int index, double seconds, double fallback)
    {
        lock (_dataGate)
        {
            if (!_history.TryGetValue(index, out var list) || list.Count == 0) return fallback;
            var cutoff = list[^1].Time - Math.Max(0.1, seconds);
            var max = double.NegativeInfinity;
            for (var i = list.Count - 1; i >= 0 && list[i].Time >= cutoff; i--)
                max = Math.Max(max, list[i].Value);
            return double.IsFinite(max) ? max : fallback;
        }
    }

    private void ClearData()
    {
        lock (_dataGate)
        {
            _latest = null;
            _history.Clear();
        }
    }

    private void SetStatus(string state, string message, bool ready, string identity = "", DateTime? sampleAt = null)
    {
        lock (_statusGate)
        {
            _status = _status with
            {
                Enabled = _config.PowerInterfaceEnabled,
                DataPlaneReady = ready,
                Endpoint = _config.PowerInterfaceEndpoint,
                State = state,
                Message = message,
                Identity = identity,
                LastSampleAt = sampleAt ?? (ready ? DateTime.Now : _status.LastSampleAt),
                FailureCount = _failureCount
            };
        }
    }

    private void Sleep(int milliseconds)
    {
        if (milliseconds <= 0) return;
        _cts.Token.WaitHandle.WaitOne(milliseconds);
    }

    public void Dispose()
    {
        _cts.Cancel();
        try { if (_thread.IsAlive) _thread.Join(2500); } catch { }
        _cts.Dispose();
    }
}
