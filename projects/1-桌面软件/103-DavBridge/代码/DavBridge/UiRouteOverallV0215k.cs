using System.Drawing.Drawing2D;
namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private sealed partial class RouteSurface
    {
        private static void DrawInfini(Graphics g, RectangleF r)
        {
            using var p = new Pen(Color.FromArgb(239,132,0), 4.4f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            var w = r.Width * .58f; var top = r.Top + r.Height * .22f; var h = r.Height * .56f;
            g.DrawArc(p, new RectangleF(r.Left,top,w,h),36,288); g.DrawArc(p, new RectangleF(r.Right-w,top,w,h),216,288);
        }
        private static void DrawAcorn(Graphics g, RectangleF r)
        {
            var body = new RectangleF(r.Left+7,r.Top+10,r.Width-14,r.Height-11);
            using var b = new LinearGradientBrush(body, Color.FromArgb(241,201,121), Color.FromArgb(171,100,47), 50f);
            using var e = new Pen(Color.FromArgb(140,82,44),1.1f); g.FillEllipse(b,body); g.DrawEllipse(e,body);
            using var cap = new SolidBrush(Color.FromArgb(147,88,46)); g.FillEllipse(cap,r.Left+5,r.Top+5,r.Width-10,9);
            using var stem = new Pen(Color.FromArgb(111,71,41),2.2f) { StartCap=LineCap.Round,EndCap=LineCap.Round };
            g.DrawLine(stem,r.Right-9,r.Top+7,r.Right-3,r.Top+1);
        }
    }
}
