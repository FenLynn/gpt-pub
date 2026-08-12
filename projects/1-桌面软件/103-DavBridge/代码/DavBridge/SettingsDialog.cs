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
    private readonly CheckBox _autoStart = new() { Text = "Windows 登录后自动启动" };
    private readonly CheckBox _startMinimized = new() { Text = "启动后默认进入托盘" };
    private readonly CheckBox _autoResume = new() { Text = "网络恢复和新周期后自动继续" };
    private readonly CheckBox _sprint = new() { Text = "重置前 24 小时启用周期末冲刺" };

    public DavBridgeConfig Config { get; private set; }
    public string SourcePassword => _sourcePassword.Text;
    public string TargetPassword => _targetPassword.Text;

    public SettingsDialog(DavBridgeConfig original, string sourcePassword, string targetPassword)
    {
        _original = CloneConfig(original);
        Config = CloneConfig(original);
        Text = "DavBridge 设置";
        Width = 720;
        Height = 735;
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 9F);

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

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(18), AutoScroll = true };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 205));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        AddFull(panel, new Label
        {
            Text = "InfiniCLOUD 请填写 My Page → Apps Connection 中的 WebDAV Connection URL、Connection ID / User ID 和 Apps Password。已保存密码会按真实长度显示为 *，右侧眼睛可临时显示明文。",
            AutoSize = true,
            MaximumSize = new Size(640, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 0, 0, 8)
        });
        AddField(panel, "InfiniCLOUD WebDAV URL", _sourceUrl);
        AddField(panel, "源目录", _sourceRoot);
        AddField(panel, "Connection ID / User ID", _sourceUser);
        AddPasswordField(panel, "Apps Password", _sourcePassword);

        AddFull(panel, new Label
        {
            Text = "坚果云 WebDAV 用户名填写账号注册邮箱，密码填写单独生成的第三方应用密码，不是网页登录密码。已保存密码同样保留真实长度，便于人工核对。",
            AutoSize = true,
            MaximumSize = new Size(640, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 12, 0, 8)
        });
        AddField(panel, "坚果云 WebDAV URL", _targetUrl);
        AddField(panel, "目标目录", _targetRoot);
        AddField(panel, "坚果云注册邮箱", _targetUser);
        AddPasswordField(panel, "第三方应用密码（非登录密码）", _targetPassword);
        AddField(panel, "上传限速 KB/s", _speed);
        AddField(panel, "普通预留 MB", _reserve);
        AddField(panel, "冲刺预留 MB", _sprintReserve);
        AddFull(panel, _autoStart);
        AddFull(panel, _startMinimized);
        AddFull(panel, _autoResume);
        AddFull(panel, _sprint);

        AddFull(panel, new Label
        {
            Text = "已有迁移记录后，当前任务的源/目标 URL、根目录和用户名会被视为任务身份。需要迁移到另一套端点时应创建新任务，而不是改写当前任务。密码、限速和配额参数仍可正常调整。",
            AutoSize = true,
            MaximumSize = new Size(640, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 10, 0, 4)
        });

        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, AutoSize = true };
        var save = new Button { Text = "保存", AutoSize = true };
        var cancel = new Button { Text = "取消", DialogResult = DialogResult.Cancel, AutoSize = true };
        save.Click += (_, _) =>
        {
            if (!Apply()) return;
            DialogResult = DialogResult.OK;
            Close();
        };
        buttons.Controls.Add(save);
        buttons.Controls.Add(cancel);
        AddFull(panel, buttons);

        Controls.Add(panel);
        AcceptButton = save;
        CancelButton = cancel;
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
                "当前任务已经有迁移和强校验记录。为避免把旧任务记录复用到另一套源端或目标端，v0.2 不允许直接修改当前任务的端点身份。\n\n" +
                "如果以后要从坚果云迁到其他位置，请创建新的 Zotero 迁移任务。当前页面仍可修改密码、上传限速、预留额度和后台运行选项。",
                "请创建新任务", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
            // If state cannot be inspected, prefer safety and treat the legacy task as locked.
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
            TabStop = false
        };
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
        control.Margin = new Padding(0, 6, 0, 6);
        panel.Controls.Add(control, 0, row);
        panel.SetColumnSpan(control, 2);
    }
}
