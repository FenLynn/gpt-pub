using System.Drawing.Drawing2D;
using System.Reflection;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// Dashboard interaction owner. Keeps calibration on the main page, normalizes
/// WinForms controls, and carries the v0.2.14 startup / current-phase close-out.
/// </summary>
internal sealed class UiInteractionPolishV0211 : IDisposable
{
    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly UiLayoutPolishV0213 _layoutPolish;
    private readonly UiStartupBehaviorV0214 _startupBehavior;
    private readonly UiCurrentPulsePolishV0214 _currentPulse;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 120 };
    private readonly HashSet<IntPtr> _normalizedForms = new();
    private ChannelOverlay? _channelOverlay;
    private RouteFlowV026? _flow;
    private string? _sourceReadyPath;
    private DateTimeOffset _sourceReadySince;
    private bool _disposed;

    private UiInteractionPolishV0211(MainForm form, UiDashboardV027 dashboard, AppHost host)
    {
        _form = form;
        _dashboard = dashboard;
        _host = host;
        InstallCalibrationEntry();
        NormalizeButtons(form);
        _layoutPolish = UiLayoutPolishV0213.Attach(form, dashboard);
        _startupBehavior = UiStartupBehaviorV0214.Attach(form, dashboard);
        _currentPulse = UiCurrentPulsePolishV0214.Attach(dashboard);
        InstallChannelOverlay();
        _timer.Tick += (_, _) =>
        {
            PolishCurrentPhase();
            PolishOpenForms();
            if (_channelOverlay is { IsDisposed: false }) _channelOverlay.Invalidate();
        };
        _timer.Start();
    }

    public static UiInteractionPolishV0211 Attach(MainForm form, UiDashboardV027 dashboard, AppHost host) =>
        new(form, dashboard, host);

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

    private void InstallChannelOverlay()
    {
        if (Field<RouteFlowV026>("_flow") is not { } flow) return;
        _flow = flow;
        _channelOverlay = new ChannelOverlay(flow) { Size = new Size(224, 74), TabStop = false };
        flow.Controls.Add(_channelOverlay);
        PositionChannelOverlay();
        _channelOverlay.BringToFront();
        flow.Resize += OnFlowResize;
    }

    private void OnFlowResize(object? sender, EventArgs e) => PositionChannelOverlay();

    private void PositionChannelOverlay()
    {
        if (_flow is null || _channelOverlay is null) return;
        _channelOverlay.Location = new Point(Math.Max(0, (_flow.ClientSize.Width - _channelOverlay.Width) / 2), 4);
    }

    private void InstallCalibrationEntry()
    {
        if (Field<Label>("_cycleTitle") is not { } title || title.Parent is not TableLayoutPanel section)
            return;
        if (section.Controls.Find("V0211CalibrationHost", true).Length > 0)
            return;

        var position = section.GetPositionFromControl(title);
        section.Controls.Remove(title);
        var host = new TableLayoutPanel
        {
            Name = "V0211CalibrationHost",
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 2,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
            BackColor = Color.White
        };
        host.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        host.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        title.Margin = new Padding(0, 0, 0, 5);
        title.Anchor = AnchorStyles.Left;
        host.Controls.Add(title, 0, 0);

        var calibrate = new Button
        {
            Name = "V0211CalibrateButton",
            Text = "校准",
            Width = 66,
            Height = 27,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(58, 91, 116),
            TextAlign = ContentAlignment.MiddleCenter,
            Padding = Padding.Empty,
            Margin = Padding.Empty,
            TabStop = false,
            Cursor = Cursors.Hand,
            UseVisualStyleBackColor = false
        };
        calibrate.FlatAppearance.BorderColor = Color.FromArgb(205, 216, 224);
        calibrate.FlatAppearance.MouseOverBackColor = Color.FromArgb(243, 248, 252);
        calibrate.FlatAppearance.MouseDownBackColor = Color.FromArgb(233, 243, 250);
        calibrate.Click += async (_, _) => await CalibrateFromDashboardAsync();
        host.Controls.Add(calibrate, 0, 1);
        section.Controls.Add(host, position.Column, position.Row);
        if (section.RowCount > position.Row + 1) section.SetRowSpan(host, 2);
    }

    private async Task CalibrateFromDashboardAsync()
    {
        if (_disposed || _form.IsDisposed) return;
        if (_host.Config.MigrationEnabled || _host.IsRunning)
        {
            var confirm = MessageBox.Show(_form,
                "校准流量需要先安全暂停当前迁移。\r\n\r\n是否现在暂停并打开流量校准？",
                "校准流量", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;
            var pauseTask = UiCommandBridge.InvokeTask(_form, "PauseAsync");
            if (pauseTask is not null) await pauseTask.ConfigureAwait(true);
            var started = DateTime.UtcNow;
            while (_host.IsRunning && DateTime.UtcNow - started < TimeSpan.FromSeconds(10))
                await Task.Delay(80).ConfigureAwait(true);
            if (_host.IsRunning)
            {
                MessageBox.Show(_form, "任务仍在完成安全暂停，请稍后再校准。", "校准流量",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
        }
        var calibrateTask = UiCommandBridge.InvokeTask(_form, "CalibrateAsync");
        if (calibrateTask is not null) await calibrateTask.ConfigureAwait(true);
    }

    private void PolishCurrentPhase()
    {
        if (_disposed) return;
        var stage = Field<StageTrackV026>("_stageTrack");
        var bar = Field<GradientMeterBar>("_currentBar");
        if (stage is null || bar is null) return;

        var progress = typeof(UiDashboardV027)
            .GetField("_lastProgress", BindingFlags.Instance | BindingFlags.NonPublic)?
            .GetValue(_dashboard) as EngineProgress;
        var record = ResolveRecord(progress?.RelativePath);
        if (record is null)
        {
            _sourceReadyPath = null;
            return;
        }

        switch (record.Status)
        {
            case TransferStatus.DownloadingSource:
                stage.ActiveIndex = 1;
                _sourceReadyPath = null;
                break;
            case TransferStatus.SourceReady:
                stage.ActiveIndex = 2;
                bar.Fraction = 0;
                bar.Pulse = true;
                if (!string.Equals(_sourceReadyPath, record.RelativePath, StringComparison.OrdinalIgnoreCase))
                {
                    _sourceReadyPath = record.RelativePath;
                    _sourceReadySince = DateTimeOffset.Now;
                }
                var waiting = DateTimeOffset.Now - _sourceReadySince > TimeSpan.FromSeconds(8);
                bar.BarText = $"{Path.GetFileName(record.RelativePath)}    {(waiting ? "等待坚果云响应" : "检查目标状态")}";
                break;
            case TransferStatus.Uploading:
                stage.ActiveIndex = 3;
                _sourceReadyPath = null;
                break;
            case TransferStatus.RemotePresent:
            case TransferStatus.Verifying:
            case TransferStatus.WriteUnknown:
                stage.ActiveIndex = 4;
                _sourceReadyPath = null;
                break;
            default:
                _sourceReadyPath = null;
                break;
        }
    }

    private TransferRecord? ResolveRecord(string? relativePath)
    {
        if (!string.IsNullOrWhiteSpace(relativePath) && _host.State.Files.TryGetValue(relativePath, out var direct))
            return direct;
        if (string.IsNullOrWhiteSpace(_host.State.CurrentGroupKey)) return null;
        return _host.State.Files.Values
            .Where(x => string.Equals(x.GroupKey, _host.State.CurrentGroupKey, StringComparison.OrdinalIgnoreCase) &&
                        x.Status != TransferStatus.StrongVerified)
            .OrderByDescending(x => x.AttemptCount)
            .FirstOrDefault();
    }

    private void PolishOpenForms()
    {
        if (_disposed) return;
        foreach (Form form in Application.OpenForms)
        {
            if (form.IsDisposed || !form.IsHandleCreated) continue;
            NormalizeButtons(form);
            if (form is SettingsDialog) PolishSettings(form);
            _normalizedForms.Add(form.Handle);
        }
    }

    private static void NormalizeButtons(Control root)
    {
        foreach (Control control in Enumerate(root))
        {
            if (control is not Button button) continue;
            button.TextAlign = ToMiddle(button.TextAlign);
            if (button.Padding.Top != 0 || button.Padding.Bottom != 0)
                button.Padding = new Padding(button.Padding.Left, 0, button.Padding.Right, 0);
        }
    }

    private static ContentAlignment ToMiddle(ContentAlignment alignment) => alignment switch
    {
        ContentAlignment.TopLeft or ContentAlignment.MiddleLeft or ContentAlignment.BottomLeft => ContentAlignment.MiddleLeft,
        ContentAlignment.TopRight or ContentAlignment.MiddleRight or ContentAlignment.BottomRight => ContentAlignment.MiddleRight,
        _ => ContentAlignment.MiddleCenter
    };

    private static IEnumerable<Control> Enumerate(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Enumerate(child)) yield return nested;
        }
    }

    private static void PolishSettings(Form settings)
    {
        foreach (var label in Enumerate(settings).OfType<Label>())
            if (label.Text.Contains("人工校准入口位于“安全与维护”", StringComparison.Ordinal))
                label.Text = "当前周期已用量与重置日期由主页显示；人工校准入口位于主页“当前周期”。";

        foreach (var check in Enumerate(settings).OfType<CheckBox>())
            if (check.Text.Contains("启动后默认进入托盘", StringComparison.Ordinal))
                check.Visible = false;

        foreach (var row in Enumerate(settings).OfType<TableLayoutPanel>())
        {
            if (row.ColumnCount != 3) continue;
            var isCalibrationRow = Enumerate(row).OfType<Label>()
                .Any(label => string.Equals(label.Text, "校准流量", StringComparison.Ordinal));
            if (isCalibrationRow) row.Visible = false;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        if (_flow is not null) _flow.Resize -= OnFlowResize;
        if (_channelOverlay is { IsDisposed: false }) _channelOverlay.Dispose();
        _currentPulse.Dispose();
        _startupBehavior.Dispose();
        _layoutPolish.Dispose();
        _normalizedForms.Clear();
    }

    private sealed class ChannelOverlay : Control
    {
        private readonly RouteFlowV026 _source;
        public ChannelOverlay(RouteFlowV026 source)
        {
            _source = source;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            BackColor = Color.White;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Color.White);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var status = Read("_status") as string ?? "已暂停";
            var recent = Read("_recent") as string ?? string.Empty;
            var kind = Read("_kind") is UiStatusKind value ? value : UiStatusKind.Paused;
            using var recentFont = new Font("Segoe UI", 8.2F);
            using var statusFont = new Font("Segoe UI Semibold", 9.2F);
            if (!string.IsNullOrWhiteSpace(recent))
                TextRenderer.DrawText(e.Graphics, recent, recentFont, new Rectangle(0, 0, Width, 20),
                    Color.FromArgb(126, 136, 145), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

            var rect = new RectangleF(12, 32, Width - 24, 30);
            using var path = Rounded(rect, 15f);
            var (start, end) = Colors(kind);
            using var brush = new LinearGradientBrush(rect.Location, new PointF(rect.Right, rect.Top), start, end);
            e.Graphics.FillPath(brush, path);
            var x = rect.Right - 19;
            using var chevron = new Pen(Color.FromArgb(235, 255, 255, 255), 2.2F)
            { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            e.Graphics.DrawLines(chevron, new[]
            {
                new PointF(x - 4, 42), new PointF(x + 2, 47), new PointF(x - 4, 52)
            });
            TextRenderer.DrawText(e.Graphics, status, statusFont, new Rectangle(22, 32, Width - 72, 30), Color.White,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }

        private object? Read(string name)
        {
            try { return _source.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_source); }
            catch { return null; }
        }

        private static (Color Start, Color End) Colors(UiStatusKind kind) => kind switch
        {
            UiStatusKind.Running => (Color.FromArgb(150, 221, 181), Color.FromArgb(29, 143, 88)),
            UiStatusKind.Preparing => (Color.FromArgb(193, 226, 248), Color.FromArgb(75, 138, 191)),
            UiStatusKind.Quota => (Color.FromArgb(255, 239, 183), Color.FromArgb(193, 140, 36)),
            UiStatusKind.Network => (Color.FromArgb(252, 218, 178), Color.FromArgb(201, 119, 38)),
            UiStatusKind.Error => (Color.FromArgb(251, 201, 201), Color.FromArgb(186, 66, 66)),
            UiStatusKind.Complete => (Color.FromArgb(155, 215, 190), Color.FromArgb(38, 128, 97)),
            _ => (Color.FromArgb(224, 230, 235), Color.FromArgb(137, 150, 161))
        };

        private static GraphicsPath Rounded(RectangleF rect, float radius)
        {
            var path = new GraphicsPath();
            var d = radius * 2;
            path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
