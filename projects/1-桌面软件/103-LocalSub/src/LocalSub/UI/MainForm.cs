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
    readonly MediaAnalysisService _mediaAnalysis = new();
    readonly System.Windows.Forms.Timer _overlayFollowTimer = new() { Interval = 60 };
    SubtitleOverlayForm? _overlay;
    bool _liveRunning;
    string _lastFinalText = "";
    string _previousFinalText = "";

    readonly TabControl tabs = new() { Dock = DockStyle.Fill };
    readonly ComboBox sourceBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 220 };
    readonly ComboBox liveModelBox = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 390 };
    readonly Label liveStatus = new() { AutoSize = true, MaximumSize = new Size(800, 0), Text = "未启动" };
    readonly ProgressBar audioLevel = new() { Width = 390, Maximum = 1000 };
    readonly Button liveStart = new() { Text = "开始", Width = 100 };

    readonly DataGridView modelGrid = new()
    {
        Dock = DockStyle.Fill,
        ReadOnly = true,
        AutoGenerateColumns = false,
        SelectionMode = DataGridViewSelectionMode.FullRowSelect,
        MultiSelect = false,
        AllowUserToAddRows = false,
        AllowUserToDeleteRows = false,
        RowHeadersVisible = false
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
    readonly TextBox keywords = new() { Multiline = true, Width = 520, Height = 72 };

    readonly CheckBox subtitleAutoSize = new() { Text = "自动字号（随播放器高度）", AutoSize = true };
    readonly NumericUpDown subtitleFontSize = new() { Minimum = 20, Maximum = 52, Value = 28, Width = 80 };
    readonly NumericUpDown subtitleBottomOffset = new() { Minimum = 0, Maximum = 160, Value = 24, Width = 80 };
    readonly NumericUpDown subtitleMaxWidth = new() { Minimum = 50, Maximum = 100, Value = 90, Width = 80 };
    readonly ComboBox subtitleBackground = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 140 };
    readonly NumericUpDown subtitleBackgroundOpacity = new() { Minimum = 0, Maximum = 70, Value = 24, Width = 80 };
    readonly NumericUpDown subtitleDuration = new() { Minimum = 1, Maximum = 10, DecimalPlaces = 1, Increment = 0.5M, Value = 3, Width = 80 };

    readonly ListBox batchFiles = new() { Dock = DockStyle.Fill };
    readonly Label batchMediaTitle = new() { Dock = DockStyle.Fill, Text = "尚未选择媒体", Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold) };
    readonly Label batchMediaInfo = new() { Dock = DockStyle.Fill, Text = "拖入视频后自动解析音轨并生成声音波形。", ForeColor = Color.DimGray };
    readonly Label batchStatus = new() { Dock = DockStyle.Fill, Text = "等待媒体文件", AutoEllipsis = true };
    readonly ProgressBar batchProgress = new() { Dock = DockStyle.Fill, Maximum = 100 };
    readonly WaveformView batchWaveform = new() { Dock = DockStyle.Fill };
    CancellationTokenSource? _batchAnalyzeCts;

    public MainForm()
    {
        Text = "LocalSub 0.1.0 dev";
        Width = 1120;
        Height = 760;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(920, 650);
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
            _batchAnalyzeCts?.Cancel();
            _batchAnalyzeCts?.Dispose();
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

        RefreshModels();
        asrPath.Text = _settings.AsrRoot;

        proxyMode.Items.Clear();
        proxyMode.Items.AddRange(["系统代理", "直连", "SOCKS5"]);
        proxyMode.SelectedIndex = _settings.ProxyMode switch { ProxyMode.Direct => 1, ProxyMode.Socks5 => 2, _ => 0 };
        socksUrl.Text = _settings.Socks5Url;
        keywords.Text = _settings.Keywords;

        subtitleBackground.Items.Clear();
        subtitleBackground.Items.AddRange(["无底纹", "轻底纹", "深底纹"]);
        subtitleAutoSize.Checked = _settings.SubtitleAutoSize;
        subtitleFontSize.Value = Math.Clamp(_settings.SubtitleFontSize, 20, 52);
        subtitleBottomOffset.Value = Math.Clamp(_settings.SubtitleBottomOffset, 0, 160);
        subtitleMaxWidth.Value = Math.Clamp(_settings.SubtitleMaxWidthPercent, 50, 100);
        subtitleBackground.SelectedIndex = _settings.SubtitleBackground switch
        {
            SubtitleBackgroundMode.Light => 1,
            SubtitleBackgroundMode.Dark => 2,
            _ => 0
        };
        subtitleBackgroundOpacity.Value = Math.Clamp(_settings.SubtitleBackgroundOpacity, 0, 70);
        subtitleDuration.Value = (decimal)Math.Clamp(_settings.SubtitleDisplaySeconds, 1.0, 10.0);
        subtitleFontSize.Enabled = !subtitleAutoSize.Checked;
        _overlay?.ApplySettings(_settings);
    }

    void BuildLiveTab()
    {
        var t = new TabPage("实时字幕");
        var p = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(24), AutoScroll = true, WrapContents = false };
        p.Controls.Add(new Label { Text = "音源", AutoSize = true });
        p.Controls.Add(sourceBox);
        p.Controls.Add(new Label { Text = "实时模型（仅显示已安装）", AutoSize = true, Margin = new Padding(3, 16, 3, 3) });
        p.Controls.Add(liveModelBox);
        p.Controls.Add(new Label { Text = "输入电平", AutoSize = true, Margin = new Padding(3, 16, 3, 3) });
        p.Controls.Add(audioLevel);
        p.Controls.Add(liveStart);
        p.Controls.Add(liveStatus);
        p.Controls.Add(new Label
        {
            AutoSize = true,
            MaximumSize = new Size(820, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(3, 18, 3, 3),
            Text = "下拉框只列出关键文件校验通过的已安装实时模型。中文推荐 Zipformer Large/CTC Large；Paraformer 为低延迟中英档。"
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
            {
                liveStatus.Text = "没有已安装的实时模型，请先到“模型”页面下载。";
                tabs.SelectedIndex = 2;
                return;
            }

            if (!_models.IsInstalled(model))
            {
                RefreshModels();
                liveStatus.Text = $"实时模型“{model.Name}”已不可用，请在“模型”页面检查或重新下载。";
                tabs.SelectedIndex = 2;
                SelectModelRow(model.Id);
                return;
            }

            _lastFinalText = "";
            _previousFinalText = "";
            EnsureOverlay();
            _overlay!.ApplySettings(_settings);
            FollowOverlayToPotPlayer();
            _overlay.Show();
            await _overlay.SetTextAsync("正在启动实时识别…", "", ParseKeywords());

            var runtimeProgress = new Progress<ModelOperationProgress>(p =>
            {
                var detail = p.Percent.HasValue ? $"{p.Stage} {p.Percent}%" : p.Stage;
                if (!string.IsNullOrWhiteSpace(p.Detail)) detail += "  " + p.Detail;
                liveStatus.Text = detail;
            });

            if (sourceBox.SelectedIndex == 0)
            {
                using var potPlayer = PotPlayerWatcher.FindRunning();
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
            liveStart.Enabled = _liveRunning || liveModelBox.Items.Count > 0;
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
            liveStatus.Text = liveModelBox.Items.Count > 0 ? "已停止" : "没有已安装的实时模型，请先到“模型”页面下载。";
            audioLevel.Value = 0;
            _overlay?.Hide();
        }
        finally
        {
            liveStart.Enabled = liveModelBox.Items.Count > 0;
        }
    }

    async Task ShowRecognitionAsync(string text, bool isFinal)
    {
        if (!_liveRunning || string.IsNullOrWhiteSpace(text)) return;
        if (isFinal && !string.Equals(text, _lastFinalText, StringComparison.Ordinal))
        {
            _previousFinalText = _lastFinalText;
            _lastFinalText = text;
        }

        EnsureOverlay();
        _overlay!.ApplySettings(_settings);
        if (!_overlay.Visible) _overlay.Show();
        await _overlay.SetTextAsync(text, isFinal ? _previousFinalText : _lastFinalText, ParseKeywords());
    }

    void EnsureOverlay()
    {
        if (_overlay != null && !_overlay.IsDisposed) return;
        _overlay = new SubtitleOverlayForm();
        _overlay.ApplySettings(_settings);
        var area = Screen.PrimaryScreen!.WorkingArea;
        _overlay.Location = new Point(area.Left + (area.Width - _overlay.Width) / 2, area.Bottom - _overlay.Height - 40);
    }

    void FollowOverlayToPotPlayer()
    {
        if (_overlay == null || _overlay.IsDisposed) return;
        _overlay.ApplySettings(_settings);
        using var process = PotPlayerWatcher.FindRunning();
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

        if (_liveRunning && sourceBox.SelectedIndex == 0) _overlay.Hide();
    }

    void BuildBatchTab()
    {
        var t = new TabPage("后台转写") { AllowDrop = true };
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(10), ColumnCount = 1, RowCount = 6 };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 125));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 28));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 120));

        var queuePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        queuePanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        queuePanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        queuePanel.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "把视频拖到这里。选中后立即解析音轨并生成声音波形。", Padding = new Padding(4, 8, 4, 4) }, 0, 0);
        queuePanel.Controls.Add(batchFiles, 0, 1);

        var info = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        info.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        info.RowStyles.Add(new RowStyle(SizeType.Absolute, 24));
        info.Controls.Add(batchMediaTitle, 0, 0);
        info.Controls.Add(batchMediaInfo, 0, 1);

        var bottom = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(0, 4, 0, 0), FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
        bottom.Controls.Add(new Label { Text = "关键词", AutoSize = true, Margin = new Padding(0, 8, 8, 0) });
        keywords.Width = 500;
        keywords.Height = 72;
        bottom.Controls.Add(keywords);
        var export = new Button { Text = "导出 TXT", Width = 110, Height = 30, Margin = new Padding(10, 4, 0, 0) };
        export.Click += (_, _) => ExportTxt();
        bottom.Controls.Add(export);

        layout.Controls.Add(queuePanel, 0, 0);
        layout.Controls.Add(info, 0, 1);
        layout.Controls.Add(batchWaveform, 0, 2);
        layout.Controls.Add(batchStatus, 0, 3);
        layout.Controls.Add(batchProgress, 0, 4);
        layout.Controls.Add(bottom, 0, 5);
        t.Controls.Add(layout);

        batchFiles.SelectedIndexChanged += async (_, _) =>
        {
            if (batchFiles.SelectedItem is string path && File.Exists(path)) await AnalyzeBatchFileAsync(path);
        };
        t.DragEnter += (_, e) => { if (e.Data?.GetDataPresent(DataFormats.FileDrop) == true) e.Effect = DragDropEffects.Copy; };
        t.DragDrop += (_, e) =>
        {
            if (e.Data?.GetData(DataFormats.FileDrop) is not string[] fs) return;
            string? first = null;
            foreach (var f in fs.Where(File.Exists))
            {
                if (!batchFiles.Items.Contains(f)) batchFiles.Items.Add(f);
                first ??= f;
            }
            if (first != null) batchFiles.SelectedItem = first;
        };
        tabs.TabPages.Add(t);
    }

    async Task AnalyzeBatchFileAsync(string path)
    {
        _batchAnalyzeCts?.Cancel();
        _batchAnalyzeCts?.Dispose();
        _batchAnalyzeCts = new CancellationTokenSource();
        var ct = _batchAnalyzeCts.Token;
        batchMediaTitle.Text = Path.GetFileName(path);
        batchMediaInfo.Text = "正在读取媒体音轨…";
        batchStatus.Text = "打开媒体";
        batchProgress.Value = 0;
        batchWaveform.ClearWaveform();

        try
        {
            var progress = new Progress<MediaAnalysisProgress>(p =>
            {
                if (ct.IsCancellationRequested) return;
                batchProgress.Value = Math.Clamp(p.Percent, 0, 100);
                batchStatus.Text = $"{p.Stage}  {p.Detail}";
            });
            var result = await _mediaAnalysis.AnalyzeAsync(path, progress, ct);
            if (ct.IsCancellationRequested) return;
            batchWaveform.SetWaveform(result.Waveform, result.Duration);
            batchMediaInfo.Text = $"时长 {FormatDuration(result.Duration)}   音频 {result.SampleRate} Hz / {result.Channels} 声道   波形 {result.Waveform.Length} 点";
            batchStatus.Text = "声音轨道已生成。下一步将在此时间轴接入 VAD、离线 ASR 和关键词标记。";
            batchProgress.Value = 100;
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            if (ct.IsCancellationRequested) return;
            batchMediaInfo.Text = "解析失败";
            batchStatus.Text = ex.Message;
            batchProgress.Value = 0;
        }
    }

    static string FormatDuration(TimeSpan t) => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");

    void ExportTxt()
    {
        using var dlg = new SaveFileDialog { Filter = "Text|*.txt", FileName = "transcript.txt" };
        if (dlg.ShowDialog() == DialogResult.OK) _transcript.ExportTxt(dlg.FileName, true);
    }

    void BuildModelsTab()
    {
        var t = new TabPage("模型");
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "ModelName", HeaderText = "模型", DataPropertyName = "Name", Width = 235 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Languages", HeaderText = "语言", DataPropertyName = "Languages", Width = 70 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Purpose", HeaderText = "用途", DataPropertyName = "Purpose", AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Size", HeaderText = "体积", DataPropertyName = "Size", Width = 82 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Realtime", HeaderText = "实时性", DataPropertyName = "Realtime", Width = 62 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Accuracy", HeaderText = "准确率", DataPropertyName = "Accuracy", Width = 62 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Value", HeaderText = "性价比", DataPropertyName = "Value", Width = 66 });
        modelGrid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Status", HeaderText = "状态", DataPropertyName = "Status", Width = 85 });
        modelGrid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(224, 238, 252);
        modelGrid.DefaultCellStyle.SelectionForeColor = Color.Black;

        modelStatusTitle.Font = new Font(modelStatusTitle.Font, FontStyle.Bold);
        modelLog.Text = "黑色 = 已安装且关键文件校验通过；灰色 = 未安装。评分为 LocalSub 面向本地 CPU 字幕场景的相对工程评分。";

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
        modelScanButton.Click += (_, _) => { AppendModelLog("重新扫描 ASR 模型目录。", true); RefreshModels(); };
        modelGrid.SelectionChanged += (_, _) =>
        {
            if (_modelDownloadCts != null) return;
            var m = SelectedModel();
            if (m == null) return;
            var installed = _models?.IsInstalled(m) == true;
            modelStatusTitle.Text = m.Name;
            modelStatusDetail.Text = $"{(installed ? "已安装" : "未安装")}   {m.Purpose}   实时 {ScoreText(m.RealtimeScore)} / 准确 {ScoreText(m.AccuracyScore)} / 性价比 {ScoreText(m.ValueScore)}";
        };

        t.Controls.Add(layout);
        tabs.TabPages.Add(t);
    }

    void RefreshModels()
    {
        if (_models == null) return;
        var selectedId = SelectedModel()?.Id;
        modelGrid.DataSource = _catalog.Select(m =>
        {
            var installed = _models.IsInstalled(m);
            return new
            {
                Model = m,
                Installed = installed,
                m.Name,
                m.Languages,
                m.Purpose,
                Size = m.SizeText,
                Realtime = ScoreText(m.RealtimeScore),
                Accuracy = ScoreText(m.AccuracyScore),
                Value = ScoreText(m.ValueScore),
                Status = installed ? "已安装" : "未安装"
            };
        }).ToList();

        ApplyModelRowStyles();
        if (!string.IsNullOrWhiteSpace(selectedId)) SelectModelRow(selectedId);
        FillLiveModels();
    }

    void ApplyModelRowStyles()
    {
        if (_models == null) return;
        foreach (DataGridViewRow row in modelGrid.Rows)
        {
            var model = GetBoundModel(row);
            var installed = model != null && _models.IsInstalled(model);
            row.DefaultCellStyle.ForeColor = installed ? Color.Black : SystemColors.GrayText;
            row.DefaultCellStyle.SelectionForeColor = installed ? Color.Black : Color.DimGray;
        }
    }

    static string ScoreText(int value) => value > 0 ? $"{value}/10" : "—";

    void SelectModelRow(string modelId)
    {
        foreach (DataGridViewRow row in modelGrid.Rows)
        {
            if (GetBoundModel(row)?.Id != modelId) continue;
            row.Selected = true;
            if (row.Cells.Count > 0) modelGrid.CurrentCell = row.Cells[0];
            break;
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
            modelStatusDetail.Text = $"模型已安装到：{_models.GetModelFolder(m)}。已自动加入实时模型下拉框（若该模型支持实时识别）。";
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
        if (p.IsIndeterminate || !p.Percent.HasValue) downloadProgress.Style = ProgressBarStyle.Marquee;
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
            if (GetBoundModel(row)?.Id == modelId && modelGrid.Columns.Contains("Status"))
            {
                row.Cells["Status"].Value = status;
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
        var selectedBefore = (liveModelBox.SelectedItem as ModelDescriptor)?.Id;
        var list = _catalog
            .Where(x => x.LiveCapable &&
                        !string.Equals(x.Id, "silero-vad", StringComparison.OrdinalIgnoreCase) &&
                        _models?.IsInstalled(x) == true)
            .ToList();

        liveModelBox.DataSource = null;
        liveModelBox.DisplayMember = "Name";
        liveModelBox.ValueMember = "Id";
        liveModelBox.DataSource = list;

        var desiredId = !string.IsNullOrWhiteSpace(selectedBefore) && list.Any(x => x.Id == selectedBefore)
            ? selectedBefore
            : _settings.LiveModelId;
        var idx = list.FindIndex(x => x.Id == desiredId);
        if (idx >= 0) liveModelBox.SelectedIndex = idx;
        else if (list.Count > 0) liveModelBox.SelectedIndex = 0;
        else liveModelBox.SelectedIndex = -1;

        if (!_liveRunning)
        {
            liveStart.Enabled = list.Count > 0;
            if (list.Count == 0)
                liveStatus.Text = "没有已安装的实时模型，请先到“模型”页面下载。";
            else if (liveStatus.Text.StartsWith("没有已安装的实时模型", StringComparison.Ordinal))
                liveStatus.Text = "未启动";
        }
    }

    void BuildSettingsTab()
    {
        var t = new TabPage("设置");
        var p = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), FlowDirection = FlowDirection.TopDown, AutoScroll = true, WrapContents = false };

        p.Controls.Add(new Label { Text = "ASR 模型根目录（默认 EXE 同级 ASR）", AutoSize = true });
        var pathRow = new FlowLayoutPanel { Width = 800, Height = 42, WrapContents = false };
        pathRow.Controls.Add(asrPath);
        var browse = new Button { Text = "浏览", Width = 80 };
        pathRow.Controls.Add(browse);
        p.Controls.Add(pathRow);

        p.Controls.Add(new Label { Text = "下载代理", AutoSize = true, Margin = new Padding(3, 14, 3, 3) });
        p.Controls.Add(proxyMode);
        p.Controls.Add(new Label { Text = "SOCKS5 地址", AutoSize = true });
        p.Controls.Add(socksUrl);
        p.Controls.Add(new Label { Text = "可直接接入 Clash / V2RayN 等本机 SOCKS5，例如 socks5://127.0.0.1:7891。", AutoSize = true, ForeColor = Color.DimGray });
        var proxyButtons = new FlowLayoutPanel { Width = 650, Height = 42, WrapContents = false };
        var detect = new Button { Text = "自动检测本机 SOCKS5", Width = 170 };
        var test = new Button { Text = "测试模型下载链", Width = 150 };
        proxyButtons.Controls.AddRange([detect, test]);
        p.Controls.Add(proxyButtons);

        p.Controls.Add(new Label { Text = "字幕样式", Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold), AutoSize = true, Margin = new Padding(3, 16, 3, 6) });
        p.Controls.Add(subtitleAutoSize);
        p.Controls.Add(SettingsRow("固定字号", subtitleFontSize, "px（关闭自动字号时使用）"));
        p.Controls.Add(SettingsRow("底部偏移", subtitleBottomOffset, "px"));
        p.Controls.Add(SettingsRow("最大宽度", subtitleMaxWidth, "% 播放器宽度"));
        p.Controls.Add(SettingsRow("底纹", subtitleBackground, ""));
        p.Controls.Add(SettingsRow("底纹透明度", subtitleBackgroundOpacity, "%"));
        p.Controls.Add(SettingsRow("无新字幕后消失", subtitleDuration, "秒"));
        p.Controls.Add(new Label { Text = "默认采用无整块底纹、白字细黑描边。自动字号会随 PotPlayer 窗口/全屏高度变化。", AutoSize = true, ForeColor = Color.DimGray });

        var actionButtons = new FlowLayoutPanel { Width = 520, Height = 44, WrapContents = false };
        var preview = new Button { Text = "预览字幕", Width = 110 };
        var save = new Button { Text = "保存设置", Width = 110 };
        actionButtons.Controls.AddRange([preview, save]);
        p.Controls.Add(actionButtons);

        browse.Click += (_, _) =>
        {
            using var f = new FolderBrowserDialog { SelectedPath = _settings.ResolvedAsrRoot };
            if (f.ShowDialog() == DialogResult.OK) asrPath.Text = f.SelectedPath;
        };
        save.Click += (_, _) => SaveSettings();
        test.Click += async (_, _) => await TestConnection();
        detect.Click += async (_, _) => await DetectLocalSocks5();
        preview.Click += async (_, _) => await PreviewSubtitleAsync();
        subtitleAutoSize.CheckedChanged += (_, _) => subtitleFontSize.Enabled = !subtitleAutoSize.Checked;
        t.Controls.Add(p);
        tabs.TabPages.Add(t);
    }

    static FlowLayoutPanel SettingsRow(string label, Control control, string suffix)
    {
        var row = new FlowLayoutPanel { Width = 620, Height = 34, WrapContents = false };
        row.Controls.Add(new Label { Text = label, Width = 130, TextAlign = ContentAlignment.MiddleLeft, Margin = new Padding(0, 7, 6, 0) });
        row.Controls.Add(control);
        if (!string.IsNullOrWhiteSpace(suffix)) row.Controls.Add(new Label { Text = suffix, AutoSize = true, Margin = new Padding(6, 7, 0, 0) });
        return row;
    }

    async Task PreviewSubtitleAsync()
    {
        ApplySettingsFromUi();
        EnsureOverlay();
        _overlay!.ApplySettings(_settings);
        using var process = PotPlayerWatcher.FindRunning();
        if (process != null && PotPlayerWatcher.TryGetWindowState(process, out var bounds, out var minimized) && !minimized)
            _overlay.FollowPlayer(bounds);
        else
        {
            var area = Screen.PrimaryScreen!.WorkingArea;
            var width = Math.Min(900, area.Width - 40);
            _overlay.Bounds = new Rectangle(area.Left + (area.Width - width) / 2, area.Bottom - 150, width, 120);
        }
        _overlay.Show();
        await _overlay.PreviewAsync();
    }

    void SaveSettings()
    {
        try
        {
            ApplySettingsFromUi();
            _settings.Save();
            _overlay?.ApplySettings(_settings);
            ReloadAll();
            MessageBox.Show("设置已保存。", "LocalSub");
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
        _settings.SubtitleAutoSize = subtitleAutoSize.Checked;
        _settings.SubtitleFontSize = (int)subtitleFontSize.Value;
        _settings.SubtitleBottomOffset = (int)subtitleBottomOffset.Value;
        _settings.SubtitleMaxWidthPercent = (int)subtitleMaxWidth.Value;
        _settings.SubtitleBackground = subtitleBackground.SelectedIndex switch
        {
            1 => SubtitleBackgroundMode.Light,
            2 => SubtitleBackgroundMode.Dark,
            _ => SubtitleBackgroundMode.None
        };
        _settings.SubtitleBackgroundOpacity = (int)subtitleBackgroundOpacity.Value;
        _settings.SubtitleDisplaySeconds = (double)subtitleDuration.Value;
    }

    async Task TestConnection()
    {
        try
        {
            SaveSettingsSilent();
            var probeModel = _catalog.FirstOrDefault(m => !string.IsNullOrWhiteSpace(m.Url))
                ?? throw new InvalidOperationException("模型 catalog 没有可测试的下载地址。");
            using var c = DownloadClientFactory.Create(_settings, TimeSpan.FromSeconds(15));
            using var req = new HttpRequestMessage(HttpMethod.Get, probeModel.Url);
            req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
            using var r = await c.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            r.EnsureSuccessStatusCode();
            var finalHost = r.RequestMessage?.RequestUri?.Host ?? "未知";
            MessageBox.Show($"模型下载链可用。\nHTTP {(int)r.StatusCode}\n最终主机：{finalHost}", "LocalSub");
        }
        catch (Exception ex) { MessageBox.Show(ex.Message, "连接测试失败"); }
    }

    async Task DetectLocalSocks5()
    {
        var probeModel = _catalog.FirstOrDefault(m => !string.IsNullOrWhiteSpace(m.Url));
        if (probeModel == null) { MessageBox.Show("模型 catalog 没有可测试地址。", "LocalSub"); return; }

        var current = socksUrl.Text.Trim();
        var candidates = new[] { current, "socks5://127.0.0.1:7890", "socks5://127.0.0.1:7891", "socks5://127.0.0.1:10808", "socks5://127.0.0.1:1080" }
            .Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();

        foreach (var candidate in candidates)
        {
            try
            {
                var probe = new AppSettings { ProxyMode = ProxyMode.Socks5, Socks5Url = candidate };
                using var c = DownloadClientFactory.Create(probe, TimeSpan.FromSeconds(4));
                using var req = new HttpRequestMessage(HttpMethod.Get, probeModel.Url);
                req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 0);
                using var r = await c.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                if (!r.IsSuccessStatusCode) continue;
                proxyMode.SelectedIndex = 2;
                socksUrl.Text = candidate;
                SaveSettingsSilent();
                MessageBox.Show($"已检测到可用 SOCKS5：\n{candidate}\n\n已自动切换并保存。", "LocalSub");
                return;
            }
            catch { }
        }
        MessageBox.Show("未检测到可用的本机 SOCKS5。请确认 Clash / V2RayN 已运行并填写其 SOCKS5 端口。", "LocalSub");
    }

    void SaveSettingsSilent()
    {
        ApplySettingsFromUi();
        _settings.Save();
    }

    string[] ParseKeywords() => keywords.Text.Split([',', '，', ';', '；', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
