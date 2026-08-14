namespace DavBridge;

internal sealed class UiButtonPolishV0219 : IDisposable
{
    private readonly UiDashboardV027 _dashboard;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private bool _disposed;

    private UiButtonPolishV0219(UiDashboardV027 dashboard)
    {
        _dashboard = dashboard;
        Apply();
        _timer.Tick += (_, _) => Apply();
        _timer.Start();
    }

    public static UiButtonPolishV0219 Attach(UiDashboardV027 dashboard) => new(dashboard);

    private void Apply()
    {
        if (_disposed) return;
        foreach (var form in Application.OpenForms.Cast<Form>())
        {
            foreach (var button in Descendants(form).OfType<Button>())
            {
                if (!ShouldPolish(button)) continue;
                Polish(button);
            }
        }
    }

    private static bool ShouldPolish(Button button)
    {
        var text = button.Text.Trim();
        return text is "校准" or "保存" or "取消" or "确定" or "执行" or "重新验证" or "重验";
    }

    private static void Polish(Button button)
    {
        button.UseVisualStyleBackColor = false;
        button.FlatStyle = FlatStyle.Flat;
        button.BackColor = Color.FromArgb(238, 247, 253);
        button.ForeColor = Color.FromArgb(42, 75, 99);
        button.FlatAppearance.BorderColor = Color.FromArgb(165, 196, 216);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(225, 240, 250);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(210, 231, 245);
        button.Padding = Padding.Empty;
        button.TextAlign = ContentAlignment.MiddleCenter;
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
        _timer.Stop();
        _timer.Dispose();
    }
}
