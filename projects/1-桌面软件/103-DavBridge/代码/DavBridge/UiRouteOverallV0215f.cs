namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private void Refresh()
    {
        if (_routeSurface != null) _routeSurface.Invalidate();
        if (_overallSurface != null) _overallSurface.Invalidate();
    }
}
