using DavBridge.Core;

namespace DavBridge;

internal sealed class SettingsDialog : Form
{
    private readonly DavBridgeConfig _original;
    private readonly TextBox _sourceUrl = new();
    private readonly TextBox _sourceRoot = new();
    private readonly TextBox _sourceUser = new();
    private readonly TextBox _sourcePassword = new() { PasswordChar = '*' };
    private readonly TextBox _targetUrl = new();
    private readonly TextBox _targetRoot = new();
    private readonly TextBox _targetUser = new();
    private readonly TextBox _targetPassword = new() { PasswordChar = '*' };
    private readonly NumericUpDown _speed = new() { Minimum = 10, Maximum = 10_000, Increment = 50 };
    private readonly NumericUpDown _reserve = new() { Minimum = 0, Maximum = 500, Increment = 5 };
    private readonly NumericUpDown _sprintReserve = new() { Minimum = 0, Maximum = 100, Increment = 1 };
    private readonly CheckBox _autoStart = new() { Text = "Windows 登录后自动启动", AutoSize = true };
    private readonly CheckBox _startMinimized = new() { Text = "启动后默认进入托盘", AutoSize = true };
    private readonly CheckBox _autoResume = new() { Text = "网络恢复和新周期后自动继续", AutoSize = true };
    private readonly CheckBox _sprint = new() { Text = "重置前 24 小时启用周期末冲刺", AutoSize = true };
    private readonly bool _endpointLocked;
    private readonly bool _embedded;
    private readonly ToolTip _tips = new()
    {
        AutoPopDelay = 12000,
        InitialDelay = 500,
        ReshowDelay = 500,
        ShowAlways = true
    };

    public DavBridgeConfig Config { get; private set; }
    public string SourcePassword => _sourcePassword.Text;
    public string TargetPassword => _targetPassword.Text;

    public SettingsDialog(DavBridgeConfig original, string sourcePassword, string targetPassword, bool embedded = false)
    {
        _original = CloneConfig(original);
        Config = CloneConfig(original);
        _endpointLocked = HasExistingTransferRecords();
        _embedded = embedded;

        Text = "DavBridge 设置";
        Icon = AppBranding.CreateIcon();
        Width = 840;
        Height = 620;
        MinimumSize = new Size(720, 520);
        StartPosition = FormStartPosition.CenterParent;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 10F);
        BackColor = Color.FromArgb(248, 251, 254);
        if (embedded) FormBorderStyle = FormBorderStyle.None;

        foreach (var box in new[] { _sourceUrl, _sourceRoot, _sourceUser, _sourcePassword, _targetUrl, _targetRoot, _targetUser, _targetPassword })
        {
            box.Font = new Font("Segoe UI", 10F);
            box.BorderStyle = BorderStyle.None;
            box.BackColor = Color.FromArgb(243, 248, 251);
            box.ForeColor = Color.FromArgb(31, 47, 67);
        }
        foreach (var number in new[] { _speed, _reserve, _sprintReserve })
        {
            number.Font = new Font("Segoe UI", 10F);
            number.BorderStyle = BorderStyle.None;
            number.BackColor = Color.FromArgb(243, 248, 251);
            number.ForeColor = Color.FromArgb(31, 47, 67);
        }
        foreach (var check in new[] { _autoStart, _startMinimized, _autoResume, _sprint })
        {
            check.Font = new Font("Segoe UI", 10F);
            check.ForeColor = Color.FromArgb(50, 70, 90);
            check.BackColor = Color.Transparent;
        }

        _sourceUrl.Text = Config.SourceBaseUrl;
        _sourceRoot.Text = Config.SourceRootPath;
        _sourceUser.Text = Config.SourceUsername;
        _sourcePassword.Text = sourcePassword;
        _targetUrl.Text = Config.TargetBaseUrl;
        _targetRoot.Text = Config.TargetRootPath;
        _targetUser.Text = Config.TargetUsername;
        _targetPassword.Text = targetPassword;
        _speed.Value = Math.Clamp(Config.UploadLimitBytesPerSecond / 1000, (int)_speed.Minimum, (int)_speed.Maximum);
        _reserve.Value = Math.Clamp((decimal)Config.NormalReserveBytes / 1_000_000m, _reserve.Minimum, _reserve.Maximum);
        _sprintReserve.Value = Math.Clamp((decimal)Config.SprintReserveBytes / 1_000_000m, _sprintReserve.Minimum, _sprintReserve.Maximum);
        _autoStart.Checked = Config.AutoStartWithWindows;
        _startMinimized.Checked = Config.StartMinimized;
        _autoResume.Checked = Config.AutoResume;
        _sprint.Checked = Config.EndOfCycleSprintEnabled;

        var save = CreateFooterButton("保存");
        var cancel = CreateFooterButton("取消");
        cancel.DialogResult = DialogResult.Cancel;
        if (_embedded) cancel.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };
        save.Click += (_, _) =>
        {
            if (!Apply()) return;
            DialogResult = DialogResult.OK;
            Close();
        };

        Controls.Add(BuildShell(save, cancel));
        AcceptButton = save;
        CancelButton = cancel;
    }

    private static Button CreateFooterButton(string text)
    {
        var button = new Button
        {
            Text = text,
            Width = 88,
            Height = 30,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(245, 250, 253),
            ForeColor = Color.FromArgb(45, 68, 88),
            Font = new Font("Segoe UI Semibold", 9.5F),
            TabStop = true
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(228, 242, 251);
        if (text == "保存")
        {
            button.BackColor = Color.FromArgb(225, 241, 252);
            button.ForeColor = Color.FromArgb(24, 118, 185);
        }
        return button;
    }

    private Control BuildShell(Button save, Button cancel)
    {
        var background = Color.FromArgb(248, 251, 254);
        var shell = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            BackColor = background,
            Padding = new Padding(_embedded ? 30 : 26, _embedded ? 14 : 16, _embedded ? 34 : 26, 0)
        };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 2));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));

        var categories = new[]
        {
            ("账户与端点", BuildAccountPanel(), _endpointLocked
                ? "字段现在可以正常点击和编辑。已有迁移记录时，保存阶段仍会阻止 URL、目录或 User ID 改成另一套端点；密码可以正常更新。"
                : "配置当前 Zotero 迁移任务的源端与目标端。密码仅保存在本机受保护存储中。"),
            ("流量与限速", BuildQuotaPanel(), "设置上传限速和安全预留，并在这里校准坚果云当前周期上传、下载已用量与下一次重置日期。"),
            ("后台运行", BuildBackgroundPanel(), "主窗口关闭后任务继续在托盘运行；只有托盘菜单“退出”才结束 DavBridge 进程。"),
            ("数据与迁移", BuildDataPanel(), "所有持久数据位置、备份和恢复都集中在这里。持久数据目录可以手动迁移，本机缓存目录保持固定。"),
            ("安全与维护", BuildSafetyPanel(), "这里仅保留低频维护与安全检查。已经通过的验证会标记为绿色状态，日常迁移不会重复要求。")
        };

        var tabs = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            AutoScroll = false,
            BackColor = background,
            Margin = Padding.Empty,
            Padding = new Padding(0, 0, 0, 6)
        };

        var hostPanel = new Panel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            BackColor = background,
            Padding = new Padding(2, 10, 8, 6),
            Margin = Padding.Empty
        };
        shell.Controls.Add(tabs, 0, 1);
        shell.Controls.Add(hostPanel, 0, 2);

        var navButtons = new List<Button>();
        void SelectCategory(Control panel, Button selected)
        {
            hostPanel.SuspendLayout();
            hostPanel.Controls.Clear();
            hostPanel.Controls.Add(panel);
            panel.Dock = DockStyle.Top;
            hostPanel.ResumeLayout(true);

            foreach (var button in navButtons)
            {
                var active = ReferenceEquals(button, selected);
                button.BackColor = active ? Color.FromArgb(225, 241, 252) : background;
                button.ForeColor = active ? Color.FromArgb(20, 124, 199) : Color.FromArgb(91, 111, 132);
                button.Font = new Font("Segoe UI Semibold", active ? 10F : 9.5F);
            }
        }

        foreach (var (name, panel, hint) in categories)
        {
            var button = new Button
            {
                Text = name,
                AutoSize = false,
                Width = name == "安全与维护" ? 110 : 102,
                Height = 34,
                FlatStyle = FlatStyle.Flat,
                TextAlign = ContentAlignment.MiddleCenter,
                Margin = new Padding(0, 0, 6, 0),
                BackColor = background,
                ForeColor = Color.FromArgb(91, 111, 132),
                UseVisualStyleBackColor = false,
                TabStop = false,
                Font = new Font("Segoe UI Semibold", 9.5F)
            };
            button.FlatAppearance.BorderSize = 0;
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(235, 246, 253);
            button.FlatAppearance.MouseDownBackColor = Color.FromArgb(224, 240, 251);
            button.Click += (_, _) => SelectCategory(panel, button);
            _tips.SetToolTip(button, hint);
            navButtons.Add(button);
            tabs.Controls.Add(button);
        }

        var footer = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = background,
            Padding = new Padding(0, 8, 0, 8),
            Margin = Padding.Empty
        };
        var footerButtons = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            BackColor = background
        };
        cancel.Margin = new Padding(8, 0, 0, 0);
        save.Margin = new Padding(8, 0, 0, 0);
        footerButtons.Controls.Add(cancel);
        footerButtons.Controls.Add(save);
        footer.Controls.Add(footerButtons);
        shell.Controls.Add(footer, 0, 3);

        SelectCategory(categories[0].Item2, navButtons[0]);
        return shell;
    }

    private Control BuildAccountPanel()
    {
        var table = CategoryTable("账户与端点");

        AddSubTitle(table, "InfiniCLOUD");
        AddField(table, "WebDAV URL", _sourceUrl);
        AddField(table, "源目录", _sourceRoot);
        AddField(table, "User ID", _sourceUser);
        AddPasswordField(table, "Apps Password", _sourcePassword);

        AddSubTitle(table, "坚果云");
        AddField(table, "WebDAV URL", _targetUrl);
        AddField(table, "目标目录", _targetRoot);
        AddField(table, "注册邮箱", _targetUser);
        AddPasswordField(table, "第三方应用密码", _targetPassword);
        return WrapCategory(table);
    }

    private Control BuildQuotaPanel()
    {
        var table = CategoryTable("流量与限速");
        AddField(table, "上传限速 KB/s", _speed);
        AddField(table, "普通预留 MB", _reserve);
        AddField(table, "冲刺预留 MB", _sprintReserve);
        AddFull(table, _sprint);

        var main = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
        var host = main is null ? null : UiCommandBridge.GetHost(main);
        var calibrated = host?.Config.NextResetAt != default;
        var detail = calibrated && host is not null
            ? $"当前人工基线：上传 {host.Config.CalibrationUploadUsedBytes / 1_000_000d:0.0} MB，下载 {host.Config.CalibrationDownloadUsedBytes / 1_000_000d:0.0} MB；下一次重置日期 {ResetSchedulePolicy.NormalizeResetDate(host.Config.NextResetAt):yyyy-MM-dd}。"
            : "录入坚果云网页当前显示的上传已用、下载已用以及下一次流量重置日期。";
        AddFull(table, MaintenanceRow(
            "本周期流量校准",
            detail,
            "CalibrateAsync",
            calibrated ? "✓ 已校准" : "未校准",
            calibrated,
            calibrated ? "重新校准" : "校准"));
        return WrapCategory(table);
    }

    private Control BuildBackgroundPanel()
    {
        var table = CategoryTable("后台运行");
        AddFull(table, _autoStart);
        AddFull(table, _startMinimized);
        AddFull(table, _autoResume);
        return WrapCategory(table);
    }

    private Control BuildDataPanel()
    {
        var paths = AppPaths.Create();
        var overview = DataManagementV050.BuildOverview(paths);
        var content = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            BackColor = Color.FromArgb(248, 251, 254),
            Padding = new Padding(2, 2, 8, 8),
            Margin = Padding.Empty
        };
        content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        content.Controls.Add(BuildDataDirectoryCard(
            "持久数据目录",
            "可修改",
            "配置、迁移账本、对账状态、凭据和备份都从这里读取。这是唯一需要长期记住的数据目录。",
            paths.DataRoot,
            "OpenDataRootAsync",
            "ChangeDataRootAsync"));

        content.Controls.Add(BuildDataDirectoryCard(
            "本机运行目录",
            "固定",
            "保存缓存、临时文件、窗口状态、WebView2 和运行会话。位置固定，不参与 DataRoot 迁移。",
            paths.LocalRoot,
            "OpenLocalDataRootAsync",
            null));

        content.Controls.Add(BuildDataActionCard(
            "备份与恢复",
            overview.LastBackupText,
            string.IsNullOrWhiteSpace(overview.LastBackupPath) ? "尚未创建手动备份" : overview.LastBackupPath,
            ("立即备份", "BackupDataAsync"),
            ("从备份恢复", "RestoreDataAsync")));

        content.Controls.Add(BuildDataInventoryCard(overview));
        return WrapCategory(content);
    }

    private Control BuildDataDirectoryCard(string title, string badge, string description, string path, string openMethod, string? changeMethod)
    {
        var card = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = new Padding(0, 0, 0, 12),
            Padding = new Padding(16, 13, 16, 13),
            BackColor = Color.FromArgb(241, 247, 251)
        };
        card.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        card.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var titlePanel = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Color.Transparent,
            Margin = Padding.Empty
        };
        var titleLabel = new Label
        {
            Text = title,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 11.5F),
            ForeColor = Color.FromArgb(43, 64, 82),
            Margin = new Padding(0, 2, 8, 0)
        };
        var badgeLabel = new Label
        {
            Text = badge,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 9.5F),
            ForeColor = badge == "固定" ? Color.FromArgb(102, 119, 134) : Color.FromArgb(36, 122, 172),
            BackColor = badge == "固定" ? Color.FromArgb(233, 239, 243) : Color.FromArgb(226, 242, 251),
            Padding = new Padding(7, 3, 7, 3),
            Margin = Padding.Empty
        };
        titlePanel.Controls.Add(titleLabel);
        titlePanel.Controls.Add(badgeLabel);
        card.Controls.Add(titlePanel, 0, 0);

        var actions = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Color.Transparent,
            Margin = Padding.Empty
        };
        actions.Controls.Add(CreateDataButton("打开", openMethod, false));
        if (!string.IsNullOrWhiteSpace(changeMethod))
            actions.Controls.Add(CreateDataButton("更改位置", changeMethod, true));
        card.Controls.Add(actions, 1, 0);

        _tips.SetToolTip(titleLabel, description);
        _tips.SetToolTip(badgeLabel, description);
        _tips.SetToolTip(titlePanel, description);

        var pathLabel = new Label
        {
            Text = path,
            AutoSize = true,
            MaximumSize = new Size(700, 0),
            Font = new Font("Segoe UI", 10.5F),
            ForeColor = Color.FromArgb(62, 88, 108),
            BackColor = Color.FromArgb(233, 242, 247),
            Padding = new Padding(10, 7, 10, 7),
            Margin = new Padding(0, 10, 0, 0)
        };
        _tips.SetToolTip(pathLabel, description + Environment.NewLine + path);
        card.Controls.Add(pathLabel, 0, 1);
        card.SetColumnSpan(pathLabel, 2);
        return card;
    }

    private Control BuildDataActionCard(string title, string status, string detail, params (string Text, string Method)[] actions)
    {
        var card = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = new Padding(0, 0, 0, 12),
            Padding = new Padding(16, 12, 16, 12),
            BackColor = Color.FromArgb(244, 249, 252)
        };
        card.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        card.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var copy = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Color.Transparent,
            Margin = Padding.Empty
        };
        var titleLabel = new Label
        {
            Text = title,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 11.5F),
            ForeColor = Color.FromArgb(48, 71, 91),
            Margin = new Padding(0, 5, 10, 0)
        };
        var statusLabel = new Label
        {
            Text = status,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 10F),
            ForeColor = Color.FromArgb(83, 119, 143),
            BackColor = Color.FromArgb(233, 242, 247),
            Padding = new Padding(7, 3, 7, 3),
            Margin = new Padding(0, 2, 0, 0)
        };
        var backupHint = string.IsNullOrWhiteSpace(detail) || detail == "尚未创建手动备份"
            ? "生成带 manifest 与 SHA-256 的关键数据备份；恢复前会先校验并自动保存当前数据快照。"
            : "最近备份：" + detail + Environment.NewLine + "生成和恢复都会执行 manifest 与 SHA-256 校验。";
        _tips.SetToolTip(titleLabel, backupHint);
        _tips.SetToolTip(statusLabel, backupHint);
        _tips.SetToolTip(copy, backupHint);
        copy.Controls.Add(titleLabel);
        copy.Controls.Add(statusLabel);
        card.Controls.Add(copy, 0, 0);

        var actionPanel = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            BackColor = Color.Transparent,
            Margin = Padding.Empty
        };
        foreach (var item in actions)
            actionPanel.Controls.Add(CreateDataButton(item.Text, item.Method, item.Text == "立即备份"));
        card.Controls.Add(actionPanel, 1, 0);
        return card;
    }

    private Control BuildDataInventoryCard(DataOverviewV050 overview)
    {
        var card = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = new Padding(0, 0, 0, 4),
            Padding = new Padding(16, 12, 16, 12),
            BackColor = Color.FromArgb(244, 249, 252)
        };
        card.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        card.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var label = new Label
        {
            Text = "文件与目录清单    " + overview.Files.Count + " 项",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 11.3F),
            ForeColor = Color.FromArgb(48, 71, 91),
            Margin = new Padding(0, 5, 0, 0)
        };
        _tips.SetToolTip(label, "查看每个受管理文件与目录的类别、状态、完整路径、用途和备份策略。");
        card.Controls.Add(label, 0, 0);

        var view = new Button
        {
            Text = "查看全部",
            AutoSize = false,
            Width = 82,
            Height = 34,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(235, 246, 253),
            ForeColor = Color.FromArgb(36, 101, 148),
            Font = new Font("Segoe UI Semibold", 10F),
            Margin = new Padding(8, 2, 0, 2),
            TabStop = false
        };
        view.FlatAppearance.BorderSize = 0;
        view.Click += (_, _) =>
        {
            using var dialog = new DataInventoryDialogV052(overview);
            dialog.ShowDialog(this);
        };
        card.Controls.Add(view, 1, 0);
        return card;
    }

    private Button CreateDataButton(string text, string methodName, bool primary)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = false,
            Width = text.Length >= 4 ? 88 : 62,
            Height = 34,
            FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Color.FromArgb(225, 241, 252) : Color.FromArgb(239, 247, 251),
            ForeColor = Color.FromArgb(31, 112, 162),
            Font = new Font("Segoe UI Semibold", 10F),
            Margin = new Padding(6, 0, 0, 0),
            TabStop = false
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(218, 238, 250);
        var keepSettingsOpen = methodName is "OpenDataRootAsync" or "OpenLocalDataRootAsync";
        button.Click += (_, _) => InvokeDataMaintenance(methodName, keepSettingsOpen);
        return button;
    }

    private void InvokeDataMaintenance(string methodName, bool keepSettingsOpen)
    {
        var mainForm = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
        if (mainForm is null) return;

        if (keepSettingsOpen)
        {
            var task = UiCommandBridge.InvokeTask(mainForm, methodName);
            if (task is not null) _ = task;
            return;
        }

        DialogResult = DialogResult.Cancel;
        Close();
        mainForm.BeginInvoke(new Action(() =>
        {
            var task = UiCommandBridge.InvokeTask(mainForm, methodName);
            if (task is not null) _ = task;
        }));
    }

    private Control BuildSafetyPanel()
    {
        var table = CategoryTable("安全与维护");

        var main = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
        var host = main is null ? null : UiCommandBridge.GetHost(main);
        var firstPassed = host is not null && FirstGroupValidationRunner.HasCompletedZoteroValidation(host.State);
        var existingPassed = host?.State.ExistingReplicaValidationPassed == true;
        var steps = ProductExperienceV044.BuildInitializationSteps(host);
        if (steps.Any(step => !step.Done))
            AddFull(table, BuildInitializationRail(steps));

        var health = ProductExperienceV044.Health;
        var list = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            Margin = Padding.Empty,
            BackColor = Color.FromArgb(248, 251, 254)
        };
        list.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        list.Controls.Add(MaintenanceRow("运行环境自检", "检查 .NET 8、WebView2、Data 目录读写以及 config/state/reconcile 的可恢复性。", "RunStartupHealthCheckAsync", health.Status == "not_checked" ? "待检查" : health.Status == "ok" ? "✓ 正常" : "需注意", health.Status == "ok", "检查"));
        list.Controls.Add(MaintenanceRow("连接诊断", "检查源端、坚果云根目录和 Zotero 目标目录是否可访问。", "DiagnoseConnectionsAsync", ProductExperienceV044.ConnectionDiagnosticPassed ? "✓ 已通过" : "可执行", ProductExperienceV044.ConnectionDiagnosticPassed));
        list.Controls.Add(MaintenanceRow("迁移就绪扫描", "重新读取源清单并检查文件上限、Zotero 配对和迁移条件。", "ScanAsync", ProductExperienceV044.ReadinessScanPassed ? "✓ 已通过" : "可执行", ProductExperienceV044.ReadinessScanPassed));
        list.Controls.Add(MaintenanceRow("首组验证", "真实迁移一个完整 Zotero 组并执行目标回读与 SHA-256 强校验。", "ValidateFirstGroupAsync", firstPassed ? "✓ 已通过" : "未执行", firstPassed));
        list.Controls.Add(MaintenanceRow("既有副本验证", "确认 GoodSync 等既有副本可在零上传条件下安全接管。", "ValidateExistingReplicaAsync", existingPassed ? "✓ 已通过" : "未执行", existingPassed));
        list.Controls.Add(MaintenanceRow("导出诊断信息", "生成脱敏 ZIP，仅包含版本、运行环境、状态、额度、自检和最近活动，不包含密码、WebDAV 凭据、真实文件名或私人目录。", "ExportDiagnosticsAsync", "脱敏 ZIP", false, "导出"));
        AddFull(table, list);
        return WrapCategory(table);
    }

    private Control BuildInitializationRail(IReadOnlyList<InitializationStepV044> steps)
    {
        var rail = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Margin = new Padding(0, 0, 0, 8),
            Padding = new Padding(0, 1, 0, 2),
            BackColor = Color.FromArgb(248, 251, 254)
        };
        foreach (var step in steps)
        {
            var label = new Label
            {
                Text = (step.Done ? "✓ " : "○ ") + step.Label,
                AutoSize = true,
                Font = new Font("Segoe UI Semibold", 9F),
                ForeColor = step.Done ? Color.FromArgb(38, 145, 87) : Color.FromArgb(104, 123, 141),
                BackColor = step.Done ? Color.FromArgb(235, 248, 241) : Color.FromArgb(240, 245, 248),
                Padding = new Padding(8, 5, 8, 5),
                Margin = new Padding(0, 0, 6, 0),
                Cursor = Cursors.Help
            };
            _tips.SetToolTip(label, step.Hint);
            rail.Controls.Add(label);
        }
        return rail;
    }

    private Control MaintenanceRow(string title, string description, string methodName, string status, bool passed, string? actionText = null)
    {
        var row = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 3,
            Margin = new Padding(0, 0, 0, 2),
            Padding = new Padding(0, 3, 0, 3),
            BackColor = Color.FromArgb(248, 251, 254)
        };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 90));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 84));

        var titleLabel = new Label
        {
            Text = title,
            AutoSize = false,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            Font = new Font("Segoe UI Semibold", 9.5F),
            ForeColor = Color.FromArgb(38, 55, 72),
            Cursor = Cursors.Help,
            Margin = new Padding(10, 0, 0, 0)
        };
        _tips.SetToolTip(titleLabel, description);
        row.Controls.Add(titleLabel, 0, 0);

        var statusLabel = new Label
        {
            Text = status,
            AutoSize = false,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font("Segoe UI Semibold", 9F),
            ForeColor = passed ? Color.FromArgb(38, 145, 87) : Color.FromArgb(91, 124, 151),
            Margin = Padding.Empty
        };
        row.Controls.Add(statusLabel, 1, 0);

        var action = new Button
        {
            Text = actionText ?? (passed ? "重新验证" : (methodName == "CalibrateAsync" ? "校准" : "执行")),
            Dock = DockStyle.Fill,
            Height = 34,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(235, 246, 253),
            ForeColor = Color.FromArgb(36, 101, 148),
            Font = new Font("Segoe UI Semibold", 9F),
            Margin = new Padding(5, 2, 4, 2),
            TabStop = false
        };
        action.FlatAppearance.BorderSize = 0;
        action.FlatAppearance.MouseOverBackColor = Color.FromArgb(222, 239, 250);
        action.Click += (_, _) =>
        {
            var mainForm = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
            if (mainForm is null) return;
            DialogResult = DialogResult.Cancel;
            Close();
            mainForm.BeginInvoke(new Action(() =>
            {
                var task = UiCommandBridge.InvokeTask(mainForm, methodName);
                if (task is not null) _ = task;
            }));
        };
        row.Controls.Add(action, 2, 0);
        return row;
    }

    private static TableLayoutPanel CategoryTable(string title)
    {
        var table = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            BackColor = Color.FromArgb(248, 251, 254),
            Padding = Padding.Empty
        };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 170));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        return table;
    }

    private static Control WrapCategory(TableLayoutPanel table)
    {
        var panel = new Panel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            BackColor = Color.FromArgb(248, 251, 254),
            Padding = Padding.Empty,
            Margin = Padding.Empty
        };
        panel.Controls.Add(table);
        return panel;
    }

    private static void AddSubTitle(TableLayoutPanel table, string text)
    {
        var label = new Label
        {
            Text = text,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 11.5F),
            ForeColor = Color.FromArgb(36, 55, 75),
            Margin = new Padding(0, 8, 0, 4)
        };
        AddFull(table, label);
    }

    private bool Apply()
    {
        var proposed = CloneConfig(Config);
        proposed.SourceBaseUrl = _sourceUrl.Text.Trim();
        proposed.SourceRootPath = _sourceRoot.Text.Trim().Trim('/');
        proposed.SourceUsername = _sourceUser.Text.Trim();
        proposed.TargetBaseUrl = _targetUrl.Text.Trim();
        proposed.TargetRootPath = _targetRoot.Text.Trim().Trim('/');
        proposed.TargetUsername = _targetUser.Text.Trim();
        proposed.UploadLimitBytesPerSecond = (int)_speed.Value * 1000;
        proposed.NormalReserveBytes = (long)_reserve.Value * 1_000_000L;
        proposed.SprintReserveBytes = (long)_sprintReserve.Value * 1_000_000L;
        proposed.AutoStartWithWindows = _autoStart.Checked;
        proposed.StartMinimized = _startMinimized.Checked;
        proposed.AutoResume = _autoResume.Checked;
        proposed.EndOfCycleSprintEnabled = _sprint.Checked;

        if (HasExistingTransferRecords() && EndpointIdentityChanged(_original, proposed))
        {
            MessageBox.Show(this,
                "账户与端点字段可以正常编辑，但当前任务已经有迁移和强校验记录。为避免把旧账本误用于另一套端点，URL、目录或 User ID 的身份变化不能在当前任务中直接保存。应用密码仍可正常更新。",
                "当前任务的端点身份受保护", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return false;
        }

        Config = proposed;
        return true;
    }

    private static bool EndpointIdentityChanged(DavBridgeConfig before, DavBridgeConfig after)
    {
        return !string.Equals(Normalize(before.SourceBaseUrl), Normalize(after.SourceBaseUrl), StringComparison.OrdinalIgnoreCase) ||
               !string.Equals(NormalizePath(before.SourceRootPath), NormalizePath(after.SourceRootPath), StringComparison.OrdinalIgnoreCase) ||
               !string.Equals(Normalize(before.SourceUsername), Normalize(after.SourceUsername), StringComparison.OrdinalIgnoreCase) ||
               !string.Equals(Normalize(before.TargetBaseUrl), Normalize(after.TargetBaseUrl), StringComparison.OrdinalIgnoreCase) ||
               !string.Equals(NormalizePath(before.TargetRootPath), NormalizePath(after.TargetRootPath), StringComparison.OrdinalIgnoreCase) ||
               !string.Equals(Normalize(before.TargetUsername), Normalize(after.TargetUsername), StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasExistingTransferRecords()
    {
        try
        {
            var paths = AppPaths.Create();
            if (!File.Exists(paths.StatePath)) return false;
            var store = new StateStore(paths.StatePath);
            var state = store.LoadAsync().GetAwaiter().GetResult();
            return state.Files.Count > 0;
        }
        catch { return true; }
    }

    private static string Normalize(string? value) => (value ?? string.Empty).Trim();
    private static string NormalizePath(string? value) => (value ?? string.Empty).Trim().Trim('/');

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
        MigrationEnabled = x.MigrationEnabled,
        AutoStartWithWindows = x.AutoStartWithWindows,
        StartMinimized = x.StartMinimized,
        AutoResume = x.AutoResume,
        EndOfCycleSprintEnabled = x.EndOfCycleSprintEnabled
    };

    private static int PreferredFieldWidth(string label, Control control)
    {
        if (control is NumericUpDown) return 176;
        if (control is TextBox) return 430;
        return 360;
    }

    private static Label FieldLabel(string text) => new()
    {
        Text = text,
        AutoSize = true,
        Font = new Font("Segoe UI", 9.5F),
        ForeColor = Color.FromArgb(78, 96, 115),
        Margin = new Padding(0, 7, 10, 5)
    };

    private static void PrepareFieldControl(Control control)
    {
        if (control is TextBox textBox)
        {
            textBox.BorderStyle = BorderStyle.None;
            textBox.BackColor = Color.FromArgb(243, 248, 251);
        }
        else if (control is NumericUpDown number)
        {
            number.BorderStyle = BorderStyle.None;
            number.BackColor = Color.FromArgb(243, 248, 251);
        }
    }

    private static SoftFieldPanel CreateFieldSurface(Control control, int width)
    {
        PrepareFieldControl(control);
        var surface = new SoftFieldPanel(width, 32)
        {
            Margin = new Padding(0, 2, 0, 4)
        };
        control.Dock = DockStyle.Fill;
        control.Margin = Padding.Empty;
        surface.Controls.Add(control);
        return surface;
    }

    private static void AddField(TableLayoutPanel panel, string label, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(FieldLabel(label), 0, row);
        panel.Controls.Add(CreateFieldSurface(control, PreferredFieldWidth(label, control)), 1, row);
    }

    private static void AddPasswordField(TableLayoutPanel panel, string label, TextBox textBox)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(FieldLabel(label), 0, row);

        var width = PreferredFieldWidth(label, textBox);
        PrepareFieldControl(textBox);
        var surface = new SoftFieldPanel(width, 32)
        {
            Margin = new Padding(0, 2, 0, 4)
        };
        var holder = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
            BackColor = Color.FromArgb(243, 248, 251)
        };
        holder.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        holder.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 34));
        textBox.Dock = DockStyle.Fill;
        textBox.Margin = Padding.Empty;
        var eye = new Button
        {
            Text = "◉",
            Dock = DockStyle.Fill,
            Margin = Padding.Empty,
            AccessibleName = "显示或隐藏密码",
            TabStop = false,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(243, 248, 251),
            ForeColor = Color.FromArgb(101, 120, 138),
            Font = new Font("Segoe UI Symbol", 9F)
        };
        eye.FlatAppearance.BorderSize = 0;
        eye.FlatAppearance.MouseOverBackColor = Color.FromArgb(232, 242, 248);
        eye.Click += (_, _) =>
        {
            var selectionStart = textBox.SelectionStart;
            var selectionLength = textBox.SelectionLength;
            textBox.PasswordChar = textBox.PasswordChar == '\0' ? '*' : '\0';
            eye.Text = textBox.PasswordChar == '\0' ? "◎" : "◉";
            textBox.Focus();
            textBox.Select(Math.Min(selectionStart, textBox.TextLength), Math.Min(selectionLength, Math.Max(0, textBox.TextLength - selectionStart)));
        };
        holder.Controls.Add(textBox, 0, 0);
        holder.Controls.Add(eye, 1, 0);
        surface.Controls.Add(holder);
        panel.Controls.Add(surface, 1, row);
    }

    private sealed class SoftFieldPanel : Panel
    {
        private const int Radius = 10;

        public SoftFieldPanel(int width, int height)
        {
            Width = width;
            Height = height;
            MinimumSize = new Size(width, height);
            MaximumSize = new Size(width, height);
            BackColor = Color.FromArgb(243, 248, 251);
            Padding = new Padding(9, 6, 7, 4);
            DoubleBuffered = true;
            ResizeRedraw = true;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using var path = RoundedRect(rect, Radius);
            using var fill = new SolidBrush(Color.FromArgb(243, 248, 251));
            using var border = new Pen(Color.FromArgb(221, 232, 239), 1F);
            e.Graphics.FillPath(fill, path);
            e.Graphics.DrawPath(border, path);
            base.OnPaint(e);
        }

        private static System.Drawing.Drawing2D.GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            var path = new System.Drawing.Drawing2D.GraphicsPath();
            var diameter = radius * 2;
            var arc = new Rectangle(rect.X, rect.Y, diameter, diameter);
            path.AddArc(arc, 180, 90);
            arc.X = rect.Right - diameter;
            path.AddArc(arc, 270, 90);
            arc.Y = rect.Bottom - diameter;
            path.AddArc(arc, 0, 90);
            arc.X = rect.Left;
            path.AddArc(arc, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    private static void AddFull(TableLayoutPanel panel, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        control.Margin = control.Margin == Padding.Empty ? new Padding(0, 3, 0, 3) : control.Margin;
        if (control is CheckBox checkBox)
        {
            checkBox.AutoSize = true;
            checkBox.MaximumSize = new Size(560, 0);
            checkBox.Dock = DockStyle.Top;
            checkBox.Padding = new Padding(0, 1, 0, 1);
        }
        panel.Controls.Add(control, 0, row);
        panel.SetColumnSpan(control, 2);
    }
}


internal sealed class DataInventoryDialogV052 : Form
{
    private readonly ToolTip _tips = new()
    {
        AutoPopDelay = 12000,
        InitialDelay = 500,
        ReshowDelay = 500,
        ShowAlways = true
    };
    private ListViewItem? _hoveredItem;

    public DataInventoryDialogV052(DataOverviewV050 overview)
    {
        Text = "DavBridge 文件与目录清单";
        Icon = AppBranding.CreateIcon();
        Width = 820;
        Height = 590;
        MinimumSize = new Size(720, 500);
        StartPosition = FormStartPosition.CenterParent;
        BackColor = Color.FromArgb(248, 251, 254);
        Font = new Font("Segoe UI", 10.5F);

        var shell = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 2,
            Padding = new Padding(22, 18, 22, 16),
            BackColor = BackColor
        };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        var head = new Label
        {
            Text = "文件与目录清单",
            Dock = DockStyle.Fill,
            Font = new Font("Segoe UI Semibold", 12F),
            ForeColor = Color.FromArgb(45, 66, 85),
            TextAlign = ContentAlignment.MiddleLeft
        };
        _tips.SetToolTip(head, "这里列出 DavBridge 当前受管理的数据位置、用途和备份策略。");
        shell.Controls.Add(head, 0, 0);

        var list = new ListView
        {
            Dock = DockStyle.Fill,
            View = View.Details,
            FullRowSelect = true,
            GridLines = false,
            HideSelection = false,
            BorderStyle = BorderStyle.None,
            BackColor = Color.FromArgb(244, 249, 252),
            ForeColor = Color.FromArgb(54, 74, 91),
            Font = new Font("Segoe UI", 10.5F)
        };
        list.Columns.Add("名称", 185);
        list.Columns.Add("类别", 120);
        list.Columns.Add("状态", 115);
        list.Columns.Add("备份策略", 250);
        foreach (var file in overview.Files)
        {
            var item = new ListViewItem(file.Label);
            item.SubItems.Add(file.Category);
            item.SubItems.Add(file.Status);
            item.SubItems.Add(file.BackupPolicy);
            item.Tag = file.Path + Environment.NewLine + file.Purpose;
            list.Items.Add(item);
        }
        list.ShowItemToolTips = false;
        list.MouseMove += (_, e) =>
        {
            var item = list.GetItemAt(e.X, e.Y);
            if (ReferenceEquals(item, _hoveredItem)) return;
            _hoveredItem = item;
            _tips.SetToolTip(list, item?.Tag as string);
        };
        list.MouseLeave += (_, _) =>
        {
            _hoveredItem = null;
            _tips.SetToolTip(list, null);
        };
        shell.Controls.Add(list, 0, 1);
        Controls.Add(shell);
    }
}
