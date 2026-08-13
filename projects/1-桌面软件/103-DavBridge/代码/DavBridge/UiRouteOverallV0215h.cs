using System.Drawing.Drawing2D;
using System.Reflection;
namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private sealed partial class RouteSurface : Control
    {
        private readonly RouteFlowV026 _source;
        public RouteSurface(RouteFlowV026 source)
        {
            _source = source;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.White;
        }
        private object? Read(string name)
        {
            try { return _source.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_source); }
            catch { return null; }
        }
    }
}
