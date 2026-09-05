using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Reflection;

namespace DavBridge;

internal sealed class UiMeterPolishV0219 : IDisposable
{
    private readonly List<Surface> _surfaces = new();
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 120 };
    private bool _disposed;

    private UiMeterPolishV0219(UiDashboardV027 dashboard)
    {
        AttachBar(dashboard, "_overallBar", MeterKind.Overall, 8.4F);
        AttachBar(dashboard, "_currentBar", MeterKind.Current, 8.5F);
        AttachBar(dashboard, "_uploadBar", MeterKind.Quota, 8.3F);
        AttachBar(dashboard, "_downloadBar", MeterKind.Quota, 8.3F);
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
    }

    public static UiMeterPolishV0219 Attach(UiDashboardV027 dashboard) => new(dashboard);

    private void AttachBar(UiDashboardV027 dashboard, string fieldName, MeterKind kind, float fontSize)
    {
        var bar = typeof(UiDashboardV027)
            .GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic)?
            .GetValue(dashboard) as GradientMeterBar;
        if (bar is null) return;

        foreach (Control child in bar.Controls.Cast<Control>().ToArray())
        {
            bar.Controls.Remove(child);
            child.Dispose();
        }

        bar.Font = new Font("Microsoft YaHei UI", fontSize);
        var surface = new Surface(bar, kind)
        {
            Dock = DockStyle.Fill,
            Margin = Padding.Empty,
            TabStop = false
        };
        bar.Controls.Add(surface);
        surface.BringToFront();
        _surfaces.Add(surface);
    }

    private void Refresh()
    {
        if (_disposed) return;
        foreach (var surface in _surfaces)
            if (!surface.IsDisposed) surface.Invalidate();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        foreach (var surface in _surfaces)
            if (!surface.IsDisposed) surface.Dispose();
        _surfaces.Clear();
    }

    private enum MeterKind { Overall, Current, Quota }

    private sealed class Surface : Control
    {
        private readonly GradientMeterBar _source;
        private readonly MeterKind _kind;

        public Surface(GradientMeterBar source, MeterKind kind)
        {
            _source = source;
            _kind = kind;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.White;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent?.BackColor ?? Color.White);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            var rect = new RectangleF(.5f, .5f, Math.Max(1, Width - 1.5f), Math.Max(1, Height - 1.5f));
            using var path = Rounded(rect, Math.Min(5f, rect.Height / 2f));
            using var track = new SolidBrush(Color.FromArgb(244, 246, 248));
            e.Graphics.FillPath(track, path);

            var reserveWidth = _kind == MeterKind.Quota ? (float)(rect.Width * _source.ReserveFraction) : 0f;
            if (reserveWidth > .5f)
            {
                using var reserve = new SolidBrush(Color.FromArgb(217, 222, 227));
                e.Graphics.SetClip(path);
                e.Graphics.FillRectangle(reserve, rect.Right - reserveWidth, rect.Top, reserveWidth, rect.Height);
                e.Graphics.ResetClip();
            }

            var usableWidth = Math.Max(1f, rect.Width - reserveWidth);
            if (_source.Pulse)
                DrawPulse(e.Graphics, rect, path, usableWidth);
            else
                DrawFill(e.Graphics, rect, path, usableWidth);

            using var border = new Pen(Color.FromArgb(210, 216, 222), 1f);
            e.Graphics.DrawPath(border, path);
            DrawCenteredText(e.Graphics, rect);
        }

        private void DrawFill(Graphics g, RectangleF rect, GraphicsPath path, float usableWidth)
        {
            var fillWidth = Math.Min(usableWidth, (float)(rect.Width * _source.Fraction));
            if (fillWidth <= .5f) return;
            var fillRect = new RectangleF(rect.Left, rect.Top, fillWidth, rect.Height);
            var (light, dark) = Colors();
            using var fill = new LinearGradientBrush(fillRect, light, dark, LinearGradientMode.Horizontal);
            g.SetClip(path);
            g.FillRectangle(fill, fillRect);
            g.ResetClip();
        }

        private void DrawPulse(Graphics g, RectangleF rect, GraphicsPath path, float usableWidth)
        {
            var offset = typeof(GradientMeterBar)
                .GetField("_pulseOffset", BindingFlags.Instance | BindingFlags.NonPublic)?
                .GetValue(_source) is int p ? p : 0;
            var segment = Math.Max(48f, usableWidth * .26f);
            var x = rect.Left + (offset / 140f) * (usableWidth + segment) - segment;
            var pulseRect = RectangleF.Intersect(rect, new RectangleF(x, rect.Top, segment, rect.Height));
            if (pulseRect.Width <= 0) return;

            var (_, dark) = Colors();
            var pale = _kind == MeterKind.Overall ? Color.FromArgb(241, 238, 250) : Color.FromArgb(232, 247, 255);
            using var brush = new LinearGradientBrush(pulseRect, pale, pale, LinearGradientMode.Horizontal)
            {
                InterpolationColors = new ColorBlend
                {
                    Colors = new[] { Color.FromArgb(244, 246, 248), pale, dark, pale, Color.FromArgb(244, 246, 248) },
                    Positions = new[] { 0f, .18f, .5f, .82f, 1f }
                }
            };
            g.SetClip(path);
            g.FillRectangle(brush, pulseRect);
            g.ResetClip();
        }

        private (Color Light, Color Dark) Colors()
        {
            if (_kind == MeterKind.Overall)
                return (Color.FromArgb(241, 238, 250), Color.FromArgb(143, 127, 187));
            if (_kind == MeterKind.Current)
                return (Color.FromArgb(238, 249, 255), Color.FromArgb(79, 168, 229));
            if (_source.Fraction >= .90)
                return (Color.FromArgb(255, 241, 241), Color.FromArgb(220, 66, 66));
            if (_source.Fraction >= .60)
                return (Color.FromArgb(255, 249, 220), Color.FromArgb(227, 164, 31));
            return (Color.FromArgb(239, 252, 246), Color.FromArgb(37, 157, 94));
        }

        private void DrawCenteredText(Graphics g, RectangleF rect)
        {
            if (string.IsNullOrWhiteSpace(_source.BarText)) return;
            using var brush = new SolidBrush(Color.FromArgb(53, 61, 68));
            using var format = new StringFormat(StringFormat.GenericTypographic)
            {
                Alignment = StringAlignment.Center,
                LineAlignment = StringAlignment.Center,
                FormatFlags = StringFormatFlags.NoWrap,
                Trimming = StringTrimming.EllipsisCharacter
            };
            var textRect = RectangleF.Inflate(rect, -4f, 0f);
            g.DrawString(_source.BarText, _source.Font, brush, textRect, format);
        }

        private static GraphicsPath Rounded(RectangleF rect, float radius)
        {
            var path = new GraphicsPath();
            var d = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
            if (d <= 1)
            {
                path.AddRectangle(rect);
                path.CloseFigure();
                return path;
            }
            path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
