using System.Drawing.Drawing2D;
namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private sealed partial class RouteSurface
    {
        private static (Color, Color) FlowColors(UiStatusKind kind) => kind switch
        {
            UiStatusKind.Running => (Color.FromArgb(151,222,181), Color.FromArgb(31,143,87)),
            UiStatusKind.Preparing => (Color.FromArgb(193,226,248), Color.FromArgb(75,138,191)),
            UiStatusKind.Quota => (Color.FromArgb(255,239,183), Color.FromArgb(193,140,36)),
            UiStatusKind.Network => (Color.FromArgb(252,218,178), Color.FromArgb(201,119,38)),
            UiStatusKind.Error => (Color.FromArgb(251,201,201), Color.FromArgb(186,66,66)),
            UiStatusKind.Complete => (Color.FromArgb(155,215,190), Color.FromArgb(38,128,97)),
            _ => (Color.FromArgb(218,226,233), Color.FromArgb(124,140,153))
        };
        private static GraphicsPath Rounded(RectangleF r, float radius)
        {
            var p = new GraphicsPath(); var d = radius * 2;
            p.AddArc(r.Left,r.Top,d,d,180,90); p.AddArc(r.Right-d,r.Top,d,d,270,90);
            p.AddArc(r.Right-d,r.Bottom-d,d,d,0,90); p.AddArc(r.Left,r.Bottom-d,d,d,90,90); p.CloseFigure(); return p;
        }
    }
}
