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
        var appVersion = typeof(MainForm).Assembly.GetName().Version;
        Text = appVersion is null
            ? "DavBridge"
            : $"DavBridge v{appVersion.Major}.{appVersion.Minor}.{appVersion.Build}";
        Width = 800;
        Height = 540;
        MinimumSize = new Size(690, 450);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.White;

        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("打开 DavBridge", null, (_, _) => ShowWindow());
        trayMenu.Items.Add("继续迁移", null, async (_, _) => await ResumeNowAsync());
        trayMenu.Items.Add("暂停", null, async (_, _) => await PauseAsync());
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
        actions.Controls.Add(ActionButton("连接诊断", async (_, _) => await DiagnoseConnectionsAsync()));
        actions.Controls.Add(ActionButton("迁移就绪扫描", async (_, _) => await ScanAsync()));
        actions.Controls.Add(ActionButton("校准流量", async (_, _) => await CalibrateAsync()));
        actions.Controls.Add(ActionButton("首组验证", async (_, _) => await ValidateFirstGroupAsync()));
        actions.Controls.Add(ActionButton("开始 / 继续", async (_, _) => await ResumeNowAsync()));
        actions.Controls.Add(ActionButton("暂停", async (_, _) => await PauseAsync()));
        actions.Controls.Add(ActionButton("设置", async (_, _) => await EditSettingsAsync()));
        root.Controls.Add(actions, 0, 2);

        root.Controls.Add(new Label
        {
            Text = "首次迁移顺序：连接诊断 → 就绪扫描 → 校准流量 → 首组验证。首组强校验通过前不会开放整库长期迁移。关闭窗口只缩到托盘。",
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

        if (!FirstGroupValidationRunner.HasCompletedZoteroValidation(_host.State))
        {
            MessageBox.Show(this,
                "整库长期迁移尚未开放。请先完成流量校准和“首组验证”，只有一个完整 zip + prop 逻辑组在真实坚果云端通过强 SHA-256 校验后，才能开始长期迁移。",
                "DavBridge 安全门", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        if (!_host.Config.MigrationEnabled)
        {
            var preflight = await ScanCoreAsync(showResult: true);
            if (preflight is null) return;

            if (preflight.Value.Report.OversizeObjects.Count > 0)
            {
                MessageBox.Show(this, "存在超过目标单文件上限的对象，长期迁移不会启用。", "DavBridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            var visibleLabel = FormatTargetVisibleCount(preflight.Value.TargetVisibleObjects);
            var targetText = preflight.Value.TargetVisibleObjects > 0
                ? $"目标 zotero 目录本次可见 {visibleLabel} 个既有文件。DavBridge 会逐个按准确路径重新下载并与 InfiniCLOUD 源文件比较 SHA-256。完全一致的文件直接接管，不重复上传；内容不同的文件进入冲突并停止，不会自动覆盖。"
                : "目标 zotero 目录当前未发现可见文件。";

            var confirm = MessageBox.Show(this,
                $"首组真实强校验已经通过，就绪扫描也已完成。\n\n{targetText}\n\n确认启用长期后台迁移并立即开始吗？\n\n迁移期间 InfiniCLOUD 保持只读，目标文件只有重新 GET 并通过 SHA-256 后才会记为完成。",
                "启用 DavBridge 长期迁移", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;
        }

        await _host.ResumeAsync(_appCts.Token);
        try { await _host.RunOnceAsync(_appCts.Token); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "DavBridge", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        UpdateView();
    }

    private async Task PauseAsync()
    {
        await _host.PauseAsync(_appCts.Token);
        UpdateView();
    }

    private async Task DiagnoseConnectionsAsync()
    {
        if (!await EnsureConfiguredAsync()) return;
        try
        {
            UseWaitCursor = true;
            var result = await _host.DiagnoseConnectionsAsync(_appCts.Token);
            var text =
                $"InfiniCLOUD\n{StatusMark(result.SourceOk)} {result.SourceMessage}\n\n" +
                $"坚果云 WebDAV 根目录\n{StatusMark(result.TargetBaseOk)} {result.TargetBaseMessage}\n\n" +
                $"坚果云 Zotero 目标目录\n{StatusMark(result.TargetRootOk)} {result.TargetRootMessage}";

            if (!result.TargetBaseOk)
                text += "\n\n若坚果云为 401：请在“设置”中确认用户名为注册邮箱，并重新输入当前有效的第三方应用密码。不要使用坚果云网页登录密码。";

            MessageBox.Show(this, text, "连接诊断",
                MessageBoxButtons.OK, result.AllOk ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "连接诊断失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            UseWaitCursor = false;
        }
    }

    private async Task ScanAsync()
    {
        if (!await EnsureConfiguredAsync()) return;
        await ScanCoreAsync(showResult: true);
    }

    private async Task<(ReadinessReport Report, int TargetVisibleObjects)?> ScanCoreAsync(bool showResult)
    {
        try
        {
            UseWaitCursor = true;
            var report = await _host.ScanReadinessAsync(_appCts.Token);
            var targetVisible = await _host.GetVisibleTargetObjectCountAsync(_appCts.Token);

            if (showResult)
            {
                var oversize = report.OversizeObjects.Count == 0 ? "0" : string.Join(Environment.NewLine, report.OversizeObjects.Take(10));
                var unpaired = report.UnpairedZoteroObjects.Count == 0 ? "0" : string.Join(Environment.NewLine, report.UnpairedZoteroObjects.Take(10));
                var targetNote = targetVisible == 0
                    ? "未发现既有目标文件"
                    : targetVisible >= 750
                        ? "本次目录列举已达到 750 项上限，实际目标文件可能更多；迁移本身按准确文件路径逐个确认，不依赖这次列表完整性"
                        : "既有目标文件不会阻止迁移，后续将逐个强校验并安全接管一致文件";
                MessageBox.Show(this,
                    $"源端对象：{report.ObjectCount:N0}\nZotero 逻辑组：{report.GroupCount:N0}\n源端总量：{FormatBytes(report.TotalBytes)}\n最大文件：{FormatBytes(report.LargestFileBytes)}\n目标端本次可见文件：{FormatTargetVisibleCount(targetVisible)}\n目标策略：{targetNote}\n\n超过单文件上限：{oversize}\n\n未配对 zip/prop：{unpaired}",
                    "迁移就绪扫描", MessageBoxButtons.OK,
                    report.OversizeObjects.Count == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
            }

            return (report, targetVisible);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                ex.Message + "\n\n请先点击“连接诊断”，分别确认 InfiniCLOUD、坚果云 WebDAV 根目录和目标 zotero 目录。",
                "扫描失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return null;
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

    private async Task ValidateFirstGroupAsync()
    {
        if (!await EnsureConfiguredAsync()) return;
        if (_host.Config.MigrationEnabled)
        {
            MessageBox.Show(this, "请先暂停长期迁移，再执行首组验证。", "首组验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_host.Config.NextResetAt == default)
        {
            MessageBox.Show(this, "流量尚未校准。请先点击“校准流量”，录入坚果云网页当前显示的上传已用、下载已用和下一次重置日期。", "首组验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (FirstGroupValidationRunner.HasCompletedZoteroValidation(_host.State))
        {
            MessageBox.Show(this, "已经存在一个完整 zip + prop 逻辑组的真实强校验记录，无需重复首组验证。", "首组验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        try
        {
            UseWaitCursor = true;
            var plan = await FirstGroupValidationRunner.PrepareAsync(_host, _appCts.Token);
            var members = string.Join(Environment.NewLine, plan.Members.Select(member => $"  {member.RelativePath}  {FormatBytes(member.ContentLength ?? 0)}"));
            var confirm = MessageBox.Show(this,
                $"DavBridge 将只验证下面这一个 Zotero 逻辑组，完成后立即停止，不会启动整库迁移。\n\n" +
                $"组：{plan.GroupKey}\n{members}\n\n" +
                $"组总量：{FormatBytes(plan.TotalBytes)}\n" +
                $"坚果云已存在成员：{plan.ExistingTargetMembers} / {plan.Members.Count}\n" +
                $"本次最多需要上传：{FormatBytes(plan.MaximumUploadBytes)}\n" +
                $"预计坚果云强校验下载：约 {FormatBytes(plan.ExpectedTargetVerificationDownloadBytes)}\n\n" +
                "已有 GoodSync 副本会先下载并比较 SHA-256；只有目标缺失时才会上传。确认开始这个单组真实验证吗？",
                "首组验证计划", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes)
                return;

            var progress = new Progress<EngineProgress>(value => UpdateView(value));
            var result = await FirstGroupValidationRunner.ExecuteAsync(_host, plan.GroupKey, progress, _appCts.Token);
            UpdateView();

            var memberStates = string.Join(Environment.NewLine,
                result.Records.Select(record => $"  {record.RelativePath}: {record.Status}"));
            var mode = result.UploadBytes == 0
                ? "本组未发生 PUT，目标已有副本经强校验后直接接管。"
                : "本组存在目标缺失成员，已完成真实 PUT 和目标重新 GET 强校验。";

            MessageBox.Show(this,
                $"组：{result.GroupKey}\n结果：{(result.Success ? "通过" : "未通过")}\n\n{memberStates}\n\n" +
                $"本次计入上传：{FormatBytes(result.UploadBytes)}\n" +
                $"本次计入坚果云校验下载：{FormatBytes(result.DownloadBytes)}\n\n" +
                $"{mode}\n{result.Message}\n\n" +
                (result.Success ? "首组安全门已通过。下一步才可以考虑启用长期迁移。" : "长期迁移仍保持锁定。请先处理本次异常。"),
                "首组验证结果", MessageBoxButtons.OK,
                result.Success ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "首组验证失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            UseWaitCursor = false;
            UpdateView();
        }
    }

    private async Task EditSettingsAsync()
    {
        var secrets = await _host.GetSecretsAsync(_appCts.Token);
        using var dialog = new SettingsDialog(_host.Config, secrets.SourcePassword, secrets.TargetPassword);
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
        _stateValue.Text = !_host.Config.MigrationEnabled
            ? "Paused，长期迁移未启用或已暂停"
            : (progress?.State ?? _host.State.EngineState).ToString();

        var quota = progress?.Quota ?? QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        _quotaValue.Text =
            $"上传估算 {FormatBytes(quota.EstimatedUploadUsedBytes)} / {FormatBytes(_host.Config.UploadQuotaBytes)}，" +
            $"下载估算 {FormatBytes(quota.EstimatedDownloadUsedBytes)} / {FormatBytes(_host.Config.DownloadQuotaBytes)}，" +
            $"安全预留 {FormatBytes(quota.ReservedBytes)}{(quota.IsSprint ? "，周期末冲刺" : string.Empty)}";
        var uploadRatio = _host.Config.UploadQuotaBytes <= 0 ? 0d : (double)quota.EstimatedUploadUsedBytes / _host.Config.UploadQuotaBytes;
        var downloadRatio = _host.Config.DownloadQuotaBytes <= 0 ? 0d : (double)quota.EstimatedDownloadUsedBytes / _host.Config.DownloadQuotaBytes;
        _quotaBar.Value = Math.Clamp((int)Math.Round(Math.Max(uploadRatio, downloadRatio) * 1000), 0, 1000);
        _resetValue.Text = _host.Config.NextResetAt == default
            ? "未校准"
            : $"{ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt):yyyy-MM-dd}，当日 09:00 后探测上传";

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

    private static string StatusMark(bool ok) => ok ? "✓" : "✗";

    private static string FormatTargetVisibleCount(int count) => count >= 750 ? "750+（单次列举已达上限）" : count.ToString("N0");

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1_000_000_000) return $"{bytes / 1_000_000_000d:0.00} GB";
        if (bytes >= 1_000_000) return $"{bytes / 1_000_000d:0.0} MB";
        if (bytes >= 1_000) return $"{bytes / 1_000d:0.0} KB";
        return $"{bytes} B";
    }
}
