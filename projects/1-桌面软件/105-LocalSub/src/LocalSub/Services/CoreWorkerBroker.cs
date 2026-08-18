using LocalSub.Core;

namespace LocalSub.Services;

internal static class CoreWorkerBroker
{
    static readonly Lazy<CoreWorkerClient> Client = new(() => new CoreWorkerClient());

    public static bool IsAvailable => File.Exists(Path.Combine(PortablePaths.BaseDir, "LocalSub.Core.exe"));
    public static CoreWorkerClient Shared => Client.Value;

    public static async ValueTask ShutdownAsync()
    {
        if (!Client.IsValueCreated) return;
        try { await Client.Value.DisposeAsync(); } catch { }
    }
}
