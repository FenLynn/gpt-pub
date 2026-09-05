namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private void ReplaceRoute()
    {
        if(Field<RouteFlowV026>("_flow") is not { } flow)return;
        Clear(flow);
        _routeSurface=new RouteSurface(flow){Dock=DockStyle.Fill,TabStop=false};
        flow.Controls.Add(_routeSurface);
    }
}
