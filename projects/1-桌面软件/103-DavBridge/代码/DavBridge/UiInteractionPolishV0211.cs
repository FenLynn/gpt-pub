using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.2.11 interaction polish. Keeps quota calibration on the dashboard and
/// normalizes standard WinForms button text alignment without changing migration
/// or quota accounting semantics.
/// </summary>
internal sealed class UiInteractionPolishV0211 : IDisposable
{
    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly UiLayoutPolishV0213 _layoutPolish;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 120 };
    private readonly HashSet<IntPtr> _normalizedForms = new();
    private bool _disposed;

    private UiInteractionPolishV0211(MainForm form, UiDashboardV027 dashboard, AppHost host)
    {
        _form = form;
        _dashboard = dashboard;
        _host = host;
        InstallCalibrationEntry();
        NormalizeButtons(form);
        _layoutPolish = UiLayoutPolishV0213.Attach(form, dashboard);
        _timer.Tick += (_, _) => PolishOpenForms();
        _timer.Start();
    }

    public static UiInteractionPolishV0211 Attach(MainForm form, UiDashboardV027 dashboard, AppHost host) =>
        new(form, dashboard, host);

    private T? Field<T>(string name) where T : class
    {
        try
        {
            return typeof(UiDashboardV027)
                .GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?
                .GetValue(_dashboard) as T;
        }
        catch { return null; }
    }

    private void InstallCalibrationEntry()
    {
        if (Field<Label>("_cycleTitle") is not { } title || title.Parent is not TableLayoutPanel section)
            return;
        if (section.Controls.Find("V0211CalibrationHost", true).Length > 0)
            return;

        var position = section.GetPositionFromControl(title);
        section.Controls.Remove(title);

        var host = new TableLayoutPanel
        {
            Name = "V0211CalibrationHost",
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 2,
            Margin = Padding.Empty,
            Padding = Padding.Empty,
            BackColor = Color.White
        };
        host.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        host.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        title.Margin = new Padding(0, 0, 0, 5);
        title.Anchor = AnchorStyles.Left;
        host.Controls.Add(title, 0, 0);

        var calibrate = new Button
        {
            Name = "V0211CalibrateButton",
            Text = "校准",
            Width = 66,
            Height = 27,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(58, 91, 116),
            TextAlign = ContentAlignment.MiddleCenter,
            Padding = Padding.Empty,
            Margin = Padding.Empty,
            TabStop = false,
            Cursor = Cursors.Hand,
            UseVisualStyleBackColor = false
        };
        calibrate.FlatAppearance.BorderColor = Color.FromArgb(205, 216, 224);
        calibrate.FlatAppearance.MouseOverBackColor = Color.FromArgb(243, 248, 252);
        calibrate.FlatAppearance.MouseDownBackColor = Color.FromArgb(233, 243, 250);
        calibrate.Click += async (_, _) => await CalibrateFromDashboardAsync();
        host.Controls.Add(calibrate, 0, 1);

        section.Controls.Add(host, position.Column, position.Row);
        if (section.RowCount > position.Row + 1)
            section.SetRowSpan(host, 2);
    }

    private async Task CalibrateFromDashboardAsync()
    {
        if (_disposed || _form.IsDisposed) return;

        if (_host.Config.MigrationEnabled || _host.IsRunning)
        {
            var confirm = MessageBox.Show(
                _form,
                "校准流量需要先安全暂停当前迁移。\r\n\r\n是否现在暂停并打开流量校准？",
                "校准流量",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            if (confirm != DialogResult.Yes) return;

            var pauseTask = UiCommandBridge.InvokeTask(_form, "PauseAsync");
            if (pauseTask is not null)
                await pauseTask.ConfigureAwait(true);

            var started = DateTime.UtcNow;
            while (_host.IsRunning && DateTime.UtcNow - started < TimeSpan.FromSeconds(10))
                await Task.Delay(80).ConfigureAwait(true);
            if (_host.IsRunning)
            {
                MessageBox.Show(_form, "任务仍在完成安全暂停，请稍后再校准。", "校准流量",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
        }

        var calibrateTask = UiCommandBridge.InvokeTask(_form, "CalibrateAsync");
        if (calibrateTask is not null)
            await calibrateTask.ConfigureAwait(true);
    }

    private void PolishOpenForms()
    {
        if (_disposed) return;
        foreach (Form form in Application.OpenForms)
        {
            if (form.IsDisposed || !form.IsHandleCreated) continue;
            NormalizeButtons(form);
            if (form is SettingsDialog)
                PolishSettings(form);
            _normalizedForms.Add(form.Handle);
        }
    }

    private static void NormalizeButtons(Control root)
    {
        foreach (Control control in Enumerate(root))
        {
            if (control is not Button button) continue;
            button.TextAlign = ToMiddle(button.TextAlign);
            if (button.Padding.Top != 0 || button.Padding.Bottom != 0)
                button.Padding = new Padding(button.Padding.Left, 0, button.Padding.Right, 0);
        }
    }

    private static ContentAlignment ToMiddle(ContentAlignment alignment) => alignment switch
    {
        ContentAlignment.TopLeft or ContentAlignment.MiddleLeft or ContentAlignment.BottomLeft => ContentAlignment.MiddleLeft,
        ContentAlignment.TopRight or ContentAlignment.MiddleRight or ContentAlignment.BottomRight => ContentAlignment.MiddleRight,
        _ => ContentAlignment.MiddleCenter
    };

    private static IEnumerable<Control> Enumerate(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Enumerate(child))
                yield return nested;
        }
    }

    private static void PolishSettings(Form settings)
    {
        foreach (var label in Enumerate(settings).OfType<Label>())
        {
            if (label.Text.Contains("人工校准入口位于“安全与维护”", StringComparison.Ordinal))
                label.Text = "当前周期已用量与重置日期由主页显示；人工校准入口位于主页“当前周期”。";
        }

        foreach (var row in Enumerate(settings).OfType<TableLayoutPanel>())
        {
            if (row.ColumnCount != 3) continue;
            var isCalibrationRow = Enumerate(row).OfType<Label>()
                .Any(label => string.Equals(label.Text, "校准流量", StringComparison.Ordinal));
            if (isCalibrationRow)
                row.Visible = false;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        _layoutPolish.Dispose();
        _normalizedForms.Clear();
    }
}
