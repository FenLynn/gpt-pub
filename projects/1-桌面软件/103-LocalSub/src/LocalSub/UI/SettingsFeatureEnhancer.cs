using Microsoft.Win32;
using LocalSub.Core;
using LocalSub.Models;
using LocalSub.Services;

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

        var selectedFfmpegPath = settings.FfmpegPath;
        var ffmpegText = new TextBox { Width = 330, ReadOnly = true };
        var ffmpegStatus = new Label { AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(6, 4, 0, 6), MaximumSize = new Size(760, 0) };
        var chooseFfmpeg = new Button { Text = "选择已有", Width = 88, Height = 27 };
        var clearFfmpeg = new Button { Text = "自动", Width = 62, Height = 27 };
        var ffmpegRow = new FlowLayoutPanel { Width = 760, Height = 34, WrapContents = false };
        ffmpegRow.Controls.Add(new Label { Text = "FFmpeg", Width = 130, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 7, 6, 0) });
        ffmpegRow.Controls.Add(ffmpegText);
        ffmpegRow.Controls.Add(chooseFfmpeg);
        ffmpegRow.Controls.Add(clearFfmpeg);
        flow.Controls.Add(ffmpegRow);
        flow.Controls.Add(ffmpegStatus);
        flow.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(760, 0),
            ForeColor = Color.DimGray,
            Text = "留空时自动寻找 LocalSub 自有组件、附近 Mediova\\Components\\FFmpeg\\bin 和系统 PATH。也可以直接指定 Mediova 的 ffmpeg.exe；只有都找不到时才需要在后台页单独下载。"
        });

        void RefreshFfmpegPreview()
        {
            var probeSettings = AppSettings.Load();
            probeSettings.FfmpegPath = selectedFfmpegPath;
            var manager = new FfmpegManager(probeSettings);
            ffmpegText.Text = manager.IsInstalled
                ? manager.FfmpegPath
                : string.IsNullOrWhiteSpace(selectedFfmpegPath) ? "自动查找，当前未发现" : selectedFfmpegPath;
            ffmpegStatus.Text = manager.IsInstalled
                ? $"FFmpeg 可用，来源：{manager.SourceName}"
                : "FFmpeg 未找到。MP4 等 Media Foundation 可解析文件仍可直接后台转写。";
        }
        RefreshFfmpegPreview();

        chooseFfmpeg.Click += (_, _) =>
        {
            using var dlg = new OpenFileDialog
            {
                Filter = "ffmpeg.exe|ffmpeg.exe|可执行文件|*.exe",
                Title = "选择已有 FFmpeg，可直接选择 Mediova 的 ffmpeg.exe"
            };
            var currentManager = new FfmpegManager(AppSettings.Load());
            try
            {
                if (currentManager.IsInstalled && File.Exists(currentManager.FfmpegPath))
                    dlg.InitialDirectory = Path.GetDirectoryName(currentManager.FfmpegPath);
            }
            catch { }
            if (dlg.ShowDialog() != DialogResult.OK) return;
            if (!FfmpegManager.ValidatePair(dlg.FileName, out var ffmpeg, out _))
            {
                MessageBox.Show("所选目录中没有完整的 ffmpeg.exe + ffprobe.exe。请选 Mediova 的 Components\\FFmpeg\\bin\\ffmpeg.exe。", "LocalSub");
                return;
            }
            selectedFfmpegPath = ffmpeg;
            RefreshFfmpegPreview();
        };

        clearFfmpeg.Click += (_, _) =>
        {
            selectedFfmpegPath = "";
            RefreshFfmpegPreview();
        };

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
                s.FfmpegPath = selectedFfmpegPath;
                s.MinimizeToTray = tray.Checked;
                s.StartWithWindows = startup.Checked;
                ApplyStartupRegistration(startup.Checked);
                s.Save();
                MessageBox.Show("性能、FFmpeg 与后台设置已保存。新的资源模式会在下一次启动识别任务时生效。", "LocalSub");
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
