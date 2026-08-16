using Microsoft.Win32;
using LocalSub.Core;
using LocalSub.Models;

namespace LocalSub.UI;

public static class SettingsFeatureEnhancer
{
    const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValueName = "LocalSub";

    public static void Attach(Form root)
    {
        var tabs = FindControls<TabControl>(root).FirstOrDefault();
        var page = tabs?.TabPages.Cast<TabPage>().FirstOrDefault(x => x.Text == "设置");
        if (page == null) return;
        var flow = FindControls<FlowLayoutPanel>(page).FirstOrDefault();
        if (flow == null) return;

        var settings = AppSettings.Load();
        flow.Controls.Add(new Label
        {
            Text = "性能与后台",
            Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold),
            AutoSize = true,
            Margin = new Padding(3, 18, 3, 6)
        });

        var profile = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 170 };
        profile.Items.AddRange(["节能", "自动", "最大性能"]);
        profile.SelectedIndex = settings.ResourceProfile switch
        {
            ResourceProfile.Eco => 0,
            ResourceProfile.MaxPerformance => 2,
            _ => 1
        };
        flow.Controls.Add(Row("资源模式", profile, "实时和后台 ASR 的 CPU 线程策略"));

        var tray = new CheckBox { Text = "最小化到系统托盘", AutoSize = true, Checked = settings.MinimizeToTray };
        var startup = new CheckBox { Text = "开机自动启动 LocalSub", AutoSize = true, Checked = IsStartupRegistered() || settings.StartWithWindows };
        flow.Controls.Add(tray);
        flow.Controls.Add(startup);
        flow.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(760, 0),
            ForeColor = Color.DimGray,
            Text = "资源模式默认“自动”。开机启动只写入当前用户 HKCU，不需要管理员权限；关闭后会移除该启动项。"
        });

        var save = new Button { Text = "保存性能设置", Width = 130, Height = 30, Margin = new Padding(3, 8, 3, 12) };
        flow.Controls.Add(save);
        save.Click += (_, _) =>
        {
            try
            {
                var s = AppSettings.Load();
                s.ResourceProfile = profile.SelectedIndex switch
                {
                    0 => ResourceProfile.Eco,
                    2 => ResourceProfile.MaxPerformance,
                    _ => ResourceProfile.Auto
                };
                s.MinimizeToTray = tray.Checked;
                s.StartWithWindows = startup.Checked;
                ApplyStartupRegistration(startup.Checked);
                s.Save();
                MessageBox.Show("性能与后台设置已保存。新的资源模式会在下一次启动识别任务时生效。", "LocalSub");
            }
            catch (Exception ex)
            {
                MessageBox.Show("保存失败：\n" + ex.Message, "LocalSub");
            }
        };
    }

    static FlowLayoutPanel Row(string label, Control control, string suffix)
    {
        var row = new FlowLayoutPanel { Width = 760, Height = 34, WrapContents = false };
        row.Controls.Add(new Label { Text = label, Width = 130, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 7, 6, 0) });
        row.Controls.Add(control);
        row.Controls.Add(new Label { Text = suffix, AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(8, 7, 0, 0) });
        return row;
    }

    static bool IsStartupRegistered()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, false);
            return !string.IsNullOrWhiteSpace(key?.GetValue(RunValueName) as string);
        }
        catch { return false; }
    }

    static void ApplyStartupRegistration(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, true);
        if (enabled)
        {
            var exe = Environment.ProcessPath ?? Path.Combine(PortablePaths.BaseDir, "LocalSub.exe");
            key.SetValue(RunValueName, $"\"{exe}\"", RegistryValueKind.String);
        }
        else key.DeleteValue(RunValueName, false);
    }

    static IEnumerable<T> FindControls<T>(Control root) where T : Control
    {
        foreach (Control child in root.Controls)
        {
            if (child is T t) yield return t;
            foreach (var nested in FindControls<T>(child)) yield return nested;
        }
    }
}
