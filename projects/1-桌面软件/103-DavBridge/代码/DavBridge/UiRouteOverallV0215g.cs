namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        if (_routeSurface != null) _routeSurface.Dispose();
        if (_overallSurface != null) _overallSurface.Dispose();
    }
}
