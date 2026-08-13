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

    public DavBridgeConfig Config { get; private set; }
    public string SourcePassword => _sourcePassword.Text;
    public string TargetPassword => _targetPassword.Text;

    public SettingsDialog(DavBridgeConfig original, string sourcePassword, string targetPassword)
    {
        _original = CloneConfig(original);
        Config = CloneConfig(original);
        _endpointLocked = HasExistingTransferRecords();

        Text = "DavBridge 设置";
        Icon = AppBranding.CreateIcon();
        Width = 840;
        Height = 620;
        MinimumSize = new Size(720, 520);
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 9F);
        BackColor = Color.White;

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

        if (_endpointLocked)
        {
            foreach (var box in new[] { _sourceUrl, _sourceRoot, _sourceUser, _targetUrl, _targetRoot, _targetUser })
            {
                box.ReadOnly = true;
                box.BackColor = Color.FromArgb(247, 248, 250);
            }
        }

        var save = CreateFooterButton("保存");
        var cancel = CreateFooterButton("取消");
        cancel.DialogResult = DialogResult.Cancel;
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
            Height = 34,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            TabStop = true
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(205, 208, 214);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(247, 249, 251);
        return button;
    }

    private Control BuildShell(Button save, Button cancel)
    {
        var shell = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2 };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 180));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));

        var nav = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(247, 248, 250),
            Padding = new Padding(14, 18, 12, 14)
        };
        var navStack = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false
        };
        navStack.Controls.Add(new Label
        {
            Text = "设置",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 15F),
            Margin = new Padding(8, 0, 0, 14)
        });
        nav.Controls.Add(navStack);
        shell.Controls.Add(nav, 0, 0);
        shell.SetRowSpan(nav, 2);

        var hostPanel = new Panel
        {
            Dock = DockStyle.Fill,
            AutoScroll = true,
            BackColor = Color.White,
            Padding = new Padding(26, 22, 26, 16)
        };
        shell.Controls.Add(hostPanel, 1, 0);

        var categories = new[]
        {
            ("账户与端点", BuildAccountPanel()),
            ("流量与限速", BuildQuotaPanel()),
            ("后台运行", BuildBackgroundPanel()),
            ("安全与维护", BuildSafetyPanel())
        };

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
                button.BackColor = active ? Color.FromArgb(234, 243, 251) : Color.FromArgb(247, 248, 250);
                button.ForeColor = active ? Color.FromArgb(42, 104, 163) : Color.FromArgb(35, 35, 35);
            }
        }

        foreach (var (name, panel) in categories)
        {
            var button = new Button
            {
                Text = name,
                Width = 148,
                Height = 40,
                FlatStyle = FlatStyle.Flat,
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(10, 0, 0, 0),
                Margin = new Padding(0, 0, 0, 4),
                BackColor = Color.FromArgb(247, 248, 250),
                UseVisualStyleBackColor = false,
                TabStop = false
            };
            button.FlatAppearance.BorderSize = 0;
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(239, 244, 248);
            button.FlatAppearance.MouseDownBackColor = Color.FromArgb(229, 238, 247);
            button.Click += (_, _) => SelectCategory(panel, button);
            navButtons.Add(button);
            navStack.Controls.Add(button);
        }

        var footer = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            Padding = new Padding(20, 10, 26, 10)
        };
        var footerButtons = new FlowLayoutPanel
        {
            Dock = DockStyle.Right,
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false
        };
        cancel.Margin = new Padding(8, 0, 0, 0);
        save.Margin = new Padding(8, 0, 0, 0);
        footerButtons.Controls.Add(cancel);
        footerButtons.Controls.Add(save);
        footer.Controls.Add(footerButtons);
        shell.Controls.Add(footer, 1, 1);

        SelectCategory(categories[0].Item2, navButtons[0]);
        return shell;
    }

    private Control BuildAccountPanel()
    {
        var table = CategoryTable("账户与端点");
        AddHint(table, _endpointLocked
            ? "当前任务已经有迁移记录，端点身份已锁定。密码仍可更新；若以后迁移到另一套端点，应创建新的迁移任务。"
            : "配置当前 Zotero 迁移任务的源端与目标端。密码仅保存在本机受保护存储中。");

        AddSubTitle(table, "InfiniCLOUD");
        AddField(table, "WebDAV URL", _sourceUrl);
        AddField(table, "源目录", _sourceRoot);
        AddField(table, "Connection ID / User ID", _sourceUser);
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
        AddHint(table, "当前周期已用量与重置日期由主页显示；人工校准入口位于“安全与维护”。");
        return WrapCategory(table);
    }

    private Control BuildBackgroundPanel()
    {
        var table = CategoryTable("后台运行");
        AddFull(table, _autoStart);
        AddFull(table, _startMinimized);
        AddFull(table, _autoResume);
        AddHint(table, "主窗口关闭后任务继续在托盘运行；只有托盘菜单“退出”才结束 DavBridge 进程。");
        return WrapCategory(table);
    }

    private Control BuildSafetyPanel()
    {
        var table = CategoryTable("安全与维护");
        AddHint(table, "诊断和初始化工具属于低频维护入口。已经通过的安全验证不会要求日常重复执行。");
        AddSubTitle(table, "维护工具");

        var buttons = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            WrapContents = true,
            Margin = new Padding(0, 4, 0, 0)
        };

        var main = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
        var host = main is null ? null : UiCommandBridge.GetHost(main);
        var firstPassed = host is not null && FirstGroupValidationRunner.HasCompletedZoteroValidation(host.State);
        var existingPassed = host?.State.ExistingReplicaValidationPassed == true;

        buttons.Controls.Add(MaintenanceButton("连接诊断", "DiagnoseConnectionsAsync", true));
        buttons.Controls.Add(MaintenanceButton("就绪扫描", "ScanAsync", true));
        buttons.Controls.Add(MaintenanceButton("校准流量", "CalibrateAsync", true));
        buttons.Controls.Add(MaintenanceButton(firstPassed ? "首组验证  已通过" : "首组验证", "ValidateFirstGroupAsync", !firstPassed));
        buttons.Controls.Add(MaintenanceButton(existingPassed ? "既有副本验证  已通过" : "既有副本验证", "ValidateExistingReplicaAsync", !existingPassed));
        AddFull(table, buttons);
        return WrapCategory(table);
    }

    private Button MaintenanceButton(string text, string methodName, bool enabled)
    {
        var button = new Button
        {
            Text = text,
            Width = text.Length > 8 ? 146 : 110,
            Height = 34,
            Enabled = enabled,
            Margin = new Padding(0, 0, 8, 8),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            TabStop = false
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(205, 208, 214);
        button.Click += (_, _) =>
        {
            var main = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
            if (main is null) return;
            DialogResult = DialogResult.Cancel;
            Close();
            main.BeginInvoke(new Action(() =>
            {
                var task = UiCommandBridge.InvokeTask(main, methodName);
                if (task is not null) _ = task;
            }));
        };
        return button;
    }

    private static TableLayoutPanel CategoryTable(string title)
    {
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        var heading = new Label
        {
            Text = title,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 15F),
            Margin = new Padding(0, 0, 0, 16)
        };
        var row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(heading, 0, row);
        table.SetColumnSpan(heading, 2);
        return table;
    }

    private static Control WrapCategory(TableLayoutPanel table)
    {
        var panel = new Panel { Dock = DockStyle.Top, AutoSize = true, BackColor = Color.White };
        panel.Controls.Add(table);
        return panel;
    }

    private static void AddSubTitle(TableLayoutPanel table, string text)
    {
        var label = new Label
        {
            Text = text,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 10.5F),
            Margin = new Padding(0, 12, 0, 6)
        };
        AddFull(table, label);
    }

    private static void AddHint(TableLayoutPanel table, string text)
    {
        var label = new Label
        {
            Text = text,
            AutoSize = true,
            ForeColor = Color.DimGray,
            MaximumSize = new Size(560, 0),
            Margin = new Padding(0, 0, 0, 10)
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
                "当前任务已经有迁移和强校验记录。为避免把旧任务记录复用到另一套源端或目标端，不允许直接修改当前任务的端点身份。",
                "端点身份已锁定", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
        catch
        {
            return true;
        }
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

    private static void AddField(TableLayoutPanel panel, string label, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 8, 7) }, 0, row);
        control.Dock = DockStyle.Top;
        control.Margin = new Padding(0, 4, 0, 4);
        panel.Controls.Add(control, 1, row);
    }

    private static void AddPasswordField(TableLayoutPanel panel, string label, TextBox textBox)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 8, 7) }, 0, row);

        var holder = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true, Margin = new Padding(0, 2, 0, 2) };
        holder.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        holder.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 42));
        textBox.Dock = DockStyle.Top;
        textBox.Margin = new Padding(0, 2, 6, 2);
        var eye = new Button
        {
            Text = "👁",
            Width = 36,
            Height = textBox.PreferredHeight + 4,
            Margin = new Padding(0),
            AccessibleName = "显示或隐藏密码",
            TabStop = false,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White
        };
        eye.FlatAppearance.BorderColor = Color.FromArgb(205, 208, 214);
        eye.Click += (_, _) =>
        {
            var selectionStart = textBox.SelectionStart;
            var selectionLength = textBox.SelectionLength;
            textBox.PasswordChar = textBox.PasswordChar == '\0' ? '*' : '\0';
            eye.Text = textBox.PasswordChar == '\0' ? "◉" : "👁";
            textBox.Focus();
            textBox.Select(Math.Min(selectionStart, textBox.TextLength), Math.Min(selectionLength, Math.Max(0, textBox.TextLength - selectionStart)));
        };
        holder.Controls.Add(textBox, 0, 0);
        holder.Controls.Add(eye, 1, 0);
        panel.Controls.Add(holder, 1, row);
    }

    private static void AddFull(TableLayoutPanel panel, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        control.Margin = control.Margin == Padding.Empty ? new Padding(0, 6, 0, 6) : control.Margin;
        if (control is CheckBox checkBox)
        {
            checkBox.AutoSize = true;
            checkBox.MaximumSize = new Size(560, 0);
            checkBox.Dock = DockStyle.Top;
        }
        panel.Controls.Add(control, 0, row);
        panel.SetColumnSpan(control, 2);
    }
}
