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
    public string? SourcePassword => string.IsNullOrEmpty(_sourcePassword.Text) ? null : _sourcePassword.Text;
    public string? TargetPassword => string.IsNullOrEmpty(_targetPassword.Text) ? null : _targetPassword.Text;

    public SettingsDialog(DavBridgeConfig original)
    {
        Config = CloneConfig(original);
        Text = "DavBridge 设置";
        Width = 700;
        Height = 720;
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 9F);

        _sourceUrl.Text = Config.SourceBaseUrl;
        _sourceRoot.Text = Config.SourceRootPath;
        _sourceUser.Text = Config.SourceUsername;
        _targetUrl.Text = Config.TargetBaseUrl;
        _targetRoot.Text = Config.TargetRootPath;
        _targetUser.Text = Config.TargetUsername;
        _speed.Value = Math.Clamp(Config.UploadLimitBytesPerSecond / 1000, (int)_speed.Minimum, (int)_speed.Maximum);
        _reserve.Value = Math.Clamp((decimal)Config.NormalReserveBytes / 1_000_000m, _reserve.Minimum, _reserve.Maximum);
        _sprintReserve.Value = Math.Clamp((decimal)Config.SprintReserveBytes / 1_000_000m, _sprintReserve.Minimum, _sprintReserve.Maximum);
        _autoStart.Checked = Config.AutoStartWithWindows;
        _startMinimized.Checked = Config.StartMinimized;
        _autoResume.Checked = Config.AutoResume;
        _sprint.Checked = Config.EndOfCycleSprintEnabled;

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(18), AutoScroll = true };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        AddFull(panel, new Label
        {
            Text = "InfiniCLOUD 必须填写 My Page → Apps Connection 中显示的 WebDAV Connection URL、Connection ID 和 Apps Password。2026 年网页登录已改用邮箱，但 WebDAV 仍不是邮箱登录密码。",
            AutoSize = true,
            MaximumSize = new Size(620, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 0, 0, 8)
        });
        AddField(panel, "InfiniCLOUD WebDAV URL", _sourceUrl);
        AddField(panel, "源目录", _sourceRoot);
        AddField(panel, "Connection ID / User ID", _sourceUser);
        AddField(panel, "Apps Password", _sourcePassword);

        AddFull(panel, new Label
        {
            Text = "坚果云请填写 WebDAV 地址、坚果云账号和第三方应用密码。密码留空保存时会继续使用当前已加密保存的密码。",
            AutoSize = true,
            MaximumSize = new Size(620, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 12, 0, 8)
        });
        AddField(panel, "坚果云 WebDAV URL", _targetUrl);
        AddField(panel, "目标目录", _targetRoot);
        AddField(panel, "坚果云账号", _targetUser);
        AddField(panel, "第三方应用密码", _targetPassword);
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

    private static void AddFull(TableLayoutPanel panel, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        control.Margin = new Padding(0, 6, 0, 6);
        panel.Controls.Add(control, 0, row);
        panel.SetColumnSpan(control, 2);
    }
}
