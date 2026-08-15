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
    readonly LiveAsrPipeline _liveAsr = new();
    readonly System.Windows.Forms.Timer _overlayFollowTimer = new() { Interval = 60 };
    SubtitleOverlayForm? _overlay;
    bool _liveRunning;
    string _lastFinalText = "";
    string _previousFinalText = "";

    readonly TabControl tabs = new() { Dock = DockStyle.Fill };
    readonly ComboBox sourceBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 220 };
    readonly ComboBox liveModelBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 360 };
    readonly Label liveStatus = new() { AutoSize = true, MaximumSize = new Size(760, 0), Text = "未启动" };
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
    readonly Label modelStatusDetail = new() { Dock = DockStyle.Fill, Text = "选择模型后点击“下载/修复”。", TextAlign = ContentAlignment.MiddleLeft, AutoEllipsis = true };
    readonly TextBox modelLog = new() { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = SystemColors.Window };
    readonly Button modelDownloadButton = new() { Text = "下载/修复", Width = 110 };
    readonly Button modelCancelButton = new() { Text = "取消", Width = 80, Enabled = false };
    readonly Button modelDeleteButton = new() { Text = "删除", Width = 90 };
    readonly Button modelOpenButton = new() { Text = "打开 ASR 目录", Width = 130 };
    readonly Button modelScanButton = new() { Text = "重新扫描", Width = 100 };
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
        FormClosed += async (_, _) =>
        {
            _overlayFollowTimer.Stop();
            _modelDownloadCts?.Cancel();
            _modelDownloadCts?.Dispose();
            await _liveAsr.DisposeAsync();
            _overlay?.Close();
        };

        _overlayFollowTimer.Tick += (_, _) => FollowOverlayToPotPlayer();
        _liveAsr.LevelChanged += v => SafeUi(() => audioLevel.Value = (int)(Math.Clamp(v, 0, 1) * 1000));
        _liveAsr.StatusChanged += text => SafeUi(() => liveStatus.Text = text);
        _liveAsr.PartialResult += text => SafeUi(async () => await ShowRecognitionAsync(text, false));
        _liveAsr.FinalResult += text => SafeUi(async () => await ShowRecognitionAsync(text, true));
    }

    void SafeUi(Action action)
    {
        try
        {
            if (IsDisposed || !IsHandleCreated) return;
            BeginInvoke(action);
        }
        catch (InvalidOperationException) { }
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
        p.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(760, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(3, 18, 3, 3),
            Text = "Streaming Paraformer 为真流式；SenseVoice Small INT8 为 VAD 停顿后出句的模拟流式。字幕最多保留两行，3 秒无新结果自动清空。首次启动会把 sherpa native runtime 下载到 ASR\\_runtime。"
        });
        liveStart.Click += LiveStart_Click;
        t.Controls.Add(p);
        tabs.TabPages.Add(t);
    }

    async void LiveStart_Click(object? sender, EventArgs e)
    {
        if (_liveRunning)
        {
            await StopLiveAsync();
            return;
        }

        liveStart.Enabled = false;
        try
        {
            ApplySettingsFromUi();
            _settings.Save();
            _models = new ModelManager(_settings);

            if (liveModelBox.SelectedItem is not ModelDescriptor model)
                throw new InvalidOperationException("没有可用的实时模型。请先在“模型”页面安装 Streaming Paraformer 或 SenseVoice Small INT8。");
            if (!_models.IsInstalled(model))
            {
                liveStatus.Text = $"实时模型“{model.Name}”未安装。请到“模型”页面下载后再开始。";
                tabs.SelectedIndex = 2;
                SelectModelRow(model.Id);
                return;
            }

            _lastFinalText = "";
            _previousFinalText = "";
            EnsureOverlay();
            FollowOverlayToPotPlayer();
            _overlay!.Show();
            await _overlay.SetTextAsync("正在启动实时识别…", "", ParseKeywords());

            var runtimeProgress = new Progress<ModelOperationProgress>(p =>
            {
                var detail = p.Percent.HasValue ? $"{p.Stage} {p.Percent}%" : p.Stage;
                if (!string.IsNullOrWhiteSpace(p.Detail)) detail += "  " + p.Detail;
                liveStatus.Text = detail;
            });

            if (sourceBox.SelectedIndex == 0)
            {
                var potPlayer = PotPlayerWatcher.FindRunning();
                if (potPlayer == null) throw new InvalidOperationException("未检测到正在运行的 PotPlayer。");
                await _liveAsr.StartPotPlayerAsync(_settings, model, _models, (uint)potPlayer.Id, runtimeProgress);
            }
            else
            {
                await _liveAsr.StartAllAudioAsync(_settings, model, _models, runtimeProgress);
            }

            _liveRunning = true;
            liveStart.Text = "停止";
            sourceBox.Enabled = false;
            liveModelBox.Enabled = false;
            _overlayFollowTimer.Start();
            FollowOverlayToPotPlayer();
        }
        catch (Exception ex)
        {
            await _liveAsr.StopAsync();
            _liveRunning = false;
            _overlayFollowTimer.Stop();
            _overlay?.Hide();
            liveStatus.Text = "启动失败：" + ex.Message;
        }
        finally
        {
            liveStart.Enabled = true;
        }
    }

    async Task StopLiveAsync()
    {
        liveStart.Enabled = false;
        try
        {
            _overlayFollowTimer.Stop();
            await _liveAsr.StopAsync();
            _liveRunning = false;
            liveStart.Text = "开始";
            sourceBox.Enabled = true;
            liveModelBox.Enabled = true;
            liveStatus.Text = "已停止";
            audioLevel.Value = 0;
            _overlay?.Hide();
        }
        finally
        {
            liveStart.Enabled = true;
        }
    }

    async Task ShowRecognitionAsync(string text, bool isFinal)
    {
        if (!_liveRunning || string.IsNullOrWhiteSpace(text)) return;
        if (isFinal)
        {
            if (!string.Equals(text, _lastFinalText, StringComparison.Ordinal))
            {
                _previousFinalText = _lastFinalText;
                _lastFinalText = text;
            }
        }

        EnsureOverlay();
        if (!_overlay!.Visible) _overlay.Show();
        await _overlay.SetTextAsync(text, isFinal ? _previousFinalText : _lastFinalText, ParseKeywords());
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

    void FollowOverlayToPotPlayer()
    {
        if (_overlay == null || _overlay.IsDisposed) return;
        var process = PotPlayerWatcher.FindRunning();
        if (process != null && PotPlayerWatcher.TryGetWindowState(process, out var bounds, out var minimized))
        {
            if (minimized)
            {
                _overlay.Hide();
                return;
            }
            _overlay.FollowPlayer(bounds);
            if (_liveRunning && !_overlay.Visible) _overlay.Show();
            return;
        }

        if (_liveRunning && sourceBox.SelectedIndex == 0)
            _overlay.Hide();
    }

    void BuildBatchTab()
    {
        var t = new TabPage("后台转写") { AllowDrop = true };
        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 390 };
        split.Panel1.Controls.Add(batchFiles);
        split.Panel1.Controls.Add(new Label { Dock = DockStyle.Top, Height = 62, Text = "把视频拖到这里。当前已建立队列、关键词与导出数据骨架；高速媒体解码与离线 ASR 流水线随后接入。", Padding = new Padding(12) });
        var bottom = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(12), FlowDirection = FlowDirection.TopDown, AutoScroll = true };
        bottom.Controls.Add(new Label { Text = "关键词（逗号、分号或换行分隔）", AutoSize = true });
        bottom.Controls.Add(keywords);
        var export = new Button { Text = "导出 TXT", Width = 120 };
        export.Click += (_, _) => ExportTxt();
        bottom.Controls.Add(export);
        split.Panel2.Controls.Add(bottom);
        t.Controls.Add(split);
        t.DragEnter += (_, e) => { if (e.Data?.GetDataPresent(DataFormats.FileDrop) == true) e.Effect = DragDropEffects.Copy; };
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

        var status = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(10, 6, 10, 6), ColumnCount = 1, RowCount = 4 };
        status.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        status.RowStyles.Add(new RowStyle(SizeType.Absolute, 26));
        status.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        status.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        status.Controls.Add(modelStatusTitle, 0, 0);
        status.Controls.Add(modelStatusDetail, 0, 1);
        status.Controls.Add(downloadProgress, 0, 2);
        status.Controls.Add(modelLog, 0, 3);

        var bar = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(8), WrapContents = false };
        bar.Controls.AddRange([modelDownloadButton, modelCancelButton, modelDeleteButton, modelOpenButton, modelScanButton]);

        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3 };
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 62));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
        layout.Controls.Add(modelGrid, 0, 0);
        layout.Controls.Add(status, 0, 1);
        layout.Controls.Add(bar, 0, 2);

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
            modelStatusDetail.Text = _models?.IsInstalled(m) == true ? "状态：已安装" : "状态：未安装，点击“下载/修复”开始。";
        };

        t.Controls.Add(layout);
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

        if (!string.IsNullOrWhiteSpace(selectedId)) SelectModelRow(selectedId);
        FillLiveModels();
    }

    void SelectModelRow(string modelId)
    {
        foreach (DataGridViewRow row in modelGrid.Rows)
        {
            if (GetBoundModel(row)?.Id == modelId)
            {
                row.Selected = true;
                if (row.Cells.Count > 0) modelGrid.CurrentCell = row.Cells[0];
                break;
            }
        }
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
        modelStatusDetail.Text = "正在启动模型任务";
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
            AppendModelLog("完成，模型已通过关键文件校验。", true);
        }
        catch (OperationCanceledException)
        {
            modelStatusTitle.Text = $"{m.Name} · 已取消";
            modelStatusDetail.Text = "任务已取消，未完成下载保留 .part 文件，下次可续传。";
            downloadProgress.Style = ProgressBarStyle.Continuous;
            AppendModelLog("任务已取消。", true);
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

        if (p.IsIndeterminate || !p.Percent.HasValue)
        {
            downloadProgress.Style = ProgressBarStyle.Marquee;
        }
        else
        {
            downloadProgress.Style = ProgressBarStyle.Continuous;
            downloadProgress.Value = Math.Clamp(p.Percent.Value, 0, 100);
        }

        var parts = new List<string>();
        if (p.BytesDone > 0) parts.Add(FormatBytes(p.BytesDone));
        if (p.TotalBytes > 0) parts.Add("/ " + FormatBytes(p.TotalBytes.Value));
        if (p.Percent.HasValue) parts.Add(p.Percent.Value + "%");
        if (p.BytesPerSecond > 0) parts.Add(FormatBytes((long)p.BytesPerSecond) + "/s");
        if (!string.IsNullOrWhiteSpace(p.Detail)) parts.Add(p.Detail!);
        modelStatusDetail.Text = parts.Count > 0 ? string.Join("   ", parts) : p.Stage;

        SetModelRowStatus(_activeModel.Id, p.Percent.HasValue && p.Stage == "下载" ? $"下载 {p.Percent}%" : p.Stage);

        var bucket = p.Percent.HasValue ? p.Percent.Value / 10 : -1;
        if (!string.Equals(_lastLoggedStage, p.Stage, StringComparison.Ordinal) || bucket != _lastLoggedBucket || p.Stage is "完成" or "重试")
        {
            AppendModelLog(modelStatusDetail.Text, true);
            _lastLoggedStage = p.Stage;
            _lastLoggedBucket = bucket;
        }
    }

    void SetModelBusy(bool busy)
    {
        modelDownloadButton.Enabled = !busy;
        modelCancelButton.Enabled = busy;
        modelDeleteButton.Enabled = !busy;
        modelScanButton.Enabled = !busy;
        modelGrid.Enabled = !busy;
    }

    void SetModelRowStatus(string modelId, string status)
    {
        foreach (DataGridViewRow row in modelGrid.Rows)
        {
            if (GetBoundModel(row)?.Id == modelId && row.Cells.Count >= 4)
            {
                row.Cells[3].Value = status;
                break;
            }
        }
    }

    void AppendModelLog(string text, bool withTime)
    {
        var line = withTime ? $"[{DateTime.Now:HH:mm:ss}] {text}" : text;
        if (modelLog.TextLength > 0) modelLog.AppendText(Environment.NewLine);
        modelLog.AppendText(line);
        modelLog.SelectionStart = modelLog.TextLength;
        modelLog.ScrollToCaret();
    }

    static string FormatBytes(long value)
    {
        string[] units = ["B", "KB", "MB", "GB"];
        double v = Math.Max(0, value);
        var i = 0;
        while (v >= 1024 && i < units.Length - 1) { v /= 1024; i++; }
        return i == 0 ? $"{v:0} {units[i]}" : $"{v:0.0} {units[i]}";
    }

    void DeleteSelected()
    {
        var m = SelectedModel();
        if (m == null || _models == null || _modelDownloadCts != null) return;
        if (MessageBox.Show($"删除 {m.Name}？\n\n将同时清理该模型的缓存和未完成下载。", "LocalSub", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
        _models.Delete(m);
        AppendModelLog($"已删除 {m.Name} 及其缓存。", true);
        RefreshModels();
    }

    void FillLiveModels()
    {
        var list = _catalog
            .Where(x => x.LiveCapable && !string.Equals(x.Id, "silero-vad", StringComparison.OrdinalIgnoreCase))
            .ToList();
        liveModelBox.DataSource = list;
        liveModelBox.DisplayMember = "Name";
        liveModelBox.ValueMember = "Id";
        var idx = list.FindIndex(x => x.Id == _settings.LiveModelId);
        if (idx >= 0) liveModelBox.SelectedIndex = idx;
        else if (list.Count > 0) liveModelBox.SelectedIndex = 0;
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
        try
        {
            ApplySettingsFromUi();
            _settings.Save();
            ReloadAll();
            MessageBox.Show("设置已保存。模型检测已切换到当前 ASR 路径。", "LocalSub");
        }
        catch (Exception ex)
        {
            MessageBox.Show("设置保存失败：\n" + ex.Message, "LocalSub");
        }
    }

    void ApplySettingsFromUi()
    {
        _settings.AsrRoot = string.IsNullOrWhiteSpace(asrPath.Text) ? "ASR" : asrPath.Text.Trim();
        _settings.ProxyMode = proxyMode.SelectedIndex switch { 1 => ProxyMode.Direct, 2 => ProxyMode.Socks5, _ => ProxyMode.System };
        _settings.Socks5Url = socksUrl.Text.Trim();
        _settings.AudioSource = sourceBox.SelectedIndex == 1 ? AudioSourceMode.AllAudio : AudioSourceMode.PotPlayer;
        if (liveModelBox.SelectedItem is ModelDescriptor m) _settings.LiveModelId = m.Id;
        _settings.Keywords = keywords.Text;
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

        MessageBox.Show("未检测到可用的本机 SOCKS5。\n\n请确认 Clash / V2RayN 等代理程序已运行，然后填写它实际监听的 SOCKS5 端口。常见端口：7890、7891、10808、1080。", "LocalSub");
    }

    void SaveSettingsSilent()
    {
        ApplySettingsFromUi();
        _settings.Save();
    }

    string[] ParseKeywords() => keywords.Text.Split([',', '，', ';', '；', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
