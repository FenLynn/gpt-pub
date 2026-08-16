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

        using var border = new Pen(SystemColors.ControlLight);
        g.DrawRectangle(border, 0, 0, r.Width - 1, r.Height - 1);

        if (_samples.Length == 0)
        {
            TextRenderer.DrawText(g, "选择媒体后生成声音轨道；转写后叠加语音区间和关键词标记", Font, r,
                SystemColors.GrayText, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            return;
        }

        var usableLeft = 8;
        var usableRight = Math.Max(usableLeft + 1, r.Width - 8);
        var usableWidth = usableRight - usableLeft;
        var waveTop = 14;
        var waveBottom = Math.Max(waveTop + 20, r.Height - 42);
        var center = (waveTop + waveBottom) / 2f;
        var half = Math.Max(8f, (waveBottom - waveTop) / 2f - 2);
        var maxVisualHeight = half * VisualTarget;

        using var speechBrush = new SolidBrush(Color.FromArgb(238, 244, 249));
        using var keywordPen = new Pen(Color.FromArgb(190, 145, 40), 2f);
        if (_duration > TimeSpan.Zero)
        {
            foreach (var seg in _segments)
            {
                var x1 = usableLeft + (int)Math.Round(Math.Clamp(seg.Start.TotalSeconds / _duration.TotalSeconds, 0, 1) * usableWidth);
                var x2 = usableLeft + (int)Math.Round(Math.Clamp(seg.End.TotalSeconds / _duration.TotalSeconds, 0, 1) * usableWidth);
                if (x2 <= x1) x2 = x1 + 1;
                g.FillRectangle(speechBrush, x1, waveTop, Math.Max(1, x2 - x1), waveBottom - waveTop);
                if (seg.Keywords.Count > 0)
                    g.DrawLine(keywordPen, x1, 6, x1, r.Height - 24);
            }
        }

        using var axis = new Pen(SystemColors.ControlLight);
        g.DrawLine(axis, usableLeft, center, usableRight, center);
        using var pen = new Pen(ForeColor);
        for (var x = 0; x < usableWidth; x++)
        {
            var start = (int)((long)x * _samples.Length / usableWidth);
            var end = Math.Max(start + 1, (int)((long)(x + 1) * _samples.Length / usableWidth));
            end = Math.Min(end, _samples.Length);
            float peak = 0;
            for (var i = start; i < end; i++) peak = Math.Max(peak, Math.Abs(_samples[i]));

            // Normalize the waveform for display only. The high-percentile reference
            // prevents one isolated click/pop from compressing the rest of the track.
            // ASR/VAD continue to use the original, unmodified audio samples.
            var normalized = _visualReference > 0.000001f ? peak / _visualReference : 0f;
            var h = Math.Max(1f, Math.Min(maxVisualHeight, normalized * maxVisualHeight));
            var px = x + usableLeft;
            g.DrawLine(pen, px, center - h, px, center + h);
        }

        TextRenderer.DrawText(g, "00:00", Font, new Rectangle(usableLeft, r.Height - 22, 70, 18), SystemColors.GrayText);
        var rightText = FormatClock(_duration);
        TextRenderer.DrawText(g, rightText, Font, new Rectangle(r.Width - 100, r.Height - 22, 92, 18), SystemColors.GrayText, TextFormatFlags.Right);

        if (_segments.Count > 0)
        {
            var speechCount = _segments.Count;
            var keywordCount = _segments.Count(x => x.Keywords.Count > 0);
            TextRenderer.DrawText(g, $"语音 {speechCount} 段   关键词命中 {keywordCount} 段", Font,
                new Rectangle(usableLeft + 72, r.Height - 22, Math.Max(80, r.Width - 250), 18), SystemColors.GrayText,
                TextFormatFlags.HorizontalCenter);
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

        // Avoid extreme amplification of digital silence / near-silence.
        return Math.Max(reference, 0.0001f);
    }

    static string FormatClock(TimeSpan t)
        => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");
}
