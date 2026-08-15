using System.Diagnostics;
using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.UI;

public sealed class MainForm : Form
{
    AppSettings _settings = AppSettings.Load();
    IReadOnlyList<ModelDescriptor> _catalog = [];
    ModelManager? _models;
    readonly TranscriptService _transcript = new();
    readonly AllAudioCaptureService _allAudio = new();
    SubtitleOverlayForm? _overlay;

    readonly TabControl tabs = new() { Dock = DockStyle.Fill };
    readonly ComboBox sourceBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 220 };
    readonly ComboBox liveModelBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 360 };
    readonly Label liveStatus = new() { AutoSize = true, Text = "未启动" };
    readonly ProgressBar audioLevel = new() { Width = 360, Maximum = 1000 };
    readonly Button liveStart = new() { Text = "开始", Width = 100 };

    readonly DataGridView modelGrid = new()
    {
        Dock = DockStyle.Fill,
        ReadOnly = true,
        AutoGenerateColumns = false,
        SelectionMode = DataGridViewSelectionMode.FullRowSelect,
        MultiSelect = false,
        AllowUserToAddRows = false,
        AllowUserToDeleteRows = false
    };
    readonly ProgressBar downloadProgress = new() { Dock = DockStyle.Fill, Height = 18 };
    readonly Label modelStatusTitle = new() { Dock = DockStyle.Fill, Text = "就绪", TextAlign = ContentAlignment.MiddleLeft };
    readonly Label modelStatusDetail = new() { Dock = DockStyle.Fill, Text = "选择模型后点击“下载/修复”。下载、解压、校验状态会显示在这里。", TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    readonly TextBox modelLog = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window };
    readonly Button modelDownloadButton = new() { Text = "下载/修复", Width = 110 };
    readonly Button modelDeleteButton = new() { Text = "删除", Width = 90 };
    readonly Button modelOpenButton = new() { Text = "打开 ASR 目录", Width = 130 };
    readonly Button modelScanButton = new() { Text = "重新扫描", Width = 100 };
    readonly Button modelCancelButton = new() { Text = "取消", Width = 90, Enabled = false };
    CancellationTokenSource? _modelDownloadCts;
    ModelDescriptor? _activeModel;
    string _lastLoggedStage = "";
    int _lastLoggedBucket = -1;

    readonly TextBox asrPath = new() { Width = 520 };
    readonly ComboBox proxyMode = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 160 };
    readonly TextBox socksUrl = new() { Width = 360 };
    readonly TextBox keywords = new() { Multiline = true, Width = 520, Height = 90 };
    readonly ListBox batchFiles = new() { Dock = DockStyle.Fill };

    public MainForm()
    {
        Text = "LocalSub 0.1.0 dev";
        Width = 980;
        Height = 690;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(840, 600);
        Controls.Add(tabs);
        BuildLiveTab();
        BuildBatchTab();
        BuildModelsTab();
        BuildSettingsTab();
        Load += (_, _) => ReloadAll();
        FormClosed += (_, _) =>
        {
            _modelDownloadCts?.Cancel();
            _modelDownloadCts?.Dispose();
            _allAudio.Dispose();
            _overlay?.Close();
        };
        _allAudio.LevelChanged += v => BeginInvoke(() => audioLevel.Value = (int)(v * 1000));
    }

    void ReloadAll()
    {
        _settings = AppSettings.Load();
        _catalog = new ModelCatalogService().Load();
        _models = new ModelManager(_settings);
        sourceBox.Items.Clear();
        sourceBox.Items.AddRange(["PotPlayer", "所有音频"]);
        sourceBox.SelectedIndex = _settings.AudioSource == AudioSourceMode.PotPlayer ? 0 : 1;
        FillLiveModels();
        RefreshModels();
        asrPath.Text = _settings.AsrRoot;
        proxyMode.Items.Clear();
        proxyMode.Items.AddRange(["系统代理", "直连", "SOCKS5"]);
        proxyMode.SelectedIndex = _settings.ProxyMode switch { ProxyMode.Direct => 1, ProxyMode.Socks5 => 2, _ => 0 };
        socksUrl.Text = _settings.Socks5Url;
        keywords.Text = _settings.Keywords;
    }

    void BuildLiveTab()
    {
        var t = new TabPage("实时字幕");
        var p = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(24), AutoScroll = true, WrapContents = false };
        p.Controls.Add(new Label { Text = "音源", AutoSize = true });
        p.Controls.Add(sourceBox);
        p.Controls.Add(new Label { Text = "实时模型", AutoSize = true, Margin = new Padding(3, 16, 3, 3) });
        p.Controls.Add(liveModelBox);
        p.Controls.Add(new Label { Text = "输入电平", AutoSize = true, Margin = new Padding(3, 16, 3, 3) });
        p.Controls.Add(audioLevel);
        p.Controls.Add(liveStart);
        p.Controls.Add(liveStatus);
        var demo = new Button { Text = "显示 HTML 字幕层", Width = 180, Margin = new Padding(3, 14, 3, 3) };
        demo.Click += async (_, _) =>
        {
            EnsureOverlay();
            _overlay!.Show();
            await _overlay.SetTextAsync("这是 LocalSub 的 HTML 字幕层", "上一句字幕", ParseKeywords());
        };
        p.Controls.Add(demo);
        liveStart.Click += LiveStart_Click;
        t.Controls.Add(p);
        tabs.TabPages.Add(t);
    }

    async void LiveStart_Click(object? sender, EventArgs e)
    {
        if (liveStart.Text == "停止")
        {
            _allAudio.Stop();
            liveStart.Text = "开始";
            liveStatus.Text = "已停止";
            return;
        }

        if (sourceBox.SelectedIndex == 0)
        {
            var p = PotPlayerWatcher.FindRunning();
            if (p == null)
            {
                liveStatus.Text = "未检测到 PotPlayer";
                return;
            }
            liveStatus.Text = $"已检测到 PotPlayer PID {p.Id}。专用 Process Loopback 正在接入，不会错误回退为全系统音频。";
            EnsureOverlay();
            _overlay!.Show();
            await _overlay.SetTextAsync("已连接 PotPlayer，等待专用音频捕获模块", "LocalSub");
        }
        else
        {
            _allAudio.Start();
            liveStart.Text = "停止";
            liveStatus.Text = "正在监听所有 Windows 输出音频（当前先显示输入电平）";
            EnsureOverlay();
            _overlay!.Show();
            await _overlay.SetTextAsync("音频捕获已启动，ASR 接口待模型引擎接入", "LocalSub");
        }
    }

    void EnsureOverlay()
    {
        if (_overlay == null || _overlay.IsDisposed)
        {
            _overlay = new SubtitleOverlayForm();
            var area = Screen.PrimaryScreen!.WorkingArea;
            _overlay.Location = new Point(area.Left + (area.Width - _overlay.Width) / 2, area.Bottom - _overlay.Height - 60);
        }
    }

    void BuildBatchTab()
    {
        var t = new TabPage("后台转写") { AllowDrop = true };
        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 390 };
        split.Panel1.Controls.Add(batchFiles);
        split.Panel1.Controls.Add(new Label { Dock = DockStyle.Top, Height = 62, Text = "把视频拖到这里。v0.1 已建立队列、关键词与导出数据骨架；高速媒体解码/ASR 流水线在下一实现步接入。", Padding = new Padding(12) });
        var bottom = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(12), FlowDirection = FlowDirection.TopDown, AutoScroll = true };
        bottom.Controls.Add(new Label { Text = "关键词（逗号、分号或换行分隔）", AutoSize = true });
        bottom.Controls.Add(keywords);
        var export = new Button { Text = "导出 TXT", Width = 120 };
        export.Click += (_, _) => ExportTxt();
        bottom.Controls.Add(export);
        split.Panel2.Controls.Add(bottom);
        t.Controls.Add(split);
        t.DragEnter += (_, e) =>
        {
            if (e.Data?.GetDataPresent(DataFormats.FileDrop) == true) e.Effect = DragDropEffects.Copy;
        };
        t.DragDrop += (_, e) =>
        {
            if (e.Data?.GetData(DataFormats.FileDrop) is string[] fs)
                foreach (var f in fs)
                    if (!batchFiles.Items.Contains(f)) batchFiles.Items.Add(f);
        };
        tabs.TabPages.Add(t);
    }

    void ExportTxt()
    {
        using var dlg = new SaveFileDialog { Filter = "Text|*.txt", FileName = "transcript.txt" };
        if (dlg.ShowDialog() == DialogResult.OK) _transcript.ExportTxt(dlg.FileName, true);
    }

    void BuildModelsTab()
    {
        var t = new TabPage("模型");
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "模型", DataPropertyName = "Name", Width = 260 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "用途", DataPropertyName = "Purpose", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "大小", DataPropertyName = "Size", Width = 120 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "状态", DataPropertyName = "Status", Width = 110 });

        modelStatusTitle.Font = new Font(modelStatusTitle.Font, FontStyle.Bold);
        modelLog.Text = "等待操作。";

        var split = new SplitContainer
        {
            Dock = DockStyle.Fill,
            Orientation = Orientation.Horizontal,
            SplitterDistance = 300,
            Panel1MinSize = 180,
            Panel2MinSize = 170
        };
        split.Panel1.Controls.Add(modelGrid);

        var statusLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(10, 8, 10, 8),
            ColumnCount = 1,
            RowCount = 4
        };
        statusLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        statusLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        statusLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        statusLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        statusLayout.Controls.Add(modelStatusTitle, 0, 0);
        statusLayout.Controls.Add(modelStatusDetail, 0, 1);
        statusLayout.Controls.Add(downloadProgress, 0, 2);
        statusLayout.Controls.Add(modelLog, 0, 3);
        split.Panel2.Controls.Add(statusLayout);

        var bar = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(8), WrapContents = false };
        bar.Controls.AddRange([modelDownloadButton, modelCancelButton, modelDeleteButton, modelOpenButton, modelScanButton]);

        modelDownloadButton.Click += async (_, _) => await DownloadSelected();
        modelCancelButton.Click += (_, _) => _modelDownloadCts?.Cancel();
        modelDeleteButton.Click += (_, _) => DeleteSelected();
        modelOpenButton.Click += (_, _) => Process.Start(new ProcessStartInfo("explorer.exe", _settings.ResolvedAsrRoot) { UseShellExecute = true });
        modelScanButton.Click += (_, _) =>
        {
            AppendModelLog("重新扫描 ASR 模型目录。", true);
            RefreshModels();
        };
        modelGrid.SelectionChanged += (_, _) =>
        {
            if (_modelDownloadCts != null) return;
            var m = SelectedModel();
            if (m == null) return;
            modelStatusTitle.Text = m.Name;
            modelStatusDetail.Text = _models?.IsInstalled(m) == true ? "状态：已安装" : "状态：未安装。点击“下载/修复”开始。";
        };

        t.Controls.Add(split);
        t.Controls.Add(bar);
        tabs.TabPages.Add(t);
    }

    void RefreshModels()
    {
        if (_models == null) return;
        var selectedId = SelectedModel()?.Id;
        modelGrid.DataSource = _catalog.Select(m => new
        {
            Model = m,
            m.Name,
            m.Purpose,
            Size = m.SizeText,
            Status = _models.IsInstalled(m) ? "已安装" : "未安装"
        }).ToList();

        if (!string.IsNullOrWhiteSpace(selectedId))
        {
            foreach (DataGridViewRow row in modelGrid.Rows)
            {
                if (GetBoundModel(row)?.Id == selectedId)
                {
                    row.Selected = true;
                    modelGrid.CurrentCell = row.Cells[0];
                    break;
                }
            }
        }
        FillLiveModels();
    }

    ModelDescriptor? SelectedModel() => modelGrid.CurrentRow == null ? null : GetBoundModel(modelGrid.CurrentRow);

    static ModelDescriptor? GetBoundModel(DataGridViewRow row)
    {
        var item = row.DataBoundItem;
        return item?.GetType().GetProperty("Model")?.GetValue(item) as ModelDescriptor;
    }

    async Task DownloadSelected()
    {
        var m = SelectedModel();
        if (m == null || _models == null || _modelDownloadCts != null) return;

        _activeModel = m;
        _modelDownloadCts = new CancellationTokenSource();
        _lastLoggedStage = "";
        _lastLoggedBucket = -1;
        downloadProgress.Style = ProgressBarStyle.Continuous;
        downloadProgress.Value = 0;
        modelLog.Clear();
        modelStatusTitle.Text = $"{m.Name} · 准备";
        modelStatusDetail.Text = "正在启动模型任务……";
        AppendModelLog($"开始处理 {m.Name}。", true);
        SetModelBusy(true);
        SetModelRowStatus(m.Id, "准备中");

        try
        {
            var progress = new Progress<ModelOperationProgress>(OnModelProgress);
            await _models.DownloadAsync(m, progress, _modelDownloadCts.Token);
            RefreshModels();
            modelStatusTitle.Text = $"{m.Name} · 已完成";
            modelStatusDetail.Text = $"模型已安装到：{_models.GetModelFolder(m)}";
            downloadProgress.Style = ProgressBarStyle.Continuous;
            downloadProgress.Value = 100;
            AppendModelLog("完成。模型已通过关键文件校验。", true);
        }
        catch (OperationCanceledException)
        {
            modelStatusTitle.Text = $"{m.Name} · 已取消";
            modelStatusDetail.Text = "任务已取消。未完成的下载会保留 .part 文件，下次可继续。";
            downloadProgress.Style = ProgressBarStyle.Continuous;
            AppendModelLog("用户取消任务，已保留可续传数据。", true);
            SetModelRowStatus(m.Id, _models.IsInstalled(m) ? "已安装" : "未安装");
        }
        catch (Exception ex)
        {
            modelStatusTitle.Text = $"{m.Name} · 失败";
            modelStatusDetail.Text = ex.Message.Split('\n')[0];
            downloadProgress.Style = ProgressBarStyle.Continuous;
            AppendModelLog("失败：" + ex.Message, true);
            SetModelRowStatus(m.Id, "失败");
        }
        finally
        {
            SetModelBusy(false);
            _modelDownloadCts.Dispose();
            _modelDownloadCts = null;
            _activeModel = null;
        }
    }

    void OnModelProgress(ModelOperationProgress p)
    {
        if (_activeModel == null) return;

        modelStatusTitle.Text = $"{_activeModel.Name} · {p.Stage}";
        modelStatusDetail.Text = BuildProgressDetail(p);

        if (p.IsIndeterminate || !p.Percent.HasValue)
        {
            downloadProgress.Style = ProgressBarStyle.Marquee;
            downloadProgress.MarqueeAnimationSpeed = 25;
        }
        else
        {
            downloadProgress.Style = ProgressBarStyle.Continuous;
            downloadProgress.Value = Math.Clamp(p.Percent.Value, 0, 100);
        }

        var rowStatus = p.Percent.HasValue && p.Stage == "下载" ? $"下载 {p.Percent.Value}%" : p.Stage;
        SetModelRowStatus(_activeModel.Id, rowStatus);

        var bucket = p.Percent.HasValue ? p.Percent.Value / 10 : -1;
        var important = p.Stage != _lastLoggedStage ||
                        (p.Stage == "下载" && bucket != _lastLoggedBucket) ||
                        p.Stage is "重试" or "缓存无效" or "完成";
        if (important)
        {
            AppendModelLog($"{p.Stage}：{BuildProgressDetail(p)}", true);
            _lastLoggedStage = p.Stage;
            _lastLoggedBucket = bucket;
        }
    }

    static string BuildProgressDetail(ModelOperationProgress p)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(p.Detail)) parts.Add(p.Detail);
        if (p.TotalBytes.HasValue && p.TotalBytes.Value > 0)
            parts.Add($"{FormatBytes(p.BytesDone)} / {FormatBytes(p.TotalBytes.Value)}");
        else if (p.BytesDone > 0)
            parts.Add(FormatBytes(p.BytesDone));
        if (p.Percent.HasValue) parts.Add($"{p.Percent.Value}%");
        if (p.BytesPerSecond > 0) parts.Add($"{FormatBytes((long)p.BytesPerSecond)}/s");
        return parts.Count == 0 ? p.Stage : string.Join("    ", parts);
    }

    static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double value = Math.Max(0, bytes);
        var unit = 0;
        while (value >= 1024 && unit < units.Length - 1)
        {
            value /= 1024;
            unit++;
        }
        return unit == 0 ? $"{value:0} {units[unit]}" : $"{value:0.0} {units[unit]}";
    }

    void AppendModelLog(string text, bool timestamp)
    {
        var line = timestamp ? $"[{DateTime.Now:HH:mm:ss}] {text}" : text;
        if (modelLog.TextLength > 0) modelLog.AppendText(Environment.NewLine);
        modelLog.AppendText(line);
        modelLog.SelectionStart = modelLog.TextLength;
        modelLog.ScrollToCaret();
    }

    void SetModelRowStatus(string modelId, string status)
    {
        foreach (DataGridViewRow row in modelGrid.Rows)
        {
            if (GetBoundModel(row)?.Id != modelId) continue;
            row.Cells[3].Value = status;
            break;
        }
    }

    void SetModelBusy(bool busy)
    {
        modelDownloadButton.Enabled = !busy;
        modelDeleteButton.Enabled = !busy;
        modelScanButton.Enabled = !busy;
        modelCancelButton.Enabled = busy;
        modelGrid.Enabled = !busy;
    }

    void DeleteSelected()
    {
        var m = SelectedModel();
        if (m == null || _models == null) return;
        if (MessageBox.Show($"删除 {m.Name}？", "LocalSub", MessageBoxButtons.YesNo) != DialogResult.Yes) return;
        _models.Delete(m);
        AppendModelLog($"已删除 {m.Name}。", true);
        RefreshModels();
    }

    void FillLiveModels()
    {
        var list = _catalog.Where(x => x.LiveCapable && x.Id != "silero-vad").ToList();
        liveModelBox.DataSource = list;
        liveModelBox.DisplayMember = "Name";
        liveModelBox.ValueMember = "Id";
        var idx = list.FindIndex(x => x.Id == _settings.LiveModelId);
        if (idx >= 0) liveModelBox.SelectedIndex = idx;
    }

    void BuildSettingsTab()
    {
        var t = new TabPage("设置");
        var p = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), FlowDirection = FlowDirection.TopDown, AutoScroll = true, WrapContents = false };
        p.Controls.Add(new Label { Text = "ASR 模型根目录（默认 EXE 同级 ASR）", AutoSize = true });
        var row = new FlowLayoutPanel { Width = 760, Height = 42 };
        row.Controls.Add(asrPath);
        var browse = new Button { Text = "浏览", Width = 80 };
        row.Controls.Add(browse);
        p.Controls.Add(row);
        p.Controls.Add(new Label { Text = "下载代理", AutoSize = true, Margin = new Padding(3, 18, 3, 3) });
        p.Controls.Add(proxyMode);
        p.Controls.Add(new Label { Text = "SOCKS5 地址", AutoSize = true });
        p.Controls.Add(socksUrl);
        p.Controls.Add(new Label { Text = "可直接接入 Clash / V2RayN 等本机 SOCKS5。示例：socks5://127.0.0.1:7891 或 socks5://127.0.0.1:10808", AutoSize = true, ForeColor = Color.DimGray });
        var proxyButtons = new FlowLayoutPanel { Width = 620, Height = 42, WrapContents = false };
        var detect = new Button { Text = "自动检测本机 SOCKS5", Width = 170 };
        var test = new Button { Text = "测试模型下载链", Width = 150 };
        var save = new Button { Text = "保存设置", Width = 120 };
        proxyButtons.Controls.AddRange([detect, test, save]);
        p.Controls.Add(proxyButtons);
        browse.Click += (_, _) =>
        {
            using var f = new FolderBrowserDialog { SelectedPath = _settings.ResolvedAsrRoot };
            if (f.ShowDialog() == DialogResult.OK) asrPath.Text = f.SelectedPath;
        };
        save.Click += (_, _) => SaveSettings();
        test.Click += async (_, _) => await TestConnection();
        detect.Click += async (_, _) => await DetectLocalSocks5();
        t.Controls.Add(p);
        tabs.TabPages.Add(t);
    }

    void SaveSettings()
    {
        _settings.AsrRoot = string.IsNullOrWhiteSpace(asrPath.Text) ? "ASR" : asrPath.Text.Trim();
        _settings.ProxyMode = proxyMode.SelectedIndex switch { 1 => ProxyMode.Direct, 2 => ProxyMode.Socks5, _ => ProxyMode.System };
        _settings.Socks5Url = socksUrl.Text.Trim();
        _settings.AudioSource = sourceBox.SelectedIndex == 1 ? AudioSourceMode.AllAudio : AudioSourceMode.PotPlayer;
        if (liveModelBox.SelectedItem is ModelDescriptor m) _settings.LiveModelId = m.Id;
        _settings.Keywords = keywords.Text;
        _settings.Save();
        ReloadAll();
        MessageBox.Show("设置已保存。模型检测已切换到当前 ASR 路径。", "LocalSub");
    }

    async Task TestConnection()
    {
        try
        {
            SaveSettingsSilent();
            if (_catalog.Count == 0) throw new InvalidOperationException("模型 catalog 为空。");
            using var c = DownloadClientFactory.Create(_settings, TimeSpan.FromSeconds(15));
            using var req = new HttpRequestMessage(HttpMethod.Get, _catalog.First().Url);
            req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
            using var r = await c.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            r.EnsureSuccessStatusCode();
            var finalHost = r.RequestMessage?.RequestUri?.Host ?? "未知";
            MessageBox.Show($"模型下载链可用。\nHTTP {(int)r.StatusCode}\n最终主机：{finalHost}", "LocalSub");
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "连接测试失败");
        }
    }

    async Task DetectLocalSocks5()
    {
        if (_catalog.Count == 0)
        {
            MessageBox.Show("模型 catalog 为空。", "LocalSub");
            return;
        }

        var current = socksUrl.Text.Trim();
        var candidates = new[]
        {
            current,
            "socks5://127.0.0.1:7890",
            "socks5://127.0.0.1:7891",
            "socks5://127.0.0.1:10808",
            "socks5://127.0.0.1:1080"
        }.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

        foreach (var candidate in candidates)
        {
            try
            {
                var probe = new AppSettings { ProxyMode = ProxyMode.Socks5, Socks5Url = candidate };
                using var c = DownloadClientFactory.Create(probe, TimeSpan.FromSeconds(4));
                using var req = new HttpRequestMessage(HttpMethod.Get, _catalog.First().Url);
                req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
                using var r = await c.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                if (!r.IsSuccessStatusCode) continue;

                proxyMode.SelectedIndex = 2;
                socksUrl.Text = candidate;
                SaveSettingsSilent();
                MessageBox.Show($"已检测到可用 SOCKS5：\n{candidate}\n\n已自动切换并保存，模型下载将使用该代理。", "LocalSub");
                return;
            }
            catch { }
        }

        MessageBox.Show("未检测到可用的本机 SOCKS5。\n\n请确认 Clash / V2RayN 等代理程序已运行，然后在 SOCKS5 地址中填写它实际监听的端口。常见端口：7890、7891、10808、1080。", "LocalSub");
    }

    void SaveSettingsSilent()
    {
        _settings.AsrRoot = string.IsNullOrWhiteSpace(asrPath.Text) ? "ASR" : asrPath.Text.Trim();
        _settings.ProxyMode = proxyMode.SelectedIndex switch { 1 => ProxyMode.Direct, 2 => ProxyMode.Socks5, _ => ProxyMode.System };
        _settings.Socks5Url = socksUrl.Text.Trim();
        _settings.Keywords = keywords.Text;
        _settings.Save();
    }

    string[] ParseKeywords() => keywords.Text.Split([',', '，', ';', '；', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
