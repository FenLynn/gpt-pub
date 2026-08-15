using System.Reflection;
using DavBridge.Core;

namespace DavBridge;

internal enum UiPageV030
{
    Overview,
    Transfer,
    Recycle
}

internal enum RecycleFilterV030
{
    Observing,
    Review,
    History
}

internal sealed class UiShellV030 : IDisposable
{
    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly ReconciliationRuntimeV030 _reconciliation;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private readonly CancellationTokenSource _cts = new();

    private readonly Panel _surface = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly TableLayoutPanel _root = new() { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3 };
    private readonly Label _title = new() { Text = "Zotero 镜像维护", AutoSize = true, Font = new Font("Segoe UI Semibold", 17F) };
    private readonly Label _cycle = new() { AutoSize = true, ForeColor = Color.FromArgb(91, 105, 117), TextAlign = ContentAlignment.MiddleRight };
    private readonly Button _settings = new() { Text = "⚙", Width = 36, Height = 32, FlatStyle = FlatStyle.Flat, TabStop = false };
    private readonly Button _tabOverview = TabButton("总览");
    private readonly Button _tabTransfer = TabButton("转移");
    private readonly Button _tabRecycle = TabButton("回收站");
    private readonly Panel _content = new() { Dock = DockStyle.Fill, AutoScroll = true, BackColor = Color.White };

    private readonly Panel _overviewPage = new() { Dock = DockStyle.Top, AutoSize = true, BackColor = Color.White };
    private readonly Panel _transferPage = new() { Dock = DockStyle.Top, AutoSize = true, BackColor = Color.White };
    private readonly Panel _recyclePage = new() { Dock = DockStyle.Fill, BackColor = Color.White };

    private readonly RoutePanelV030 _route = new() { Dock = DockStyle.Top, Height = 102 };
    private readonly ActionBannerV030 _actionBanner = new() { Dock = DockStyle.Top, Height = 64, Visible = false };
    private readonly Label _cycleStep1 = StepLabel();
    private readonly Label _cycleStep2 = StepLabel();
    private readonly Label _cycleStep3 = StepLabel();
    private readonly MeterV030 _coverage = new() { Dock = DockStyle.Fill, Height = 27 };
    private readonly Label _coverageText = ValueLabel();
    private readonly Label _currentText = ValueLabel();
    private readonly MeterV030 _currentMeter = new() { Dock = DockStyle.Fill, Height = 27, Pulse = true };
    private readonly Label _uploadText = ValueLabel();
    private readonly Label _downloadText = ValueLabel();
    private readonly MeterV030 _uploadMeter = new() { Dock = DockStyle.Fill, Height = 16 };
    private readonly MeterV030 _downloadMeter = new() { Dock = DockStyle.Fill, Height = 16 };
    private readonly Label _resetText = new() { AutoSize = true, ForeColor = Color.FromArgb(115, 124, 132), Anchor = AnchorStyles.Right };
    private readonly Button _primary = new() { Width = 94, Height = 36, FlatStyle = FlatStyle.Flat, TabStop = false };

    private readonly Label _priorityCount = BigCountLabel();
    private readonly Label _normalCount = BigCountLabel();
    private readonly Label _transferStatus = ValueLabel();
    private readonly ProgressBar _transferOverall = new() { Dock = DockStyle.Top, Height = 12, Maximum = 1000 };

    private readonly Button _recycleObserving = FilterButton("待观察");
    private readonly Button _recycleReview = FilterButton("待审查");
    private readonly Button _recycleHistory = FilterButton("已处理");
    private readonly DataGridView _recycleGrid = new();
    private readonly Label _recycleHint = new() { AutoSize = true, ForeColor = Color.FromArgb(102, 114, 124), MaximumSize = new Size(760, 0) };
    private readonly Button _deferAll = new() { Text = "本周期全部保留", Width = 122, Height = 34, FlatStyle = FlatStyle.Flat, TabStop = false };
    private readonly Button _deleteSelected = new() { Text = "删除所选", Width = 96, Height = 34, FlatStyle = FlatStyle.Flat, TabStop = false };

    private UiPageV030 _page = UiPageV030.Overview;
    private RecycleFilterV030 _recycleFilter = RecycleFilterV030.Observing;
    private EngineProgress? _progress;
    private WebDavIoProgress? _io;
    private DateTimeOffset _nextPassiveAudit = DateTimeOffset.MinValue;
    private bool _passiveAuditRunning;
    private bool _disposed;

    private UiShellV030(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation)
    {
        _form = form;
        _host = host;
        _reconciliation = reconciliation;
        Build();
        Wire();
        ApplyPage(UiPageV030.Overview);
        RefreshAll();
        _timer.Start();
    }

    public static UiShellV030 Attach(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation) =>
        new(form, host, reconciliation);

    internal void ValidateLayout(string scenario)
    {
        _form.PerformLayout();
        if (_root.Width <= 0 || _root.Height <= 0) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: v0.3 root not laid out");
        if (_content.Width < 420) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: content too narrow");
        if (_route.Width < 360 || _route.Height < 80) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: route clipped");
        if (_tabOverview.Width < 60 || _tabTransfer.Width < 60 || _tabRecycle.Width < 70)
            throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: top tabs clipped");
        if (_settings.Width < 30 || _settings.Height < 28)
            throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: settings clipped");
    }

    private void Build()
    {
        _form.MinimumSize = new Size(680, 520);
        if (_form.Width < 900) _form.Width = 900;
        if (_form.Height < 620) _form.Height = 620;

        foreach (Control control in _form.Controls)
            control.Visible = false;
        _form.Controls.Add(_surface);
        _surface.BringToFront();

        _root.RowStyles.Add(new RowStyle(SizeType.Absolute, 68));
        _root.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
        _root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _surface.Controls.Add(_root);

        _root.Controls.Add(BuildHeader(), 0, 0);
        _root.Controls.Add(BuildTabs(), 0, 1);
        _root.Controls.Add(_content, 0, 2);

        BuildOverview();
        BuildTransfer();
        BuildRecycle();
        _content.Controls.Add(_overviewPage);
        _content.Controls.Add(_transferPage);
        _content.Controls.Add(_recyclePage);
    }

    private Control BuildHeader()
    {
        var header = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 3,
            Padding = new Padding(30, 19, 30, 8),
            BackColor = Color.White
        };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 46));
        _title.Anchor = AnchorStyles.Left;
        header.Controls.Add(_title, 0, 0);
        _cycle.Anchor = AnchorStyles.Right;
        _cycle.Margin = new Padding(0, 7, 12, 0);
        header.Controls.Add(_cycle, 1, 0);
        _settings.FlatAppearance.BorderSize = 0;
        _settings.FlatAppearance.MouseOverBackColor = Color.FromArgb(244, 248, 251);
        _settings.Anchor = AnchorStyles.Right;
        header.Controls.Add(_settings, 2, 0);
        return header;
    }

    private Control BuildTabs()
    {
        var holder = new Panel { Dock = DockStyle.Fill, Padding = new Padding(30, 0, 30, 0), BackColor = Color.White };
        var tabs = new FlowLayoutPanel
        {
            Dock = DockStyle.Left,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            WrapContents = false,
            Padding = new Padding(0, 2, 0, 0)
        };
        _tabOverview.Width = 76;
        _tabTransfer.Width = 76;
        _tabRecycle.Width = 88;
        tabs.Controls.Add(_tabOverview);
        tabs.Controls.Add(_tabTransfer);
        tabs.Controls.Add(_tabRecycle);
        holder.Controls.Add(tabs);
        var line = new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Color.FromArgb(232, 236, 239) };
        holder.Controls.Add(line);
        return holder;
    }

    private void BuildOverview()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            Padding = new Padding(30, 12, 30, 24),
            BackColor = Color.White
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        root.Controls.Add(_actionBanner);
        _actionBanner.Margin = new Padding(0, 0, 0, 10);
        root.Controls.Add(_route);
        root.Controls.Add(BuildCycleStatus());
        root.Controls.Add(BuildCoverageSection());
        root.Controls.Add(BuildCurrentSection());
        root.Controls.Add(BuildQuotaSection());
        root.Controls.Add(BuildBottomActions());
        _overviewPage.Controls.Add(root);
    }

    private Control BuildCycleStatus()
    {
        var box = Card();
        var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, Padding = new Padding(16, 12, 16, 12) };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 88));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3F));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3F));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.4F));
        table.Controls.Add(SectionLabel("本周期"), 0, 0);
        table.Controls.Add(_cycleStep1, 1, 0);
        table.Controls.Add(_cycleStep2, 2, 0);
        table.Controls.Add(_cycleStep3, 3, 0);
        box.Height = 58;
        box.Controls.Add(table);
        box.Margin = new Padding(0, 2, 0, 12);
        return box;
    }

    private Control BuildCoverageSection()
    {
        var table = SectionTable("镜像覆盖");
        var right = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        _coverageText.Margin = new Padding(0, 0, 0, 5);
        right.Controls.Add(_coverageText);
        right.Controls.Add(_coverage);
        table.Controls.Add(right, 1, 0);
        return table;
    }

    private Control BuildCurrentSection()
    {
        var table = SectionTable("当前任务");
        var right = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        _currentText.Margin = new Padding(0, 0, 0, 5);
        right.Controls.Add(_currentText);
        right.Controls.Add(_currentMeter);
        table.Controls.Add(right, 1, 0);
        return table;
    }

    private Control BuildQuotaSection()
    {
        var table = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 3,
            Margin = new Padding(0, 17, 0, 0)
        };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        table.Controls.Add(SectionLabel("当前周期"), 0, 0);
        table.Controls.Add(BuildQuotaCell("上传", _uploadText, _uploadMeter, new Padding(0, 0, 12, 0)), 1, 0);
        table.Controls.Add(BuildQuotaCell("下载", _downloadText, _downloadMeter, new Padding(12, 0, 0, 0)), 2, 0);
        _resetText.Margin = new Padding(0, 6, 0, 0);
        table.Controls.Add(_resetText, 1, 1);
        table.SetColumnSpan(_resetText, 2);
        return table;
    }

    private Control BuildBottomActions()
    {
        var row = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 18, 0, 0) };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _primary.FlatAppearance.BorderColor = Color.FromArgb(197, 208, 216);
        _primary.BackColor = Color.White;
        _primary.Anchor = AnchorStyles.Right;
        row.Controls.Add(_primary, 1, 0);
        return row;
    }

    private void BuildTransfer()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 1,
            Padding = new Padding(30, 22, 30, 24),
            BackColor = Color.White
        };
        root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        root.Controls.Add(PageHeading("转移", "修改过的历史副本优先修复，新增附件与原有未迁移附件进入同一个普通任务池。"));

        var cards = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 18, 0, 18) };
        cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        cards.Controls.Add(CountCard("优先修复", _priorityCount, "源端内容已经改变的 StrongVerified 组", new Padding(0, 0, 8, 0)), 0, 0);
        cards.Controls.Add(CountCard("普通任务", _normalCount, "既有 backlog 与本周期新增对象同级", new Padding(8, 0, 0, 0)), 1, 0);
        root.Controls.Add(cards);

        var work = Card();
        work.Padding = new Padding(18, 16, 18, 16);
        var workStack = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        workStack.Controls.Add(SectionLabel("当前转移状态"));
        _transferStatus.Margin = new Padding(0, 8, 0, 8);
        workStack.Controls.Add(_transferStatus);
        workStack.Controls.Add(_transferOverall);
        work.Controls.Add(workStack);
        work.Height = 112;
        root.Controls.Add(work);
        _transferPage.Controls.Add(root);
    }

    private void BuildRecycle()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(30, 22, 30, 20),
            BackColor = Color.White
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
        root.Controls.Add(PageHeading("回收站", "首次缺失只观察。跨至少一个已确认额度周期仍缺失后，必须由你明确选择删除或本周期继续保留。"), 0, 0);

        var filters = new FlowLayoutPanel { Dock = DockStyle.Left, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Padding = new Padding(0, 6, 0, 0) };
        _recycleObserving.Width = 84;
        _recycleReview.Width = 84;
        _recycleHistory.Width = 84;
        filters.Controls.Add(_recycleObserving);
        filters.Controls.Add(_recycleReview);
        filters.Controls.Add(_recycleHistory);
        root.Controls.Add(filters, 0, 1);

        _recycleHint.Margin = new Padding(0, 6, 0, 9);
        root.Controls.Add(_recycleHint, 0, 2);
        ConfigureRecycleGrid();
        root.Controls.Add(_recycleGrid, 0, 3);

        var footer = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Padding = new Padding(0, 8, 0, 0) };
        StyleFooterButton(_deferAll);
        StyleFooterButton(_deleteSelected);
        _deleteSelected.Margin = new Padding(8, 0, 0, 0);
        footer.Controls.Add(_deleteSelected);
        footer.Controls.Add(_deferAll);
        root.Controls.Add(footer, 0, 4);
        _recyclePage.Controls.Add(root);
    }

    private void ConfigureRecycleGrid()
    {
        _recycleGrid.Dock = DockStyle.Fill;
        _recycleGrid.BackgroundColor = Color.White;
        _recycleGrid.BorderStyle = BorderStyle.FixedSingle;
        _recycleGrid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
        _recycleGrid.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
        _recycleGrid.RowHeadersVisible = false;
        _recycleGrid.AllowUserToAddRows = false;
        _recycleGrid.AllowUserToDeleteRows = false;
        _recycleGrid.AllowUserToResizeRows = false;
        _recycleGrid.MultiSelect = true;
        _recycleGrid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _recycleGrid.AutoGenerateColumns = false;
        _recycleGrid.AutoSizeRowsMode = DataGridViewAutoSizeRowsMode.AllCells;
        _recycleGrid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(235, 244, 250);
        _recycleGrid.DefaultCellStyle.SelectionForeColor = Color.FromArgb(35, 45, 52);
        _recycleGrid.DefaultCellStyle.Padding = new Padding(4, 5, 4, 5);
        _recycleGrid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(248, 250, 251);
        _recycleGrid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(75, 88, 97);
        _recycleGrid.EnableHeadersVisualStyles = false;
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Group", HeaderText = "附件组", DataPropertyName = "Group", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, FillWeight = 40 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "FirstMissing", HeaderText = "首次缺失", DataPropertyName = "FirstMissing", Width = 94 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "LastDecision", HeaderText = "上次决定", DataPropertyName = "LastDecision", Width = 104 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Size", HeaderText = "历史大小", DataPropertyName = "Size", Width = 92 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Verified", HeaderText = "最后强校验", DataPropertyName = "Verified", Width = 118 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "State", HeaderText = "状态", DataPropertyName = "State", Width = 118 });
    }

    private void Wire()
    {
        _tabOverview.Click += (_, _) => ApplyPage(UiPageV030.Overview);
        _tabTransfer.Click += (_, _) => ApplyPage(UiPageV030.Transfer);
        _tabRecycle.Click += (_, _) => ApplyPage(UiPageV030.Recycle);
        _settings.Click += async (_, _) => await InvokeMainTaskAsync("EditSettingsAsync").ConfigureAwait(true);
        _primary.Click += async (_, _) => await PrimaryAsync().ConfigureAwait(true);
        _actionBanner.ActionClicked += (_, _) => ApplyPage(UiPageV030.Recycle, RecycleFilterV030.Review);
        _recycleObserving.Click += (_, _) => ApplyRecycleFilter(RecycleFilterV030.Observing);
        _recycleReview.Click += (_, _) => ApplyRecycleFilter(RecycleFilterV030.Review);
        _recycleHistory.Click += (_, _) => ApplyRecycleFilter(RecycleFilterV030.History);
        _recycleGrid.CellDoubleClick += (_, e) => { if (e.RowIndex >= 0) ShowRecycleDetail(_recycleGrid.Rows[e.RowIndex].Tag as string); };
        _deferAll.Click += async (_, _) => await DeferVisibleReviewAsync().ConfigureAwait(true);
        _deleteSelected.Click += async (_, _) => await DeleteSelectedAsync().ConfigureAwait(true);
        _host.ProgressChanged += OnProgress;
        _host.StateChanged += OnStateChanged;
        _reconciliation.Changed += OnReconciliationChanged;
        WebDavReadClient.GlobalIoProgress += OnIo;
        _timer.Tick += (_, _) => Tick();
        _form.Resize += (_, _) => RefreshResponsive();
    }

    private void ApplyPage(UiPageV030 page, RecycleFilterV030? recycleFilter = null)
    {
        _page = page;
        if (recycleFilter.HasValue) _recycleFilter = recycleFilter.Value;
        _overviewPage.Visible = page == UiPageV030.Overview;
        _transferPage.Visible = page == UiPageV030.Transfer;
        _recyclePage.Visible = page == UiPageV030.Recycle;
        if (_overviewPage.Visible) _overviewPage.BringToFront();
        if (_transferPage.Visible) _transferPage.BringToFront();
        if (_recyclePage.Visible) _recyclePage.BringToFront();
        StyleTab(_tabOverview, page == UiPageV030.Overview);
        StyleTab(_tabTransfer, page == UiPageV030.Transfer);
        StyleTab(_tabRecycle, page == UiPageV030.Recycle);
        if (page == UiPageV030.Recycle) RefreshRecycle();
    }

    private void ApplyRecycleFilter(RecycleFilterV030 filter)
    {
        _recycleFilter = filter;
        RefreshRecycle();
    }

    private void Tick()
    {
        if (_disposed || _form.IsDisposed) return;
        _currentMeter.AdvancePulse();
        RefreshAll();
        if (_host.IsConfigured && !_host.IsRunning && _reconciliation.NeedsAudit && !_passiveAuditRunning && DateTimeOffset.Now >= _nextPassiveAudit)
        {
            _passiveAuditRunning = true;
            _nextPassiveAudit = DateTimeOffset.Now.AddSeconds(30);
            _ = PassiveAuditAsync();
        }
    }

    private async Task PassiveAuditAsync()
    {
        try
        {
            await _reconciliation.EnsureAuditAsync(_cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) { }
        catch { _nextPassiveAudit = DateTimeOffset.Now.AddMinutes(5); }
        finally
        {
            _passiveAuditRunning = false;
            SafeUi(RefreshAllAndRecycleIfVisible);
        }
    }

    private void RefreshAll()
    {
        if (_disposed || !_form.IsHandleCreated) return;
        RefreshResponsive();
        RefreshHeader();
        RefreshOverview();
        RefreshTransfer();
    }

    private void RefreshAllAndRecycleIfVisible()
    {
        RefreshAll();
        if (_page == UiPageV030.Recycle) RefreshRecycle();
    }

    private void RefreshHeader()
    {
        var cycle = _reconciliation.CurrentCycleId;
        _cycle.Text = string.IsNullOrWhiteSpace(cycle) ? "Cycle 未校准" : $"Cycle {cycle}";
        var status = _host.State.EngineState switch
        {
            EngineState.WaitUser => "等待人工审查",
            EngineState.WaitQuota => "等待下一周期",
            EngineState.WaitNetwork => "等待网络",
            EngineState.WaitRetry => "需要处理",
            EngineState.Complete => "当前清单完成",
            EngineState.Running => _reconciliation.IsAuditing ? "源端对账中" : "普通迁移中",
            _ => _host.Config.MigrationEnabled ? "准备中" : "已暂停"
        };
        _route.SetStatus(status, StatusColor(_host.State.EngineState));
        var review = _reconciliation.GetHumanActionCount();
        _tabRecycle.Text = review > 0 ? $"回收站  {review}" : "回收站";
    }

    private void RefreshOverview()
    {
        var review = _reconciliation.GetHumanActionCount();
        _actionBanner.Visible = review > 0;
        if (review > 0)
            _actionBanner.SetText("需要你的操作", $"{review} 个附件组需要人工审查，普通迁移暂缓。", "审查");

        var lastCycle = _reconciliation.State.LastReconciledCycleId;
        var currentCycle = _reconciliation.CurrentCycleId;
        var auditDone = !string.IsNullOrWhiteSpace(currentCycle) && string.Equals(lastCycle, currentCycle, StringComparison.OrdinalIgnoreCase);
        _cycleStep1.Text = _reconciliation.IsAuditing ? "○ 源端对账中" : auditDone ? "✓ 源端对账完成" : "○ 等待源端对账";
        var priority = PriorityGroupCount();
        _cycleStep2.Text = priority > 0 ? $"○ 优先修复 {priority:N0}" : "✓ 源变化已处理";
        _cycleStep3.Text = review > 0 ? $"! 待审查 {review:N0}" : _host.State.EngineState == EngineState.WaitQuota ? "○ 等待新周期" : "○ 普通迁移";
        _cycleStep1.ForeColor = StepColor(_cycleStep1.Text);
        _cycleStep2.ForeColor = StepColor(_cycleStep2.Text);
        _cycleStep3.ForeColor = StepColor(_cycleStep3.Text);

        var verified = _host.State.Files.Values.Count(record => record.Status == TransferStatus.StrongVerified);
        var total = Math.Max(_reconciliation.State.LastManifestObjectCount, _host.State.Files.Count);
        var coverage = total <= 0 ? 0 : Math.Clamp((double)verified / total, 0, 1);
        _coverage.Fraction = coverage;
        _coverage.StartColor = Color.FromArgb(123, 181, 211);
        _coverage.EndColor = Color.FromArgb(72, 145, 184);
        _coverageText.Text = total > 0 ? $"{verified:N0} / {total:N0} 文件已 StrongVerified" : $"{verified:N0} 文件已 StrongVerified";

        RefreshCurrent();
        RefreshQuota();
        RefreshPrimary(review);
    }

    private void RefreshCurrent()
    {
        var relative = _progress?.RelativePath;
        if (string.IsNullOrWhiteSpace(relative))
        {
            _currentMeter.Fraction = 0;
            _currentMeter.Pulse = _host.State.EngineState == EngineState.Running || _reconciliation.IsAuditing;
            _currentText.Text = _reconciliation.IsAuditing
                ? "正在读取并核对 InfiniCLOUD 源清单"
                : _host.State.EngineState switch
                {
                    EngineState.WaitUser => "等待回收站人工审查",
                    EngineState.WaitQuota => "等待坚果云下一额度周期",
                    EngineState.WaitNetwork => "等待网络恢复",
                    EngineState.WaitRetry => "任务已安全停止，等待处理",
                    EngineState.Complete => "当前源清单已经处理完成",
                    EngineState.Paused => "等待继续",
                    _ => "准备任务"
                };
            return;
        }

        var fileName = Path.GetFileName(relative);
        var io = _io;
        var matches = io is not null && PathMatches(io.RelativePath, relative);
        if (matches && io!.TotalBytes.HasValue && io.TotalBytes.Value > 0)
        {
            var fraction = Math.Clamp((double)io.BytesProcessed / io.TotalBytes.Value, 0, 1);
            _currentMeter.Pulse = false;
            _currentMeter.Fraction = fraction;
            _currentText.Text = $"{fileName}    {fraction:P0}";
        }
        else
        {
            _currentMeter.Fraction = 0;
            _currentMeter.Pulse = true;
            _currentText.Text = fileName;
        }
    }

    private void RefreshQuota()
    {
        var quota = QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        var upMax = Math.Max(1, _host.Config.UploadQuotaBytes);
        var downMax = Math.Max(1, _host.Config.DownloadQuotaBytes);
        _uploadMeter.Fraction = Math.Clamp((double)quota.EstimatedUploadUsedBytes / upMax, 0, 1);
        _downloadMeter.Fraction = Math.Clamp((double)quota.EstimatedDownloadUsedBytes / downMax, 0, 1);
        _uploadMeter.SetQuotaColors(_uploadMeter.Fraction);
        _downloadMeter.SetQuotaColors(_downloadMeter.Fraction);
        _uploadText.Text = $"{FormatBytes(quota.EstimatedUploadUsedBytes)} / {FormatBytes(upMax)}";
        _downloadText.Text = $"{FormatBytes(quota.EstimatedDownloadUsedBytes)} / {FormatBytes(downMax)}";
        _resetText.Text = _host.Config.NextResetAt == default
            ? "流量尚未校准"
            : $"{ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt):yyyy-MM-dd} 重置，09:00 后真实探测";
    }

    private void RefreshPrimary(int review)
    {
        if (review > 0)
        {
            _primary.Text = "审查回收站";
            _primary.Enabled = true;
            return;
        }
        if (_host.Config.MigrationEnabled && _host.State.EngineState is EngineState.Running or EngineState.WaitQuota or EngineState.WaitNetwork or EngineState.WaitRetry or EngineState.WaitUser)
        {
            _primary.Text = "暂停";
            _primary.Enabled = true;
        }
        else if (!_host.Config.MigrationEnabled || _host.State.EngineState == EngineState.Paused)
        {
            _primary.Text = "继续";
            _primary.Enabled = true;
        }
        else
        {
            _primary.Text = _host.State.EngineState == EngineState.Complete ? "已完成" : "继续";
            _primary.Enabled = _host.State.EngineState != EngineState.Complete;
        }
    }

    private void RefreshTransfer()
    {
        var priority = PriorityGroupCount();
        var normal = NormalBacklogCount();
        _priorityCount.Text = priority.ToString("N0");
        _normalCount.Text = normal.ToString("N0");
        var verified = _host.State.Files.Values.Count(record => record.Status == TransferStatus.StrongVerified);
        var total = Math.Max(_reconciliation.State.LastManifestObjectCount, _host.State.Files.Count);
        var fraction = total <= 0 ? 0 : Math.Clamp((double)verified / total, 0, 1);
        _transferOverall.Value = Math.Clamp((int)Math.Round(fraction * 1000), 0, 1000);
        _transferStatus.Text = priority > 0
            ? $"正在优先维护历史镜像，普通任务将在 {priority:N0} 个修复组完成后继续。"
            : _host.State.EngineState == EngineState.WaitUser
                ? "普通任务等待回收站人工审查完成。"
                : _host.State.EngineState == EngineState.WaitQuota
                    ? "本周期上传安全额度已不足，等待下一周期。"
                    : $"普通稳定池可继续处理，当前估算待处理约 {normal:N0} 组。";
    }

    private void RefreshRecycle()
    {
        StyleFilter(_recycleObserving, _recycleFilter == RecycleFilterV030.Observing);
        StyleFilter(_recycleReview, _recycleFilter == RecycleFilterV030.Review);
        StyleFilter(_recycleHistory, _recycleFilter == RecycleFilterV030.History);

        var groups = _reconciliation.GetRecycleGroups();
        var filtered = groups.Where(group => _recycleFilter switch
        {
            RecycleFilterV030.Observing => ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId) == RecycleDisposition.Observing,
            RecycleFilterV030.Review => ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId) is RecycleDisposition.ReviewRequired or RecycleDisposition.Blocked,
            _ => ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId) is RecycleDisposition.DeferredThisCycle or RecycleDisposition.Removed
        }).ToArray();

        _recycleGrid.Rows.Clear();
        foreach (var group in filtered)
        {
            var records = GroupRecords(group.GroupKey);
            var size = records.Sum(record => Math.Max(0, record.SourceSize));
            var verified = records.Where(record => record.VerifiedAt.HasValue).Select(record => record.VerifiedAt!.Value).DefaultIfEmpty().Max();
            var disposition = ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId);
            var stateText = disposition switch
            {
                RecycleDisposition.Observing => "首次观察",
                RecycleDisposition.ReviewRequired => "等待人工审查",
                RecycleDisposition.Blocked => "删除检查异常",
                RecycleDisposition.DeferredThisCycle => "本周期保留",
                RecycleDisposition.Removed => "已人工删除",
                _ => "活动"
            };
            var lastDecision = string.IsNullOrWhiteSpace(group.LastDeferredCycleId) ? "" : $"保留 {group.LastDeferredCycleId}";
            var rowIndex = _recycleGrid.Rows.Add(
                Path.GetFileName(group.GroupKey),
                group.FirstMissingCycleId ?? "",
                lastDecision,
                FormatBytes(size),
                verified == default ? "" : verified.ToLocalTime().ToString("yyyy-MM-dd"),
                stateText);
            _recycleGrid.Rows[rowIndex].Tag = group.GroupKey;
            if (!string.IsNullOrWhiteSpace(group.LastIssue))
                _recycleGrid.Rows[rowIndex].Cells[5].ToolTipText = group.LastIssue;
        }
        _recycleGrid.ClearSelection();
        _recycleGrid.CurrentCell = null;

        _recycleHint.Text = _recycleFilter switch
        {
            RecycleFilterV030.Observing => "这些附件组本周期首次从 InfiniCLOUD 消失。坚果云内容不会被修改，至少等到后续已确认额度周期仍缺失后才允许人工审查。",
            RecycleFilterV030.Review => "这里的删除永远不会自动执行。请双击附件组查看历史 StrongVerified 证据，再明确选择删除或本周期继续保留。",
            _ => "这里显示本周期人工保留以及已经人工删除的历史记录。保留项如果下个周期仍缺失，会再次进入待审查。"
        };
        var reviewMode = _recycleFilter == RecycleFilterV030.Review;
        _deferAll.Visible = reviewMode && filtered.Length > 0;
        _deleteSelected.Visible = reviewMode && filtered.Length > 0;
    }

    private int PriorityGroupCount() => _host.State.Files.Values
        .Where(record => record.Status == TransferStatus.SourceChanged)
        .Select(record => record.GroupKey)
        .Where(key => !string.IsNullOrWhiteSpace(key))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .Count();

    private int NormalBacklogCount()
    {
        var stateGroups = _host.State.Files.Values
            .GroupBy(record => record.GroupKey, StringComparer.OrdinalIgnoreCase)
            .Count(group => !string.IsNullOrWhiteSpace(group.Key) &&
                            group.Any(record => record.Status != TransferStatus.StrongVerified && record.Status != TransferStatus.SourceChanged));
        return Math.Max(0, stateGroups + _reconciliation.State.LastNewGroupCount);
    }

    private IReadOnlyList<TransferRecord> GroupRecords(string groupKey) => _host.State.Files.Values
        .Where(record => string.Equals(record.GroupKey, groupKey, StringComparison.OrdinalIgnoreCase))
        .OrderBy(record => record.RelativePath, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private void ShowRecycleDetail(string? groupKey)
    {
        if (string.IsNullOrWhiteSpace(groupKey)) return;
        var group = _reconciliation.FindGroup(groupKey);
        if (group is null) return;
        var records = GroupRecords(groupKey);
        var lines = new List<string>
        {
            $"附件组：{groupKey}",
            $"当前 Cycle：{_reconciliation.CurrentCycleId ?? "未校准"}",
            $"首次缺失：{group.FirstMissingCycleId ?? "无"}",
            $"上次人工保留：{group.LastDeferredCycleId ?? "无"}",
            $"状态：{ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId)}",
            ""
        };
        foreach (var record in records)
        {
            lines.Add(record.RelativePath);
            lines.Add($"  历史大小：{FormatBytes(record.SourceSize)}");
            lines.Add($"  Source SHA256：{record.SourceSha256 ?? "无"}");
            lines.Add($"  Target SHA256：{record.TargetSha256 ?? "无"}");
            lines.Add($"  Target ETag：{record.TargetETag ?? "无"}");
            lines.Add($"  StrongVerified：{(record.VerifiedAt.HasValue ? record.VerifiedAt.Value.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") : "无")}");
            lines.Add("");
        }
        if (!string.IsNullOrWhiteSpace(group.LastIssue)) lines.Add("当前说明：" + group.LastIssue);
        MessageBox.Show(_form, string.Join(Environment.NewLine, lines), "回收站审查详情", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private async Task DeferVisibleReviewAsync()
    {
        var keys = _reconciliation.GetRecycleGroups()
            .Where(group => ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId) is RecycleDisposition.ReviewRequired or RecycleDisposition.Blocked)
            .Select(group => group.GroupKey)
            .ToArray();
        if (keys.Length == 0) return;
        var confirm = MessageBox.Show(_form,
            $"本周期继续保留 {keys.Length} 个待审查附件组。\n\n坚果云内容不会删除。若下个额度周期这些对象仍未回到 InfiniCLOUD，它们会再次进入待审查。",
            "本周期继续保留", MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
        if (confirm != DialogResult.OK) return;
        await _reconciliation.DeferGroupsAsync(keys, _cts.Token).ConfigureAwait(true);
        RefreshRecycle();
        await ContinueAfterReviewAsync().ConfigureAwait(true);
    }

    private async Task DeleteSelectedAsync()
    {
        var keys = _recycleGrid.SelectedRows.Cast<DataGridViewRow>()
            .Select(row => row.Tag as string)
            .Where(key => !string.IsNullOrWhiteSpace(key))
            .Cast<string>()
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (keys.Length == 0)
        {
            MessageBox.Show(_form, "请先在清单中选择至少一个附件组。", "删除审查", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var totalBytes = keys.SelectMany(GroupRecords).Sum(record => Math.Max(0, record.SourceSize));
        var preview = string.Join(Environment.NewLine, keys.Take(12).Select(key => "  " + key));
        if (keys.Length > 12) preview += Environment.NewLine + $"  另有 {keys.Length - 12} 组";
        var confirm = MessageBox.Show(_form,
            $"将从坚果云永久删除以下 {keys.Length} 个 Zotero 附件组，共约 {FormatBytes(totalBytes)}。\n\n{preview}\n\n" +
            "DavBridge 会先再次确认 InfiniCLOUD 中仍不存在这些对象，并确认坚果云目标仍是历史 StrongVerified 的那个副本。任何身份异常都会停止删除。\n\n确认执行所选删除吗？",
            "确认删除所选附件组", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
        if (confirm != DialogResult.Yes) return;

        UseWaitCursor(true);
        try
        {
            var results = await _reconciliation.DeleteGroupsAsync(keys, _cts.Token).ConfigureAwait(true);
            var removed = results.Count(result => result.Removed);
            var recovered = results.Count(result => result.Recovered);
            var blocked = results.Count(result => result.Blocked);
            var details = string.Join(Environment.NewLine, results.Where(result => !result.Removed).Take(10).Select(result => $"{result.GroupKey}: {result.Message}"));
            MessageBox.Show(_form,
                $"删除审查完成。\n\n已删除：{removed}\n源端恢复并取消删除：{recovered}\n安全阻止：{blocked}" +
                (string.IsNullOrWhiteSpace(details) ? string.Empty : "\n\n" + details),
                "回收站处理结果", MessageBoxButtons.OK, blocked > 0 ? MessageBoxIcon.Warning : MessageBoxIcon.Information);
        }
        finally
        {
            UseWaitCursor(false);
            RefreshRecycle();
        }
        await ContinueAfterReviewAsync().ConfigureAwait(true);
    }

    private async Task ContinueAfterReviewAsync()
    {
        if (_reconciliation.GetHumanActionCount() > 0 || !_host.Config.MigrationEnabled || _host.IsRunning) return;
        try { await _host.RunOnceAsync(_cts.Token).ConfigureAwait(true); } catch { }
    }

    private async Task PrimaryAsync()
    {
        if (_reconciliation.GetHumanActionCount() > 0)
        {
            ApplyPage(UiPageV030.Recycle, RecycleFilterV030.Review);
            return;
        }
        if (_host.Config.MigrationEnabled && _host.State.EngineState is not EngineState.Paused and not EngineState.Complete)
            await InvokeMainTaskAsync("PauseAsync").ConfigureAwait(true);
        else if (_host.State.EngineState != EngineState.Complete)
            await InvokeMainTaskAsync("ResumeNowAsync").ConfigureAwait(true);
    }

    private async Task InvokeMainTaskAsync(string methodName)
    {
        try
        {
            var method = typeof(MainForm).GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic);
            if (method?.Invoke(_form, null) is Task task) await task.ConfigureAwait(true);
        }
        catch (TargetInvocationException ex)
        {
            MessageBox.Show(_form, ex.InnerException?.Message ?? ex.Message, "DavBridge", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private void OnProgress(object? sender, EngineProgress progress)
    {
        _progress = progress;
        _io = null;
        SafeUi(RefreshAll);
    }

    private void OnStateChanged(object? sender, EventArgs e) => SafeUi(RefreshAllAndRecycleIfVisible);
    private void OnReconciliationChanged(object? sender, EventArgs e) => SafeUi(RefreshAllAndRecycleIfVisible);

    private void OnIo(object? sender, WebDavIoProgress progress)
    {
        if (!EndpointMatches(progress.BaseAddress, _host.Config.SourceBaseUrl) && !EndpointMatches(progress.BaseAddress, _host.Config.TargetBaseUrl)) return;
        _io = progress;
    }

    private void RefreshResponsive()
    {
        // The v0.3 shell uses fixed typography and width-aware layout with AutoScroll. Do not
        // allocate new Font instances from the 250 ms refresh loop.
    }

    private void UseWaitCursor(bool value)
    {
        _form.UseWaitCursor = value;
        _surface.UseWaitCursor = value;
    }

    private void SafeUi(Action action)
    {
        if (_disposed || _form.IsDisposed) return;
        if (_form.InvokeRequired) _form.BeginInvoke(action); else action();
    }

    private static TableLayoutPanel SectionTable(string title)
    {
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Margin = new Padding(0, 15, 0, 0) };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 96));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.Controls.Add(SectionLabel(title), 0, 0);
        return table;
    }

    private static Panel Card() => new()
    {
        Dock = DockStyle.Top,
        BackColor = Color.FromArgb(249, 251, 252),
        Margin = new Padding(0)
    };

    private static Control PageHeading(string title, string subtitle)
    {
        var stack = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        stack.Controls.Add(new Label { Text = title, AutoSize = true, Font = new Font("Segoe UI Semibold", 16F), ForeColor = Color.FromArgb(35, 44, 50) });
        stack.Controls.Add(new Label { Text = subtitle, AutoSize = true, Font = new Font("Segoe UI", 9F), ForeColor = Color.FromArgb(105, 116, 125), MaximumSize = new Size(760, 0), Margin = new Padding(0, 5, 0, 0) });
        return stack;
    }

    private static Control CountCard(string title, Label count, string hint, Padding margin)
    {
        var panel = Card();
        panel.Height = 112;
        panel.Margin = margin;
        panel.Padding = new Padding(17, 13, 17, 12);
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1 };
        stack.Controls.Add(SectionLabel(title));
        count.Margin = new Padding(0, 5, 0, 2);
        stack.Controls.Add(count);
        stack.Controls.Add(new Label { Text = hint, AutoSize = true, ForeColor = Color.FromArgb(112, 122, 130) });
        panel.Controls.Add(stack);
        return panel;
    }

    private static Control BuildQuotaCell(string title, Label value, MeterV030 meter, Padding margin)
    {
        var cell = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1, Margin = margin };
        var header = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.Controls.Add(new Label { Text = title, AutoSize = true, Font = new Font("Segoe UI Semibold", 9F) }, 0, 0);
        value.Anchor = AnchorStyles.Right;
        header.Controls.Add(value, 1, 0);
        cell.Controls.Add(header);
        meter.Margin = new Padding(0, 4, 0, 0);
        cell.Controls.Add(meter);
        return cell;
    }

    private static Label SectionLabel(string text) => new() { Text = text, AutoSize = true, Font = new Font("Segoe UI Semibold", 10.5F), ForeColor = Color.FromArgb(48, 58, 65), Anchor = AnchorStyles.Left };
    private static Label ValueLabel() => new() { AutoSize = true, ForeColor = Color.FromArgb(70, 82, 91) };
    private static Label StepLabel() => new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 9.2F), Anchor = AnchorStyles.Left };
    private static Label BigCountLabel() => new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 22F), ForeColor = Color.FromArgb(49, 96, 127) };

    private static Button TabButton(string text) => new()
    {
        Text = text,
        Height = 34,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.White,
        ForeColor = Color.FromArgb(77, 89, 97),
        Font = new Font("Segoe UI Semibold", 9.3F),
        Margin = new Padding(0, 0, 4, 0),
        TabStop = false
    };

    private static Button FilterButton(string text) => new()
    {
        Text = text,
        Height = 30,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.White,
        Margin = new Padding(0, 0, 5, 0),
        TabStop = false
    };

    private static void StyleFooterButton(Button button)
    {
        button.BackColor = Color.White;
        button.FlatAppearance.BorderColor = Color.FromArgb(202, 211, 217);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(245, 249, 251);
    }

    private static void StyleTab(Button button, bool active)
    {
        button.FlatAppearance.BorderSize = 0;
        button.BackColor = active ? Color.FromArgb(235, 244, 250) : Color.White;
        button.ForeColor = active ? Color.FromArgb(49, 107, 145) : Color.FromArgb(80, 91, 99);
    }

    private static void StyleFilter(Button button, bool active)
    {
        button.FlatAppearance.BorderSize = 0;
        button.BackColor = active ? Color.FromArgb(239, 246, 250) : Color.White;
        button.ForeColor = active ? Color.FromArgb(52, 108, 143) : Color.FromArgb(87, 98, 106);
    }

    private static Color StepColor(string text) => text.StartsWith("✓", StringComparison.Ordinal)
        ? Color.FromArgb(63, 139, 103)
        : text.StartsWith("!", StringComparison.Ordinal)
            ? Color.FromArgb(184, 126, 45)
            : Color.FromArgb(88, 108, 121);

    private static Color StatusColor(EngineState state) => state switch
    {
        EngineState.WaitUser => Color.FromArgb(190, 132, 47),
        EngineState.WaitRetry => Color.FromArgb(184, 84, 76),
        EngineState.WaitNetwork => Color.FromArgb(116, 128, 140),
        EngineState.WaitQuota => Color.FromArgb(178, 142, 69),
        EngineState.Complete => Color.FromArgb(66, 142, 103),
        EngineState.Running => Color.FromArgb(66, 131, 169),
        _ => Color.FromArgb(112, 123, 132)
    };

    private static bool EndpointMatches(string left, string right)
    {
        if (!Uri.TryCreate(left, UriKind.Absolute, out var a) || !Uri.TryCreate(right, UriKind.Absolute, out var b)) return false;
        return string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) && a.Port == b.Port;
    }

    private static bool PathMatches(string ioPath, string relative) =>
        ioPath.Replace('\\', '/').Trim('/').EndsWith(relative.Replace('\\', '/').Trim('/'), StringComparison.OrdinalIgnoreCase);

    private static string FormatBytes(long bytes)
    {
        var value = Math.Max(0, bytes);
        if (value >= 1_000_000_000L) return $"{value / 1_000_000_000d:0.00} GB";
        if (value >= 1_000_000L) return $"{value / 1_000_000d:0.0} MB";
        if (value >= 1_000L) return $"{value / 1_000d:0.0} KB";
        return $"{value} B";
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _cts.Cancel();
        _host.ProgressChanged -= OnProgress;
        _host.StateChanged -= OnStateChanged;
        _reconciliation.Changed -= OnReconciliationChanged;
        WebDavReadClient.GlobalIoProgress -= OnIo;
        _cts.Dispose();
        _timer.Dispose();
        if (!_surface.IsDisposed) _surface.Dispose();
    }
}

internal sealed class RoutePanelV030 : Control
{
    private string _status = "准备中";
    private Color _statusColor = Color.FromArgb(66, 131, 169);

    public RoutePanelV030()
    {
        DoubleBuffered = true;
        BackColor = Color.White;
    }

    public void SetStatus(string status, Color color)
    {
        if (_status == status && _statusColor == color) return;
        _status = status;
        _statusColor = color;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var titleFont = new Font("Segoe UI Semibold", 12F);
        using var statusFont = new Font("Segoe UI", 9F);
        using var routePen = new Pen(Color.FromArgb(137, 174, 196), 2.2F) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round };
        using var dot = new SolidBrush(Color.FromArgb(88, 149, 184));
        using var statusBrush = new SolidBrush(_statusColor);
        using var textBrush = new SolidBrush(Color.FromArgb(48, 59, 66));

        var centerY = Height / 2 - 2;
        var leftX = Math.Max(88, Width / 4);
        var rightX = Math.Min(Width - 88, Width * 3 / 4);
        g.FillEllipse(dot, leftX - 5, centerY - 5, 10, 10);
        g.FillEllipse(dot, rightX - 5, centerY - 5, 10, 10);
        g.DrawLine(routePen, leftX + 9, centerY, rightX - 18, centerY);
        DrawChevron(g, routePen, (leftX + rightX) / 2 - 13, centerY);
        DrawChevron(g, routePen, (leftX + rightX) / 2 + 3, centerY);

        DrawCentered(g, "InfiniCLOUD", titleFont, textBrush, leftX, centerY - 31);
        DrawCentered(g, "坚果云", titleFont, textBrush, rightX, centerY - 31);
        DrawCentered(g, _status, statusFont, statusBrush, (leftX + rightX) / 2, centerY + 18);
    }

    private static void DrawChevron(Graphics g, Pen pen, int x, int y)
    {
        g.DrawLines(pen, new[] { new Point(x - 5, y - 7), new Point(x + 2, y), new Point(x - 5, y + 7) });
    }

    private static void DrawCentered(Graphics g, string text, Font font, Brush brush, int centerX, int y)
    {
        var size = g.MeasureString(text, font);
        g.DrawString(text, font, brush, centerX - size.Width / 2, y);
    }
}

internal sealed class MeterV030 : Control
{
    private double _fraction;
    private int _pulse;
    public bool Pulse { get; set; }
    public Color StartColor { get; set; } = Color.FromArgb(124, 184, 215);
    public Color EndColor { get; set; } = Color.FromArgb(72, 145, 184);
    public Func<string>? DisplayTextProvider { get; set; }
    public ContentAlignment DisplayTextAlignment { get; set; } = ContentAlignment.MiddleCenter;
    public Color DisplayTextColor { get; set; } = Color.FromArgb(42, 54, 62);
    public float DisplayTextFontSize { get; set; } = 8.2F;
    public bool SuppressPulseWhenText { get; set; }

    public double Fraction
    {
        get => _fraction;
        set { _fraction = Math.Clamp(value, 0, 1); Invalidate(); }
    }

    public MeterV030()
    {
        DoubleBuffered = true;
        BackColor = Color.FromArgb(238, 242, 244);
    }

    public void AdvancePulse()
    {
        if (!Pulse) return;
        _pulse = (_pulse + 5) % 160;
        Invalidate();
    }

    public void SetQuotaColors(double fraction)
    {
        if (fraction >= 0.90)
        {
            StartColor = Color.FromArgb(220, 143, 137);
            EndColor = Color.FromArgb(187, 91, 84);
        }
        else if (fraction >= 0.60)
        {
            StartColor = Color.FromArgb(224, 196, 120);
            EndColor = Color.FromArgb(184, 145, 66);
        }
        else
        {
            StartColor = Color.FromArgb(123, 184, 153);
            EndColor = Color.FromArgb(70, 145, 108);
        }
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
        using var path = Rounded(rect, Math.Min(7, Height / 2));
        using var track = new SolidBrush(Color.FromArgb(238, 242, 244));
        g.FillPath(track, path);

        var displayText = DisplayTextProvider?.Invoke() ?? string.Empty;
        var drawPulse = Pulse && !(SuppressPulseWhenText && !string.IsNullOrWhiteSpace(displayText));

        g.SetClip(path);
        if (drawPulse)
        {
            var w = Math.Max(50, Width / 4);
            var x = (_pulse * (Width + w) / 160) - w;
            using var pulse = new System.Drawing.Drawing2D.LinearGradientBrush(new Rectangle(x, 0, w, Height), Color.FromArgb(190, StartColor), Color.FromArgb(190, EndColor), 0F);
            g.FillRectangle(pulse, x, 0, w, Height);
        }
        else if (_fraction > 0)
        {
            var fillWidth = Math.Max(1, (int)Math.Round(Width * _fraction));
            using var brush = new System.Drawing.Drawing2D.LinearGradientBrush(new Rectangle(0, 0, Math.Max(1, fillWidth), Height), StartColor, EndColor, 0F);
            g.FillRectangle(brush, 0, 0, fillWidth, Height);
        }
        g.ResetClip();

        if (!string.IsNullOrWhiteSpace(displayText))
            DrawDisplayText(g, displayText);
    }

    private void DrawDisplayText(Graphics graphics, string text)
    {
        using var font = new Font("Segoe UI Semibold", DisplayTextFontSize, FontStyle.Regular, GraphicsUnit.Point);
        var bounds = new Rectangle(7, 0, Math.Max(1, Width - 14), Math.Max(1, Height));
        var flags = TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding;
        flags |= DisplayTextAlignment switch
        {
            ContentAlignment.MiddleLeft => TextFormatFlags.Left,
            ContentAlignment.MiddleRight => TextFormatFlags.Right,
            _ => TextFormatFlags.HorizontalCenter
        };
        TextRenderer.DrawText(graphics, text, font, bounds, DisplayTextColor, flags);
    }

    private static System.Drawing.Drawing2D.GraphicsPath Rounded(Rectangle rect, int radius)
    {
        var path = new System.Drawing.Drawing2D.GraphicsPath();
        var d = Math.Max(2, radius * 2);
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class ActionBannerV030 : Control
{
    private string _title = string.Empty;
    private string _detail = string.Empty;
    private string _action = string.Empty;
    public event EventHandler? ActionClicked;

    public ActionBannerV030()
    {
        DoubleBuffered = true;
        Cursor = Cursors.Hand;
        BackColor = Color.White;
    }

    public void SetText(string title, string detail, string action)
    {
        _title = title;
        _detail = detail;
        _action = action;
        Invalidate();
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button == MouseButtons.Left) ActionClicked?.Invoke(this, EventArgs.Empty);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var back = new SolidBrush(Color.FromArgb(253, 248, 236));
        using var border = new Pen(Color.FromArgb(225, 196, 136));
        using var titleBrush = new SolidBrush(Color.FromArgb(146, 99, 28));
        using var detailBrush = new SolidBrush(Color.FromArgb(103, 91, 70));
        using var actionBrush = new SolidBrush(Color.FromArgb(61, 110, 142));
        using var titleFont = new Font("Segoe UI Semibold", 9.8F);
        using var font = new Font("Segoe UI", 9F);
        var rect = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
        g.FillRectangle(back, rect);
        g.DrawRectangle(border, rect);
        g.DrawString("⚠  " + _title, titleFont, titleBrush, 14, 10);
        g.DrawString(_detail, font, detailBrush, 15, 34);
        var actionSize = g.MeasureString(_action + "  ›", titleFont);
        g.DrawString(_action + "  ›", titleFont, actionBrush, Width - actionSize.Width - 16, 21);
    }
}