using System.Reflection;
namespace DavBridge;
internal sealed partial class UiRouteOverallV0215 : IDisposable
{
    private readonly UiDashboardV027 _dashboard;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 220 };
    private Control? _routeSurface;
    private Control? _overallSurface;
    private bool _disposed;
    private UiRouteOverallV0215(UiDashboardV027 dashboard)
    {
        _dashboard = dashboard;
        ReplaceRoute();
        ReplaceOverall();
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
    }
    public static UiRouteOverallV0215 Attach(UiDashboardV027 dashboard) => new(dashboard);
}
