namespace DavBridge;

internal static class SettingsPolish
{
    private const string Marker = "DavBridge.SettingsPolished";

    public static void TryApplyOpenDialogs()
    {
        foreach (Form form in Application.OpenForms)
        {
            if (form is SettingsDialog settings && !string.Equals(settings.Tag as string, Marker, StringComparison.Ordinal))
                Apply(settings);
        }
    }

    private static void Apply(SettingsDialog form)
    {
        var original = form.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        if (original is null) return;
        form.Tag = Marker;

        var rows = CaptureRows(original);
        var footer = rows.FirstOrDefault(row => row.Controls.Any(x => x is FlowLayoutPanel && Descendants(x).OfType<Button>().Any(b => b.Text is "保存" or "取消")));

        var accountRows = new List<RowBundle>();
        var quotaRows = new List<RowBundle>();
        var backgroundRows = new List<RowBundle>();
        var safetyRows = new List<RowBundle>();

        foreach (var row in rows)
        {
            if (ReferenceEquals(row, footer)) continue;
            var text = RowText(row);

            if (ContainsAny(text,
                    "InfiniCLOUD", "WebDAV URL", "源目录", "Connection ID", "User ID", "Apps Password",
                    "坚果云 WebDAV", "目标目录", "坚果云注册邮箱", "第三方应用密码"))
            {
                accountRows.Add(row);
            }
            else if (ContainsAny(text, "上传限速", "普通预留", "冲刺预留", "周期末冲刺"))
            {
                quotaRows.Add(row);
            }
            else if (ContainsAny(text, "Windows 登录后自动启动", "启动后默认进入托盘", "网络恢复和新周期后自动继续"))
            {
                backgroundRows.Add(row);
            }
            else
            {
                safetyRows.Add(row);
            }
        }

        original.Controls.Clear();
        form.Controls.Clear();
        form.Width = 830;
        form.Height = 620;
        form.MinimumSize = new Size(700, 520);
        form.BackColor = Color.White;

        var shell = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2 };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 178));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var nav = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(247, 248, 250), Padding = new Padding(14, 18, 12, 14) };
        var navStack = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false
        };
        navStack.Controls.Add(new Label
        {
            Text = "设置",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 15F),
            Margin = new Padding(8, 0, 0, 14)
        });
        nav.Controls.Add(navStack);
        shell.Controls.Add(nav, 0, 0);
        shell.SetRowSpan(nav, 2);

        var hostPanel = new Panel { Dock = DockStyle.Fill, AutoScroll = true, BackColor = Color.White, Padding = new Padding(26, 22, 26, 16) };
        shell.Controls.Add(hostPanel, 1, 0);

        var account = CategoryPanel("账户与端点", accountRows);
        var quota = CategoryPanel("流量与限速", quotaRows);
        var background = CategoryPanel("后台运行", backgroundRows);
        var safety = CategoryPanel("安全与维护", safetyRows);
        AddMaintenanceTools(form, safety);

        var categories = new[]
        {
            ("账户与端点", account),
            ("流量与限速", quota),
            ("后台运行", background),
            ("安全与维护", safety)
        };

        var navButtons = new List<Button>();
        void SelectCategory(Panel panel, Button selected)
        {
            hostPanel.SuspendLayout();
            hostPanel.Controls.Clear();
            hostPanel.Controls.Add(panel);
            panel.Dock = DockStyle.Top;
            panel.BringToFront();
            hostPanel.ResumeLayout(true);
            foreach (var button in navButtons)
            {
                button.BackColor = ReferenceEquals(button, selected) ? Color.White : Color.FromArgb(247, 248, 250);
                button.Font = new Font("Segoe UI", 9F, ReferenceEquals(button, selected) ? FontStyle.Bold : FontStyle.Regular);
            }
        }

        foreach (var (name, panel) in categories)
        {
            var button = new Button
            {
                Text = name,
                Width = 146,
                Height = 40,
                FlatStyle = FlatStyle.Flat,
                TextAlign = ContentAlignment.MiddleLeft,
                Padding = new Padding(10, 0, 0, 0),
                Margin = new Padding(0, 0, 0, 4),
                BackColor = Color.FromArgb(247, 248, 250)
            };
            button.FlatAppearance.BorderSize = 0;
            button.Click += (_, _) => SelectCategory(panel, button);
            navButtons.Add(button);
            navStack.Controls.Add(button);
        }

        var footerHolder = new Panel { Dock = DockStyle.Fill, Height = 58, Padding = new Padding(20, 9, 26, 9), BackColor = Color.White };
        if (footer is not null)
        {
            var footerControl = footer.Controls.FirstOrDefault(x => x is FlowLayoutPanel) ?? footer.Controls.FirstOrDefault();
            if (footerControl is not null)
            {
                footerControl.Dock = DockStyle.Right;
                footerControl.Margin = Padding.Empty;
                foreach (var button in Descendants(footerControl).OfType<Button>())
                {
                    button.AutoSize = false;
                    button.Size = new Size(88, 34);
                    button.Margin = new Padding(8, 0, 0, 0);
                }
                footerHolder.Controls.Add(footerControl);
            }
        }
        shell.Controls.Add(footerHolder, 1, 1);

        form.Controls.Add(shell);
        SelectCategory(account, navButtons[0]);
    }

    private static Panel CategoryPanel(string title, IReadOnlyList<RowBundle> rows)
    {
        var panel = new Panel { AutoSize = true, BackColor = Color.White };
        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2 };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        var heading = new Label
        {
            Text = title,
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 15F),
            Margin = new Padding(0, 0, 0, 16)
        };
        var headingRow = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(heading, 0, headingRow);
        table.SetColumnSpan(heading, 2);

        foreach (var row in rows)
            AddCapturedRow(table, row);

        panel.Controls.Add(table);
        return panel;
    }

    private static void AddMaintenanceTools(SettingsDialog settings, Panel categoryPanel)
    {
        var table = categoryPanel.Controls.OfType<TableLayoutPanel>().FirstOrDefault();
        if (table is null) return;

        var sep = new Panel { Height = 1, Dock = DockStyle.Top, BackColor = Color.FromArgb(225, 227, 230), Margin = new Padding(0, 14, 0, 14) };
        var row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(sep, 0, row);
        table.SetColumnSpan(sep, 2);

        var title = new Label { Text = "维护工具", AutoSize = true, Font = new Font("Segoe UI Semibold", 10.5F), Margin = new Padding(0, 2, 0, 8) };
        row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(title, 0, row);
        table.SetColumnSpan(title, 2);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true, Margin = Padding.Empty };
        var main = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
        var host = main is null ? null : UiCommandBridge.GetHost(main);

        buttons.Controls.Add(MaintenanceButton("连接诊断", settings, "DiagnoseConnectionsAsync", enabled: true));
        buttons.Controls.Add(MaintenanceButton("就绪扫描", settings, "ScanAsync", enabled: true));
        buttons.Controls.Add(MaintenanceButton("校准流量", settings, "CalibrateAsync", enabled: true));

        var firstPassed = host is not null && FirstGroupValidationRunner.HasCompletedZoteroValidation(host.State);
        var existingPassed = host?.State.ExistingReplicaValidationPassed == true;
        buttons.Controls.Add(MaintenanceButton(firstPassed ? "首组验证  已通过" : "首组验证", settings, "ValidateFirstGroupAsync", !firstPassed));
        buttons.Controls.Add(MaintenanceButton(existingPassed ? "既有副本验证  已通过" : "既有副本验证", settings, "ValidateExistingReplicaAsync", !existingPassed));

        row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(buttons, 0, row);
        table.SetColumnSpan(buttons, 2);
    }

    private static Button MaintenanceButton(string text, SettingsDialog settings, string methodName, bool enabled)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = false,
            Width = text.Length > 8 ? 142 : 108,
            Height = 34,
            Enabled = enabled,
            Margin = new Padding(0, 0, 8, 8)
        };
        button.Click += (_, _) =>
        {
            var main = Application.OpenForms.OfType<MainForm>().FirstOrDefault();
            if (main is null) return;
            settings.DialogResult = DialogResult.Cancel;
            settings.Close();
            main.BeginInvoke(new Action(() =>
            {
                var task = UiCommandBridge.InvokeTask(main, methodName);
                if (task is not null) _ = task;
            }));
        };
        return button;
    }

    private static void AddCapturedRow(TableLayoutPanel target, RowBundle row)
    {
        if (row.Controls.Count == 0) return;
        var targetRow = target.RowCount++;
        target.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        foreach (var control in row.Controls)
        {
            control.Margin = control is Label && row.Controls.Count == 1
                ? new Padding(0, 7, 0, 7)
                : new Padding(0, 5, 8, 5);
        }

        if (row.Controls.Count == 1)
        {
            var control = row.Controls[0];
            control.Dock = control is CheckBox ? DockStyle.Top : control.Dock;
            target.Controls.Add(control, 0, targetRow);
            target.SetColumnSpan(control, 2);
            return;
        }

        var left = row.Controls[0];
        var right = row.Controls[1];
        left.Dock = DockStyle.Top;
        right.Dock = DockStyle.Top;
        target.Controls.Add(left, 0, targetRow);
        target.Controls.Add(right, 1, targetRow);
    }

    private static List<RowBundle> CaptureRows(TableLayoutPanel table)
    {
        var rows = new List<RowBundle>();
        for (var row = 0; row < table.RowCount; row++)
        {
            var controls = table.Controls.Cast<Control>()
                .Where(control => table.GetPositionFromControl(control).Row == row)
                .OrderBy(control => table.GetPositionFromControl(control).Column)
                .ToList();
            if (controls.Count > 0)
                rows.Add(new RowBundle(controls));
        }
        return rows;
    }

    private static string RowText(RowBundle row) => string.Join(" ", row.Controls.SelectMany(DescendantsAndSelf).Select(x => x.Text).Where(x => !string.IsNullOrWhiteSpace(x)));

    private static bool ContainsAny(string text, params string[] values) => values.Any(value => text.Contains(value, StringComparison.OrdinalIgnoreCase));

    private static IEnumerable<Control> DescendantsAndSelf(Control root)
    {
        yield return root;
        foreach (var child in Descendants(root)) yield return child;
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child)) yield return nested;
        }
    }

    private sealed record RowBundle(List<Control> Controls);
}
