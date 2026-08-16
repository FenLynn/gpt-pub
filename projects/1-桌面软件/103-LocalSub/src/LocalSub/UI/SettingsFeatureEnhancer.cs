using System.Reflection;
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
            Text = "字幕高级样式",
            Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold),
            AutoSize = true,
            Margin = new Padding(3, 18, 3, 6)
        });

        var autoScale = new NumericUpDown { Minimum = 60, Maximum = 160, Value = Math.Clamp(settings.SubtitleAutoScalePercent, 60, 160), Width = 80 };
        var previousScale = new NumericUpDown { Minimum = 40, Maximum = 100, Value = Math.Clamp(settings.SubtitlePreviousScalePercent, 40, 100), Width = 80 };
        var previousOpacity = new NumericUpDown { Minimum = 0, Maximum = 100, Value = Math.Clamp(settings.SubtitlePreviousOpacity, 0, 100), Width = 80 };
        var outlineWidth = new NumericUpDown { Minimum = 0, Maximum = 4, DecimalPlaces = 1, Increment = 0.5M, Value = (decimal)Math.Clamp(settings.SubtitleOutlineWidth, 0, 4), Width = 80 };
        var shadowOpacity = new NumericUpDown { Minimum = 0, Maximum = 100, Value = Math.Clamp(settings.SubtitleShadowOpacity, 0, 100), Width = 80 };
        var currentWeight = WeightCombo(settings.SubtitleCurrentWeight);
        var previousWeight = WeightCombo(settings.SubtitlePreviousWeight);
        var currentColor = ColorButton(settings.SubtitleCurrentColor, "#FFFFFF");
        var previousColor = ColorButton(settings.SubtitlePreviousColor, "#D8D8D8");
        var outlineColor = ColorButton(settings.SubtitleOutlineColor, "#000000");

        flow.Controls.Add(Row("自动字号倍率", autoScale, "%（自动字号开启时仍可整体放大/缩小）"));
        flow.Controls.Add(Row("当前字幕颜色", currentColor, ""));
        flow.Controls.Add(Row("当前字幕字重", currentWeight, ""));
        flow.Controls.Add(Row("上一条大小", previousScale, "% 当前字幕字号"));
        flow.Controls.Add(Row("上一条颜色", previousColor, ""));
        flow.Controls.Add(Row("上一条透明度", previousOpacity, "%"));
        flow.Controls.Add(Row("上一条字重", previousWeight, ""));
        flow.Controls.Add(Row("描边颜色", outlineColor, ""));
        flow.Controls.Add(Row("描边粗细", outlineWidth, "px"));
        flow.Controls.Add(Row("阴影强度", shadowOpacity, "%"));
        flow.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(760, 0),
            ForeColor = Color.DimGray,
            Text = "高级样式会立即保存。自动字号倍率只改变自动计算后的相对大小；当前字幕与上一条字幕可分别设置颜色、字重、大小和透明度。"
        });

        void ApplyAdvancedSubtitle()
        {
            var s = AppSettings.Load();
            s.SubtitleAutoScalePercent = (int)autoScale.Value;
            s.SubtitleCurrentColor = NormalizeHex(currentColor.Text, "#FFFFFF");
            s.SubtitleCurrentWeight = SelectedWeight(currentWeight, 500);
            s.SubtitlePreviousScalePercent = (int)previousScale.Value;
            s.SubtitlePreviousColor = NormalizeHex(previousColor.Text, "#D8D8D8");
            s.SubtitlePreviousOpacity = (int)previousOpacity.Value;
            s.SubtitlePreviousWeight = SelectedWeight(previousWeight, 400);
            s.SubtitleOutlineColor = NormalizeHex(outlineColor.Text, "#000000");
            s.SubtitleOutlineWidth = (double)outlineWidth.Value;
            s.SubtitleShadowOpacity = (int)shadowOpacity.Value;
            s.Save();
            SyncMainSettings(root, s);
        }

        autoScale.ValueChanged += (_, _) => ApplyAdvancedSubtitle();
        previousScale.ValueChanged += (_, _) => ApplyAdvancedSubtitle();
        previousOpacity.ValueChanged += (_, _) => ApplyAdvancedSubtitle();
        outlineWidth.ValueChanged += (_, _) => ApplyAdvancedSubtitle();
        shadowOpacity.ValueChanged += (_, _) => ApplyAdvancedSubtitle();
        currentWeight.SelectedIndexChanged += (_, _) => ApplyAdvancedSubtitle();
        previousWeight.SelectedIndexChanged += (_, _) => ApplyAdvancedSubtitle();
        currentColor.Click += (_, _) => { if (PickColor(currentColor)) ApplyAdvancedSubtitle(); };
        previousColor.Click += (_, _) => { if (PickColor(previousColor)) ApplyAdvancedSubtitle(); };
        outlineColor.Click += (_, _) => { if (PickColor(outlineColor)) ApplyAdvancedSubtitle(); };

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
                ApplyAdvancedSubtitle();
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
                SyncMainSettings(root, s);
                MessageBox.Show("字幕高级样式、性能、FFmpeg 与后台设置已保存。新的资源模式会在下一次启动识别任务时生效。", "LocalSub");
            }
            catch (Exception ex)
            {
                MessageBox.Show("保存失败：\n" + ex.Message, "LocalSub");
            }
        };
    }

    static ComboBox WeightCombo(int weight)
    {
        var box = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 130 };
        box.Items.AddRange(["常规 400", "中等 500", "半粗 600", "粗体 700"]);
        box.SelectedIndex = weight switch { 500 => 1, 600 => 2, 700 => 3, _ => 0 };
        return box;
    }

    static int SelectedWeight(ComboBox box, int fallback)
        => box.SelectedIndex switch { 0 => 400, 1 => 500, 2 => 600, 3 => 700, _ => fallback };

    static Button ColorButton(string value, string fallback)
    {
        var hex = NormalizeHex(value, fallback);
        var b = new Button { Text = hex, Width = 115, Height = 27 };
        ApplyButtonColor(b, hex);
        return b;
    }

    static bool PickColor(Button button)
    {
        using var dlg = new ColorDialog { FullOpen = true, Color = ParseColor(button.Text, Color.White) };
        if (dlg.ShowDialog() != DialogResult.OK) return false;
        var hex = $"#{dlg.Color.R:X2}{dlg.Color.G:X2}{dlg.Color.B:X2}";
        button.Text = hex;
        ApplyButtonColor(button, hex);
        return true;
    }

    static void ApplyButtonColor(Button button, string hex)
    {
        var color = ParseColor(hex, Color.White);
        button.BackColor = color;
        var luminance = 0.299 * color.R + 0.587 * color.G + 0.114 * color.B;
        button.ForeColor = luminance < 145 ? Color.White : Color.Black;
        button.UseVisualStyleBackColor = false;
    }

    static Color ParseColor(string? value, Color fallback)
    {
        try { return ColorTranslator.FromHtml(NormalizeHex(value, $"#{fallback.R:X2}{fallback.G:X2}{fallback.B:X2}")); }
        catch { return fallback; }
    }

    static string NormalizeHex(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        var s = value.Trim();
        return s.Length == 7 && s[0] == '#' && s.Skip(1).All(Uri.IsHexDigit) ? s.ToUpperInvariant() : fallback;
    }

    static void SyncMainSettings(Form root, AppSettings source)
    {
        try
        {
            var field = root.GetType().GetField("_settings", BindingFlags.Instance | BindingFlags.NonPublic);
            if (field?.GetValue(root) is not AppSettings target) return;
            target.SubtitleAutoScalePercent = source.SubtitleAutoScalePercent;
            target.SubtitleCurrentColor = source.SubtitleCurrentColor;
            target.SubtitleCurrentWeight = source.SubtitleCurrentWeight;
            target.SubtitlePreviousScalePercent = source.SubtitlePreviousScalePercent;
            target.SubtitlePreviousColor = source.SubtitlePreviousColor;
            target.SubtitlePreviousOpacity = source.SubtitlePreviousOpacity;
            target.SubtitlePreviousWeight = source.SubtitlePreviousWeight;
            target.SubtitleOutlineColor = source.SubtitleOutlineColor;
            target.SubtitleOutlineWidth = source.SubtitleOutlineWidth;
            target.SubtitleShadowOpacity = source.SubtitleShadowOpacity;
            target.FfmpegPath = source.FfmpegPath;
            target.ResourceProfile = source.ResourceProfile;
            target.MinimizeToTray = source.MinimizeToTray;
            target.StartWithWindows = source.StartWithWindows;
        }
        catch { }
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
