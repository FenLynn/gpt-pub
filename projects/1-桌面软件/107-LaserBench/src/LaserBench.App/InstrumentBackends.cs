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
    string Message);

internal interface IInstrumentBackendAdapter
{
    ModuleKind Kind { get; }
    InstrumentInterfaceStatus Inspect(AppConfig config);
}

internal abstract class InstrumentBackendAdapter : IInstrumentBackendAdapter
{
    public abstract ModuleKind Kind { get; }
    protected abstract string DriverId { get; }
    protected abstract string DeviceName { get; }
    protected abstract string VendorSoftware { get; }
    protected abstract string InterfaceName { get; }
    protected abstract (bool Enabled, string Endpoint) ReadSettings(AppConfig config);

    public InstrumentInterfaceStatus Inspect(AppConfig config)
    {
        var (enabled, configuredEndpoint) = ReadSettings(config);
        var endpoint = (configuredEndpoint ?? string.Empty).Trim();

        // v0.4.x builds the control plane only. A configured endpoint is not
        // a successful hardware connection and never fabricates real data.
        const bool dataPlaneReady = false;
        var state = !enabled ? "disabled" : string.IsNullOrWhiteSpace(endpoint) ? "invalid" : "configured";
        var message = state switch
        {
            "disabled" => "未启用真实接口；当前数据平面保持 Simulator。",
            "invalid" => "已启用真实接口，但接口地址为空；不会切换离开 Simulator。",
            _ => "接口配置已持久化；真实驱动数据平面尚未启用，需在目标 Windows 环境完成 SDK/SCPI Probe 后才能切换。"
        };

        return new InstrumentInterfaceStatus(
            Kind, DriverId, DeviceName, VendorSoftware, InterfaceName,
            enabled, dataPlaneReady, endpoint, state, message);
    }
}

internal sealed class OphirJunoBackendAdapter : InstrumentBackendAdapter
{
    public override ModuleKind Kind => ModuleKind.Power;
    protected override string DriverId => "ophir-juno-lmmeasurement";
    protected override string DeviceName => "Ophir Juno";
    protected override string VendorSoftware => "OphirLMMeasurement";
    protected override string InterfaceName => ".NET / COM SDK";
    protected override (bool Enabled, string Endpoint) ReadSettings(AppConfig config)
        => (config.PowerInterfaceEnabled, config.PowerInterfaceEndpoint);
}

internal sealed class YokogawaAq6370dBackendAdapter : InstrumentBackendAdapter
{
    public override ModuleKind Kind => ModuleKind.Spectrum;
    protected override string DriverId => "yokogawa-aq6370d";
    protected override string DeviceName => "Yokogawa AQ6370D";
    protected override string VendorSoftware => "Yokogawa";
    protected override string InterfaceName => "TCP/IP / SCPI / VISA";
    protected override (bool Enabled, string Endpoint) ReadSettings(AppConfig config)
        => (config.SpectrumInterfaceEnabled, config.SpectrumInterfaceEndpoint);
}

internal sealed class BeamSquaredBackendAdapter : InstrumentBackendAdapter
{
    public override ModuleKind Kind => ModuleKind.Beam;
    protected override string DriverId => "spiricon-beamsquared-sp920";
    protected override string DeviceName => "Ophir Spiricon SP920";
    protected override string VendorSoftware => "BeamSquared";
    protected override string InterfaceName => "BeamSquared API / SDK";
    protected override (bool Enabled, string Endpoint) ReadSettings(AppConfig config)
        => (config.BeamInterfaceEnabled, config.BeamInterfaceEndpoint);
}

internal sealed class TektronixMso44BackendAdapter : InstrumentBackendAdapter
{
    public override ModuleKind Kind => ModuleKind.Scope;
    protected override string DriverId => "tektronix-mso44";
    protected override string DeviceName => "Tektronix MSO44";
    protected override string VendorSoftware => "TekVISA";
    protected override string InterfaceName => "VISA / SCPI";
    protected override (bool Enabled, string Endpoint) ReadSettings(AppConfig config)
        => (config.ScopeInterfaceEnabled, config.ScopeInterfaceEndpoint);
}

internal static class InstrumentBackendRegistry
{
    private static readonly IInstrumentBackendAdapter[] Adapters =
    {
        new OphirJunoBackendAdapter(),
        new YokogawaAq6370dBackendAdapter(),
        new BeamSquaredBackendAdapter(),
        new TektronixMso44BackendAdapter()
    };

    internal static IReadOnlyList<InstrumentInterfaceStatus> InspectAll(AppConfig config)
        => Adapters.Select(adapter => adapter.Inspect(config)).ToArray();
}

internal sealed record InstrumentProviderSelection(
    IInstrumentProvider Provider,
    IReadOnlyList<InstrumentInterfaceStatus> Interfaces,
    string DataSource);

internal static class InstrumentProviderFactory
{
    internal static InstrumentProviderSelection Create(AppConfig config)
    {
        var interfaces = InstrumentBackendRegistry.InspectAll(config);

        // Safe v0.4.x boundary: configuration may be complete, but real
        // providers are admitted only after the vendor-specific real-machine
        // probe has established enumeration, minimum read and timestamps.
        if (interfaces.Any(status => status.DataPlaneReady))
            throw new InvalidOperationException("A hardware backend reports ready without a registered production provider.");

        return new InstrumentProviderSelection(new SimulatorProvider(), interfaces, "Simulator");
    }
}
