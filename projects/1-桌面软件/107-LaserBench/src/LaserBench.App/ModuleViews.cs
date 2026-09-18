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
        BackColor = UiTheme.ModuleBack;
        Margin = Padding.Empty;
        Padding = Padding.Empty;
        DoubleBuffered = true;
        Cursor = Cursors.Default;
        SetStyle(ControlStyles.ResizeRedraw | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer, true);
    }

    protected override void OnMouseDoubleClick(MouseEventArgs e)
    {
        base.OnMouseDoubleClick(e);
        if (e.Button == MouseButtons.Left) OpenRequested?.Invoke(Kind);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && e.X <= 30 && e.Y <= 30)
        {
            _dragCandidate = true;
            _dragStart = e.Location;
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (_dragCandidate && e.Button == MouseButtons.Left &&
            (Math.Abs(e.X - _dragStart.X) > SystemInformation.DragSize.Width / 2 ||
             Math.Abs(e.Y - _dragStart.Y) > SystemInformation.DragSize.Height / 2))
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

    protected void DrawModuleMark(Graphics g, string text)
    {
        GlyphPainter.Draw(g, GlyphPainter.ForModule(Kind), new Rectangle(5, 4, 17, 17), UiTheme.Muted, 1.25f);
        TextRenderer.DrawText(g, text, UiTheme.Tiny, new Point(25, 5), UiTheme.Muted, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
    }
}

internal static class PlotDrawer
{
    public static Rectangle DrawGrid(Graphics g, Rectangle bounds, int left = 40, int right = 10, int top = 8, int bottom = 23)
    {
        var plot = Rectangle.FromLTRB(bounds.Left + left, bounds.Top + top, bounds.Right - right, bounds.Bottom - bottom);
        if (plot.Width < 10 || plot.Height < 10) return plot;

        using (var back = new SolidBrush(UiTheme.PlotBack))
            g.FillRectangle(back, plot);

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

    public static void DrawSeries(
        Graphics g,
        Rectangle plot,
        IReadOnlyList<(double X, double Y)> points,
        Color color,
        double minX,
        double maxX,
        double minY,
        double maxY,
        float width = 1.5f)
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
        var state = g.Save();
        g.SetClip(plot);
        g.DrawLines(pen, mapped);
        g.Restore(state);
    }

    public static void DrawLegend(Graphics g, Rectangle plot, IReadOnlyList<(string Name, Color Color)> items, bool bottomRight = false)
    {
        if (items.Count == 0) return;
        var lineH = 14;
        var maxW = items.Max(x => TextRenderer.MeasureText(x.Name, UiTheme.Tiny, Size.Empty, TextFormatFlags.NoPadding).Width) + 24;
        var x = Math.Max(plot.Left + 5, plot.Right - maxW - 5);
        var y = bottomRight ? plot.Bottom - items.Count * lineH - 5 : plot.Top + 5;
        foreach (var item in items)
        {
            using var pen = new Pen(item.Color, 1.65f);
            g.DrawLine(pen, x, y + 7, x + 14, y + 7);
            TextRenderer.DrawText(g, item.Name, UiTheme.Tiny, new Point(x + 18, y), UiTheme.Muted, Color.Transparent,
                TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
            y += lineH;
        }
    }

    public static void DrawUnit(Graphics g, Rectangle plot, string unit)
    {
        var size = TextRenderer.MeasureText(unit, UiTheme.Tiny, Size.Empty, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, unit, UiTheme.Tiny, new Point(plot.Right - size.Width, plot.Bottom + 4), UiTheme.Muted, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
    }

    public static void DrawXTickLabels(Graphics g, Rectangle plot, double min, double max, int count = 3, string format = "0.##")
    {
        if (count < 2) return;
        for (var i = 0; i < count; i++)
        {
            var t = i / (double)(count - 1);
            var value = min + (max - min) * t;
            var text = value.ToString(format);
            var size = TextRenderer.MeasureText(text, UiTheme.Micro, Size.Empty, TextFormatFlags.NoPadding);
            var x = plot.Left + (int)Math.Round(t * plot.Width) - size.Width / 2;
            x = Math.Clamp(x, plot.Left - 2, plot.Right - size.Width + 2);
            TextRenderer.DrawText(g, text, UiTheme.Micro, new Point(x, plot.Bottom + 4), UiTheme.Muted2, Color.Transparent,
                TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        }
    }

    public static void DrawYTickLabels(Graphics g, Rectangle plot, double min, double max, int count = 3, string format = "0.##")
    {
        if (count < 2) return;
        for (var i = 0; i < count; i++)
        {
            var t = i / (double)(count - 1);
            var value = max - (max - min) * t;
            var text = value.ToString(format);
            var size = TextRenderer.MeasureText(text, UiTheme.Micro, Size.Empty, TextFormatFlags.NoPadding);
            var y = plot.Top + (int)Math.Round(t * plot.Height) - size.Height / 2;
            TextRenderer.DrawText(g, text, UiTheme.Micro, new Point(plot.Left - size.Width - 5, y), UiTheme.Muted2, Color.Transparent,
                TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        }
    }

    public static void DrawRightYTickLabels(Graphics g, Rectangle plot, double min, double max, int count = 3, string format = "0.##")
    {
        if (count < 2) return;
        for (var i = 0; i < count; i++)
        {
            var t = i / (double)(count - 1);
            var value = max - (max - min) * t;
            var text = value.ToString(format);
            var y = plot.Top + (int)Math.Round(t * plot.Height) - 6;
            TextRenderer.DrawText(g, text, UiTheme.Micro, new Point(plot.Right + 5, y), UiTheme.Muted2, Color.Transparent,
                TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        }
    }

    public static void DrawHorizontalReference(Graphics g, Rectangle plot, double value, double minY, double maxY)
    {
        if (value < minY || value > maxY || maxY <= minY) return;
        var y = plot.Bottom - (float)((value - minY) / (maxY - minY) * plot.Height);
        using var pen = new Pen(Color.FromArgb(95, UiTheme.Axis), 1f) { DashStyle = DashStyle.Dot };
        g.DrawLine(pen, plot.Left, y, plot.Right, y);
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
        e.Graphics.Clear(UiTheme.ModuleBack);
        DrawModuleMark(e.Graphics, "功率");

        var snapshot = Provider.Snapshot(Config);
        var readoutWidth = Math.Clamp((int)(Width * 0.19), 150, 188);
        var left = new Rectangle(0, 0, Math.Max(10, Width - readoutWidth), Height);
        var readout = new Rectangle(left.Right, 0, readoutWidth, Height);

        using (var readoutBack = new SolidBrush(UiTheme.Surface))
            e.Graphics.FillRectangle(readoutBack, readout);
        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(divider, left.Right, 5, left.Right, Height - 5);

        const int headerH = 24;
        var overviewHeight = Math.Clamp(Height / 10, 36, 48);
        _overviewRect = Rectangle.FromLTRB(left.Left + 46, left.Bottom - overviewHeight - 6, left.Right - 10, left.Bottom - 6);
        var mainBounds = Rectangle.FromLTRB(left.Left + 2, headerH, left.Right - 2, _overviewRect.Top - 4);
        var plot = PlotDrawer.DrawGrid(e.Graphics, mainBounds, 44, 28, 7, 24);

        const double totalSeconds = 600;
        var all = Enumerable.Range(0, 3).Select(i => Provider.PowerHistory(i, totalSeconds, 900)).ToArray();
        var minIndex = Math.Clamp((int)Math.Round(_rangeStart * 899), 0, 898);
        var maxIndex = Math.Clamp((int)Math.Round(_rangeEnd * 899), minIndex + 1, 899);
        var startX = all[0][minIndex].Time;
        var endX = all[0][maxIndex].Time;
        var span = Math.Max(0.001, endX - startX);

        var selected = all.Select(series => series
            .Skip(minIndex)
            .Take(maxIndex - minIndex + 1)
            .Select(p => (X: p.Time - endX, Y: p.Value))
            .ToArray()).ToArray();

        var physicalMax = Math.Max(1.0, selected.Take(2).SelectMany(x => x).Max(x => x.Y) * 1.08);
        const double physicalMin = 0.0;
        var mathMin = selected[2].Min(x => x.Y);
        var mathMax = selected[2].Max(x => x.Y);
        var mathPad = Math.Max(0.18, (mathMax - mathMin) * 0.35);
        mathMin -= mathPad;
        mathMax += mathPad;

        PlotDrawer.DrawSeries(e.Graphics, plot, selected[0], TraceColors[0], -span, 0, physicalMin, physicalMax, 1.6f);
        PlotDrawer.DrawSeries(e.Graphics, plot, selected[1], TraceColors[1], -span, 0, physicalMin, physicalMax, 1.5f);
        PlotDrawer.DrawSeries(e.Graphics, plot, selected[2], TraceColors[2], -span, 0, mathMin, mathMax, 1.55f);

        PlotDrawer.DrawYTickLabels(e.Graphics, plot, physicalMin, physicalMax, 3, "0.##");
        PlotDrawer.DrawRightYTickLabels(e.Graphics, plot, mathMin, mathMax, 3, "0.0");
        PlotDrawer.DrawXTickLabels(e.Graphics, plot, -span, 0, 3, "0");
        PlotDrawer.DrawLegend(e.Graphics, plot, snapshot.Power.Select((x, i) => (x.Name, TraceColors[i])).ToArray(), bottomRight: true);
        PlotDrawer.DrawUnit(e.Graphics, plot, "s");
        TextRenderer.DrawText(e.Graphics, "%", UiTheme.Micro, new Point(plot.Right + 5, plot.Top - 13), UiTheme.Muted2, Color.Transparent,
            TextFormatFlags.NoPadding);

        DrawOverview(e.Graphics, all[0]);
        DrawReadout(e.Graphics, readout, snapshot.Power);
    }

    private void DrawOverview(Graphics g, IReadOnlyList<(double Time, double Value)> history)
    {
        using (var back = new SolidBrush(Color.FromArgb(248, 251, 253)))
            g.FillRectangle(back, _overviewRect);
        using (var border = new Pen(UiTheme.Border, 1f))
            g.DrawRectangle(border, _overviewRect);

        var inner = Rectangle.Inflate(_overviewRect, -4, -4);
        var min = history.Min(x => x.Value);
        var max = history.Max(x => x.Value);
        var pad = Math.Max(0.02, (max - min) * .08);
        PlotDrawer.DrawSeries(g, inner, history.Select(x => (x.Time, x.Value)).ToArray(), Color.FromArgb(135, UiTheme.Accent),
            history[0].Time, history[^1].Time, min - pad, max + pad, 1f);

        var x1 = inner.Left + (float)(_rangeStart * inner.Width);
        var x2 = inner.Left + (float)(_rangeEnd * inner.Width);
        using (var shade = new SolidBrush(Color.FromArgb(18, UiTheme.Accent)))
            g.FillRectangle(shade, RectangleF.FromLTRB(x1, inner.Top, x2, inner.Bottom));
        using (var selectPen = new Pen(Color.FromArgb(165, UiTheme.Accent), 1f))
            g.DrawRectangle(selectPen, x1, inner.Top, Math.Max(1, x2 - x1), inner.Height);
        using var handle = new Pen(Color.FromArgb(190, UiTheme.Accent), 1.3f);
        g.DrawLine(handle, x1, inner.Top, x1, inner.Bottom);
        g.DrawLine(handle, x2, inner.Top, x2, inner.Bottom);
    }

    private static void DrawReadout(Graphics g, Rectangle rect, IReadOnlyList<NumericTrace> traces)
    {
        var y = 18;
        for (var i = 0; i < traces.Count; i++)
        {
            var trace = traces[i];
            using (var swatch = new Pen(TraceColors[Math.Min(i, TraceColors.Length - 1)], 2f))
                g.DrawLine(swatch, rect.Left + 12, y + 6, rect.Left + 26, y + 6);
            TextRenderer.DrawText(g, trace.Name, UiTheme.Tiny, new Point(rect.Left + 31, y), UiTheme.Muted, Color.Transparent,
                TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
            y += 16;
            TextRenderer.DrawText(g, $"{trace.Value:F2}", UiTheme.Metric, new Point(rect.Left + 12, y), UiTheme.Ink, Color.Transparent,
                TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
            var numberSize = TextRenderer.MeasureText($"{trace.Value:F2}", UiTheme.Metric, Size.Empty, TextFormatFlags.NoPadding);
            TextRenderer.DrawText(g, trace.Unit, UiTheme.Tiny, new Point(rect.Left + 16 + numberSize.Width, y + 6), UiTheme.Muted, Color.Transparent,
                TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
            y += 38;
        }

        if (traces.Count == 0) return;
        var separatorY = Math.Min(rect.Bottom - 62, y + 2);
        using (var line = new Pen(UiTheme.Divider, 1f))
            g.DrawLine(line, rect.Left + 10, separatorY, rect.Right - 10, separatorY);
        TextRenderer.DrawText(g, $"最大值  {traces[0].Name}", UiTheme.Tiny, new Point(rect.Left + 12, separatorY + 10), UiTheme.Muted, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(g, $"{traces[0].MaxValue:F2} {traces[0].Unit}", UiTheme.ValueBold, new Point(rect.Left + 12, separatorY + 27), UiTheme.Ink, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
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
    public SpectrumModuleView(IInstrumentProvider provider, AppConfig config) : base(ModuleKind.Spectrum, provider, config)
    {
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.Clear(UiTheme.ModuleBack);
        DrawModuleMark(e.Graphics, "光谱");

        var snapshot = Provider.Snapshot(Config);
        const int headerH = 27;
        var x = 65;
        x = DrawInlineMetric(e.Graphics, x, 5, "λc", $"{snapshot.CenterWavelength:F2} nm");
        x = DrawInlineMetric(e.Graphics, x, 5, "3 dB", $"{snapshot.Linewidth3Db:F2} nm");
        x = DrawInlineMetric(e.Graphics, x, 5, "RMS", $"{snapshot.LinewidthRms:F2} nm");
        DrawInlineMetric(e.Graphics, x, 5, "P", $"{snapshot.SpectrumPower:F1} dBm");

        var selector = Config.Osa1Alias + "  ▾";
        var selectorSize = TextRenderer.MeasureText(selector, UiTheme.Small, Size.Empty, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(e.Graphics, selector, UiTheme.Small, new Point(Width - selectorSize.Width - 10, 5), UiTheme.Ink, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);

        var bounds = new Rectangle(2, headerH, Width - 4, Height - headerH - 2);
        var plot = PlotDrawer.DrawGrid(e.Graphics, bounds, 45, 10, 7, 24);
        var points = snapshot.Spectrum.Select(p => (p.X, p.Y)).ToArray();
        var minX = points[0].X;
        var maxX = points[^1].X;
        var minY = Math.Floor(points.Min(p => p.Y) / 10.0) * 10.0;
        var maxY = Math.Ceiling(points.Max(p => p.Y) / 5.0) * 5.0;
        if (maxY - minY < 20) minY = maxY - 20;

        PlotDrawer.DrawSeries(e.Graphics, plot, points, UiTheme.Accent, minX, maxX, minY, maxY, 1.65f);
        PlotDrawer.DrawYTickLabels(e.Graphics, plot, minY, maxY, 4, "0");
        PlotDrawer.DrawXTickLabels(e.Graphics, plot, minX, maxX, 3, "0.0");
        PlotDrawer.DrawLegend(e.Graphics, plot, new[] { (Config.Osa1Alias, UiTheme.Accent) });
        PlotDrawer.DrawUnit(e.Graphics, plot, "nm");
        TextRenderer.DrawText(e.Graphics, "dBm", UiTheme.Micro, new Point(plot.Left - 35, plot.Top - 14), UiTheme.Muted2, Color.Transparent,
            TextFormatFlags.NoPadding);
    }

    private static int DrawInlineMetric(Graphics g, int x, int y, string label, string value)
    {
        TextRenderer.DrawText(g, label, UiTheme.Micro, new Point(x, y + 2), UiTheme.Muted, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        var labelWidth = TextRenderer.MeasureText(label, UiTheme.Micro, Size.Empty, TextFormatFlags.NoPadding).Width;
        TextRenderer.DrawText(g, value, UiTheme.SmallBold, new Point(x + labelWidth + 5, y), UiTheme.Ink, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        var valueWidth = TextRenderer.MeasureText(value, UiTheme.SmallBold, Size.Empty, TextFormatFlags.NoPadding).Width;
        return x + labelWidth + valueWidth + 19;
    }
}

internal sealed class BeamModuleView : ModuleViewBase
{
    private readonly CompactSlider _zSlider = new() { Minimum = -20, Maximum = 20 };
    private readonly CompactSlider _attSlider = new() { Minimum = 0, Maximum = 30 };
    private readonly GlyphButton _playButton = new(GlyphKind.Capture);
    private readonly System.Windows.Forms.Timer _playTimer = new() { Interval = 80 };
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
        _attSlider.ValueChanged += (_, _) =>
        {
            Config.BeamAttenuation = _attSlider.Value;
            Invalidate();
        };
        _playButton.Click += (_, _) => TogglePlayback();
        _playTimer.Tick += (_, _) =>
        {
            var next = _zSlider.Value + 0.55;
            if (next > _zSlider.Maximum) next = _zSlider.Minimum;
            _zSlider.Value = next;
        };

        MouseWheel += (_, e) =>
        {
            if (!_spotRect.Contains(e.Location)) return;
            _spotZoom = Math.Clamp(_spotZoom * (e.Delta > 0 ? 1.12f : 0.89f), 0.55f, 5f);
            Invalidate();
        };
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        var y = Math.Max(0, Height - 31);
        _zSlider.SetBounds(32, y + 3, Math.Clamp(Width / 6, 100, 145), 20);
        _playButton.SetBounds(_zSlider.Right + 61, y + 1, 23, 23);
        _attSlider.SetBounds(_playButton.Right + 48, y + 3, Math.Clamp(Width / 7, 85, 122), 20);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.Clear(UiTheme.ModuleBack);
        DrawModuleMark(e.Graphics, "光束");
        var snapshot = Provider.Snapshot(Config);

        const int headerH = 24;
        const int bottomH = 35;
        var content = Rectangle.FromLTRB(0, headerH, Width, Math.Max(headerH + 20, Height - bottomH));
        var split = Math.Clamp((int)(content.Width * 0.41), 190, Math.Max(191, content.Width - 260));
        _spotRect = Rectangle.FromLTRB(6, content.Top + 2, split - 5, content.Bottom - 3);
        var causticBounds = Rectangle.FromLTRB(split + 3, content.Top + 2, content.Right - 4, content.Bottom - 3);

        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(divider, split, content.Top + 3, split, content.Bottom - 3);

        DrawSpot(e.Graphics, _spotRect, snapshot);
        var plot = PlotDrawer.DrawGrid(e.Graphics, causticBounds, 43, 10, 8, 24);
        var xSeries = snapshot.Beam.Select(p => (p.Z, p.X)).ToArray();
        var ySeries = snapshot.Beam.Select(p => (p.Z, p.Y)).ToArray();
        var minY = Math.Min(xSeries.Min(p => p.X), ySeries.Min(p => p.Y)) * .78;
        var maxY = Math.Max(xSeries.Max(p => p.X), ySeries.Max(p => p.Y)) * 1.05;

        PlotDrawer.DrawSeries(e.Graphics, plot, xSeries, UiTheme.Accent, -24, 24, minY, maxY, 1.55f);
        PlotDrawer.DrawSeries(e.Graphics, plot, ySeries, UiTheme.Orange, -24, 24, minY, maxY, 1.55f);
        PlotDrawer.DrawYTickLabels(e.Graphics, plot, minY, maxY, 3, "0.00");
        PlotDrawer.DrawXTickLabels(e.Graphics, plot, -24, 24, 3, "0");
        PlotDrawer.DrawLegend(e.Graphics, plot, new[] { ("X", UiTheme.Accent), ("Y", UiTheme.Orange) });
        PlotDrawer.DrawUnit(e.Graphics, plot, "mm");

        var markerX = plot.Left + (float)((Math.Clamp(_browseZ, -24, 24) + 24) / 48.0 * plot.Width);
        using (var marker = new Pen(Color.FromArgb(155, UiTheme.Accent2), 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(marker, markerX, plot.Top, markerX, plot.Bottom);

        using (var bottomLine = new Pen(UiTheme.Divider, 1f))
            e.Graphics.DrawLine(bottomLine, 5, content.Bottom + 1, Width - 5, content.Bottom + 1);
        DrawBottomRow(e.Graphics, snapshot);
    }

    private void DrawSpot(Graphics g, Rectangle rect, MeasurementSnapshot snapshot)
    {
        using (var back = new SolidBrush(UiTheme.PlotBack))
            g.FillRectangle(back, rect);
        using (var border = new Pen(UiTheme.Border, 1f))
            g.DrawRectangle(border, rect);

        var nearest = snapshot.Beam.OrderBy(p => Math.Abs(p.Z - _browseZ)).First();
        var center = new PointF(rect.Left + rect.Width / 2f + _spotPan.X, rect.Top + rect.Height / 2f + _spotPan.Y);
        var baseRadius = Math.Min(rect.Width, rect.Height) * .115f * _spotZoom;
        var rxMax = Math.Max(10f, baseRadius * (float)(nearest.X / 0.30));
        var ryMax = Math.Max(10f, baseRadius * (float)(nearest.Y / 0.34));

        for (var i = 26; i >= 1; i--)
        {
            var t = i / 26f;
            var profile = Math.Exp(-2.0 * t * t);
            var alpha = Math.Clamp((int)(8 + 42 * profile), 5, 54);
            using var brush = new SolidBrush(Color.FromArgb(alpha, 42, 126, 198));
            var rx = rxMax * t;
            var ry = ryMax * t;
            g.FillEllipse(brush, center.X - rx, center.Y - ry, rx * 2, ry * 2);
        }

        using (var cross = new Pen(Color.FromArgb(65, UiTheme.Axis), 1f) { DashStyle = DashStyle.Dash })
        {
            g.DrawLine(cross, center.X, rect.Top + 7, center.X, rect.Bottom - 7);
            g.DrawLine(cross, rect.Left + 7, center.Y, rect.Right - 7, center.Y);
        }

        TextRenderer.DrawText(g, $"Z {_browseZ:+0.0;-0.0;0.0} mm", UiTheme.Tiny, new Point(rect.Left + 9, rect.Top + 8), UiTheme.Muted, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
    }

    private void DrawBottomRow(Graphics g, MeasurementSnapshot snapshot)
    {
        var y = Height - 25;
        TextRenderer.DrawText(g, "Z", UiTheme.Tiny, new Point(11, y + 4), UiTheme.Muted, Color.Transparent, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, $"{_browseZ:F1} mm", UiTheme.Tiny, new Point(_zSlider.Right + 5, y + 4), UiTheme.Ink, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(g, "Att", UiTheme.Tiny, new Point(_playButton.Right + 20, y + 4), UiTheme.Muted, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(g, $"{Config.BeamAttenuation:F1} dB", UiTheme.Tiny, new Point(_attSlider.Right + 5, y + 4), UiTheme.Ink, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);

        var m2 = $"M²x {snapshot.M2X:F2}     M²y {snapshot.M2Y:F2}     M̄² {snapshot.M2Mean:F2}";
        var size = TextRenderer.MeasureText(m2, UiTheme.ValueBold, Size.Empty, TextFormatFlags.NoPadding);
        TextRenderer.DrawText(g, m2, UiTheme.ValueBold, new Point(Math.Max(_attSlider.Right + 68, Width - size.Width - 11), y + 1), UiTheme.Ink, Color.Transparent,
            TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
    }

    private void TogglePlayback()
    {
        _playing = !_playing;
        _playButton.Active = _playing;
        _playButton.Filled = _playing;
        _playButton.Invalidate();
        if (_playing) _playTimer.Start();
        else _playTimer.Stop();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && _spotRect.Contains(e.Location) && e.X > 30)
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
        if (!_pan) return;
        _spotPan = new PointF(_panOrigin.X + e.X - _panStart.X, _panOrigin.Y + e.Y - _panStart.Y);
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (!_pan) return;
        _pan = false;
        Cursor = Cursors.Default;
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
    public ScopeModuleView(IInstrumentProvider provider, AppConfig config) : base(ModuleKind.Scope, provider, config)
    {
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.Clear(UiTheme.ModuleBack);
        DrawModuleMark(e.Graphics, "示波器");
        var snapshot = Provider.Snapshot(Config);

        const int headerH = 22;
        var available = Math.Max(40, Height - headerH);
        var half = headerH + available / 2;
        var topBounds = Rectangle.FromLTRB(2, headerH, Width - 3, Math.Max(headerH + 10, half - 4));
        var bottomBounds = Rectangle.FromLTRB(2, half + 4, Width - 3, Height - 2);
        using (var divider = new Pen(UiTheme.Divider, 1f) { DashStyle = DashStyle.Dash })
            e.Graphics.DrawLine(divider, 5, half, Width - 5, half);

        DrawScopePlot(e.Graphics, topBounds, snapshot.ScopeTime, "ms", -1.1, 1.1);
        DrawScopePlot(e.Graphics, bottomBounds, snapshot.ScopeFft, "kHz", 0, 1.05);
    }

    private void DrawScopePlot(Graphics g, Rectangle bounds, IReadOnlyList<ScopePoint> data, string unit, double minY, double maxY)
    {
        var plot = PlotDrawer.DrawGrid(g, bounds, 43, 10, 6, 23);
        var minX = data[0].X;
        var maxX = data[^1].X;
        PlotDrawer.DrawHorizontalReference(g, plot, 0, minY, maxY);
        PlotDrawer.DrawSeries(g, plot, data.Select(p => (p.X, p.Ch1)).ToArray(), UiTheme.Accent, minX, maxX, minY, maxY, 1.55f);
        PlotDrawer.DrawSeries(g, plot, data.Select(p => (p.X, p.Ch2)).ToArray(), UiTheme.Orange, minX, maxX, minY, maxY, 1.45f);
        PlotDrawer.DrawYTickLabels(g, plot, minY, maxY, 3, "0.0");
        PlotDrawer.DrawXTickLabels(g, plot, minX, maxX, 3, "0.##");
        PlotDrawer.DrawLegend(g, plot, new[] { (Config.Scope1Alias, UiTheme.Accent), (Config.Scope2Alias, UiTheme.Orange) });
        PlotDrawer.DrawUnit(g, plot, unit);
    }
}
