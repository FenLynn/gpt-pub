using System.Drawing.Drawing2D;
using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.2.13 layout close-out. Owns the endpoint route rendering and tightens the
/// main action / settings footer placement without changing migration behavior.
/// </summary>
internal sealed class UiLayoutPolishV0213 : IDisposable
{
    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 180 };
    private EndpointRouteSurfaceV0213? _routeSurface;
    private bool _disposed;

    private UiLayoutPolishV0213(MainForm form, UiDashboardV027 dashboard)
    {
        _form = form;
        _dashboard = dashboard;
        ApplyDashboardLayout();
        PolishOpenForms();
        _timer.Tick += (_, _) => PolishOpenForms();
        _timer.Start();
    }

    public static UiLayoutPolishV0213 Attach(MainForm form, UiDashboardV027 dashboard) =>
        new(form, dashboard);

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

    private void ApplyDashboardLayout()
    {
        if (Field<RouteFlowV026>("_flow") is { } flow)
        {
            flow.Height = 110;
            foreach (var child in flow.Controls.Cast<Control>().ToArray())
            {
                if (!string.Equals(child.GetType().Name, "RouteSurface", StringComparison.Ordinal)) continue;
                flow.Controls.Remove(child);
                child.Dispose();
            }

            if (!flow.Controls.OfType<EndpointRouteSurfaceV0213>().Any())
            {
                _routeSurface = new EndpointRouteSurfaceV0213(flow)
                {
                    Dock = DockStyle.Fill,
                    Margin = Padding.Empty,
                    TabStop = false
                };
                flow.Controls.Add(_routeSurface);
                _routeSurface.BringToFront();
            }
        }

        if (Field<TransportActionButtonV027>("_primary") is { } primary)
        {
            primary.Width = 112;
            primary.Height = 40;
            primary.Margin = new Padding(0, 8, 0, 0);
            primary.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
            if (primary.Parent is TableLayoutPanel bottom)
            {
                bottom.Margin = new Padding(0, 24, 0, 4);
                bottom.Padding = new Padding(0, 4, 0, 0);
                bottom.MinimumSize = new Size(0, 52);
            }
        }

        if (Field<Button>("_settingsButton") is { } settings)
        {
            settings.Height = 40;
            settings.TextAlign = ContentAlignment.MiddleLeft;
            settings.Padding = new Padding(8, 0, 0, 0);
        }

        if (Field<Panel>("_taskCard") is { } taskCard)
            taskCard.Height = 60;

        foreach (var titleName in new[] { "_overallTitle", "_currentTitle", "_cycleTitle" })
        {
            if (Field<Label>(titleName) is not { Parent: TableLayoutPanel section }) continue;
            var top = titleName == "_overallTitle" ? 12 : 16;
            section.Margin = new Padding(0, top, 0, 0);
        }
    }

    private void PolishOpenForms()
    {
        if (_disposed) return;
        foreach (Form form in Application.OpenForms)
        {
            if (form.IsDisposed || !form.IsHandleCreated) continue;
            NormalizeButtons(form);
            if (form is SettingsDialog)
                PolishSettingsDialog(form);
        }
    }

    private static void NormalizeButtons(Control root)
    {
        foreach (var button in Enumerate(root).OfType<Button>())
        {
            button.TextAlign = button.TextAlign switch
            {
                ContentAlignment.TopLeft or ContentAlignment.MiddleLeft or ContentAlignment.BottomLeft => ContentAlignment.MiddleLeft,
                ContentAlignment.TopRight or ContentAlignment.MiddleRight or ContentAlignment.BottomRight => ContentAlignment.MiddleRight,
                _ => ContentAlignment.MiddleCenter
            };
            if (button.Padding.Top != 0 || button.Padding.Bottom != 0)
                button.Padding = new Padding(button.Padding.Left, 0, button.Padding.Right, 0);
        }
    }

    private static void PolishSettingsDialog(Form settings)
    {
        var shell = settings.Controls.OfType<TableLayoutPanel>()
            .FirstOrDefault(x => x.Dock == DockStyle.Fill && x.ColumnCount == 2 && x.RowCount == 2);
        if (shell is not null && shell.RowStyles.Count >= 2)
        {
            shell.RowStyles[1].SizeType = SizeType.Absolute;
            shell.RowStyles[1].Height = 76;
        }

        var save = Enumerate(settings).OfType<Button>().FirstOrDefault(x => x.Text == "保存");
        var cancel = Enumerate(settings).OfType<Button>().FirstOrDefault(x => x.Text == "取消");
        if (save?.Parent is FlowLayoutPanel footerButtons && footerButtons.Parent is Panel footer)
        {
            footer.Padding = new Padding(20, 6, 26, 20);
            footerButtons.Dock = DockStyle.Right;
            footerButtons.FlowDirection = FlowDirection.RightToLeft;
            foreach (var button in new[] { save, cancel }.Where(x => x is not null).Cast<Button>())
            {
                button.Width = 92;
                button.Height = 34;
                button.TextAlign = ContentAlignment.MiddleCenter;
                button.Padding = Padding.Empty;
                button.Margin = new Padding(8, 4, 0, 0);
            }
        }

        foreach (var row in Enumerate(settings).OfType<TableLayoutPanel>().Where(x => x.ColumnCount == 3))
        {
            row.Padding = new Padding(0, 9, 0, 9);
            foreach (var button in Enumerate(row).OfType<Button>())
            {
                button.Height = 32;
                button.TextAlign = ContentAlignment.MiddleCenter;
                button.Padding = Padding.Empty;
                button.Margin = new Padding(4, 5, 8, 5);
            }
            foreach (var label in row.Controls.OfType<Label>())
                label.TextAlign = label.TextAlign == ContentAlignment.TopCenter ? ContentAlignment.MiddleCenter : label.TextAlign;
        }
    }

    private static IEnumerable<Control> Enumerate(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Enumerate(child))
                yield return nested;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        if (_routeSurface is not null && !_routeSurface.IsDisposed)
            _routeSurface.Dispose();
    }

    private sealed class EndpointRouteSurfaceV0213 : Control
    {
        private readonly RouteFlowV026 _source;

        public EndpointRouteSurfaceV0213(RouteFlowV026 source)
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

            var left = ReadPrivate("_left") as string ?? "InfiniCLOUD";
            var right = ReadPrivate("_right") as string ?? "坚果云";
            var status = ReadPrivate("_status") as string ?? "已暂停";
            var recent = ReadPrivate("_recent") as string ?? string.Empty;
            var kind = ReadPrivate("_kind") is UiStatusKind value ? value : UiStatusKind.Paused;

            using var nameFont = new Font("Segoe UI Semibold", 9.6F);
            using var statusFont = new Font("Segoe UI Semibold", 9.2F);
            using var recentFont = new Font("Segoe UI", 8.3F);

            const float centerY = 65f;
            var iconSize = Math.Clamp(Width * .06f, 32f, 38f);
            const float outerPad = 8f;
            const float nameGap = 7f;

            var arrowWidth = Math.Clamp(Width * .36f, 175f, 230f);
            var mid = Width / 2f;
            var arrowLeft = mid - arrowWidth / 2f;
            var arrowRight = mid + arrowWidth / 2f;

            var leftIcon = new RectangleF(outerPad, centerY - iconSize / 2f, iconSize, iconSize);
            var rightIcon = new RectangleF(Width - outerPad - iconSize, centerY - iconSize / 2f, iconSize, iconSize);
            DrawInfiniCloud(e.Graphics, leftIcon);
            DrawAcorn(e.Graphics, rightIcon);

            var leftNameWidth = Math.Max(72, (int)(arrowLeft - leftIcon.Right - nameGap - 12));
            var leftName = new Rectangle((int)(leftIcon.Right + nameGap), (int)centerY - 13, leftNameWidth, 26);
            var rightNameLeft = (int)(arrowRight + 12);
            var rightNameWidth = Math.Max(62, (int)(rightIcon.Left - nameGap - rightNameLeft));
            var rightName = new Rectangle(rightNameLeft, (int)centerY - 13, rightNameWidth, 26);

            TextRenderer.DrawText(e.Graphics, left, nameFont, leftName, Color.FromArgb(43, 50, 56),
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            TextRenderer.DrawText(e.Graphics, right, nameFont, rightName, Color.FromArgb(43, 50, 56),
                TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);

            const float halfHeight = 14.5f;
            const float tipLength = 28f;
            using var arrowPath = CreateArrowPath(arrowLeft, arrowRight, centerY, halfHeight, tipLength);
            var (start, end) = FlowColors(kind);
            using var arrowBrush = new LinearGradientBrush(
                new PointF(arrowLeft, centerY), new PointF(arrowRight, centerY), start, end);
            e.Graphics.FillPath(arrowBrush, arrowPath);

            var bodyRight = arrowRight - tipLength;
            var statusRect = new Rectangle((int)arrowLeft + 12, (int)centerY - 13,
                Math.Max(52, (int)(bodyRight - arrowLeft - 16)), 26);
            TextRenderer.DrawText(e.Graphics, status, statusFont, statusRect, Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

            if (!string.IsNullOrWhiteSpace(recent))
            {
                var recentRect = new Rectangle((int)arrowLeft - 4, 13, (int)arrowWidth + 8, 20);
                TextRenderer.DrawText(e.Graphics, recent, recentFont, recentRect, Color.FromArgb(126, 136, 145),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            }
        }

        private object? ReadPrivate(string name)
        {
            try
            {
                return _source.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_source);
            }
            catch { return null; }
        }

        private static GraphicsPath CreateArrowPath(float left, float right, float centerY, float halfHeight, float tipLength)
        {
            var top = centerY - halfHeight;
            var bottom = centerY + halfHeight;
            var bodyRight = right - tipLength;
            var radius = Math.Min(10f, halfHeight * .75f);
            var path = new GraphicsPath();
            path.StartFigure();
            path.AddLine(left + radius, top, bodyRight, top);
            path.AddLine(bodyRight, top, right, centerY);
            path.AddLine(right, centerY, bodyRight, bottom);
            path.AddLine(bodyRight, bottom, left + radius, bottom);
            path.AddBezier(left + radius, bottom, left + radius * .28f, bottom, left, centerY + radius * .6f, left, centerY);
            path.AddBezier(left, centerY, left, centerY - radius * .6f, left + radius * .28f, top, left + radius, top);
            path.CloseFigure();
            return path;
        }

        private static (Color Start, Color End) FlowColors(UiStatusKind kind) => kind switch
        {
            UiStatusKind.Running => (Color.FromArgb(142, 218, 176), Color.FromArgb(28, 144, 87)),
            UiStatusKind.Preparing => (Color.FromArgb(189, 224, 247), Color.FromArgb(72, 137, 191)),
            UiStatusKind.Quota => (Color.FromArgb(255, 238, 178), Color.FromArgb(194, 141, 35)),
            UiStatusKind.Network => (Color.FromArgb(252, 215, 170), Color.FromArgb(203, 119, 36)),
            UiStatusKind.Error => (Color.FromArgb(251, 198, 198), Color.FromArgb(187, 65, 65)),
            UiStatusKind.Complete => (Color.FromArgb(151, 214, 188), Color.FromArgb(37, 128, 96)),
            _ => (Color.FromArgb(220, 227, 233), Color.FromArgb(129, 143, 155))
        };

        private static void DrawInfiniCloud(Graphics g, RectangleF rect)
        {
            using var pen = new Pen(Color.FromArgb(238, 130, 0), Math.Max(3f, rect.Width * .14f))
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round
            };
            var top = rect.Top + rect.Height * .22f;
            var h = rect.Height * .56f;
            var w = rect.Width * .59f;
            g.DrawArc(pen, new RectangleF(rect.Left, top, w, h), 36, 288);
            g.DrawArc(pen, new RectangleF(rect.Right - w, top, w, h), 216, 288);
        }

        private static void DrawAcorn(Graphics g, RectangleF rect)
        {
            var bodyRect = new RectangleF(rect.Left + rect.Width * .18f, rect.Top + rect.Height * .27f,
                rect.Width * .64f, rect.Height * .65f);
            using var body = new LinearGradientBrush(bodyRect,
                Color.FromArgb(242, 200, 118), Color.FromArgb(171, 101, 48), 50f);
            using var edge = new Pen(Color.FromArgb(139, 81, 43), 1.25f);
            g.FillEllipse(body, bodyRect);
            g.DrawEllipse(edge, bodyRect);
            using var cap = new SolidBrush(Color.FromArgb(146, 87, 45));
            g.FillEllipse(cap, rect.Left + rect.Width * .13f, rect.Top + rect.Height * .15f, rect.Width * .74f, rect.Height * .24f);
            using var stem = new Pen(Color.FromArgb(107, 69, 39), 2.3f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
            g.DrawLine(stem, rect.Right - rect.Width * .25f, rect.Top + rect.Height * .18f,
                rect.Right - rect.Width * .11f, rect.Top + rect.Height * .03f);
        }
    }
}
