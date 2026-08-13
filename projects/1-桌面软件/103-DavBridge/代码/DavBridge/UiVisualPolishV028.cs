using System.Drawing.Drawing2D;
using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.2.8 presentation-only polish for the validated v0.2.7 dashboard.
/// It deliberately does not participate in migration, quota, persistence or WebDAV decisions.
/// </summary>
internal sealed class UiVisualPolishV028 : IDisposable
{
    private readonly UiDashboardV027 _dashboard;
    private readonly List<(Control Control, PaintEventHandler Handler)> _paintHooks = new();
    private bool _disposed;

    private UiVisualPolishV028(UiDashboardV027 dashboard)
    {
        _dashboard = dashboard;
        ApplyStaticPolish();
        HookFlow();
        HookStageTrack();
        HookMeters();
        HookTaskCard();
    }

    public static UiVisualPolishV028 Attach(UiDashboardV027 dashboard)
        => new(dashboard);

    private T? Field<T>(string name) where T : class
    {
        try
        {
            return typeof(UiDashboardV027)
                .GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?
                .GetValue(_dashboard) as T;
        }
        catch
        {
            return null;
        }
    }

    private void ApplyStaticPolish()
    {
        if (Field<Panel>("_sidebar") is { } sidebar)
            sidebar.BackColor = Color.FromArgb(251, 252, 253);

        if (Field<Panel>("_taskCard") is { } taskCard)
            taskCard.BackColor = Color.FromArgb(247, 250, 253);

        if (Field<Button>("_settingsButton") is { } settings)
        {
            settings.BackColor = Color.FromArgb(251, 252, 253);
            settings.ForeColor = Color.FromArgb(54, 67, 79);
            settings.FlatAppearance.MouseOverBackColor = Color.FromArgb(242, 247, 251);
            settings.FlatAppearance.MouseDownBackColor = Color.FromArgb(235, 243, 249);
            settings.FlatAppearance.BorderSize = 0;
        }

        if (Field<Label>("_taskState") is { } taskState)
            taskState.ForeColor = Color.FromArgb(105, 116, 126);
    }

    private void HookFlow()
    {
        var flow = Field<RouteFlowV026>("_flow");
        if (flow is null) return;
        PaintEventHandler handler = PaintFlow;
        flow.Paint += handler;
        _paintHooks.Add((flow, handler));
        flow.Invalidate();
    }

    private void HookStageTrack()
    {
        var track = Field<StageTrackV026>("_stageTrack");
        if (track is null) return;
        PaintEventHandler handler = PaintStageTrack;
        track.Paint += handler;
        _paintHooks.Add((track, handler));
        track.Invalidate();
    }

    private void HookMeters()
    {
        HookMeter(Field<GradientMeterBar>("_overallBar"), MeterKind.Overall);
        HookMeter(Field<GradientMeterBar>("_currentBar"), MeterKind.Current);
        HookMeter(Field<GradientMeterBar>("_uploadBar"), MeterKind.Quota);
        HookMeter(Field<GradientMeterBar>("_downloadBar"), MeterKind.Quota);
    }

    private void HookMeter(GradientMeterBar? bar, MeterKind kind)
    {
        if (bar is null) return;
        PaintEventHandler handler = (_, e) => PaintMeter(bar, e, kind);
        bar.Paint += handler;
        _paintHooks.Add((bar, handler));
        bar.Invalidate();
    }

    private void HookTaskCard()
    {
        var taskCard = Field<Panel>("_taskCard");
        if (taskCard is null) return;
        PaintEventHandler handler = (_, e) =>
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var line = new SolidBrush(Color.FromArgb(117, 181, 226));
            e.Graphics.FillRectangle(line, 0, 5, 3, Math.Max(1, taskCard.Height - 10));
        };
        taskCard.Paint += handler;
        _paintHooks.Add((taskCard, handler));
        taskCard.Invalidate();
    }

    private static object? PrivateField(object instance, string name)
    {
        try
        {
            return instance.GetType()
                .GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?
                .GetValue(instance);
        }
        catch
        {
            return null;
        }
    }

    private static void PaintFlow(object? sender, PaintEventArgs e)
    {
        if (sender is not RouteFlowV026 flow) return;

        e.Graphics.Clear(Color.White);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var left = PrivateField(flow, "_left") as string ?? "InfiniCLOUD";
        var right = PrivateField(flow, "_right") as string ?? "坚果云";
        var status = PrivateField(flow, "_status") as string ?? "已暂停";
        var recent = PrivateField(flow, "_recent") as string ?? string.Empty;
        var kind = PrivateField(flow, "_kind") is UiStatusKind value ? value : UiStatusKind.Paused;

        using var nameFont = new Font("Segoe UI Semibold", 9.3F);
        using var statusFont = new Font("Segoe UI Semibold", 9F);
        using var recentFont = new Font("Segoe UI", 8.4F);

        var centerY = 62f;
        var icon = 25f;
        var leftIcon = new RectangleF(10, centerY - icon / 2, icon, icon);
        var rightIcon = new RectangleF(flow.Width - 35, centerY - icon / 2, icon, icon);
        DrawInfiniCloud(e.Graphics, leftIcon);
        DrawAcorn(e.Graphics, rightIcon);

        var leftName = new Rectangle(42, (int)centerY - 12, 112, 24);
        var rightName = new Rectangle(flow.Width - 154, (int)centerY - 12, 112, 24);
        TextRenderer.DrawText(e.Graphics, left, nameFont, leftName, Color.FromArgb(45, 50, 55),
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        TextRenderer.DrawText(e.Graphics, right, nameFont, rightName, Color.FromArgb(45, 50, 55),
            TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

        var arrowLeft = 164f;
        var arrowRight = Math.Max(arrowLeft + 128f, flow.Width - 164f);
        var bodyHalf = 11f;
        var tipLength = 23f;
        using var arrowPath = CreateArrowPath(arrowLeft, arrowRight, centerY, bodyHalf, tipLength);
        var (start, end) = FlowColors(kind);
        using var arrowBrush = new LinearGradientBrush(
            new PointF(arrowLeft, centerY),
            new PointF(arrowRight, centerY),
            start,
            end);
        e.Graphics.FillPath(arrowBrush, arrowPath);

        var statusRect = new Rectangle((int)arrowLeft + 12, (int)centerY - 13,
            Math.Max(60, (int)(arrowRight - arrowLeft - tipLength - 18)), 26);
        TextRenderer.DrawText(e.Graphics, status, statusFont, statusRect, Color.White,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

        if (!string.IsNullOrWhiteSpace(recent))
        {
            var recentRect = new Rectangle((int)arrowLeft, 13,
                Math.Max(100, (int)(arrowRight - arrowLeft)), 19);
            TextRenderer.DrawText(e.Graphics, recent, recentFont, recentRect, Color.FromArgb(126, 135, 143),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }

    private static GraphicsPath CreateArrowPath(float left, float right, float centerY, float halfHeight, float tipLength)
    {
        var path = new GraphicsPath();
        var bodyRight = right - tipLength;
        var radius = halfHeight;

        path.StartFigure();
        path.AddArc(left, centerY - radius, radius * 2, radius * 2, 90, 180);
        path.AddLine(left + radius, centerY - halfHeight, bodyRight, centerY - halfHeight);
        path.AddLine(bodyRight, centerY - halfHeight - 3, right, centerY);
        path.AddLine(right, centerY, bodyRight, centerY + halfHeight + 3);
        path.AddLine(bodyRight, centerY + halfHeight, left + radius, centerY + halfHeight);
        path.CloseFigure();
        return path;
    }

    private static (Color Start, Color End) FlowColors(UiStatusKind kind) => kind switch
    {
        UiStatusKind.Running => (Color.FromArgb(92, 190, 138), Color.FromArgb(33, 142, 88)),
        UiStatusKind.Preparing => (Color.FromArgb(128, 188, 231), Color.FromArgb(69, 132, 186)),
        UiStatusKind.Quota => (Color.FromArgb(241, 205, 111), Color.FromArgb(196, 143, 39)),
        UiStatusKind.Network => (Color.FromArgb(238, 174, 103), Color.FromArgb(202, 119, 37)),
        UiStatusKind.Error => (Color.FromArgb(235, 127, 127), Color.FromArgb(188, 67, 67)),
        UiStatusKind.Complete => (Color.FromArgb(88, 177, 143), Color.FromArgb(39, 128, 98)),
        _ => (Color.FromArgb(176, 188, 199), Color.FromArgb(126, 139, 151))
    };

    private static void DrawInfiniCloud(Graphics g, RectangleF rect)
    {
        using var pen = new Pen(Color.FromArgb(239, 132, 0), Math.Max(2.2f, rect.Width * .15f))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };
        var top = rect.Top + rect.Height * .22f;
        var h = rect.Height * .56f;
        var w = rect.Width * .58f;
        var l = new RectangleF(rect.Left, top, w, h);
        var r = new RectangleF(rect.Right - w, top, w, h);
        g.DrawArc(pen, l, 36, 288);
        g.DrawArc(pen, r, 216, 288);
    }

    private static void DrawAcorn(Graphics g, RectangleF rect)
    {
        var bodyRect = new RectangleF(rect.Left + 5, rect.Top + 7, rect.Width - 10, rect.Height - 8);
        using var body = new LinearGradientBrush(bodyRect,
            Color.FromArgb(232, 184, 96), Color.FromArgb(170, 101, 48), 50f);
        using var edge = new Pen(Color.FromArgb(141, 83, 45), 1.15f);
        g.FillEllipse(body, bodyRect);
        g.DrawEllipse(edge, bodyRect);

        using var cap = new LinearGradientBrush(
            new RectangleF(rect.Left + 4, rect.Top + 4, rect.Width - 8, 9),
            Color.FromArgb(183, 116, 60), Color.FromArgb(132, 77, 43), 90f);
        g.FillEllipse(cap, rect.Left + 4, rect.Top + 4, rect.Width - 8, 9);

        using var stem = new Pen(Color.FromArgb(114, 72, 42), 2.3f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round
        };
        g.DrawLine(stem, rect.Right - 7, rect.Top + 5, rect.Right - 3, rect.Top + 1);
    }

    private static void PaintStageTrack(object? sender, PaintEventArgs e)
    {
        if (sender is not StageTrackV026 track) return;
        e.Graphics.Clear(Color.White);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        string[] stages = { "预核验", "拉取", "核验", "上传", "回读" };
        var active = track.ActiveIndex;
        using var font = new Font("Segoe UI", 8.8F);
        using var activeFont = new Font("Segoe UI Semibold", 8.8F);
        var usable = Math.Max(1, track.Width - 8);
        var slot = usable / (float)stages.Length;

        for (var i = 0; i < stages.Length; i++)
        {
            var rect = new Rectangle((int)(4 + i * slot), 1, Math.Max(42, (int)slot - 5), track.Height - 3);
            if (i == active)
            {
                var pill = Rectangle.Inflate(rect, -8, -3);
                using var bg = new SolidBrush(Color.FromArgb(238, 247, 254));
                using var path = RoundedRect(pill, 6f);
                e.Graphics.FillPath(bg, path);
                TextRenderer.DrawText(e.Graphics, stages[i], activeFont, rect, Color.FromArgb(62, 145, 207),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
            else
            {
                TextRenderer.DrawText(e.Graphics, stages[i], font, rect, Color.FromArgb(158, 166, 173),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
        }

        var sepX = (int)(4 + slot);
        using var sep = new Pen(Color.FromArgb(213, 219, 224), 1f);
        e.Graphics.DrawLine(sep, sepX, 7, sepX, track.Height - 7);
    }

    private static void PaintMeter(GradientMeterBar bar, PaintEventArgs e, MeterKind kind)
    {
        e.Graphics.Clear(bar.Parent?.BackColor ?? Color.White);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var rect = new RectangleF(0.5f, 0.5f, Math.Max(1, bar.Width - 1.5f), Math.Max(1, bar.Height - 1.5f));
        using var trackPath = RoundedRect(rect, Math.Min(5f, rect.Height / 2f));
        using var trackBrush = new SolidBrush(Color.FromArgb(241, 244, 247));
        e.Graphics.FillPath(trackBrush, trackPath);

        var reserveWidth = (float)(rect.Width * bar.ReserveFraction);
        if (reserveWidth > 0.5f)
        {
            var reserveRect = new RectangleF(rect.Right - reserveWidth, rect.Top, reserveWidth, rect.Height);
            using var reserve = new SolidBrush(Color.FromArgb(214, 219, 225));
            e.Graphics.SetClip(trackPath);
            e.Graphics.FillRectangle(reserve, reserveRect);
            e.Graphics.ResetClip();
        }

        var usableWidth = Math.Max(1f, rect.Width - reserveWidth);
        if (bar.Pulse)
        {
            var pulseOffset = PrivateField(bar, "_pulseOffset") is int p ? p : 0;
            var segment = Math.Max(30f, usableWidth * .22f);
            var x = rect.Left + (pulseOffset / 140f) * (usableWidth + segment) - segment;
            var pulseRect = RectangleF.Intersect(rect, new RectangleF(x, rect.Top, segment, rect.Height));
            if (pulseRect.Width > 0)
            {
                var (light, dark) = MeterColors(kind, bar.Fraction);
                using var pulse = new LinearGradientBrush(pulseRect, light, dark, LinearGradientMode.Horizontal);
                e.Graphics.SetClip(trackPath);
                e.Graphics.FillRectangle(pulse, pulseRect);
                e.Graphics.ResetClip();
            }
        }
        else
        {
            var fillWidth = Math.Min(usableWidth, (float)(rect.Width * bar.Fraction));
            if (fillWidth > 0.5f)
            {
                var fillRect = new RectangleF(rect.Left, rect.Top, fillWidth, rect.Height);
                var (light, dark) = MeterColors(kind, bar.Fraction);
                using var fill = new LinearGradientBrush(fillRect, light, dark, LinearGradientMode.Horizontal);
                e.Graphics.SetClip(trackPath);
                e.Graphics.FillRectangle(fill, fillRect);
                e.Graphics.ResetClip();
            }
        }

        using var border = new Pen(Color.FromArgb(207, 213, 219), 1f);
        e.Graphics.DrawPath(border, trackPath);

        if (!string.IsNullOrWhiteSpace(bar.BarText))
        {
            var textRect = Rectangle.Round(rect);
            TextRenderer.DrawText(e.Graphics, bar.BarText, bar.Font, textRect, Color.FromArgb(54, 61, 67),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter |
                TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        }
    }

    private static (Color Light, Color Dark) MeterColors(MeterKind kind, double fraction)
    {
        if (kind is MeterKind.Overall or MeterKind.Current)
            return (Color.FromArgb(234, 247, 255), Color.FromArgb(91, 174, 232));

        if (fraction >= .90)
            return (Color.FromArgb(255, 236, 236), Color.FromArgb(220, 74, 74));
        if (fraction >= .60)
            return (Color.FromArgb(255, 249, 220), Color.FromArgb(225, 168, 43));
        return (Color.FromArgb(237, 250, 243), Color.FromArgb(42, 159, 98));
    }

    private static GraphicsPath RoundedRect(Rectangle rect, float radius)
        => RoundedRect(new RectangleF(rect.X, rect.Y, rect.Width, rect.Height), radius);

    private static GraphicsPath RoundedRect(RectangleF rect, float radius)
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

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var (control, handler) in _paintHooks)
        {
            if (!control.IsDisposed)
                control.Paint -= handler;
        }
        _paintHooks.Clear();
    }

    private enum MeterKind
    {
        Overall,
        Current,
        Quota
    }
}
