namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private sealed partial class RouteSurface
    {
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Color.White);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var left = Read("_left") as string ?? "InfiniCLOUD";
            var right = Read("_right") as string ?? "坚果云";
            var status = Read("_status") as string ?? "已暂停";
            var recent = Read("_recent") as string ?? string.Empty;
            var kind = Read("_kind") is UiStatusKind k ? k : UiStatusKind.Paused;
            using var nameFont = new Font("Segoe UI Semibold", 9.5F);
            using var statusFont = new Font("Segoe UI Semibold", 9.2F);
            using var smallFont = new Font("Segoe UI", 8.2F);
            const float cy = 66f;
            const float icon = 34f;
            DrawInfini(e.Graphics, new RectangleF(6, cy - 17, icon, icon));
            DrawAcorn(e.Graphics, new RectangleF(Width - 40, cy - 17, icon, icon));
            TextRenderer.DrawText(e.Graphics, left, nameFont, new Rectangle(46, 53, 112, 26), Color.FromArgb(45,52,58), TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            TextRenderer.DrawText(e.Graphics, right, nameFont, new Rectangle(Width - 158, 53, 112, 26), Color.FromArgb(45,52,58), TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            var w = Math.Clamp(Width * .36f, 185f, 225f);
            var rect = new RectangleF((Width - w) / 2f, 50, w, 31);
            using var path = Rounded(rect, 15.5f);
            var colors = FlowColors(kind);
            using var brush = new System.Drawing.Drawing2D.LinearGradientBrush(rect.Location, new PointF(rect.Right, rect.Top), colors.Item1, colors.Item2);
            e.Graphics.FillPath(brush, path);
            TextRenderer.DrawText(e.Graphics, status, statusFont, Rectangle.Round(rect), Color.White, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            using var chevron = new Pen(Color.FromArgb(235,255,255,255), 2f) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round };
            e.Graphics.DrawLines(chevron, new[] { new PointF(rect.Right-19,60), new PointF(rect.Right-13,65.5f), new PointF(rect.Right-19,71) });
            if (!string.IsNullOrWhiteSpace(recent)) TextRenderer.DrawText(e.Graphics, recent, smallFont, new Rectangle((int)rect.Left, 12, (int)rect.Width, 20), Color.FromArgb(126,136,145), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }
}
