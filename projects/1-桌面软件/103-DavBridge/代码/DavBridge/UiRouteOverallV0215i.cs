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
            using var nameFont = new Font("Segoe UI Semibold", 9.7F);
            using var statusFont = new Font("Segoe UI Semibold", 9.4F);
            using var smallFont = new Font("Segoe UI", 8.2F);
            const float cy = 68f;
            const float icon = 50f;
            var arrowWidth = Math.Clamp(Width * .31f, 178f, 216f);
            var arrow = new RectangleF((Width - arrowWidth) / 2f, 49f, arrowWidth, 36f);
            var tip = Math.Min(15f, arrow.Height * .42f);
            var leftIcon = new RectangleF(3f, cy - icon / 2f, icon, icon);
            var rightIcon = new RectangleF(Width - icon - 3f, cy - icon / 2f, icon, icon);
            DrawInfini(e.Graphics, leftIcon);
            DrawAcorn(e.Graphics, rightIcon);
            var leftTextLeft = (int)leftIcon.Right + 4;
            var leftTextRight = (int)arrow.Left - 9;
            var rightTextLeft = (int)arrow.Right + 9;
            var rightTextRight = (int)rightIcon.Left - 4;
            TextRenderer.DrawText(e.Graphics, left, nameFont,
                new Rectangle(leftTextLeft, 54, Math.Max(20, leftTextRight - leftTextLeft), 28),
                Color.FromArgb(45, 52, 58), TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(e.Graphics, right, nameFont,
                new Rectangle(rightTextLeft, 54, Math.Max(20, rightTextRight - rightTextLeft), 28),
                Color.FromArgb(45, 52, 58), TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            using var path = new System.Drawing.Drawing2D.GraphicsPath();
            path.AddPolygon(new[]
            {
                new PointF(arrow.Left, arrow.Top),
                new PointF(arrow.Right - tip, arrow.Top),
                new PointF(arrow.Right, arrow.Top + arrow.Height / 2f),
                new PointF(arrow.Right - tip, arrow.Bottom),
                new PointF(arrow.Left, arrow.Bottom),
                new PointF(arrow.Left + tip, arrow.Top + arrow.Height / 2f)
            });
            var colors = FlowColors(kind);
            using var brush = new System.Drawing.Drawing2D.LinearGradientBrush(arrow.Location, new PointF(arrow.Right, arrow.Top), colors.Item1, colors.Item2);
            e.Graphics.FillPath(brush, path);
            TextRenderer.DrawText(e.Graphics, status, statusFont, Rectangle.Round(arrow), Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            if (!string.IsNullOrWhiteSpace(recent))
                TextRenderer.DrawText(e.Graphics, recent, smallFont,
                    new Rectangle((int)arrow.Left - 12, 12, (int)arrow.Width + 24, 21),
                    Color.FromArgb(126, 136, 145), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }
}
