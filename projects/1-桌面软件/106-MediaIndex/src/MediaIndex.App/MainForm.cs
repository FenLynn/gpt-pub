using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace MediaIndex.App;

internal sealed class MainForm : Form
{
    private readonly AppStorage _storage = new();
    private readonly CoreRunner _core = new();
    private readonly AppSettings _settings;

    private readonly TextBox _libraryPath = new();
    private readonly Label _indexStatus = new();
    private readonly Button _buildButton = new();

    private readonly TextBox _queryPath = new();
    private readonly Button _queryButton = new();
    private readonly DataGridView _results = new();
    private readonly Label _queryStatus = new();

    private readonly Button _validationButton = new();
    private readonly Label _validationStatus = new();

    private readonly TextBox _log = new();
    private readonly ProgressBar _busy = new();
    private readonly Button _cancelButton = new();

    private CancellationTokenSource? _cts;

    public MainForm()
    {
        Text = "MediaIndex";
        Width = 1180;
        Height = 820;
        MinimumSize = new Size(980, 690);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(244, 247, 251);
        Font = new Font("Microsoft YaHei UI", 10F);
        AllowDrop = true;

        _settings = _storage.LoadSettings();

        BuildUi();
        LoadSettings();

        DragEnter += OnDragEnter;
        DragDrop += OnDragDrop;
        FormClosing += (_, _) => SaveSettings();
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            Padding = new Padding(26, 20, 26, 22)
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 74));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 154));
        Controls.Add(root);

        root.Controls.Add(BuildHeader(), 0, 0);

        var tabs = new TabControl
        {
            Dock = DockStyle.Fill,
            Font = new Font(Font.FontFamily, 10F),
            Padding = new Point(18, 8)
        };

        tabs.TabPages.Add(BuildLibraryTab());
        tabs.TabPages.Add(BuildQueryTab());
        tabs.TabPages.Add(BuildValidationTab());

        root.Controls.Add(tabs, 0, 1);
        root.Controls.Add(BuildBottom(), 0, 2);
    }

    private Control BuildHeader()
    {
        var panel = new Panel
        {
            Dock = DockStyle.Fill
        };

        var title = new Label
        {
            Text = "MediaIndex",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 19F, FontStyle.Bold),
            ForeColor = Color.FromArgb(28, 39, 55),
            Location = new Point(0, 1)
        };
        panel.Controls.Add(title);

        var subtitle = new Label
        {
            Text = "给一张图片，快速判断库存里是否已经存在同源素材，并返回真实路径。",
            AutoSize = true,
            ForeColor = Color.FromArgb(92, 104, 121),
            Location = new Point(2, 42)
        };
        panel.Controls.Add(subtitle);

        var preview = new Label
        {
            Text = "v0.3.0 Preview",
            AutoSize = true,
            Font = new Font(Font.FontFamily, 9F, FontStyle.Bold),
            ForeColor = Color.FromArgb(61, 120, 220),
            Anchor = AnchorStyles.Top | AnchorStyles.Right
        };
        panel.Controls.Add(preview);

        panel.Resize += (_, _) =>
        {
            preview.Left = panel.ClientSize.Width - preview.PreferredWidth;
            preview.Top = 10;
        };

        return panel;
    }

    private TabPage BuildLibraryTab()
    {
        var page = new TabPage("图库索引")
        {
            BackColor = Color.FromArgb(248, 250, 253),
            Padding = new Padding(20)
        };

        var card = CreateCard();
        card.Dock = DockStyle.Top;
        card.Height = 220;
        page.Controls.Add(card);

        var title = CreateSectionTitle("1  选择图片库存并建立索引");
        title.Location = new Point(24, 20);
        card.Controls.Add(title);

        var help = new Label
        {
            Text = "原有目录不会被移动或整理。索引保存在本机 AppData，可重复增量更新。",
            AutoSize = true,
            ForeColor = Color.FromArgb(92, 104, 121),
            Location = new Point(25, 52)
        };
        card.Controls.Add(help);

        var label = new Label
        {
            Text = "图片库存",
            AutoSize = true,
            Location = new Point(25, 96),
            ForeColor = Color.FromArgb(70, 82, 100)
        };
        card.Controls.Add(label);

        _libraryPath.ReadOnly = true;
        _libraryPath.BackColor = Color.White;
        _libraryPath.BorderStyle = BorderStyle.FixedSingle;
        _libraryPath.Location = new Point(112, 91);
        _libraryPath.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        card.Controls.Add(_libraryPath);

        var choose = SecondaryButton("选择目录");
        choose.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        choose.Click += (_, _) => ChooseLibrary();
        card.Controls.Add(choose);

        _buildButton.Text = "建立 / 更新索引";
        _buildButton.BackColor = Color.FromArgb(61, 120, 220);
        _buildButton.ForeColor = Color.White;
        _buildButton.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);
        _buildButton.FlatStyle = FlatStyle.Flat;
        _buildButton.FlatAppearance.BorderSize = 0;
        _buildButton.Size = new Size(160, 40);
        _buildButton.Location = new Point(112, 140);
        _buildButton.Click += async (_, _) => await BuildIndexAsync();
        card.Controls.Add(_buildButton);

        _indexStatus.AutoSize = true;
        _indexStatus.ForeColor = Color.FromArgb(92, 104, 121);
        _indexStatus.Location = new Point(288, 151);
        card.Controls.Add(_indexStatus);

        card.Resize += (_, _) =>
        {
            choose.Size = new Size(88, 32);
            choose.Left = card.ClientSize.Width - choose.Width - 24;
            choose.Top = 90;
            _libraryPath.Width = Math.Max(
                240,
                choose.Left - _libraryPath.Left - 12);
        };

        var tips = CreateCard();
        tips.Dock = DockStyle.Top;
        tips.Height = 165;
        tips.Top = 240;
        page.Controls.Add(tips);
        tips.BringToFront();

        var tipsTitle = CreateSectionTitle("当前 Preview 能做什么");
        tipsTitle.Location = new Point(24, 18);
        tips.Controls.Add(tipsTitle);

        var tipsText = new Label
        {
            AutoSize = false,
            Location = new Point(25, 52),
            Size = new Size(880, 100),
            ForeColor = Color.FromArgb(72, 84, 102),
            Text =
                "• 递归扫描 JPG、PNG、WebP、TIFF、HEIC / HEIF 等常见图片。\r\n"
                + "• 同时建立持久 pHash Lane A 与 local-feature Lane B。\r\n"
                + "• 小规模变更写入 delta overlay，无变化时零重建；达到阈值才 compact。\r\n"
                + "• 原盘暂时离线时，仍可利用持久索引产生候选，在线时再做深度验证。"
        };
        tips.Controls.Add(tipsText);

        return page;
    }

    private TabPage BuildQueryTab()
    {
        var page = new TabPage("图片查询")
        {
            BackColor = Color.FromArgb(248, 250, 253),
            Padding = new Padding(20)
        };

        var top = CreateCard();
        top.Dock = DockStyle.Top;
        top.Height = 150;
        page.Controls.Add(top);

        var title = CreateSectionTitle("2  拖入或选择一张图片");
        title.Location = new Point(24, 20);
        top.Controls.Add(title);

        _queryPath.ReadOnly = true;
        _queryPath.BackColor = Color.White;
        _queryPath.BorderStyle = BorderStyle.FixedSingle;
        _queryPath.Location = new Point(25, 61);
        _queryPath.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        top.Controls.Add(_queryPath);

        var choose = SecondaryButton("选择图片");
        choose.Click += (_, _) => ChooseQueryImage();
        choose.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        top.Controls.Add(choose);

        _queryButton.Text = "查询库存";
        _queryButton.BackColor = Color.FromArgb(61, 120, 220);
        _queryButton.ForeColor = Color.White;
        _queryButton.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);
        _queryButton.FlatStyle = FlatStyle.Flat;
        _queryButton.FlatAppearance.BorderSize = 0;
        _queryButton.Location = new Point(25, 101);
        _queryButton.Size = new Size(132, 36);
        _queryButton.Click += async (_, _) => await QueryAsync();
        top.Controls.Add(_queryButton);

        _queryStatus.AutoSize = true;
        _queryStatus.ForeColor = Color.FromArgb(92, 104, 121);
        _queryStatus.Location = new Point(175, 110);
        top.Controls.Add(_queryStatus);

        top.Resize += (_, _) =>
        {
            choose.Size = new Size(88, 32);
            choose.Left = top.ClientSize.Width - choose.Width - 24;
            choose.Top = 60;
            _queryPath.Width = Math.Max(
                240,
                choose.Left - _queryPath.Left - 12);
        };

        ConfigureResultsGrid();
        _results.Dock = DockStyle.Fill;
        _results.Margin = new Padding(0, 14, 0, 0);
        page.Controls.Add(_results);
        _results.BringToFront();

        return page;
    }

    private TabPage BuildValidationTab()
    {
        var page = new TabPage("自动验收")
        {
            BackColor = Color.FromArgb(248, 250, 253),
            Padding = new Padding(20)
        };

        var card = CreateCard();
        card.Dock = DockStyle.Top;
        card.Height = 225;
        page.Controls.Add(card);

        var title = CreateSectionTitle("算法自动验收");
        title.Location = new Point(24, 20);
        card.Controls.Add(title);

        var help = new Label
        {
            AutoSize = false,
            Location = new Point(25, 54),
            Size = new Size(900, 80),
            ForeColor = Color.FromArgb(80, 92, 109),
            Text =
                "程序会从当前真实图片库存自动抽样，生成重压缩、缩放、裁剪、水印和负样本。\r\n"
                + "这用于检查算法回归，不需要手工设置标准答案。"
        };
        card.Controls.Add(help);

        _validationButton.Text = "运行自动验收";
        _validationButton.BackColor = Color.FromArgb(61, 120, 220);
        _validationButton.ForeColor = Color.White;
        _validationButton.FlatStyle = FlatStyle.Flat;
        _validationButton.FlatAppearance.BorderSize = 0;
        _validationButton.Size = new Size(150, 40);
        _validationButton.Location = new Point(25, 136);
        _validationButton.Click += async (_, _) => await ValidateAsync();
        card.Controls.Add(_validationButton);

        _validationStatus.AutoSize = true;
        _validationStatus.Location = new Point(192, 148);
        _validationStatus.ForeColor = Color.FromArgb(92, 104, 121);
        card.Controls.Add(_validationStatus);

        var note = new Label
        {
            AutoSize = false,
            Location = new Point(25, 184),
            Size = new Size(940, 28),
            ForeColor = Color.FromArgb(110, 120, 134),
            Text = "内置 CI 另外还有 known hard-negative 套件，正式构建只有在该套件通过后才会生成。"
        };
        card.Controls.Add(note);

        return page;
    }

    private Control BuildBottom()
    {
        var panel = CreateCard();
        panel.Margin = new Padding(0, 10, 0, 0);

        _busy.Style = ProgressBarStyle.Marquee;
        _busy.MarqueeAnimationSpeed = 24;
        _busy.Visible = false;
        _busy.Location = new Point(20, 20);
        _busy.Size = new Size(430, 16);
        panel.Controls.Add(_busy);

        _cancelButton.Text = "停止";
        _cancelButton.Enabled = false;
        _cancelButton.FlatStyle = FlatStyle.Flat;
        _cancelButton.Location = new Point(465, 13);
        _cancelButton.Size = new Size(72, 32);
        _cancelButton.Click += (_, _) => _cts?.Cancel();
        panel.Controls.Add(_cancelButton);

        _log.Multiline = true;
        _log.ReadOnly = true;
        _log.ScrollBars = ScrollBars.Vertical;
        _log.BackColor = Color.FromArgb(250, 252, 255);
        _log.BorderStyle = BorderStyle.FixedSingle;
        _log.Font = new Font("Consolas", 8.5F);
        _log.Location = new Point(20, 52);
        _log.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        panel.Controls.Add(_log);

        panel.Resize += (_, _) =>
        {
            _log.Size = new Size(
                Math.Max(200, panel.ClientSize.Width - 40),
                Math.Max(60, panel.ClientSize.Height - 66));
        };

        return panel;
    }

    private void ConfigureResultsGrid()
    {
        _results.AllowUserToAddRows = false;
        _results.AllowUserToDeleteRows = false;
        _results.AllowUserToResizeRows = false;
        _results.ReadOnly = true;
        _results.RowHeadersVisible = false;
        _results.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _results.MultiSelect = false;
        _results.AutoGenerateColumns = false;
        _results.BackgroundColor = Color.White;
        _results.BorderStyle = BorderStyle.None;
        _results.CellBorderStyle = DataGridViewCellBorderStyle.SingleHorizontal;
        _results.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.None;
        _results.ColumnHeadersHeight = 36;
        _results.RowTemplate.Height = 36;
        _results.EnableHeadersVisualStyles = false;
        _results.ColumnHeadersDefaultCellStyle.BackColor = Color.FromArgb(244, 247, 251);
        _results.ColumnHeadersDefaultCellStyle.ForeColor = Color.FromArgb(72, 84, 102);
        _results.DefaultCellStyle.SelectionBackColor = Color.FromArgb(229, 238, 252);
        _results.DefaultCellStyle.SelectionForeColor = Color.FromArgb(31, 42, 58);

        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Rank",
            HeaderText = "#",
            Width = 42
        });
        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Confidence",
            HeaderText = "判断",
            Width = 92
        });
        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Lane",
            HeaderText = "候选路",
            Width = 72
        });
        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "File",
            HeaderText = "库存文件",
            AutoSizeMode = DataGridViewAutoSizeColumnMode.Fill,
            FillWeight = 55
        });
        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Distance",
            HeaderText = "pHash",
            Width = 70
        });
        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Inliers",
            HeaderText = "Inliers",
            Width = 70
        });
        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Ncc",
            HeaderText = "NCC",
            Width = 68
        });
        _results.Columns.Add(new DataGridViewTextBoxColumn
        {
            Name = "Online",
            HeaderText = "在线",
            Width = 58
        });

        _results.CellDoubleClick += (_, e) =>
        {
            if (e.RowIndex < 0)
            {
                return;
            }

            var path = _results.Rows[e.RowIndex].Tag as string;
            if (string.IsNullOrWhiteSpace(path))
            {
                return;
            }

            try
            {
                if (File.Exists(path))
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = "explorer.exe",
                        Arguments = $"/select,\"{path}\"",
                        UseShellExecute = true
                    });
                }
                else
                {
                    var folder = Path.GetDirectoryName(path);
                    if (!string.IsNullOrWhiteSpace(folder)
                        && Directory.Exists(folder))
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = folder,
                            UseShellExecute = true
                        });
                    }
                }
            }
            catch
            {
            }
        };
    }

    private void ChooseLibrary()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择图片库存根目录",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false
        };

        if (Directory.Exists(_settings.ImageLibraryPath))
        {
            dialog.SelectedPath = _settings.ImageLibraryPath;
        }

        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        _settings.ImageLibraryPath = dialog.SelectedPath;
        _libraryPath.Text = dialog.SelectedPath;
        SaveSettings();
        UpdateIndexStatus();
    }

    private void ChooseQueryImage()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "选择需要查库存的图片",
            Filter = "图片|*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.tif;*.tiff;*.heic;*.heif|所有文件|*.*"
        };

        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        _queryPath.Text = dialog.FileName;
        _queryStatus.Text = string.Empty;
        _results.Rows.Clear();
    }

    private async Task BuildIndexAsync()
    {
        var library = _libraryPath.Text.Trim();

        if (!Directory.Exists(library))
        {
            MessageBox.Show(
                this,
                "请先选择有效的图片库存目录。",
                "MediaIndex",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        var indexDir = _storage.IndexDirectoryFor(library);
        var output = _storage.NewResultPath("index-build");

        await RunBusyAsync(
            async (progress, token) =>
            {
                AppendLog("开始建立 / 更新图片索引...");

                var exit = await _core.BuildIndexAsync(
                    library,
                    indexDir,
                    output,
                    progress,
                    token);

                if (exit != 0)
                {
                    throw new InvalidOperationException(
                        $"索引进程退出码：{exit}");
                }

                var result = JsonSerializer.Deserialize<IndexBuildResult>(
                    File.ReadAllText(output),
                    JsonModel.Options)
                    ?? throw new InvalidOperationException(
                        "无法读取索引结果。");

                _indexStatus.Text =
                    $"已索引 {result.Images:N0} 张，新增 {result.Added:N0}，"
                    + $"更新 {result.Updated:N0}，复用 {result.Reused:N0}，"
                    + $"耗时 {result.Seconds:0.0}s";

                AppendLog("索引完成。");
            });
    }

    private async Task QueryAsync()
    {
        var library = _libraryPath.Text.Trim();
        var query = _queryPath.Text.Trim();

        if (string.IsNullOrWhiteSpace(library))
        {
            MessageBox.Show(this, "请先选择图片库存。", "MediaIndex");
            return;
        }

        if (!File.Exists(query))
        {
            MessageBox.Show(this, "请先选择一张查询图片。", "MediaIndex");
            return;
        }

        var indexDir = _storage.IndexDirectoryFor(library);

        if (!File.Exists(Path.Combine(indexDir, "index.sqlite3")))
        {
            var answer = MessageBox.Show(
                this,
                "当前库存还没有持久索引。现在建立？",
                "MediaIndex",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);

            if (answer != DialogResult.Yes)
            {
                return;
            }

            await BuildIndexAsync();

            if (!File.Exists(Path.Combine(indexDir, "index.sqlite3")))
            {
                return;
            }
        }

        var output = _storage.NewResultPath("query");

        await RunBusyAsync(
            async (progress, token) =>
            {
                _results.Rows.Clear();
                _queryStatus.Text = "查询中...";
                AppendLog("开始查询库存...");

                var exit = await _core.QueryImageAsync(
                    indexDir,
                    query,
                    output,
                    progress,
                    token);

                if (exit != 0)
                {
                    throw new InvalidOperationException(
                        $"查询进程退出码：{exit}");
                }

                var result = JsonSerializer.Deserialize<QueryResult>(
                    File.ReadAllText(output),
                    JsonModel.Options)
                    ?? throw new InvalidOperationException(
                        "无法读取查询结果。");

                foreach (var hit in result.Results)
                {
                    var rowIndex = _results.Rows.Add(
                        hit.Rank,
                        hit.Confidence,
                        hit.CandidateLane,
                        hit.Relpath,
                        hit.PhashDistance,
                        hit.Inliers.ToString("0"),
                        hit.Ncc.ToString("0.000"),
                        hit.Online ? "是" : "否");

                    _results.Rows[rowIndex].Tag = hit.Path;
                    _results.Rows[rowIndex]
                        .Cells["File"]
                        .ToolTipText = hit.Path;
                }

                var best = result.Results.FirstOrDefault();

                _queryStatus.Text = best is null
                    ? $"未找到候选，耗时 {result.TotalMs:0} ms"
                    : $"第一候选：{best.Confidence}，"
                        + $"{best.Relpath}，总耗时 {result.TotalMs:0} ms";

                AppendLog(
                    $"查询完成，候选层 {result.CandidateMs:0.0} ms，"
                    + $"总耗时 {result.TotalMs:0.0} ms。");
            });
    }

    private async Task ValidateAsync()
    {
        var library = _libraryPath.Text.Trim();

        if (!Directory.Exists(library))
        {
            MessageBox.Show(
                this,
                "请先选择图片库存。",
                "MediaIndex");
            return;
        }

        var workDir = _storage.NewValidationDirectory();

        await RunBusyAsync(
            async (progress, token) =>
            {
                _validationStatus.Text = "自动验收中...";
                AppendLog("开始自动算法验收...");

                var exit = await _core.RunAutoValidationAsync(
                    library,
                    workDir,
                    progress,
                    token);

                if (exit != 0)
                {
                    throw new InvalidOperationException(
                        $"自动验收退出码：{exit}");
                }

                var summaryPath = Path.Combine(
                    workDir,
                    "auto_smoke_summary.json");

                using var document = JsonDocument.Parse(
                    File.ReadAllText(summaryPath));

                var root = document.RootElement;
                var image = root.GetProperty("image");

                var top1 = image
                    .GetProperty("top1_accuracy_positive")
                    .GetDouble();

                var top50 = image
                    .GetProperty("candidate_topk_recall")
                    .GetDouble();

                var falseConfirmed = image
                    .GetProperty("false_confirmed_count_baseline")
                    .GetInt32();

                _validationStatus.Text =
                    $"Top1 {top1 * 100:0.0}%    "
                    + $"Top50 {top50 * 100:0.0}%    "
                    + $"负样本误确认 {falseConfirmed}";

                AppendLog("自动验收完成。");
            });
    }

    private async Task RunBusyAsync(
        Func<IProgress<string>, CancellationToken, Task> action)
    {
        if (_cts is not null)
        {
            return;
        }

        _cts = new CancellationTokenSource();
        SetBusy(true);

        var progress = new Progress<string>(AppendLog);

        try
        {
            await action(progress, _cts.Token);
        }
        catch (OperationCanceledException)
        {
            AppendLog("已停止。");
        }
        catch (Exception exception)
        {
            AppendLog("ERROR: " + exception.Message);
            MessageBox.Show(
                this,
                exception.Message,
                "MediaIndex",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        finally
        {
            _cts.Dispose();
            _cts = null;
            SetBusy(false);
        }
    }

    private void SetBusy(bool busy)
    {
        _busy.Visible = busy;
        _cancelButton.Enabled = busy;
        _buildButton.Enabled = !busy;
        _queryButton.Enabled = !busy;
        _validationButton.Enabled = !busy;
    }

    private void LoadSettings()
    {
        _libraryPath.Text = _settings.ImageLibraryPath;
        UpdateIndexStatus();
    }

    private void SaveSettings()
    {
        _settings.ImageLibraryPath = _libraryPath.Text.Trim();
        _storage.SaveSettings(_settings);
    }

    private void UpdateIndexStatus()
    {
        var library = _libraryPath.Text.Trim();

        if (string.IsNullOrWhiteSpace(library))
        {
            _indexStatus.Text = "尚未选择库存。";
            return;
        }

        var indexDir = _storage.IndexDirectoryFor(library);
        var database = Path.Combine(indexDir, "index.sqlite3");

        _indexStatus.Text = File.Exists(database)
            ? "检测到已有持久索引，可直接查询或点击更新。"
            : "尚未建立索引。";
    }

    private void OnDragEnter(object? sender, DragEventArgs e)
    {
        if (e.Data?.GetDataPresent(DataFormats.FileDrop) == true)
        {
            e.Effect = DragDropEffects.Copy;
        }
    }

    private void OnDragDrop(object? sender, DragEventArgs e)
    {
        if (e.Data?.GetData(DataFormats.FileDrop) is not string[] files)
        {
            return;
        }

        var first = files.FirstOrDefault(File.Exists);
        if (string.IsNullOrWhiteSpace(first))
        {
            return;
        }

        var extension = Path.GetExtension(first).ToLowerInvariant();

        if (new[]
            {
                ".jpg", ".jpeg", ".png", ".webp", ".bmp",
                ".tif", ".tiff", ".heic", ".heif"
            }
            .Contains(extension))
        {
            _queryPath.Text = first;
            _queryStatus.Text = "已接收拖入图片，点击“查询库存”。";
            _results.Rows.Clear();
        }
    }

    private void AppendLog(string line)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => AppendLog(line)));
            return;
        }

        if (_log.TextLength > 120_000)
        {
            _log.Clear();
        }

        _log.AppendText(line + Environment.NewLine);
        _log.SelectionStart = _log.TextLength;
        _log.ScrollToCaret();
    }

    private Panel CreateCard()
    {
        var panel = new Panel
        {
            BackColor = Color.White
        };

        panel.Paint += (_, e) =>
        {
            using var pen = new Pen(
                Color.FromArgb(223, 229, 238));
            e.Graphics.DrawRectangle(
                pen,
                0,
                0,
                Math.Max(0, panel.ClientSize.Width - 1),
                Math.Max(0, panel.ClientSize.Height - 1));
        };

        return panel;
    }

    private Label CreateSectionTitle(string text) => new()
    {
        Text = text,
        AutoSize = true,
        Font = new Font(
            Font.FontFamily,
            11F,
            FontStyle.Bold),
        ForeColor = Color.FromArgb(31, 42, 58)
    };

    private Button SecondaryButton(string text)
    {
        var button = new Button
        {
            Text = text,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(52, 66, 84),
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand
        };
        button.FlatAppearance.BorderColor =
            Color.FromArgb(210, 218, 230);
        return button;
    }
}
