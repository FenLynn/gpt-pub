using DavBridge.Core;

namespace DavBridge;

internal sealed class MainForm : Form
{
    private readonly AppHost _host;
    private readonly bool _launchInBackground;
    private readonly CancellationTokenSource _appCts = new();
    private readonly NotifyIcon _trayIcon;
    private readonly Label _sourceValue = new() { AutoSize = true };
    private readonly Label _targetValue = new() { AutoSize = true };
    private readonly Label _stateValue = new() { AutoSize = true };
    private readonly Label _quotaValue = new() { AutoSize = true };
    private readonly Label _resetValue = new() { AutoSize = true };
    private readonly Label _filesValue = new() { AutoSize = true };
    private readonly Label _currentValue = new() { AutoSize = true, MaximumSize = new Size(620, 0) };
    private readonly ProgressBar _quotaBar = new() { Maximum = 1000, Dock = DockStyle.Top, Height = 12 };
    private bool _exitRequested;
    private EngineState? _lastNotifiedState;

    public MainForm(AppHost host, bool launchInBackground)
    {
        _host = host;
        _launchInBackground = launchInBackground;
        Text = "DavBridge";
        Width = 720;
        Height = 500;
        MinimumSize = new Size(620, 420);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.White;

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
        _host.StateChanged += (_, _) => SafeUi(() => UpdateView());
    }

    private Control BuildLayout()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(24)
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        root.Controls.Add(new Label
        {
            Text = "DavBridge",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 17F),
            Margin = new Padding(0, 0, 0, 18)
        }, 0, 0);

        var info = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, AutoSize = true };
        info.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        info.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddRow(info, "InfiniCLOUD", _sourceValue);
        AddRow(info, "坚果云", _targetValue);
        AddRow(info, "状态", _stateValue);
        AddRow(info, "当前周期", _quotaValue);
        AddRow(info, string.Empty, _quotaBar);
        AddRow(info, "流量重置", _resetValue);
        AddRow(info, "文件状态", _filesValue);
        AddRow(info, "当前任务", _currentValue);
        root.Controls.Add(info, 0, 1);

        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, WrapContents = true };
        actions.Controls.Add(ActionButton("继续", async (_, _) => await ResumeNowAsync()));
        actions.Controls.Add(ActionButton("暂停", (_, _) => _host.Pause()));
        actions.Controls.Add(ActionButton("迁移就绪扫描", async (_, _) => await ScanAsync()));
        actions.Controls.Add(ActionButton("校准流量", async (_, _) => await CalibrateAsync()));
        actions.Controls.Add(ActionButton("设置", async (_, _) => await EditSettingsAsync()));
        root.Controls.Add(actions, 0, 2);

        root.Controls.Add(new Label
        {
            Text = "关闭窗口只会缩到托盘。只有托盘菜单“退出”才会停止 DavBridge。",
            AutoSize = true,
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 18, 0, 0)
        }, 0, 3);
        return root;
    }

    private async void OnShownAsync(object? sender, EventArgs e)
    {
        try
        {
            await _host.InitializeAsync(_appCts.Token);
            UpdateView();
            if (!_host.IsConfigured)
                await EditSettingsAsync();
            else if (_launchInBackground || _host.Config.StartMinimized)
                HideToTray();

            _ = Task.Run(() => _host.BackgroundLoopAsync(_appCts.Token));
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "DavBridge 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task ResumeNowAsync()
    {
        if (!await EnsureConfiguredAsync()) return;
        _host.Resume();
        try { await _host.RunOnceAsync(_appCts.Token); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "DavBridge", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        UpdateView();
    }

    private async Task ScanAsync()
    {
        if (!await EnsureConfiguredAsync()) return;
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
        finally { UseWaitCursor = false; }
    }

    private async Task CalibrateAsync()
    {
        using var dialog = new CalibrationDialog(_host.Config);
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        await _host.CalibrateAsync(dialog.UploadUsedBytes, dialog.DownloadUsedBytes, dialog.NextResetAt, _appCts.Token);
        UpdateView();
    }

    private async Task EditSettingsAsync()
    {
        using var dialog = new SettingsDialog(_host.Config);
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        await _host.SaveSettingsAsync(dialog.Config, dialog.SourcePassword, dialog.TargetPassword, _appCts.Token);
        UpdateView();
    }

    private async Task<bool> EnsureConfiguredAsync()
    {
        if (_host.IsConfigured) return true;
        await EditSettingsAsync();
        return _host.IsConfigured;
    }

    private void OnProgressChanged(object? sender, EngineProgress progress)
    {
        SafeUi(() =>
        {
            UpdateView(progress);
            var important = progress.State is EngineState.WaitQuota or EngineState.WaitRetry or EngineState.Complete;
            if (important && _lastNotifiedState != progress.State)
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
        _quotaValue.Text = $"估算已用 {FormatBytes(quota.EstimatedUploadUsedBytes)} / {_host.Config.UploadQuotaBytes / 1_000_000d:0.#} MB，预留 {quota.ReservedBytes / 1_000_000d:0.#} MB{(quota.IsSprint ? "，周期末冲刺" : string.Empty)}";
        var ratio = _host.Config.UploadQuotaBytes <= 0 ? 0d : (double)quota.EstimatedUploadUsedBytes / _host.Config.UploadQuotaBytes;
        _quotaBar.Value = Math.Clamp((int)Math.Round(ratio * 1000), 0, 1000);
        _resetValue.Text = _host.Config.NextResetAt == default ? "未校准" : _host.Config.NextResetAt.ToString("yyyy-MM-dd HH:mm");

        var verified = _host.State.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified);
        var errors = _host.State.Files.Values.Count(x => x.Status is TransferStatus.Failed or TransferStatus.Conflict or TransferStatus.BlockedOversize);
        _filesValue.Text = $"已强校验 {verified:N0}，异常 {errors:N0}，记录 {_host.State.Files.Count:N0}";
        _currentValue.Text = progress is null
            ? (_host.State.CurrentGroupKey ?? "等待")
            : $"{progress.GroupKey ?? "等待"} / {progress.RelativePath ?? string.Empty}\n{progress.Message}";
    }

    private void ShowWindow()
    {
        ShowInTaskbar = true;
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private void HideToTray()
    {
        Hide();
        ShowInTaskbar = false;
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_exitRequested) return;
        e.Cancel = true;
        HideToTray();
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
        if (IsDisposed) return;
        if (InvokeRequired) BeginInvoke(action); else action();
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

    private static void AddRow(TableLayoutPanel panel, string label, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = label, AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(0, 7, 12, 7) }, 0, row);
        control.Margin = new Padding(0, 7, 0, 7);
        control.Dock = control is ProgressBar ? DockStyle.Top : DockStyle.Fill;
        panel.Controls.Add(control, 1, row);
    }

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
