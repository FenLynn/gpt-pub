using LocalSub.Models;

namespace LocalSub.Services;

public static class PerformancePolicy
{
    public static int RealtimeThreads(ResourceProfile profile)
    {
        var cpu = Math.Max(1, Environment.ProcessorCount);
        return profile switch
        {
            ResourceProfile.Eco => Math.Clamp(cpu / 4, 1, 2),
            ResourceProfile.MaxPerformance => Math.Clamp(cpu, 2, 8),
            _ => Math.Clamp(cpu / 2, 1, 6)
        };
    }

    public static int BatchThreads(ResourceProfile profile)
    {
        var cpu = Math.Max(1, Environment.ProcessorCount);
        return profile switch
        {
            ResourceProfile.Eco => Math.Clamp(cpu / 4, 1, 2),
            ResourceProfile.MaxPerformance => Math.Clamp(cpu, 2, 12),
            _ => Math.Clamp(cpu / 2, 1, 6)
        };
    }
}
