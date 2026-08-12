using System.Reflection;
using System.Text.Json;
using DavBridge.Core;

namespace DavBridge;

internal sealed class UiPolish : IDisposable
{
    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 220 };
    private readonly Panel _dashboard = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly TableLayoutPanel _shell = new() { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
    private readonly Panel _sidebar = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(247, 248, 250) };
    private readonly Label _brand = new() { Text = "DavBridge", AutoSize = true, Font = new Font("Segoe UI Semibold", 15F) };
    private readonly Panel _taskCard = new() { Height = 62, Dock = DockStyle.Top, BackColor = Color.White };
    private readonly Label _taskName = new() { Text = "Zotero 附件迁移", AutoSize = true, Font = new Font("Segoe UI Semibold", 9.5F) };
    private readonly Label _taskState = new() { AutoSize = true, ForeColor = Color.DimGray };
    private readonly Button _settingsButton = new() { Text = "⚙  设置", Height = 38, Dock = DockStyle.Bottom, FlatStyle = FlatStyle.Flat };

    private readonly Label _title = new() { Text = "Zotero 附件迁移", AutoSize = true, Font = new Font("Segoe UI Semibold", 17F) };
    private readonly EndpointFlowView _flow = new() { Dock = DockStyle.Top, Height = 112 };

    private readonly Label _overallTitle = SectionTitle("总体进度");
    private readonly Label _overallPercent = new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 10F), Anchor = AnchorStyles.Right };
    private readonly MeterBar _overallBar = new() { Dock = DockStyle.Top, Height = 18 };
    private readonly Label _overallGroups = new() { AutoSize = true };
    private readonly Label _overallFiles = new() { AutoSize = true, ForeColor = Color.DimGray };

    private readonly Label _currentTitle = SectionTitle("当前文件");
    private readonly MeterBar _currentBar = new() { Dock = DockStyle.Top, Height = 26, Pulse = true };
    private readonly Label _currentPhase = new() { AutoSize = true, ForeColor = Color.DimGray };

    private readonly Label _cycleTitle = SectionTitle("当前周期");
    private readonly Label _uploadValue = new() { AutoSize = true, Anchor = AnchorStyles.Right };
    private readonly Label _downloadValue = new() { AutoSize = true, Anchor = AnchorStyles.Right };
    private readonly MeterBar _uploadBar = new() { Dock = DockStyle.Top, Height = 16 };
    private readonly MeterBar _downloadBar = new() { Dock = DockStyle.Top, Height = 16 };
    private readonly Label _resetValue = new() { AutoSize = true, ForeColor = Color.DimGray };

    private readonly LinkLabel _problemLink = new() { AutoSize = true, Visible = false };
    private readonly Button _primary = new() { Width = 118, Height = 38, FlatStyle = FlatStyle.System };

    private bool _preparing;
    private bool _pausing;
    private bool _disposed;
    private bool _manifestRefreshStarted;
    private EngineProgress? _lastProgress;
    private UiManifestCache _cache = new();
    private readonly string _cachePath;

    private UiPolish(MainForm form, AppHost host)
    {
        _form = form;
        _host = host;
        _cachePath = Path.Combine(_host.Paths.RoamingRoot, "ui-cache.json");
        _cache = LoadCache(_cachePath);

        _timer.Tick += (_, _) => Tick();
        _form.Shown += (_, _) => ApplyAll();
        _form.Resize += (_, _) => ApplyResponsiveLayout();
        _host.ProgressChanged += OnProgressChanged;
        _host.StateChanged += OnStateChanged;
        _settingsButton.Click += (_, _) => _ = OpenSettingsAsync();
        _primary.Click += (_, _) => _ = PrimaryActionAsync();
        _problemLink.Click += (_, _) => OpenMaintenance("DiagnoseConnectionsAsync");

        BuildDashboard();
    }

    public static UiPolish Attach(MainForm form, AppHost host)
    {
        var polish = new UiPolish(form, host);
        polish.ApplyAll();
        polish._timer.Start();
        return polish;
    }

    private void BuildDashboard()
    {
        _shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 205));
        _shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        BuildSidebar();
        _shell.Controls.Add(_sidebar, 0, 0);
        _shell.Controls.Add(BuildMainContent(), 1, 0);
        _dashboard.Controls.Add(_shell);
    }

    private void BuildSidebar()
    {
        _sidebar.Padding = new Padding(18, 20, 14, 18);

        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4 };
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        _brand.Margin = new Padding(2, 0, 0, 18);
        stack.Controls.Add(_brand, 0, 0);

        _taskCard.Padding = new Padding(12, 10, 8, 8);
        _taskCard.Margin = new Padding(0);
        var cardStack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, BackColor = Color.Transparent };
        cardStack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        cardStack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _taskName.Margin = new Padding(0, 0, 0, 3);
        cardStack.Controls.Add(_taskName, 0, 0);
        cardStack.Controls.Add(_taskState, 0, 1);
        _taskCard.Controls.Add(cardStack);
        stack.Controls.Add(_taskCard, 0, 1);

        var taskCaption = new Label
        {
            Text = "当前任务",
            AutoSize = true,
            ForeColor = Color.Gray,
            Margin = new Padding(3, 10, 0, 0)
        };
        stack.Controls.Add(taskCaption, 0, 2);

        _settingsButton.FlatAppearance.BorderSize = 0;
        _settingsButton.TextAlign = ContentAlignment.MiddleLeft;
        _settingsButton.Padding = new Padding(8, 0, 0, 0);
        _settingsButton.Margin = new Padding(0);
        stack.Controls.Add(_settingsButton, 0, 3);
        _sidebar.Controls.Add(stack);
    }

    private Control BuildMainContent()
    {
        var outer = new Panel { Dock = DockStyle.Fill, AutoScroll = true, BackColor = Color.White };
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 9,
            Padding = new Padding(32, 26, 32, 28)
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        _title.Margin = new Padding(0, 0, 0, 12);
        root.Controls.Add(_title, 0, 0);
        root.Controls.Add(_flow, 0, 1);
        root.Controls.Add(BuildOverallSection(), 0, 2);
        root.Controls.Add(BuildCurrentSection(), 0, 3);
        root.Controls.Add(BuildCycleSection(), 0, 4);

        _problemLink.Margin = new Padding(0, 12, 0, 4);
        root.Controls.Add(_problemLink, 0, 5);

        var actionHolder = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Margin = new Padding(0, 14, 0, 0)
        };
        actionHolder.Controls.Add(_primary);
        root.Controls.Add(actionHolder, 0, 6);

        outer.Controls.Add(root);
        return outer;
    }

    private Control BuildOverallSection()
    {
        var panel = SectionPanel();
        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.Controls.Add(_overallTitle, 0, 0);
        header.Controls.Add(_overallPercent, 1, 0);
        panel.Controls.Add(header);

        _overallBar.Margin = new Padding(0, 8, 0, 8);
        panel.Controls.Add(_overallBar);
        _overallGroups.Margin = new Padding(0, 4, 0, 2);
        panel.Controls.Add(_overallGroups);
        panel.Controls.Add(_overallFiles);
        return panel;
    }

    private Control BuildCurrentSection()
    {
        var panel = SectionPanel();
        panel.Controls.Add(_currentTitle);
        _currentBar.Margin = new Padding(0, 8, 0, 6);
        panel.Controls.Add(_currentBar);
        panel.Controls.Add(_currentPhase);
        return panel;
    }

    private Control BuildCycleSection()
    {
        var panel = SectionPanel();
        panel.Controls.Add(_cycleTitle);

        var uploadHeader = ValueHeader("上传", _uploadValue);
        uploadHeader.Margin = new Padding(0, 9, 0, 4);
        panel.Controls.Add(uploadHeader);
        panel.Controls.Add(_uploadBar);

        var downloadHeader = ValueHeader("下载", _downloadValue);
        downloadHeader.Margin = new Padding(0, 10, 0, 4);
        panel.Controls.Add(downloadHeader);
        panel.Controls.Add(_downloadBar);

        _resetValue.Margin = new Padding(0, 10, 0, 0);
        panel.Controls.Add(_resetValue);
        return panel;
    }

    private static TableLayoutPanel ValueHeader(string name, Label value)
    {
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        table.Controls.Add(new Label { Text = name, AutoSize = true }, 0, 0);
        table.Controls.Add(value, 1, 0);
        return table;
    }

    private static TableLayoutPanel SectionPanel()
    {
        var panel = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            Margin = new Padding(0, 18, 0, 0),
            Padding = new Padding(0)
        };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        return panel;
    }

    private static Label SectionTitle(string text) => new()
    {
        Text = text,
        AutoSize = true,
        Font = new Font("Segoe UI Semibold", 10.5F)
    };

    private void ApplyAll()
    {
        if (_disposed) return;

        foreach (Control control in _form.Controls)
        {
            if (!ReferenceEquals(control, _dashboard))
                control.Visible = false;
        }

        if (!_form.Controls.Contains(_dashboard))
            _form.Controls.Add(_dashboard);
        _dashboard.BringToFront();

        _form.MinimumSize = new Size(620, 520);
        if (_form.Width < 900) _form.Width = 900;
        if (_form.Height < 650) _form.Height = 650;

        ApplyResponsiveLayout();
        UpdateDashboard();
        StartManifestRefreshIfNeeded();
    }

    private void Tick()
    {
        if (_disposed) return;
        SettingsPolish.TryApplyOpenDialogs();

        if (_preparing && _host.State.EngineState != EngineState.Paused)
            _preparing = false;

        if (_pausing && !_host.IsRunning && !_host.Config.MigrationEnabled)
            _pausing = false;

        _currentBar.AdvancePulse();
        UpdateDashboard();
    }

    private void OnProgressChanged(object? sender, EngineProgress progress)
    {
        _lastProgress = progress;
        SafeUi(UpdateDashboard);
    }

    private void OnStateChanged(object? sender, EventArgs e) => SafeUi(UpdateDashboard);

    private void UpdateDashboard()
    {
        if (_disposed || !_form.IsHandleCreated) return;

        var state = EffectiveState();
        var (statusText, statusKind) = GetStatus(state);
        _flow.UpdateFlow("InfiniCLOUD", "坚果云", statusText, statusKind);
        _taskState.Text = statusText;
        _taskState.ForeColor = StatusColor(statusKind);

        UpdateOverall();
        UpdateCurrent(state);
        UpdateQuota();
        UpdateProblems();
        UpdatePrimary(state);
    }

    private UiEffectiveState EffectiveState()
    {
        if (_pausing) return UiEffectiveState.Pausing;
        if (_preparing) return UiEffectiveState.Preparing;
        if (!_host.Config.MigrationEnabled) return UiEffectiveState.Paused;

        return _host.State.EngineState switch
        {
            EngineState.Running => UiEffectiveState.Running,
            EngineState.WaitNetwork => UiEffectiveState.WaitNetwork,
            EngineState.WaitQuota => UiEffectiveState.WaitQuota,
            EngineState.WaitRetry => UiEffectiveState.WaitRetry,
            EngineState.Complete => UiEffectiveState.Complete,
            _ => UiEffectiveState.Paused
        };
    }

    private static (string Text, UiStatusKind Kind) GetStatus(UiEffectiveState state) => state switch
    {
        UiEffectiveState.Preparing => ("准备中", UiStatusKind.Preparing),
        UiEffectiveState.Pausing => ("正在安全暂停", UiStatusKind.Preparing),
        UiEffectiveState.Running => ("正在迁移", UiStatusKind.Running),
        UiEffectiveState.Paused => ("已暂停", UiStatusKind.Paused),
        UiEffectiveState.WaitNetwork => ("等待网络", UiStatusKind.Network),
        UiEffectiveState.WaitQuota => ("等待新周期", UiStatusKind.Quota),
        UiEffectiveState.WaitRetry => ("需要处理", UiStatusKind.Error),
        UiEffectiveState.Complete => ("已完成", UiStatusKind.Complete),
        _ => ("已暂停", UiStatusKind.Paused)
    };

    private void UpdateOverall()
    {
        var verifiedFiles = _host.State.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified);
        var verifiedGroups = CountVerifiedGroups(_host.State);
        var totalFiles = _cache.TotalFiles;
        var totalGroups = _cache.TotalGroups;

        double fraction = 0;
        if (totalGroups > 0)
            fraction = Math.Clamp((double)verifiedGroups / totalGroups, 0, 1);
        else if (totalFiles > 0)
            fraction = Math.Clamp((double)verifiedFiles / totalFiles, 0, 1);

        _overallBar.Fraction = fraction;
        _overallBar.Pulse = totalGroups <= 0 && _host.Config.MigrationEnabled;
        _overallBar.BarText = string.Empty;
        _overallPercent.Text = totalGroups > 0 ? $"{fraction:P1}" : "读取中";
        _overallGroups.Text = totalGroups > 0
            ? $"{verifiedGroups:N0} / {totalGroups:N0} 组已强校验"
            : $"{verifiedGroups:N0} 组已强校验";
        _overallFiles.Text = totalFiles > 0
            ? $"{verifiedFiles:N0} / {totalFiles:N0} 文件已强校验"
            : $"{verifiedFiles:N0} 文件已强校验";
    }

    private void UpdateCurrent(UiEffectiveState state)
    {
        var relative = _lastProgress?.RelativePath;
        var phase = TranslateRuntimeText(_lastProgress?.Message);

        if (state == UiEffectiveState.Paused && string.IsNullOrWhiteSpace(relative))
        {
            _currentBar.Pulse = false;
            _currentBar.Fraction = 0;
            _currentBar.BarText = string.IsNullOrWhiteSpace(_host.State.CurrentGroupKey)
                ? "等待继续"
                : $"暂停断点  {_host.State.CurrentGroupKey}";
            _currentPhase.Text = string.Empty;
            return;
        }

        if (state == UiEffectiveState.Preparing)
        {
            _currentBar.Pulse = true;
            _currentBar.BarText = "准备任务";
            _currentPhase.Text = "正在读取任务状态和源端清单";
            return;
        }

        if (state == UiEffectiveState.Pausing)
        {
            _currentBar.Pulse = true;
            _currentBar.BarText = string.IsNullOrWhiteSpace(relative) ? "正在安全暂停" : relative;
            _currentPhase.Text = "正在保存当前安全断点";
            return;
        }

        if (state == UiEffectiveState.Complete)
        {
            _currentBar.Pulse = false;
            _currentBar.Fraction = 1;
            _currentBar.BarText = "当前源清单已完成";
            _currentPhase.Text = string.Empty;
            return;
        }

        _currentBar.Pulse = state == UiEffectiveState.Running && !string.IsNullOrWhiteSpace(relative);
        _currentBar.Fraction = 0;
        _currentBar.BarText = string.IsNullOrWhiteSpace(relative)
            ? state switch
            {
                UiEffectiveState.WaitNetwork => "等待网络恢复",
                UiEffectiveState.WaitQuota => "等待下一周期",
                UiEffectiveState.WaitRetry => "任务已安全停止",
                _ => "准备下一个文件"
            }
            : relative;
        _currentPhase.Text = phase ?? state switch
        {
            UiEffectiveState.Running => "正在处理",
            UiEffectiveState.WaitNetwork => "网络恢复后将自动继续",
            UiEffectiveState.WaitQuota => "达到安全额度边界后自动等待",
            UiEffectiveState.WaitRetry => "请查看需要处理的项目",
            _ => string.Empty
        };
    }

    private void UpdateQuota()
    {
        var quota = _lastProgress?.Quota ?? QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        var uploadMax = Math.Max(1, _host.Config.UploadQuotaBytes);
        var downloadMax = Math.Max(1, _host.Config.DownloadQuotaBytes);

        ConfigureQuotaBar(_uploadBar, quota.EstimatedUploadUsedBytes, uploadMax, quota.ReservedBytes);
        ConfigureQuotaBar(_downloadBar, quota.EstimatedDownloadUsedBytes, downloadMax, quota.ReservedBytes);
        _uploadValue.Text = $"{FormatBytes(quota.EstimatedUploadUsedBytes)} / {FormatBytes(uploadMax)}";
        _downloadValue.Text = $"{FormatBytes(quota.EstimatedDownloadUsedBytes)} / {FormatBytes(downloadMax)}";

        if (_host.Config.NextResetAt == default)
        {
            _resetValue.Text = "流量尚未校准";
        }
        else
        {
            var date = ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt);
            _resetValue.Text = $"{date:yyyy-MM-dd} 重置，当日 09:00 后自动探测";
        }
    }

    private static void ConfigureQuotaBar(MeterBar bar, long used, long total, long reserve)
    {
        var totalSafe = Math.Max(1, total - Math.Max(0, reserve));
        var safeRatio = (double)Math.Max(0, used) / totalSafe;
        bar.Fraction = Math.Clamp((double)Math.Max(0, used) / total, 0, 1);
        bar.ReserveFraction = Math.Clamp((double)Math.Max(0, reserve) / total, 0, 0.5);
        bar.Pulse = false;
        bar.FillColor = safeRatio >= 0.9
            ? Color.FromArgb(201, 63, 63)
            : safeRatio >= 0.75
                ? Color.FromArgb(205, 151, 34)
                : Color.FromArgb(34, 146, 92);
    }

    private void UpdateProblems()
    {
        var errors = _host.State.Files.Values.Count(x => x.Status is TransferStatus.Failed or TransferStatus.Conflict or TransferStatus.BlockedOversize or TransferStatus.SourceChanged);
        _problemLink.Visible = errors > 0 || _host.State.EngineState == EngineState.WaitRetry;
        _problemLink.Text = errors > 0 ? $"⚠ {errors:N0} 项需要处理  ›" : "⚠ 任务需要处理  ›";
        _problemLink.LinkColor = Color.FromArgb(184, 52, 52);
    }

    private void UpdatePrimary(UiEffectiveState state)
    {
        _primary.Enabled = state is UiEffectiveState.Running or UiEffectiveState.Paused or UiEffectiveState.Preparing;
        _primary.Text = state switch
        {
            UiEffectiveState.Running => "暂停",
            UiEffectiveState.Paused => "继续",
            UiEffectiveState.Preparing => "暂停",
            UiEffectiveState.Pausing => "正在暂停",
            UiEffectiveState.WaitNetwork => "等待网络",
            UiEffectiveState.WaitQuota => "等待新周期",
            UiEffectiveState.WaitRetry => "需要处理",
            UiEffectiveState.Complete => "已完成",
            _ => "继续"
        };
    }

    private async Task PrimaryActionAsync()
    {
        var state = EffectiveState();
        if (state is UiEffectiveState.Running or UiEffectiveState.Preparing)
        {
            _preparing = false;
            _pausing = true;
            UpdateDashboard();
            await _host.PauseAsync(CancellationToken.None).ConfigureAwait(true);
            var started = DateTime.UtcNow;
            while (_host.IsRunning && DateTime.UtcNow - started < TimeSpan.FromSeconds(8))
                await Task.Delay(80).ConfigureAwait(true);
            _pausing = false;
            UpdateDashboard();
            return;
        }

        if (state != UiEffectiveState.Paused)
            return;

        _preparing = true;
        _lastProgress = null;
        UpdateDashboard();
        var task = UiCommandBridge.InvokeTask(_form, "ResumeNowAsync");
        if (task is null)
        {
            _preparing = false;
            UpdateDashboard();
            return;
        }

        _ = task.ContinueWith(_ => SafeUi(() =>
        {
            if (_host.State.EngineState == EngineState.Paused)
                _preparing = false;
            UpdateDashboard();
        }), TaskScheduler.Default);
    }

    private async Task OpenSettingsAsync()
    {
        if (_preparing || _pausing) return;
        var task = UiCommandBridge.InvokeTask(_form, "EditSettingsAsync");
        if (task is not null)
            await task.ConfigureAwait(true);
    }

    private void OpenMaintenance(string methodName)
    {
        var task = UiCommandBridge.InvokeTask(_form, methodName);
        if (task is not null)
            _ = task;
    }

    private void StartManifestRefreshIfNeeded()
    {
        if (_manifestRefreshStarted || !_host.IsConfigured) return;
        _manifestRefreshStarted = true;

        if (_cache.TotalGroups > 0 && DateTimeOffset.Now - _cache.RefreshedAt < TimeSpan.FromHours(12))
            return;

        _ = RefreshManifestAsync();
    }

    private async Task RefreshManifestAsync()
    {
        try
        {
            await Task.Delay(800).ConfigureAwait(false);
            var report = await _host.ScanReadinessAsync(CancellationToken.None).ConfigureAwait(false);
            _cache = new UiManifestCache
            {
                TotalFiles = report.ObjectCount,
                TotalGroups = report.GroupCount,
                TotalBytes = report.TotalBytes,
                RefreshedAt = DateTimeOffset.Now
            };
            SaveCache(_cachePath, _cache);
            SafeUi(UpdateDashboard);
        }
        catch
        {
            // UI totals are advisory display metadata only. A failed refresh must never affect migration.
        }
    }

    private void ApplyResponsiveLayout()
    {
        if (_shell.ColumnStyles.Count == 0) return;
        var compact = _form.ClientSize.Width < 760;
        _shell.ColumnStyles[0].Width = compact ? 58 : 205;
        _sidebar.Padding = compact ? new Padding(8, 18, 8, 14) : new Padding(18, 20, 14, 18);
        _brand.Text = compact ? "D" : "DavBridge";
        _brand.Font = compact ? new Font("Segoe UI Semibold", 17F) : new Font("Segoe UI Semibold", 15F);
        _taskName.Text = compact ? "Z" : "Zotero 附件迁移";
        _taskState.Visible = !compact;
        _taskCard.Padding = compact ? new Padding(14, 14, 8, 8) : new Padding(12, 10, 8, 8);
        _settingsButton.Text = compact ? "⚙" : "⚙  设置";
        _settingsButton.TextAlign = compact ? ContentAlignment.MiddleCenter : ContentAlignment.MiddleLeft;
        _settingsButton.Padding = compact ? Padding.Empty : new Padding(8, 0, 0, 0);
        _title.Visible = !compact;
    }

    private static int CountVerifiedGroups(MigrationState state)
    {
        var count = 0;
        foreach (var group in state.Files.Values.GroupBy(x => x.GroupKey, StringComparer.OrdinalIgnoreCase))
        {
            var records = group.ToArray();
            var zip = records.FirstOrDefault(x => Path.GetExtension(x.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase));
            var prop = records.FirstOrDefault(x => Path.GetExtension(x.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
            if (zip is not null || prop is not null)
            {
                if (zip?.Status == TransferStatus.StrongVerified && prop?.Status == TransferStatus.StrongVerified)
                    count++;
            }
            else if (records.Length > 0 && records.All(x => x.Status == TransferStatus.StrongVerified))
            {
                count++;
            }
        }
        return count;
    }

    private static string? TranslateRuntimeText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        return text
            .Replace("Strong verification complete.", "目标文件已通过强校验", StringComparison.OrdinalIgnoreCase)
            .Replace("Downloading source and calculating SHA-256.", "正在读取源文件并计算 SHA-256", StringComparison.OrdinalIgnoreCase)
            .Replace("Target already exists; downloading it for safe takeover verification.", "正在校验目标端已有副本", StringComparison.OrdinalIgnoreCase)
            .Replace("Uploading target object.", "正在上传目标文件", StringComparison.OrdinalIgnoreCase)
            .Replace("Re-downloading target for strong SHA-256 verification.", "正在重新读取目标文件并进行强校验", StringComparison.OrdinalIgnoreCase)
            .Replace("Current source manifest is strongly verified at target.", "当前源清单已全部完成强校验", StringComparison.OrdinalIgnoreCase)
            .Replace("At least one source object is not strongly verified at the target.", "仍有源文件尚未在目标端完成强校验", StringComparison.OrdinalIgnoreCase);
    }

    private static Color StatusColor(UiStatusKind kind) => kind switch
    {
        UiStatusKind.Running => Color.FromArgb(31, 137, 86),
        UiStatusKind.Preparing => Color.FromArgb(55, 112, 180),
        UiStatusKind.Quota => Color.FromArgb(195, 142, 33),
        UiStatusKind.Network => Color.FromArgb(216, 120, 35),
        UiStatusKind.Error => Color.FromArgb(190, 55, 55),
        UiStatusKind.Complete => Color.FromArgb(35, 124, 95),
        _ => Color.FromArgb(128, 128, 128)
    };

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1_000_000_000) return $"{bytes / 1_000_000_000d:0.00} GB";
        if (bytes >= 1_000_000) return $"{bytes / 1_000_000d:0.0} MB";
        if (bytes >= 1_000) return $"{bytes / 1_000d:0.0} KB";
        return $"{bytes} B";
    }

    private static UiManifestCache LoadCache(string path)
    {
        try
        {
            if (!File.Exists(path)) return new UiManifestCache();
            return JsonSerializer.Deserialize<UiManifestCache>(File.ReadAllText(path)) ?? new UiManifestCache();
        }
        catch { return new UiManifestCache(); }
    }

    private static void SaveCache(string path, UiManifestCache cache)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = path + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(cache, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temp, path, true);
        }
        catch { }
    }

    private void SafeUi(Action action)
    {
        if (_disposed || _form.IsDisposed) return;
        if (_form.InvokeRequired) _form.BeginInvoke(action); else action();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        _host.ProgressChanged -= OnProgressChanged;
        _host.StateChanged -= OnStateChanged;
    }

    private sealed class UiManifestCache
    {
        public int TotalFiles { get; set; }
        public int TotalGroups { get; set; }
        public long TotalBytes { get; set; }
        public DateTimeOffset RefreshedAt { get; set; }
    }
}

internal static class UiCommandBridge
{
    public static Task? InvokeTask(MainForm form, string methodName)
    {
        try
        {
            var method = typeof(MainForm).GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
            return method?.Invoke(form, null) as Task;
        }
        catch
        {
            return null;
        }
    }

    public static AppHost? GetHost(MainForm form)
    {
        try
        {
            var field = typeof(MainForm).GetField("_host", BindingFlags.Instance | BindingFlags.NonPublic);
            return field?.GetValue(form) as AppHost;
        }
        catch { return null; }
    }
}

internal enum UiEffectiveState
{
    Preparing,
    Pausing,
    Running,
    Paused,
    WaitNetwork,
    WaitQuota,
    WaitRetry,
    Complete
}

internal enum UiStatusKind
{
    Running,
    Preparing,
    Paused,
    Network,
    Quota,
    Error,
    Complete
}

internal sealed class EndpointFlowView : UserControl
{
    private readonly Label _leftIcon = EndpointIcon();
    private readonly Label _leftName = EndpointName();
    private readonly Label _rightIcon = EndpointIcon();
    private readonly Label _rightName = EndpointName();
    private readonly Label _status = new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 10F), Anchor = AnchorStyles.None };
    private readonly ArrowCanvas _arrow = new() { Dock = DockStyle.Fill, Height = 28 };

    public EndpointFlowView()
    {
        BackColor = Color.White;
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1, Padding = new Padding(2, 0, 2, 0) };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        layout.Controls.Add(EndpointBlock(_leftIcon, _leftName), 0, 0);

        var center = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        center.RowStyles.Add(new RowStyle(SizeType.Percent, 45));
        center.RowStyles.Add(new RowStyle(SizeType.Percent, 55));
        center.Controls.Add(_status, 0, 0);
        center.Controls.Add(_arrow, 0, 1);
        layout.Controls.Add(center, 1, 0);
        layout.Controls.Add(EndpointBlock(_rightIcon, _rightName), 2, 0);
        Controls.Add(layout);
    }

    public void UpdateFlow(string left, string right, string status, UiStatusKind kind)
    {
        _leftName.Text = left;
        _rightName.Text = right;
        _status.Text = status;
        var color = kind switch
        {
            UiStatusKind.Running => Color.FromArgb(31, 137, 86),
            UiStatusKind.Preparing => Color.FromArgb(55, 112, 180),
            UiStatusKind.Quota => Color.FromArgb(195, 142, 33),
            UiStatusKind.Network => Color.FromArgb(216, 120, 35),
            UiStatusKind.Error => Color.FromArgb(190, 55, 55),
            UiStatusKind.Complete => Color.FromArgb(35, 124, 95),
            _ => Color.FromArgb(135, 135, 135)
        };
        _status.ForeColor = color;
        _arrow.ArrowColor = color;
        _arrow.Invalidate();
    }

    private static Control EndpointBlock(Label icon, Label name)
    {
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 62));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 38));
        stack.Controls.Add(icon, 0, 0);
        stack.Controls.Add(name, 0, 1);
        return stack;
    }

    private static Label EndpointIcon() => new()
    {
        Text = "☁",
        AutoSize = true,
        Font = new Font("Segoe UI Symbol", 25F),
        Anchor = AnchorStyles.None,
        ForeColor = Color.FromArgb(92, 104, 118)
    };

    private static Label EndpointName() => new()
    {
        AutoSize = true,
        Font = new Font("Segoe UI Semibold", 9.5F),
        Anchor = AnchorStyles.None
    };
}

internal sealed class ArrowCanvas : Control
{
    public Color ArrowColor { get; set; } = Color.Gray;

    public ArrowCanvas()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        MinimumSize = new Size(80, 24);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        var y = Height / 2f;
        var x1 = 8f;
        var x2 = Math.Max(x1 + 20, Width - 12f);
        using var pen = new Pen(ArrowColor, 4f) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round };
        e.Graphics.DrawLine(pen, x1, y, x2 - 9, y);
        using var brush = new SolidBrush(ArrowColor);
        e.Graphics.FillPolygon(brush, new[]
        {
            new PointF(x2, y),
            new PointF(x2 - 13, y - 8),
            new PointF(x2 - 13, y + 8)
        });
    }
}

internal sealed class MeterBar : Control
{
    private double _fraction;
    private double _reserveFraction;
    private int _pulseOffset;

    public double Fraction { get => _fraction; set { _fraction = Math.Clamp(value, 0, 1); Invalidate(); } }
    public double ReserveFraction { get => _reserveFraction; set { _reserveFraction = Math.Clamp(value, 0, 0.8); Invalidate(); } }
    public bool Pulse { get; set; }
    public string BarText { get; set; } = string.Empty;
    public Color FillColor { get; set; } = Color.FromArgb(34, 146, 92);

    public MeterBar()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        Font = new Font("Segoe UI", 8.5F);
        MinimumSize = new Size(100, 14);
    }

    public void AdvancePulse()
    {
        if (!Pulse) return;
        _pulseOffset = (_pulseOffset + 7) % 140;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
        using var track = new SolidBrush(Color.FromArgb(233, 235, 238));
        e.Graphics.FillRectangle(track, rect);

        var reserveWidth = (int)Math.Round(rect.Width * ReserveFraction);
        if (reserveWidth > 0)
        {
            using var reserve = new SolidBrush(Color.FromArgb(205, 208, 213));
            e.Graphics.FillRectangle(reserve, rect.Right - reserveWidth, rect.Top, reserveWidth, rect.Height);
        }

        if (Pulse)
        {
            var usable = Math.Max(1, rect.Width - reserveWidth);
            var width = Math.Max(28, usable / 5);
            var x = ((_pulseOffset * Math.Max(1, usable + width)) / 140) - width;
            using var pulse = new SolidBrush(Color.FromArgb(72, 143, 205));
            e.Graphics.FillRectangle(pulse, x, rect.Top, width, rect.Height);
        }
        else
        {
            var fillWidth = (int)Math.Round(rect.Width * Fraction);
            if (fillWidth > 0)
            {
                using var fill = new SolidBrush(FillColor);
                e.Graphics.FillRectangle(fill, rect.Left, rect.Top, Math.Min(fillWidth, rect.Width), rect.Height);
            }
        }

        using var border = new Pen(Color.FromArgb(196, 199, 204));
        e.Graphics.DrawRectangle(border, rect);

        if (!string.IsNullOrWhiteSpace(BarText))
        {
            TextRenderer.DrawText(e.Graphics, BarText, Font, rect, Color.FromArgb(45, 45, 45),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
        }
    }
}
