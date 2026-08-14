using System.Reflection;

namespace DavBridge;

internal sealed class PrimaryActionSurfaceV0217 : Control
{
    private readonly TransportActionButtonV027 _source;
    private TransportActionKindV027 _kind = TransportActionKindV027.Play;
    private string _label = "继续";
    private bool _hover;
    private bool _pressed;

    public PrimaryActionSurfaceV0217(TransportActionButtonV027 source)
    {
        _source = source;
        Width = UiGeometryV0217.PrimaryButtonWidth;
        Height = UiGeometryV0217.PrimaryButtonHeight;
        BackColor = Color.White;
        Font = source.Font;
        TabStop = false;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable, true);
        SyncFromSource();
    }

    public void SyncFromSource()
    {
        try
        {
            var type = typeof(TransportActionButtonV027);
            _kind = (TransportActionKindV027)(type.GetField("_kind", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_source) ?? TransportActionKindV027.Play);
            _label = type.GetField("_label", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_source) as string ?? "继续";
        }
        catch { }
        Enabled = _source.Enabled;
        Cursor = Enabled && _kind is TransportActionKindV027.Play or TransportActionKindV027.Pause ? Cursors.Hand : Cursors.Default;
        Invalidate();
    }

    protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); _hover = true; Invalidate(); }
    protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); _hover = false; _pressed = false; Invalidate(); }
    protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); if (e.Button == MouseButtons.Left) { _pressed = true; Invalidate(); } }
    protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); _pressed = false; Invalidate(); }

    protected override void OnClick(EventArgs e)
    {
        base.OnClick(e);
        if (!Enabled) return;
        try
        {
            typeof(Control).GetMethod("OnClick", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_source, new object[] { EventArgs.Empty });
        }
        catch { }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
        var fill = !Enabled ? Color.FromArgb(249, 250, 251) : _pressed ? Color.FromArgb(237, 244, 249) : _hover ? Color.FromArgb(245, 249, 252) : Color.White;
        using var bg = new SolidBrush(fill);
        using var border = new Pen(Color.FromArgb(199, 210, 219));
        e.Graphics.FillRectangle(bg, rect);
        e.Graphics.DrawRectangle(border, rect);

        var ink = Enabled ? Color.FromArgb(46, 67, 82) : Color.FromArgb(150, 157, 163);
        var measured = TextRenderer.MeasureText(e.Graphics, _label, Font, new Size(int.MaxValue, Height), TextFormatFlags.SingleLine | TextFormatFlags.NoPadding);
        const int iconWidth = 16;
        const int gap = 7;
        var groupWidth = iconWidth + gap + measured.Width;
        var startX = Math.Max(10, (Width - groupWidth) / 2);
        var iconCenter = new Point(startX + iconWidth / 2, Height / 2);
        DrawIcon(e.Graphics, iconCenter, ink);
        var textRect = new Rectangle(startX + iconWidth + gap, 0, Math.Max(1, Width - startX - iconWidth - gap - 8), Height);
        TextRenderer.DrawText(e.Graphics, _label, Font, textRect, ink,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
    }

    private void DrawIcon(Graphics g, Point c, Color ink)
    {
        using var brush = new SolidBrush(ink);
        using var pen = new Pen(ink, 2f) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round };
        switch (_kind)
        {
            case TransportActionKindV027.Pause:
                g.FillRectangle(brush, c.X - 6, c.Y - 7, 4, 14);
                g.FillRectangle(brush, c.X + 2, c.Y - 7, 4, 14);
                break;
            case TransportActionKindV027.Busy:
                g.DrawArc(pen, c.X - 7, c.Y - 7, 14, 14, 30, 250);
                break;
            default:
                g.FillPolygon(brush, new[] { new Point(c.X - 5, c.Y - 8), new Point(c.X - 5, c.Y + 8), new Point(c.X + 8, c.Y) });
                break;
        }
    }
}
