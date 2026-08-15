using System.Drawing.Drawing2D;
using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.3.3 information-density pass for the consolidated v0.3.2 shell.
/// It changes presentation only: duplicate value labels are folded into meters, long explanations
/// stay in ToolTips / Docs, and the cycle stages are rendered as one compact strip.
/// </summary>
internal sealed class UiDensityV033 : IDisposable
{
    private readonly UiShellV032 _shell;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly ToolTip _tips;
    private readonly List<MeterBindingV033> _bindings = new();
    private readonly StageStripV033 _stageStrip = new() { Dock = DockStyle.Fill, Margin = Padding.Empty };
    private readonly Label _stageAudit;
    private readonly Label _stageRepair;
    private readonly Label _stageTransfer;
    private readonly Label _resetText;
    private readonly Label _coverageText;
    private bool _disposed;

    private UiDensityV033(UiShellV032 shell)
    {
        _shell = shell;
        _timer = Field<System.Windows.Forms.Timer>("_timer");
        _tips = Field<ToolTip>("_tips");
        _stageAudit = Field<Label>("_stageAudit");
        _stageRepair = Field<Label>("_stageRepair");
        _stageTransfer = Field<Label>("_stageTransfer");
        _resetText = Field<Label>("_resetText");
        _coverageText = Field<Label>("_coverageText");

        InstallInlineMeters();
        InstallStageStrip();
        CompactTransferPage();
        CompactPageHeadings();
        CompactOverviewRows();
        ConfigureTips();
        Sync();
        _timer.Tick += OnTick;
    }

    public static UiDensityV033 Attach(UiShellV032 shell) => new(shell);

    internal void ValidateLayout(string scenario)
    {
        var form = Field<MainForm>("_form");
        ValidateVisibleMeters(scenario, "overview", 4);
        if (_stageStrip.Width < 360 || _stageStrip.Height < 24)
            throw new InvalidOperationException($"UI density self-test failed [{scenario}]: stage strip clipped");

        var transferTab = Field<Button>("_tabTransfer");
        var overviewTab = Field<Button>("_tabOverview");
        transferTab.PerformClick();
        form.PerformLayout();
        ValidateVisibleMeters(scenario, "transfer", 2);
        overviewTab.PerformClick();
        form.PerformLayout();
    }

    private void ValidateVisibleMeters(string scenario, string page, int minimumCount)
    {
        var visible = _bindings.Where(binding => binding.Overlay.Visible).ToArray();
        if (visible.Length < minimumCount)
            throw new InvalidOperationException($"UI density self-test failed [{scenario}]: {page} inline meters missing ({visible.Length})");
        foreach (var binding in visible)
        {
            if (binding.Overlay.Width < 80 || binding.Overlay.Height < 14)
                throw new InvalidOperationException($"UI density self-test failed [{scenario}]: {page} inline meter clipped ({binding.Overlay.Width}x{binding.Overlay.Height})");
        }
    }

    private T Field<T>(string name) where T : class
    {
        var value = typeof(UiShellV032).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_shell);
        return value as T ?? throw new InvalidOperationException($"v0.3.3 density pass could not resolve UiShellV032.{name}");
    }

    private void InstallInlineMeters()
    {
        AddBinding("_coverageText", "_coverageMeter", TextAlignmentV033.Center,
            "StrongVerified 覆盖数直接显示在进度条内。悬浮可查看核准含义。",
            text => text.Replace("文件已 StrongVerified", "已核准", StringComparison.Ordinal));
        AddBinding("_currentText", "_currentMeter", TextAlignmentV033.Left,
            "当前文件名、等待原因或当前动作直接显示在任务条内。",
            text => text);
        AddBinding("_uploadText", "_uploadMeter", TextAlignmentV033.Center,
            "坚果云本周期上传账本。程序仍保留安全余量。",
            text => text);
        AddBinding("_downloadText", "_downloadMeter", TextAlignmentV033.Center,
            "坚果云本周期下载账本。metadata 探测通常不会等同于完整内容下载。",
            text => text);
        AddBinding("_transferCurrent", "_transferMeter", TextAlignmentV033.Left,
            "转移页只保留当前任务条，重复的状态说明已移除。",
            text => text);
        AddBinding(null, "_transferOverall", TextAlignmentV033.Center,
            "整体镜像覆盖，数值与首页保持一致。",
            _ => _coverageText.Text.Replace("文件已 StrongVerified", "已核准", StringComparison.Ordinal));
    }

    private void AddBinding(string? labelField, string meterField, TextAlignmentV033 alignment, string tip, Func<string, string> textTransform)
    {
        var source = Field<MeterV030>(meterField);
        var label = string.IsNullOrWhiteSpace(labelField) ? null : Field<Label>(labelField);
        if (source.Parent is not TableLayoutPanel parent)
            throw new InvalidOperationException($"v0.3.3 density pass expected {meterField} inside TableLayoutPanel");

        var pos = parent.GetCellPosition(source);
        var overlay = new InlineMeterV033(source)
        {
            Dock = DockStyle.Fill,
            Margin = source.Margin,
            Alignment = alignment
        };
        parent.Controls.Add(overlay, pos.Column, pos.Row);
        overlay.BringToFront();
        source.Visible = false;

        if (label is not null)
        {
            label.Visible = false;
            if (ReferenceEquals(label.Parent, parent))
            {
                var labelPos = parent.GetCellPosition(label);
                if (labelPos.Row >= 0 && labelPos.Row < parent.RowStyles.Count && labelPos.Row != pos.Row)
                    parent.RowStyles[labelPos.Row] = new RowStyle(SizeType.Absolute, 0);
            }
        }

        if (pos.Row >= 0 && pos.Row < parent.RowStyles.Count)
            parent.RowStyles[pos.Row] = new RowStyle(SizeType.Percent, 100);

        _tips.SetToolTip(overlay, tip);
        _bindings.Add(new MeterBindingV033(label, source, overlay, textTransform));
    }

    private void InstallStageStrip()
    {
        if (_stageAudit.Parent is not TableLayoutPanel stageTable) return;
        if (stageTable.Parent is not TableLayoutPanel overviewRoot) return;
        var pos = overviewRoot.GetCellPosition(stageTable);
        stageTable.Visible = false;
        overviewRoot.Controls.Add(_stageStrip, pos.Column, pos.Row);
        _stageStrip.BringToFront();
        _tips.SetToolTip(_stageStrip, "三个阶段依次为源端对账、历史修改修复和普通迁移。详细规则见“文档”。");
    }

    private void CompactOverviewRows()
    {
        var page = Field<Panel>("_overviewPage");
        var root = page.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        if (root is null || root.RowStyles.Count < 6) return;
        root.RowStyles[1] = new RowStyle(SizeType.Absolute, 80);
        root.RowStyles[2] = new RowStyle(SizeType.Absolute, 34);
        root.RowStyles[3] = new RowStyle(SizeType.Absolute, 104);
        root.RowStyles[4] = new RowStyle(SizeType.Absolute, 62);
        root.RowStyles[5] = new RowStyle(SizeType.Percent, 100);
    }

    private void CompactTransferPage()
    {
        var page = Field<Panel>("_transferPage");
        var root = page.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        if (root is null || root.RowStyles.Count < 5) return;

        root.RowStyles[0] = new RowStyle(SizeType.Absolute, 34);
        root.RowStyles[1] = new RowStyle(SizeType.Absolute, 0);
        root.RowStyles[2] = new RowStyle(SizeType.Absolute, 112);
        root.RowStyles[3] = new RowStyle(SizeType.Absolute, 70);
        root.RowStyles[4] = new RowStyle(SizeType.Percent, 100);

        var status = Field<Label>("_transferState");
        if (status.Parent?.Parent is Control statusCard)
            statusCard.Visible = false;

        var queue = FindQueueTable(page);
        if (queue is not null && queue.ColumnStyles.Count >= 3)
        {
            queue.ColumnStyles[0] = new ColumnStyle(SizeType.Percent, 68);
            queue.ColumnStyles[1] = new ColumnStyle(SizeType.Percent, 32);
            queue.ColumnStyles[2] = new ColumnStyle(SizeType.Absolute, 0);
            foreach (Control control in queue.Controls)
            {
                var cell = queue.GetCellPosition(control);
                if (cell.Column == 2) control.Visible = false;
                if (cell.Column == 0 && cell.Row == 1)
                    _tips.SetToolTip(control, "优先修复：源端内容真正变化的历史 StrongVerified 组，始终先处理。");
                if (cell.Column == 0 && cell.Row == 2)
                    _tips.SetToolTip(control, "普通任务：既有 backlog 与本周期新增对象同级，不插队。");
            }
        }
    }

    private static TableLayoutPanel? FindQueueTable(Control page) => page.Controls
        .Cast<Control>()
        .SelectMany(Descendants)
        .OfType<TableLayoutPanel>()
        .FirstOrDefault(table => table.ColumnCount == 3 && table.RowCount == 3 && table.CellBorderStyle == TableLayoutPanelCellBorderStyle.Single);

    private void CompactPageHeadings()
    {
        HideHeadingSubtitle(Field<Panel>("_transferPage"));
        HideHeadingSubtitle(Field<Panel>("_recyclePage"));
        HideHeadingSubtitle(Field<Panel>("_docsPage"));
    }

    private static void HideHeadingSubtitle(Panel page)
    {
        var root = page.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        if (root is null) return;
        var heading = root.GetControlFromPosition(0, 0) as TableLayoutPanel;
        if (heading is null) return;
        var labels = heading.Controls.OfType<Label>().OrderBy(label => heading.GetRow(label)).ToArray();
        for (var i = 1; i < labels.Length; i++) labels[i].Visible = false;
    }

    private void ConfigureTips()
    {
        _tips.SetToolTip(_resetText, "显示下一次额度重置日期。到达当天后仍需在 09:00 后通过真实探测确认新周期。");
    }

    private void OnTick(object? sender, EventArgs e) => Sync();

    private void Sync()
    {
        if (_disposed) return;
        foreach (var binding in _bindings) binding.Sync();
        _stageStrip.SetStages(ShortStage(_stageAudit.Text, StageKindV033.Audit), ShortStage(_stageRepair.Text, StageKindV033.Repair), ShortStage(_stageTransfer.Text, StageKindV033.Transfer));

        var fullReset = _resetText.Text;
        if (!string.IsNullOrWhiteSpace(fullReset))
        {
            _tips.SetToolTip(_resetText, fullReset + "。到达重置日后仍以真实服务探测为准。");
            var space = fullReset.IndexOf(' ');
            var date = space > 0 ? fullReset[..space] : fullReset;
            if (DateTime.TryParse(date, out var parsed))
                _resetText.Text = $"重置 {parsed:MM-dd}";
            else if (fullReset.Contains("流量尚未校准", StringComparison.Ordinal))
                _resetText.Text = "未校准";
        }
    }

    private static string ShortStage(string text, StageKindV033 kind)
    {
        var ok = text.StartsWith("✓", StringComparison.Ordinal);
        var warn = text.StartsWith("!", StringComparison.Ordinal);
        var prefix = ok ? "✓ " : warn ? "! " : "○ ";
        return kind switch
        {
            StageKindV033.Audit => text.Contains("对账中", StringComparison.Ordinal) ? "○ 对账中" : ok ? "✓ 对账" : "○ 对账",
            StageKindV033.Repair => text.Contains("优先修复", StringComparison.Ordinal) ? text.Replace("优先修复", "修复", StringComparison.Ordinal) : ok ? "✓ 修复" : "○ 修复",
            _ => text.Contains("待审查", StringComparison.Ordinal) ? "! 审查" : text.Contains("等待", StringComparison.Ordinal) ? "○ 等待周期" : prefix + "迁移"
        };
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child)) yield return nested;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Tick -= OnTick;
        foreach (var binding in _bindings) binding.Overlay.Dispose();
        _stageStrip.Dispose();
    }
}

internal enum TextAlignmentV033 { Left, Center }
internal enum StageKindV033 { Audit, Repair, Transfer }

internal sealed class MeterBindingV033
{
    private readonly Label? _label;
    private readonly MeterV030 _source;
    private readonly Func<string, string> _transform;
    public InlineMeterV033 Overlay { get; }

    public MeterBindingV033(Label? label, MeterV030 source, InlineMeterV033 overlay, Func<string, string> transform)
    {
        _label = label;
        _source = source;
        Overlay = overlay;
        _transform = transform;
    }

    public void Sync()
    {
        Overlay.Fraction = _source.Fraction;
        Overlay.Pulse = _source.Pulse;
        Overlay.StartColor = _source.StartColor;
        Overlay.EndColor = _source.EndColor;
        Overlay.OverlayText = _transform(_label?.Text ?? string.Empty);
        Overlay.AdvancePulse();
    }
}

internal sealed class InlineMeterV033 : Control
{
    private double _fraction;
    private int _pulse;
    private string _overlayText = string.Empty;

    public bool Pulse { get; set; }
    public Color StartColor { get; set; } = Color.FromArgb(123, 181, 211);
    public Color EndColor { get; set; } = Color.FromArgb(72, 145, 184);
    public TextAlignmentV033 Alignment { get; set; } = TextAlignmentV033.Center;

    public double Fraction
    {
        get => _fraction;
        set { _fraction = Math.Clamp(value, 0, 1); Invalidate(); }
    }

    public string OverlayText
    {
        get => _overlayText;
        set { if (_overlayText == value) return; _overlayText = value; Invalidate(); }
    }

    public InlineMeterV033(MeterV030 source)
    {
        DoubleBuffered = true;
        Font = new Font("Segoe UI Semibold", 8.7F);
        StartColor = source.StartColor;
        EndColor = source.EndColor;
        Pulse = source.Pulse;
    }

    public void AdvancePulse()
    {
        if (!Pulse) return;
        _pulse = (_pulse + 5) % 160;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new Rectangle(0, 0, Math.Max(1, Width - 1), Math.Max(1, Height - 1));
        using var path = Rounded(rect, Math.Min(8, Math.Max(2, Height / 2)));
        using var track = new SolidBrush(Color.FromArgb(236, 241, 244));
        g.FillPath(track, path);
        g.SetClip(path);

        if (Pulse)
        {
            var w = Math.Max(60, Width / 4);
            var x = (_pulse * (Width + w) / 160) - w;
            using var brush = new LinearGradientBrush(new Rectangle(x, 0, Math.Max(1, w), Height), Color.FromArgb(165, StartColor), Color.FromArgb(165, EndColor), 0F);
            g.FillRectangle(brush, x, 0, w, Height);
        }
        else if (_fraction > 0)
        {
            var fillWidth = Math.Max(1, (int)Math.Round(Width * _fraction));
            using var brush = new LinearGradientBrush(new Rectangle(0, 0, fillWidth, Height), StartColor, EndColor, 0F);
            g.FillRectangle(brush, 0, 0, fillWidth, Height);
        }
        g.ResetClip();

        var flags = TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine;
        flags |= Alignment == TextAlignmentV033.Center ? TextFormatFlags.HorizontalCenter : TextFormatFlags.Left;
        var textRect = Rectangle.Inflate(rect, -10, 0);
        TextRenderer.DrawText(g, string.IsNullOrWhiteSpace(_overlayText) ? " " : _overlayText, Font, textRect, Color.FromArgb(45, 57, 65), flags);
    }

    private static GraphicsPath Rounded(Rectangle rect, int radius)
    {
        var path = new GraphicsPath();
        var d = Math.Max(2, radius * 2);
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}

internal sealed class StageStripV033 : Control
{
    private readonly string[] _stages = ["○ 对账", "○ 修复", "○ 迁移"];

    public StageStripV033()
    {
        DoubleBuffered = true;
        Font = new Font("Segoe UI Semibold", 8.8F);
        BackColor = Color.White;
    }

    public void SetStages(string audit, string repair, string transfer)
    {
        if (_stages[0] == audit && _stages[1] == repair && _stages[2] == transfer) return;
        _stages[0] = audit;
        _stages[1] = repair;
        _stages[2] = transfer;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var gap = 8;
        var usable = Width - gap * 2;
        var w = Math.Max(1, usable / 3);
        for (var i = 0; i < 3; i++)
        {
            var x = i * (w + gap);
            var rect = new Rectangle(x, 4, i == 2 ? Math.Max(1, Width - x) : w, Math.Max(20, Height - 8));
            var text = _stages[i];
            var ok = text.StartsWith("✓", StringComparison.Ordinal);
            var warn = text.StartsWith("!", StringComparison.Ordinal);
            var back = ok ? Color.FromArgb(237, 248, 242) : warn ? Color.FromArgb(253, 247, 234) : Color.FromArgb(244, 248, 250);
            var fore = ok ? Color.FromArgb(60, 132, 98) : warn ? Color.FromArgb(165, 113, 36) : Color.FromArgb(84, 103, 116);
            using var path = Rounded(rect, 7);
            using var brush = new SolidBrush(back);
            g.FillPath(brush, path);
            TextRenderer.DrawText(g, text, Font, rect, fore, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        }
    }

    private static GraphicsPath Rounded(Rectangle rect, int radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2;
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
