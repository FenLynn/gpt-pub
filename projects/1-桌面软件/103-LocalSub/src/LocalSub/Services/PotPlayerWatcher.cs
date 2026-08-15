using System.Diagnostics;

namespace LocalSub.Services;

public static class PotPlayerWatcher
{
    static readonly string[] Names = ["PotPlayerMini64", "PotPlayerMini", "PotPlayer"];
    public static Process? FindRunning()
    {
        foreach (var name in Names)
        {
            var p = Process.GetProcessesByName(name).OrderByDescending(x => x.StartTime).FirstOrDefault();
            if (p != null) return p;
        }
        return null;
    }
}
