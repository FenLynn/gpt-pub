using System.Drawing.Drawing2D;
using System.Reflection;
using System.Text.RegularExpressions;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// v0.2.24 activity switcher. Transfer and WaitQuota replica verification own separate
/// progress surfaces and controls so neither path can repaint the other's current state.
/// </summary>
internal sealed class UiActivityTabsV0224 : IDisposable
{
    private static readonly Regex ProbeProgress = new(@"(?<done>\d+)\s*/\s*(?<total>\d+)", RegexOptions.Compiled);
    private static readonly Regex AdoptedSummary = new(
        @"探测\s*(?<done>\d+)\s*/\s*(?<total>\d+).*?找到\s*(?<existing>\d+).*?接管\s*(?<adopted>\d+)\s*组.*?下载\s*(?<download>[^，。]+)",
        RegexOptions.Compiled);
    private static readonly Regex ExistingSummary = new(
        @"探测\s*(?<done>\d+)\s*/\s*(?<total>\d+).*?找到\s*(?<existing>\d+)",
        RegexOptions.Compiled);
    private static readonly Regex EmptySummary = new(
        @"探测\s*(?<done>\d+)\s*/\s*(?<total>\d+)",
        RegexOptions.Compiled);

    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly WaitQuotaMaintenanceHostV0222 _maintenance;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 120 };
    private readonly ToolTip _tips = new();

    private readonly ActivityTabStripV0224 _tabs = new() { Width = 134, Height = 30 };
    private readonly VerificationStageTrackV0224 _verificationStage = new() { Dock = DockStyle.Top, Height = 34 };
    private readonly VerificationProgressBarV0224 _verificationBar = new() { Dock = DockStyle.Top, Height = 28 };
    private readonly TransportActionButtonV027 _verificationSource = new() { Width = 118, Height = 38 };

    private readonly Label? _title;
    private readonly Label? _currentTitle;
    private readonly StageTrackV026? _transferStage;
    private readonly GradientMeterBar? _transferBar;
    private PrimaryActionSurfaceV0217? _transferSurface;
    private PrimaryActionSurfaceV0217? _verificationSurface;

    private DashboardActivityViewV0224 _view = DashboardActivityViewV0224.Transfer;
    private WebDavIoProgress? _io;
    private string? _lastVerificationRelative;
    private bool _disposed;

    private UiActivityTabsV0224(
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

        _tabs.SelectedIndexChanged += OnSelectedTabChanged;
        _verificationSource.Click += OnVerificationPrimaryClick;
        WebDavReadClient.GlobalIoProgress += OnIoProgress;
        _timer.Tick += (_, _) => Tick();

        _tips.SetToolTip(_tabs, "转移：正常附件迁移；校核：额度等待期只读检查坚果云已有副本，上传始终为 0 B。");

        SelectView(DashboardActivityViewV0224.Transfer);
        Tick();
        _timer.Start();
    }

    public static UiActivityTabsV0224 Attach(
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

    private void InstallTabs()
    {
        if (_title?.Parent is not TableLayoutPanel parent) return;
        var position = parent.GetPositionFromControl(_title);
        _tabs.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        _tabs.Margin = new Padding(0, 1, 0, 0);
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

    private void OnSelectedTabChanged(object? sender, EventArgs e) =>
        SelectView(_tabs.SelectedIndex == 1 ? DashboardActivityViewV0224.Verification : DashboardActivityViewV0224.Transfer);

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
            _tabs.SelectedIndex = 1;
            SelectView(DashboardActivityViewV0224.Verification);
        }
        Tick();
    }

    private void SelectView(DashboardActivityViewV0224 view)
    {
        _view = view;
        var verification = view == DashboardActivityViewV0224.Verification;

        if (_tabs.SelectedIndex != (verification ? 1 : 0))
            _tabs.SelectedIndex = verification ? 1 : 0;

        if (_currentTitle is not null)
            _currentTitle.Text = verification ? "当前校核" : "当前文件";
        if (_transferStage is not null) _transferStage.Visible = !verification;
        if (_transferBar is not null) _transferBar.Visible = !verification;
        _verificationStage.Visible = verification;
        _verificationBar.Visible = verification;
        if (_transferSurface is not null) _transferSurface.Visible = !verification;
        if (_verificationSurface is not null) _verificationSurface.Visible = verification;

        _verificationSurface?.SyncFromSource();
        _form.PerformLayout();
    }

    private void Tick()
    {
        if (_disposed || _form.IsDisposed) return;

        _tabs.VerificationRunning = _maintenance.IsRunning;
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
        _verificationStage.CompletedThrough = -1;
        _verificationBar.Fraction = 0;
        _verificationBar.Kind = VerificationProgressKindV0224.Idle;

        if (activity is not null)
        {
            var message = activity.Progress.Message ?? string.Empty;
            _verificationBar.Kind = message.Contains("异常", StringComparison.Ordinal)
                ? VerificationProgressKindV0224.Warning
                : VerificationProgressKindV0224.Complete;
            _verificationBar.Text = CompactSummary(message);
            return;
        }

        if (_host.State.EngineState != EngineState.WaitQuota)
        {
            _verificationBar.Text = "只读校核将在上传额度等待期开放";
            return;
        }

        var quota = QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        _verificationBar.Text = quota.SafeDownloadRemainingBytes > 0
            ? "可开始只读校核 · PUT 0 B"
            : "下载安全额度不足，等待下一周期";
    }

    private void UpdateRunningVerification(WaitQuotaMaintenanceActivitySnapshot? activity)
    {
        _verificationBar.Kind = VerificationProgressKindV0224.Active;
        if (activity is null)
        {
            _verificationStage.ActiveIndex = 0;
            _verificationStage.CompletedThrough = -1;
            _verificationBar.Fraction = 0;
            _verificationBar.Text = "准备校核已有副本";
            return;
        }

        var progress = activity.Progress;
        var message = progress.Message ?? string.Empty;
        var relative = progress.RelativePath;

        if (string.IsNullOrWhiteSpace(relative))
        {
            _lastVerificationRelative = null;
            _verificationStage.ActiveIndex = 0;
            _verificationStage.CompletedThrough = -1;
            var match = ProbeProgress.Match(message);
            if (match.Success &&
                int.TryParse(match.Groups["done"].Value, out var done) &&
                int.TryParse(match.Groups["total"].Value, out var total) && total > 0)
            {
                var fraction = Math.Clamp((double)done / total, 0, 1);
                _verificationBar.Fraction = fraction;
                _verificationBar.Text = $"探测已有副本  {done} / {total} · {fraction:P1}";
            }
            else
            {
                _verificationBar.Fraction = 0;
                _verificationBar.Text = "扫描未验证附件";
            }
            return;
        }

        if (!string.Equals(_lastVerificationRelative, relative, StringComparison.OrdinalIgnoreCase))
        {
            _lastVerificationRelative = relative;
            _io = null;
        }

        var stage = ResolveVerificationStage(message);
        _verificationStage.ActiveIndex = stage;
        _verificationStage.CompletedThrough = Math.Max(-1, stage - 1);

        var fileName = Path.GetFileName(relative);
        var io = _io;
        var ioMatches = io is not null && RelativeFileMatches(io.RelativePath, relative);
        var hasTotal = ioMatches && io!.TotalBytes.HasValue && io.TotalBytes.Value > 0;
        if (hasTotal)
        {
            var fraction = Math.Clamp((double)io!.BytesProcessed / io.TotalBytes!.Value, 0, 1);
            _verificationBar.Fraction = fraction;
            _verificationBar.Text = $"{fileName}  ·  {fraction:P0}";
        }
        else
        {
            _verificationBar.Fraction = 0;
            _verificationBar.Text = fileName;
        }
    }

    private static string CompactSummary(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
            return "本轮校核已结束";

        if (message.Contains("异常", StringComparison.Ordinal))
            return "校核已安全停止 · 未主动上传任何文件";
        if (message.Contains("已停止", StringComparison.Ordinal))
            return "本轮校核已停止 · 已完成结果均已保存";

        var adopted = AdoptedSummary.Match(message);
        if (adopted.Success)
            return $"本轮完成 · 探测 {adopted.Groups["done"].Value}/{adopted.Groups["total"].Value} · 完整副本 {adopted.Groups["existing"].Value} 组 · 接管 {adopted.Groups["adopted"].Value} 组 · 下载 {adopted.Groups["download"].Value}";

        var existing = ExistingSummary.Match(message);
        if (existing.Success && message.Contains("找到", StringComparison.Ordinal))
            return $"本轮完成 · 探测 {existing.Groups["done"].Value}/{existing.Groups["total"].Value} · 完整副本 {existing.Groups["existing"].Value} 组 · 上传 0 B";

        var empty = EmptySummary.Match(message);
        if (empty.Success)
            return $"本轮完成 · 探测 {empty.Groups["done"].Value}/{empty.Groups["total"].Value} · 未发现可接管完整副本";

        return "本轮校核已结束 · 上传 0 B";
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
        _tabs.SelectedIndexChanged -= OnSelectedTabChanged;
        _verificationSource.Click -= OnVerificationPrimaryClick;
        WebDavReadClient.GlobalIoProgress -= OnIoProgress;
        _tips.Dispose();

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

internal enum DashboardActivityViewV0224
{
    Transfer,
    Verification
}

internal enum VerificationProgressKindV0224
{
    Idle,
    Active,
    Complete,
    Warning
}

internal sealed class ActivityTabStripV0224 : Control
{
    private int _selectedIndex;
    private bool _verificationRunning;
    private int _hoverIndex = -1;

    public event EventHandler? SelectedIndexChanged;

    public int SelectedIndex
    {
        get => _selectedIndex;
        set
        {
            var next = Math.Clamp(value, 0, 1);
            if (_selectedIndex == next) return;
            _selectedIndex = next;
            Invalidate();
            SelectedIndexChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public bool VerificationRunning
    {
        get => _verificationRunning;
        set
        {
            if (_verificationRunning == value) return;
            _verificationRunning = value;
            Invalidate();
        }
    }

    public ActivityTabStripV0224()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.Selectable, true);
        BackColor = Color.White;
        Cursor = Cursors.Hand;
        TabStop = false;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        var next = e.X < Width / 2 ? 0 : 1;
        if (_hoverIndex == next) return;
        _hoverIndex = next;
        Invalidate();
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        base.OnMouseLeave(e);
        _hoverIndex = -1;
        Invalidate();
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        SelectedIndex = e.X < Width / 2 ? 0 : 1;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? Color.White);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        var outer = new RectangleF(.5f, .5f, Math.Max(1, Width - 1.5f), Math.Max(1, Height - 1.5f));
        using var outerPath = Rounded(outer, 8f);
        using var track = new SolidBrush(Color.FromArgb(244, 246, 248));
        using var border = new Pen(Color.FromArgb(218, 224, 229), 1f);
        e.Graphics.FillPath(track, outerPath);
        e.Graphics.DrawPath(border, outerPath);

        var half = outer.Width / 2f;
        var selectedRect = new RectangleF(
            _selectedIndex == 0 ? outer.Left + 2 : outer.Left + half,
            outer.Top + 2,
            half - 2,
            outer.Height - 4);
        using var selectedPath = Rounded(selectedRect, 6f);
        using var selectedBrush = new SolidBrush(Color.White);
        e.Graphics.FillPath(selectedBrush, selectedPath);

        if (_hoverIndex >= 0 && _hoverIndex != _selectedIndex)
        {
            var hoverRect = new RectangleF(
                _hoverIndex == 0 ? outer.Left + 2 : outer.Left + half,
                outer.Top + 2,
                half - 2,
                outer.Height - 4);
            using var hoverPath = Rounded(hoverRect, 6f);
            using var hoverBrush = new SolidBrush(Color.FromArgb(239, 243, 246));
            e.Graphics.FillPath(hoverBrush, hoverPath);
        }

        using var regular = new Font("Microsoft YaHei UI", 8.8F);
        using var selectedFont = new Font("Microsoft YaHei UI", 8.8F, FontStyle.Bold);
        DrawLabel(e.Graphics, "转移", 0, regular, selectedFont);
        DrawLabel(e.Graphics, "校核", 1, regular, selectedFont);

        if (_verificationRunning)
        {
            var cx = outer.Left + half + half * .78f;
            var cy = outer.Top + outer.Height / 2f;
            using var dot = new SolidBrush(Color.FromArgb(88, 158, 126));
            e.Graphics.FillEllipse(dot, cx - 3, cy - 3, 6, 6);
        }
    }

    private void DrawLabel(Graphics g, string text, int index, Font regular, Font selectedFont)
    {
        var half = Width / 2;
        var rect = new Rectangle(index * half, 0, half, Height);
        var selected = _selectedIndex == index;
        var color = selected ? Color.FromArgb(54, 92, 115) : Color.FromArgb(119, 130, 139);
        TextRenderer.DrawText(g, text, selected ? selectedFont : regular, rect, color,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
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

internal sealed class VerificationStageTrackV0224 : Control
{
    private static readonly string[] Stages = { "探测", "源读取", "目标读取", "SHA256" };
    private int _activeIndex = -1;
    private int _completedThrough = -1;

    public int ActiveIndex
    {
        get => _activeIndex;
        set { if (_activeIndex == value) return; _activeIndex = value; Invalidate(); }
    }

    public int CompletedThrough
    {
        get => _completedThrough;
        set { if (_completedThrough == value) return; _completedThrough = value; Invalidate(); }
    }

    public VerificationStageTrackV0224()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.White;
        MinimumSize = new Size(300, 32);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? Color.White);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using var font = new Font("Microsoft YaHei UI", 8.3F);

        var pad = 26f;
        var lineY = 9f;
        var usable = Math.Max(1, Width - pad * 2);
        var step = usable / (Stages.Length - 1);

        using var baseLine = new Pen(Color.FromArgb(220, 226, 230), 1.5f);
        e.Graphics.DrawLine(baseLine, pad, lineY, Width - pad, lineY);

        for (var i = 0; i < Stages.Length; i++)
        {
            var x = pad + i * step;
            var completed = i <= CompletedThrough;
            var active = i == ActiveIndex;
            var nodeColor = active
                ? Color.FromArgb(73, 137, 164)
                : completed
                    ? Color.FromArgb(132, 173, 187)
                    : Color.FromArgb(196, 205, 211);
            var radius = active ? 4.4f : 3.4f;
            using var node = new SolidBrush(nodeColor);
            e.Graphics.FillEllipse(node, x - radius, lineY - radius, radius * 2, radius * 2);

            var labelRect = new Rectangle((int)(x - step / 2), 15, (int)step, Height - 16);
            if (i == 0) labelRect.X = 0;
            if (i == Stages.Length - 1) labelRect.X = Width - (int)step;
            var textColor = active
                ? Color.FromArgb(58, 112, 136)
                : completed
                    ? Color.FromArgb(103, 132, 145)
                    : Color.FromArgb(154, 164, 172);
            TextRenderer.DrawText(e.Graphics, Stages[i], font, labelRect, textColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }
}

internal sealed class VerificationProgressBarV0224 : Control
{
    private double _fraction;
    private string _text = string.Empty;
    private VerificationProgressKindV0224 _kind;

    public double Fraction
    {
        get => _fraction;
        set { _fraction = Math.Clamp(value, 0, 1); Invalidate(); }
    }

    public override string Text
    {
        get => _text;
        set { if (_text == value) return; _text = value ?? string.Empty; Invalidate(); }
    }

    public VerificationProgressKindV0224 Kind
    {
        get => _kind;
        set { if (_kind == value) return; _kind = value; Invalidate(); }
    }

    public VerificationProgressBarV0224()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.White;
        Font = new Font("Microsoft YaHei UI", 8.4F);
        MinimumSize = new Size(100, 24);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        e.Graphics.Clear(Parent?.BackColor ?? Color.White);
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

        var rect = new RectangleF(.5f, .5f, Math.Max(1, Width - 1.5f), Math.Max(1, Height - 1.5f));
        using var path = Rounded(rect, 5f);
        using var track = new SolidBrush(Color.FromArgb(243, 246, 247));
        e.Graphics.FillPath(track, path);

        if (Fraction > 0)
        {
            var fillRect = new RectangleF(rect.Left, rect.Top, Math.Max(1, (float)(rect.Width * Fraction)), rect.Height);
            var colors = Kind == VerificationProgressKindV0224.Warning
                ? (Color.FromArgb(247, 229, 226), Color.FromArgb(214, 142, 134))
                : (Color.FromArgb(226, 241, 245), Color.FromArgb(119, 179, 193));
            using var fill = new LinearGradientBrush(fillRect, colors.Item1, colors.Item2, LinearGradientMode.Horizontal);
            e.Graphics.SetClip(path);
            e.Graphics.FillRectangle(fill, fillRect);
            e.Graphics.ResetClip();
        }

        using var border = new Pen(Color.FromArgb(211, 219, 224), 1f);
        e.Graphics.DrawPath(border, path);

        var textColor = Kind == VerificationProgressKindV0224.Warning
            ? Color.FromArgb(126, 75, 70)
            : Color.FromArgb(65, 77, 86);
        TextRenderer.DrawText(e.Graphics, Text, Font, Rectangle.Round(rect), textColor,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
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
