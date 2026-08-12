using DavBridge.Core;

namespace DavBridge;

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
    public string? SourcePassword => NormalizeNewSecret(_sourcePassword.Text);
    public string? TargetPassword => NormalizeNewSecret(_targetPassword.Text);

    public SettingsDialog(DavBridgeConfig original, bool sourcePasswordSaved, bool targetPasswordSaved)
    {
        Config = CloneConfig(original);
        Text = "DavBridge 设置";
        Width = 700;
        Height = 735;
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 9F);

        _sourceUrl.Text = Config.SourceBaseUrl;
        _sourceRoot.Text = Config.SourceRootPath;
        _sourceUser.Text = Config.SourceUsername;
        _targetUrl.Text = Config.TargetBaseUrl;
        _targetRoot.Text = Config.TargetRootPath;
        _targetUser.Text = Config.TargetUsername;
        _sourcePassword.PlaceholderText = sourcePasswordSaved ? "已保存，留空则沿用原密码" : "请输入 Apps Password";
        _targetPassword.PlaceholderText = targetPasswordSaved ? "已保存，留空则沿用原密码" : "请输入第三方应用密码";
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
            Text = "InfiniCLOUD 请填写 My Page → Apps Connection 中的 WebDAV Connection URL、Connection ID / User ID 和 Apps Password。密码框留空时沿用已加密保存的旧值，重新输入则覆盖。",
            AutoSize = true,
            MaximumSize = new Size(620, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 0, 0, 8)
        });
        AddField(panel, "InfiniCLOUD WebDAV URL", _sourceUrl);
        AddField(panel, "源目录", _sourceRoot);
        AddField(panel, "Connection ID / User ID", _sourceUser);
        AddField(panel, "Apps Password", _sourcePassword);
        AddPasswordState(panel, "InfiniCLOUD 密码状态", sourcePasswordSaved);

        AddFull(panel, new Label
        {
            Text = "坚果云 WebDAV 用户名应填写账号注册邮箱，密码应填写单独生成的第三方应用密码，不是坚果云登录密码。若当前出现 401，建议重新输入或生成一个专用于 DavBridge 的新应用密码覆盖旧值。",
            AutoSize = true,
            MaximumSize = new Size(620, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 12, 0, 8)
        });
        AddField(panel, "坚果云 WebDAV URL", _targetUrl);
        AddField(panel, "目标目录", _targetRoot);
        AddField(panel, "坚果云注册邮箱", _targetUser);
        AddField(panel, "第三方应用密码（非登录密码）", _targetPassword);
        AddPasswordState(panel, "坚果云密码状态", targetPasswordSaved);
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

    private static string? NormalizeNewSecret(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;
        return text.Trim();
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

    private static void AddPasswordState(TableLayoutPanel panel, string label, bool saved)
    {
        AddField(panel, label, new Label
        {
            Text = saved ? "已加密保存，留空不会清除" : "尚未保存",
            AutoSize = true,
            ForeColor = saved ? Color.DarkGreen : Color.DarkRed
        });
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
