using System.Drawing.Drawing2D;
using System.Reflection;

namespace DavBridge;

internal sealed class UiCurrentPulsePolishV0214 : IDisposable
{
    private readonly GradientMeterBar _bar;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 160 };
    private Control? _surface;
    private bool _disposed;

    private UiCurrentPulsePolishV0214(UiDashboardV027 dashboard)
    {
        _bar = typeof(UiDashboardV027).GetField("_currentBar", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(dashboard) as GradientMeterBar
            ?? throw new InvalidOperationException("Current meter unavailable.");
        foreach (var child in _bar.Controls.Cast<Control>().ToArray())
        {
            if (child.GetType().Name != "MeterSurface") continue;
            _bar.Controls.Remove(child);
            child.Dispose();
        }
        _surface = new Surface(_bar) { Dock = DockStyle.Fill, TabStop = false };
        _bar.Controls.Add(_surface);
        _surface.BringToFront();
        _timer.Tick += (_, _) => { if (_surface is { IsDisposed: false }) _surface.Invalidate(); };
        _timer.Start();
    }

    public static UiCurrentPulsePolishV0214 Attach(UiDashboardV027 dashboard) => new(dashboard);

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        if (_surface is { IsDisposed: false }) _surface.Dispose();
    }

    private sealed class Surface : Control
    {
        private readonly GradientMeterBar _source;
        public Surface(GradientMeterBar source)
        {
            _source = source;
            Font = source.Font;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.White;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent?.BackColor ?? Color.White);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new RectangleF(.5f, .5f, Math.Max(1, Width - 1.5f), Math.Max(1, Height - 1.5f));
            using var path = Rounded(rect, Math.Min(5f, rect.Height / 2f));
            var trackColor = Color.FromArgb(243, 246, 248);
            using var track = new SolidBrush(trackColor);
            e.Graphics.FillPath(track, path);

            if (_source.Pulse) DrawPulse(e.Graphics, rect, path, trackColor);
            else DrawFill(e.Graphics, rect, path);

            using var border = new Pen(Color.FromArgb(214, 220, 225));
            e.Graphics.DrawPath(border, path);
            if (!string.IsNullOrWhiteSpace(_source.BarText))
                TextRenderer.DrawText(e.Graphics, _source.BarText, Font, Rectangle.Round(rect), Color.FromArgb(55, 63, 70),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        }

        private void DrawPulse(Graphics g, RectangleF rect, GraphicsPath path, Color track)
        {
            var offset = typeof(GradientMeterBar).GetField("_pulseOffset", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_source) is int p ? p : 0;
            var segment = Math.Max(52f, rect.Width * .26f);
            var x = rect.Left + (offset / 140f) * (rect.Width + segment) - segment;
            var pulseRect = RectangleF.Intersect(rect, new RectangleF(x, rect.Top, segment, rect.Height));
            if (pulseRect.Width <= 0) return;
            using var brush = new LinearGradientBrush(pulseRect, track, track, LinearGradientMode.Horizontal);
            brush.InterpolationColors = new ColorBlend
            {
                Colors = new[] { track, Color.FromArgb(232, 247, 255), Color.FromArgb(91, 176, 232), Color.FromArgb(232, 247, 255), track },
                Positions = new[] { 0f, .18f, .5f, .82f, 1f }
            };
            g.SetClip(path);
            g.FillRectangle(brush, pulseRect);
            g.ResetClip();
        }

        private void DrawFill(Graphics g, RectangleF rect, GraphicsPath path)
        {
            var width = Math.Min(rect.Width, (float)(rect.Width * _source.Fraction));
            if (width <= .5f) return;
            var fillRect = new RectangleF(rect.Left, rect.Top, width, rect.Height);
            using var fill = new LinearGradientBrush(fillRect, Color.FromArgb(239, 249, 255), Color.FromArgb(83, 170, 230), LinearGradientMode.Horizontal);
            g.SetClip(path);
            g.FillRectangle(fill, fillRect);
            g.ResetClip();
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
    }
}
