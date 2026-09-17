using System.Drawing.Drawing2D;

namespace LaserBench;

internal static class UiTheme
{
    // LaserBench v0.2 light instrument theme: quiet shell, white plots, restrained status color.
    public static readonly Color Back = Color.FromArgb(242, 247, 251);
    public static readonly Color Surface = Color.FromArgb(248, 251, 253);
    public static readonly Color ModuleBack = Color.FromArgb(250, 252, 254);
    public static readonly Color Toolbar = Color.FromArgb(247, 250, 252);
    public static readonly Color Sidebar = Color.FromArgb(236, 243, 248);
    public static readonly Color PlotBack = Color.White;
    public static readonly Color Ink = Color.FromArgb(34, 50, 64);
    public static readonly Color Muted = Color.FromArgb(104, 122, 139);
    public static readonly Color Muted2 = Color.FromArgb(137, 153, 168);
    public static readonly Color Divider = Color.FromArgb(198, 212, 224);
    public static readonly Color Border = Color.FromArgb(158, 178, 195);
    public static readonly Color Grid = Color.FromArgb(224, 233, 241);
    public static readonly Color Axis = Color.FromArgb(133, 151, 168);
    public static readonly Color Accent = Color.FromArgb(37, 128, 194);
    public static readonly Color Accent2 = Color.FromArgb(75, 165, 205);
    public static readonly Color Green = Color.FromArgb(45, 160, 104);
    public static readonly Color Red = Color.FromArgb(207, 66, 66);
    public static readonly Color GrayOff = Color.FromArgb(155, 167, 178);
    public static readonly Color Orange = Color.FromArgb(223, 135, 54);

    public static readonly Font Micro = new("Segoe UI", 7.0f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font Tiny = new("Segoe UI", 7.5f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font Small = new("Segoe UI", 8.25f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font SmallBold = new("Segoe UI Semibold", 8.25f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font Value = new("Segoe UI", 9.25f, FontStyle.Regular, GraphicsUnit.Point);
    public static readonly Font ValueBold = new("Segoe UI Semibold", 9.5f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font Metric = new("Segoe UI Semibold", 12.0f, FontStyle.Bold, GraphicsUnit.Point);
    public static readonly Font MetricLarge = new("Segoe UI Semibold", 14.5f, FontStyle.Bold, GraphicsUnit.Point);
}

internal enum GlyphKind
{
    Dashboard,
    Power,
    Spectrum,
    Beam,
    Scope,
    Data,
    Settings,
    Camera,
    Record,
    Capture,
    Stop,
    Check,
    Clear,
    Expand
}

internal static class GlyphPainter
{
    public static void Draw(Graphics g, GlyphKind glyph, Rectangle bounds, Color color, float width = 1.6f)
    {
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var pen = new Pen(color, width)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };
        var r = Rectangle.Inflate(bounds, -3, -3);
        var cx = r.Left + r.Width / 2f;
        var cy = r.Top + r.Height / 2f;

        switch (glyph)
        {
            case GlyphKind.Dashboard:
                var s = Math.Max(3, r.Width / 4);
                g.DrawRectangle(pen, r.Left + 1, r.Top + 1, s, s);
                g.DrawRectangle(pen, r.Right - s - 1, r.Top + 1, s, s);
                g.DrawRectangle(pen, r.Left + 1, r.Bottom - s - 1, s, s);
                g.DrawRectangle(pen, r.Right - s - 1, r.Bottom - s - 1, s, s);
                break;
            case GlyphKind.Power:
                g.DrawLines(pen, new[]
                {
                    new PointF(r.Left, cy + 2),
                    new PointF(r.Left + r.Width * .22f, cy + 2),
                    new PointF(r.Left + r.Width * .38f, r.Top + r.Height * .22f),
                    new PointF(r.Left + r.Width * .53f, r.Bottom - r.Height * .18f),
                    new PointF(r.Left + r.Width * .70f, cy - 1),
                    new PointF(r.Right, cy - 1)
                });
                break;
            case GlyphKind.Spectrum:
                using (var path = new GraphicsPath())
                {
                    path.AddBezier(r.Left, r.Bottom - 2, r.Left + r.Width * .24f, r.Bottom - 2, r.Left + r.Width * .35f, r.Top + 2, cx, r.Top + 1);
                    path.AddBezier(cx, r.Top + 1, r.Left + r.Width * .65f, r.Top + 2, r.Left + r.Width * .76f, r.Bottom - 2, r.Right, r.Bottom - 2);
                    g.DrawPath(pen, path);
                }
                break;
            case GlyphKind.Beam:
                g.DrawEllipse(pen, RectangleF.Inflate(r, -2, -2));
                g.DrawEllipse(pen, cx - r.Width * .20f, cy - r.Height * .20f, r.Width * .40f, r.Height * .40f);
                break;
            case GlyphKind.Scope:
                using (var path = new GraphicsPath())
                {
                    path.AddBezier(r.Left, cy, r.Left + r.Width * .18f, r.Top, r.Left + r.Width * .34f, r.Top, cx, cy);
                    path.AddBezier(cx, cy, r.Left + r.Width * .66f, r.Bottom, r.Left + r.Width * .82f, r.Bottom, r.Right, cy);
                    g.DrawPath(pen, path);
                }
                break;
            case GlyphKind.Data:
                g.DrawRectangle(pen, r.Left + 1, r.Top + r.Height * .25f, r.Width - 2, r.Height * .62f);
                g.DrawLine(pen, r.Left + 2, r.Top + r.Height * .25f, r.Left + r.Width * .38f, r.Top + 1);
                g.DrawLine(pen, r.Left + r.Width * .38f, r.Top + 1, r.Right - 1, r.Top + 1);
                break;
            case GlyphKind.Settings:
                g.DrawEllipse(pen, cx - 3, cy - 3, 6, 6);
                for (var i = 0; i < 8; i++)
                {
                    var a = i * Math.PI / 4.0;
                    var p1 = new PointF(cx + (float)Math.Cos(a) * (r.Width * .30f), cy + (float)Math.Sin(a) * (r.Height * .30f));
                    var p2 = new PointF(cx + (float)Math.Cos(a) * (r.Width * .43f), cy + (float)Math.Sin(a) * (r.Height * .43f));
                    g.DrawLine(pen, p1, p2);
                }
                break;
            case GlyphKind.Camera:
                g.DrawRectangle(pen, r.Left + 1, r.Top + r.Height * .28f, r.Width - 2, r.Height * .58f);
                g.DrawRectangle(pen, r.Left + r.Width * .18f, r.Top + 1, r.Width * .28f, r.Height * .24f);
                g.DrawEllipse(pen, cx - 3, cy - 1, 6, 6);
                break;
            case GlyphKind.Record:
                using (var brush = new SolidBrush(color))
                    g.FillEllipse(brush, cx - 4, cy - 4, 8, 8);
                break;
            case GlyphKind.Capture:
                using (var brush = new SolidBrush(color))
                {
                    var pts = new[]
                    {
                        new PointF(r.Left + 3, r.Top + 2),
                        new PointF(r.Right - 1, cy),
                        new PointF(r.Left + 3, r.Bottom - 2)
                    };
                    g.FillPolygon(brush, pts);
                }
                break;
            case GlyphKind.Stop:
                using (var brush = new SolidBrush(color))
                    g.FillRectangle(brush, cx - 4.5f, cy - 4.5f, 9, 9);
                break;
            case GlyphKind.Check:
                g.DrawLines(pen, new[]
                {
                    new PointF(r.Left + 2, cy),
                    new PointF(cx - 1, r.Bottom - 3),
                    new PointF(r.Right - 2, r.Top + 3)
                });
                break;
            case GlyphKind.Clear:
                g.DrawLine(pen, r.Left + 2, r.Top + 2, r.Right - 2, r.Bottom - 2);
                g.DrawLine(pen, r.Right - 2, r.Top + 2, r.Left + 2, r.Bottom - 2);
                break;
            case GlyphKind.Expand:
                g.DrawLine(pen, r.Left + 2, r.Top + 6, r.Left + 2, r.Top + 2);
                g.DrawLine(pen, r.Left + 2, r.Top + 2, r.Left + 6, r.Top + 2);
                g.DrawLine(pen, r.Right - 2, r.Bottom - 6, r.Right - 2, r.Bottom - 2);
                g.DrawLine(pen, r.Right - 2, r.Bottom - 2, r.Right - 6, r.Bottom - 2);
                break;
        }
    }

    public static GlyphKind ForModule(ModuleKind kind) => kind switch
    {
        ModuleKind.Power => GlyphKind.Power,
        ModuleKind.Spectrum => GlyphKind.Spectrum,
        ModuleKind.Beam => GlyphKind.Beam,
        _ => GlyphKind.Scope
    };
}

internal sealed class GlyphButton : Control
{
    private bool _hover;
    public GlyphKind Glyph { get; set; }
    public bool Active { get; set; }
    public bool Danger { get; set; }
    public bool Filled { get; set; }

    public GlyphButton(GlyphKind glyph)
    {
        Glyph = glyph;
        Size = new Size(26, 26);
        Cursor = Cursors.Hand;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        MouseEnter += (_, _) => { _hover = true; Invalidate(); };
        MouseLeave += (_, _) => { _hover = false; Invalidate(); };
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var color = Danger ? UiTheme.Red : Active ? UiTheme.Green : UiTheme.Muted;
        if (_hover || Filled)
        {
            using var back = new SolidBrush(Color.FromArgb(_hover ? 25 : 17, color));
            e.Graphics.FillRoundedRectangle(back, ClientRectangle.InflateCopy(-2, -2), 4);
        }
        GlyphPainter.Draw(e.Graphics, Glyph, ClientRectangle, color, 1.55f);
    }

    protected override void OnClick(EventArgs e)
    {
        base.OnClick(e);
        Invalidate();
    }
}

internal sealed class CompactSlider : Control
{
    private bool _dragging;
    private double _value;
    public double Minimum { get; set; }
    public double Maximum { get; set; } = 100;
    public event EventHandler? ValueChanged;

    public double Value
    {
        get => _value;
        set
        {
            var next = Math.Clamp(value, Minimum, Maximum);
            if (Math.Abs(next - _value) < 1e-9) return;
            _value = next;
            Invalidate();
            ValueChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public CompactSlider()
    {
        Height = 20;
        Cursor = Cursors.Hand;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var y = Height / 2f;
        using var track = new Pen(UiTheme.Divider, 2f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        e.Graphics.DrawLine(track, 5, y, Width - 5, y);
        var t = Maximum <= Minimum ? 0 : (Value - Minimum) / (Maximum - Minimum);
        var x = 5f + (float)t * Math.Max(1, Width - 10);
        using var fill = new Pen(UiTheme.Accent, 2.1f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        e.Graphics.DrawLine(fill, 5, y, x, y);
        using var thumb = new SolidBrush(UiTheme.Accent);
        e.Graphics.FillEllipse(thumb, x - 3.5f, y - 3.5f, 7, 7);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left)
        {
            _dragging = true;
            SetFromX(e.X);
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (_dragging) SetFromX(e.X);
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        _dragging = false;
    }

    private void SetFromX(int x)
    {
        var t = Math.Clamp((x - 5.0) / Math.Max(1, Width - 10), 0, 1);
        Value = Minimum + t * (Maximum - Minimum);
    }
}

internal static class GraphicsExtensions
{
    public static Rectangle InflateCopy(this Rectangle rectangle, int dx, int dy)
    {
        var copy = rectangle;
        copy.Inflate(dx, dy);
        return copy;
    }

    public static void FillRoundedRectangle(this Graphics graphics, Brush brush, Rectangle rectangle, int radius)
    {
        if (rectangle.Width <= 0 || rectangle.Height <= 0) return;
        using var path = new GraphicsPath();
        var d = Math.Min(radius * 2, Math.Min(rectangle.Width, rectangle.Height));
        path.AddArc(rectangle.Left, rectangle.Top, d, d, 180, 90);
        path.AddArc(rectangle.Right - d, rectangle.Top, d, d, 270, 90);
        path.AddArc(rectangle.Right - d, rectangle.Bottom - d, d, d, 0, 90);
        path.AddArc(rectangle.Left, rectangle.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        graphics.FillPath(brush, path);
    }
}
