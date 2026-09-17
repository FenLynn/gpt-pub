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
        BackColor = UiTheme.PlotBack;
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
        GlyphPainter.Draw(g, GlyphPainter.ForModule(Kind), new Rectangle(6, 5, 17, 17), UiTheme.Muted, 1.3f);
    }
}

internal static class PlotDrawer
{
    public static Rectangle DrawGrid(Graphics g, Rectangle bounds, int left = 40, int right = 12, int top = 10, int bottom = 25)
    {
        var plot = Rectangle.FromLTRB(bounds.Left + left, bounds.Top + top, bounds.Right - right, bounds.Bottom - bottom);
        if (plot.Width < 10 || plot.Height < 10) return plot;

        using var grid = new Pen(UiTheme.Grid, 1f) { DashStyle = DashStyle.Dash };
        for (var i = 1; i < 5; i++)
        {
            var x = plot.Left + i * plot.Width / 5f;
            g.DrawLine(grid, x, plot.Top, x, plot.Bottom);
        }
        for (var i = 1; i < 4; i++)
        {
            var y = plot.Top + i * plot.Height / 4f;
            g.DrawLine(grid, plot.Left, y, plot.Right, y);
        }

        using var border = new Pen(UiTheme.Border, 1f);
        g.DrawRectangle(border, plot);
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
        var lineH = 16;
        var maxW = items.Count == 0 ? 0 : items.Max(x => TextRenderer.MeasureText(x.Name, UiTheme.Tiny).Width) + 24;
        var x = plot.Right - maxW - 6;
        var y = bottomRight ? plot.Bottom - items.Count * lineH - 6 : plot.Top + 6;
        foreach (var item in items)
        {
            using var pen = new Pen(item.Color, 1.7f);
            g.DrawLine(pen, x, y + 7, x + 14, y + 7);
            TextRenderer.DrawText(g, item.Name, UiTheme.Tiny, new Point(x + 18, y), UiTheme.Muted, Color.Transparent);
            y += lineH;
        }
    }

    public static void DrawAxisLabels(Graphics g, Rectangle plot, double minX, double maxX, double minY, double maxY, string xUnit, string xFormat = "0.##", string yFormat = "0.##")
    {
        DrawYLabels(g, plot, minY, maxY, yFormat, false);

        var x0 = minX.ToString(xFormat);
        var xm = ((minX + maxX) * .5).ToString(xFormat);
        TextRenderer.DrawText(g, x0, UiTheme.Tiny, new Point(plot.Left, plot.Bottom + 3), UiTheme.Muted, Color.Transparent);
        var midSize = TextRenderer.MeasureText(xm, UiTheme.Tiny);
        TextRenderer.DrawText(g, xm, UiTheme.Tiny, new Point(plot.Left + plot.Width / 2 - midSize.Width / 2, plot.Bottom + 3), UiTheme.Muted, Color.Transparent);
        DrawUnit(g, plot, xUnit);
    }

    public static void DrawYLabels(Graphics g, Rectangle plot, double minY, double maxY, string format, bool right)
    {
        var values = new[] { maxY, (minY + maxY) * .5, minY };
        var ys = new[] { plot.Top - 7, plot.Top + plot.Height / 2 - 7, plot.Bottom - 14 };
        for (var i = 0; i < values.Length; i++)
        {
            var text = values[i].ToString(format);
            var size = TextRenderer.MeasureText(text, UiTheme.Tiny);
            var x = right ? plot.Right + 4 : plot.Left - size.Width - 4;
            TextRenderer.DrawText(g, text, UiTheme.Tiny, new Point(x, ys[i]), UiTheme.Muted, Color.Transparent);
        }
    }

    public static void DrawUnit(Graphics g, Rectangle plot, string unit)
    {
        var size = TextRenderer.MeasureText(unit, UiTheme.Tiny);
        TextRenderer.DrawText(g, unit, UiTheme.Tiny, new Point(plot.Right - size.Width, plot.Bottom + 3), UiTheme.Muted, Color.Transparent);
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
    private static readonly Font ReadoutFont = new("Segoe UI Semibold", 10.5f, FontStyle.Bold, GraphicsUnit.Point);

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
        var readoutWidth = Math.Clamp(Width / 5, 126, 158);
        var left = new Rectangle(0, 0, Math.Max(10, Width - readoutWidth), Height);
        var readout = new Rectangle(left.Right, 0, readoutWidth, Height);

        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(divider, left.Right, 6, left.Right, Height - 6);

        var overviewHeight = Math.Clamp(Height / 10, 30, 40);
        _overviewRect = new Rectangle(left.Left + 10, left.Bottom - overviewHeight - 7, left.Width - 20, overviewHeight);
        var mainBounds = Rectangle.FromLTRB(left.Left + 1, left.Top + 2, left.Right - 1, _overviewRect.Top - 4);
        var plot = PlotDrawer.DrawGrid(e.Graphics, mainBounds, 44, 34, 12, 25);

        const double totalSeconds = 600;
        var all = Enumerable.Range(0, 3).Select(i => Provider.PowerHistory(i, totalSeconds, 900)).ToArray();
        var minIndex = Math.Clamp((int)Math.Round(_rangeStart * 899), 0, 898);
        var maxIndex = Math.Clamp((int)Math.Round(_rangeEnd * 899), minIndex + 1, 899);
        var startX = all[0][minIndex].Time;
        var endX = all[0][maxIndex].Time;

        var powerSeries = all.Take(2)
            .Select(series => series.Skip(minIndex).Take(maxIndex - minIndex + 1).Select(p => (p.Time, p.Value)).ToArray())
            .ToArray();
        var mathSeries = all[2].Skip(minIndex).Take(maxIndex - minIndex + 1).Select(p => (p.Time, p.Value)).ToArray();

        var minPower = powerSeries.SelectMany(x => x).Min(x => x.Value);
        var maxPower = powerSeries.SelectMany(x => x).Max(x => x.Value);
        var powerPad = Math.Max(.08, (maxPower - minPower) * .08);
        minPower -= powerPad;
        maxPower += powerPad;

        var minMath = mathSeries.Min(x => x.Value) - .08;
        var maxMath = mathSeries.Max(x => x.Value) + .08;

        for (var i = 0; i < powerSeries.Length; i++)
            PlotDrawer.DrawSeries(e.Graphics, plot, powerSeries[i], TraceColors[i], startX, endX, minPower, maxPower, 1.7f);
        PlotDrawer.DrawSeries(e.Graphics, plot, mathSeries, TraceColors[2], startX, endX, minMath, maxMath, 1.65f);

        PlotDrawer.DrawLegend(e.Graphics, plot, snapshot.Power.Select((x, i) => (x.Name, TraceColors[i])).ToArray(), bottomRight: true);
        PlotDrawer.DrawAxisLabels(e.Graphics, plot, startX, endX, minPower, maxPower, "s", "0", "0.00");
        PlotDrawer.DrawYLabels(e.Graphics, plot, minMath, maxMath, "0.0", true);
        TextRenderer.DrawText(e.Graphics, "%", UiTheme.Tiny, new Point(plot.Right + 7, plot.Top + plot.Height / 2 + 9), UiTheme.Muted, Color.Transparent);

        DrawOverview(e.Graphics, all[0]);
        DrawReadout(e.Graphics, readout, snapshot.Power);
    }

    private void DrawOverview(Graphics g, IReadOnlyList<(double Time, double Value)> history)
    {
        using var back = new SolidBrush(UiTheme.Surface);
        g.FillRectangle(back, _overviewRect);
        using var border = new Pen(UiTheme.Border, 1f);
        g.DrawRectangle(border, _overviewRect);
        var inner = Rectangle.Inflate(_overviewRect, -4, -4);
        var min = history.Min(x => x.Value);
        var max = history.Max(x => x.Value);
        PlotDrawer.DrawSeries(g, inner, history.Select(x => (x.Time, x.Value)).ToArray(), Color.FromArgb(150, UiTheme.Accent), history[0].Time, history[^1].Time, min - .05, max + .05, 1.05f);

        var x1 = inner.Left + (float)(_rangeStart * inner.Width);
        var x2 = inner.Left + (float)(_rangeEnd * inner.Width);
        using var shade = new SolidBrush(Color.FromArgb(18, UiTheme.Accent));
        g.FillRectangle(shade, RectangleF.FromLTRB(x1, inner.Top, x2, inner.Bottom));
        using var selectPen = new Pen(Color.FromArgb(165, UiTheme.Accent), 1f);
        g.DrawRectangle(selectPen, x1, inner.Top, Math.Max(1, x2 - x1), inner.Height);
        using var handle = new Pen(Color.FromArgb(190, UiTheme.Accent), 2f);
        g.DrawLine(handle, x1, inner.Top + 2, x1, inner.Bottom - 2);
        g.DrawLine(handle, x2, inner.Top + 2, x2, inner.Bottom - 2);
    }

    private static void DrawReadout(Graphics g, Rectangle rect, IReadOnlyList<NumericTrace> traces)
    {
        var y = 17;
        for (var i = 0; i < traces.Count; i++)
        {
            var trace = traces[i];
            using var indicator = new Pen(TraceColors[i], 2f);
            g.DrawLine(indicator, rect.Left + 10, y + 8, rect.Left + 23, y + 8);
            TextRenderer.DrawText(g, trace.Name, UiTheme.Tiny, new Point(rect.Left + 29, y), UiTheme.Muted, Color.Transparent);
            y += 16;
            TextRenderer.DrawText(g, $"{trace.Value:F2} {trace.Unit}", ReadoutFont, new Point(rect.Left + 10, y), UiTheme.Ink, Color.Transparent);
            y += 34;
        }

        if (traces.Count > 0)
        {
            using var line = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dash };
            g.DrawLine(line, rect.Left + 10, y + 1, rect.Right - 10, y + 1);
            TextRenderer.DrawText(g, $"最大值  {traces[0].Name}", UiTheme.Tiny, new Point(rect.Left + 10, y + 9), UiTheme.Muted, Color.Transparent);
            TextRenderer.DrawText(g, $"{traces[0].MaxValue:F2} {traces[0].Unit}", UiTheme.ValueBold, new Point(rect.Left + 10, y + 25), UiTheme.Ink, Color.Transparent);
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

        var metrics = $"λc {snapshot.CenterWavelength:F2} nm   3 dB {snapshot.Linewidth3Db:F2} nm   RMS {snapshot.LinewidthRms:F2} nm   P {snapshot.SpectrumPower:F1} dBm";
        TextRenderer.DrawText(e.Graphics, metrics, UiTheme.Tiny, new Point(29, 7), UiTheme.Ink, Color.Transparent);

        var selector = Config.Osa1Alias + "  ▾";
        var selectorSize = TextRenderer.MeasureText(selector, UiTheme.Tiny);
        TextRenderer.DrawText(e.Graphics, selector, UiTheme.Tiny, new Point(Math.Max(360, Width - selectorSize.Width - 30), 7), UiTheme.Muted, Color.Transparent);
        GlyphPainter.Draw(e.Graphics, GlyphKind.Expand, new Rectangle(Width - 22, 5, 16, 16), UiTheme.Muted, 1.2f);

        var bounds = new Rectangle(2, 26, Width - 4, Height - 28);
        var plot = PlotDrawer.DrawGrid(e.Graphics, bounds, 46, 10, 8, 25);
        var points = snapshot.Spectrum.Select(x => (x.X, x.Y)).ToArray();
        var minX = snapshot.Spectrum[0].X;
        var maxX = snapshot.Spectrum[^1].X;
        var minY = points.Min(x => x.Y) - 2;
        var maxY = points.Max(x => x.Y) + 2;
        PlotDrawer.DrawSeries(e.Graphics, plot, points, UiTheme.Accent, minX, maxX, minY, maxY, 1.65f);
        PlotDrawer.DrawLegend(e.Graphics, plot, new[] { (Config.Osa1Alias, UiTheme.Accent) });
        PlotDrawer.DrawAxisLabels(e.Graphics, plot, minX, maxX, minY, maxY, "nm", "0.0", "0");
    }
}

internal sealed class BeamModuleView : ModuleViewBase
{
    private readonly CompactSlider _zSlider = new() { Minimum = -20, Maximum = 20 };
    private readonly CompactSlider _attSlider = new() { Minimum = 0, Maximum = 30 };
    private readonly GlyphButton _playButton = new(GlyphKind.Capture);
    private readonly System.Windows.Forms.Timer _playTimer = new() { Interval = 90 };
    private Rectangle _spotRect;
    private float _spotZoom = 1f;
    private PointF _spotPan = PointF.Empty;
    private bool _pan;
    private bool _playing;
    private Point _panStart;
    private PointF _panOrigin;
    private double _browseZ;

    public BeamModuleView(IInstrumentProvider provider, AppConfig config) : base(ModuleKind.Beam, provider, config)
    {
        _browseZ = Math.Clamp(config.BeamZ, _zSlider.Minimum, _zSlider.Maximum);
        _zSlider.Value = _browseZ;
        _attSlider.Value = config.BeamAttenuation;
        Controls.Add(_zSlider);
        Controls.Add(_attSlider);
        Controls.Add(_playButton);

        _zSlider.ValueChanged += (_, _) =>
        {
            _browseZ = _zSlider.Value;
            Config.BeamZ = _browseZ;
            Invalidate();
        };
        _attSlider.ValueChanged += (_, _) => { Config.BeamAttenuation = _attSlider.Value; Invalidate(); };
        _playButton.Click += (_, _) => TogglePlayback();
        _playTimer.Tick += (_, _) =>
        {
            var next = _zSlider.Value + 0.45;
            if (next > _zSlider.Maximum) next = _zSlider.Minimum;
            _zSlider.Value = next;
        };

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
        var bottomH = 34;
        var y = Math.Max(0, Height - bottomH + 7);
        var reserveRight = Math.Clamp(Width / 3, 235, 300);
        var controlsWidth = Math.Max(350, Width - reserveRight - 18);
        var zW = Math.Clamp((int)(controlsWidth * .29), 105, 165);
        var attW = Math.Clamp((int)(controlsWidth * .24), 90, 145);

        _zSlider.SetBounds(30, y, zW, 20);
        _playButton.SetBounds(_zSlider.Right + 63, y - 2, 24, 24);
        _attSlider.SetBounds(_playButton.Right + 48, y, attW, 20);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(UiTheme.PlotBack);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        DrawModuleIcon(e.Graphics);

        var savedBrowseZ = Config.BeamZ;
        Config.BeamZ = 0;
        var snapshot = Provider.Snapshot(Config);
        Config.BeamZ = savedBrowseZ;

        var bottomH = 34;
        var content = new Rectangle(0, 0, Width, Math.Max(20, Height - bottomH));
        var split = Math.Clamp((int)(content.Width * 0.43), 220, Math.Max(221, content.Width - 240));
        _spotRect = Rectangle.FromLTRB(8, 5, split - 7, content.Bottom - 6);
        var causticBounds = Rectangle.FromLTRB(split + 3, 3, content.Right - 3, content.Bottom - 3);
        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(divider, split, 6, split, content.Bottom - 6);

        DrawSpot(e.Graphics, _spotRect, snapshot);
        var plot = PlotDrawer.DrawGrid(e.Graphics, causticBounds, 43, 10, 10, 25);
        var xSeries = snapshot.Beam.Select(p => (p.Z, p.X)).ToArray();
        var ySeries = snapshot.Beam.Select(p => (p.Z, p.Y)).ToArray();
        var minY = Math.Min(xSeries.Min(x => x.X), ySeries.Min(x => x.Y)) * .80;
        var maxY = Math.Max(xSeries.Max(x => x.X), ySeries.Max(x => x.Y)) * 1.04;
        PlotDrawer.DrawSeries(e.Graphics, plot, xSeries, UiTheme.Accent, -24, 24, minY, maxY, 1.65f);
        PlotDrawer.DrawSeries(e.Graphics, plot, ySeries, UiTheme.Orange, -24, 24, minY, maxY, 1.65f);
        PlotDrawer.DrawLegend(e.Graphics, plot, new[] { ("X", UiTheme.Accent), ("Y", UiTheme.Orange) });
        PlotDrawer.DrawAxisLabels(e.Graphics, plot, -24, 24, minY, maxY, "mm", "0", "0.00");

        var markerX = plot.Left + (float)((Math.Clamp(_browseZ, -24, 24) + 24) / 48.0 * plot.Width);
        using (var marker = new Pen(Color.FromArgb(155, UiTheme.Accent2), 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(marker, markerX, plot.Top, markerX, plot.Bottom);

        using var bottomPen = new Pen(UiTheme.Divider, 1f);
        e.Graphics.DrawLine(bottomPen, 5, content.Bottom, Width - 5, content.Bottom);
        var yText = Height - 25;
        TextRenderer.DrawText(e.Graphics, "Z", UiTheme.Tiny, new Point(9, yText + 3), UiTheme.Muted, Color.Transparent);
        TextRenderer.DrawText(e.Graphics, $"{_browseZ:F1} mm", UiTheme.Tiny, new Point(_zSlider.Right + 5, yText + 3), UiTheme.Ink, Color.Transparent);
        TextRenderer.DrawText(e.Graphics, "Att", UiTheme.Tiny, new Point(_playButton.Right + 16, yText + 3), UiTheme.Muted, Color.Transparent);
        TextRenderer.DrawText(e.Graphics, $"{Config.BeamAttenuation:F1} dB", UiTheme.Tiny, new Point(_attSlider.Right + 5, yText + 3), UiTheme.Ink, Color.Transparent);

        var m2 = $"M²x {snapshot.M2X:F2}    M²y {snapshot.M2Y:F2}    M̄² {snapshot.M2Mean:F2}";
        var size = TextRenderer.MeasureText(m2, UiTheme.ValueBold);
        TextRenderer.DrawText(e.Graphics, m2, UiTheme.ValueBold, new Point(Math.Max(_attSlider.Right + 70, Width - size.Width - 10), yText), UiTheme.Ink, Color.Transparent);
    }

    private void DrawSpot(Graphics g, Rectangle rect, MeasurementSnapshot snapshot)
    {
        using var back = new SolidBrush(UiTheme.Surface);
        g.FillRectangle(back, rect);
        using var border = new Pen(UiTheme.Border, 1f);
        g.DrawRectangle(border, rect);

        var nearest = snapshot.Beam.OrderBy(p => Math.Abs(p.Z - _browseZ)).First();
        var center = new PointF(rect.Left + rect.Width / 2f + _spotPan.X, rect.Top + rect.Height / 2f + _spotPan.Y);
        var baseRadius = Math.Min(rect.Width, rect.Height) * .15f * _spotZoom;
        var rxMax = Math.Max(10f, baseRadius * (float)(nearest.X / 0.42));
        var ryMax = Math.Max(10f, baseRadius * (float)(nearest.Y / 0.46));

        for (var i = 26; i >= 1; i--)
        {
            var t = i / 26f;
            var alpha = (int)(9 + 24 * (1 - t));
            using var brush = new SolidBrush(Color.FromArgb(alpha, 44, 128, 205));
            var rx = rxMax * t;
            var ry = ryMax * t;
            g.FillEllipse(brush, center.X - rx, center.Y - ry, rx * 2, ry * 2);
        }
        using (var core = new SolidBrush(Color.FromArgb(55, 35, 120, 205)))
            g.FillEllipse(core, center.X - rxMax * .18f, center.Y - ryMax * .18f, rxMax * .36f, ryMax * .36f);

        using var cross = new Pen(Color.FromArgb(65, UiTheme.Muted), 1f) { DashStyle = DashStyle.Dash };
        g.DrawLine(cross, center.X, rect.Top + 6, center.X, rect.Bottom - 6);
        g.DrawLine(cross, rect.Left + 6, center.Y, rect.Right - 6, center.Y);
    }

    private void TogglePlayback()
    {
        _playing = !_playing;
        _playButton.Active = _playing;
        _playButton.Filled = _playing;
        _playButton.Invalidate();
        if (_playing) _playTimer.Start(); else _playTimer.Stop();
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

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _playTimer.Stop();
            _playTimer.Dispose();
        }
        base.Dispose(disposing);
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
        var topBounds = new Rectangle(2, 2, Width - 4, Math.Max(10, half - 5));
        var bottomBounds = new Rectangle(2, half + 3, Width - 4, Math.Max(10, Height - half - 5));
        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(divider, 6, half, Width - 6, half);

        DrawScopePlot(e.Graphics, topBounds, snapshot.ScopeTime, "ms", -1.1, 1.1);
        DrawScopePlot(e.Graphics, bottomBounds, snapshot.ScopeFft, "kHz", 0, 1.05);
    }

    private void DrawScopePlot(Graphics g, Rectangle bounds, IReadOnlyList<ScopePoint> data, string unit, double minY, double maxY)
    {
        var plot = PlotDrawer.DrawGrid(g, bounds, 43, 10, 9, 25);
        var minX = data[0].X;
        var maxX = data[^1].X;
        PlotDrawer.DrawSeries(g, plot, data.Select(p => (p.X, p.Ch1)).ToArray(), UiTheme.Accent, minX, maxX, minY, maxY, 1.65f);
        PlotDrawer.DrawSeries(g, plot, data.Select(p => (p.X, p.Ch2)).ToArray(), UiTheme.Orange, minX, maxX, minY, maxY, 1.65f);
        PlotDrawer.DrawLegend(g, plot, new[] { (Config.Scope1Alias, UiTheme.Accent), (Config.Scope2Alias, UiTheme.Orange) });
        PlotDrawer.DrawAxisLabels(g, plot, minX, maxX, minY, maxY, unit, "0.##", "0.0");
    }
}