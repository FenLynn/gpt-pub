using System.Diagnostics;
using System.Text.Json;

namespace MediaIndex.Acceptance;

internal sealed class MainForm : Form
{
    private static readonly string[] ImageExtensions =
    [
        ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"
    ];

    private static readonly string[] VideoExtensions =
    [
        ".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".ts", ".mts", ".m2ts"
    ];

    private readonly AcceptanceWorkspace _workspace;
    private readonly BackendRunner _backend = new();
    private readonly AcceptanceWorkspaceState _state;

    private readonly TextBox _imageLibrary = new();
    private readonly TextBox _videoLibrary = new();
    private readonly DataGridView _grid = new();
    private readonly Label _queryCountLabel = new();
    private readonly Label _statusLabel = new();
    private readonly Label _resultHeadline = new();
    private readonly Label _resultDetail = new();
    private readonly TextBox _log = new();
    private readonly ProgressBar _progress = new();
    private readonly Button _runButton = new();
    private readonly Button _cancelButton = new();
    private readonly Button _exportButton = new();
    private CancellationTokenSource? _runCancellation;

    public MainForm()
    {
        Text = "MediaIndex Acceptance";
        Width = 1160;
        Height = 820;
        MinimumSize = new Size(980, 700);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(244, 247, 251);
        Font = new Font("Microsoft YaHei UI", 10F);
        AllowDrop = true;

        var localRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "FenLynn",
            "MediaIndex",
            "Acceptance");

        _workspace = new AcceptanceWorkspace(localRoot);
        _state = _workspace.Load();

        BuildUi();
        LoadStateIntoUi();
        RefreshGrid();
        RefreshStatus();

        DragEnter += HandleDragEnter;
        DragDrop += HandleDragDrop;
        FormClosing += (_, _) => SaveState();
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(28, 22, 28, 24)
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 164));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 178));
        Controls.Add(root);

        root.Controls.Add(BuildHeader(), 0, 0);
        root.Controls.Add(BuildLibraryCard(), 0, 1);
        root.Controls.Add(BuildQueryCard(), 0, 2);
        root.Controls.Add(BuildRunCard(), 0, 3);
    }

    private Control BuildHeader()
    {
        var panel = new Panel
        {
            Dock = DockStyle.Fill
        };

        var title = new Label
        {
            Text = "MediaIndex 真实素材验收",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 18F, FontStyle.Bold),
            ForeColor = Color.FromArgb(28, 39, 55),
            Location = new Point(0, 2)
        };
        panel.Controls.Add(title);

        var subtitle = new Label
        {
            Text = "只需选库存目录、加入几个查询样本、设置标准答案，然后点开始。CSV 和命令行由程序自动处理。",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 9.5F),
            ForeColor = Color.FromArgb(93, 104, 121),
            Location = new Point(1, 39)
        };
        panel.Controls.Add(subtitle);

        _statusLabel.AutoSize = true;
        _statusLabel.Font = new Font(Font.FontFamily, 9F, FontStyle.Bold);
        _statusLabel.ForeColor = Color.FromArgb(61, 120, 220);
        _statusLabel.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        panel.Controls.Add(_statusLabel);

        panel.Resize += (_, _) =>
        {
            _statusLabel.Left = Math.Max(
                0,
                panel.ClientSize.Width - _statusLabel.PreferredWidth);
            _statusLabel.Top = 8;
        };

        return panel;
    }

    private Control BuildLibraryCard()
    {
        var card = CreateCard();

        var title = CreateSectionTitle("1  选择真实库存");
        title.Location = new Point(22, 17);
        card.Controls.Add(title);

        var imageLabel = CreateMutedLabel("图片库存");
        imageLabel.Location = new Point(22, 56);
        imageLabel.Size = new Size(86, 28);
        card.Controls.Add(imageLabel);

        ConfigurePathTextBox(_imageLibrary);
        _imageLibrary.Location = new Point(112, 53);
        _imageLibrary.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        card.Controls.Add(_imageLibrary);

        var imageBrowse = CreateSecondaryButton("选择");
        imageBrowse.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        imageBrowse.Click += (_, _) => ChooseLibraryFolder(QueryMediaKind.Image);
        card.Controls.Add(imageBrowse);

        var videoLabel = CreateMutedLabel("视频库存");
        videoLabel.Location = new Point(22, 100);
        videoLabel.Size = new Size(86, 28);
        card.Controls.Add(videoLabel);

        ConfigurePathTextBox(_videoLibrary);
        _videoLibrary.Location = new Point(112, 97);
        _videoLibrary.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        card.Controls.Add(_videoLibrary);

        var videoBrowse = CreateSecondaryButton("选择");
        videoBrowse.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        videoBrowse.Click += (_, _) => ChooseLibraryFolder(QueryMediaKind.Video);
        card.Controls.Add(videoBrowse);

        card.Resize += (_, _) =>
        {
            var buttonWidth = 74;
            imageBrowse.Size = new Size(buttonWidth, 32);
            videoBrowse.Size = new Size(buttonWidth, 32);
            imageBrowse.Left = card.ClientSize.Width - buttonWidth - 22;
            videoBrowse.Left = imageBrowse.Left;
            imageBrowse.Top = 52;
            videoBrowse.Top = 96;

            var width = Math.Max(160, imageBrowse.Left - 124);
            _imageLibrary.Size = new Size(width, 32);
            _videoLibrary.Size = new Size(width, 32);
        };

        return card;
    }

    private Control BuildQueryCard()
    {
        var card = CreateCard();

        var title = CreateSectionTitle("2  加入查询样本并设置标准答案");
        title.Location = new Point(22, 15);
        card.Controls.Add(title);

        _queryCountLabel.AutoSize = true;
        _queryCountLabel.ForeColor = Color.FromArgb(93, 104, 121);
        _queryCountLabel.Location = new Point(22, 48);
        card.Controls.Add(_queryCountLabel);

        var addImage = CreateSecondaryButton("添加图片");
        addImage.Click += (_, _) => AddQueries(QueryMediaKind.Image);
        card.Controls.Add(addImage);

        var addVideo = CreateSecondaryButton("添加视频");
        addVideo.Click += (_, _) => AddQueries(QueryMediaKind.Video);
        card.Controls.Add(addVideo);

        var setExpected = CreatePrimarySmallButton("设置标准答案");
        setExpected.Click += (_, _) => SetExpectedForSelected();
        card.Controls.Add(setExpected);

        var setNegative = CreateSecondaryButton("设为无对应");
        setNegative.Click += (_, _) => MarkSelectedNegative();
        card.Controls.Add(setNegative);

        var remove = CreateSecondaryButton("删除");
        remove.Click += (_, _) => RemoveSelected();
        card.Controls.Add(remove);

        ConfigureGrid();
        card.Controls.Add(_grid);

        card.Resize += (_, _) =>
        {
            var y = 42;
            var x = card.ClientSize.Width - 22;

            void PlaceRight(Control control)
            {
                x -= control.Width;
                control.Location = new Point(x, y);
                x -= 8;
            }

            PlaceRight(remove);
            PlaceRight(setNegative);
            PlaceRight(setExpected);
            PlaceRight(addVideo);
            PlaceRight(addImage);

            _grid.Location = new Point(22, 84);
            _grid.Size = new Size(
                Math.Max(100, card.ClientSize.Width - 44),
                Math.Max(100, card.ClientSize.Height - 104));
        };

        return card;
    }

    private Control BuildRunCard()
    {
        var card = CreateCard();

        _resultHeadline.Text = "3  开始验收";
        _resultHeadline.AutoSize = true;
        _resultHeadline.Font = new Font(Font.FontFamily, 12F, FontStyle.Bold);
        _resultHeadline.ForeColor = Color.FromArgb(31, 42, 58);
        _resultHeadline.Location = new Point(22, 17);
        card.Controls.Add(_resultHeadline);

        _resultDetail.Text = "结果会保存在本机 AppData，默认不复制任何私人媒体。";
        _resultDetail.AutoSize = true;
        _resultDetail.ForeColor = Color.FromArgb(93, 104, 121);
        _resultDetail.Location = new Point(22, 48);
        card.Controls.Add(_resultDetail);

        _progress.Style = ProgressBarStyle.Continuous;
        _progress.Minimum = 0;
        _progress.Maximum = 100;
        _progress.Value = 0;
        card.Controls.Add(_progress);

        _runButton.Text = "开始真实域验收";
        _runButton.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);
        _runButton.BackColor = Color.FromArgb(61, 120, 220);
        _runButton.ForeColor = Color.White;
        _runButton.FlatStyle = FlatStyle.Flat;
        _runButton.FlatAppearance.BorderSize = 0;
        _runButton.Height = 40;
        _runButton.Click += async (_, _) => await RunAcceptanceAsync();
        card.Controls.Add(_runButton);

        _cancelButton.Text = "停止";
        _cancelButton.Enabled = false;
        _cancelButton.Height = 40;
        _cancelButton.FlatStyle = FlatStyle.Flat;
        _cancelButton.Click += (_, _) => _runCancellation?.Cancel();
        card.Controls.Add(_cancelButton);

        _exportButton.Text = "导出匿名结果";
        _exportButton.Height = 40;
        _exportButton.FlatStyle = FlatStyle.Flat;
        _exportButton.Enabled = File.Exists(_workspace.SummaryResultPath);
        _exportButton.Click += (_, _) => ExportResults();
        card.Controls.Add(_exportButton);

        _log.Multiline = true;
        _log.ReadOnly = true;
        _log.ScrollBars = ScrollBars.Vertical;
        _log.BackColor = Color.FromArgb(250, 252, 255);
        _log.BorderStyle = BorderStyle.FixedSingle;
        _log.Font = new Font("Consolas", 8.5F);
        card.Controls.Add(_log);

        card.Resize += (_, _) =>
        {
            var buttonAreaWidth = 410;
            var leftWidth = Math.Max(300, card.ClientSize.Width - buttonAreaWidth - 44);

            _progress.Location = new Point(22, 80);
            _progress.Size = new Size(leftWidth, 18);

            _runButton.Location = new Point(22, 110);
            _runButton.Width = 170;

            _cancelButton.Location = new Point(202, 110);
            _cancelButton.Width = 78;

            _exportButton.Location = new Point(290, 110);
            _exportButton.Width = 120;

            _log.Location = new Point(leftWidth + 44, 18);
            _log.Size = new Size(
                Math.Max(200, card.ClientSize.Width - leftWidth - 66),
                Math.Max(80, card.ClientSize.Height - 36));
        };

        return card;
    }

    private void ConfigureGrid()
    {
        _grid.AllowUserToAddRows = false;
        _grid.AllowUserToDeleteRows = false;
        _grid.AllowUserToResizeRows = false;
        _grid.BackgroundColor = Color.White;
        _grid.BorderStyle = BorderStyle.None;
        _grid.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
        _grid.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
        _grid.ColumnHeadersHeight = 36;
        _grid.RowTemplate.Height = 34;
        _grid.RowHeadersVisible = false;
        _grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _grid.MultiSelect = true;
        _grid.AutoGenerateColumns = false;
        _grid.ReadOnly = true;
        _grid.EnableHeadersVisualStyles = false;
        _grid.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(246, 248, 252);
        _grid.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(82, 94, 112);
        _grid.DefaultCellStyle.SelectionBackColor = Color.FromArgb(229, 238, 252);
        _grid.DefaultCellStyle.SelectionForeColor = Color.FromArgb(31, 42, 58);

        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Kind",
            HeaderText = "类型",
            Width = 62
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Query",
            HeaderText = "查询样本",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill,
            FillWeight = 42
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Expected",
            HeaderText = "标准答案",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill,
            FillWeight = 38
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Relation",
            HeaderText = "关系",
            Width = 130
        });
        _grid.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Start",
            HeaderText = "源起始秒",
            Width = 82
        });

        _grid.CellDoubleClick += (_, eventArgs) =>
        {
            if (eventArgs.RowIndex >= 0)
            {
                SetExpectedForSelected();
            }
        };
    }

    private void ChooseLibraryFolder(QueryMediaKind kind)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = kind == QueryMediaKind.Image
                ? "选择真实图片库存根目录"
                : "选择真实视频库存根目录",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false
        };

        var current = kind == QueryMediaKind.Image
            ? _state.ImageLibraryPath
            : _state.VideoLibraryPath;

        if (Directory.Exists(current))
        {
            dialog.SelectedPath = current;
        }

        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        if (kind == QueryMediaKind.Image)
        {
            _state.ImageLibraryPath = dialog.SelectedPath;
            _imageLibrary.Text = dialog.SelectedPath;
        }
        else
        {
            _state.VideoLibraryPath = dialog.SelectedPath;
            _videoLibrary.Text = dialog.SelectedPath;
        }

        SaveState();
        RefreshStatus();
    }

    private void AddQueries(QueryMediaKind kind)
    {
        using var dialog = new OpenFileDialog
        {
            Multiselect = true,
            Title = kind == QueryMediaKind.Image
                ? "选择要测试的图片"
                : "选择要测试的视频",
            Filter = kind == QueryMediaKind.Image
                ? "图片|*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.tif;*.tiff;*.heic;*.heif|所有文件|*.*"
                : "视频|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.m4v;*.ts;*.mts;*.m2ts|所有文件|*.*"
        };

        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        foreach (var file in dialog.FileNames)
        {
            AddQueryPath(file, kind);
        }

        SaveState();
        RefreshGrid();
        RefreshStatus();
    }

    private void AddQueryPath(string path, QueryMediaKind kind)
    {
        if (_state.Queries.Any(q =>
            string.Equals(
                Path.GetFullPath(q.QueryPath),
                Path.GetFullPath(path),
                StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        _state.Queries.Add(new AcceptanceQuery
        {
            Kind = kind,
            QueryPath = path,
            Relation = kind == QueryMediaKind.Image
                ? "Same source"
                : "Same video"
        });
    }

    private void SetExpectedForSelected()
    {
        var selected = SelectedQueries().ToList();
        if (selected.Count != 1)
        {
            MessageBox.Show(
                this,
                "请先只选择一条查询样本。双击该行也可以设置标准答案。",
                "MediaIndex Acceptance",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        var query = selected[0];
        var library = query.Kind == QueryMediaKind.Image
            ? _state.ImageLibraryPath
            : _state.VideoLibraryPath;

        if (!Directory.Exists(library))
        {
            MessageBox.Show(
                this,
                "请先选择对应的库存目录。",
                "MediaIndex Acceptance",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        using var sourceDialog = new OpenFileDialog
        {
            Title = "选择这条 Query 的真实源文件",
            InitialDirectory = library,
            Filter = query.Kind == QueryMediaKind.Image
                ? "图片|*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.tif;*.tiff;*.heic;*.heif|所有文件|*.*"
                : "视频|*.mp4;*.mkv;*.mov;*.avi;*.webm;*.m4v;*.ts;*.mts;*.m2ts|所有文件|*.*"
        };

        if (sourceDialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        query.ExpectedSourcePath = sourceDialog.FileName;

        using var editor = new QueryEditorDialog(query);
        if (editor.ShowDialog(this) == DialogResult.OK)
        {
            query.Relation = editor.Relation;
            query.ExpectedStartSeconds = editor.ExpectedStartSeconds;
        }

        SaveState();
        RefreshGrid();
        RefreshStatus();
    }

    private void MarkSelectedNegative()
    {
        foreach (var query in SelectedQueries())
        {
            query.ExpectedSourcePath = string.Empty;
            query.ExpectedStartSeconds = null;
            query.Relation = query.Kind == QueryMediaKind.Image
                ? "Hard negative"
                : "Unrelated";
        }

        SaveState();
        RefreshGrid();
        RefreshStatus();
    }

    private void RemoveSelected()
    {
        var ids = SelectedQueries().Select(q => q.Id).ToHashSet();
        if (ids.Count == 0)
        {
            return;
        }

        _state.Queries.RemoveAll(q => ids.Contains(q.Id));
        SaveState();
        RefreshGrid();
        RefreshStatus();
    }

    private IEnumerable<AcceptanceQuery> SelectedQueries()
    {
        foreach (DataGridViewRow row in _grid.SelectedRows)
        {
            if (row.Tag is Guid id)
            {
                var query = _state.Queries.FirstOrDefault(q => q.Id == id);
                if (query is not null)
                {
                    yield return query;
                }
            }
        }
    }

    private async Task RunAcceptanceAsync()
    {
        if (!ValidateBeforeRun())
        {
            return;
        }

        SaveState();
        _workspace.WriteManifests(_state);

        if (!_backend.IsReady)
        {
            MessageBox.Show(
                this,
                "当前目录缺少 Runtime\\MediaIndex.Acceptance.Worker.exe。"
                + Environment.NewLine
                + Environment.NewLine
                + "请使用 P106 的 build_acceptance.bat 生成完整便携版。"
                + "正式便携版中不会要求你安装 Python。",
                "运行组件缺失",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
            return;
        }

        SetRunning(true);
        _runCancellation = new CancellationTokenSource();
        _log.Clear();
        _progress.Value = 5;

        var progress = new Progress<string>(AppendLog);

        try
        {
            var hasImages = _state.Queries.Any(q => q.Kind == QueryMediaKind.Image);
            var hasVideos = _state.Queries.Any(q => q.Kind == QueryMediaKind.Video);

            if (hasImages)
            {
                AppendLog("开始图片 A4 验收...");
                var imageExit = await _backend.RunImageAsync(
                    _state.ImageLibraryPath,
                    _workspace.ImageManifestPath,
                    _workspace.ImageResultPath,
                    progress,
                    _runCancellation.Token);

                if (imageExit != 0)
                {
                    throw new InvalidOperationException(
                        $"图片验收退出码：{imageExit}");
                }
            }
            else
            {
                WriteEmptyResult(_workspace.ImageResultPath, "image");
            }

            _progress.Value = 48;

            if (hasVideos)
            {
                AppendLog("开始视频 V011 验收...");
                var videoExit = await _backend.RunVideoAsync(
                    _state.VideoLibraryPath,
                    _workspace.VideoManifestPath,
                    _workspace.VideoResultPath,
                    progress,
                    _runCancellation.Token);

                if (videoExit != 0)
                {
                    throw new InvalidOperationException(
                        $"视频验收退出码：{videoExit}");
                }
            }
            else
            {
                WriteEmptyResult(_workspace.VideoResultPath, "video");
            }

            _progress.Value = 88;

            var summaryExit = await _backend.RunSummaryAsync(
                _workspace.ImageResultPath,
                _workspace.VideoResultPath,
                _workspace.SummaryResultPath,
                progress,
                _runCancellation.Token);

            if (summaryExit != 0)
            {
                throw new InvalidOperationException(
                    $"摘要退出码：{summaryExit}");
            }

            _progress.Value = 100;
            _exportButton.Enabled = true;
            ShowSummary();
            AppendLog("验收完成。");
        }
        catch (OperationCanceledException)
        {
            AppendLog("已停止。");
            _resultHeadline.Text = "验收已停止";
            _progress.Value = 0;
        }
        catch (Exception exception)
        {
            AppendLog("ERROR: " + exception.Message);
            _resultHeadline.Text = "验收失败";
            _resultDetail.Text = exception.Message;
            MessageBox.Show(
                this,
                exception.Message,
                "MediaIndex Acceptance",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            _runCancellation?.Dispose();
            _runCancellation = null;
            SetRunning(false);
        }
    }

    private bool ValidateBeforeRun()
    {
        if (_state.Queries.Count == 0)
        {
            MessageBox.Show(
                this,
                "请先添加几个真实 Query。可以直接把图片或视频拖进这个窗口。",
                "还没有查询样本",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return false;
        }

        var hasImages = _state.Queries.Any(q => q.Kind == QueryMediaKind.Image);
        var hasVideos = _state.Queries.Any(q => q.Kind == QueryMediaKind.Video);

        if (hasImages && !Directory.Exists(_state.ImageLibraryPath))
        {
            MessageBox.Show(this, "图片库存目录无效。", "MediaIndex Acceptance");
            return false;
        }

        if (hasVideos && !Directory.Exists(_state.VideoLibraryPath))
        {
            MessageBox.Show(this, "视频库存目录无效。", "MediaIndex Acceptance");
            return false;
        }

        var missingQuery = _state.Queries.FirstOrDefault(q => !File.Exists(q.QueryPath));
        if (missingQuery is not null)
        {
            MessageBox.Show(
                this,
                "查询文件不存在："
                + Environment.NewLine
                + missingQuery.QueryPath,
                "MediaIndex Acceptance");
            return false;
        }

        var outside = _state.Queries
            .Where(q => !string.IsNullOrWhiteSpace(q.ExpectedSourcePath))
            .FirstOrDefault(q =>
            {
                var root = q.Kind == QueryMediaKind.Image
                    ? _state.ImageLibraryPath
                    : _state.VideoLibraryPath;
                return !IsWithinDirectory(q.ExpectedSourcePath, root);
            });

        if (outside is not null)
        {
            MessageBox.Show(
                this,
                "有一条标准答案不在对应库存目录内："
                + Environment.NewLine
                + outside.ExpectedSourcePath,
                "请重新设置标准答案");
            return false;
        }

        return true;
    }

    private static bool IsWithinDirectory(string path, string root)
    {
        try
        {
            var relative = Path.GetRelativePath(
                Path.GetFullPath(root),
                Path.GetFullPath(path));

            return !relative.StartsWith("..", StringComparison.Ordinal)
                && !Path.IsPathRooted(relative);
        }
        catch
        {
            return false;
        }
    }

    private void ShowSummary()
    {
        var summary = _backend.ReadSummary(_workspace.SummaryResultPath);
        if (summary is null)
        {
            _resultHeadline.Text = "验收完成";
            _resultDetail.Text = "结果已保存，但摘要读取失败。";
            return;
        }

        var pieces = new List<string>();

        if (summary.Image is JsonElement image && image.ValueKind == JsonValueKind.Object)
        {
            pieces.Add(
                "图片 Top50 "
                + Percent(image, "candidate_topk_recall")
                + "，误确认 "
                + IntValue(image, "false_confirmed_count_baseline"));
        }

        if (summary.Video is JsonElement video && video.ValueKind == JsonValueKind.Object)
        {
            pieces.Add(
                "视频 Top1 "
                + Percent(video, "top1_accuracy_positive")
                + "，负样本强匹配 "
                + IntValue(video, "unexpected_strong_match_count_baseline"));
        }

        _resultHeadline.Text = "验收完成";
        _resultDetail.Text = pieces.Count > 0
            ? string.Join("    ", pieces)
            : "结果已生成。";
    }

    private static string Percent(JsonElement root, string name)
    {
        if (root.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetDouble(out var number))
        {
            return $"{number * 100:0.0}%";
        }

        return "N/A";
    }

    private static string IntValue(JsonElement root, string name)
    {
        if (root.TryGetProperty(name, out var value)
            && value.ValueKind == JsonValueKind.Number
            && value.TryGetInt32(out var number))
        {
            return number.ToString();
        }

        return "N/A";
    }

    private void WriteEmptyResult(string path, string kind)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(
            path,
            JsonSerializer.Serialize(
                new
                {
                    summary = new
                    {
                        queries = 0,
                        note = $"{kind} not included in this acceptance run"
                    },
                    results = Array.Empty<object>()
                },
                new JsonSerializerOptions { WriteIndented = true }));
    }

    private void ExportResults()
    {
        if (!File.Exists(_workspace.SummaryResultPath))
        {
            return;
        }

        using var dialog = new FolderBrowserDialog
        {
            Description = "选择匿名结果导出目录",
            UseDescriptionForTitle = true
        };

        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        var exportRoot = Path.Combine(
            dialog.SelectedPath,
            $"MediaIndex-Acceptance-Results-{DateTime.Now:yyyyMMdd-HHmmss}");
        Directory.CreateDirectory(exportRoot);

        foreach (var source in new[]
        {
            _workspace.ImageResultPath,
            _workspace.VideoResultPath,
            _workspace.SummaryResultPath
        })
        {
            if (File.Exists(source))
            {
                File.Copy(
                    source,
                    Path.Combine(exportRoot, Path.GetFileName(source)),
                    true);
            }
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = exportRoot,
            UseShellExecute = true
        });
    }

    private void LoadStateIntoUi()
    {
        _imageLibrary.Text = _state.ImageLibraryPath;
        _videoLibrary.Text = _state.VideoLibraryPath;

        if (File.Exists(_workspace.SummaryResultPath))
        {
            ShowSummary();
        }
    }

    private void SaveState()
    {
        _state.ImageLibraryPath = _imageLibrary.Text.Trim();
        _state.VideoLibraryPath = _videoLibrary.Text.Trim();
        _workspace.Save(_state);
    }

    private void RefreshGrid()
    {
        _grid.Rows.Clear();

        foreach (var query in _state.Queries)
        {
            var index = _grid.Rows.Add(
                query.KindText,
                query.QueryName,
                query.ExpectedName,
                query.Relation,
                query.ExpectedStartSeconds?.ToString("0.##") ?? string.Empty);

            _grid.Rows[index].Tag = query.Id;
            _grid.Rows[index].Cells["Query"].ToolTipText = query.QueryPath;
            _grid.Rows[index].Cells["Expected"].ToolTipText = query.ExpectedSourcePath;
        }

        _queryCountLabel.Text =
            $"已加入 {_state.Queries.Count} 个 Query。双击一行可设置真实源，完全无关的样本点“设为无对应”。";
    }

    private void RefreshStatus()
    {
        var imageCount = _state.Queries.Count(q => q.Kind == QueryMediaKind.Image);
        var videoCount = _state.Queries.Count(q => q.Kind == QueryMediaKind.Video);
        _statusLabel.Text = $"图片 {imageCount}    视频 {videoCount}";
    }

    private void SetRunning(bool running)
    {
        _runButton.Enabled = !running;
        _cancelButton.Enabled = running;
        _grid.Enabled = !running;
        _imageLibrary.Enabled = !running;
        _videoLibrary.Enabled = !running;
    }

    private void AppendLog(string line)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => AppendLog(line)));
            return;
        }

        if (_log.TextLength > 100_000)
        {
            _log.Clear();
        }

        _log.AppendText(line + Environment.NewLine);
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }

    private void HandleDragEnter(object? sender, DragEventArgs eventArgs)
    {
        if (eventArgs.Data?.GetDataPresent(DataFormats.FileDrop) == true)
        {
            eventArgs.Effect = DragDropEffects.Copy;
        }
    }

    private void HandleDragDrop(object? sender, DragEventArgs eventArgs)
    {
        if (eventArgs.Data?.GetData(DataFormats.FileDrop) is not string[] files)
        {
            return;
        }

        var added = 0;

        foreach (var file in files.Where(File.Exists))
        {
            var extension = Path.GetExtension(file).ToLowerInvariant();
            if (ImageExtensions.Contains(extension))
            {
                AddQueryPath(file, QueryMediaKind.Image);
                added++;
            }
            else if (VideoExtensions.Contains(extension))
            {
                AddQueryPath(file, QueryMediaKind.Video);
                added++;
            }
        }

        if (added > 0)
        {
            SaveState();
            RefreshGrid();
            RefreshStatus();
        }
    }

    private static Panel CreateCard()
    {
        var card = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            Margin = new Padding(0, 6, 0, 6)
        };

        card.Paint += (_, eventArgs) =>
        {
            using var pen = new Pen(Color.FromArgb(223, 229, 238));
            eventArgs.Graphics.DrawRectangle(
                pen,
                0,
                0,
                Math.Max(0, card.ClientSize.Width - 1),
                Math.Max(0, card.ClientSize.Height - 1));
        };

        return card;
    }

    private Label CreateSectionTitle(string text) => new()
    {
        Text = text,
        AutoSize = true,
        Font = new Font(Font.FontFamily, 11F, FontStyle.Bold),
        ForeColor = Color.FromArgb(31, 42, 58)
    };

    private Label CreateMutedLabel(string text) => new()
    {
        Text = text,
        TextAlign = ContentAlignment.MiddleLeft,
        ForeColor = Color.FromArgb(82, 94, 112)
    };

    private static void ConfigurePathTextBox(TextBox textBox)
    {
        textBox.ReadOnly = true;
        textBox.BackColor = Color.FromArgb(248, 250, 253);
        textBox.BorderStyle = BorderStyle.FixedSingle;
    }

    private Button CreateSecondaryButton(string text)
    {
        var button = new Button
        {
            Text = text,
            AutoSize = false,
            Size = new Size(Math.Max(72, TextRenderer.MeasureText(text, Font).Width + 24), 32),
            BackColor = Color.White,
            ForeColor = Color.FromArgb(52, 66, 84),
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(210, 218, 230);
        return button;
    }

    private Button CreatePrimarySmallButton(string text)
    {
        var button = CreateSecondaryButton(text);
        button.BackColor = Color.FromArgb(232, 240, 252);
        button.ForeColor = Color.FromArgb(45, 104, 198);
        button.FlatAppearance.BorderColor = Color.FromArgb(188, 208, 239);
        return button;
    }
}
