using DavBridge.Core;

namespace DavBridge;

internal sealed class MainForm : Form
{
    private readonly AppHost _host;
    private readonly bool _launchInBackground;
    private readonly CancellationTokenSource _appCts = new();
    private readonly NotifyIcon _trayIcon;

    private readonly TableLayoutPanel _shell = new();
    private readonly Panel _advancedPanel = new();
    private readonly Label _taskStatus = new() { AutoSize = true };
    private readonly Label _routeValue = new() { AutoSize = true };
    private readonly Label _stateValue = new() { AutoSize = true };
    private readonly Label _stateDetail = new() { AutoSize = true, MaximumSize = new Size(560, 0) };
    private readonly Label _quotaValue = new() { AutoSize = true, MaximumSize = new Size(560, 0) };
    private readonly Label _resetValue = new() { AutoSize = true };
    private readonly Label _filesValue = new() { AutoSize = true, MaximumSize = new Size(560, 0) };
    private readonly Label _currentValue = new() { AutoSize = true, MaximumSize = new Size(560, 0) };
    private readonly ProgressBar _quotaBar = new() { Maximum = 1000, Dock = DockStyle.Top, Height = 10 };
    private readonly Button _primaryAction = new() { AutoSize = true, MinimumSize = new Size(92, 34) };
    private readonly Button _taskButton = new()
    {
        Text = "Zotero 附件迁移\r\nInfiniCLOUD → 坚果云",
        TextAlign = ContentAlignment.MiddleLeft,
        Height = 62,
        Dock = DockStyle.Top,
        FlatStyle = FlatStyle.Flat,
        Margin = new Padding(0, 0, 0, 8)
    };

    private bool _exitRequested;
    private bool _advancedVisible;
    private EngineState? _lastNotifiedState;

    public MainForm(AppHost host, bool launchInBackground)
    {
        _host = host;
        _launchInBackground = launchInBackground;
        var appVersion = typeof(MainForm).Assembly.GetName().Version;
        Text = appVersion is null
            ? "DavBridge"
            : $"DavBridge v{appVersion.Major}.{appVersion.Minor}.{appVersion.Build}";
        Width = 880;
        Height = 560;
        MinimumSize = new Size(650, 440);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.White;

        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("打开 DavBridge", null, (_, _) => ShowWindow());
        trayMenu.Items.Add("继续", null, async (_, _) => await ResumeNowAsync());
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
        Resize += (_, _) => ApplyResponsiveLayout();
        FormClosing += OnFormClosing;
        Shown += OnShownAsync;
        _host.ProgressChanged += OnProgressChanged;
        _host.StateChanged += (_, _) => SafeUi(() => UpdateView());
    }

    private Control BuildLayout()
    {
        _shell.Dock = DockStyle.Fill;
        _shell.ColumnCount = 2;
        _shell.RowCount = 1;
        _shell.Padding = new Padding(0);
        _shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 220));
        _shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        _shell.Controls.Add(BuildSidebar(), 0, 0);
        _shell.Controls.Add(BuildTaskView(), 1, 0);
        return _shell;
    }

    private Control BuildSidebar()
    {
        var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(18, 18, 14, 18), BackColor = Color.FromArgb(247, 247, 247) };
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4 };
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        stack.Controls.Add(new Label
        {
            Text = "DavBridge",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 15F),
            Margin = new Padding(0, 0, 0, 16)
        }, 0, 0);

        _taskButton.FlatAppearance.BorderSize = 1;
        _taskButton.Click += (_, _) => { };
        stack.Controls.Add(_taskButton, 0, 1);

        var taskMeta = new Label
        {
            Text = "当前固定任务\r\nv0.2 将支持更多单向迁移、备份与镜像任务",
            AutoSize = true,
            ForeColor = Color.DimGray,
            MaximumSize = new Size(180, 0),
            Margin = new Padding(2, 10, 0, 0)
        };
        stack.Controls.Add(taskMeta, 0, 2);

        var newTask = new Button
        {
            Text = "+ 新建任务",
            Dock = DockStyle.Bottom,
            Height = 34,
            Enabled = false
        };
        new ToolTip().SetToolTip(newTask, "通用任务模型已经建立，当前候选先保持 v0.1.7 任务兼容，后续开放任务创建。 ");
        stack.Controls.Add(newTask, 0, 3);

        panel.Controls.Add(stack);
        return panel;
    }

    private Control BuildTaskView()
    {
        var outer = new Panel { Dock = DockStyle.Fill, AutoScroll = true, Padding = new Padding(26, 22, 26, 20), BackColor = Color.White };
        var root = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, RowCount = 8 };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var titleStack = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Dock = DockStyle.Top };
        titleStack.Controls.Add(new Label
        {
            Text = "Zotero 附件迁移",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 16F),
            Margin = new Padding(0)
        });
        _routeValue.ForeColor = Color.DimGray;
        _routeValue.Margin = new Padding(0, 5, 0, 0);
        titleStack.Controls.Add(_routeValue);
        header.Controls.Add(titleStack, 0, 0);

        _taskStatus.Font = new Font("Segoe UI Semibold", 10F);
        _taskStatus.Padding = new Padding(10, 5, 10, 5);
        _taskStatus.Margin = new Padding(12, 2, 0, 0);
        header.Controls.Add(_taskStatus, 1, 0);
        root.Controls.Add(header, 0, 0);

        var stateCard = new Panel { Dock = DockStyle.Top, Height = 86, Margin = new Padding(0, 22, 0, 16), Padding = new Padding(14), BackColor = Color.FromArgb(248, 248, 248) };
        _stateValue.Font = new Font("Segoe UI Semibold", 12F);
        _stateValue.Location = new Point(14, 13);
        _stateDetail.Location = new Point(14, 43);
        _stateDetail.ForeColor = Color.DimGray;
        stateCard.Controls.Add(_stateValue);
        stateCard.Controls.Add(_stateDetail);
        root.Controls.Add(stateCard, 0, 1);

        var overview = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 0, 0, 12) };
        overview.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 110));
        overview.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddRow(overview, "总体进度", _filesValue);
        AddRow(overview, "当前周期", _quotaValue);
        AddRow(overview, string.Empty, _quotaBar);
        AddRow(overview, "流量重置", _resetValue);
        AddRow(overview, "当前活动", _currentValue);
        root.Controls.Add(overview, 0, 2);

        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, WrapContents = true, Margin = new Padding(0, 8, 0, 8) };
        _primaryAction.Padding = new Padding(12, 3, 12, 3);
        _primaryAction.Click += async (_, _) =>
        {
            if (_host.Config.MigrationEnabled && _host.State.EngineState != EngineState.Paused)
                await PauseAsync();
            else
                await ResumeNowAsync();
        };
        actions.Controls.Add(_primaryAction);
        actions.Controls.Add(ActionButton("设置", async (_, _) => await EditSettingsAsync()));
        actions.Controls.Add(ActionButton("初始化与诊断", (_, _) => ToggleAdvanced()));
        root.Controls.Add(actions, 0, 3);

        _advancedPanel.Dock = DockStyle.Top;
        _advancedPanel.AutoSize = true;
        _advancedPanel.Visible = false;
        _advancedPanel.Margin = new Padding(0, 12, 0, 0);
        _advancedPanel.Padding = new Padding(14);
        _advancedPanel.BackColor = Color.FromArgb(248, 248, 248);
        _advancedPanel.Controls.Add(BuildAdvancedTools());
        root.Controls.Add(_advancedPanel, 0, 4);

        root.Controls.Add(new Label
        {
            Text = "关闭主窗口只会隐藏到托盘。任务初始化完成后，日常暂停和继续不会重复执行整套扫描与确认。",
            AutoSize = true,
            ForeColor = Color.DimGray,
            MaximumSize = new Size(620, 0),
            Margin = new Padding(0, 18, 0, 0)
        }, 0, 5);

        outer.Controls.Add(root);
        return outer;
    }

    private Control BuildAdvancedTools()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        root.Controls.Add(new Label
        {
            Text = "初始化与诊断",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 10F),
            Margin = new Padding(0, 0, 0, 8)
        });
        root.Controls.Add(new Label
        {
            Text = "首次任务按顺序完成连接诊断、就绪扫描、流量校准、首组验证和既有副本验证。已通过的任务无需日常重复。",
            AutoSize = true,
            ForeColor = Color.DimGray,
            MaximumSize = new Size(560, 0),
            Margin = new Padding(0, 0, 0, 10)
        });
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true };
        buttons.Controls.Add(ActionButton("连接诊断", async (_, _) => await DiagnoseConnectionsAsync()));
        buttons.Controls.Add(ActionButton("就绪扫描", async (_, _) => await ScanAsync()));
        buttons.Controls.Add(ActionButton("校准流量", async (_, _) => await CalibrateAsync()));
        buttons.Controls.Add(ActionButton("首组验证", async (_, _) => await ValidateFirstGroupAsync()));
        buttons.Controls.Add(ActionButton("既有副本验证", async (_, _) => await ValidateExistingReplicaAsync()));
        root.Controls.Add(buttons);
        return root;
    }

    private void ApplyResponsiveLayout()
    {
        if (_shell.ColumnStyles.Count == 0) return;
        _shell.ColumnStyles[0].Width = ClientSize.Width < 760 ? 150 : 220;
        _taskButton.Text = ClientSize.Width < 760
            ? "Zotero 迁移\r\n当前任务"
            : "Zotero 附件迁移\r\nInfiniCLOUD → 坚果云";
    }

    private void ToggleAdvanced(bool? visible = null)
    {
        _advancedVisible = visible ?? !_advancedVisible;
        _advancedPanel.Visible = _advancedVisible;
    }

    private async void OnShownAsync(object? sender, EventArgs e)
    {
        try
        {
            await _host.InitializeAsync(_appCts.Token);
            UpdateView();
            ApplyResponsiveLayout();
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
            ToggleAdvanced(true);
            MessageBox.Show(this,
                "当前任务还没有完成首次真实强校验。请在“初始化与诊断”中完成流量校准和首组验证。",
                "需要初始化", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        if (!_host.State.ExistingReplicaValidationPassed)
        {
            ToggleAdvanced(true);
            MessageBox.Show(this,
                "当前任务还没有完成既有副本 NO-WRITE 验证。完成这一安全门后，日常继续将直接恢复，不再重复弹出整套确认流程。",
                "需要初始化", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // Both real-service safety gates have already passed. Daily resume must be direct and quiet.
        // Re-running readiness scans and repeating the long-term activation confirmation on every resume
        // creates friction without adding safety for an unchanged task.
        await _host.ResumeAsync(_appCts.Token);
        try
        {
            await _host.RunOnceAsync(_appCts.Token);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "DavBridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
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
                text += "\n\n若坚果云为 401，请在设置中确认用户名为注册邮箱，并重新输入当前有效的第三方应用密码。不要使用网页登录密码。";

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
                        ? "本次目录列举已达到 750 项上限，实际目标文件可能更多；迁移按准确文件路径逐个确认，不依赖列表完整性"
                        : "既有目标文件后续将逐个强校验并安全接管一致文件";
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
                ex.Message + "\n\n请先使用连接诊断分别确认源端、目标 WebDAV 根目录和目标 zotero 目录。",
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
            MessageBox.Show(this, "请先暂停任务，再执行首组验证。", "首组验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_host.Config.NextResetAt == default)
        {
            MessageBox.Show(this, "流量尚未校准。请先录入坚果云网页当前显示的上传已用、下载已用和下一次重置日期。", "首组验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (FirstGroupValidationRunner.HasCompletedZoteroValidation(_host.State))
        {
            MessageBox.Show(this, "已经存在完整 zip + prop 逻辑组的真实强校验记录，无需重复首组验证。", "首组验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        try
        {
            UseWaitCursor = true;
            var plan = await FirstGroupValidationRunner.PrepareAsync(_host, _appCts.Token);
            var members = string.Join(Environment.NewLine, plan.Members.Select(member => $"  {member.RelativePath}  {FormatBytes(member.ContentLength ?? 0)}"));
            var confirm = MessageBox.Show(this,
                $"DavBridge 将只验证下面这一个 Zotero 逻辑组，完成后立即停止。\n\n" +
                $"组：{plan.GroupKey}\n{members}\n\n" +
                $"组总量：{FormatBytes(plan.TotalBytes)}\n" +
                $"坚果云已存在成员：{plan.ExistingTargetMembers} / {plan.Members.Count}\n" +
                $"本次最多需要上传：{FormatBytes(plan.MaximumUploadBytes)}\n" +
                $"预计坚果云强校验下载：约 {FormatBytes(plan.ExpectedTargetVerificationDownloadBytes)}\n\n" +
                "已有副本会先下载并比较 SHA-256，只有目标缺失时才会上传。确认开始吗？",
                "首组验证计划", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;

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
                $"本次计入坚果云校验下载：{FormatBytes(result.DownloadBytes)}\n\n{mode}\n{result.Message}",
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

    private async Task ValidateExistingReplicaAsync()
    {
        if (!await EnsureConfiguredAsync()) return;
        if (_host.Config.MigrationEnabled)
        {
            MessageBox.Show(this, "请先暂停任务，再执行既有副本验证。", "既有副本验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (!FirstGroupValidationRunner.HasCompletedZoteroValidation(_host.State))
        {
            MessageBox.Show(this, "请先完成一次真实首组验证。", "既有副本验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_host.State.ExistingReplicaValidationPassed)
        {
            MessageBox.Show(this, "既有副本 NO-WRITE 接管验证已经通过，无需重复执行。", "既有副本验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        try
        {
            UseWaitCursor = true;
            var plan = await ExistingReplicaValidationRunner.PrepareAsync(_host, _appCts.Token);
            var members = string.Join(Environment.NewLine, plan.Members.Select(member => $"  {member.RelativePath}  {FormatBytes(member.ContentLength ?? 0)}"));
            var confirm = MessageBox.Show(this,
                $"DavBridge 已选出一个两个成员都已存在的完整 Zotero 组。\n\n" +
                $"组：{plan.GroupKey}\n{members}\n\n" +
                $"组总量：{FormatBytes(plan.TotalBytes)}\n" +
                $"坚果云本次可见文件：{FormatTargetVisibleCount(plan.VisibleTargetObjects)}\n" +
                $"预计坚果云校验下载：约 {FormatBytes(plan.TotalBytes)}\n" +
                "本次上传上限：严格 0 B\n\n" +
                "此测试启用代码级 NO-WRITE 保护。若目标缺失或内容不一致，只会停止或报冲突，绝不会上传覆盖。确认开始吗？",
                "既有副本验证计划", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;

            var progress = new Progress<EngineProgress>(value => UpdateView(value));
            var result = await ExistingReplicaValidationRunner.ExecuteAsync(_host, plan.GroupKey, progress, _appCts.Token);
            UpdateView();

            var memberStates = string.Join(Environment.NewLine,
                result.Records.Select(record => $"  {record.RelativePath}: {record.Status}"));
            MessageBox.Show(this,
                $"组：{result.GroupKey}\n结果：{(result.Success ? "通过" : "未通过")}\n\n{memberStates}\n\n" +
                $"本次计入上传：{FormatBytes(result.UploadBytes)}\n" +
                $"本次计入坚果云校验下载：{FormatBytes(result.DownloadBytes)}\n\n{result.Message}",
                "既有副本验证结果", MessageBoxButtons.OK,
                result.Success ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "既有副本验证失败", MessageBoxButtons.OK, MessageBoxIcon.Warning);
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
        var projection = LegacyV017Adapter.Project(_host.Config);
        var sourceName = string.IsNullOrWhiteSpace(_host.Config.SourceBaseUrl) ? "源端未配置" : "InfiniCLOUD";
        var targetName = string.IsNullOrWhiteSpace(_host.Config.TargetBaseUrl) ? "目标端未配置" : "坚果云";
        _routeValue.Text = $"{sourceName} → {targetName}  ·  Zotero 固定任务";

        var state = !_host.Config.MigrationEnabled
            ? EngineState.Paused
            : progress?.State ?? _host.State.EngineState;
        var (stateTitle, stateDetail) = DescribeState(state, progress);
        _stateValue.Text = stateTitle;
        _stateDetail.Text = stateDetail;
        _taskStatus.Text = stateTitle;

        var initialized = FirstGroupValidationRunner.HasCompletedZoteroValidation(_host.State) &&
                          _host.State.ExistingReplicaValidationPassed;
        _primaryAction.Text = state == EngineState.Running ? "暂停" : "继续";
        _taskButton.Text = ClientSize.Width < 760
            ? $"Zotero 迁移\r\n{stateTitle}"
            : $"Zotero 附件迁移\r\n{stateTitle}";

        var quota = progress?.Quota ?? QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        _quotaValue.Text =
            $"上传 {FormatBytes(quota.EstimatedUploadUsedBytes)} / {FormatBytes(_host.Config.UploadQuotaBytes)}    " +
            $"下载 {FormatBytes(quota.EstimatedDownloadUsedBytes)} / {FormatBytes(_host.Config.DownloadQuotaBytes)}    " +
            $"预留 {FormatBytes(quota.ReservedBytes)}{(quota.IsSprint ? "，周期末冲刺" : string.Empty)}";
        var uploadRatio = _host.Config.UploadQuotaBytes <= 0 ? 0d : (double)quota.EstimatedUploadUsedBytes / _host.Config.UploadQuotaBytes;
        var downloadRatio = _host.Config.DownloadQuotaBytes <= 0 ? 0d : (double)quota.EstimatedDownloadUsedBytes / _host.Config.DownloadQuotaBytes;
        _quotaBar.Value = Math.Clamp((int)Math.Round(Math.Max(uploadRatio, downloadRatio) * 1000), 0, 1000);
        _resetValue.Text = _host.Config.NextResetAt == default
            ? "未校准"
            : $"{ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt):yyyy-MM-dd}，当日 09:00 后探测上传";

        var verified = _host.State.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified);
        var errors = _host.State.Files.Values.Count(x => x.Status is TransferStatus.Failed or TransferStatus.Conflict or TransferStatus.BlockedOversize);
        var initText = initialized ? "初始化完成" : "需要初始化";
        _filesValue.Text = $"已强校验 {verified:N0}    异常 {errors:N0}    记录 {_host.State.Files.Count:N0}    {initText}";

        if (progress is not null)
        {
            _currentValue.Text = string.IsNullOrWhiteSpace(progress.RelativePath)
                ? progress.Message
                : $"{progress.RelativePath}\r\n{HumanizeProgress(progress.Message)}";
        }
        else if (state == EngineState.Paused && !string.IsNullOrWhiteSpace(_host.State.CurrentGroupKey))
        {
            _currentValue.Text = $"暂停断点：{_host.State.CurrentGroupKey}";
        }
        else
        {
            _currentValue.Text = state switch
            {
                EngineState.Paused => "等待继续",
                EngineState.Complete => "当前源清单已完成强校验",
                _ => _host.State.CurrentGroupKey ?? "等待"
            };
        }

        _ = projection;
    }

    private static (string Title, string Detail) DescribeState(EngineState state, EngineProgress? progress)
    {
        return state switch
        {
            EngineState.Running => ("正在迁移", HumanizeProgress(progress?.Message) ?? "任务正在后台运行"),
            EngineState.Paused => ("已暂停", "进度和流量账本已保存，点击继续可直接恢复"),
            EngineState.WaitNetwork => ("等待网络", "网络恢复后可自动继续"),
            EngineState.WaitQuota => ("等待下一周期", "当前安全额度不足，将按周期规则继续"),
            EngineState.WaitRetry => ("需要处理", HumanizeProgress(progress?.Message) ?? "任务遇到异常，已安全停止"),
            EngineState.Complete => ("已完成", "当前源清单已在目标端完成强 SHA-256 校验"),
            _ => (state.ToString(), HumanizeProgress(progress?.Message) ?? string.Empty)
        };
    }

    private static string? HumanizeProgress(string? message)
    {
        if (string.IsNullOrWhiteSpace(message)) return null;
        if (message.Contains("Downloading source", StringComparison.OrdinalIgnoreCase)) return "正在读取源文件并计算 SHA-256";
        if (message.Contains("Target already exists", StringComparison.OrdinalIgnoreCase)) return "正在校验目标端已有副本";
        if (message.Contains("Uploading target", StringComparison.OrdinalIgnoreCase)) return "正在上传目标文件";
        if (message.Contains("Re-downloading target", StringComparison.OrdinalIgnoreCase)) return "正在重新读取目标文件并做强校验";
        if (message.Contains("strongly verified", StringComparison.OrdinalIgnoreCase)) return "目标文件已通过强校验";
        return message;
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
        panel.Controls.Add(new Label
        {
            Text = label,
            AutoSize = true,
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 7, 12, 7)
        }, 0, row);
        control.Margin = new Padding(0, 7, 0, 7);
        control.Dock = control is ProgressBar ? DockStyle.Top : DockStyle.Fill;
        panel.Controls.Add(control, 1, row);
    }

    private static Button ActionButton(string text, EventHandler onClick)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = true,
            Padding = new Padding(10, 3, 10, 3),
            Margin = new Padding(0, 0, 8, 6),
            MinimumSize = new Size(0, 32)
        };
        button.Click += onClick;
        return button;
    }

    private static string StatusMark(bool ok) => ok ? "✓" : "✗";

    private static string FormatTargetVisibleCount(int count) =>
        count >= 750 ? "750+（单次列举已达上限）" : count.ToString("N0");

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1_000_000_000) return $"{bytes / 1_000_000_000d:0.00} GB";
        if (bytes >= 1_000_000) return $"{bytes / 1_000_000d:0.0} MB";
        if (bytes >= 1_000) return $"{bytes / 1_000d:0.0} KB";
        return $"{bytes} B";
    }
}
