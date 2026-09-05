namespace DavBridge;
internal sealed partial class UiMessageBarV0216
{
    private sealed partial class MessageSurface
    {
        private static void DrawSpeaker(Graphics g, RectangleF r, Color color)
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var brush = new SolidBrush(color);
            using var pen = new Pen(color,1.5f) { StartCap=System.Drawing.Drawing2D.LineCap.Round, EndCap=System.Drawing.Drawing2D.LineCap.Round };
            var horn = new[]
            {
                new PointF(r.Left,r.Top+r.Height*.38f),
                new PointF(r.Left+r.Width*.30f,r.Top+r.Height*.38f),
                new PointF(r.Left+r.Width*.58f,r.Top+r.Height*.16f),
                new PointF(r.Left+r.Width*.58f,r.Bottom-r.Height*.16f),
                new PointF(r.Left+r.Width*.30f,r.Bottom-r.Height*.38f),
                new PointF(r.Left,r.Bottom-r.Height*.38f)
            };
            g.FillPolygon(brush,horn);
            g.DrawArc(pen,r.Left+r.Width*.48f,r.Top+r.Height*.28f,r.Width*.35f,r.Height*.44f,-55,110);
            g.DrawArc(pen,r.Left+r.Width*.48f,r.Top+r.Height*.12f,r.Width*.53f,r.Height*.76f,-50,100);
        }
    }
}
