using System.Drawing.Drawing2D;
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
        Font = new Font("Microsoft YaHei UI", 9F);
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
        Cursor = Enabled && _kind is TransportActionKindV027.Play or TransportActionKindV027.Pause
            ? Cursors.Hand
            : Cursors.Default;
        Invalidate();
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        base.OnMouseEnter(e);
        _hover = true;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        _hover = false;
        _pressed = false;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && Enabled)
        {
            _pressed = true;
            Invalidate();
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        _pressed = false;
        Invalidate();
    }

    protected override void OnClick(EventArgs e)
    {
        base.OnClick(e);
        if (!Enabled) return;
        try
        {
            typeof(Control).GetMethod("OnClick", BindingFlags.Instance | BindingFlags.NonPublic)
                ?.Invoke(_source, new object[] { EventArgs.Empty });
        }
        catch { }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? Color.White);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        var rect = new RectangleF(.5f, .5f, Math.Max(1, Width - 1.5f), Math.Max(1, Height - 1.5f));
        var palette = ResolvePalette();
        var fill = !Enabled
            ? palette.Disabled
            : _pressed
                ? palette.Pressed
                : _hover
                    ? palette.Hover
                    : palette.Normal;

        using var path = Rounded(rect, 6f);
        using var background = new SolidBrush(fill);
        using var border = new Pen(Enabled ? palette.Border : Color.FromArgb(220, 225, 228), 1f);
        e.Graphics.FillPath(background, path);
        e.Graphics.DrawPath(border, path);

        var ink = Enabled ? palette.Ink : Color.FromArgb(143, 151, 157);

        if (_kind == TransportActionKindV027.None)
        {
            TextRenderer.DrawText(e.Graphics, _label, Font, Rectangle.Round(rect), ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            return;
        }

        var measured = TextRenderer.MeasureText(_label, Font, new Size(int.MaxValue, Height), TextFormatFlags.SingleLine);
        const int iconWidth = 15;
        const int gap = 7;
        var groupWidth = iconWidth + gap + measured.Width;
        var startX = Math.Max(10, (Width - groupWidth) / 2);
        var iconCenter = new Point(startX + iconWidth / 2, Height / 2);
        DrawIcon(e.Graphics, iconCenter, ink);

        var textRect = new Rectangle(startX + iconWidth + gap, 0, Math.Max(1, Width - startX - iconWidth - gap - 8), Height);
        TextRenderer.DrawText(e.Graphics, _label, Font, textRect, ink,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    }

    private ActionPalette ResolvePalette() => _kind switch
    {
        TransportActionKindV027.Pause => new ActionPalette(
            Color.FromArgb(238, 245, 248),
            Color.FromArgb(229, 239, 244),
            Color.FromArgb(219, 232, 239),
            Color.FromArgb(246, 248, 249),
            Color.FromArgb(179, 202, 214),
            Color.FromArgb(59, 95, 113)),
        TransportActionKindV027.Busy => new ActionPalette(
            Color.FromArgb(240, 245, 247),
            Color.FromArgb(232, 239, 242),
            Color.FromArgb(226, 235, 239),
            Color.FromArgb(246, 248, 249),
            Color.FromArgb(187, 201, 209),
            Color.FromArgb(77, 96, 107)),
        TransportActionKindV027.None => new ActionPalette(
            Color.FromArgb(246, 248, 249),
            Color.FromArgb(246, 248, 249),
            Color.FromArgb(246, 248, 249),
            Color.FromArgb(246, 248, 249),
            Color.FromArgb(220, 225, 228),
            Color.FromArgb(132, 142, 149)),
        _ => new ActionPalette(
            Color.FromArgb(236, 246, 250),
            Color.FromArgb(226, 239, 245),
            Color.FromArgb(214, 233, 242),
            Color.FromArgb(246, 248, 249),
            Color.FromArgb(176, 204, 219),
            Color.FromArgb(51, 99, 124))
    };

    private void DrawIcon(Graphics g, Point c, Color ink)
    {
        using var brush = new SolidBrush(ink);
        using var pen = new Pen(ink, 1.9f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round
        };

        switch (_kind)
        {
            case TransportActionKindV027.Pause:
                g.FillRectangle(brush, c.X - 6, c.Y - 6, 3, 12);
                g.FillRectangle(brush, c.X + 2, c.Y - 6, 3, 12);
                break;
            case TransportActionKindV027.Busy:
                g.DrawArc(pen, c.X - 6, c.Y - 6, 12, 12, 35, 245);
                break;
            default:
                g.FillPolygon(brush, new[]
                {
                    new Point(c.X - 4, c.Y - 7),
                    new Point(c.X - 4, c.Y + 7),
                    new Point(c.X + 7, c.Y)
                });
                break;
        }
    }

    private static GraphicsPath Rounded(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var d = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private sealed record ActionPalette(
        Color Normal,
        Color Hover,
        Color Pressed,
        Color Disabled,
        Color Border,
        Color Ink);
}
