namespace LaserBench;

internal sealed class HybridInstrumentProvider :
    IInstrumentProvider,
    IInstrumentRuntimeStatusSource,
    IInstrumentRuntimeControl,
    IDisposable
{
    private readonly AppConfig _config;
    private readonly SimulatorProvider _simulator = new();
    private readonly OphirJunoWorker _power;
    private readonly Aq6370dWorker _spectrum;
    private readonly BeamSquaredWorker _beam;
    private readonly TektronixMso44Worker _scope;

    internal HybridInstrumentProvider(AppConfig config)
    {
        _config = config;
        _power = new OphirJunoWorker(config);
        _spectrum = new Aq6370dWorker(config);
        _beam = new BeamSquaredWorker(config);
        _scope = new TektronixMso44Worker(config);
    }

    public bool IsSimulator =>
        !_config.PowerInterfaceEnabled &&
        !_config.SpectrumInterfaceEnabled &&
        !_config.BeamInterfaceEnabled &&
        !_config.ScopeInterfaceEnabled;

    public string DataPlaneMode
    {
        get
        {
            var states = InterfaceStatuses;
            var enabled = states.Where(x => x.Enabled).ToArray();
            if (enabled.Length == 0) return "SIM";
            var ready = enabled.Count(x => x.DataPlaneReady);
            if (ready == 0) return "WAITING";
            return ready == enabled.Length && enabled.Length == 4 ? "HW" : "MIXED";
        }
    }

    public IReadOnlyList<InstrumentInterfaceStatus> InterfaceStatuses =>
        new[] { _power.Status, _spectrum.Status, _beam.Status, _scope.Status };

    public IReadOnlyList<DeviceStatus> Devices
    {
        get
        {
            var devices = new List<DeviceStatus>();

            if (_config.PowerInterfaceEnabled)
            {
                var latest = _power.Latest;
                if (latest is not null && _power.Status.DataPlaneReady)
                {
                    foreach (var trace in latest.Traces.Where(x => x.Unit != "%"))
                        devices.Add(new DeviceStatus(trace.Name, ModuleKind.Power, true));
                }
                else devices.Add(new DeviceStatus(_config.Power1Alias, ModuleKind.Power, false));
            }
            else
            {
                devices.AddRange(_simulator.Devices.Where(x => x.Kind == ModuleKind.Power));
            }

            AddModule(devices, ModuleKind.Spectrum, _config.SpectrumInterfaceEnabled, _spectrum.Status, _config.Osa1Alias);
            AddModule(devices, ModuleKind.Beam, _config.BeamInterfaceEnabled, _beam.Status, _config.BeamAlias);
            AddModule(devices, ModuleKind.Scope, _config.ScopeInterfaceEnabled, _scope.Status, "scope");
            return devices;
        }
    }

    public MeasurementSnapshot Snapshot(AppConfig config)
    {
        var sim = _simulator.Snapshot(config);

        IReadOnlyList<NumericTrace> power = !_config.PowerInterfaceEnabled
            ? sim.Power
            : _power.Status.DataPlaneReady && _power.Latest is { } p ? p.Traces : Array.Empty<NumericTrace>();

        var realSpectrum = _config.SpectrumInterfaceEnabled && _spectrum.Status.DataPlaneReady ? _spectrum.Latest : null;
        IReadOnlyList<SpectrumPoint> spectrum = !_config.SpectrumInterfaceEnabled
            ? sim.Spectrum
            : realSpectrum?.Points ?? Array.Empty<SpectrumPoint>();

        var realBeam = _config.BeamInterfaceEnabled && _beam.Status.DataPlaneReady ? _beam.Latest : null;
        IReadOnlyList<BeamPoint> beam = !_config.BeamInterfaceEnabled
            ? sim.Beam
            : realBeam?.Caustic ?? Array.Empty<BeamPoint>();

        var realScope = _config.ScopeInterfaceEnabled && _scope.Status.DataPlaneReady ? _scope.Latest : null;
        IReadOnlyList<ScopePoint> scopeTime = !_config.ScopeInterfaceEnabled
            ? sim.ScopeTime
            : realScope?.Time ?? Array.Empty<ScopePoint>();
        IReadOnlyList<ScopePoint> scopeFft = !_config.ScopeInterfaceEnabled
            ? sim.ScopeFft
            : realScope?.Fft ?? Array.Empty<ScopePoint>();

        return new MeasurementSnapshot
        {
            Timestamp = DateTime.Now,
            Power = power,
            Spectrum = spectrum,
            Beam = beam,
            ScopeTime = scopeTime,
            ScopeFft = scopeFft,
            ScopeSampleRateSaPerSecond = !_config.ScopeInterfaceEnabled
                ? sim.ScopeSampleRateSaPerSecond
                : realScope?.SampleRateSaPerSecond ?? 0,
            CenterWavelength = !_config.SpectrumInterfaceEnabled
                ? sim.CenterWavelength
                : realSpectrum?.CenterWavelength ?? 0,
            Linewidth3Db = !_config.SpectrumInterfaceEnabled
                ? sim.Linewidth3Db
                : realSpectrum?.Linewidth3Db ?? 0,
            LinewidthRms = !_config.SpectrumInterfaceEnabled
                ? sim.LinewidthRms
                : realSpectrum?.LinewidthRms ?? 0,
            SpectrumPower = !_config.SpectrumInterfaceEnabled
                ? sim.SpectrumPower
                : realSpectrum?.IntegratedPowerDbm ?? -100.0,
            M2X = !_config.BeamInterfaceEnabled
                ? sim.M2X
                : realBeam is not null && double.IsFinite(realBeam.M2X) ? realBeam.M2X : 0,
            M2Y = !_config.BeamInterfaceEnabled
                ? sim.M2Y
                : realBeam is not null && double.IsFinite(realBeam.M2Y) ? realBeam.M2Y : 0
        };
    }

    public IReadOnlyList<(double Time, double Value)> PowerHistory(int traceIndex, double seconds, int count)
    {
        if (!_config.PowerInterfaceEnabled)
            return _simulator.PowerHistory(traceIndex, seconds, count);
        if (!_power.Status.DataPlaneReady)
            return Array.Empty<(double Time, double Value)>();
        return _power.PowerHistory(traceIndex, seconds, count);
    }

    public void RequestProbe(ModuleKind? kind = null)
    {
        if (kind is null or ModuleKind.Power) _power.RequestProbe();
        if (kind is null or ModuleKind.Spectrum) _spectrum.RequestProbe();
        if (kind is null or ModuleKind.Beam) _beam.RequestProbe();
        if (kind is null or ModuleKind.Scope) _scope.RequestProbe();
    }

    private void AddModule(List<DeviceStatus> devices, ModuleKind kind, bool enabled, InstrumentInterfaceStatus status, string alias)
    {
        if (enabled) devices.Add(new DeviceStatus(alias, kind, status.DataPlaneReady));
        else devices.AddRange(_simulator.Devices.Where(x => x.Kind == kind));
    }

    public void Dispose()
    {
        _power.Dispose();
        _spectrum.Dispose();
        _beam.Dispose();
        _scope.Dispose();
    }
}
