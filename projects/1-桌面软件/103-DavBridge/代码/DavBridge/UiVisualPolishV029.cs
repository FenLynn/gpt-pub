using System.Drawing.Drawing2D;
using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.2.9 presentation layer. Unlike v0.2.8 it does not attach Paint handlers to
/// controls whose OnPaint continues drawing afterwards. Instead it places a child
/// surface above the validated dashboard controls, giving each visual region a
/// single final painter and eliminating duplicated endpoint text / arrows.
/// </summary>
internal sealed class UiVisualPolishV029 : IDisposable
{
    private readonly UiDashboardV027 _dashboard;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private readonly List<Control> _surfaces = new();
    private bool _disposed;

    private UiVisualPolishV029(UiDashboardV027 dashboard)
    {
        _dashboard = dashboard;
        ApplyStaticPolish();
        InstallSurfaces();
        _timer.Tick += (_, _) => RefreshSurfaces();
        _timer.Start();
    }

    public static UiVisualPolishV029 Attach(UiDashboardV027 dashboard) => new(dashboard);

    private T? Field<T>(string name) where T : class
    {
        try
        {
            return typeof(UiDashboardV027)
                .GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?
                .GetValue(_dashboard) as T;
        }
        catch { return null; }
    }

    private void ApplyStaticPolish()
    {
        if (Field<Panel>("_sidebar") is { } sidebar)
            sidebar.BackColor = Color.FromArgb(253, 254, 255);

        if (Field<Panel>("_taskCard") is { } taskCard)
        {
            taskCard.BackColor = Color.FromArgb(249, 252, 255);
            if (!taskCard.Controls.OfType<Panel>().Any(x => x.Name == "V029Accent"))
            {
                taskCard.Controls.Add(new Panel
                {
                    Name = "V029Accent",
                    Dock = DockStyle.Left,
                    Width = 3,
                    BackColor = Color.FromArgb(115, 184, 231)
                });
            }
        }

        if (Field<Button>("_settingsButton") is { } settings)
        {
            settings.BackColor = Color.FromArgb(253, 254, 255);
            settings.ForeColor = Color.FromArgb(55, 69, 82);
            settings.FlatAppearance.BorderSize = 0;
            settings.FlatAppearance.MouseOverBackColor = Color.FromArgb(242, 248, 252);
            settings.FlatAppearance.MouseDownBackColor = Color.FromArgb(233, 243, 250);
        }

        if (Field<Label>("_taskState") is { } taskState)
            taskState.ForeColor = Color.FromArgb(104, 116, 127);
    }

    private void InstallSurfaces()
    {
        if (Field<RouteFlowV026>("_flow") is { } flow)
            AddSurface(flow, new RouteSurface(flow));
        if (Field<StageTrackV026>("_stageTrack") is { } stages)
            AddSurface(stages, new StageSurface(stages));
        if (Field<GradientMeterBar>("_overallBar") is { } overall)
            AddSurface(overall, new MeterSurface(overall, MeterKind.Overall));
        if (Field<GradientMeterBar>("_currentBar") is { } current)
            AddSurface(current, new MeterSurface(current, MeterKind.Current));
        if (Field<GradientMeterBar>("_uploadBar") is { } upload)
            AddSurface(upload, new MeterSurface(upload, MeterKind.Quota));
        if (Field<GradientMeterBar>("_downloadBar") is { } download)
            AddSurface(download, new MeterSurface(download, MeterKind.Quota));
    }

    private void AddSurface(Control host, Control surface)
    {
        surface.Dock = DockStyle.Fill;
        surface.Margin = Padding.Empty;
        surface.TabStop = false;
        host.Controls.Add(surface);
        surface.BringToFront();
        _surfaces.Add(surface);
    }

    private void RefreshSurfaces()
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

    private static object? PrivateField(object instance, string name)
    {
        try
        {
            return instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance);
        }
        catch { return null; }
    }

    private sealed class RouteSurface : Control
    {
        private readonly RouteFlowV026 _source;

        public RouteSurface(RouteFlowV026 source)
        {
            _source = source;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.White;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Color.White);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;

            var left = PrivateField(_source, "_left") as string ?? "InfiniCLOUD";
            var right = PrivateField(_source, "_right") as string ?? "坚果云";
            var status = PrivateField(_source, "_status") as string ?? "已暂停";
            var recent = PrivateField(_source, "_recent") as string ?? string.Empty;
            var kind = PrivateField(_source, "_kind") is UiStatusKind value ? value : UiStatusKind.Paused;

            using var nameFont = new Font("Segoe UI Semibold", 9.3F);
            using var statusFont = new Font("Segoe UI Semibold", 9F);
            using var recentFont = new Font("Segoe UI", 8.3F);

            const float centerY = 62f;
            const float iconSize = 24f;
            const float outerPad = 8f;
            const float endpointWidth = 138f;
            const float iconGap = 7f;

            var leftIcon = new RectangleF(outerPad, centerY - iconSize / 2, iconSize, iconSize);
            var rightIcon = new RectangleF(Width - outerPad - iconSize, centerY - iconSize / 2, iconSize, iconSize);
            DrawInfiniCloud(e.Graphics, leftIcon);
            DrawAcorn(e.Graphics, rightIcon);

            var leftName = new Rectangle((int)(leftIcon.Right + iconGap), (int)centerY - 12,
                Math.Max(60, (int)(endpointWidth - iconSize - iconGap)), 24);
            var rightBlockLeft = Width - outerPad - endpointWidth;
            var rightName = new Rectangle((int)rightBlockLeft, (int)centerY - 12,
                Math.Max(60, (int)(endpointWidth - iconSize - iconGap)), 24);
            TextRenderer.DrawText(e.Graphics, left, nameFont, leftName, Color.FromArgb(45, 52, 58),
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(e.Graphics, right, nameFont, rightName, Color.FromArgb(45, 52, 58),
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);

            var arrowLeft = endpointWidth + 18f;
            var arrowRight = Width - endpointWidth - 18f;
            if (arrowRight - arrowLeft < 126f)
            {
                var mid = Width / 2f;
                arrowLeft = mid - 63f;
                arrowRight = mid + 63f;
            }

            using var arrowPath = CreateArrowPath(arrowLeft, arrowRight, centerY, 10.5f, 22f);
            var (start, end) = FlowColors(kind);
            using var arrowBrush = new LinearGradientBrush(
                new PointF(arrowLeft, centerY), new PointF(arrowRight, centerY), start, end);
            e.Graphics.FillPath(arrowBrush, arrowPath);

            var statusRect = new Rectangle((int)arrowLeft + 14, (int)centerY - 12,
                Math.Max(52, (int)(arrowRight - arrowLeft - 43)), 24);
            TextRenderer.DrawText(e.Graphics, status, statusFont, statusRect, Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

            if (!string.IsNullOrWhiteSpace(recent))
            {
                var recentRect = new Rectangle((int)arrowLeft, 14,
                    Math.Max(100, (int)(arrowRight - arrowLeft)), 19);
                TextRenderer.DrawText(e.Graphics, recent, recentFont, recentRect, Color.FromArgb(126, 136, 145),
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
            path.AddLine(bodyRight, centerY - halfHeight, right, centerY);
            path.AddLine(right, centerY, bodyRight, centerY + halfHeight);
            path.AddLine(bodyRight, centerY + halfHeight, left + radius, centerY + halfHeight);
            path.CloseFigure();
            return path;
        }

        private static (Color Start, Color End) FlowColors(UiStatusKind kind) => kind switch
        {
            UiStatusKind.Running => (Color.FromArgb(128, 209, 166), Color.FromArgb(31, 143, 87)),
            UiStatusKind.Preparing => (Color.FromArgb(177, 216, 244), Color.FromArgb(76, 139, 192)),
            UiStatusKind.Quota => (Color.FromArgb(255, 235, 168), Color.FromArgb(196, 143, 39)),
            UiStatusKind.Network => (Color.FromArgb(250, 207, 157), Color.FromArgb(202, 119, 37)),
            UiStatusKind.Error => (Color.FromArgb(250, 190, 190), Color.FromArgb(188, 67, 67)),
            UiStatusKind.Complete => (Color.FromArgb(133, 204, 176), Color.FromArgb(39, 128, 98)),
            _ => (Color.FromArgb(213, 221, 228), Color.FromArgb(132, 146, 158))
        };

        private static void DrawInfiniCloud(Graphics g, RectangleF rect)
        {
            using var pen = new Pen(Color.FromArgb(239, 132, 0), Math.Max(2.2f, rect.Width * .145f))
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round
            };
            var top = rect.Top + rect.Height * .22f;
            var h = rect.Height * .56f;
            var w = rect.Width * .58f;
            g.DrawArc(pen, new RectangleF(rect.Left, top, w, h), 36, 288);
            g.DrawArc(pen, new RectangleF(rect.Right - w, top, w, h), 216, 288);
        }

        private static void DrawAcorn(Graphics g, RectangleF rect)
        {
            var bodyRect = new RectangleF(rect.Left + 5, rect.Top + 7, rect.Width - 10, rect.Height - 8);
            using var body = new LinearGradientBrush(bodyRect,
                Color.FromArgb(239, 198, 116), Color.FromArgb(174, 103, 50), 50f);
            using var edge = new Pen(Color.FromArgb(141, 83, 45), 1.1f);
            g.FillEllipse(body, bodyRect);
            g.DrawEllipse(edge, bodyRect);
            using var cap = new SolidBrush(Color.FromArgb(148, 89, 47));
            g.FillEllipse(cap, rect.Left + 4, rect.Top + 4, rect.Width - 8, 8);
            using var stem = new Pen(Color.FromArgb(112, 72, 42), 2.1f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLine(stem, rect.Right - 7, rect.Top + 5, rect.Right - 3, rect.Top + 1);
        }
    }

    private sealed class StageSurface : Control
    {
        private readonly StageTrackV026 _source;
        public StageSurface(StageTrackV026 source)
        {
            _source = source;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.White;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Color.White);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            string[] stages = { "预核验", "拉取", "核验", "上传", "回读" };
            var active = _source.ActiveIndex;
            using var font = new Font("Segoe UI", 8.8F);
            using var activeFont = new Font("Segoe UI Semibold", 8.8F);
            var usable = Math.Max(1, Width - 8);
            var slot = usable / (float)stages.Length;
            for (var i = 0; i < stages.Length; i++)
            {
                var rect = new Rectangle((int)(4 + i * slot), 1, Math.Max(42, (int)slot - 5), Height - 3);
                if (i == active)
                {
                    var pill = Rectangle.Inflate(rect, -8, -3);
                    using var bg = new SolidBrush(Color.FromArgb(237, 247, 254));
                    using var path = RoundedRect(pill, 6f);
                    e.Graphics.FillPath(bg, path);
                    TextRenderer.DrawText(e.Graphics, stages[i], activeFont, rect, Color.FromArgb(55, 143, 207),
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
                }
                else
                {
                    TextRenderer.DrawText(e.Graphics, stages[i], font, rect, Color.FromArgb(166, 174, 181),
                        TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
                }
            }
            var sepX = (int)(4 + slot);
            using var sep = new Pen(Color.FromArgb(214, 221, 227), 1f);
            e.Graphics.DrawLine(sep, sepX, 7, sepX, Height - 7);
        }
    }

    private sealed class MeterSurface : Control
    {
        private readonly GradientMeterBar _source;
        private readonly MeterKind _kind;
        public MeterSurface(GradientMeterBar source, MeterKind kind)
        {
            _source = source;
            _kind = kind;
            Font = source.Font;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            // This surface paints the parent's background explicitly in OnPaint.
            // Do not request WinForms transparent BackColor here because plain Control
            // does not guarantee SupportsTransparentBackColor during construction.
            BackColor = Color.White;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Parent?.BackColor ?? Color.White);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            var rect = new RectangleF(.5f, .5f, Math.Max(1, Width - 1.5f), Math.Max(1, Height - 1.5f));
            using var trackPath = RoundedRect(rect, Math.Min(5f, rect.Height / 2f));
            using var track = new SolidBrush(Color.FromArgb(243, 246, 248));
            e.Graphics.FillPath(track, trackPath);

            var reserveWidth = (float)(rect.Width * _source.ReserveFraction);
            if (reserveWidth > .5f)
            {
                using var reserve = new SolidBrush(Color.FromArgb(216, 222, 228));
                e.Graphics.SetClip(trackPath);
                e.Graphics.FillRectangle(reserve, rect.Right - reserveWidth, rect.Top, reserveWidth, rect.Height);
                e.Graphics.ResetClip();
            }

            var usableWidth = Math.Max(1f, rect.Width - reserveWidth);
            var (light, dark) = MeterColors(_kind, _source.Fraction);
            if (_source.Pulse)
            {
                var pulseOffset = PrivateField(_source, "_pulseOffset") is int p ? p : 0;
                var segment = Math.Max(30f, usableWidth * .22f);
                var x = rect.Left + (pulseOffset / 140f) * (usableWidth + segment) - segment;
                var pulseRect = RectangleF.Intersect(rect, new RectangleF(x, rect.Top, segment, rect.Height));
                if (pulseRect.Width > 0)
                {
                    using var pulse = new LinearGradientBrush(pulseRect, light, dark, LinearGradientMode.Horizontal);
                    e.Graphics.SetClip(trackPath);
                    e.Graphics.FillRectangle(pulse, pulseRect);
                    e.Graphics.ResetClip();
                }
            }
            else
            {
                var fillWidth = Math.Min(usableWidth, (float)(rect.Width * _source.Fraction));
                if (fillWidth > .5f)
                {
                    var fillRect = new RectangleF(rect.Left, rect.Top, fillWidth, rect.Height);
                    using var fill = new LinearGradientBrush(fillRect, light, dark, LinearGradientMode.Horizontal);
                    e.Graphics.SetClip(trackPath);
                    e.Graphics.FillRectangle(fill, fillRect);
                    e.Graphics.ResetClip();
                }
            }

            using var border = new Pen(Color.FromArgb(210, 216, 222), 1f);
            e.Graphics.DrawPath(border, trackPath);
            if (!string.IsNullOrWhiteSpace(_source.BarText))
            {
                TextRenderer.DrawText(e.Graphics, _source.BarText, Font, Rectangle.Round(rect), Color.FromArgb(55, 63, 70),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            }
        }

        private static (Color Light, Color Dark) MeterColors(MeterKind kind, double fraction)
        {
            if (kind is MeterKind.Overall or MeterKind.Current)
                return (Color.FromArgb(239, 249, 255), Color.FromArgb(83, 170, 230));
            if (fraction >= .90)
                return (Color.FromArgb(255, 245, 245), Color.FromArgb(220, 66, 66));
            if (fraction >= .60)
                return (Color.FromArgb(255, 252, 232), Color.FromArgb(228, 165, 32));
            return (Color.FromArgb(244, 253, 248), Color.FromArgb(37, 157, 94));
        }
    }

    private static GraphicsPath RoundedRect(Rectangle rect, float radius) =>
        RoundedRect(new RectangleF(rect.X, rect.Y, rect.Width, rect.Height), radius);

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

    private enum MeterKind { Overall, Current, Quota }
}
