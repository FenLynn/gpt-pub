using System.Text.Json;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// v0.2.5 single-owner dashboard. This UI is observational only: it never changes
/// transfer verification, quota accounting, persisted records, or WebDAV safety rules.
/// One timer owns all dashboard controls so status text and progress bars cannot race.
/// </summary>
internal sealed class UiDashboardV025 : IDisposable
{
    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private readonly CancellationTokenSource _cts = new();

    private readonly Panel _dashboard = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly TableLayoutPanel _shell = new() { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
    private readonly Panel _sidebar = new() { Dock = DockStyle.Fill, BackColor = Color.FromArgb(247, 248, 250) };
    private readonly Label _brand = new() { Text = "DavBridge", AutoSize = true, Font = new Font("Segoe UI Semibold", 15F) };
    private readonly Panel _taskCard = new() { Height = 58, Dock = DockStyle.Top, BackColor = Color.White };
    private readonly Label _taskName = new() { Text = "Zotero 附件迁移", AutoSize = true, Font = new Font("Segoe UI Semibold", 9.5F) };
    private readonly Label _taskState = new() { AutoSize = true, ForeColor = Color.DimGray };
    private readonly Button _settingsButton = new() { Text = "⚙  设置", Height = 38, Dock = DockStyle.Bottom, FlatStyle = FlatStyle.Flat };

    private readonly Label _title = new() { Text = "Zotero 附件迁移", AutoSize = true, Font = new Font("Segoe UI Semibold", 17F) };
    private readonly EndpointFlowView _flow = new() { Dock = DockStyle.Top, Height = 92 };

    private readonly Label _overallTitle = SectionTitle("总体进度");
    private readonly Label _overallGroups = new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 9.5F) };
    private readonly Label _overallFiles = new() { AutoSize = true, ForeColor = Color.DimGray };
    private readonly Label _overallRecent = new() { AutoSize = true, ForeColor = Color.Gray };
    private readonly MeterBar _overallBar = new() { Dock = DockStyle.Fill, Height = 22 };

    private readonly Label _currentTitle = SectionTitle("当前文件");
    private readonly Label _currentPhase = new() { AutoSize = true, ForeColor = Color.DimGray, MaximumSize = new Size(175, 0) };
    private readonly MeterBar _currentBar = new() { Dock = DockStyle.Fill, Height = 28, Pulse = true };

    private readonly Label _cycleTitle = SectionTitle("当前周期");
    private readonly Label _resetValue = new() { AutoSize = true, ForeColor = Color.DimGray, Anchor = AnchorStyles.Right };
    private readonly Label _uploadValue = new() { AutoSize = true, Anchor = AnchorStyles.Right };
    private readonly Label _downloadValue = new() { AutoSize = true, Anchor = AnchorStyles.Right };
    private readonly MeterBar _uploadBar = new() { Dock = DockStyle.Top, Height = 15 };
    private readonly MeterBar _downloadBar = new() { Dock = DockStyle.Top, Height = 15 };

    private readonly LinkLabel _problemLink = new() { AutoSize = true, Visible = false };
    private readonly Button _primary = new() { Width = 116, Height = 36, FlatStyle = FlatStyle.System };

    private EngineProgress? _lastProgress;
    private WebDavIoProgress? _lastIoProgress;
    private DateTimeOffset _progressAt = DateTimeOffset.MinValue;
    private DateTimeOffset _ioAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastVerifiedAt = DateTimeOffset.MinValue;
    private DateTimeOffset _lastStateCountAt = DateTimeOffset.MinValue;
    private DateTimeOffset _nextManifestAttempt = DateTimeOffset.MinValue;
    private int _verifiedFiles;
    private int _verifiedGroups;
    private int _errors;
    private int _lastObservedVerifiedGroups;
    private int _totalFiles;
    private int _totalGroups;
    private DateTimeOffset _manifestRefreshedAt = DateTimeOffset.MinValue;
    private bool _manifestRefreshing;
    private bool _preparing;
    private bool _pausing;
    private bool _disposed;

    private UiDashboardV025(MainForm form, AppHost host)
    {
        _form = form;
        _host = host;
        LoadManifestCache();

        _settingsButton.Click += (_, _) => _ = OpenSettingsAsync();
        _primary.Click += (_, _) => _ = PrimaryActionAsync();
        _problemLink.Click += (_, _) => OpenMaintenance("DiagnoseConnectionsAsync");
        _host.ProgressChanged += OnProgressChanged;
        _host.StateChanged += OnStateChanged;
        WebDavReadClient.GlobalIoProgress += OnIoProgress;
        _form.Resize += (_, _) => ApplyResponsiveLayout();
        _form.Shown += (_, _) => ApplyAll();
        _timer.Tick += (_, _) => Tick();

        BuildDashboard();
    }

    public static UiDashboardV025 Attach(MainForm form, AppHost host)
    {
        var dashboard = new UiDashboardV025(form, host);
        dashboard.ApplyAll();
        dashboard._timer.Start();
        return dashboard;
    }

    private void BuildDashboard()
    {
        _shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 196));
        _shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        BuildSidebar();
        _shell.Controls.Add(_sidebar, 0, 0);
        _shell.Controls.Add(BuildMainContent(), 1, 0);
        _dashboard.Controls.Add(_shell);
    }

    private void BuildSidebar()
    {
        _sidebar.Padding = new Padding(16, 20, 12, 16);
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4 };
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        stack.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        stack.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        _brand.Margin = new Padding(2, 0, 0, 18);
        stack.Controls.Add(_brand, 0, 0);

        _taskCard.Padding = new Padding(10, 9, 8, 7);
        var card = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        card.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        card.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _taskName.Margin = new Padding(0, 0, 0, 2);
        card.Controls.Add(_taskName, 0, 0);
        card.Controls.Add(_taskState, 0, 1);
        _taskCard.Controls.Add(card);
        stack.Controls.Add(_taskCard, 0, 1);

        stack.Controls.Add(new Label
        {
            Text = "当前任务",
            AutoSize = true,
            ForeColor = Color.Gray,
            Margin = new Padding(3, 9, 0, 0)
        }, 0, 2);

        _settingsButton.FlatAppearance.BorderSize = 0;
        _settingsButton.TextAlign = ContentAlignment.MiddleLeft;
        _settingsButton.Padding = new Padding(8, 0, 0, 0);
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
            Padding = new Padding(34, 22, 34, 20)
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        _title.Margin = new Padding(0, 0, 0, 6);
        root.Controls.Add(_title);
        _flow.Margin = new Padding(0, 0, 0, 5);
        root.Controls.Add(_flow);
        root.Controls.Add(BuildOverallRow());
        root.Controls.Add(BuildCurrentRow());
        root.Controls.Add(BuildCycleSection());

        _problemLink.Margin = new Padding(0, 10, 0, 0);
        root.Controls.Add(_problemLink);

        var actionHolder = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Margin = new Padding(0, 12, 0, 0)
        };
        actionHolder.Controls.Add(_primary);
        root.Controls.Add(actionHolder);

        outer.Controls.Add(root);
        return outer;
    }

    private Control BuildOverallRow()
    {
        var row = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = new Padding(0, 12, 0, 0),
            Padding = new Padding(0)
        };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 180));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        var left = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        _overallTitle.Margin = new Padding(0, 0, 0, 4);
        _overallGroups.Margin = new Padding(0, 0, 0, 2);
        _overallFiles.Margin = new Padding(0, 0, 0, 1);
        left.Controls.Add(_overallTitle);
        left.Controls.Add(_overallGroups);
        left.Controls.Add(_overallFiles);
        left.Controls.Add(_overallRecent);
        row.Controls.Add(left, 0, 0);

        var barHolder = new Panel { Dock = DockStyle.Fill, Height = 64, Padding = new Padding(0, 19, 0, 0), Margin = new Padding(8, 0, 0, 0) };
        _overallBar.Height = 22;
        _overallBar.Dock = DockStyle.Top;
        barHolder.Controls.Add(_overallBar);
        row.Controls.Add(barHolder, 1, 0);
        return row;
    }

    private Control BuildCurrentRow()
    {
        var row = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = new Padding(0, 14, 0, 0),
            Padding = new Padding(0)
        };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 180));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        var left = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        _currentTitle.Margin = new Padding(0, 0, 0, 4);
        left.Controls.Add(_currentTitle);
        left.Controls.Add(_currentPhase);
        row.Controls.Add(left, 0, 0);

        var barHolder = new Panel { Dock = DockStyle.Fill, Height = 56, Padding = new Padding(0, 11, 0, 0), Margin = new Padding(8, 0, 0, 0) };
        _currentBar.Height = 28;
        _currentBar.Dock = DockStyle.Top;
        barHolder.Controls.Add(_currentBar);
        row.Controls.Add(barHolder, 1, 0);
        return row;
    }

    private Control BuildCycleSection()
    {
        var section = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            Margin = new Padding(0, 16, 0, 0)
        };
        section.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.Controls.Add(_cycleTitle, 0, 0);
        header.Controls.Add(_resetValue, 1, 0);
        section.Controls.Add(header);

        var pair = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            Margin = new Padding(0, 8, 0, 0)
        };
        pair.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        pair.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        pair.Controls.Add(BuildQuotaCell("上传", _uploadValue, _uploadBar, new Padding(0, 0, 10, 0)), 0, 0);
        pair.Controls.Add(BuildQuotaCell("下载", _downloadValue, _downloadBar, new Padding(10, 0, 0, 0)), 1, 0);
        section.Controls.Add(pair);
        return section;
    }

    private static Control BuildQuotaCell(string name, Label value, MeterBar bar, Padding margin)
    {
        var cell = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, Margin = margin };
        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.Controls.Add(new Label { Text = name, AutoSize = true }, 0, 0);
        header.Controls.Add(value, 1, 0);
        cell.Controls.Add(header);
        bar.Margin = new Padding(0, 4, 0, 0);
        cell.Controls.Add(bar);
        return cell;
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

        _form.MinimumSize = new Size(650, 500);
        if (_form.Width < 880) _form.Width = 880;
        if (_form.Height < 590) _form.Height = 590;
        ApplyResponsiveLayout();
        RefreshStateCounters(force: true);
        UpdateDashboard();
    }

    private void ApplyResponsiveLayout()
    {
        if (_shell.ColumnStyles.Count == 0) return;
        var compact = _form.ClientSize.Width < 760;
        _shell.ColumnStyles[0].Width = compact ? 58 : 196;
        _sidebar.Padding = compact ? new Padding(8, 18, 8, 14) : new Padding(16, 20, 12, 16);
        _brand.Text = compact ? "D" : "DavBridge";
        _brand.Font = compact ? new Font("Segoe UI Semibold", 17F) : new Font("Segoe UI Semibold", 15F);
        _taskName.Text = compact ? "Z" : "Zotero 附件迁移";
        _taskState.Visible = !compact;
        _taskCard.Padding = compact ? new Padding(14, 14, 8, 8) : new Padding(10, 9, 8, 7);
        _settingsButton.Text = compact ? "⚙" : "⚙  设置";
        _settingsButton.TextAlign = compact ? ContentAlignment.MiddleCenter : ContentAlignment.MiddleLeft;
        _settingsButton.Padding = compact ? Padding.Empty : new Padding(8, 0, 0, 0);
        _title.Visible = !compact;
    }

    private void Tick()
    {
        if (_disposed || _form.IsDisposed) return;
        SettingsPolish.TryApplyOpenDialogs();

        if (_preparing && _host.State.EngineState != EngineState.Paused)
            _preparing = false;
        if (_pausing && !_host.IsRunning && !_host.Config.MigrationEnabled)
            _pausing = false;

        _overallBar.AdvancePulse();
        _currentBar.AdvancePulse();
        RefreshStateCounters(force: false);
        EnsureManifestTotals();
        UpdateDashboard();
    }

    private void RefreshStateCounters(bool force)
    {
        var now = DateTimeOffset.Now;
        if (!force && now - _lastStateCountAt < TimeSpan.FromMilliseconds(900))
            return;
        _lastStateCountAt = now;

        var records = _host.State.Files.Values;
        _verifiedFiles = records.Count(x => x.Status == TransferStatus.StrongVerified);
        _verifiedGroups = CountVerifiedGroups(_host.State);
        _errors = records.Count(x => x.Status is TransferStatus.Failed or TransferStatus.Conflict or TransferStatus.BlockedOversize or TransferStatus.SourceChanged);

        if (_verifiedGroups > _lastObservedVerifiedGroups)
        {
            _lastObservedVerifiedGroups = _verifiedGroups;
            _lastVerifiedAt = now;
        }
        else if (_lastObservedVerifiedGroups == 0)
        {
            _lastObservedVerifiedGroups = _verifiedGroups;
        }
    }

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

    private void UpdateOverall()
    {
        if (_totalGroups <= 0)
        {
            _overallBar.Fraction = 0;
            _overallBar.Pulse = _host.Config.MigrationEnabled;
            _overallBar.BarText = _manifestRefreshing ? "正在读取源清单" : "等待源清单";
            _overallGroups.Text = $"{_verifiedGroups:N0} 组已核验";
            _overallFiles.Text = $"{_verifiedFiles:N0} 文件已核验";
            _overallRecent.Text = string.Empty;
            return;
        }

        var fraction = Math.Clamp((double)_verifiedGroups / _totalGroups, 0, 1);
        _overallBar.Pulse = false;
        _overallBar.Fraction = fraction;
        _overallBar.BarText = $"{fraction:P1}";
        _overallGroups.Text = $"{_verifiedGroups:N0} / {_totalGroups:N0} 组";
        _overallFiles.Text = _totalFiles > 0
            ? $"{_verifiedFiles:N0} / {_totalFiles:N0} 文件已核验"
            : $"{_verifiedFiles:N0} 文件已核验";
        _overallRecent.Text = _lastVerifiedAt == DateTimeOffset.MinValue
            ? string.Empty
            : $"最近完成 {FormatAge(DateTimeOffset.Now - _lastVerifiedAt)}";
    }

    private void UpdateCurrent(UiEffectiveState state)
    {
        var relative = _lastProgress?.RelativePath;
        var message = _lastProgress?.Message ?? string.Empty;

        if (state == UiEffectiveState.Paused)
        {
            _currentBar.Pulse = false;
            _currentBar.Fraction = 0;
            _currentBar.BarText = string.IsNullOrWhiteSpace(_host.State.CurrentGroupKey)
                ? "等待继续"
                : $"暂停断点  {_host.State.CurrentGroupKey}";
            _currentPhase.Text = "已暂停";
            return;
        }

        if (state == UiEffectiveState.Preparing)
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            _currentBar.BarText = "准备任务";
            _currentPhase.Text = "正在恢复任务状态";
            return;
        }

        if (state == UiEffectiveState.Pausing)
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            _currentBar.BarText = string.IsNullOrWhiteSpace(relative) ? "正在安全暂停" : Path.GetFileName(relative);
            _currentPhase.Text = "正在保存安全断点";
            return;
        }

        if (state == UiEffectiveState.Complete)
        {
            _currentBar.Pulse = false;
            _currentBar.Fraction = 1;
            _currentBar.BarText = "当前源清单已完成";
            _currentPhase.Text = "已完成";
            return;
        }

        if (string.IsNullOrWhiteSpace(relative))
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = state == UiEffectiveState.Running;
            _currentBar.BarText = state switch
            {
                UiEffectiveState.WaitNetwork => "等待网络恢复",
                UiEffectiveState.WaitQuota => "等待下一周期",
                UiEffectiveState.WaitRetry => "任务已安全停止",
                _ => "准备下一个文件"
            };
            _currentPhase.Text = state switch
            {
                UiEffectiveState.WaitNetwork => "等待网络",
                UiEffectiveState.WaitQuota => "等待额度",
                UiEffectiveState.WaitRetry => "需要处理",
                _ => "正在处理"
            };
            return;
        }

        var fileName = Path.GetFileName(relative);
        var io = _lastIoProgress;
        var ioMatches = io is not null && RelativeFileMatches(io.RelativePath, relative);
        var hasTotal = ioMatches && io!.TotalBytes.HasValue && io.TotalBytes.Value > 0;
        var fraction = hasTotal ? Math.Clamp((double)io!.BytesProcessed / io.TotalBytes!.Value, 0, 1) : 0;

        if (IsSourceReadStage(message) && hasTotal && fraction >= 0.999 && DateTimeOffset.Now - _ioAt > TimeSpan.FromMilliseconds(650))
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            _currentBar.BarText = fileName;
            _currentPhase.Text = "检查坚果云目标状态";
            return;
        }

        if (DateTimeOffset.Now - _progressAt > TimeSpan.FromSeconds(8) &&
            (!ioMatches || DateTimeOffset.Now - _ioAt > TimeSpan.FromSeconds(8)))
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            _currentBar.BarText = fileName;
            _currentPhase.Text = "等待服务器响应";
            return;
        }

        if (hasTotal)
        {
            _currentBar.Pulse = false;
            _currentBar.Fraction = fraction;
            _currentBar.BarText = $"{fileName}    {fraction:P0}";
        }
        else
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = state == UiEffectiveState.Running;
            _currentBar.BarText = fileName;
        }
        _currentPhase.Text = HumanizeStage(message, ioMatches ? io!.Operation : null);
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
            _resetValue.Text = "流量尚未校准";
        else
        {
            var date = ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt);
            _resetValue.Text = $"{date:yyyy-MM-dd} 重置，09:00 后探测";
        }
    }

    private void UpdateProblems()
    {
        _problemLink.Visible = _errors > 0 || _host.State.EngineState == EngineState.WaitRetry;
        _problemLink.Text = _errors > 0 ? $"⚠ {_errors:N0} 项需要处理  ›" : "⚠ 任务需要处理  ›";
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

    private async Task PrimaryActionAsync()
    {
        var state = EffectiveState();
        if (state is UiEffectiveState.Running or UiEffectiveState.Preparing)
        {
            _preparing = false;
            _pausing = true;
            UpdateDashboard();
            var pauseTask = UiCommandBridge.InvokeTask(_form, "PauseAsync");
            if (pauseTask is not null)
                await pauseTask.ConfigureAwait(true);
            var started = DateTime.UtcNow;
            while (_host.IsRunning && DateTime.UtcNow - started < TimeSpan.FromSeconds(8))
                await Task.Delay(80).ConfigureAwait(true);
            _pausing = false;
            UpdateDashboard();
            return;
        }

        if (state != UiEffectiveState.Paused) return;
        _preparing = true;
        _lastProgress = null;
        _lastIoProgress = null;
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
        if (task is not null) _ = task;
    }

    private void OnProgressChanged(object? sender, EngineProgress progress)
    {
        var stageChanged = !string.Equals(_lastProgress?.RelativePath, progress.RelativePath, StringComparison.OrdinalIgnoreCase) ||
                           !string.Equals(_lastProgress?.Message, progress.Message, StringComparison.Ordinal);
        if (stageChanged) _lastIoProgress = null;
        _lastProgress = progress;
        _progressAt = DateTimeOffset.Now;
    }

    private void OnStateChanged(object? sender, EventArgs e)
    {
        // UI timer owns control updates.
    }

    private void OnIoProgress(object? sender, WebDavIoProgress progress)
    {
        if (!MatchesConfiguredEndpoint(progress.BaseAddress)) return;
        _lastIoProgress = progress;
        _ioAt = DateTimeOffset.Now;
    }

    private void EnsureManifestTotals()
    {
        if (!_host.IsConfigured || _manifestRefreshing) return;
        var cacheFresh = _totalGroups > 0 && DateTimeOffset.Now - _manifestRefreshedAt < TimeSpan.FromHours(24);
        if (cacheFresh) return;
        if (DateTimeOffset.Now < _nextManifestAttempt) return;

        _manifestRefreshing = true;
        _nextManifestAttempt = DateTimeOffset.Now.AddSeconds(30);
        _ = RefreshManifestTotalsAsync();
    }

    private async Task RefreshManifestTotalsAsync()
    {
        try
        {
            var report = await _host.ScanReadinessAsync(_cts.Token).ConfigureAwait(false);
            _totalFiles = report.ObjectCount;
            _totalGroups = report.GroupCount;
            _manifestRefreshedAt = DateTimeOffset.Now;
            SaveManifestCache(report);
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            _nextManifestAttempt = DateTimeOffset.Now.AddSeconds(30);
        }
        finally
        {
            _manifestRefreshing = false;
        }
    }

    private void LoadManifestCache()
    {
        try
        {
            var path = Path.Combine(_host.Paths.RoamingRoot, "ui-cache.json");
            if (!File.Exists(path)) return;
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            if (doc.RootElement.TryGetProperty("TotalGroups", out var groups)) _totalGroups = groups.GetInt32();
            if (doc.RootElement.TryGetProperty("TotalFiles", out var files)) _totalFiles = files.GetInt32();
            if (doc.RootElement.TryGetProperty("RefreshedAt", out var refreshed) && refreshed.TryGetDateTimeOffset(out var value))
                _manifestRefreshedAt = value;
        }
        catch
        {
            _totalGroups = 0;
            _totalFiles = 0;
            _manifestRefreshedAt = DateTimeOffset.MinValue;
        }
    }

    private void SaveManifestCache(ReadinessReport report)
    {
        try
        {
            var path = Path.Combine(_host.Paths.RoamingRoot, "ui-cache.json");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = path + ".tmp";
            var json = JsonSerializer.Serialize(new
            {
                TotalFiles = report.ObjectCount,
                TotalGroups = report.GroupCount,
                TotalBytes = report.TotalBytes,
                RefreshedAt = _manifestRefreshedAt
            }, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(temp, json);
            File.Move(temp, path, true);
        }
        catch
        {
        }
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

    private static bool RelativeFileMatches(string ioPath, string progressPath)
    {
        var a = ioPath.Replace('\\', '/').Trim('/');
        var b = progressPath.Replace('\\', '/').Trim('/');
        return a.EndsWith("/" + b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(a, b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(Path.GetFileName(a), Path.GetFileName(b), StringComparison.OrdinalIgnoreCase);
    }

    private bool MatchesConfiguredEndpoint(string baseAddress) =>
        SameEndpoint(baseAddress, _host.Config.SourceBaseUrl) || SameEndpoint(baseAddress, _host.Config.TargetBaseUrl);

    private static bool SameEndpoint(string left, string right)
    {
        if (!Uri.TryCreate(left, UriKind.Absolute, out var a) || !Uri.TryCreate(right, UriKind.Absolute, out var b)) return false;
        return string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) &&
               a.Port == b.Port &&
               a.AbsolutePath.Trim('/').Equals(b.AbsolutePath.Trim('/'), StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsSourceReadStage(string message) =>
        message.Contains("Downloading source", StringComparison.OrdinalIgnoreCase);

    private static string HumanizeStage(string message, WebDavIoOperation? operation)
    {
        if (message.Contains("Downloading source", StringComparison.OrdinalIgnoreCase)) return "读取源文件并计算 SHA-256";
        if (message.Contains("Target already exists", StringComparison.OrdinalIgnoreCase)) return "校验坚果云已有副本";
        if (message.Contains("Uploading target", StringComparison.OrdinalIgnoreCase)) return "上传到坚果云";
        if (message.Contains("Re-downloading target", StringComparison.OrdinalIgnoreCase)) return "重新读取目标并强校验";
        if (message.Contains("Strong verification complete", StringComparison.OrdinalIgnoreCase)) return "强校验完成";
        return operation switch
        {
            WebDavIoOperation.Upload => "上传到坚果云",
            WebDavIoOperation.Download => "读取并校验文件",
            _ => "处理中"
        };
    }

    private static string FormatAge(TimeSpan age)
    {
        if (age < TimeSpan.FromSeconds(2)) return "刚刚";
        if (age < TimeSpan.FromMinutes(1)) return $"{Math.Max(2, (int)age.TotalSeconds)} 秒前";
        if (age < TimeSpan.FromHours(1)) return $"{Math.Max(1, (int)age.TotalMinutes)} 分钟前";
        return $"{Math.Max(1, (int)age.TotalHours)} 小时前";
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1_000_000_000) return $"{bytes / 1_000_000_000d:0.00} GB";
        if (bytes >= 1_000_000) return $"{bytes / 1_000_000d:0.0} MB";
        if (bytes >= 1_000) return $"{bytes / 1_000d:0.0} KB";
        return $"{bytes} B";
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
        _cts.Cancel();
        _cts.Dispose();
        _host.ProgressChanged -= OnProgressChanged;
        _host.StateChanged -= OnStateChanged;
        WebDavReadClient.GlobalIoProgress -= OnIoProgress;
    }
}