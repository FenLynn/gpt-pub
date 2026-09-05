using System.Reflection;
using System.Text.RegularExpressions;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// v0.2.23 separates normal transfer activity from the optional WaitQuota replica verification UI.
/// The transfer dashboard keeps owning its original controls, while verification gets independent
/// stage, progress and primary-action surfaces. This prevents competing timers from repainting the
/// same controls with "等待下一周期" and verification progress in turn.
/// </summary>
internal sealed class UiActivityTabsV0223 : IDisposable
{
    private static readonly Regex ProbeProgress = new(@"(?<done>\d+)\s*/\s*(?<total>\d+)", RegexOptions.Compiled);

    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly WaitQuotaMaintenanceHostV0222 _maintenance;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 100 };

    private readonly FlowLayoutPanel _tabs = new()
    {
        AutoSize = true,
        FlowDirection = FlowDirection.LeftToRight,
        WrapContents = false,
        BackColor = Color.White,
        Margin = Padding.Empty,
        Padding = Padding.Empty
    };
    private readonly Button _transferTab = CreateTabButton("转移");
    private readonly Button _verificationTab = CreateTabButton("校核");
    private readonly VerificationStageTrackV0223 _verificationStage = new() { Dock = DockStyle.Top, Height = 30 };
    private readonly GradientMeterBar _verificationBar = new() { Dock = DockStyle.Top, Height = 28, Pulse = false };
    private readonly TransportActionButtonV027 _verificationSource = new() { Width = 112, Height = 38 };

    private readonly Label? _title;
    private readonly Label? _currentTitle;
    private readonly StageTrackV026? _transferStage;
    private readonly GradientMeterBar? _transferBar;
    private PrimaryActionSurfaceV0217? _transferSurface;
    private PrimaryActionSurfaceV0217? _verificationSurface;

    private DashboardActivityViewV0223 _view = DashboardActivityViewV0223.Transfer;
    private WebDavIoProgress? _io;
    private string? _lastVerificationRelative;
    private bool _disposed;

    private UiActivityTabsV0223(
        MainForm form,
        UiDashboardV027 dashboard,
        AppHost host,
        WaitQuotaMaintenanceHostV0222 maintenance)
    {
        _form = form;
        _dashboard = dashboard;
        _host = host;
        _maintenance = maintenance;

        _title = Field<Label>("_title");
        _currentTitle = Field<Label>("_currentTitle");
        _transferStage = Field<StageTrackV026>("_stageTrack");
        _transferBar = Field<GradientMeterBar>("_currentBar");

        InstallTabs();
        InstallVerificationCurrentSurface();
        InstallVerificationPrimarySurface();

        _transferTab.Click += OnTransferTabClick;
        _verificationTab.Click += OnVerificationTabClick;
        _verificationSource.Click += OnVerificationPrimaryClick;
        WebDavReadClient.GlobalIoProgress += OnIoProgress;
        _timer.Tick += (_, _) => Tick();

        SelectView(DashboardActivityViewV0223.Transfer);
        Tick();
        _timer.Start();
    }

    public static UiActivityTabsV0223 Attach(
        MainForm form,
        UiDashboardV027 dashboard,
        AppHost host,
        WaitQuotaMaintenanceHostV0222 maintenance) =>
        new(form, dashboard, host, maintenance);

    private T? Field<T>(string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_dashboard) as T; }
        catch { return null; }
    }

    private static Button CreateTabButton(string text)
    {
        var button = new Button
        {
            Text = text,
            Width = 62,
            Height = 28,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(92, 99, 106),
            Font = new Font("Microsoft YaHei UI", 9F),
            Cursor = Cursors.Hand,
            TabStop = false,
            Margin = new Padding(4, 0, 0, 0),
            Padding = Padding.Empty,
            TextAlign = ContentAlignment.MiddleCenter
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(244, 248, 251);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(234, 242, 248);
        return button;
    }

    private void InstallTabs()
    {
        if (_title?.Parent is not TableLayoutPanel parent) return;
        var position = parent.GetPositionFromControl(_title);
        _tabs.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _tabs.Controls.Add(_transferTab);
        _tabs.Controls.Add(_verificationTab);
        parent.Controls.Add(_tabs, position.Column, position.Row);
        _tabs.BringToFront();
    }

    private void InstallVerificationCurrentSurface()
    {
        if (_transferStage?.Parent is not TableLayoutPanel parent || _transferBar is null) return;
        var stagePosition = parent.GetPositionFromControl(_transferStage);
        var barPosition = parent.GetPositionFromControl(_transferBar);

        _verificationStage.Margin = _transferStage.Margin;
        _verificationBar.Margin = _transferBar.Margin;
        _verificationBar.StartColor = Color.FromArgb(188, 220, 244);
        _verificationBar.EndColor = Color.FromArgb(86, 159, 211);
        _verificationBar.Font = new Font("Microsoft YaHei UI", 8.5F);
        _verificationStage.Visible = false;
        _verificationBar.Visible = false;

        parent.Controls.Add(_verificationStage, stagePosition.Column, stagePosition.Row);
        parent.Controls.Add(_verificationBar, barPosition.Column, barPosition.Row);
    }

    private void InstallVerificationPrimarySurface()
    {
        _transferSurface = Descendants(_form).OfType<PrimaryActionSurfaceV0217>().FirstOrDefault();
        if (_transferSurface?.Parent is not TableLayoutPanel parent) return;
        var position = parent.GetPositionFromControl(_transferSurface);
        _verificationSurface = new PrimaryActionSurfaceV0217(_verificationSource)
        {
            Anchor = _transferSurface.Anchor,
            Margin = _transferSurface.Margin,
            Visible = false
        };
        parent.Controls.Add(_verificationSurface, position.Column, position.Row);
    }

    private void OnTransferTabClick(object? sender, EventArgs e) => SelectView(DashboardActivityViewV0223.Transfer);

    private void OnVerificationTabClick(object? sender, EventArgs e) => SelectView(DashboardActivityViewV0223.Verification);

    private void OnVerificationPrimaryClick(object? sender, EventArgs e)
    {
        if (_disposed) return;
        if (_maintenance.IsRunning)
        {
            _maintenance.StopManual();
        }
        else if (_maintenance.CanStart)
        {
            _io = null;
            _lastVerificationRelative = null;
            _maintenance.StartManual();
            SelectView(DashboardActivityViewV0223.Verification);
        }
        Tick();
    }

    private void SelectView(DashboardActivityViewV0223 view)
    {
        _view = view;
        var verification = view == DashboardActivityViewV0223.Verification;

        if (_currentTitle is not null)
            _currentTitle.Text = verification ? "当前校核" : "当前文件";
        if (_transferStage is not null) _transferStage.Visible = !verification;
        if (_transferBar is not null) _transferBar.Visible = !verification;
        _verificationStage.Visible = verification;
        _verificationBar.Visible = verification;
        if (_transferSurface is not null) _transferSurface.Visible = !verification;
        if (_verificationSurface is not null) _verificationSurface.Visible = verification;

        ApplyTabStyle(_transferTab, !verification);
        ApplyTabStyle(_verificationTab, verification);
        _verificationSurface?.SyncFromSource();
        _form.PerformLayout();
    }

    private static void ApplyTabStyle(Button button, bool selected)
    {
        button.BackColor = selected ? Color.FromArgb(232, 244, 252) : Color.White;
        button.ForeColor = selected ? Color.FromArgb(42, 104, 145) : Color.FromArgb(105, 111, 117);
        button.Font = new Font("Microsoft YaHei UI", 9F, selected ? FontStyle.Bold : FontStyle.Regular);
    }

    private void Tick()
    {
        if (_disposed || _form.IsDisposed) return;

        _verificationTab.Text = _maintenance.IsRunning ? "校核 ●" : "校核";
        UpdateVerificationPrimary();
        UpdateVerificationCurrent();
        _verificationSurface?.SyncFromSource();
    }

    private void UpdateVerificationPrimary()
    {
        if (_maintenance.IsRunning)
        {
            _verificationSource.Enabled = true;
            _verificationSource.SetAction(TransportActionKindV027.Pause, "停止校核");
            return;
        }

        if (_maintenance.CanStart)
        {
            _verificationSource.Enabled = true;
            _verificationSource.SetAction(TransportActionKindV027.Play, "开始校核");
            return;
        }

        _verificationSource.Enabled = false;
        if (_host.State.EngineState == EngineState.WaitQuota)
            _verificationSource.SetAction(TransportActionKindV027.None, "等待可校核");
        else
            _verificationSource.SetAction(TransportActionKindV027.None, "等待额度期");
    }

    private void UpdateVerificationCurrent()
    {
        var activity = WaitQuotaMaintenanceActivity.Current;
        if (_maintenance.IsRunning)
        {
            UpdateRunningVerification(activity);
            return;
        }

        _verificationStage.ActiveIndex = -1;
        _verificationBar.Pulse = false;
        _verificationBar.Fraction = 0;

        if (activity is not null && DateTimeOffset.Now - activity.UpdatedAt < TimeSpan.FromMinutes(30))
        {
            var message = activity.Progress.Message ?? string.Empty;
            _verificationBar.BarText = message.Contains("异常", StringComparison.Ordinal)
                ? "校核已安全停止"
                : message.Contains("停止", StringComparison.Ordinal)
                    ? "本轮校核已停止"
                    : "本轮校核已结束";
            return;
        }

        if (_host.State.EngineState != EngineState.WaitQuota)
        {
            _verificationBar.BarText = "等待进入额度等待期";
            return;
        }

        var quota = QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        _verificationBar.BarText = quota.SafeDownloadRemainingBytes > 0
            ? "可开始校核已有副本"
            : "下载安全额度不足，等待下一周期";
    }

    private void UpdateRunningVerification(WaitQuotaMaintenanceActivitySnapshot? activity)
    {
        if (activity is null)
        {
            _verificationStage.ActiveIndex = 0;
            _verificationBar.Pulse = false;
            _verificationBar.Fraction = 0;
            _verificationBar.BarText = "准备校核已有副本";
            return;
        }

        var progress = activity.Progress;
        var message = progress.Message ?? string.Empty;
        var relative = progress.RelativePath;

        if (string.IsNullOrWhiteSpace(relative))
        {
            _lastVerificationRelative = null;
            _verificationStage.ActiveIndex = 0;
            _verificationBar.Pulse = false;
            var match = ProbeProgress.Match(message);
            if (match.Success &&
                int.TryParse(match.Groups["done"].Value, out var done) &&
                int.TryParse(match.Groups["total"].Value, out var total) && total > 0)
            {
                _verificationBar.Fraction = Math.Clamp((double)done / total, 0, 1);
                _verificationBar.BarText = $"探测已有副本  {done} / {total}";
            }
            else
            {
                _verificationBar.Fraction = 0;
                _verificationBar.BarText = "扫描未验证附件";
            }
            return;
        }

        if (!string.Equals(_lastVerificationRelative, relative, StringComparison.OrdinalIgnoreCase))
        {
            _lastVerificationRelative = relative;
            _io = null;
        }

        _verificationStage.ActiveIndex = ResolveVerificationStage(message);
        var fileName = Path.GetFileName(relative);
        var io = _io;
        var ioMatches = io is not null && RelativeFileMatches(io.RelativePath, relative);
        var hasTotal = ioMatches && io!.TotalBytes.HasValue && io.TotalBytes.Value > 0;
        _verificationBar.Pulse = false;
        if (hasTotal)
        {
            var fraction = Math.Clamp((double)io!.BytesProcessed / io.TotalBytes!.Value, 0, 1);
            _verificationBar.Fraction = fraction;
            _verificationBar.BarText = $"{fileName}    {fraction:P0}";
        }
        else
        {
            _verificationBar.Fraction = 0;
            _verificationBar.BarText = fileName;
        }
    }

    private static int ResolveVerificationStage(string message)
    {
        if (message.Contains("SHA-256 完全一致", StringComparison.OrdinalIgnoreCase)) return 3;
        if (message.Contains("坚果云已有副本", StringComparison.Ordinal)) return 2;
        if (message.Contains("InfiniCLOUD", StringComparison.OrdinalIgnoreCase)) return 1;
        return 0;
    }

    private void OnIoProgress(object? sender, WebDavIoProgress progress)
    {
        if (!_maintenance.IsRunning || !MatchesConfiguredEndpoint(progress.BaseAddress)) return;
        _io = progress;
    }

    private bool MatchesConfiguredEndpoint(string baseAddress) =>
        SameEndpoint(baseAddress, _host.Config.SourceBaseUrl) || SameEndpoint(baseAddress, _host.Config.TargetBaseUrl);

    private static bool SameEndpoint(string left, string right)
    {
        if (!Uri.TryCreate(left, UriKind.Absolute, out var a) || !Uri.TryCreate(right, UriKind.Absolute, out var b)) return false;
        return string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) &&
               a.Port == b.Port &&
               a.AbsolutePath.Trim('/').Equals(b.AbsolutePath.Trim('/'), StringComparison.OrdinalIgnoreCase);
    }

    private static bool RelativeFileMatches(string ioPath, string progressPath)
    {
        var a = ioPath.Replace('\\', '/').Trim('/');
        var b = progressPath.Replace('\\', '/').Trim('/');
        return a.EndsWith("/" + b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(a, b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(Path.GetFileName(a), Path.GetFileName(b), StringComparison.OrdinalIgnoreCase);
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
        _timer.Stop();
        _timer.Dispose();
        _transferTab.Click -= OnTransferTabClick;
        _verificationTab.Click -= OnVerificationTabClick;
        _verificationSource.Click -= OnVerificationPrimaryClick;
        WebDavReadClient.GlobalIoProgress -= OnIoProgress;

        _tabs.Parent?.Controls.Remove(_tabs);
        _verificationStage.Parent?.Controls.Remove(_verificationStage);
        _verificationBar.Parent?.Controls.Remove(_verificationBar);
        _verificationSurface?.Parent?.Controls.Remove(_verificationSurface);
        _verificationSurface?.Dispose();
        _verificationSource.Dispose();
        _verificationStage.Dispose();
        _verificationBar.Dispose();
        _tabs.Dispose();
    }
}

internal enum DashboardActivityViewV0223
{
    Transfer,
    Verification
}

internal sealed class VerificationStageTrackV0223 : Control
{
    private static readonly string[] Stages = { "探测", "源读取", "目标读取", "SHA256" };
    private int _activeIndex = -1;

    public int ActiveIndex
    {
        get => _activeIndex;
        set
        {
            if (_activeIndex == value) return;
            _activeIndex = value;
            Invalidate();
        }
    }

    public VerificationStageTrackV0223()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.White;
        MinimumSize = new Size(300, 28);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var font = new Font("Microsoft YaHei UI", 8.8F, FontStyle.Bold);
        using var separator = new Pen(Color.FromArgb(218, 221, 225), 1f);
        var available = Math.Max(1, Width - 8);
        var slot = available / (float)Stages.Length;
        for (var i = 0; i < Stages.Length; i++)
        {
            var active = i == ActiveIndex;
            var rect = new Rectangle((int)(4 + i * slot), 2, Math.Max(48, (int)slot - 5), Height - 5);
            var color = active ? Color.FromArgb(65, 135, 184) : Color.FromArgb(155, 158, 163);
            TextRenderer.DrawText(e.Graphics, Stages[i], font, rect, color,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
            if (i > 0)
            {
                var x = (int)(4 + i * slot);
                e.Graphics.DrawLine(separator, x, 7, x, Height - 7);
            }
        }
    }
}
