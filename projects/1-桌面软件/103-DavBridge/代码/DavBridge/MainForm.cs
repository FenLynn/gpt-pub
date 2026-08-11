using DavBridge.Core;

namespace DavBridge;

internal sealed class MainForm : Form
{
    private readonly AppHost _host;
    private readonly bool _launchInBackground;
    private readonly CancellationTokenSource _appCts = new();
    private readonly NotifyIcon _trayIcon;
    private readonly Label _sourceValue = new();
    private readonly Label _targetValue = new();
    private readonly Label _stateValue = new();
    private readonly Label _quotaValue = new();
    private readonly Label _resetValue = new();
    private readonly Label _filesValue = new();
    private readonly Label _currentValue = new();
    private readonly ProgressBar _quotaBar = new();
    private bool _exitRequested;
    private EngineState? _lastNotifiedState;

    public MainForm(AppHost host, bool launchInBackground)
    {
        _host = host;
        _launchInBackground = launchInBackground;
        Text = "DavBridge";
        Width = 720;
        Height = 520;
        MinimumSize = new Size(620, 440);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);

        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("打开 DavBridge", null, (_, _) => ShowWindow());
        trayMenu.Items.Add("继续迁移", null, async (_, _) => await ResumeNowAsync());
        trayMenu.Items.Add("暂停", null, (_, _) => _host.Pause());
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("退出", null, (_, _) => ExitApplication());
        _trayIcon = new NotifyIcon
        {
            Text = "DavBridge",
            Icon = SystemIcons.Application,
            ContextMenuStrip = trayMenu,
            Visible = true
        };
        _trayIcon.DoubleClick += (_, _) => ShowWindow();

        Controls.Add(BuildLayout());
        FormClosing += OnFormClosing;
        Shown += OnShownAsync;
        _host.ProgressChanged += OnProgressChanged;
        _host.StateChanged += (_, _) => SafeUi(UpdateView);
    }

    private Control BuildLayout()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(24),
            BackColor = Color.White
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var title = new Label
        {
            Text = "DavBridge",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 17F),
            Margin = new Padding(0, 0, 0, 16)
        };
        root.Controls.Add(title, 0, 0);

        var connection = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 4, AutoSize = true };
        connection.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        connection.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        connection.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        connection.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        connection.Controls.Add(MutedLabel("InfiniCLOUD"), 0, 0);
        connection.Controls.Add(_sourceValue, 1, 0);
        connection.Controls.Add(MutedLabel("坚果云"), 2, 0);
        connection.Controls.Add(_targetValue, 3, 0);
        connection.Controls.Add(MutedLabel("状态"), 0, 1);
        connection.Controls.Add(_stateValue, 1, 1);
        connection.SetColumnSpan(_stateValue, 3);
        root.Controls.Add(connection, 0, 1);

        var center = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 7, Padding = new Padding(0, 28, 0, 18) };
        center.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        center.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        center.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        center.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        center.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        center.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        center.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        center.Controls.Add(MutedLabel("当前流量周期"), 0, 0);
        center.Controls.Add(_quotaValue, 0, 1);
        _quotaBar.Dock = DockStyle.Top;
        _quotaBar.Height = 12;
        _quotaBar.Maximum = 1000;
        _quotaBar.Margin = new Padding(0, 8, 0, 12);
        center.Controls.Add(_quotaBar, 0, 2);
        center.Controls.Add(_resetValue, 0, 3);
        center.Controls.Add(_filesValue, 0, 4);
        center.Controls.Add(_currentValue, 0, 5);
        root.Controls.Add(center, 0, 2);

        var actions = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = true };
        actions.Controls.Add(ActionButton("继续", async (_, _) => await ResumeNowAsync()));
        actions.Controls.Add(ActionButton("暂停", (_, _) => _host.Pause()));
        actions.Controls.Add(ActionButton("迁移就绪扫描", async (_, _) => await ScanAsync()));
        actions.Controls.Add(ActionButton("校准流量", async (_, _) => await CalibrateAsync()));
        actions.Controls.Add(ActionButton("设置", async (_, _) => await EditSettingsAsync()));
        root.Controls.Add(actions, 0, 3);

        var footer = new Label
        {
            Text = "窗口关闭后继续在托盘运行。只有托盘菜单“退出”才会结束 DavBridge。",
            AutoSize = true,
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 18, 0, 0)
        };
        root.Controls.Add(footer, 0, 4);
        return root;
    }

    private async void OnShownAsync(object? sender, EventArgs e)
    {
        try
        {
            await _host.InitializeAsync(_appCts.Token);
            UpdateView();
            if (!_host.IsConfigured)
            {
                await EditSettingsAsync();
            }
            else if (_launchInBackground || _host.Config.StartMinimized)
            {
                Hide();
                ShowInTaskbar = false;
            }

            _ = Task.Run(() => _host.BackgroundLoopAsync(_appCts.Token));
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "DavBridge 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task ResumeNowAsync()
    {
        if (!_host.IsConfigured)
        {
            await EditSettingsAsync();
            if (!_host.IsConfigured)
                return;
        }
        _host.Resume();
        try { await _host.RunOnceAsync(_appCts.Token); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "DavBridge", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        UpdateView();
    }

    private async Task ScanAsync()
    {
        if (!_host.IsConfigured)
        {
            await EditSettingsAsync();
            if (!_host.IsConfigured)
                return;
        }

        try
        {
            UseWaitCursor = true;
            var report = await _host.ScanReadinessAsync(_appCts.Token);
            var oversize = report.OversizeObjects.Count == 0 ? "0" : string.Join(Environment.NewLine, report.OversizeObjects.Take(10));
            var unpaired = report.UnpairedZoteroObjects.Count == 0 ? "0" : string.Join(Environment.NewLine, report.UnpairedZoteroObjects.Take(10));
            MessageBox.Show(this,
                $"对象：{report.ObjectCount:N0}\n逻辑组：{report.GroupCount:N0}\n总量：{FormatBytes(report.TotalBytes)}\n最大文件：{FormatBytes(report.LargestFileBytes)}\n\n超过单文件上限：{oversize}\n\n未配对 zip/prop：{unpaired}",
                "迁移就绪扫描", MessageBoxButtons.OK,
                report.OversizeObjects.Count == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "扫描失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            UseWaitCursor = false;
        }
    }

    private async Task CalibrateAsync()
    {
        using var dialog = new CalibrationDialog(_host.Config);
        if (dialog.ShowDialog(this) != DialogResult.OK)
            return;
        await _host.CalibrateAsync(dialog.UploadUsedBytes, dialog.DownloadUsedBytes, dialog.NextResetAt, _appCts.Token);
        UpdateView();
    }

    private async Task EditSettingsAsync()
    {
        using var dialog = new SettingsDialog(_host.Config);
        if (dialog.ShowDialog(this) != DialogResult.OK)
            return;
        await _host.SaveSettingsAsync(dialog.Config, dialog.SourcePassword, dialog.TargetPassword, _appCts.Token);
        UpdateView();
    }

    private void OnProgressChanged(object? sender, EngineProgress progress)
    {
        SafeUi(() =>
        {
            UpdateView(progress);
            if (progress.State is EngineState.WaitQuota or EngineState.WaitRetry or EngineState.Complete && _lastNotifiedState != progress.State)
            {
                _trayIcon.BalloonTipTitle = "DavBridge";
                _trayIcon.BalloonTipText = progress.Message;
                _trayIcon.ShowBalloonTip(5000);
                _lastNotifiedState = progress.State;
            }
        });
    }

    private void UpdateView(EngineProgress? progress = null)
    {
        _sourceValue.Text = string.IsNullOrWhiteSpace(_host.Config.SourceBaseUrl) ? "未配置" : "已配置";
        _targetValue.Text = string.IsNullOrWhiteSpace(_host.Config.TargetBaseUrl) ? "未配置" : "已配置";
        _stateValue.Text = (progress?.State ?? _host.State.EngineState).ToString();

        var quota = progress?.Quota ?? QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        _quotaValue.Text = $"估算已用 {FormatBytes(quota.EstimatedUploadUsedBytes)} / {_host.Config.UploadQuotaBytes / 1_000_000d:0.#} MB，当前预留 {quota.ReservedBytes / 1_000_000d:0.#} MB{(quota.IsSprint ? "（周期末冲刺）" : string.Empty)}";
        var usedRatio = _host.Config.UploadQuotaBytes <= 0 ? 0d : (double)quota.EstimatedUploadUsedBytes / _host.Config.UploadQuotaBytes;
        _quotaBar.Value = Math.Clamp((int)Math.Round(usedRatio * 1000), 0, 1000);
        _resetValue.Text = _host.Config.NextResetAt == default ? "流量重置：未校准" : $"流量重置：{_host.Config.NextResetAt:yyyy-MM-dd HH:mm}";

        var verified = _host.State.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified);
        var errors = _host.State.Files.Values.Count(x => x.Status is TransferStatus.Failed or TransferStatus.Conflict or TransferStatus.BlockedOversize);
        _filesValue.Text = $"已强校验：{verified:N0}　异常：{errors:N0}　记录：{_host.State.Files.Count:N0}";
        _currentValue.Text = progress is null
            ? $"当前：{_host.State.CurrentGroupKey ?? "等待"}"
            : $"当前：{progress.GroupKey ?? "等待"} / {progress.RelativePath ?? string.Empty}\n{progress.Message}";
    }

    private void ShowWindow()
    {
        ShowInTaskbar = true;
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_exitRequested)
            return;
        e.Cancel = true;
        Hide();
        ShowInTaskbar = false;
    }

    private void ExitApplication()
    {
        _exitRequested = true;
        _trayIcon.Visible = false;
        _appCts.Cancel();
        Close();
    }

    private void SafeUi(Action action)
    {
        if (IsDisposed)
            return;
        if (InvokeRequired)
            BeginInvoke(action);
        else
            action();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _appCts.Cancel();
            _appCts.Dispose();
            _trayIcon.Dispose();
        }
        base.Dispose(disposing);
    }

    private static Label MutedLabel(string text) => new()
    {
        Text = text,
        AutoSize = true,
        ForeColor = Color.DimGray,
        Margin = new Padding(0, 5, 12, 5)
    };

    private static Button ActionButton(string text, EventHandler onClick)
    {
        var button = new Button { Text = text, AutoSize = true, Padding = new Padding(10, 4, 10, 4), Margin = new Padding(0, 0, 8, 0) };
        button.Click += onClick;
        return button;
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1_000_000_000) return $"{bytes / 1_000_000_000d:0.00} GB";
        if (bytes >= 1_000_000) return $"{bytes / 1_000_000d:0.0} MB";
        if (bytes >= 1_000) return $"{bytes / 1_000d:0.0} KB";
        return $"{bytes} B";
    }
}

internal sealed class SettingsDialog : Form
{
    private readonly TextBox _sourceUrl = new();
    private readonly TextBox _sourceRoot = new();
    private readonly TextBox _sourceUser = new();
    private readonly TextBox _sourcePassword = new() { UseSystemPasswordChar = true };
    private readonly TextBox _targetUrl = new();
    private readonly TextBox _targetRoot = new();
    private readonly TextBox _targetUser = new();
    private readonly TextBox _targetPassword = new() { UseSystemPasswordChar = true };
    private readonly NumericUpDown _speed = new() { Minimum = 10, Maximum = 10_000, Increment = 50 };
    private readonly NumericUpDown _reserve = new() { Minimum = 0, Maximum = 500, Increment = 5 };
    private readonly NumericUpDown _sprintReserve = new() { Minimum = 0, Maximum = 100, Increment = 1 };
    private readonly CheckBox _autoStart = new() { Text = "Windows 登录后自动启动" };
    private readonly CheckBox _startMinimized = new() { Text = "启动后默认进入托盘" };
    private readonly CheckBox _autoResume = new() { Text = "网络恢复和新周期后自动继续" };
    private readonly CheckBox _sprint = new() { Text = "重置前 24 小时启用周期末冲刺" };

    public DavBridgeConfig Config { get; private set; }
    public string? SourcePassword => string.IsNullOrEmpty(_sourcePassword.Text) ? null : _sourcePassword.Text;
    public string? TargetPassword => string.IsNullOrEmpty(_targetPassword.Text) ? null : _targetPassword.Text;

    public SettingsDialog(DavBridgeConfig original)
    {
        Config = CloneConfig(original);
        Text = "DavBridge 设置";
        Width = 620;
        Height = 650;
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 9F);

        _sourceUrl.Text = Config.SourceBaseUrl;
        _sourceRoot.Text = Config.SourceRootPath;
        _sourceUser.Text = Config.SourceUsername;
        _targetUrl.Text = Config.TargetBaseUrl;
        _targetRoot.Text = Config.TargetRootPath;
        _targetUser.Text = Config.TargetUsername;
        _speed.Value = Math.Clamp(Config.UploadLimitBytesPerSecond / 1000, (int)_speed.Minimum, (int)_speed.Maximum);
        _reserve.Value = Math.Clamp(Config.NormalReserveBytes / 1_000_000, (long)_reserve.Minimum, (long)_reserve.Maximum);
        _sprintReserve.Value = Math.Clamp(Config.SprintReserveBytes / 1_000_000, (long)_sprintReserve.Minimum, (long)_sprintReserve.Maximum);
        _autoStart.Checked = Config.AutoStartWithWindows;
        _startMinimized.Checked = Config.StartMinimized;
        _autoResume.Checked = Config.AutoResume;
        _sprint.Checked = Config.EndOfCycleSprintEnabled;

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(18), AutoScroll = true };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddField(panel, "InfiniCLOUD URL", _sourceUrl);
        AddField(panel, "源目录", _sourceRoot);
        AddField(panel, "源用户名", _sourceUser);
        AddField(panel, "源应用密码", _sourcePassword);
        AddField(panel, "坚果云 URL", _targetUrl);
        AddField(panel, "目标目录", _targetRoot);
        AddField(panel, "目标用户名", _targetUser);
        AddField(panel, "目标应用密码", _targetPassword);
        AddField(panel, "上传限速 KB/s", _speed);
        AddField(panel, "普通预留 MB", _reserve);
        AddField(panel, "冲刺预留 MB", _sprintReserve);
        AddFull(panel, _autoStart);
        AddFull(panel, _startMinimized);
        AddFull(panel, _autoResume);
        AddFull(panel, _sprint);

        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, AutoSize = true };
        var save = new Button { Text = "保存", DialogResult = DialogResult.OK, AutoSize = true };
        var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, AutoSize = true };
        save.Click += (_, _) => Apply();
        buttons.Controls.Add(save);
        buttons.Controls.Add(cancel);
        AddFull(panel, buttons);
        Controls.Add(panel);
        AcceptButton = save;
        CancelButton = cancel;
    }

    private void Apply()
    {
        Config.SourceBaseUrl = _sourceUrl.Text.Trim();
        Config.SourceRootPath = _sourceRoot.Text.Trim().Trim('/');
        Config.SourceUsername = _sourceUser.Text.Trim();
        Config.TargetBaseUrl = _targetUrl.Text.Trim();
        Config.TargetRootPath = _targetRoot.Text.Trim().Trim('/');
        Config.TargetUsername = _targetUser.Text.Trim();
        Config.UploadLimitBytesPerSecond = (int)_speed.Value * 1000;
        Config.NormalReserveBytes = (long)_reserve.Value * 1_000_000L;
        Config.SprintReserveBytes = (long)_sprintReserve.Value * 1_000_000L;
        Config.AutoStartWithWindows = _autoStart.Checked;
        Config.StartMinimized = _startMinimized.Checked;
        Config.AutoResume = _autoResume.Checked;
        Config.EndOfCycleSprintEnabled = _sprint.Checked;
    }

    private static DavBridgeConfig CloneConfig(DavBridgeConfig x) => new()
    {
        SourceBaseUrl = x.SourceBaseUrl,
        SourceRootPath = x.SourceRootPath,
        SourceUsername = x.SourceUsername,
        TargetBaseUrl = x.TargetBaseUrl,
        TargetRootPath = x.TargetRootPath,
        TargetUsername = x.TargetUsername,
        UploadQuotaBytes = x.UploadQuotaBytes,
        DownloadQuotaBytes = x.DownloadQuotaBytes,
        NormalReserveBytes = x.NormalReserveBytes,
        SprintReserveBytes = x.SprintReserveBytes,
        SprintWindowHours = x.SprintWindowHours,
        UploadLimitBytesPerSecond = x.UploadLimitBytesPerSecond,
        TargetMinimumRequestIntervalMs = x.TargetMinimumRequestIntervalMs,
        TargetSingleFileLimitBytes = x.TargetSingleFileLimitBytes,
        NextResetAt = x.NextResetAt,
        CalibrationAt = x.CalibrationAt,
        CalibrationUploadUsedBytes = x.CalibrationUploadUsedBytes,
        CalibrationDownloadUsedBytes = x.CalibrationDownloadUsedBytes,
        AutoStartWithWindows = x.AutoStartWithWindows,
        StartMinimized = x.StartMinimized,
        AutoResume = x.AutoResume,
        EndOfCycleSprintEnabled = x.EndOfCycleSprintEnabled
    };

    private static void AddField(TableLayoutPanel panel, string label, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 8, 7) }, 0, row);
        control.Dock = DockStyle.Top;
        control.Margin = new Padding(0, 4, 0, 4);
        panel.Controls.Add(control, 1, row);
    }

    private static void AddFull(TableLayoutPanel panel, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        control.Margin = new Padding(0, 6, 0, 6);
        panel.Controls.Add(control, 0, row);
        panel.SetColumnSpan(control, 2);
    }
}

internal sealed class CalibrationDialog : Form
{
    private readonly NumericUpDown _upload = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 1000, Increment = 1 };
    private readonly NumericUpDown _download = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 3000, Increment = 1 };
    private readonly DateTimePicker _reset = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "yyyy-MM-dd HH:mm", Width = 180 };

    public long UploadUsedBytes => (long)(_upload.Value * 1_000_000m);
    public long DownloadUsedBytes => (long)(_download.Value * 1_000_000m);
    public DateTimeOffset NextResetAt => new(_reset.Value);

    public CalibrationDialog(DavBridgeConfig config)
    {
        Text = "校准坚果云流量";
        Width = 430;
        Height = 250;
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 9F);
        _upload.Value = Math.Clamp((decimal)config.CalibrationUploadUsedBytes / 1_000_000m, _upload.Minimum, _upload.Maximum);
        _download.Value = Math.Clamp((decimal)config.CalibrationDownloadUsedBytes / 1_000_000m, _download.Minimum, _download.Maximum);
        _reset.Value = config.NextResetAt == default ? DateTime.Now.AddMonths(1) : config.NextResetAt.LocalDateTime;

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(18) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        SettingsDialogAdd(panel, "官方上传已用 MB", _upload);
        SettingsDialogAdd(panel, "官方下载已用 MB", _download);
        SettingsDialogAdd(panel, "下次流量重置", _reset);
        var save = new Button { Text = "校准", DialogResult = DialogResult.OK, AutoSize = true };
        panel.Controls.Add(save, 1, panel.RowCount++);
        Controls.Add(panel);
        AcceptButton = save;
    }

    private static void SettingsDialogAdd(TableLayoutPanel panel, string label, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 8, 7) }, 0, row);
        panel.Controls.Add(control, 1, row);
    }
}
