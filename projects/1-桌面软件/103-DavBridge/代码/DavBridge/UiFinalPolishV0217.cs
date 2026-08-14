using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;

namespace DavBridge;

internal sealed class UiFinalPolishV0217 : IDisposable
{
    private static readonly Regex QuotaPattern = new(@"(?<used>[\d.,]+)\s*(?<usedUnit>KB|MB|GB)\s*/\s*(?<cap>[\d.,]+)\s*(?<capUnit>KB|MB|GB)", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 180 };
    private Label? _uploadValue;
    private Label? _downloadValue;
    private GradientMeterBar? _uploadBar;
    private GradientMeterBar? _downloadBar;
    private GradientMeterBar? _overallBar;
    private GradientMeterBar? _currentBar;
    private TransportActionButtonV027? _primarySource;
    private PrimaryActionSurfaceV0217? _primarySurface;
    private bool _disposed;

    private UiFinalPolishV0217(MainForm form, UiDashboardV027 dashboard)
    {
        _form = form;
        _dashboard = dashboard;
        InstallSidebarDivider();
        InstallCycleLayout();
        InstallPrimaryAction();
        ApplyNow();
        _timer.Tick += (_, _) => ApplyNow();
        _timer.Start();
    }

    public static UiFinalPolishV0217 Attach(MainForm form, UiDashboardV027 dashboard) => new(form, dashboard);

    private T? Field<T>(string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_dashboard) as T; }
        catch { return null; }
    }

    private void InstallSidebarDivider()
    {
        if (Field<Panel>("_sidebar") is not { } sidebar) return;
        if (sidebar.Controls.Cast<Control>().Any(x => x.Name == "P103V0217Divider")) return;
        var divider = new Panel
        {
            Name = "P103V0217Divider",
            Dock = DockStyle.Right,
            Width = 1,
            BackColor = UiGeometryV0217.DividerColor,
            TabStop = false
        };
        sidebar.Controls.Add(divider);
        divider.BringToFront();
    }

    private void InstallCycleLayout()
    {
        var title = Field<Label>("_cycleTitle");
        _uploadBar = Field<GradientMeterBar>("_uploadBar");
        _downloadBar = Field<GradientMeterBar>("_downloadBar");
        _overallBar = Field<GradientMeterBar>("_overallBar");
        _currentBar = Field<GradientMeterBar>("_currentBar");
        _uploadValue = Field<Label>("_uploadValue");
        _downloadValue = Field<Label>("_downloadValue");
        if (title is null || _uploadBar is null || _downloadBar is null || _uploadValue is null || _downloadValue is null) return;

        _currentBar.Font = new Font("Microsoft YaHei UI", 8.5F);
        var section = FindCycleSection(title, _uploadBar);
        if (section is null) return;
        var calibration = Descendants(section).OfType<Button>().FirstOrDefault(x => x.Text == "校准");
        var reset = Descendants(section).OfType<Label>().FirstOrDefault(x => x.Text.Contains("重置", StringComparison.Ordinal) || x.Text.Contains("流量尚未校准", StringComparison.Ordinal));

        foreach (var keep in new Control?[] { title, _uploadBar, _downloadBar, _uploadValue, _downloadValue, calibration, reset })
            if (keep is not null) Detach(keep);

        foreach (Control child in section.Controls.Cast<Control>().ToArray())
        {
            section.Controls.Remove(child);
            child.Dispose();
        }

        section.SuspendLayout();
        section.ColumnStyles.Clear();
        section.RowStyles.Clear();
        section.ColumnCount = 4;
        section.RowCount = 2;
        section.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, UiGeometryV0217.SectionLabelWidth));
        section.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        section.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        section.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, UiGeometryV0217.QuotaActionWidth));
        section.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        section.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        title.Anchor = AnchorStyles.Left;
        title.Margin = Padding.Empty;
        section.Controls.Add(title, 0, 0);
        section.Controls.Add(BuildQuotaInline("上传", _uploadBar, new Padding(0, 0, 10, 0)), 1, 0);
        section.Controls.Add(BuildQuotaInline("下载", _downloadBar, new Padding(10, 0, 0, 0)), 2, 0);

        if (calibration is not null)
        {
            calibration.Width = 66;
            calibration.Height = 30;
            calibration.Anchor = AnchorStyles.Right | AnchorStyles.Top;
            calibration.Margin = new Padding(6, 1, 0, 0);
            calibration.Padding = Padding.Empty;
            calibration.TextAlign = ContentAlignment.MiddleCenter;
            section.Controls.Add(calibration, 3, 0);
        }

        if (reset is not null)
        {
            reset.Anchor = AnchorStyles.Right;
            reset.Margin = new Padding(0, 5, 0, 0);
            section.Controls.Add(reset, 1, 1);
            section.SetColumnSpan(reset, 3);
        }

        _uploadValue.Visible = false;
        _downloadValue.Visible = false;
        section.ResumeLayout(true);
    }

    private static Control BuildQuotaInline(string name, GradientMeterBar bar, Padding margin)
    {
        var row = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Margin = margin,
            Padding = Padding.Empty,
            BackColor = Color.White
        };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var label = new Label
        {
            Text = name,
            AutoSize = true,
            Anchor = AnchorStyles.Left,
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
            Margin = new Padding(0, 7, 0, 0)
        };
        bar.Dock = DockStyle.Fill;
        bar.Height = UiGeometryV0217.QuotaBarHeight;
        bar.Margin = new Padding(7, 4, 0, 4);
        bar.Font = new Font("Microsoft YaHei UI", 8.3F);
        row.Controls.Add(label, 0, 0);
        row.Controls.Add(bar, 1, 0);
        return row;
    }

    private void InstallPrimaryAction()
    {
        _primarySource = Field<TransportActionButtonV027>("_primary");
        if (_primarySource?.Parent is not TableLayoutPanel parent) return;
        var position = parent.GetPositionFromControl(_primarySource);
        parent.Controls.Remove(_primarySource);
        _primarySurface = new PrimaryActionSurfaceV0217(_primarySource)
        {
            Anchor = AnchorStyles.Right | AnchorStyles.Bottom,
            Margin = _primarySource.Margin
        };
        parent.Controls.Add(_primarySurface, position.Column, position.Row);
    }

    private void ApplyNow()
    {
        if (_disposed || _form.IsDisposed) return;
        if (_overallBar is not null) _overallBar.BarText = StripThousands(_overallBar.BarText);
        if (_currentBar is not null) _currentBar.BarText = StripThousands(_currentBar.BarText);
        if (_uploadBar is not null && _uploadValue is not null) _uploadBar.BarText = CompactQuota(_uploadValue.Text);
        if (_downloadBar is not null && _downloadValue is not null) _downloadBar.BarText = CompactQuota(_downloadValue.Text);
        _primarySurface?.SyncFromSource();
        PolishOpenSettings();
    }

    private static string CompactQuota(string text)
    {
        var match = QuotaPattern.Match(text.Replace(",", string.Empty, StringComparison.Ordinal));
        if (!match.Success) return StripThousands(text);
        if (!double.TryParse(match.Groups["used"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var used)) return StripThousands(text);
        if (!double.TryParse(match.Groups["cap"].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var cap)) return StripThousands(text);
        var usedG = ToGigabytes(used, match.Groups["usedUnit"].Value);
        var capG = ToGigabytes(cap, match.Groups["capUnit"].Value);
        return $"{usedG:0.##} G / {capG:0.##} G";
    }

    private static double ToGigabytes(double value, string unit) => unit.ToUpperInvariant() switch
    {
        "KB" => value / 1_000_000d,
        "MB" => value / 1_000d,
        _ => value
    };

    private static string StripThousands(string text) => Regex.Replace(text ?? string.Empty, @"(?<=\d),(?=\d{3}(?:\D|$))", string.Empty);

    private static void PolishOpenSettings()
    {
        foreach (var dialog in Application.OpenForms.OfType<SettingsDialog>())
            foreach (var button in Descendants(dialog).OfType<Button>())
            {
                button.TextAlign = UiGeometryV0217.MiddleVertical(button.TextAlign);
                button.Padding = new Padding(button.Padding.Left, 0, button.Padding.Right, 0);
            }
    }

    private static TableLayoutPanel? FindCycleSection(Control title, Control uploadBar)
    {
        for (Control? current = title.Parent; current is not null; current = current.Parent)
            if (current is TableLayoutPanel table && Contains(table, uploadBar)) return table;
        return null;
    }

    private static bool Contains(Control root, Control target)
    {
        if (ReferenceEquals(root, target)) return true;
        return root.Controls.Cast<Control>().Any(child => Contains(child, target));
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child)) yield return nested;
        }
    }

    private static void Detach(Control control) => control.Parent?.Controls.Remove(control);

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        _primarySurface?.Dispose();
        _primarySource?.Dispose();
        _uploadValue?.Dispose();
        _downloadValue?.Dispose();
    }
}
