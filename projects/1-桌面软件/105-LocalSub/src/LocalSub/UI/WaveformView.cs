namespace LocalSub.UI;

public sealed class WaveformView : Control
{
    float[] _samples = [];
    TimeSpan _duration;

    public WaveformView()
    {
        DoubleBuffered = true;
        BackColor = SystemColors.Window;
        ForeColor = SystemColors.ControlText;
        Height = 150;
    }

    public void SetWaveform(float[] samples, TimeSpan duration)
    {
        _samples = samples ?? [];
        _duration = duration;
        Invalidate();
    }

    public void ClearWaveform()
    {
        _samples = [];
        _duration = TimeSpan.Zero;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        var r = ClientRectangle;
        if (r.Width < 8 || r.Height < 8) return;

        using var border = new Pen(SystemColors.ControlDark);
        g.DrawRectangle(border, 0, 0, r.Width - 1, r.Height - 1);

        if (_samples.Length == 0)
        {
            TextRenderer.DrawText(g, "拖入并选择视频后，这里会生成声音波形", Font, r,
                SystemColors.GrayText, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
            return;
        }

        var top = 18;
        var bottom = r.Height - 24;
        var center = (top + bottom) / 2f;
        var half = Math.Max(8f, (bottom - top) / 2f - 2);
        using var axis = new Pen(SystemColors.ControlLight);
        g.DrawLine(axis, 4, center, r.Width - 4, center);
        using var pen = new Pen(ForeColor);
        var usableWidth = Math.Max(1, r.Width - 12);
        for (var x = 0; x < usableWidth; x++)
        {
            var start = (int)((long)x * _samples.Length / usableWidth);
            var end = Math.Max(start + 1, (int)((long)(x + 1) * _samples.Length / usableWidth));
            end = Math.Min(end, _samples.Length);
            float peak = 0;
            for (var i = start; i < end; i++) peak = Math.Max(peak, _samples[i]);
            var h = Math.Max(1f, peak * half);
            var px = x + 6;
            g.DrawLine(pen, px, center - h, px, center + h);
        }

        var leftText = "00:00";
        var rightText = _duration.TotalHours >= 1 ? _duration.ToString(@"hh\:mm\:ss") : _duration.ToString(@"mm\:ss");
        TextRenderer.DrawText(g, leftText, Font, new Rectangle(5, r.Height - 22, 70, 18), SystemColors.GrayText);
        TextRenderer.DrawText(g, rightText, Font, new Rectangle(r.Width - 90, r.Height - 22, 84, 18), SystemColors.GrayText, TextFormatFlags.Right);
    }
}
