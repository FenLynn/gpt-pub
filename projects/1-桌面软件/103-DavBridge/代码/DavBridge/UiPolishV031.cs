using System.Drawing.Drawing2D;
using System.Reflection;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// v0.3.1 presentation refinement for the v0.3 shell.
/// This layer changes layout, responsive behavior and painting only. It does not own migration,
/// reconciliation, quota, recycle or deletion decisions.
/// </summary>
internal sealed class UiPolishV031 : IDisposable
{
    private static readonly Color Ink = Color.FromArgb(37, 48, 56);
    private static readonly Color Muted = Color.FromArgb(103, 116, 126);
    private static readonly Color Line = Color.FromArgb(229, 234, 238);
    private static readonly Color Soft = Color.FromArgb(247, 250, 252);
    private static readonly Color BlueSoft = Color.FromArgb(234, 244, 250);
    private static readonly Color BlueInk = Color.FromArgb(49, 105, 142);

    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly ReconciliationRuntimeV030 _reconciliation;
    private readonly UiShellV030 _shell;

    private readonly TableLayoutPanel _root;
    private readonly Panel _surface;
    private readonly Panel _content;
    private readonly Panel _overviewPage;
    private readonly Panel _transferPage;
    private readonly Panel _recyclePage;
    private readonly Control _oldRoute;
    private readonly RoutePanelV031 _route;
    private readonly Label _title;
    private readonly Label _cycle;
    private readonly Button _settings;
    private readonly Button _tabOverview;
    private readonly Button _tabTransfer;
    private readonly Button _tabRecycle;
    private readonly Button _primary;
    private readonly DataGridView _recycleGrid;
    private readonly Button _recycleObserving;
    private readonly Button _recycleReview;
    private readonly Button _recycleHistory;
    private readonly Button _deferAll;
    private readonly Button _deleteSelected;

    private readonly TableLayoutPanel? _overviewRoot;
    private readonly TableLayoutPanel? _transferRoot;
    private readonly TableLayoutPanel? _recycleRoot;
    private bool _disposed;

    private UiPolishV031(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation, UiShellV030 shell)
    {
        _form = form;
        _host = host;
        _reconciliation = reconciliation;
        _shell = shell;

        _root = Field<TableLayoutPanel>("_root");
        _surface = Field<Panel>("_surface");
        _content = Field<Panel>("_content");
        _overviewPage = Field<Panel>("_overviewPage");
        _transferPage = Field<Panel>("_transferPage");
        _recyclePage = Field<Panel>("_recyclePage");
        _oldRoute = Field<Control>("_route");
        _title = Field<Label>("_title");
        _cycle = Field<Label>("_cycle");
        _settings = Field<Button>("_settings");
        _tabOverview = Field<Button>("_tabOverview");
        _tabTransfer = Field<Button>("_tabTransfer");
        _tabRecycle = Field<Button>("_tabRecycle");
        _primary = Field<Button>("_primary");
        _recycleGrid = Field<DataGridView>("_recycleGrid");
        _recycleObserving = Field<Button>("_recycleObserving");
        _recycleReview = Field<Button>("_recycleReview");
        _recycleHistory = Field<Button>("_recycleHistory");
        _deferAll = Field<Button>("_deferAll");
        _deleteSelected = Field<Button>("_deleteSelected");

        _overviewRoot = _overviewPage.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        _transferRoot = _transferPage.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        _recycleRoot = _recyclePage.Controls.OfType<TableLayoutPanel>().FirstOrDefault();

        _route = new RoutePanelV031
        {
            Dock = DockStyle.Fill,
            Margin = Padding.Empty,
            BackColor = Color.White,
            TabStop = false
        };

        ApplyStaticPolish();
        ReplaceRouteVisual();
        Wire();
        ApplyResponsiveLayout();
        SyncRoute();
        RestyleNavigation();
    }

    public static UiPolishV031 Attach(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation, UiShellV030 shell) =>
        new(form, host, reconciliation, shell);

    private T Field<T>(string name) where T : class
    {
        var value = typeof(UiShellV030).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_shell);
        return value as T ?? throw new InvalidOperationException($"v0.3.1 UI refinement could not resolve UiShellV030.{name}");
    }

    private void ApplyStaticPolish()
    {
        _form.MinimumSize = new Size(760, 560);
        _form.BackColor = Color.White;
        _surface.BackColor = Color.White;
        _root.BackColor = Color.White;
        _content.BackColor = Color.White;
        _content.AutoScroll = false;
        _content.AutoScrollMinSize = Size.Empty;

        if (_root.RowStyles.Count >= 3)
        {
            _root.RowStyles[0] = new RowStyle(SizeType.Absolute, 60);
            _root.RowStyles[1] = new RowStyle(SizeType.Absolute, 40);
            _root.RowStyles[2] = new RowStyle(SizeType.Percent, 100);
        }

        _title.Text = "Zotero 镜像维护";
        _title.Font = new Font("Segoe UI Semibold", 16F);
        _title.ForeColor = Ink;

        _cycle.Font = new Font("Segoe UI Semibold", 8.6F);
        _cycle.ForeColor = BlueInk;
        _cycle.BackColor = BlueSoft;
        _cycle.Padding = new Padding(9, 4, 9, 4);
        _cycle.Margin = new Padding(0, 2, 10, 0);

        _settings.Text = "⚙";
        _settings.Font = new Font("Segoe UI Symbol", 12.5F);
        _settings.Width = 34;
        _settings.Height = 30;
        _settings.BackColor = Color.White;
        _settings.ForeColor = Color.FromArgb(91, 105, 115);
        _settings.FlatAppearance.BorderSize = 0;
        _settings.FlatAppearance.MouseOverBackColor = Color.FromArgb(242, 247, 250);

        foreach (var page in new[] { _overviewPage, _transferPage, _recyclePage })
        {
            page.Dock = DockStyle.Fill;
            page.AutoSize = false;
            page.BackColor = Color.White;
        }

        ConfigureOverviewLayout();
        ConfigureTransferLayout();
        ConfigureRecycleLayout();

        StylePrimaryButton(_primary);
        StyleQuietButton(_deferAll);
        StyleDangerButton(_deleteSelected);

        _recycleGrid.BackgroundColor = Color.White;
        _recycleGrid.BorderStyle = BorderStyle.None;
        _recycleGrid.GridColor = Color.FromArgb(235, 239, 242);
        _recycleGrid.ColumnHeadersHeight = 34;
        _recycleGrid.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing;
        _recycleGrid.ColumnHeadersDefaultCellStyle.BackColor = Soft;
        _recycleGrid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(77, 91, 101);
        _recycleGrid.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI Semibold", 8.8F);
        _recycleGrid.DefaultCellStyle.BackColor = Color.White;
        _recycleGrid.DefaultCellStyle.ForeColor = Ink;
        _recycleGrid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(232, 243, 249);
        _recycleGrid.DefaultCellStyle.SelectionForeColor = Ink;
        _recycleGrid.RowTemplate.MinimumHeight = 34;
    }

    private void ConfigureOverviewLayout()
    {
        if (_overviewRoot is null) return;
        _overviewRoot.Dock = DockStyle.Fill;
        _overviewRoot.AutoSize = false;
        _overviewRoot.Padding = new Padding(26, 8, 26, 12);
        _overviewRoot.BackColor = Color.White;
        _overviewRoot.RowCount = Math.Max(7, _overviewRoot.Controls.Count);
        _overviewRoot.RowStyles.Clear();
        _overviewRoot.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _overviewRoot.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
        _overviewRoot.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
        _overviewRoot.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        _overviewRoot.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        _overviewRoot.RowStyles.Add(new RowStyle(SizeType.Absolute, 72));
        _overviewRoot.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var controls = _overviewRoot.Controls.Cast<Control>()
            .OrderBy(control => _overviewRoot.GetRow(control))
            .ThenBy(control => _overviewRoot.GetColumn(control))
            .ToArray();

        foreach (var control in controls)
        {
            var row = _overviewRoot.GetRow(control);
            control.Margin = row switch
            {
                0 => new Padding(0, 0, 0, 5),
                1 => Padding.Empty,
                2 => new Padding(0, 1, 0, 5),
                3 or 4 => new Padding(0, 2, 0, 0),
                5 => new Padding(0, 4, 0, 0),
                _ => Padding.Empty
            };
        }

        if (controls.Length > 0)
        {
            var bottom = controls.Last();
            bottom.Dock = DockStyle.Fill;
            bottom.AutoSize = false;
            _primary.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
            _primary.Margin = new Padding(0, 0, 0, 4);
        }
    }

    private void ConfigureTransferLayout()
    {
        if (_transferRoot is null) return;
        _transferRoot.Dock = DockStyle.Fill;
        _transferRoot.AutoSize = false;
        _transferRoot.Padding = new Padding(26, 18, 26, 18);
        _transferRoot.BackColor = Color.White;
        _transferRoot.RowCount = Math.Max(3, _transferRoot.Controls.Count);
        _transferRoot.RowStyles.Clear();
        _transferRoot.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _transferRoot.RowStyles.Add(new RowStyle(SizeType.Absolute, 142));
        _transferRoot.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        foreach (Control control in _transferRoot.Controls)
        {
            var row = _transferRoot.GetRow(control);
            control.Margin = row switch
            {
                0 => Padding.Empty,
                1 => new Padding(0, 14, 0, 14),
                _ => Padding.Empty
            };
            if (row == 2)
            {
                control.Dock = DockStyle.Top;
                control.Height = 118;
            }
        }
    }

    private void ConfigureRecycleLayout()
    {
        if (_recycleRoot is null) return;
        _recycleRoot.Padding = new Padding(26, 18, 26, 14);
        _recycleRoot.BackColor = Color.White;
        if (_recycleRoot.RowStyles.Count >= 5)
        {
            _recycleRoot.RowStyles[0] = new RowStyle(SizeType.AutoSize);
            _recycleRoot.RowStyles[1] = new RowStyle(SizeType.Absolute, 40);
            _recycleRoot.RowStyles[2] = new RowStyle(SizeType.AutoSize);
            _recycleRoot.RowStyles[3] = new RowStyle(SizeType.Percent, 100);
            _recycleRoot.RowStyles[4] = new RowStyle(SizeType.Absolute, 48);
        }
    }

    private void ReplaceRouteVisual()
    {
        if (_overviewRoot is null) return;
        var position = _overviewRoot.GetCellPosition(_oldRoute);
        _oldRoute.Visible = false;
        _overviewRoot.Controls.Add(_route, position.Column, position.Row);
        _route.BringToFront();
    }

    private void Wire()
    {
        _form.Resize += OnResize;
        _host.StateChanged += OnStateChanged;
        _host.ProgressChanged += OnProgressChanged;
        _reconciliation.Changed += OnReconciliationChanged;

        _tabOverview.Click += OnTabClick;
        _tabTransfer.Click += OnTabClick;
        _tabRecycle.Click += OnTabClick;
        _recycleObserving.Click += OnFilterClick;
        _recycleReview.Click += OnFilterClick;
        _recycleHistory.Click += OnFilterClick;
    }

    private void OnResize(object? sender, EventArgs e) => ApplyResponsiveLayout();
    private void OnStateChanged(object? sender, EventArgs e) => SafeUi(() => { SyncRoute(); RestyleNavigation(); });
    private void OnProgressChanged(object? sender, EngineProgress e) => SafeUi(SyncRoute);
    private void OnReconciliationChanged(object? sender, EventArgs e) => SafeUi(() => { SyncRoute(); RestyleNavigation(); });
    private void OnTabClick(object? sender, EventArgs e) => SafeUi(RestyleNavigation);
    private void OnFilterClick(object? sender, EventArgs e) => SafeUi(RestyleNavigation);

    private void ApplyResponsiveLayout()
    {
        if (_disposed || _form.IsDisposed) return;

        var compact = _form.ClientSize.Width < 760 || _form.ClientSize.Height < 560;
        _content.AutoScroll = compact;
        _content.AutoScrollMinSize = compact ? new Size(720, 455) : Size.Empty;

        if (_overviewRoot is not null)
            _overviewRoot.Padding = compact ? new Padding(18, 6, 18, 10) : new Padding(26, 8, 26, 12);
        if (_transferRoot is not null)
            _transferRoot.Padding = compact ? new Padding(18, 14, 18, 14) : new Padding(26, 18, 26, 18);
        if (_recycleRoot is not null)
            _recycleRoot.Padding = compact ? new Padding(18, 14, 18, 12) : new Padding(26, 18, 26, 14);

        if (_root.RowStyles.Count >= 3)
        {
            _root.RowStyles[0].Height = compact ? 56 : 60;
            _root.RowStyles[1].Height = compact ? 38 : 40;
        }

        _route.Compact = compact;
        _content.PerformLayout();
    }

    private void SyncRoute()
    {
        if (_disposed) return;
        var status = _host.State.EngineState switch
        {
            EngineState.WaitUser => "等待人工审查",
            EngineState.WaitQuota => "等待下一周期",
            EngineState.WaitNetwork => "等待网络",
            EngineState.WaitRetry => "需要处理",
            EngineState.Complete => "当前清单完成",
            EngineState.Running => _reconciliation.IsAuditing ? "源端对账中" : "普通迁移中",
            _ => _host.Config.MigrationEnabled ? "准备中" : "已暂停"
        };
        _route.SetStatus(status, StatusKind(_host.State.EngineState));
    }

    private void RestyleNavigation()
    {
        if (_disposed) return;
        StyleTab(_tabOverview);
        StyleTab(_tabTransfer);
        StyleTab(_tabRecycle);
        StyleFilter(_recycleObserving);
        StyleFilter(_recycleReview);
        StyleFilter(_recycleHistory);
    }

    private static void StyleTab(Button button)
    {
        var active = button.BackColor.R >= 225 && button.BackColor.B >= 240 && button.BackColor != Color.White;
        button.FlatAppearance.BorderSize = 0;
        button.Height = 32;
        button.Font = new Font("Segoe UI Semibold", 9.1F);
        button.BackColor = active ? BlueSoft : Color.White;
        button.ForeColor = active ? BlueInk : Color.FromArgb(82, 94, 103);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(242, 247, 250);
        button.Padding = Padding.Empty;
    }

    private static void StyleFilter(Button button)
    {
        var active = button.BackColor != Color.White && button.BackColor.B >= 240;
        button.FlatAppearance.BorderSize = 0;
        button.BackColor = active ? Color.FromArgb(237, 246, 250) : Color.White;
        button.ForeColor = active ? BlueInk : Color.FromArgb(88, 100, 109);
        button.Font = new Font("Segoe UI Semibold", 8.8F);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(244, 248, 250);
    }

    private static void StylePrimaryButton(Button button)
    {
        button.Width = 102;
        button.Height = 34;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderColor = Color.FromArgb(162, 193, 210);
        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(226, 240, 247);
        button.BackColor = Color.FromArgb(236, 246, 251);
        button.ForeColor = Color.FromArgb(43, 99, 136);
        button.Font = new Font("Segoe UI Semibold", 9.2F);
    }

    private static void StyleQuietButton(Button button)
    {
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderColor = Color.FromArgb(205, 214, 220);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(244, 248, 250);
        button.BackColor = Color.White;
        button.ForeColor = Color.FromArgb(68, 83, 93);
        button.Font = new Font("Segoe UI Semibold", 8.8F);
    }

    private static void StyleDangerButton(Button button)
    {
        StyleQuietButton(button);
        button.ForeColor = Color.FromArgb(163, 78, 73);
        button.FlatAppearance.BorderColor = Color.FromArgb(225, 190, 186);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(251, 241, 240);
    }

    private static UiRouteKindV031 StatusKind(EngineState state) => state switch
    {
        EngineState.Running => UiRouteKindV031.Running,
        EngineState.Complete => UiRouteKindV031.Complete,
        EngineState.WaitQuota => UiRouteKindV031.Quota,
        EngineState.WaitNetwork => UiRouteKindV031.Network,
        EngineState.WaitRetry => UiRouteKindV031.Error,
        EngineState.WaitUser => UiRouteKindV031.Review,
        _ => UiRouteKindV031.Idle
    };

    internal void ValidateLayout(string scenario)
    {
        _form.PerformLayout();
        _content.PerformLayout();

        if (_route.Width < 360 || _route.Height < 62)
            throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: polished route clipped");
        if (_route.LogosVisibleForSelfTest is false)
            throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: cloud logos not drawable");

        var requiresNoScroll = scenario.StartsWith("default", StringComparison.OrdinalIgnoreCase) ||
                               scenario.StartsWith("large", StringComparison.OrdinalIgnoreCase);
        if (requiresNoScroll && (_content.VerticalScroll.Visible || _content.HorizontalScroll.Visible))
            throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: default shell unexpectedly shows a scrollbar");

        if (_overviewPage.Visible)
        {
            var primaryBounds = ToContentBounds(_primary);
            if (primaryBounds.Bottom > _content.ClientSize.Height + 2 || primaryBounds.Right > _content.ClientSize.Width + 2)
                throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: bottom primary action is clipped");
        }
    }

    private Rectangle ToContentBounds(Control control)
    {
        var screen = control.RectangleToScreen(control.ClientRectangle);
        return _content.RectangleToClient(screen);
    }

    private void SafeUi(Action action)
    {
        if (_disposed || _form.IsDisposed) return;
        if (_form.InvokeRequired) _form.BeginInvoke(action); else action();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _form.Resize -= OnResize;
        _host.StateChanged -= OnStateChanged;
        _host.ProgressChanged -= OnProgressChanged;
        _reconciliation.Changed -= OnReconciliationChanged;
        _tabOverview.Click -= OnTabClick;
        _tabTransfer.Click -= OnTabClick;
        _tabRecycle.Click -= OnTabClick;
        _recycleObserving.Click -= OnFilterClick;
        _recycleReview.Click -= OnFilterClick;
        _recycleHistory.Click -= OnFilterClick;
        if (!_route.IsDisposed) _route.Dispose();
    }
}

internal enum UiRouteKindV031
{
    Idle,
    Running,
    Complete,
    Quota,
    Network,
    Error,
    Review
}

internal sealed class RoutePanelV031 : Control
{
    private string _status = "准备中";
    private UiRouteKindV031 _kind = UiRouteKindV031.Idle;

    public bool Compact { get; set; }
    public bool LogosVisibleForSelfTest => Width >= 120 && Height >= 48;

    public RoutePanelV031()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.White;
    }

    public void SetStatus(string status, UiRouteKindV031 kind)
    {
        if (_status == status && _kind == kind) return;
        _status = status;
        _kind = kind;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        using var nameFont = new Font("Segoe UI Semibold", Compact ? 8.8F : 9.2F);
        using var statusFont = new Font("Microsoft YaHei UI", Compact ? 8.1F : 8.6F, FontStyle.Bold);
        using var border = new Pen(Color.FromArgb(231, 236, 239), 1F);
        using var card = Rounded(new RectangleF(.5F, .5F, Math.Max(1, Width - 1F), Math.Max(1, Height - 1F)), 12F);
        using var back = new SolidBrush(Color.FromArgb(252, 253, 254));
        g.FillPath(back, card);
        g.DrawPath(border, card);

        var centerY = Height / 2F;
        var iconSize = Compact ? 21F : 24F;
        var sidePad = Compact ? 14F : 19F;
        var labelGap = 7F;
        var endpointWidth = Compact ? 116F : 138F;

        var leftIcon = new RectangleF(sidePad, centerY - iconSize / 2F, iconSize, iconSize);
        var rightIcon = new RectangleF(Width - sidePad - iconSize, centerY - iconSize / 2F, iconSize, iconSize);
        DrawInfiniCloud(g, leftIcon);
        DrawAcorn(g, rightIcon);

        var leftName = new Rectangle((int)(leftIcon.Right + labelGap), (int)centerY - 13,
            Math.Max(58, (int)(endpointWidth - iconSize - labelGap)), 26);
        var rightName = new Rectangle((int)(Width - sidePad - endpointWidth), (int)centerY - 13,
            Math.Max(58, (int)(endpointWidth - iconSize - labelGap)), 26);

        TextRenderer.DrawText(g, "InfiniCLOUD", nameFont, leftName, Color.FromArgb(48, 59, 66),
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        TextRenderer.DrawText(g, "坚果云", nameFont, rightName, Color.FromArgb(48, 59, 66),
            TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);

        var arrowLeft = endpointWidth + sidePad + 10F;
        var arrowRight = Width - endpointWidth - sidePad - 10F;
        if (arrowRight - arrowLeft < 132F)
        {
            var mid = Width / 2F;
            arrowLeft = mid - 66F;
            arrowRight = mid + 66F;
        }

        var colors = FlowColors(_kind);
        var span = arrowRight - arrowLeft;
        var firstRight = arrowLeft + span * .59F;
        var secondLeft = arrowLeft + span * .41F;
        var halfHeight = Compact ? 8F : 9F;
        var tip = Compact ? 16F : 18F;

        using (var firstPath = CreateChevronArrow(arrowLeft, firstRight, centerY, halfHeight, tip))
        using (var firstBrush = new LinearGradientBrush(new PointF(arrowLeft, centerY), new PointF(firstRight, centerY), colors.Light, colors.Middle))
            g.FillPath(firstBrush, firstPath);
        using (var secondPath = CreateChevronArrow(secondLeft, arrowRight, centerY, halfHeight, tip))
        using (var secondBrush = new LinearGradientBrush(new PointF(secondLeft, centerY), new PointF(arrowRight, centerY), colors.Middle, colors.Dark))
            g.FillPath(secondBrush, secondPath);

        var statusRect = new Rectangle((int)arrowLeft + 7, (int)centerY - 12, Math.Max(58, (int)span - 18), 24);
        TextRenderer.DrawText(g, _status, statusFont, statusRect, colors.Ink,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    }

    private static GraphicsPath CreateChevronArrow(float left, float right, float centerY, float halfHeight, float tip)
    {
        var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(left, centerY - halfHeight),
            new PointF(right - tip, centerY - halfHeight),
            new PointF(right, centerY),
            new PointF(right - tip, centerY + halfHeight),
            new PointF(left, centerY + halfHeight),
            new PointF(left + tip * .72F, centerY)
        });
        path.CloseFigure();
        return path;
    }

    private static RouteColorsV031 FlowColors(UiRouteKindV031 kind) => kind switch
    {
        UiRouteKindV031.Running => new(Color.FromArgb(229, 243, 237), Color.FromArgb(190, 221, 207), Color.FromArgb(148, 199, 178), Color.FromArgb(45, 94, 76)),
        UiRouteKindV031.Complete => new(Color.FromArgb(229, 243, 236), Color.FromArgb(194, 222, 208), Color.FromArgb(158, 202, 183), Color.FromArgb(50, 94, 77)),
        UiRouteKindV031.Quota => new(Color.FromArgb(248, 242, 227), Color.FromArgb(232, 216, 180), Color.FromArgb(214, 191, 140), Color.FromArgb(104, 82, 43)),
        UiRouteKindV031.Network => new(Color.FromArgb(245, 241, 234), Color.FromArgb(226, 217, 202), Color.FromArgb(205, 192, 170), Color.FromArgb(99, 85, 62)),
        UiRouteKindV031.Error => new(Color.FromArgb(248, 232, 230), Color.FromArgb(233, 201, 197), Color.FromArgb(218, 170, 165), Color.FromArgb(123, 67, 62)),
        UiRouteKindV031.Review => new(Color.FromArgb(250, 242, 225), Color.FromArgb(235, 216, 175), Color.FromArgb(216, 190, 135), Color.FromArgb(111, 82, 38)),
        _ => new(Color.FromArgb(238, 243, 246), Color.FromArgb(216, 226, 232), Color.FromArgb(192, 208, 218), Color.FromArgb(73, 92, 104))
    };

    private static void DrawInfiniCloud(Graphics g, RectangleF rect)
    {
        using var pen = new Pen(Color.FromArgb(239, 132, 0), Math.Max(2.2F, rect.Width * .145F))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };
        var top = rect.Top + rect.Height * .22F;
        var h = rect.Height * .56F;
        var w = rect.Width * .58F;
        g.DrawArc(pen, new RectangleF(rect.Left, top, w, h), 36, 288);
        g.DrawArc(pen, new RectangleF(rect.Right - w, top, w, h), 216, 288);
    }

    private static void DrawAcorn(Graphics g, RectangleF rect)
    {
        var bodyRect = new RectangleF(rect.Left + 5, rect.Top + 7, rect.Width - 10, rect.Height - 8);
        using var body = new LinearGradientBrush(bodyRect, Color.FromArgb(239, 198, 116), Color.FromArgb(174, 103, 50), 50F);
        using var edge = new Pen(Color.FromArgb(141, 83, 45), 1.1F);
        g.FillEllipse(body, bodyRect);
        g.DrawEllipse(edge, bodyRect);
        using var cap = new SolidBrush(Color.FromArgb(148, 89, 47));
        g.FillEllipse(cap, rect.Left + 4, rect.Top + 4, rect.Width - 8, 8);
        using var stem = new Pen(Color.FromArgb(112, 72, 42), 2.1F) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawLine(stem, rect.Right - 7, rect.Top + 5, rect.Right - 3, rect.Top + 1);
    }

    private static GraphicsPath Rounded(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var d = Math.Max(2F, radius * 2F);
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private readonly record struct RouteColorsV031(Color Light, Color Middle, Color Dark, Color Ink);
}
