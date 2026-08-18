using System.Diagnostics;
using LocalSub.Core;
using LocalSub.Models;
using LocalSub.Services;

namespace LocalSub.UI;

/// <summary>
/// Replaces the early background-tab prototype with the production batch workspace
/// without coupling it to MainForm private state. This keeps the realtime UI stable.
/// </summary>
public static class BatchWorkspaceEnhancer
{
    public static void Attach(Form root)
    {
        var tabs = FindControls<TabControl>(root).FirstOrDefault();
        var page = tabs?.TabPages.Cast<TabPage>().FirstOrDefault(x => x.Text == "后台转写");
        if (page == null) return;
        var controller = new Controller(page);
        page.Tag = controller;
        page.Enter += (_, _) => controller.RefreshModels();
    }

    static IEnumerable<T> FindControls<T>(Control root) where T : Control
    {
        foreach (Control child in root.Controls)
        {
            if (child is T t) yield return t;
            foreach (var nested in FindControls<T>(child)) yield return nested;
        }
    }

    sealed class QueueItem
    {
        public required string Path { get; init; }
        public string State { get; set; } = "待处理";
        public override string ToString() => $"{State,-10}  {System.IO.Path.GetFileName(Path)}";
    }

    sealed class Controller
    {
        readonly TabPage _page;
        AppSettings _settings = AppSettings.Load();
        IReadOnlyList<ModelDescriptor> _catalog = [];
        ModelManager _models;
        FfmpegManager _ffmpeg;
        readonly MediaAnalysisService _analysis = new();
        readonly BatchTranscriptionService _transcriber = new();
        readonly Dictionary<string, MediaAnalysisResult> _analysisCache = new(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, BatchTranscriptionResult> _resultCache = new(StringComparer.OrdinalIgnoreCase);

        readonly ListBox _queue = new() { Dock = DockStyle.Fill, HorizontalScrollbar = true };
        readonly ComboBox _model = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 315 };
        readonly EnhancedWaveformView _waveform = new() { Dock = DockStyle.Fill };
        readonly RichTextBox _transcript = new() { Dock = DockStyle.Fill, ReadOnly = true, DetectUrls = false, BackColor = SystemColors.Window, BorderStyle = BorderStyle.FixedSingle };
        readonly TextBox _keywords = new() { Width = 380 };
        readonly Label _mediaInfo = new() { Dock = DockStyle.Fill, Text = "拖入视频/音频后自动解析声音轨道。", AutoEllipsis = true };
        readonly Label _status = new() { Dock = DockStyle.Fill, Text = "等待媒体", AutoEllipsis = true, TextAlign = ContentAlignment.MiddleLeft };
        readonly ProgressBar _progress = new() { Dock = DockStyle.Fill, Maximum = 100 };
        readonly Label _modelHint = new() { AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(6, 8, 4, 0) };
        readonly Button _transcribe = new() { Text = "转写选中", Width = 96 };
        readonly Button _transcribeAll = new() { Text = "全部转写", Width = 96 };
        readonly Button _cancel = new() { Text = "取消", Width = 72, Enabled = false };
        readonly Button _ffmpegButton = new() { Width = 126 };
        readonly Button _export = new() { Text = "导出 TXT", Width = 90 };
        CancellationTokenSource? _analysisCts;
        CancellationTokenSource? _workCts;
        bool _busy;

        public Controller(TabPage page)
        {
            _page = page;
            _models = new ModelManager(_settings);
            _ffmpeg = new FfmpegManager(_settings);
            BuildUi();
            RefreshModels();
            UpdateFfmpegButton();
        }

        void BuildUi()
        {
            _page.Controls.Clear();
            _page.AllowDrop = true;

            var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(10), ColumnCount = 1, RowCount = 7 };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 118));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 42));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 58));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

            var queuePanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
            queuePanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 32));
            queuePanel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var queueBar = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
            queueBar.Controls.Add(new Label { Text = "媒体队列", AutoSize = true, Font = new Font(SystemFonts.DefaultFont, FontStyle.Bold), Margin = new Padding(2, 8, 10, 0) });
            var add = new Button { Text = "添加文件", Width = 86 };
            var remove = new Button { Text = "移除", Width = 68 };
            var clear = new Button { Text = "清空", Width = 68 };
            queueBar.Controls.AddRange([add, remove, clear]);
            queuePanel.Controls.Add(queueBar, 0, 0);
            queuePanel.Controls.Add(_queue, 0, 1);

            var action = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Padding = new Padding(0, 4, 0, 0) };
            action.Controls.Add(new Label { Text = "后台模型", AutoSize = true, Margin = new Padding(0, 8, 6, 0) });
            action.Controls.Add(_model);
            action.Controls.Add(_transcribe);
            action.Controls.Add(_transcribeAll);
            action.Controls.Add(_cancel);
            action.Controls.Add(_export);
            action.Controls.Add(_ffmpegButton);
            action.Controls.Add(_modelHint);

            var info = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
            info.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
            info.RowStyles.Add(new RowStyle(SizeType.Absolute, 18));
            info.Controls.Add(_mediaInfo, 0, 0);
            info.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "声音轨道：浅色区为已识别语音段，竖线为关键词命中。", ForeColor = Color.DimGray }, 0, 1);

            var progressPanel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
            progressPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));
            progressPanel.RowStyles.Add(new RowStyle(SizeType.Absolute, 20));
            progressPanel.Controls.Add(_status, 0, 0);
            progressPanel.Controls.Add(_progress, 0, 1);

            var keywordPanel = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, Padding = new Padding(0, 3, 0, 0) };
            keywordPanel.Controls.Add(new Label { Text = "关键词", AutoSize = true, Margin = new Padding(0, 8, 6, 0) });
            _keywords.Text = _settings.Keywords;
            keywordPanel.Controls.Add(_keywords);
            keywordPanel.Controls.Add(new Label { Text = "逗号/分号/换行分隔，命中后文字高亮并标记到声音轨道", AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(8, 8, 0, 0) });

            root.Controls.Add(queuePanel, 0, 0);
            root.Controls.Add(action, 0, 1);
            root.Controls.Add(info, 0, 2);
            root.Controls.Add(_waveform, 0, 3);
            root.Controls.Add(_transcript, 0, 4);
            root.Controls.Add(progressPanel, 0, 5);
            root.Controls.Add(keywordPanel, 0, 6);
            _page.Controls.Add(root);

            add.Click += (_, _) => AddFilesWithDialog();
            remove.Click += (_, _) => RemoveSelected();
            clear.Click += (_, _) => ClearQueue();
            _queue.SelectedIndexChanged += async (_, _) => await ShowSelectedAsync();
            _transcribe.Click += async (_, _) => await TranscribeSelectedAsync();
            _transcribeAll.Click += async (_, _) => await TranscribeAllAsync();
            _cancel.Click += (_, _) => _workCts?.Cancel();
            _export.Click += (_, _) => ExportSelected();
            _ffmpegButton.Click += async (_, _) => await InstallOrOpenFfmpegAsync();
            _model.SelectedIndexChanged += (_, _) => PersistModelSelection();
            _keywords.Leave += (_, _) => PersistKeywords();
            _page.DragEnter += (_, e) => { if (e.Data?.GetDataPresent(DataFormats.FileDrop) == true) e.Effect = DragDropEffects.Copy; };
            _page.DragDrop += (_, e) =>
            {
                if (e.Data?.GetData(DataFormats.FileDrop) is string[] paths) AddFiles(paths);
            };
        }

        public void RefreshModels()
        {
            if (_busy) return;
            _settings = AppSettings.Load();
            _catalog = new ModelCatalogService().Load();
            _models = new ModelManager(_settings);
            _ffmpeg = new FfmpegManager(_settings);
            var old = (_model.SelectedItem as ModelDescriptor)?.Id;
            var available = _catalog.Where(x => x.BatchCapable && !string.Equals(x.Id, "silero-vad", StringComparison.OrdinalIgnoreCase) && _models.IsInstalled(x)).ToList();
            _model.DataSource = null;
            _model.DisplayMember = "Name";
            _model.ValueMember = "Id";
            _model.DataSource = available;
            var wanted = !string.IsNullOrWhiteSpace(old) && available.Any(x => x.Id == old) ? old : _settings.BatchModelId;
            var idx = available.FindIndex(x => x.Id == wanted);
            _model.SelectedIndex = idx >= 0 ? idx : available.Count > 0 ? 0 : -1;
            _modelHint.Text = available.Count == 0 ? "请先在“模型”页下载后台模型" : DescribeModel(_model.SelectedItem as ModelDescriptor);
            _transcribe.Enabled = available.Count > 0 && !_busy;
            _transcribeAll.Enabled = available.Count > 0 && !_busy;
            UpdateFfmpegButton();
        }

        void AddFilesWithDialog()
        {
            using var dlg = new OpenFileDialog
            {
                Multiselect = true,
                Filter = "媒体文件|*.mp4;*.mkv;*.mov;*.avi;*.m4v;*.webm;*.mp3;*.m4a;*.aac;*.flac;*.wav;*.wma;*.ts;*.m2ts|所有文件|*.*"
            };
            if (dlg.ShowDialog() == DialogResult.OK) AddFiles(dlg.FileNames);
        }

        void AddFiles(IEnumerable<string> paths)
        {
            QueueItem? first = null;
            foreach (var p in paths.Where(File.Exists))
            {
                if (_queue.Items.Cast<QueueItem>().Any(x => string.Equals(x.Path, p, StringComparison.OrdinalIgnoreCase))) continue;
                var item = new QueueItem { Path = p };
                _queue.Items.Add(item);
                first ??= item;
            }
            if (first != null) _queue.SelectedItem = first;
        }

        void RemoveSelected()
        {
            if (_busy || _queue.SelectedItem is not QueueItem item) return;
            _analysisCts?.Cancel();
            _analysisCache.Remove(item.Path);
            _resultCache.Remove(item.Path);
            _queue.Items.Remove(item);
            ShowEmptyIfNeeded();
        }

        void ClearQueue()
        {
            if (_busy) return;
            _analysisCts?.Cancel();
            _queue.Items.Clear();
            _analysisCache.Clear();
            _resultCache.Clear();
            ShowEmptyIfNeeded();
        }

        async Task ShowSelectedAsync()
        {
            if (_queue.SelectedItem is not QueueItem item)
            {
                ShowEmptyIfNeeded();
                return;
            }

            if (_analysisCache.TryGetValue(item.Path, out var analysis)) ApplyAnalysis(analysis);
            else await AnalyzeAsync(item);

            if (_resultCache.TryGetValue(item.Path, out var result)) ApplyTranscript(result);
            else
            {
                _transcript.Clear();
                _waveform.SetTranscript([]);
            }
        }

        async Task AnalyzeAsync(QueueItem item)
        {
            _analysisCts?.Cancel();
            _analysisCts?.Dispose();
            _analysisCts = new CancellationTokenSource();
            var ct = _analysisCts.Token;
            item.State = "解析中";
            _queue.Refresh();
            _mediaInfo.Text = $"{Path.GetFileName(item.Path)}   正在读取音轨…";
            _progress.Value = 0;
            try
            {
                var progress = new Progress<MediaAnalysisProgress>(p =>
                {
                    if (ct.IsCancellationRequested) return;
                    _progress.Value = Math.Clamp(p.Percent, 0, 100);
                    _status.Text = $"{p.Stage}  {p.Detail}";
                });
                var result = await _analysis.AnalyzeAsync(item.Path, _settings, progress, ct);
                if (ct.IsCancellationRequested) return;
                _analysisCache[item.Path] = result;
                item.State = _resultCache.ContainsKey(item.Path) ? "已完成" : "波形就绪";
                _queue.Refresh();
                ApplyAnalysis(result);
                _status.Text = "声音轨道已生成，可开始后台转写。";
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                item.State = _ffmpeg.IsInstalled ? "解析失败" : "需 FFmpeg";
                _queue.Refresh();
                _status.Text = ex.Message;
                _progress.Value = 0;
                UpdateFfmpegButton();
            }
        }

        void ApplyAnalysis(MediaAnalysisResult result)
        {
            _waveform.SetWaveform(result.Waveform, result.Duration);
            if (_resultCache.TryGetValue(result.FilePath, out var transcript)) _waveform.SetTranscript(transcript.Items);
            _mediaInfo.Text = $"{Path.GetFileName(result.FilePath)}   时长 {FormatClock(result.Duration)}   {result.SampleRate} Hz / {result.Channels} 声道   解码 {result.DecoderName}";
            _progress.Value = 100;
        }

        async Task TranscribeSelectedAsync()
        {
            if (_queue.SelectedItem is not QueueItem item) return;
            await RunTranscriptionAsync([item]);
        }

        async Task TranscribeAllAsync()
        {
            await RunTranscriptionAsync(_queue.Items.Cast<QueueItem>().ToArray());
        }

        async Task RunTranscriptionAsync(IReadOnlyList<QueueItem> items)
        {
            if (_busy || items.Count == 0 || _model.SelectedItem is not ModelDescriptor model) return;
            _busy = true;
            SetBusy(true);
            PersistModelSelection();
            PersistKeywords();
            _workCts = new CancellationTokenSource();
            var ct = _workCts.Token;
            try
            {
                for (var fileIndex = 0; fileIndex < items.Count; fileIndex++)
                {
                    ct.ThrowIfCancellationRequested();
                    var item = items[fileIndex];
                    _queue.SelectedItem = item;
                    item.State = "转写中";
                    _queue.Refresh();
                    _progress.Value = 0;
                    _transcript.Clear();
                    _status.Text = $"[{fileIndex + 1}/{items.Count}] 准备 {Path.GetFileName(item.Path)}";

                    var progress = new Progress<BatchTranscriptionProgress>(p =>
                    {
                        _progress.Value = Math.Clamp(p.Percent, 0, 100);
                        item.State = p.Percent >= 100 ? "已完成" : $"转写 {p.Percent}%";
                        _queue.Refresh();
                        _status.Text = $"[{fileIndex + 1}/{items.Count}] {p.Stage}  {p.Detail}";
                    });
                    var runtimeProgress = new Progress<ModelOperationProgress>(p =>
                    {
                        if (!string.IsNullOrWhiteSpace(p.Detail)) _status.Text = p.Stage + "  " + p.Detail;
                    });

                    try
                    {
                        var result = await _transcriber.TranscribeAsync(item.Path, _settings, model, _models, ParseKeywords(), progress, runtimeProgress, ct);
                        _resultCache[item.Path] = result;
                        item.State = $"完成 {result.Items.Count}段";
                        _queue.Refresh();
                        SaveAutomaticJson(result, model);
                        ApplyTranscript(result);
                        if (!_analysisCache.ContainsKey(item.Path)) await AnalyzeAsync(item);
                        if (_analysisCache.TryGetValue(item.Path, out var a)) ApplyAnalysis(a);
                        _waveform.SetTranscript(result.Items);
                        _status.Text = $"完成：{result.Items.Count} 段，{result.DecoderName}，RTF {result.RealTimeFactor:0.00}，结构化记录已保存到 Data\\Transcripts。";
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        item.State = "转写失败";
                        _queue.Refresh();
                        _status.Text = $"{Path.GetFileName(item.Path)}：{ex.Message}";
                    }
                }
            }
            catch (OperationCanceledException)
            {
                _status.Text = "后台转写已取消，已完成的文件结果保留。";
            }
            finally
            {
                _workCts.Dispose();
                _workCts = null;
                _busy = false;
                SetBusy(false);
            }
        }

        void ApplyTranscript(BatchTranscriptionResult result)
        {
            _transcript.SuspendLayout();
            _transcript.Clear();
            foreach (var item in result.Items)
            {
                AppendStyled($"[{FormatClockMs(item.Start)} - {FormatClockMs(item.End)}] ", Color.DimGray, null);
                var lineStart = _transcript.TextLength;
                AppendStyled(item.Text, SystemColors.ControlText, null);
                foreach (var kw in item.Keywords)
                {
                    var search = 0;
                    while (search < item.Text.Length)
                    {
                        var idx = item.Text.IndexOf(kw, search, StringComparison.OrdinalIgnoreCase);
                        if (idx < 0) break;
                        _transcript.Select(lineStart + idx, kw.Length);
                        _transcript.SelectionBackColor = Color.FromArgb(255, 244, 175);
                        _transcript.SelectionColor = Color.Black;
                        search = idx + Math.Max(1, kw.Length);
                    }
                }
                _transcript.Select(_transcript.TextLength, 0);
                _transcript.SelectionBackColor = _transcript.BackColor;
                _transcript.AppendText(Environment.NewLine);
            }
            _transcript.ResumeLayout();
            _waveform.SetTranscript(result.Items);
        }

        void AppendStyled(string text, Color color, Color? back)
        {
            _transcript.SelectionStart = _transcript.TextLength;
            _transcript.SelectionLength = 0;
            _transcript.SelectionColor = color;
            _transcript.SelectionBackColor = back ?? _transcript.BackColor;
            _transcript.AppendText(text);
        }

        void SaveAutomaticJson(BatchTranscriptionResult result, ModelDescriptor model)
        {
            var dir = Path.Combine(PortablePaths.DataDir, "Transcripts");
            Directory.CreateDirectory(dir);
            var name = SanitizeFileName(Path.GetFileNameWithoutExtension(result.FilePath));
            var path = Path.Combine(dir, name + ".localsub.json");
            TranscriptPersistenceService.SaveJson(path, result.FilePath, model.Id, result.Duration, result.ProcessingTime, result.Items);
        }

        void ExportSelected()
        {
            if (_queue.SelectedItem is not QueueItem item || !_resultCache.TryGetValue(item.Path, out var result))
            {
                MessageBox.Show("当前文件还没有转写结果。", "LocalSub");
                return;
            }
            using var dlg = new SaveFileDialog
            {
                Filter = "Text|*.txt",
                FileName = Path.GetFileNameWithoutExtension(item.Path) + ".txt"
            };
            if (dlg.ShowDialog() == DialogResult.OK)
                TranscriptPersistenceService.ExportTxt(dlg.FileName, result.Items, true);
        }

        async Task InstallOrOpenFfmpegAsync()
        {
            if (_ffmpeg.IsInstalled)
            {
                Process.Start(new ProcessStartInfo("explorer.exe", _ffmpeg.BinDir) { UseShellExecute = true });
                return;
            }

            if (_busy) return;
            _ffmpegButton.Enabled = false;
            _status.Text = "开始下载 FFmpeg Essentials，组件只保存到 LocalSub\\Components。";
            try
            {
                var p = new Progress<ComponentDownloadProgress>(x =>
                {
                    _progress.Value = Math.Clamp(x.Percent, 0, 100);
                    var total = x.TotalBytes.HasValue ? $" / {FormatBytes(x.TotalBytes.Value)}" : "";
                    var speed = x.BytesPerSecond > 0 ? $"   {FormatBytes((long)x.BytesPerSecond)}/s" : "";
                    _status.Text = $"{x.Stage}   {FormatBytes(x.BytesDone)}{total}{speed}";
                });
                await _ffmpeg.EnsureAsync(p);
                _status.Text = "FFmpeg 已安装，可解析 MKV/WebM/特殊编码媒体。";
                if (_queue.SelectedItem is QueueItem selected && !_analysisCache.ContainsKey(selected.Path)) await AnalyzeAsync(selected);
            }
            catch (Exception ex) { _status.Text = "FFmpeg 安装失败：" + ex.Message; }
            finally
            {
                _ffmpegButton.Enabled = true;
                UpdateFfmpegButton();
            }
        }

        void PersistModelSelection()
        {
            if (_model.SelectedItem is ModelDescriptor m)
            {
                _settings.BatchModelId = m.Id;
                _modelHint.Text = DescribeModel(m);
                _settings.Save();
            }
        }

        void PersistKeywords()
        {
            _settings.Keywords = _keywords.Text;
            _settings.Save();
            if (_queue.SelectedItem is QueueItem item && _resultCache.TryGetValue(item.Path, out var result))
            {
                var updated = result.Items.Select(x => new TranscriptItem
                {
                    Start = x.Start,
                    End = x.End,
                    Text = x.Text,
                    Keywords = ParseKeywords().Where(k => x.Text.Contains(k, StringComparison.OrdinalIgnoreCase)).ToList()
                }).ToArray();
                var revised = result with { Items = updated };
                _resultCache[item.Path] = revised;
                ApplyTranscript(revised);
            }
        }

        string[] ParseKeywords() => _keywords.Text.Split([',', '，', ';', '；', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        void SetBusy(bool busy)
        {
            _transcribe.Enabled = !busy && _model.Items.Count > 0;
            _transcribeAll.Enabled = !busy && _model.Items.Count > 0;
            _cancel.Enabled = busy;
            _model.Enabled = !busy;
            _queue.Enabled = !busy;
            _ffmpegButton.Enabled = !busy;
        }

        void UpdateFfmpegButton()
        {
            _ffmpegButton.Text = _ffmpeg.IsInstalled ? "打开 FFmpeg" : "下载 FFmpeg";
        }

        void ShowEmptyIfNeeded()
        {
            if (_queue.Items.Count > 0) return;
            _waveform.ClearAll();
            _transcript.Clear();
            _mediaInfo.Text = "拖入视频/音频后自动解析声音轨道。";
            _status.Text = "等待媒体";
            _progress.Value = 0;
        }

        static string DescribeModel(ModelDescriptor? m)
        {
            if (m == null) return "";
            return $"{m.SizeText} · 准确 {m.AccuracyScore}/10 · {m.Languages}";
        }
        static string FormatClock(TimeSpan t) => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss") : t.ToString(@"mm\:ss");
        static string FormatClockMs(TimeSpan t) => t.TotalHours >= 1 ? t.ToString(@"hh\:mm\:ss\.fff") : t.ToString(@"mm\:ss\.fff");
        static string FormatBytes(long v)
        {
            string[] units = ["B", "KB", "MB", "GB"];
            double d = Math.Max(0, v); var i = 0;
            while (d >= 1024 && i < units.Length - 1) { d /= 1024; i++; }
            return i == 0 ? $"{d:0} {units[i]}" : $"{d:0.0} {units[i]}";
        }
        static string SanitizeFileName(string value)
        {
            foreach (var ch in Path.GetInvalidFileNameChars()) value = value.Replace(ch, '_');
            return string.IsNullOrWhiteSpace(value) ? "transcript" : value;
        }
    }
}
