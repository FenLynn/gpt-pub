using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Reflection;

namespace DavBridge;

/// <summary>
/// Final v0.2.24 presentation pass. It replaces older active overlay surfaces with one calm,
/// coherent palette and keeps layout polish in a single owner without changing transfer logic.
/// </summary>
internal sealed class UiRefinementV0224 : IDisposable
{
    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 140 };
    private readonly List<Control> _surfaces = new();
    private bool _disposed;

    private UiRefinementV0224(MainForm form, UiDashboardV027 dashboard)
    {
        _form = form;
        _dashboard = dashboard;
        ApplyStaticPolish();
        InstallFinalSurfaces();
        _form.Resize += OnResize;
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
    }

    public static UiRefinementV0224 Attach(MainForm form, UiDashboardV027 dashboard) => new(form, dashboard);

    private T? Field<T>(string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_dashboard) as T; }
        catch { return null; }
    }

    private void ApplyStaticPolish()
    {
        if (Field<TableLayoutPanel>("_shell") is { } shell)
            ApplyResponsiveShell(shell);

        if (Field<Panel>("_sidebar") is { } sidebar)
        {
            sidebar.BackColor = Color.FromArgb(248, 250, 252);
            sidebar.Padding = _form.ClientSize.Width < 760
                ? new Padding(8, 18, 8, 14)
                : new Padding(15, 20, 11, 16);
        }

        if (Field<Panel>("_taskCard") is { } card)
        {
            card.BackColor = Color.White;
            if (!card.Controls.OfType<Panel>().Any(x => x.Name == "V0224Accent"))
            {
                card.Controls.Add(new Panel
                {
                    Name = "V0224Accent",
                    Dock = DockStyle.Left,
                    Width = 2,
                    BackColor = Color.FromArgb(115, 163, 190),
                    TabStop = false
                });
            }
        }

        if (Field<Label>("_brand") is { } brand)
        {
            brand.ForeColor = Color.FromArgb(31, 39, 45);
            brand.Font = new Font("Segoe UI Semibold", brand.Font.Size);
        }

        if (Field<Label>("_taskName") is { } taskName)
        {
            taskName.ForeColor = Color.FromArgb(45, 55, 62);
            taskName.Font = new Font("Microsoft YaHei UI", 9.3F, FontStyle.Bold);
        }

        if (Field<Label>("_taskState") is { } taskState)
        {
            taskState.ForeColor = Color.FromArgb(143, 117, 67);
            taskState.Font = new Font("Microsoft YaHei UI", 8.4F);
        }

        if (Field<Button>("_settingsButton") is { } settings)
        {
            settings.UseVisualStyleBackColor = false;
            settings.BackColor = Color.FromArgb(248, 250, 252);
            settings.ForeColor = Color.FromArgb(78, 91, 101);
            settings.Font = new Font("Microsoft YaHei UI", 8.9F);
            settings.FlatAppearance.BorderSize = 0;
            settings.FlatAppearance.MouseOverBackColor = Color.FromArgb(239, 244, 247);
            settings.FlatAppearance.MouseDownBackColor = Color.FromArgb(232, 239, 243);
        }

        if (Field<Label>("_title") is { } title)
        {
            title.ForeColor = Color.FromArgb(25, 32, 37);
            title.Font = new Font("Microsoft YaHei UI", 16.2F, FontStyle.Bold);
            title.Margin = new Padding(0, 0, 0, 0);
            if (title.Parent is TableLayoutPanel root)
            {
                root.Padding = new Padding(30, 16, 30, 15);
                root.BackColor = Color.White;
            }
        }

        foreach (var field in new[] { "_overallTitle", "_currentTitle", "_cycleTitle" })
        {
            if (Field<Label>(field) is not { } label) continue;
            label.ForeColor = Color.FromArgb(47, 58, 66);
            label.Font = new Font("Microsoft YaHei UI", 9.6F, FontStyle.Bold);
        }

        if (Field<RouteFlowV026>("_flow") is { } flow)
        {
            flow.Height = 92;
            flow.Margin = new Padding(0, 0, 0, 1);
        }

        if (Field<GradientMeterBar>("_overallBar") is { } overall)
            overall.Height = 24;
        if (Field<StageTrackV026>("_stageTrack") is { } stages)
            stages.Height = 34;
        if (Field<GradientMeterBar>("_currentBar") is { } current)
            current.Height = 28;
        if (Field<GradientMeterBar>("_uploadBar") is { } upload)
            upload.Height = 18;
        if (Field<GradientMeterBar>("_downloadBar") is { } download)
            download.Height = 18;

        if (Field<Label>("_resetValue") is { } reset)
        {
            reset.ForeColor = Color.FromArgb(125, 135, 143);
            reset.Font = new Font("Microsoft YaHei UI", 8.1F);
            reset.Margin = new Padding(0, 4, 0, 0);
        }

        PolishSectionSpacing();
        PolishCycleArea();
        PolishBottomAction();
    }

    private void ApplyResponsiveShell(TableLayoutPanel shell)
    {
        if (shell.ColumnStyles.Count == 0) return;
        shell.ColumnStyles[0].Width = _form.ClientSize.Width < 760 ? 58 : 176;
    }

    private void PolishSectionSpacing()
    {
        if (Field<Label>("_overallTitle") is { Parent: TableLayoutPanel overall })
            overall.Margin = new Padding(0, 8, 0, 0);
        if (Field<Label>("_currentTitle") is { Parent: TableLayoutPanel current })
            current.Margin = new Padding(0, 12, 0, 0);
        if (Field<Label>("_cycleTitle") is { Parent: TableLayoutPanel cycle })
            cycle.Margin = new Padding(0, 14, 0, 0);
    }

    private void PolishCycleArea()
    {
        if (Field<Label>("_cycleTitle") is not { Parent: TableLayoutPanel section }) return;

        if (section.ColumnStyles.Count >= 4)
            section.ColumnStyles[3].Width = 72;

        foreach (var label in Descendants(section).OfType<Label>())
        {
            if (label.Text is "上传" or "下载")
            {
                label.ForeColor = Color.FromArgb(54, 65, 72);
                label.Font = new Font("Microsoft YaHei UI", 8.7F, FontStyle.Bold);
                label.Margin = new Padding(0, 6, 0, 0);
            }
        }

        var calibration = Descendants(section).OfType<Button>().FirstOrDefault(x => x.Text.Trim() == "校准");
        if (calibration is not null)
        {
            calibration.Width = 64;
            calibration.Height = 28;
            calibration.Margin = new Padding(8, 2, 0, 0);
            calibration.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        }
    }

    private void PolishBottomAction()
    {
        var primary = Descendants(_form).OfType<PrimaryActionSurfaceV0217>().FirstOrDefault();
        if (primary?.Parent is not TableLayoutPanel bottom) return;
        bottom.Margin = new Padding(0, 14, 0, 4);
        bottom.MinimumSize = new Size(0, 48);
    }

    private void InstallFinalSurfaces()
    {
        if (Field<RouteFlowV026>("_flow") is { } flow)
            ReplaceSurface(flow, new RouteSurfaceV0224(flow));

        if (Field<StageTrackV026>("_stageTrack") is { } stages)
            ReplaceSurface(stages, new TransferStageSurfaceV0224(stages));

        if (Field<GradientMeterBar>("_overallBar") is { } overall)
            ReplaceSurface(overall, new MeterSurfaceV0224(overall, RefinedMeterKindV0224.Overall));

        if (Field<GradientMeterBar>("_currentBar") is { } current)
            ReplaceSurface(current, new MeterSurfaceV0224(current, RefinedMeterKindV0224.Current));

        if (Field<GradientMeterBar>("_uploadBar") is { } upload)
            ReplaceSurface(upload, new MeterSurfaceV0224(upload, RefinedMeterKindV0224.Quota));

        if (Field<GradientMeterBar>("_downloadBar") is { } download)
            ReplaceSurface(download, new MeterSurfaceV0224(download, RefinedMeterKindV0224.Quota));
    }

    private void ReplaceSurface(Control host, Control surface)
    {
        foreach (Control child in host.Controls.Cast<Control>().ToArray())
        {
            host.Controls.Remove(child);
            child.Dispose();
        }

        surface.Dock = DockStyle.Fill;
        surface.Margin = Padding.Empty;
        surface.TabStop = false;
        host.Controls.Add(surface);
        surface.BringToFront();
        _surfaces.Add(surface);
    }

    private void OnResize(object? sender, EventArgs e)
    {
        if (_disposed) return;
        if (Field<TableLayoutPanel>("_shell") is { } shell)
            ApplyResponsiveShell(shell);
        ApplyStaticPolish();
    }

    private void Refresh()
    {
        if (_disposed) return;
        foreach (var surface in _surfaces)
            if (!surface.IsDisposed) surface.Invalidate();
    }

    private static object? PrivateField(object instance, string name)
    {
        try { return instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance); }
        catch { return null; }
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child)) yield return nested;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _form.Resize -= OnResize;
        _timer.Stop();
        _timer.Dispose();
        foreach (var surface in _surfaces)
            if (!surface.IsDisposed) surface.Dispose();
        _surfaces.Clear();
    }

    private sealed class RouteSurfaceV0224 : Control
    {
        private readonly RouteFlowV026 _source;

        public RouteSurfaceV0224(RouteFlowV026 source)
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
            e.Graphics.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;

            var left = PrivateField(_source, "_left") as string ?? "InfiniCLOUD";
            var right = PrivateField(_source, "_right") as string ?? "坚果云";
            var status = PrivateField(_source, "_status") as string ?? "已暂停";
            var recent = PrivateField(_source, "_recent") as string ?? string.Empty;
            var kind = PrivateField(_source, "_kind") is UiStatusKind value ? value : UiStatusKind.Paused;

            using var nameFont = new Font("Segoe UI Semibold", 9.1F);
            using var statusFont = new Font("Microsoft YaHei UI", 8.7F, FontStyle.Bold);
            using var recentFont = new Font("Microsoft YaHei UI", 8.0F);

            const float centerY = 55f;
            const float iconSize = 24f;
            const float outerPad = 9f;
            const float endpointWidth = 136f;
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

            TextRenderer.DrawText(e.Graphics, left, nameFont, leftName, Color.FromArgb(50, 59, 65),
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(e.Graphics, right, nameFont, rightName, Color.FromArgb(50, 59, 65),
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);

            var arrowLeft = endpointWidth + 17f;
            var arrowRight = Width - endpointWidth - 17f;
            if (arrowRight - arrowLeft < 126f)
            {
                var mid = Width / 2f;
                arrowLeft = mid - 63f;
                arrowRight = mid + 63f;
            }

            using var arrowPath = CreateArrowPath(arrowLeft, arrowRight, centerY, 10f, 21f);
            var (start, end, ink) = FlowColors(kind);
            using var arrowBrush = new LinearGradientBrush(
                new PointF(arrowLeft, centerY), new PointF(arrowRight, centerY), start, end);
            e.Graphics.FillPath(arrowBrush, arrowPath);

            var statusRect = new Rectangle((int)arrowLeft + 13, (int)centerY - 12,
                Math.Max(54, (int)(arrowRight - arrowLeft - 42)), 24);
            TextRenderer.DrawText(e.Graphics, status, statusFont, statusRect, ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

            if (!string.IsNullOrWhiteSpace(recent))
            {
                var recentRect = new Rectangle((int)arrowLeft, 7,
                    Math.Max(100, (int)(arrowRight - arrowLeft)), 18);
                TextRenderer.DrawText(e.Graphics, recent, recentFont, recentRect, Color.FromArgb(128, 139, 147),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
        }

        private static (Color Start, Color End, Color Ink) FlowColors(UiStatusKind kind) => kind switch
        {
            UiStatusKind.Running => (Color.FromArgb(224, 241, 234), Color.FromArgb(158, 205, 187), Color.FromArgb(47, 103, 83)),
            UiStatusKind.Preparing => (Color.FromArgb(230, 240, 247), Color.FromArgb(174, 205, 225), Color.FromArgb(55, 100, 127)),
            UiStatusKind.Quota => (Color.FromArgb(246, 238, 218), Color.FromArgb(218, 195, 142), Color.FromArgb(111, 87, 43)),
            UiStatusKind.Network => (Color.FromArgb(247, 233, 220), Color.FromArgb(218, 178, 143), Color.FromArgb(119, 76, 38)),
            UiStatusKind.Error => (Color.FromArgb(247, 226, 224), Color.FromArgb(222, 173, 168), Color.FromArgb(132, 70, 65)),
            UiStatusKind.Complete => (Color.FromArgb(225, 241, 233), Color.FromArgb(169, 207, 190), Color.FromArgb(55, 103, 83)),
            _ => (Color.FromArgb(235, 239, 242), Color.FromArgb(201, 210, 216), Color.FromArgb(82, 96, 106))
        };

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

        private static void DrawInfiniCloud(Graphics g, RectangleF rect)
        {
            using var pen = new Pen(Color.FromArgb(232, 128, 0), Math.Max(2.2f, rect.Width * .145f))
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
                Color.FromArgb(230, 190, 116), Color.FromArgb(174, 108, 58), 50f);
            using var edge = new Pen(Color.FromArgb(145, 91, 51), 1f);
            g.FillEllipse(body, bodyRect);
            g.DrawEllipse(edge, bodyRect);
            using var cap = new SolidBrush(Color.FromArgb(145, 91, 51));
            g.FillEllipse(cap, rect.Left + 4, rect.Top + 4, rect.Width - 8, 8);
            using var stem = new Pen(Color.FromArgb(112, 76, 48), 2f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLine(stem, rect.Right - 7, rect.Top + 5, rect.Right - 3, rect.Top + 1);
        }
    }

    private sealed class TransferStageSurfaceV0224 : Control
    {
        private static readonly string[] Stages = { "预核验", "拉取", "核验", "上传", "回读" };
        private readonly StageTrackV026 _source;

        public TransferStageSurfaceV0224(StageTrackV026 source)
        {
            _source = source;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.White;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Color.White);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var font = new Font("Microsoft YaHei UI", 8.2F);

            var pad = 24f;
            var lineY = 9f;
            var usable = Math.Max(1, Width - pad * 2);
            var step = usable / (Stages.Length - 1);
            var active = _source.ActiveIndex;

            using var baseLine = new Pen(Color.FromArgb(220, 226, 230), 1.5f);
            e.Graphics.DrawLine(baseLine, pad, lineY, Width - pad, lineY);

            for (var i = 0; i < Stages.Length; i++)
            {
                var x = pad + i * step;
                var completed = active >= 0 && i < active;
                var isActive = i == active;
                var nodeColor = isActive
                    ? Color.FromArgb(75, 135, 160)
                    : completed
                        ? Color.FromArgb(132, 172, 187)
                        : Color.FromArgb(198, 206, 212);
                var radius = isActive ? 4.3f : 3.3f;
                using var node = new SolidBrush(nodeColor);
                e.Graphics.FillEllipse(node, x - radius, lineY - radius, radius * 2, radius * 2);

                var labelRect = new Rectangle((int)(x - step / 2), 15, (int)step, Height - 16);
                if (i == 0) labelRect.X = 0;
                if (i == Stages.Length - 1) labelRect.X = Width - (int)step;
                var textColor = isActive
                    ? Color.FromArgb(58, 107, 130)
                    : completed
                        ? Color.FromArgb(107, 135, 147)
                        : Color.FromArgb(156, 166, 174);
                TextRenderer.DrawText(e.Graphics, Stages[i], font, labelRect, textColor,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
        }
    }

    private sealed class MeterSurfaceV0224 : Control
    {
        private readonly GradientMeterBar _source;
        private readonly RefinedMeterKindV0224 _kind;

        public MeterSurfaceV0224(GradientMeterBar source, RefinedMeterKindV0224 kind)
        {
            _source = source;
            _kind = kind;
            Font = new Font("Microsoft YaHei UI", kind == RefinedMeterKindV0224.Quota ? 8.1F : 8.3F);
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
            using var track = new SolidBrush(Color.FromArgb(243, 245, 247));
            e.Graphics.FillPath(track, path);

            var reserveWidth = _kind == RefinedMeterKindV0224.Quota
                ? (float)(rect.Width * _source.ReserveFraction)
                : 0f;

            if (reserveWidth > .5f)
            {
                using var reserve = new SolidBrush(Color.FromArgb(216, 222, 226));
                e.Graphics.SetClip(path);
                e.Graphics.FillRectangle(reserve, rect.Right - reserveWidth, rect.Top, reserveWidth, rect.Height);
                e.Graphics.ResetClip();

                using var marker = new Pen(Color.FromArgb(192, 200, 206), 1f);
                e.Graphics.DrawLine(marker, rect.Right - reserveWidth, rect.Top + 2, rect.Right - reserveWidth, rect.Bottom - 2);
            }

            var usableWidth = Math.Max(1f, rect.Width - reserveWidth);
            var (light, dark) = Colors();

            if (_source.Pulse)
                DrawPulse(e.Graphics, rect, path, usableWidth, light, dark);
            else
                DrawFill(e.Graphics, rect, path, usableWidth, light, dark);

            using var border = new Pen(Color.FromArgb(210, 217, 222), 1f);
            e.Graphics.DrawPath(border, path);

            if (!string.IsNullOrWhiteSpace(_source.BarText))
            {
                var ink = Color.FromArgb(65, 76, 84);
                TextRenderer.DrawText(e.Graphics, _source.BarText, Font, Rectangle.Round(rect), ink,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            }
        }

        private void DrawFill(Graphics g, RectangleF rect, GraphicsPath path, float usableWidth, Color light, Color dark)
        {
            var fillWidth = Math.Min(usableWidth, (float)(rect.Width * _source.Fraction));
            if (fillWidth <= .5f) return;
            var fillRect = new RectangleF(rect.Left, rect.Top, fillWidth, rect.Height);
            using var fill = new LinearGradientBrush(fillRect, light, dark, LinearGradientMode.Horizontal);
            g.SetClip(path);
            g.FillRectangle(fill, fillRect);
            g.ResetClip();
        }

        private void DrawPulse(Graphics g, RectangleF rect, GraphicsPath path, float usableWidth, Color light, Color dark)
        {
            var offset = PrivateField(_source, "_pulseOffset") is int p ? p : 0;
            var segment = Math.Max(44f, usableWidth * .24f);
            var x = rect.Left + (offset / 140f) * (usableWidth + segment) - segment;
            var pulseRect = RectangleF.Intersect(rect, new RectangleF(x, rect.Top, segment, rect.Height));
            if (pulseRect.Width <= 0) return;

            using var brush = new LinearGradientBrush(pulseRect, light, light, LinearGradientMode.Horizontal)
            {
                InterpolationColors = new ColorBlend
                {
                    Colors = new[]
                    {
                        Color.FromArgb(243, 245, 247),
                        light,
                        dark,
                        light,
                        Color.FromArgb(243, 245, 247)
                    },
                    Positions = new[] { 0f, .20f, .50f, .80f, 1f }
                }
            };
            g.SetClip(path);
            g.FillRectangle(brush, pulseRect);
            g.ResetClip();
        }

        private (Color Light, Color Dark) Colors()
        {
            if (_kind == RefinedMeterKindV0224.Overall)
                return (Color.FromArgb(230, 241, 247), Color.FromArgb(132, 181, 209));
            if (_kind == RefinedMeterKindV0224.Current)
                return (Color.FromArgb(230, 242, 244), Color.FromArgb(126, 180, 190));
            if (_source.Fraction >= .90)
                return (Color.FromArgb(247, 230, 227), Color.FromArgb(218, 143, 136));
            if (_source.Fraction >= .60)
                return (Color.FromArgb(247, 239, 219), Color.FromArgb(210, 179, 107));
            return (Color.FromArgb(228, 241, 234), Color.FromArgb(135, 186, 158));
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

    private enum RefinedMeterKindV0224
    {
        Overall,
        Current,
        Quota
    }
}
