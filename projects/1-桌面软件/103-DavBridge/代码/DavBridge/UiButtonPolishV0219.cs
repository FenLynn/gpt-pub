namespace DavBridge;

internal sealed class UiButtonPolishV0219 : IDisposable
{
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };
    private bool _disposed;

    private UiButtonPolishV0219(UiDashboardV027 dashboard)
    {
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
        var text = button.Text.Trim();
        var primary = text is "保存" or "确定" or "执行";

        button.UseVisualStyleBackColor = false;
        button.FlatStyle = FlatStyle.Flat;
        button.Padding = Padding.Empty;
        button.TextAlign = ContentAlignment.MiddleCenter;
        button.Font = new Font("Microsoft YaHei UI", 8.8F);

        if (primary)
        {
            button.BackColor = Color.FromArgb(234, 243, 247);
            button.ForeColor = Color.FromArgb(53, 91, 112);
            button.FlatAppearance.BorderColor = Color.FromArgb(177, 199, 211);
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(224, 237, 243);
            button.FlatAppearance.MouseDownBackColor = Color.FromArgb(214, 230, 238);
        }
        else
        {
            button.BackColor = Color.FromArgb(247, 249, 250);
            button.ForeColor = Color.FromArgb(77, 90, 99);
            button.FlatAppearance.BorderColor = Color.FromArgb(207, 216, 222);
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(239, 244, 247);
            button.FlatAppearance.MouseDownBackColor = Color.FromArgb(231, 238, 242);
        }
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
