namespace LaserBench;

internal static class InstrumentBackendRegistry
{
    internal static IReadOnlyList<InstrumentInterfaceStatus> InspectAll(AppConfig config)
    {
        static InstrumentInterfaceStatus State(
            ModuleKind kind,
            string driverId,
            string deviceName,
            string vendor,
            string transport,
            bool enabled,
            string endpoint,
            bool lan)
        {
            var automatic = InstrumentEndpoint.IsAutomatic(endpoint);
            var state = !enabled ? "disabled" : lan && automatic ? "awaiting_endpoint" : "configured";
            var message = state switch
            {
                "disabled" => "真实接口未启用。",
                "awaiting_endpoint" => "已启用，但 LAN 仪器仍需要填写实际 IP/TCPIP 地址。",
                _ => "接口已配置，运行时将自动 Probe；只有实际读取到真实样本后才进入 ready。"
            };
            return new InstrumentInterfaceStatus(kind, driverId, deviceName, vendor, transport, enabled, false, endpoint, state, message);
        }

        return new[]
        {
            State(ModuleKind.Power, "ophir-juno-lmmeasurement", "Ophir Juno", "Ophir StarLab / OphirLMMeasurement", "USB + COM Automation",
                config.PowerInterfaceEnabled, config.PowerInterfaceEndpoint, false),
            State(ModuleKind.Spectrum, "yokogawa-aq6370d", "Yokogawa AQ6370D", "Yokogawa", "Ethernet TCP/SCPI :10001",
                config.SpectrumInterfaceEnabled, config.SpectrumInterfaceEndpoint, true),
            State(ModuleKind.Beam, "spiricon-beamsquared-sp920", "Ophir Spiricon SP920 / BeamSquared", "Ophir BeamSquared", ".NET Framework automation bridge",
                config.BeamInterfaceEnabled, config.BeamInterfaceEndpoint, false),
            State(ModuleKind.Scope, "tektronix-mso44", "Tektronix MSO44", "Tektronix", "Ethernet raw TCP/SCPI :4000",
                config.ScopeInterfaceEnabled, config.ScopeInterfaceEndpoint, true)
        };
    }
}

internal sealed record InstrumentProviderSelection(
    IInstrumentProvider Provider,
    IReadOnlyList<InstrumentInterfaceStatus> Interfaces,
    string DataSource);

internal static class InstrumentProviderFactory
{
    internal static InstrumentProviderSelection Create(AppConfig config)
    {
        var provider = new HybridInstrumentProvider(config);
        return new InstrumentProviderSelection(provider, provider.InterfaceStatuses, provider.DataPlaneMode);
    }
}
