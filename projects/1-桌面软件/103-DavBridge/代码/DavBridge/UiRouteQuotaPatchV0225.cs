using System.Drawing.Drawing2D;
using System.Reflection;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// v0.2.25 presentation patch.
/// 1. Restores a compact double-right-arrow route treatment requested during real-machine review.
/// 2. Keeps the dashboard's cached EngineProgress quota snapshot synchronized with the live state so
///    manual WaitQuota verification downloads appear in the cycle meter as soon as accounting commits.
/// Migration, reset-probe, WebDAV and persistence semantics are unchanged.
/// </summary>
internal sealed class UiRouteQuotaPatchV0225 : IDisposable
{
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 120 };
    private readonly RouteFlowV026? _flow;
    private readonly DoubleChevronRouteSurfaceV0225? _surface;
    private readonly FieldInfo? _lastProgressField;
    private bool _disposed;

    private UiRouteQuotaPatchV0225(UiDashboardV027 dashboard, AppHost host)
    {
        _dashboard = dashboard;
        _host = host;
        _lastProgressField = typeof(UiDashboardV027).GetField("_lastProgress", BindingFlags.Instance | BindingFlags.NonPublic);
        _flow = typeof(UiDashboardV027).GetField("_flow", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(dashboard) as RouteFlowV026;

        if (_flow is not null)
        {
            foreach (Control child in _flow.Controls.Cast<Control>().ToArray())
            {
                _flow.Controls.Remove(child);
                child.Dispose();
            }

            _surface = new DoubleChevronRouteSurfaceV0225(_flow)
            {
                Dock = DockStyle.Fill,
                Margin = Padding.Empty,
                TabStop = false
            };
            _flow.Controls.Add(_surface);
            _surface.BringToFront();
        }

        _timer.Tick += OnTick;
        SyncLiveQuotaSnapshot();
        _timer.Start();
    }

    public static UiRouteQuotaPatchV0225 Attach(UiDashboardV027 dashboard, AppHost host) => new(dashboard, host);

    private void OnTick(object? sender, EventArgs e)
    {
        if (_disposed) return;
        SyncLiveQuotaSnapshot();
        if (_surface is { IsDisposed: false }) _surface.Invalidate();
    }

    private void SyncLiveQuotaSnapshot()
    {
        if (_lastProgressField?.GetValue(_dashboard) is not EngineProgress progress) return;
        var live = QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        if (progress.Quota == live) return;
        _lastProgressField.SetValue(_dashboard, progress with { Quota = live });
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Tick -= OnTick;
        _timer.Dispose();
        if (_surface is not null && !_surface.IsDisposed)
        {
            _surface.Parent?.Controls.Remove(_surface);
            _surface.Dispose();
        }
    }

    private sealed class DoubleChevronRouteSurfaceV0225 : Control
    {
        private readonly RouteFlowV026 _source;

        public DoubleChevronRouteSurfaceV0225(RouteFlowV026 source)
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

            var left = Read<string>("_left") ?? "InfiniCLOUD";
            var right = Read<string>("_right") ?? "坚果云";
            var status = Read<string>("_status") ?? "已暂停";
            var recent = Read<string>("_recent") ?? string.Empty;
            var kind = Read<UiStatusKind>("_kind");

            using var nameFont = new Font("Segoe UI Semibold", 9.1F);
            using var statusFont = new Font("Microsoft YaHei UI", 8.7F, FontStyle.Bold);
            using var recentFont = new Font("Microsoft YaHei UI", 8.0F);

            const float centerY = 55f;
            const float iconSize = 24f;
            const float outerPad = 9f;
            const float endpointWidth = 136f;
            const float iconGap = 7f;

            var leftIcon = new RectangleF(outerPad, centerY - iconSize / 2f, iconSize, iconSize);
            var rightIcon = new RectangleF(Width - outerPad - iconSize, centerY - iconSize / 2f, iconSize, iconSize);
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

            var arrowLeft = endpointWidth + 18f;
            var arrowRight = Width - endpointWidth - 18f;
            if (arrowRight - arrowLeft < 138f)
            {
                var mid = Width / 2f;
                arrowLeft = mid - 69f;
                arrowRight = mid + 69f;
            }

            var span = arrowRight - arrowLeft;
            var firstRight = arrowLeft + span * .59f;
            var secondLeft = arrowLeft + span * .41f;
            const float halfHeight = 10f;
            const float tip = 19f;
            var colors = FlowColors(kind);

            using var firstPath = CreateChevronArrow(arrowLeft, firstRight, centerY, halfHeight, tip);
            using var firstBrush = new LinearGradientBrush(
                new PointF(arrowLeft, centerY), new PointF(firstRight, centerY), colors.Light, colors.Middle);
            e.Graphics.FillPath(firstBrush, firstPath);

            using var secondPath = CreateChevronArrow(secondLeft, arrowRight, centerY, halfHeight, tip);
            using var secondBrush = new LinearGradientBrush(
                new PointF(secondLeft, centerY), new PointF(arrowRight, centerY), colors.Middle, colors.Dark);
            e.Graphics.FillPath(secondBrush, secondPath);

            var statusRect = new Rectangle((int)arrowLeft + 9, (int)centerY - 12,
                Math.Max(62, (int)span - 25), 24);
            TextRenderer.DrawText(e.Graphics, status, statusFont, statusRect, colors.Ink,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);

            if (!string.IsNullOrWhiteSpace(recent))
            {
                var recentRect = new Rectangle((int)arrowLeft, 7, Math.Max(100, (int)span), 18);
                TextRenderer.DrawText(e.Graphics, recent, recentFont, recentRect, Color.FromArgb(128, 139, 147),
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
            }
        }

        private T? Read<T>(string fieldName)
        {
            try
            {
                var value = typeof(RouteFlowV026).GetField(fieldName, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_source);
                return value is T typed ? typed : default;
            }
            catch { return default; }
        }

        private static GraphicsPath CreateChevronArrow(float left, float right, float centerY, float halfHeight, float tip)
        {
            var path = new GraphicsPath();
            var top = centerY - halfHeight;
            var bottom = centerY + halfHeight;
            path.AddPolygon(new[]
            {
                new PointF(left, top),
                new PointF(right - tip, top),
                new PointF(right, centerY),
                new PointF(right - tip, bottom),
                new PointF(left, bottom),
                new PointF(left + tip * .72f, centerY)
            });
            path.CloseFigure();
            return path;
        }

        private static RouteColors FlowColors(UiStatusKind kind) => kind switch
        {
            UiStatusKind.Running => new(Color.FromArgb(229, 243, 237), Color.FromArgb(189, 221, 207), Color.FromArgb(147, 198, 178), Color.FromArgb(45, 94, 76)),
            UiStatusKind.Preparing => new(Color.FromArgb(231, 241, 247), Color.FromArgb(199, 220, 233), Color.FromArgb(166, 201, 222), Color.FromArgb(52, 92, 116)),
            UiStatusKind.Quota => new(Color.FromArgb(248, 242, 227), Color.FromArgb(232, 216, 180), Color.FromArgb(214, 191, 140), Color.FromArgb(104, 82, 43)),
            UiStatusKind.Network => new(Color.FromArgb(248, 237, 226), Color.FromArgb(232, 207, 181), Color.FromArgb(215, 177, 141), Color.FromArgb(112, 74, 40)),
            UiStatusKind.Error => new(Color.FromArgb(248, 232, 230), Color.FromArgb(233, 201, 197), Color.FromArgb(218, 170, 165), Color.FromArgb(123, 67, 62)),
            UiStatusKind.Complete => new(Color.FromArgb(229, 243, 236), Color.FromArgb(194, 222, 208), Color.FromArgb(158, 202, 183), Color.FromArgb(50, 94, 77)),
            _ => new(Color.FromArgb(241, 244, 246), Color.FromArgb(222, 228, 232), Color.FromArgb(202, 211, 218), Color.FromArgb(83, 96, 105))
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

        private readonly record struct RouteColors(Color Light, Color Middle, Color Dark, Color Ink);
    }
}
