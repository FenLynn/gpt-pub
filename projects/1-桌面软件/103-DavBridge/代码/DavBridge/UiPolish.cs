namespace DavBridge;

internal sealed class UiPolish : IDisposable
{
    private readonly Form _form;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 250 };

    private UiPolish(Form form)
    {
        _form = form;
        _timer.Tick += (_, _) => ApplyDynamicPolish();
        _form.Shown += (_, _) => ApplyAll();
        _form.Resize += (_, _) => ApplyResponsivePolish();
    }

    public static UiPolish Attach(Form form)
    {
        var polish = new UiPolish(form);
        polish.ApplyAll();
        polish._timer.Start();
        return polish;
    }

    private void ApplyAll()
    {
        ApplyStaticPolish();
        ApplyResponsivePolish();
        ApplyDynamicPolish();
    }

    private void ApplyStaticPolish()
    {
        foreach (var control in Descendants(_form))
        {
            if (control is Label label)
            {
                if (label.Text.Contains("v0.2 将支持更多", StringComparison.Ordinal))
                {
                    label.Text = "当前任务";
                    label.ForeColor = Color.DimGray;
                }
                else if (label.Text.StartsWith("关闭主窗口只会隐藏到托盘", StringComparison.Ordinal))
                {
                    label.Text = "关闭窗口后仍在托盘后台运行。暂停后可直接继续。";
                }
            }

            if (control is Button button)
            {
                if (button.Text == "+ 新建任务")
                {
                    button.Visible = false;
                    continue;
                }

                if (button.Text is "暂停" or "继续" or "设置" or "初始化与诊断" or "诊断")
                {
                    if (button.Text == "初始化与诊断")
                        button.Text = "诊断";

                    button.AutoSize = false;
                    button.Size = new Size(96, 36);
                    button.MinimumSize = new Size(96, 36);
                    button.Padding = Padding.Empty;
                    button.Margin = new Padding(0, 0, 10, 0);
                }
                else if (button.Text is "连接诊断" or "就绪扫描" or "校准流量" or "首组验证" or "既有副本验证")
                {
                    button.AutoSize = false;
                    button.Size = new Size(108, 34);
                    button.MinimumSize = new Size(108, 34);
                    button.Padding = Padding.Empty;
                    button.Margin = new Padding(0, 0, 8, 6);
                }

                if (button.Text.StartsWith("Zotero ", StringComparison.Ordinal))
                {
                    button.FlatStyle = FlatStyle.Flat;
                    button.FlatAppearance.BorderSize = 0;
                    button.FlatAppearance.MouseOverBackColor = Color.FromArgb(242, 242, 242);
                    button.BackColor = Color.White;
                    button.Padding = new Padding(10, 6, 8, 6);
                    button.Height = 66;
                    button.Font = new Font("Segoe UI", 9F);
                }
            }
        }

        HideDuplicateHeaderStatus();
    }

    private void HideDuplicateHeaderStatus()
    {
        foreach (var table in Descendants(_form).OfType<TableLayoutPanel>())
        {
            if (table.ColumnCount != 2 || table.Controls.Count < 2)
                continue;

            if (!table.Controls.OfType<FlowLayoutPanel>().Any())
                continue;

            foreach (var label in table.Controls.OfType<Label>())
            {
                var position = table.GetPositionFromControl(label);
                if (position.Column == 1)
                    label.Visible = false;
            }
        }
    }

    private void ApplyResponsivePolish()
    {
        var shell = _form.Controls.OfType<TableLayoutPanel>().FirstOrDefault(x => x.ColumnCount == 2);
        if (shell is not null && shell.ColumnStyles.Count > 0)
            shell.ColumnStyles[0].Width = _form.ClientSize.Width < 760 ? 150 : 200;

        foreach (var button in Descendants(_form).OfType<Button>())
        {
            if (!button.Text.StartsWith("Zotero ", StringComparison.Ordinal))
                continue;

            button.Padding = _form.ClientSize.Width < 760
                ? new Padding(8, 6, 6, 6)
                : new Padding(10, 6, 8, 6);
        }
    }

    private void ApplyDynamicPolish()
    {
        foreach (var label in Descendants(_form).OfType<Label>())
        {
            var translated = TranslateRuntimeText(label.Text);
            if (!string.Equals(translated, label.Text, StringComparison.Ordinal))
                label.Text = translated;
        }

        foreach (var button in Descendants(_form).OfType<Button>())
        {
            if (button.Text is "暂停" or "继续" or "设置" or "诊断")
            {
                button.AutoSize = false;
                button.Size = new Size(96, 36);
                button.MinimumSize = new Size(96, 36);
                button.Padding = Padding.Empty;
            }
            else if (button.Text == "初始化与诊断")
            {
                button.Text = "诊断";
                button.AutoSize = false;
                button.Size = new Size(96, 36);
                button.MinimumSize = new Size(96, 36);
                button.Padding = Padding.Empty;
            }
        }
    }

    private static string TranslateRuntimeText(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return text;

        return text
            .Replace("Strong verification complete.", "目标文件已通过强校验", StringComparison.OrdinalIgnoreCase)
            .Replace("Downloading source and calculating SHA-256.", "正在读取源文件并计算 SHA-256", StringComparison.OrdinalIgnoreCase)
            .Replace("Target already exists; downloading it for safe takeover verification.", "正在校验目标端已有副本", StringComparison.OrdinalIgnoreCase)
            .Replace("Uploading target object.", "正在上传目标文件", StringComparison.OrdinalIgnoreCase)
            .Replace("Re-downloading target for strong SHA-256 verification.", "正在重新读取目标文件并进行强校验", StringComparison.OrdinalIgnoreCase)
            .Replace("Current source manifest is strongly verified at target.", "当前源清单已全部完成强校验", StringComparison.OrdinalIgnoreCase)
            .Replace("At least one source object is not strongly verified at the target.", "仍有源文件尚未在目标端完成强校验", StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child))
                yield return nested;
        }
    }

    public void Dispose()
    {
        _timer.Stop();
        _timer.Dispose();
    }
}
