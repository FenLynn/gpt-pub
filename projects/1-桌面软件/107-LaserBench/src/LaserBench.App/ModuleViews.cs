using System.Drawing.Drawing2D;

namespace LaserBench;

internal abstract class ModuleViewBase : UserControl
{
    private Point _dragStart;
    private bool _dragCandidate;

    protected readonly IInstrumentProvider Provider;
    protected readonly AppConfig Config;
    public ModuleKind Kind { get; }
    public event Action<ModuleKind>? OpenRequested;
    public event Action<ModuleKind, Point>? FloatRequested;

    protected ModuleViewBase(ModuleKind kind, IInstrumentProvider provider, AppConfig config)
    {
        Kind = kind;
        Provider = provider;
        Config = config;
        BackColor = UiTheme.Back;
        Margin = Padding.Empty;
        Padding = Padding.Empty;
        DoubleBuffered = true;
        Cursor = Cursors.Default;
        SetStyle(ControlStyles.ResizeRedraw, true);
    }

    protected override void OnMouseDoubleClick(MouseEventArgs e)
    {
        base.OnMouseDoubleClick(e);
        if (e.Button == MouseButtons.Left) OpenRequested?.Invoke(Kind);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && e.X <= 28 && e.Y <= 28)
        {
            _dragCandidate = true;
            _dragStart = e.Location;
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (_dragCandidate && e.Button == MouseButtons.Left &&
            (Math.Abs(e.X - _dragStart.X) > SystemInformation.DragSize.Width / 2 || Math.Abs(e.Y - _dragStart.Y) > SystemInformation.DragSize.Height / 2))
        {
            _dragCandidate = false;
            FloatRequested?.Invoke(Kind, PointToScreen(e.Location));
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        _dragCandidate = false;
    }

    protected void DrawModuleIcon(Graphics g)
    {
        GlyphPainter.Draw(g, GlyphPainter.ForModule(Kind), new Rectangle(5, 5, 18, 18), UiTheme.Muted, 1.35f);
    }
}

internal static class PlotDrawer
{
    public static Rectangle DrawGrid(Graphics g, Rectangle bounds, int left = 36, int right = 12, int top = 10, int bottom = 24)
    {
        var plot = Rectangle.FromLTRB(bounds.Left + left, bounds.Top + top, bounds.Right - right, bounds.Bottom - bottom);
        if (plot.Width < 10 || plot.Height < 10) return plot;

        using var grid = new Pen(UiTheme.Grid, 1f);
        for (var i = 0; i <= 5; i++)
        {
            var x = plot.Left + i * plot.Width / 5f;
            g.DrawLine(grid, x, plot.Top, x, plot.Bottom);
        }
        for (var i = 0; i <= 4; i++)
        {
            var y = plot.Top + i * plot.Height / 4f;
            g.DrawLine(grid, plot.Left, y, plot.Right, y);
        }
        using var axis = new Pen(Color.FromArgb(165, UiTheme.Muted), 1f);
        g.DrawLine(axis, plot.Left, plot.Bottom, plot.Right, plot.Bottom);
        g.DrawLine(axis, plot.Left, plot.Top, plot.Left, plot.Bottom);
        return plot;
    }

    public static void DrawSeries(Graphics g, Rectangle plot, IReadOnlyList<(double X, double Y)> points, Color color, double minX, double maxX, double minY, double maxY, float width = 1.55f)
    {
        if (points.Count < 2 || plot.Width <= 0 || plot.Height <= 0 || maxX <= minX || maxY <= minY) return;
        var mapped = new PointF[points.Count];
        for (var i = 0; i < points.Count; i++)
        {
            var x = plot.Left + (float)((points[i].X - minX) / (maxX - minX) * plot.Width);
            var y = plot.Bottom - (float)((points[i].Y - minY) / (maxY - minY) * plot.Height);
            mapped[i] = new PointF(x, y);
        }
        using var pen = new Pen(color, width) { LineJoin = LineJoin.Round };
        g.SetClip(plot);
        g.DrawLines(pen, mapped);
        g.ResetClip();
    }

    public static void DrawLegend(Graphics g, Rectangle plot, IReadOnlyList<(string Name, Color Color)> items, bool bottomRight = false)
    {
        var lineH = 15;
        var maxW = items.Count == 0 ? 0 : items.Max(x => TextRenderer.MeasureText(x.Name, UiTheme.Tiny).Width) + 22;
        var x = plot.Right - maxW - 5;
        var y = bottomRight ? plot.Bottom - items.Count * lineH - 5 : plot.Top + 5;
        foreach (var item in items)
        {
            using var pen = new Pen(item.Color, 1.6f);
            g.DrawLine(pen, x, y + 7, x + 13, y + 7);
            TextRenderer.DrawText(g, item.Name, UiTheme.Tiny, new Point(x + 17, y), UiTheme.Muted, Color.Transparent);
            y += lineH;
        }
    }

    public static void DrawUnit(Graphics g, Rectangle plot, string unit)
    {
        var size = TextRenderer.MeasureText(unit, UiTheme.Tiny);
        var x = plot.Right - size.Width;
        var y = plot.Bottom + 3;
        TextRenderer.DrawText(g, unit, UiTheme.Tiny, new Point(x, y), UiTheme.Muted, Color.Transparent);
    }
}

internal sealed class PowerModuleView : ModuleViewBase
{
    private double _rangeStart = 0.65;
    private double _rangeEnd = 1.0;
    private bool _dragOverview;
    private int _dragOriginX;
    private double _dragStartOrigin;
    private double _dragEndOrigin;
    private Rectangle _overviewRect;

    private static readonly Color[] TraceColors = { UiTheme.Accent, UiTheme.Orange, UiTheme.Green };

    public PowerModuleView(IInstrumentProvider provider, AppConfig config) : base(ModuleKind.Power, provider, config)
    {
        MouseWheel += (_, e) => ZoomOverview(e.Delta, e.X);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.Clear(UiTheme.PlotBack);
        DrawModuleIcon(e.Graphics);

        var snapshot = Provider.Snapshot(Config);
        var readoutWidth = Math.Clamp(Width / 6, 92, 125);
        var left = new Rectangle(0, 0, Math.Max(10, Width - readoutWidth), Height);
        var readout = new Rectangle(left.Right, 0, readoutWidth, Height);

        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dot })
            e.Graphics.DrawLine(divider, left.Right, 4, left.Right, Height - 4);

        var overviewHeight = Math.Clamp(Height / 9, 30, 45);
        _overviewRect = new Rectangle(left.Left + 8, left.Bottom - overviewHeight - 5, left.Width - 16, overviewHeight);
        var mainBounds = Rectangle.FromLTRB(left.Left + 2, left.Top + 2, left.Right - 2, _overviewRect.Top - 2);
        var plot = PlotDrawer.DrawGrid(e.Graphics, mainBounds, 38, 9, 12, 22);

        const double totalSeconds = 600;
        var all = Enumerable.Range(0, 3).Select(i => Provider.PowerHistory(i, totalSeconds, 900)).ToArray();
        var minIndex = Math.Clamp((int)Math.Round(_rangeStart * 899), 0, 898);
        var maxIndex = Math.Clamp((int)Math.Round(_rangeEnd * 899), minIndex + 1, 899);
        var startX = all[0][minIndex].Time;
        var endX = all[0][maxIndex].Time;

        var selected = all.Select(series => series.Skip(minIndex).Take(maxIndex - minIndex + 1).Select(p => (p.Time, p.Value)).ToArray()).ToArray();
        var minY = selected.SelectMany(x => x).Min(x => x.Value);
        var maxY = selected.SelectMany(x => x).Max(x => x.Value);
        var pad = Math.Max(0.1, (maxY - minY) * 0.08);
        minY -= pad;
        maxY += pad;

        for (var i = 0; i < selected.Length; i++)
            PlotDrawer.DrawSeries(e.Graphics, plot, selected[i].Select(p => (p.Time, p.Value)).ToArray(), TraceColors[i], startX, endX, minY, maxY);

        PlotDrawer.DrawLegend(e.Graphics, plot, snapshot.Power.Select((x, i) => (x.Name, TraceColors[i])).ToArray(), bottomRight: true);
        PlotDrawer.DrawUnit(e.Graphics, plot, "s");
        DrawOverview(e.Graphics, all[0]);
        DrawReadout(e.Graphics, readout, snapshot.Power);
    }

    private void DrawOverview(Graphics g, IReadOnlyList<(double Time, double Value)> history)
    {
        using var back = new SolidBrush(Color.FromArgb(247, 250, 253));
        g.FillRectangle(back, _overviewRect);
        using var border = new Pen(UiTheme.Grid, 1f);
        g.DrawRectangle(border, _overviewRect);
        var inner = Rectangle.Inflate(_overviewRect, -4, -4);
        var min = history.Min(x => x.Value);
        var max = history.Max(x => x.Value);
        PlotDrawer.DrawSeries(g, inner, history.Select(x => (x.Time, x.Value)).ToArray(), Color.FromArgb(130, UiTheme.Accent), history[0].Time, history[^1].Time, min - .05, max + .05, 1f);

        var x1 = inner.Left + (float)(_rangeStart * inner.Width);
        var x2 = inner.Left + (float)(_rangeEnd * inner.Width);
        using var shade = new SolidBrush(Color.FromArgb(22, UiTheme.Accent));
        g.FillRectangle(shade, RectangleF.FromLTRB(x1, inner.Top, x2, inner.Bottom));
        using var selectPen = new Pen(Color.FromArgb(150, UiTheme.Accent), 1f);
        g.DrawRectangle(selectPen, x1, inner.Top, Math.Max(1, x2 - x1), inner.Height);
    }

    private void DrawReadout(Graphics g, Rectangle rect, IReadOnlyList<NumericTrace> traces)
    {
        var y = 22;
        for (var i = 0; i < traces.Count; i++)
        {
            var trace = traces[i];
            TextRenderer.DrawText(g, trace.Name, UiTheme.Tiny, new Point(rect.Left + 9, y), UiTheme.Muted, Color.Transparent);
            y += 14;
            TextRenderer.DrawText(g, $"{trace.Value:F2} {trace.Unit}", UiTheme.Value, new Point(rect.Left + 9, y), UiTheme.Ink, Color.Transparent);
            y += 28;
        }
        if (traces.Count > 0)
        {
            TextRenderer.DrawText(g, $"Max · {traces[0].Name}", UiTheme.Tiny, new Point(rect.Left + 9, y + 3), UiTheme.Muted, Color.Transparent);
            TextRenderer.DrawText(g, $"{traces[0].MaxValue:F2} {traces[0].Unit}", UiTheme.ValueBold, new Point(rect.Left + 9, y + 18), UiTheme.Ink, Color.Transparent);
        }
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && _overviewRect.Contains(e.Location))
        {
            _dragOverview = true;
            _dragOriginX = e.X;
            _dragStartOrigin = _rangeStart;
            _dragEndOrigin = _rangeEnd;
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!_dragOverview) return;
        var delta = (e.X - _dragOriginX) / (double)Math.Max(1, _overviewRect.Width);
        var width = _dragEndOrigin - _dragStartOrigin;
        var start = Math.Clamp(_dragStartOrigin + delta, 0, 1 - width);
        _rangeStart = start;
        _rangeEnd = start + width;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        _dragOverview = false;
    }

    private void ZoomOverview(int delta, int mouseX)
    {
        if (Width <= 0) return;
        var current = _rangeEnd - _rangeStart;
        var next = Math.Clamp(current * (delta > 0 ? 0.82 : 1.22), 0.05, 1.0);
        var focus = Math.Clamp(mouseX / (double)Math.Max(1, Width), 0, 1);
        var center = _rangeStart + current * focus;
        _rangeStart = Math.Clamp(center - next * focus, 0, 1 - next);
        _rangeEnd = _rangeStart + next;
        Invalidate();
    }
}

internal sealed class SpectrumModuleView : ModuleViewBase
{
    public SpectrumModuleView(IInstrumentProvider provider, AppConfig config) : base(ModuleKind.Spectrum, provider, config) { }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(UiTheme.PlotBack);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var snapshot = Provider.Snapshot(Config);
        DrawModuleIcon(e.Graphics);

        var top = new Rectangle(28, 2, Math.Max(10, Width - 34), 24);
        var metrics = $"λc {snapshot.CenterWavelength:F2} nm   3 dB {snapshot.Linewidth3Db:F2} nm   RMS {snapshot.LinewidthRms:F2} nm   P {snapshot.SpectrumPower:F1} dBm";
        TextRenderer.DrawText(e.Graphics, metrics, UiTheme.Tiny, new Point(top.Left, 7), UiTheme.Ink, Color.Transparent);
        GlyphPainter.Draw(e.Graphics, GlyphKind.Expand, new Rectangle(Width - 23, 5, 16, 16), UiTheme.Muted, 1.2f);

        var bounds = new Rectangle(2, 25, Width - 4, Height - 27);
        var plot = PlotDrawer.DrawGrid(e.Graphics, bounds, 40, 10, 8, 23);
        var points = snapshot.Spectrum.Select(x => (x.X, x.Y)).ToArray();
        var minX = snapshot.Spectrum[0].X;
        var maxX = snapshot.Spectrum[^1].X;
        var minY = points.Min(x => x.Y) - 2;
        var maxY = points.Max(x => x.Y) + 2;
        PlotDrawer.DrawSeries(e.Graphics, plot, points, UiTheme.Accent, minX, maxX, minY, maxY, 1.55f);
        PlotDrawer.DrawLegend(e.Graphics, plot, new[] { (Config.Osa1Alias, UiTheme.Accent) });
        PlotDrawer.DrawUnit(e.Graphics, plot, "nm");
    }
}

internal sealed class BeamModuleView : ModuleViewBase
{
    private readonly CompactSlider _zSlider = new() { Minimum = -20, Maximum = 20 };
    private readonly CompactSlider _attSlider = new() { Minimum = 0, Maximum = 30 };
    private readonly GlyphButton _waistButton = new(GlyphKind.Capture) { Active = true };
    private Rectangle _spotRect;
    private float _spotZoom = 1f;
    private PointF _spotPan = PointF.Empty;
    private bool _pan;
    private Point _panStart;
    private PointF _panOrigin;

    public BeamModuleView(IInstrumentProvider provider, AppConfig config) : base(ModuleKind.Beam, provider, config)
    {
        _zSlider.Value = config.BeamZ;
        _attSlider.Value = config.BeamAttenuation;
        Controls.Add(_zSlider);
        Controls.Add(_attSlider);
        Controls.Add(_waistButton);
        _zSlider.ValueChanged += (_, _) => { Config.BeamZ = _zSlider.Value; Invalidate(); };
        _attSlider.ValueChanged += (_, _) => { Config.BeamAttenuation = _attSlider.Value; Invalidate(); };
        _waistButton.Click += (_, _) => { _zSlider.Value = 0; Config.BeamZ = 0; Invalidate(); };
        MouseWheel += (_, e) =>
        {
            if (_spotRect.Contains(e.Location))
            {
                _spotZoom = Math.Clamp(_spotZoom * (e.Delta > 0 ? 1.12f : 0.89f), 0.55f, 5f);
                Invalidate();
            }
        };
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        var bottomH = 32;
        var y = Math.Max(0, Height - bottomH + 6);
        var leftW = Math.Max(220, Width / 2);
        _zSlider.SetBounds(42, y, Math.Max(70, leftW / 3), 20);
        _waistButton.SetBounds(_zSlider.Right + 42, y - 2, 24, 24);
        _attSlider.SetBounds(_waistButton.Right + 54, y, Math.Max(70, leftW / 3), 20);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(UiTheme.PlotBack);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        DrawModuleIcon(e.Graphics);
        var snapshot = Provider.Snapshot(Config);

        var bottomH = 32;
        var content = new Rectangle(0, 0, Width, Math.Max(20, Height - bottomH));
        var split = Math.Clamp((int)(content.Width * 0.37), 150, Math.Max(151, content.Width - 180));
        _spotRect = Rectangle.FromLTRB(4, 3, split - 3, content.Bottom - 3);
        var causticBounds = Rectangle.FromLTRB(split + 2, 3, content.Right - 3, content.Bottom - 3);
        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dot })
            e.Graphics.DrawLine(divider, split, 4, split, content.Bottom - 4);

        DrawSpot(e.Graphics, _spotRect);
        var plot = PlotDrawer.DrawGrid(e.Graphics, causticBounds, 35, 10, 8, 22);
        var xSeries = snapshot.Beam.Select(p => (p.Z, p.X)).ToArray();
        var ySeries = snapshot.Beam.Select(p => (p.Z, p.Y)).ToArray();
        var minY = Math.Min(xSeries.Min(x => x.X), ySeries.Min(x => x.X)) * .8;
        var maxY = Math.Max(xSeries.Max(x => x.X), ySeries.Max(x => x.X)) * 1.04;
        PlotDrawer.DrawSeries(e.Graphics, plot, xSeries, UiTheme.Accent, -24, 24, minY, maxY);
        PlotDrawer.DrawSeries(e.Graphics, plot, ySeries, UiTheme.Orange, -24, 24, minY, maxY);
        PlotDrawer.DrawLegend(e.Graphics, plot, new[] { ("X", UiTheme.Accent), ("Y", UiTheme.Orange) });
        PlotDrawer.DrawUnit(e.Graphics, plot, "mm");

        using var bottomPen = new Pen(UiTheme.Divider, 1f);
        e.Graphics.DrawLine(bottomPen, 4, content.Bottom, Width - 4, content.Bottom);
        var yText = Height - 24;
        TextRenderer.DrawText(e.Graphics, "Z", UiTheme.Tiny, new Point(10, yText + 3), UiTheme.Muted, Color.Transparent);
        TextRenderer.DrawText(e.Graphics, $"{Config.BeamZ:F1} mm", UiTheme.Tiny, new Point(_zSlider.Right + 3, yText + 3), UiTheme.Ink, Color.Transparent);
        TextRenderer.DrawText(e.Graphics, "Att", UiTheme.Tiny, new Point(_waistButton.Right + 27, yText + 3), UiTheme.Muted, Color.Transparent);
        TextRenderer.DrawText(e.Graphics, $"{Config.BeamAttenuation:F1} dB", UiTheme.Tiny, new Point(_attSlider.Right + 3, yText + 3), UiTheme.Ink, Color.Transparent);

        var m2 = $"M²x {snapshot.M2X:F2}    M²y {snapshot.M2Y:F2}    M̄² {snapshot.M2Mean:F2}";
        var size = TextRenderer.MeasureText(m2, UiTheme.ValueBold);
        TextRenderer.DrawText(e.Graphics, m2, UiTheme.ValueBold, new Point(Math.Max(_attSlider.Right + 72, Width - size.Width - 10), yText), UiTheme.Ink, Color.Transparent);
    }

    private void DrawSpot(Graphics g, Rectangle rect)
    {
        using var back = new SolidBrush(Color.FromArgb(248, 251, 254));
        g.FillRectangle(back, rect);
        using var border = new Pen(UiTheme.Grid, 1f);
        g.DrawRectangle(border, rect);

        var center = new PointF(rect.Left + rect.Width / 2f + _spotPan.X, rect.Top + rect.Height / 2f + _spotPan.Y);
        var radius = Math.Min(rect.Width, rect.Height) * .29f * _spotZoom;
        for (var i = 16; i >= 1; i--)
        {
            var t = i / 16f;
            var alpha = (int)(12 + 13 * (1 - t));
            using var brush = new SolidBrush(Color.FromArgb(alpha, 44, 128, 205));
            var rx = radius * t;
            var ry = radius * .82f * t;
            g.FillEllipse(brush, center.X - rx, center.Y - ry, rx * 2, ry * 2);
        }
        using var cross = new Pen(Color.FromArgb(85, UiTheme.Muted), 1f) { DashStyle = DashStyle.Dot };
        g.DrawLine(cross, center.X, rect.Top + 6, center.X, rect.Bottom - 6);
        g.DrawLine(cross, rect.Left + 6, center.Y, rect.Right - 6, center.Y);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && _spotRect.Contains(e.Location) && e.X > 28)
        {
            _pan = true;
            _panStart = e.Location;
            _panOrigin = _spotPan;
            Cursor = Cursors.SizeAll;
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (_pan)
        {
            _spotPan = new PointF(_panOrigin.X + e.X - _panStart.X, _panOrigin.Y + e.Y - _panStart.Y);
            Invalidate();
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (_pan) { _pan = false; Cursor = Cursors.Default; }
    }
}

internal sealed class ScopeModuleView : ModuleViewBase
{
    public ScopeModuleView(IInstrumentProvider provider, AppConfig config) : base(ModuleKind.Scope, provider, config) { }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(UiTheme.PlotBack);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        DrawModuleIcon(e.Graphics);
        var snapshot = Provider.Snapshot(Config);
        var half = Height / 2;
        var topBounds = new Rectangle(2, 2, Width - 4, Math.Max(10, half - 4));
        var bottomBounds = new Rectangle(2, half + 2, Width - 4, Math.Max(10, Height - half - 4));
        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dot })
            e.Graphics.DrawLine(divider, 5, half, Width - 5, half);

        DrawScopePlot(e.Graphics, topBounds, snapshot.ScopeTime, "ms", -1.1, 1.1);
        DrawScopePlot(e.Graphics, bottomBounds, snapshot.ScopeFft, "kHz", 0, 1.05);
    }

    private void DrawScopePlot(Graphics g, Rectangle bounds, IReadOnlyList<ScopePoint> data, string unit, double minY, double maxY)
    {
        var plot = PlotDrawer.DrawGrid(g, bounds, 36, 10, 9, 22);
        var minX = data[0].X;
        var maxX = data[^1].X;
        PlotDrawer.DrawSeries(g, plot, data.Select(p => (p.X, p.Ch1)).ToArray(), UiTheme.Accent, minX, maxX, minY, maxY);
        PlotDrawer.DrawSeries(g, plot, data.Select(p => (p.X, p.Ch2)).ToArray(), UiTheme.Orange, minX, maxX, minY, maxY);
        PlotDrawer.DrawLegend(g, plot, new[] { (Config.Scope1Alias, UiTheme.Accent), (Config.Scope2Alias, UiTheme.Orange) });
        PlotDrawer.DrawUnit(g, plot, unit);
    }
}
