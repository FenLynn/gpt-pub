using System.Drawing.Drawing2D;
using System.Reflection;
using DavBridge.Core;

namespace DavBridge;

internal enum UiPageV032
{
    Overview,
    Transfer,
    Recycle,
    Docs
}

internal enum RecycleFilterV032
{
    Observing,
    Review,
    History
}

/// <summary>
/// v0.3.2 consolidated UI shell.
/// Presentation only: migration, reconciliation, quota and delete safety remain owned by Core/ReconciliationRuntimeV030.
/// </summary>
internal sealed class UiShellV032 : IDisposable
{
    private static readonly Color Ink = Color.FromArgb(38, 49, 57);
    private static readonly Color Muted = Color.FromArgb(98, 111, 121);
    private static readonly Color Line = Color.FromArgb(229, 234, 238);
    private static readonly Color Soft = Color.FromArgb(247, 250, 252);
    private static readonly Color BlueSoft = Color.FromArgb(234, 244, 250);
    private static readonly Color BlueInk = Color.FromArgb(48, 104, 141);
    private static readonly Color Green = Color.FromArgb(60, 139, 101);
    private static readonly Color Amber = Color.FromArgb(177, 125, 43);

    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly ReconciliationRuntimeV030 _reconciliation;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private readonly CancellationTokenSource _cts = new();
    private readonly ToolTip _tips = new()
    {
        InitialDelay = 450,
        ReshowDelay = 100,
        AutoPopDelay = 10000,
        ShowAlways = true
    };

    private readonly Panel _surface = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly TableLayoutPanel _root = new() { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, BackColor = Color.White };
    private readonly Label _title = new() { Text = "Zotero 镜像维护", AutoSize = true, Font = new Font("Segoe UI Semibold", 16F), ForeColor = Ink };
    private readonly Label _cycle = new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 8.6F), ForeColor = BlueInk, BackColor = BlueSoft, Padding = new Padding(9, 4, 9, 4) };
    private readonly Button _settings = QuietIconButton("⚙");
    private readonly Button _tabOverview = TabButton("总览", 74);
    private readonly Button _tabTransfer = TabButton("转移", 74);
    private readonly Button _tabRecycle = TabButton("回收站", 86);
    private readonly Button _tabDocs = TabButton("文档", 74);
    private readonly Panel _content = new() { Dock = DockStyle.Fill, BackColor = Color.White, AutoScroll = false };

    private readonly Panel _overviewPage = PagePanel();
    private readonly Panel _transferPage = PagePanel();
    private readonly Panel _recyclePage = PagePanel();
    private readonly Panel _docsPage = PagePanel();

    private readonly Button _manualBanner = new()
    {
        Dock = DockStyle.Fill,
        Height = 38,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.FromArgb(253, 248, 236),
        ForeColor = Color.FromArgb(142, 96, 28),
        Font = new Font("Segoe UI Semibold", 9.2F),
        TextAlign = ContentAlignment.MiddleLeft,
        Padding = new Padding(12, 0, 12, 0),
        TabStop = false,
        Visible = false
    };
    private readonly LogoRoutePanelV032 _route = new() { Dock = DockStyle.Fill };
    private readonly Label _stageAudit = StageLabel();
    private readonly Label _stageRepair = StageLabel();
    private readonly Label _stageTransfer = StageLabel();
    private readonly MeterV030 _coverageMeter = new() { Dock = DockStyle.Fill, Height = 20 };
    private readonly Label _coverageText = MainValueLabel();
    private readonly Label _currentText = MainValueLabel();
    private readonly MeterV030 _currentMeter = new() { Dock = DockStyle.Fill, Height = 20, Pulse = true };
    private readonly Label _uploadText = MainValueLabel();
    private readonly Label _downloadText = MainValueLabel();
    private readonly MeterV030 _uploadMeter = new() { Dock = DockStyle.Fill, Height = 14 };
    private readonly MeterV030 _downloadMeter = new() { Dock = DockStyle.Fill, Height = 14 };
    private readonly Label _resetText = new() { AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8.5F) };
    private readonly Button _primary = PrimaryButton("暂停");

    private readonly Label _priorityCount = CountLabel();
    private readonly Label _normalCount = CountLabel();
    private readonly Label _transferState = MainValueLabel();
    private readonly Label _transferCurrent = MainValueLabel();
    private readonly MeterV030 _transferMeter = new() { Dock = DockStyle.Fill, Height = 18 };
    private readonly MeterV030 _transferOverall = new() { Dock = DockStyle.Fill, Height = 16 };

    private readonly Button _recycleObserving = FilterButton("待观察");
    private readonly Button _recycleReview = FilterButton("待审查");
    private readonly Button _recycleHistory = FilterButton("已处理");
    private readonly Label _recycleCount = new() { AutoSize = true, ForeColor = Muted, Font = new Font("Segoe UI", 8.6F), Anchor = AnchorStyles.Left };
    private readonly DataGridView _recycleGrid = new();
    private readonly Button _deferAll = QuietButton("本周期全部保留", 126);
    private readonly Button _deleteSelected = DangerButton("删除所选", 96);

    private readonly ListBox _docNav = new()
    {
        Dock = DockStyle.Fill,
        BorderStyle = BorderStyle.None,
        BackColor = Soft,
        ForeColor = Ink,
        Font = new Font("Microsoft YaHei UI", 9.2F),
        IntegralHeight = false
    };
    private readonly RichTextBox _docBody = new()
    {
        Dock = DockStyle.Fill,
        BorderStyle = BorderStyle.None,
        ReadOnly = true,
        BackColor = Color.White,
        ForeColor = Ink,
        Font = new Font("Microsoft YaHei UI", 9.4F),
        DetectUrls = false,
        ScrollBars = RichTextBoxScrollBars.Vertical
    };

    private UiPageV032 _page = UiPageV032.Overview;
    private RecycleFilterV032 _recycleFilter = RecycleFilterV032.Observing;
    private EngineProgress? _progress;
    private WebDavIoProgress? _io;
    private DateTimeOffset _nextPassiveAudit = DateTimeOffset.MinValue;
    private bool _passiveAuditRunning;
    private bool _disposed;

    private static readonly (string Title, string Body)[] Docs =
    {
        ("使用概览", "DavBridge 用于长期维护 Zotero 附件从 InfiniCLOUD 到坚果云的单向强校验镜像。\n\n日常情况下不需要人工干预。程序会在真实额度周期开始后先对账，再处理历史修改，最后使用剩余额度继续普通迁移。\n\n只有回收站成熟候选、冲突、认证异常等无法安全自动决定的情况才会要求人工处理。"),
        ("镜像原则", "InfiniCLOUD 是唯一权威源，并且始终只读。\n\n坚果云保存已经验证或正在迁移的镜像子集。新增源对象只进入普通任务池，不插队。已验证对象如果源端发生真正内容变化，则优先修复。\n\n程序不做双向同步，不把坚果云变化反写到 InfiniCLOUD。"),
        ("StrongVerified", "StrongVerified 表示某个文件在核准时刻已经完成源端 SHA256 与目标端重新下载 SHA256 的一致性确认。\n\n这个 SHA256 是后续维护的历史核准基线。普通 metadata 扫描不会随意覆盖它。只有重新完成强校验后才建立新的核准基线。"),
        ("Cycle 与额度", "Cycle ID 使用启动当前坚果云额度周期的真实重置日期，格式为 yyMMdd，例如 2026-09-07 对应 260907。\n\n程序不会仅按自然月或午夜盲目重置账本。到达配置的重置日后，会在 09:00 以后通过真实探测确认新的服务周期已经开始。\n\n确认成功后才进入新 Cycle，并优先执行本周期源端对账。"),
        ("源端对账", "每个已确认新 Cycle 开始后，DavBridge 自动读取 InfiniCLOUD 当前清单并与历史 StrongVerified 账本比较。\n\n源 metadata 未变化时不读取文件内容。metadata 变化时只重新读取 InfiniCLOUD 并计算 SHA256。\n\n如果 SHA256 没变，只更新 metadata。如果 SHA256 真改变，文件组进入 SourceChanged，优先于普通任务刷新目标。"),
        ("转移优先级", "任务始终只有两个逻辑层级。\n\n第一层是优先修复，即源端内容真正改变的历史 StrongVerified 组。\n\n第二层是普通任务，包括既有 backlog 和本周期新增对象。新增对象与历史未迁移对象同级，不额外插队。\n\n只要优先修复仍存在，普通任务就等待。"),
        ("回收站", "源端删除采用跨周期逻辑回收站。第一次发现一个历史 StrongVerified 组在 InfiniCLOUD 完全消失，只记录首次缺失 Cycle，坚果云内容完全不动。\n\n至少跨到后续已确认额度周期仍然缺失，才进入待审查。\n\n待审查对象永远不会自动 DELETE。你必须人工选择删除或本周期继续保留。继续保留的对象如果下个周期仍缺失，会再次进入审查。"),
        ("删除安全", "人工点击删除以后仍不是直接删除。程序会再次检查 InfiniCLOUD 准确路径，确认整个 zip + prop 组仍然缺失，并核对坚果云目标仍然是历史 StrongVerified 的那个对象。\n\n目标身份无法由 metadata 安全证明时，只有下载安全额度允许才重新读取目标并比对历史 SHA256。\n\nDELETE 结果如果因网络或超时不确定，会先查询真实目标状态，绝不盲目重复 DELETE。"),
        ("状态与提示", "正常运行时首页只显示当前 Cycle、阶段、镜像覆盖、当前任务和额度。\n\n需要人工时，首页会出现醒目的单行提示并暂停普通迁移。\n\n等待下一周期表示当前安全上传额度不足。等待网络表示连接条件暂时不满足。需要处理表示任务已经安全停止，需要检查具体原因。"),
        ("常见问题", "为什么校核时坚果云流量可能几乎不变？\n很多校核只是 PROPFIND 或 metadata 探测，只有需要内容级身份确认时才会 GET 文件。\n\n为什么新文件不优先？\n新增文件与已有 backlog 的角色相同。系统先保证已经存在的镜像仍然正确，再扩大镜像覆盖。\n\n为什么删除要等一个周期？\n这样可以过滤临时不可见、服务故障或短期误判。即使跨周期确认，最终 DELETE 仍必须人工批准。")
    };

    private UiShellV032(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation)
    {
        _form = form;
        _host = host;
        _reconciliation = reconciliation;
        Build();
        Wire();
        ApplyPage(UiPageV032.Overview);
        RefreshAll();
        _timer.Start();
    }

    public static UiShellV032 Attach(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation) => new(form, host, reconciliation);

    internal void ValidateLayout(string scenario)
    {
        _form.PerformLayout();
        if (_root.Width <= 0 || _root.Height <= 0) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: v0.3.2 root not laid out");
        if (_content.Width < 420) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: content too narrow");
        if (_tabDocs.Width < 60 || _tabRecycle.Width < 70) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: top navigation clipped");
        if (!_content.AutoScroll && (_content.HorizontalScroll.Visible || _content.VerticalScroll.Visible))
            throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: unexpected default shell scrollbar");
        if (_form.ClientSize.Width >= 900 && _form.ClientSize.Height >= 620)
        {
            if (_route.Width < 520 || _route.Height < 72) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: route clipped");
            if (_primary.Bottom > _overviewPage.ClientSize.Height + 2) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: primary action clipped");
        }
    }

    private void Build()
    {
        _form.MinimumSize = new Size(760, 560);
        if (_form.Width < 900) _form.Width = 900;
        if (_form.Height < 620) _form.Height = 620;

        foreach (Control control in _form.Controls) control.Visible = false;
        _form.Controls.Add(_surface);
        _surface.BringToFront();

        _root.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
        _root.RowStyles.Add(new RowStyle(SizeType.Absolute, 40));
        _root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _surface.Controls.Add(_root);
        _root.Controls.Add(BuildHeader(), 0, 0);
        _root.Controls.Add(BuildTabs(), 0, 1);
        _root.Controls.Add(_content, 0, 2);

        BuildOverview();
        BuildTransfer();
        BuildRecycle();
        BuildDocs();
        _content.Controls.Add(_overviewPage);
        _content.Controls.Add(_transferPage);
        _content.Controls.Add(_recyclePage);
        _content.Controls.Add(_docsPage);

        ConfigureToolTips();
    }

    private Control BuildHeader()
    {
        var header = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, Padding = new Padding(28, 15, 28, 5), BackColor = Color.White };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 40));
        _title.Anchor = AnchorStyles.Left;
        _cycle.Anchor = AnchorStyles.Right;
        _cycle.Margin = new Padding(0, 2, 10, 0);
        _settings.Anchor = AnchorStyles.Right;
        header.Controls.Add(_title, 0, 0);
        header.Controls.Add(_cycle, 1, 0);
        header.Controls.Add(_settings, 2, 0);
        return header;
    }

    private Control BuildTabs()
    {
        var holder = new Panel { Dock = DockStyle.Fill, Padding = new Padding(28, 0, 28, 0), BackColor = Color.White };
        var tabs = new FlowLayoutPanel { Dock = DockStyle.Left, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Padding = new Padding(0, 2, 0, 0) };
        tabs.Controls.AddRange(new Control[] { _tabOverview, _tabTransfer, _tabRecycle, _tabDocs });
        holder.Controls.Add(tabs);
        holder.Controls.Add(new Panel { Dock = DockStyle.Bottom, Height = 1, BackColor = Line });
        return holder;
    }

    private void BuildOverview()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 6,
            Padding = new Padding(26, 8, 26, 12),
            BackColor = Color.White
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 0));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 126));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        _manualBanner.FlatAppearance.BorderColor = Color.FromArgb(226, 199, 145);
        _manualBanner.FlatAppearance.MouseOverBackColor = Color.FromArgb(250, 243, 228);
        root.Controls.Add(_manualBanner, 0, 0);
        root.Controls.Add(_route, 0, 1);
        root.Controls.Add(BuildStageStrip(), 0, 2);
        root.Controls.Add(BuildOverviewMain(), 0, 3);
        root.Controls.Add(BuildQuotaStrip(), 0, 4);
        root.Controls.Add(BuildOverviewActions(), 0, 5);
        _overviewPage.Controls.Add(root);
    }

    private Control BuildStageStrip()
    {
        var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 4, Margin = new Padding(0), BackColor = Color.White };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 72));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3F));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.3F));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.4F));
        table.Controls.Add(SectionLabel("本周期"), 0, 0);
        table.Controls.Add(_stageAudit, 1, 0);
        table.Controls.Add(_stageRepair, 2, 0);
        table.Controls.Add(_stageTransfer, 3, 0);
        return table;
    }

    private Control BuildOverviewMain()
    {
        var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Margin = new Padding(0), BackColor = Color.White };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        table.Controls.Add(BuildMetricPanel("镜像覆盖", _coverageText, _coverageMeter, new Padding(0, 6, 10, 6)), 0, 0);
        table.Controls.Add(BuildMetricPanel("当前任务", _currentText, _currentMeter, new Padding(10, 6, 0, 6)), 1, 0);
        return table;
    }

    private Control BuildMetricPanel(string title, Label value, Control meter, Padding margin)
    {
        var card = new Panel { Dock = DockStyle.Fill, BackColor = Soft, Margin = margin, Padding = new Padding(16, 12, 16, 12) };
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3 };
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        var heading = SectionLabel(title);
        value.AutoEllipsis = true;
        value.Dock = DockStyle.Fill;
        value.TextAlign = ContentAlignment.MiddleLeft;
        stack.Controls.Add(heading, 0, 0);
        stack.Controls.Add(value, 0, 1);
        stack.Controls.Add(meter, 0, 2);
        card.Controls.Add(stack);
        _tips.SetToolTip(heading, title == "镜像覆盖"
            ? "StrongVerified 表示源端与目标端内容曾完成 SHA256 一致性核准。"
            : "显示当前正在执行、等待或被阻塞的实际动作。详情可在“转移”页查看。");
        return card;
    }

    private Control BuildQuotaStrip()
    {
        var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, Margin = new Padding(0), BackColor = Color.White };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 72));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        table.Controls.Add(SectionLabel("本周期"), 0, 0);
        table.Controls.Add(BuildQuotaCell("上传", _uploadText, _uploadMeter, new Padding(0, 8, 10, 4)), 1, 0);
        table.Controls.Add(BuildQuotaCell("下载", _downloadText, _downloadMeter, new Padding(10, 8, 0, 4)), 2, 0);
        _resetText.Anchor = AnchorStyles.Right;
        _resetText.Margin = new Padding(0, 2, 0, 0);
        table.Controls.Add(_resetText, 1, 1);
        table.SetColumnSpan(_resetText, 2);
        return table;
    }

    private Control BuildQuotaCell(string title, Label value, MeterV030 meter, Padding margin)
    {
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Margin = margin };
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 16));
        var heading = new Label { Text = title, AutoSize = true, Font = new Font("Segoe UI Semibold", 9F), ForeColor = Ink };
        value.Dock = DockStyle.Fill;
        value.TextAlign = ContentAlignment.MiddleLeft;
        stack.Controls.Add(heading, 0, 0);
        stack.Controls.Add(value, 0, 1);
        stack.Controls.Add(meter, 0, 2);
        _tips.SetToolTip(heading, title == "上传"
            ? "本周期坚果云上传额度的本地安全账本。程序会预留安全空间，不会把额度打满后再盲目写入。"
            : "本周期坚果云下载额度。metadata 探测通常不会等同于完整文件下载，内容 GET 才会计入验证下载账本。");
        return stack;
    }

    private Control BuildOverviewActions()
    {
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _primary.Anchor = AnchorStyles.Bottom | AnchorStyles.Right;
        _primary.Margin = new Padding(0, 0, 0, 2);
        row.Controls.Add(_primary, 1, 0);
        return row;
    }

    private void BuildTransfer()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5, Padding = new Padding(26, 18, 26, 18), BackColor = Color.White };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 82));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 128));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 94));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(PageTitle("转移", "迁移队列、优先级和当前任务说明均可悬浮查看，完整规则见“文档”。"), 0, 0);
        root.Controls.Add(BuildTransferStatus(), 0, 1);
        root.Controls.Add(BuildQueueTable(), 0, 2);
        root.Controls.Add(BuildTransferCurrent(), 0, 3);
        root.Controls.Add(BuildTransferOverall(), 0, 4);
        _transferPage.Controls.Add(root);
    }

    private Control BuildTransferStatus()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Soft, Margin = new Padding(0, 6, 0, 8), Padding = new Padding(16, 10, 16, 10) };
        var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 116));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        table.Controls.Add(SectionLabel("当前状态"), 0, 0);
        _transferState.Dock = DockStyle.Fill;
        _transferState.TextAlign = ContentAlignment.MiddleLeft;
        _transferState.AutoEllipsis = true;
        table.Controls.Add(_transferState, 1, 0);
        panel.Controls.Add(table);
        return panel;
    }

    private Control BuildQueueTable()
    {
        var card = new Panel { Dock = DockStyle.Fill, BackColor = Color.White, Margin = new Padding(0, 4, 0, 4) };
        var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 3, CellBorderStyle = TableLayoutPanelCellBorderStyle.Single };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 65));
        table.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        table.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
        table.BackColor = Line;
        table.Controls.Add(TableCell("任务池", true), 0, 0);
        table.Controls.Add(TableCell("数量", true), 1, 0);
        table.Controls.Add(TableCell("处理顺序", true), 2, 0);
        table.Controls.Add(TableCell("优先修复"), 0, 1);
        table.Controls.Add(CountCell(_priorityCount), 1, 1);
        table.Controls.Add(TableCell("源端内容真正变化的历史镜像，始终先处理"), 2, 1);
        table.Controls.Add(TableCell("普通任务"), 0, 2);
        table.Controls.Add(CountCell(_normalCount), 1, 2);
        table.Controls.Add(TableCell("既有 backlog 与新发现对象同级"), 2, 2);
        card.Controls.Add(table);
        _tips.SetToolTip(card, "新增对象不会插队。只有 SourceChanged 历史镜像属于优先修复。优先修复未清空时，普通任务等待。");
        return card;
    }

    private static Control CountCell(Label count)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Color.White };
        count.Dock = DockStyle.Fill;
        count.TextAlign = ContentAlignment.MiddleCenter;
        panel.Controls.Add(count);
        return panel;
    }

    private Control BuildTransferCurrent()
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = Soft, Margin = new Padding(0, 8, 0, 4), Padding = new Padding(16, 10, 16, 10) };
        var stack = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3 };
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        stack.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
        stack.Controls.Add(SectionLabel("当前任务"), 0, 0);
        _transferCurrent.Dock = DockStyle.Fill;
        _transferCurrent.TextAlign = ContentAlignment.MiddleLeft;
        _transferCurrent.AutoEllipsis = true;
        stack.Controls.Add(_transferCurrent, 0, 1);
        stack.Controls.Add(_transferMeter, 0, 2);
        panel.Controls.Add(stack);
        return panel;
    }

    private Control BuildTransferOverall()
    {
        var panel = new Panel { Dock = DockStyle.Top, Height = 62, BackColor = Color.White, Padding = new Padding(0, 12, 0, 0) };
        var stack = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 1 };
        stack.Controls.Add(SectionLabel("镜像覆盖"));
        _transferOverall.Margin = new Padding(0, 8, 0, 0);
        stack.Controls.Add(_transferOverall);
        panel.Controls.Add(stack);
        return panel;
    }

    private void BuildRecycle()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 4, Padding = new Padding(26, 18, 26, 14), BackColor = Color.White };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        root.Controls.Add(PageTitle("回收站", "删除采用跨周期观察和人工审批。完整安全规则见“文档”。"), 0, 0);

        var filterRow = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        filterRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        filterRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var filters = new FlowLayoutPanel { Dock = DockStyle.Left, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Padding = new Padding(0, 4, 0, 0) };
        filters.Controls.AddRange(new Control[] { _recycleObserving, _recycleReview, _recycleHistory });
        filterRow.Controls.Add(filters, 0, 0);
        _recycleCount.Anchor = AnchorStyles.Right;
        filterRow.Controls.Add(_recycleCount, 1, 0);
        root.Controls.Add(filterRow, 0, 1);

        ConfigureRecycleGrid();
        root.Controls.Add(_recycleGrid, 0, 2);

        var footer = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Padding = new Padding(0, 8, 0, 0) };
        _deleteSelected.Margin = new Padding(8, 0, 0, 0);
        footer.Controls.Add(_deleteSelected);
        footer.Controls.Add(_deferAll);
        root.Controls.Add(footer, 0, 3);
        _recyclePage.Controls.Add(root);
    }

    private void ConfigureRecycleGrid()
    {
        _recycleGrid.Dock = DockStyle.Fill;
        _recycleGrid.BackgroundColor = Color.White;
        _recycleGrid.BorderStyle = BorderStyle.None;
        _recycleGrid.GridColor = Color.FromArgb(235, 239, 242);
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
        _recycleGrid.EnableHeadersVisualStyles = false;
        _recycleGrid.ColumnHeadersHeight = 34;
        _recycleGrid.ColumnHeadersHeightSizeMode = DataGridViewColumnHeadersHeightSizeMode.DisableResizing;
        _recycleGrid.ColumnHeadersDefaultCellStyle.BackColor = Soft;
        _recycleGrid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(77, 91, 101);
        _recycleGrid.ColumnHeadersDefaultCellStyle.Font = new Font("Segoe UI Semibold", 8.8F);
        _recycleGrid.DefaultCellStyle.BackColor = Color.White;
        _recycleGrid.DefaultCellStyle.ForeColor = Ink;
        _recycleGrid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(232, 243, 249);
        _recycleGrid.DefaultCellStyle.SelectionForeColor = Ink;
        _recycleGrid.DefaultCellStyle.Padding = new Padding(4, 5, 4, 5);
        _recycleGrid.RowTemplate.MinimumHeight = 34;
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Group", HeaderText = "附件组", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill, FillWeight = 40 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "FirstMissing", HeaderText = "首次缺失", Width = 94 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "LastDecision", HeaderText = "上次决定", Width = 104 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Size", HeaderText = "历史大小", Width = 92 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Verified", HeaderText = "最后强校验", Width = 118 });
        _recycleGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "State", HeaderText = "状态", Width = 118 });
    }

    private void BuildDocs()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2, Padding = new Padding(26, 18, 26, 16), BackColor = Color.White };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(PageTitle("文档", "程序规则随版本固化在这里，主界面只保留运行所需信息。"), 0, 0);

        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            FixedPanel = FixedPanel.Panel1,
            SplitterWidth = 1,
            SplitterDistance = 174,
            BackColor = Line,
            IsSplitterFixed = false
        };
        split.Panel1.BackColor = Soft;
        split.Panel1.Padding = new Padding(8, 10, 8, 10);
        split.Panel2.BackColor = Color.White;
        split.Panel2.Padding = new Padding(22, 12, 4, 6);
        foreach (var doc in Docs) _docNav.Items.Add(doc.Title);
        _docNav.SelectedIndex = 0;
        split.Panel1.Controls.Add(_docNav);
        split.Panel2.Controls.Add(_docBody);
        root.Controls.Add(split, 0, 1);
        _docsPage.Controls.Add(root);
        LoadDoc(0);
    }

    private void ConfigureToolTips()
    {
        _tips.SetToolTip(_cycle, "Cycle 使用真实坚果云额度周期的重置日期，格式 yyMMdd。只有重置探测确认成功后才进入新 Cycle。");
        _tips.SetToolTip(_route, "InfiniCLOUD 是只读权威源，坚果云保存经过强校验的单向镜像子集。中间状态表示当前实际阶段。");
        _tips.SetToolTip(_stageAudit, "每个新 Cycle 自动对比当前 InfiniCLOUD manifest 与历史核准账本。");
        _tips.SetToolTip(_stageRepair, "源端内容真正变化的历史 StrongVerified 组优先修复。metadata 变化但 SHA 不变不会重传。");
        _tips.SetToolTip(_stageTransfer, "优先修复和人工门完成后，剩余额度用于普通 backlog。新增对象与旧 backlog 同级。");
        _tips.SetToolTip(_resetText, "到达重置日后不会盲目清零账本。09:00 后通过真实探测确认新服务周期。");
        _tips.SetToolTip(_recycleObserving, "本周期首次完整缺失，只观察，目标不动。");
        _tips.SetToolTip(_recycleReview, "跨后续已确认 Cycle 仍缺失，才进入人工审查。DELETE 永远需要人工确认。");
        _tips.SetToolTip(_recycleHistory, "显示本周期人工保留和已经人工删除的历史记录。");
        _tips.SetToolTip(_settings, "连接、额度、迁移与启动设置");
    }

    private void Wire()
    {
        _tabOverview.Click += (_, _) => ApplyPage(UiPageV032.Overview);
        _tabTransfer.Click += (_, _) => ApplyPage(UiPageV032.Transfer);
        _tabRecycle.Click += (_, _) => ApplyPage(UiPageV032.Recycle);
        _tabDocs.Click += (_, _) => ApplyPage(UiPageV032.Docs);
        _settings.Click += async (_, _) => await InvokeMainTaskAsync("EditSettingsAsync").ConfigureAwait(true);
        _primary.Click += async (_, _) => await PrimaryAsync().ConfigureAwait(true);
        _manualBanner.Click += (_, _) => ApplyPage(UiPageV032.Recycle, RecycleFilterV032.Review);
        _recycleObserving.Click += (_, _) => ApplyRecycleFilter(RecycleFilterV032.Observing);
        _recycleReview.Click += (_, _) => ApplyRecycleFilter(RecycleFilterV032.Review);
        _recycleHistory.Click += (_, _) => ApplyRecycleFilter(RecycleFilterV032.History);
        _recycleGrid.CellDoubleClick += (_, e) => { if (e.RowIndex >= 0) ShowRecycleDetail(_recycleGrid.Rows[e.RowIndex].Tag as string); };
        _deferAll.Click += async (_, _) => await DeferVisibleReviewAsync().ConfigureAwait(true);
        _deleteSelected.Click += async (_, _) => await DeleteSelectedAsync().ConfigureAwait(true);
        _docNav.SelectedIndexChanged += (_, _) => LoadDoc(_docNav.SelectedIndex);
        _host.ProgressChanged += OnProgress;
        _host.StateChanged += OnStateChanged;
        _reconciliation.Changed += OnReconciliationChanged;
        WebDavReadClient.GlobalIoProgress += OnIo;
        _timer.Tick += (_, _) => Tick();
        _form.Resize += (_, _) => ApplyResponsiveLayout();
    }

    private void ApplyPage(UiPageV032 page, RecycleFilterV032? recycleFilter = null)
    {
        _page = page;
        if (recycleFilter.HasValue) _recycleFilter = recycleFilter.Value;
        _overviewPage.Visible = page == UiPageV032.Overview;
        _transferPage.Visible = page == UiPageV032.Transfer;
        _recyclePage.Visible = page == UiPageV032.Recycle;
        _docsPage.Visible = page == UiPageV032.Docs;
        if (_overviewPage.Visible) _overviewPage.BringToFront();
        if (_transferPage.Visible) _transferPage.BringToFront();
        if (_recyclePage.Visible) _recyclePage.BringToFront();
        if (_docsPage.Visible) _docsPage.BringToFront();
        StyleTab(_tabOverview, page == UiPageV032.Overview);
        StyleTab(_tabTransfer, page == UiPageV032.Transfer);
        StyleTab(_tabRecycle, page == UiPageV032.Recycle);
        StyleTab(_tabDocs, page == UiPageV032.Docs);
        if (page == UiPageV032.Recycle) RefreshRecycle();
    }

    private void ApplyRecycleFilter(RecycleFilterV032 filter)
    {
        _recycleFilter = filter;
        RefreshRecycle();
    }

    private void Tick()
    {
        if (_disposed || _form.IsDisposed) return;
        _currentMeter.AdvancePulse();
        _transferMeter.AdvancePulse();
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
        try { await _reconciliation.EnsureAuditAsync(_cts.Token).ConfigureAwait(false); }
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
        ApplyResponsiveLayout();
        RefreshHeader();
        RefreshOverview();
        RefreshTransfer();
    }

    private void RefreshAllAndRecycleIfVisible()
    {
        RefreshAll();
        if (_page == UiPageV032.Recycle) RefreshRecycle();
    }

    private void RefreshHeader()
    {
        var cycle = _reconciliation.CurrentCycleId;
        _cycle.Text = string.IsNullOrWhiteSpace(cycle) ? "Cycle 未校准" : $"Cycle {cycle}";
        var status = CurrentStatusText();
        _route.SetStatus(status, StatusKind(_host.State.EngineState));
        var review = _reconciliation.GetHumanActionCount();
        _tabRecycle.Text = review > 0 ? $"回收站  {review}" : "回收站";
    }

    private string CurrentStatusText() => _host.State.EngineState switch
    {
        EngineState.WaitUser => "等待人工审查",
        EngineState.WaitQuota => "等待下一周期",
        EngineState.WaitNetwork => "等待网络",
        EngineState.WaitRetry => "需要处理",
        EngineState.Complete => "当前清单完成",
        EngineState.Running => _reconciliation.IsAuditing ? "源端对账中" : "普通迁移中",
        _ => _host.Config.MigrationEnabled ? "准备中" : "已暂停"
    };

    private void RefreshOverview()
    {
        var review = _reconciliation.GetHumanActionCount();
        var overviewRoot = _overviewPage.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        if (overviewRoot is not null)
        {
            overviewRoot.RowStyles[0].Height = review > 0 ? 46 : 0;
            _manualBanner.Visible = review > 0;
        }
        if (review > 0) _manualBanner.Text = $"⚠  需要人工处理 · 回收站有 {review:N0} 个附件组等待审查                                      审查  ›";

        var lastCycle = _reconciliation.State.LastReconciledCycleId;
        var currentCycle = _reconciliation.CurrentCycleId;
        var auditDone = !string.IsNullOrWhiteSpace(currentCycle) && string.Equals(lastCycle, currentCycle, StringComparison.OrdinalIgnoreCase);
        var priority = PriorityGroupCount();
        _stageAudit.Text = _reconciliation.IsAuditing ? "○  对账中" : auditDone ? "✓  对账完成" : "○  待对账";
        _stageRepair.Text = priority > 0 ? $"○  修复 {priority:N0}" : "✓  修复完成";
        _stageTransfer.Text = review > 0 ? $"!  审查 {review:N0}" : _host.State.EngineState == EngineState.WaitQuota ? "○  等待周期" : "○  普通迁移";
        _stageAudit.ForeColor = StageColor(_stageAudit.Text);
        _stageRepair.ForeColor = StageColor(_stageRepair.Text);
        _stageTransfer.ForeColor = StageColor(_stageTransfer.Text);

        var verified = _host.State.Files.Values.Count(record => record.Status == TransferStatus.StrongVerified);
        var total = Math.Max(_reconciliation.State.LastManifestObjectCount, _host.State.Files.Count);
        var coverage = total <= 0 ? 0 : Math.Clamp((double)verified / total, 0, 1);
        _coverageMeter.Fraction = coverage;
        _coverageMeter.StartColor = Color.FromArgb(123, 181, 211);
        _coverageMeter.EndColor = Color.FromArgb(72, 145, 184);
        _coverageText.Text = total > 0 ? $"{verified:N0} / {total:N0} 已核准" : $"{verified:N0} 已核准";

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
                ? "正在核对 InfiniCLOUD"
                : _host.State.EngineState switch
                {
                    EngineState.WaitUser => "等待回收站审查",
                    EngineState.WaitQuota => "等待坚果云下一额度周期",
                    EngineState.WaitNetwork => "等待网络恢复",
                    EngineState.WaitRetry => "已安全停止，等待处理",
                    EngineState.Complete => "当前源清单已完成",
                    EngineState.Paused => "已暂停",
                    _ => "准备任务"
                };
            _transferCurrent.Text = _currentText.Text;
            _transferMeter.Fraction = 0;
            _transferMeter.Pulse = _currentMeter.Pulse;
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
            _transferMeter.Pulse = false;
            _transferMeter.Fraction = fraction;
            _currentText.Text = $"{fileName}   {fraction:P0}";
            _transferCurrent.Text = _currentText.Text;
        }
        else
        {
            _currentMeter.Fraction = 0;
            _currentMeter.Pulse = true;
            _transferMeter.Fraction = 0;
            _transferMeter.Pulse = true;
            _currentText.Text = fileName;
            _transferCurrent.Text = fileName;
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
            : $"下次重置  {ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt):yyyy-MM-dd}";
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
        _transferOverall.Fraction = fraction;
        _transferOverall.StartColor = Color.FromArgb(123, 181, 211);
        _transferOverall.EndColor = Color.FromArgb(72, 145, 184);
        _transferState.Text = priority > 0
            ? $"优先修复进行中，普通任务等待 {priority:N0} 个历史镜像修复完成"
            : _host.State.EngineState == EngineState.WaitUser
                ? "等待人工审查，普通任务暂缓"
                : _host.State.EngineState == EngineState.WaitQuota
                    ? "本周期上传安全额度不足，等待下一周期"
                    : _host.State.EngineState == EngineState.Paused
                        ? "已暂停"
                        : $"普通任务可继续，约 {normal:N0} 组待处理";
        RefreshCurrent();
    }

    private void RefreshRecycle()
    {
        StyleFilter(_recycleObserving, _recycleFilter == RecycleFilterV032.Observing);
        StyleFilter(_recycleReview, _recycleFilter == RecycleFilterV032.Review);
        StyleFilter(_recycleHistory, _recycleFilter == RecycleFilterV032.History);

        var groups = _reconciliation.GetRecycleGroups();
        var filtered = groups.Where(group => _recycleFilter switch
        {
            RecycleFilterV032.Observing => ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId) == RecycleDisposition.Observing,
            RecycleFilterV032.Review => ReconciliationPolicy.GetDisposition(group, _reconciliation.CurrentCycleId) is RecycleDisposition.ReviewRequired or RecycleDisposition.Blocked,
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
            if (!string.IsNullOrWhiteSpace(group.LastIssue)) _recycleGrid.Rows[rowIndex].Cells[5].ToolTipText = group.LastIssue;
        }
        _recycleGrid.ClearSelection();
        _recycleGrid.CurrentCell = null;
        _recycleCount.Text = $"{filtered.Length:N0} 项";
        var reviewMode = _recycleFilter == RecycleFilterV032.Review;
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
            .Count(group => !string.IsNullOrWhiteSpace(group.Key) && group.Any(record => record.Status != TransferStatus.StrongVerified && record.Status != TransferStatus.SourceChanged));
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
            ApplyPage(UiPageV032.Recycle, RecycleFilterV032.Review);
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

    private void ApplyResponsiveLayout()
    {
        if (_disposed || _form.IsDisposed) return;
        var compact = _form.ClientSize.Width < 760 || _form.ClientSize.Height < 560;
        _content.AutoScroll = compact;
        _content.AutoScrollMinSize = compact ? new Size(720, 455) : Size.Empty;
        _route.Compact = compact;
    }

    private void LoadDoc(int index)
    {
        if (index < 0 || index >= Docs.Length) return;
        var doc = Docs[index];
        _docBody.SuspendLayout();
        _docBody.Clear();
        _docBody.SelectionFont = new Font("Microsoft YaHei UI", 15F, FontStyle.Bold);
        _docBody.SelectionColor = Ink;
        _docBody.AppendText(doc.Title + Environment.NewLine + Environment.NewLine);
        _docBody.SelectionFont = new Font("Microsoft YaHei UI", 9.6F, FontStyle.Regular);
        _docBody.SelectionColor = Ink;
        _docBody.AppendText(doc.Body.Replace("\n", Environment.NewLine));
        _docBody.SelectionStart = 0;
        _docBody.ScrollToCaret();
        _docBody.ResumeLayout();
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

    private static Panel PagePanel() => new() { Dock = DockStyle.Fill, BackColor = Color.White, Visible = false };

    private Control PageTitle(string text, string tip)
    {
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2 };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var title = new Label { Text = text, AutoSize = true, Font = new Font("Segoe UI Semibold", 15F), ForeColor = Ink, Anchor = AnchorStyles.Left };
        var info = new Label { Text = "ⓘ", AutoSize = true, Font = new Font("Segoe UI Symbol", 9F), ForeColor = Color.FromArgb(116, 132, 143), Anchor = AnchorStyles.Left, Margin = new Padding(8, 5, 0, 0), Cursor = Cursors.Help };
        row.Controls.Add(title, 0, 0);
        row.Controls.Add(info, 1, 0);
        _tips.SetToolTip(title, tip);
        _tips.SetToolTip(info, tip);
        return row;
    }

    private static Label SectionLabel(string text) => new() { Text = text, AutoSize = true, Font = new Font("Segoe UI Semibold", 9.4F), ForeColor = Ink, Anchor = AnchorStyles.Left };
    private static Label MainValueLabel() => new() { AutoSize = true, ForeColor = Color.FromArgb(67, 80, 89), Font = new Font("Segoe UI", 9F) };
    private static Label StageLabel() => new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 9F), Anchor = AnchorStyles.Left, ForeColor = Muted };
    private static Label CountLabel() => new() { AutoSize = true, Font = new Font("Segoe UI Semibold", 14F), ForeColor = BlueInk };

    private static Button TabButton(string text, int width)
    {
        var button = new Button { Text = text, Width = width, Height = 32, FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = Color.FromArgb(81, 93, 102), Font = new Font("Segoe UI Semibold", 9.1F), Margin = new Padding(0, 0, 4, 0), TabStop = false };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(242, 247, 250);
        return button;
    }

    private static void StyleTab(Button button, bool active)
    {
        button.BackColor = active ? BlueSoft : Color.White;
        button.ForeColor = active ? BlueInk : Color.FromArgb(81, 93, 102);
    }

    private static Button FilterButton(string text)
    {
        var button = new Button { Text = text, Width = 82, Height = 30, FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = Color.FromArgb(86, 99, 108), Font = new Font("Segoe UI Semibold", 8.8F), Margin = new Padding(0, 0, 4, 0), TabStop = false };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(244, 248, 250);
        return button;
    }

    private static void StyleFilter(Button button, bool active)
    {
        button.BackColor = active ? Color.FromArgb(237, 246, 250) : Color.White;
        button.ForeColor = active ? BlueInk : Color.FromArgb(86, 99, 108);
    }

    private static Button QuietIconButton(string text)
    {
        var button = new Button { Text = text, Width = 34, Height = 30, FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = Color.FromArgb(91, 105, 115), Font = new Font("Segoe UI Symbol", 12.5F), TabStop = false };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(242, 247, 250);
        return button;
    }

    private static Button PrimaryButton(string text)
    {
        var button = new Button { Text = text, Width = 102, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = BlueInk, Font = new Font("Segoe UI Semibold", 9F), TabStop = false };
        button.FlatAppearance.BorderColor = Color.FromArgb(174, 201, 218);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(239, 247, 251);
        return button;
    }

    private static Button QuietButton(string text, int width)
    {
        var button = new Button { Text = text, Width = width, Height = 34, FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = Color.FromArgb(76, 90, 99), Font = new Font("Segoe UI Semibold", 8.8F), TabStop = false };
        button.FlatAppearance.BorderColor = Color.FromArgb(203, 212, 218);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(245, 249, 251);
        return button;
    }

    private static Button DangerButton(string text, int width)
    {
        var button = QuietButton(text, width);
        button.ForeColor = Color.FromArgb(157, 77, 70);
        button.FlatAppearance.BorderColor = Color.FromArgb(218, 181, 177);
        return button;
    }

    private static Control TableCell(string text, bool header = false)
    {
        var panel = new Panel { Dock = DockStyle.Fill, BackColor = header ? Soft : Color.White, Padding = new Padding(12, 0, 8, 0) };
        var label = new Label { Text = text, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true, ForeColor = header ? Color.FromArgb(79, 92, 101) : Ink, Font = new Font("Segoe UI", 8.8F, header ? FontStyle.Bold : FontStyle.Regular) };
        panel.Controls.Add(label);
        return panel;
    }

    private static Color StageColor(string text) => text.StartsWith("✓", StringComparison.Ordinal) ? Green : text.StartsWith("!", StringComparison.Ordinal) ? Amber : Color.FromArgb(85, 106, 120);

    private static RouteStatusKindV032 StatusKind(EngineState state) => state switch
    {
        EngineState.WaitUser => RouteStatusKindV032.Warning,
        EngineState.WaitRetry => RouteStatusKindV032.Error,
        EngineState.WaitNetwork => RouteStatusKindV032.Neutral,
        EngineState.WaitQuota => RouteStatusKindV032.Quota,
        EngineState.Complete => RouteStatusKindV032.Complete,
        EngineState.Running => RouteStatusKindV032.Running,
        _ => RouteStatusKindV032.Neutral
    };

    private static bool EndpointMatches(string left, string right)
    {
        if (!Uri.TryCreate(left, UriKind.Absolute, out var a) || !Uri.TryCreate(right, UriKind.Absolute, out var b)) return false;
        return string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase) && string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) && a.Port == b.Port;
    }

    private static bool PathMatches(string ioPath, string relative) => ioPath.Replace('\\', '/').Trim('/').EndsWith(relative.Replace('\\', '/').Trim('/'), StringComparison.OrdinalIgnoreCase);

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
        _tips.Dispose();
        _cts.Dispose();
        _timer.Dispose();
        if (!_surface.IsDisposed) _surface.Dispose();
    }
}

internal enum RouteStatusKindV032
{
    Neutral,
    Running,
    Quota,
    Warning,
    Error,
    Complete
}

internal sealed class LogoRoutePanelV032 : Control
{
    private string _status = "准备中";
    private RouteStatusKindV032 _kind = RouteStatusKindV032.Neutral;
    public bool Compact { get; set; }

    public LogoRoutePanelV032()
    {
        DoubleBuffered = true;
        BackColor = Color.White;
    }

    public void SetStatus(string status, RouteStatusKindV032 kind)
    {
        if (_status == status && _kind == kind) return;
        _status = status;
        _kind = kind;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;

        var y = Height / 2f;
        var icon = Compact ? 21f : 24f;
        var pad = Compact ? 10f : 16f;
        var endpoint = Compact ? 118f : 144f;
        using var nameFont = new Font("Segoe UI Semibold", Compact ? 8.6F : 9.2F);
        using var statusFont = new Font("Microsoft YaHei UI", Compact ? 8F : 8.6F, FontStyle.Bold);

        var leftIcon = new RectangleF(pad, y - icon / 2f, icon, icon);
        var rightIcon = new RectangleF(Width - pad - icon, y - icon / 2f, icon, icon);
        DrawInfiniCloud(g, leftIcon);
        DrawAcorn(g, rightIcon);

        TextRenderer.DrawText(g, "InfiniCLOUD", nameFont,
            new Rectangle((int)(leftIcon.Right + 7), (int)y - 12, Math.Max(74, (int)endpoint - (int)icon - 7), 24),
            Color.FromArgb(48, 59, 66), TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        TextRenderer.DrawText(g, "坚果云", nameFont,
            new Rectangle(Width - (int)pad - (int)endpoint, (int)y - 12, Math.Max(58, (int)endpoint - (int)icon - 7), 24),
            Color.FromArgb(48, 59, 66), TextFormatFlags.Right | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);

        var left = endpoint + 18f;
        var right = Width - endpoint - 18f;
        if (right - left < 150f)
        {
            var mid = Width / 2f;
            left = mid - 75f;
            right = mid + 75f;
        }
        var span = Math.Max(120f, right - left);
        var colors = Colors(_kind);
        using var firstPath = ChevronArrow(left, left + span * .59f, y, 9f, 18f);
        using var secondPath = ChevronArrow(left + span * .41f, right, y, 9f, 18f);
        using var firstBrush = new LinearGradientBrush(new PointF(left, y), new PointF(left + span * .59f, y), colors.Light, colors.Middle);
        using var secondBrush = new LinearGradientBrush(new PointF(left + span * .41f, y), new PointF(right, y), colors.Middle, colors.Dark);
        g.FillPath(firstBrush, firstPath);
        g.FillPath(secondBrush, secondPath);
        TextRenderer.DrawText(g, _status, statusFont,
            new Rectangle((int)left + 8, (int)y - 11, Math.Max(70, (int)span - 20), 22),
            colors.Ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
    }

    private static GraphicsPath ChevronArrow(float left, float right, float y, float halfHeight, float tip)
    {
        var path = new GraphicsPath();
        path.AddPolygon(new[]
        {
            new PointF(left, y - halfHeight),
            new PointF(right - tip, y - halfHeight),
            new PointF(right, y),
            new PointF(right - tip, y + halfHeight),
            new PointF(left, y + halfHeight),
            new PointF(left + tip * .72f, y)
        });
        path.CloseFigure();
        return path;
    }

    private static void DrawInfiniCloud(Graphics g, RectangleF rect)
    {
        using var pen = new Pen(Color.FromArgb(239, 132, 0), Math.Max(2.2f, rect.Width * .145f))
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round
        };
        var top = rect.Top + rect.Height * .22f;
        var h = rect.Height * .56f;
        var w = rect.Width * .58f;
        g.DrawArc(pen, new RectangleF(rect.Left, top, w, h), 36, 288);
        g.DrawArc(pen, new RectangleF(rect.Right - w, top, w, h), 216, 288);
    }

    private static void DrawAcorn(Graphics g, RectangleF rect)
    {
        var bodyRect = new RectangleF(rect.Left + 5, rect.Top + 7, rect.Width - 10, rect.Height - 8);
        using var body = new LinearGradientBrush(bodyRect, Color.FromArgb(239, 198, 116), Color.FromArgb(174, 103, 50), 50f);
        using var edge = new Pen(Color.FromArgb(141, 83, 45), 1.1f);
        g.FillEllipse(body, bodyRect);
        g.DrawEllipse(edge, bodyRect);
        using var cap = new SolidBrush(Color.FromArgb(148, 89, 47));
        g.FillEllipse(cap, rect.Left + 4, rect.Top + 4, rect.Width - 8, 8);
        using var stem = new Pen(Color.FromArgb(112, 72, 42), 2.1f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawLine(stem, rect.Right - 7, rect.Top + 5, rect.Right - 3, rect.Top + 1);
    }

    private static RouteColors Colors(RouteStatusKindV032 kind) => kind switch
    {
        RouteStatusKindV032.Running => new(Color.FromArgb(229, 243, 237), Color.FromArgb(189, 221, 207), Color.FromArgb(147, 198, 178), Color.FromArgb(45, 94, 76)),
        RouteStatusKindV032.Quota => new(Color.FromArgb(248, 242, 227), Color.FromArgb(232, 216, 180), Color.FromArgb(214, 191, 140), Color.FromArgb(104, 82, 43)),
        RouteStatusKindV032.Warning => new(Color.FromArgb(250, 241, 224), Color.FromArgb(233, 208, 164), Color.FromArgb(217, 181, 119), Color.FromArgb(114, 79, 31)),
        RouteStatusKindV032.Error => new(Color.FromArgb(248, 232, 230), Color.FromArgb(233, 201, 197), Color.FromArgb(218, 170, 165), Color.FromArgb(123, 67, 62)),
        RouteStatusKindV032.Complete => new(Color.FromArgb(229, 243, 236), Color.FromArgb(194, 222, 208), Color.FromArgb(158, 202, 183), Color.FromArgb(50, 94, 77)),
        _ => new(Color.FromArgb(241, 244, 246), Color.FromArgb(222, 228, 232), Color.FromArgb(202, 211, 218), Color.FromArgb(83, 96, 105))
    };

    private readonly record struct RouteColors(Color Light, Color Middle, Color Dark, Color Ink);
}
