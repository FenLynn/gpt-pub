using System.Drawing.Drawing2D;
using LocalSub.Models;

namespace LocalSub.UI;

public sealed class EnhancedWaveformView : Control
{
    const float VisualTarget = 0.95f;
    const double VisualReferencePercentile = 0.995;

    float[] _samples = [];
    TimeSpan _duration;
    IReadOnlyList<TranscriptItem> _segments = [];
    float _visualReference = 1f;

    public EnhancedWaveformView()
    {
        DoubleBuffered = true;
        ResizeRedraw = true;
        BackColor = SystemColors.Window;
        ForeColor = SystemColors.ControlText;
        Height = 180;
        MinimumSize = new Size(200, 120);
    }

    public void SetWaveform(float[] samples, TimeSpan duration)
    {
        _samples = samples ?? [];
        _duration = duration;
        _visualReference = CalculateVisualReference(_samples);
        Invalidate();
    }

    public void SetTranscript(IEnumerable<TranscriptItem> items)
    {
        _segments = items.OrderBy(x => x.Start).ToArray();
        Invalidate();
    }

    public void ClearAll()
    {
        _samples = [];
        _segments = [];
        _duration = TimeSpan.Zero;
        _visualReference = 1f;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        var r = ClientRectangle;
        if (r.Width < 12 || r.Height < 12) return;

        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var usableLeft = 12;
        var usableRight = Math.Max(usableLeft + 1, r.Width - 12);
        var usableWidth = usableRight - usableLeft;
        var waveTop = 18;
        var waveBottom = Math.Max(waveTop + 20, r.Height - 34);
        var center = (waveTop + waveBottom) / 2f;
        var half = Math.Max(8f, (waveBottom - waveTop) / 2f - 5);
        var maxVisualHeight = half * VisualTarget;
        var trackRect = new Rectangle(usableLeft, waveTop, usableWidth, waveBottom - waveTop);

        using var trackBrush = new SolidBrush(Color.FromArgb(249, 250, 252));
        using var borderPen = new Pen(Color.FromArgb(222, 226, 230));
        g.FillRectangle(trackBrush, trackRect);
        g.DrawRectangle(borderPen, trackRect);

        if (_samples.Length == 0)
        {
            TextRenderer.DrawText(g, "选择媒体后生成声音轨道；转写后叠加语音区间和关键词标记", Font, trackRect,
                Color.FromArgb(145, 150, 156), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            return;
        }

        DrawTimeGrid(g, usableLeft, usableWidth, waveTop, waveBottom);
        DrawSpeechRegions(g, usableLeft, usableWidth, waveTop, waveBottom);

        using (var axisPen = new Pen(Color.FromArgb(205, 211, 217)))
            g.DrawLine(axisPen, usableLeft, center, usableRight, center);

        var heights = BuildVisualEnvelope(usableWidth, maxVisualHeight);
        if (heights.Length > 1)
        {
            var polygon = new PointF[heights.Length * 2];
            var upper = new PointF[heights.Length];
            var lower = new PointF[heights.Length];
            for (var x = 0; x < heights.Length; x++)
            {
                var px = usableLeft + x;
                upper[x] = new PointF(px, center - heights[x]);
                lower[x] = new PointF(px, center + heights[x]);
                polygon[x] = upper[x];
                polygon[polygon.Length - 1 - x] = lower[x];
            }

            using var waveFill = new SolidBrush(Color.FromArgb(112, 55, 125, 181));
            using var waveOutline = new Pen(Color.FromArgb(42, 92, 146), 1.15f);
            g.FillPolygon(waveFill, polygon);
            g.DrawLines(waveOutline, upper);
            g.DrawLines(waveOutline, lower);
        }

        DrawTopLegend(g, usableLeft, usableWidth, waveTop);
        DrawTimeLabels(g, usableLeft, usableWidth, r.Height);
    }

    void DrawTimeGrid(Graphics g, int left, int width, int top, int bottom)
    {
        using var gridPen = new Pen(Color.FromArgb(232, 235, 239)) { DashStyle = DashStyle.Dot };
        for (var i = 1; i < 4; i++)
        {
            var x = left + (int)Math.Round(width * i / 4d);
            g.DrawLine(gridPen, x, top + 1, x, bottom - 1);
        }
    }

    void DrawSpeechRegions(Graphics g, int left, int width, int top, int bottom)
    {
        if (_duration <= TimeSpan.Zero || _segments.Count == 0) return;

        using var speechBrush = new SolidBrush(Color.FromArgb(24, 35, 156, 125));
        using var keywordPen = new Pen(Color.FromArgb(205, 139, 24), 1.8f);
        using var keywordBrush = new SolidBrush(Color.FromArgb(220, 148, 24));

        foreach (var seg in _segments)
        {
            var x1 = left + (int)Math.Round(Math.Clamp(seg.Start.TotalSeconds / _duration.TotalSeconds, 0, 1) * width);
            var x2 = left + (int)Math.Round(Math.Clamp(seg.End.TotalSeconds / _duration.TotalSeconds, 0, 1) * width);
            if (x2 <= x1) x2 = x1 + 1;
            g.FillRectangle(speechBrush, x1, top + 1, Math.Max(1, x2 - x1), Math.Max(1, bottom - top - 1));

            if (seg.Keywords.Count > 0)
            {
                g.DrawLine(keywordPen, x1, top - 5, x1, bottom + 1);
                var marker = new[]
                {
                    new PointF(x1 - 4, top - 7),
                    new PointF(x1 + 4, top - 7),
                    new PointF(x1, top - 2)
                };
                g.FillPolygon(keywordBrush, marker);
            }
        }
    }

    float[] BuildVisualEnvelope(int width, float maxVisualHeight)
    {
        if (width <= 0) return [];
        var raw = new float[width];
        for (var x = 0; x < width; x++)
        {
            var start = (int)((long)x * _samples.Length / width);
            var end = Math.Max(start + 1, (int)((long)(x + 1) * _samples.Length / width));
            end = Math.Min(end, _samples.Length);
            float peak = 0;
            for (var i = start; i < end; i++) peak = Math.Max(peak, Math.Abs(_samples[i]));
            var normalized = _visualReference > 0.000001f ? peak / _visualReference : 0f;
            raw[x] = Math.Max(0.8f, Math.Min(maxVisualHeight, normalized * maxVisualHeight));
        }

        if (width < 3) return raw;
        var smooth = new float[width];
        smooth[0] = raw[0];
        smooth[^1] = raw[^1];
        for (var i = 1; i < width - 1; i++)
            smooth[i] = raw[i - 1] * 0.2f + raw[i] * 0.6f + raw[i + 1] * 0.2f;
        return smooth;
    }

    void DrawTopLegend(Graphics g, int left, int width, int waveTop)
    {
        var labelRect = new Rectangle(left + 6, waveTop + 5, Math.Max(120, width / 2), 18);
        TextRenderer.DrawText(g, "声音包络  ·  自动增益 95%", Font, labelRect,
            Color.FromArgb(112, 119, 126), TextFormatFlags.Left | TextFormatFlags.NoPadding);

        if (_segments.Count == 0) return;
        var speechCount = _segments.Count;
        var keywordCount = _segments.Count(x => x.Keywords.Count > 0);
        var info = $"语音 {speechCount} 段" + (keywordCount > 0 ? $"   关键词 {keywordCount}" : "");
        var infoRect = new Rectangle(left + width / 2, waveTop + 5, Math.Max(80, width / 2 - 6), 18);
        TextRenderer.DrawText(g, info, Font, infoRect, Color.FromArgb(112, 119, 126),
            TextFormatFlags.Right | TextFormatFlags.NoPadding);
    }

    void DrawTimeLabels(Graphics g, int left, int width, int height)
    {
        if (_duration <= TimeSpan.Zero) return;
        for (var i = 0; i <= 4; i++)
        {
            var fraction = i / 4d;
            var text = FormatClock(TimeSpan.FromSeconds(_duration.TotalSeconds * fraction));
            var x = left + (int)Math.Round(width * fraction);
            var labelWidth = 70;
            var labelX = Math.Clamp(x - labelWidth / 2, left, left + width - labelWidth);
            var flags = TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPadding;
            TextRenderer.DrawText(g, text, Font, new Rectangle(labelX, height - 24, labelWidth, 18),
                Color.FromArgb(120, 126, 132), flags);
        }
    }

    static float CalculateVisualReference(float[] samples)
    {
        if (samples == null || samples.Length == 0) return 1f;

        var values = samples
            .Select(Math.Abs)
            .Where(x => float.IsFinite(x) && x > 0.000001f)
            .OrderBy(x => x)
            .ToArray();
        if (values.Length == 0) return 1f;

        var index = (int)Math.Clamp(
            Math.Round((values.Length - 1) * VisualReferencePercentile),
            0,
            values.Length - 1);
        var reference = values[index];
        return Math.Max(reference, 0.0001f);
    }

    static string FormatClock(TimeSpan t)
        => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");
}
