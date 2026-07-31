using Microsoft.Win32;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;

namespace PersonalWorkbench;

public sealed class WorkspaceNode
{
    public WorkspaceNode(string path, bool placeholder = false)
    {
        FullPath = path;
        IsPlaceholder = placeholder;
        if (placeholder)
        {
            Name = string.Empty;
            return;
        }

        IsDirectory = Directory.Exists(path);
        Name = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(Name)) Name = path;
        Extension = IsDirectory ? string.Empty : Path.GetExtension(path).ToLowerInvariant();
        if (IsDirectory) Children.Add(Placeholder());
    }

    public string Name { get; }
    public string FullPath { get; }
    public string Extension { get; } = string.Empty;
    public bool IsPlaceholder { get; }
    public bool IsDirectory { get; }
    public bool IsPdf => !IsDirectory && Extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase);
    public bool IsMarkdown => !IsDirectory && Extension is ".md" or ".markdown";
    public bool IsLoaded { get; private set; }
    public bool IsExpanded { get; set; }
    public ObservableCollection<WorkspaceNode> Children { get; } = new();

    public void LoadChildren(bool showHidden)
    {
        if (IsPlaceholder || !IsDirectory || IsLoaded) return;
        Children.Clear();
        try
        {
            var directories = Directory.EnumerateDirectories(FullPath)
                .Where(path => (showHidden || !WorkspaceFileItem.IsHidden(path)) && !WorkspaceFileItem.IsIgnoredDirectory(path))
                .OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase);
            foreach (var directory in directories)
                Children.Add(new WorkspaceNode(directory));

            var files = Directory.EnumerateFiles(FullPath)
                .Where(path => (showHidden || !WorkspaceFileItem.IsHidden(path))
                               && WorkspaceControl.IsSupportedExtension(Path.GetExtension(path)))
                .OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase);
            foreach (var file in files)
                Children.Add(new WorkspaceNode(file));
        }
        catch (Exception ex)
        {
            App.Log("Workspace tree load failed: " + ex.Message);
        }
        IsLoaded = true;
    }

    private static WorkspaceNode Placeholder() => new(string.Empty, true);
}

public sealed class WorkspaceFileItem
{
    private WorkspaceFileItem(string path, bool isDirectory)
    {
        FullPath = path;
        IsDirectory = isDirectory;
        Name = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        Extension = isDirectory ? string.Empty : Path.GetExtension(path).ToLowerInvariant();
        try
        {
            if (isDirectory)
            {
                Modified = Directory.GetLastWriteTime(path);
            }
            else
            {
                var info = new FileInfo(path);
                Modified = info.LastWriteTime;
                Size = info.Length;
            }
        }
        catch { }
    }

    public string Name { get; }
    public string FullPath { get; }
    public string Extension { get; }
    public bool IsDirectory { get; }
    public long Size { get; }
    public DateTime Modified { get; }
    public string TypeLabel => IsDirectory ? "文件夹" : WorkspaceControl.GetTypeLabel(Extension);
    public string SizeLabel => IsDirectory ? string.Empty : FormatSize(Size);
    public string ModifiedLabel => Modified == default ? string.Empty : Modified.ToString("MM-dd HH:mm");
    public bool IsMarkdown => Extension is ".md" or ".markdown";
    public bool IsPdf => Extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase);
    public bool IsEditable => !IsDirectory && WorkspaceControl.IsEditableExtension(Extension);

    public static WorkspaceFileItem FromPath(string path) => new(path, Directory.Exists(path));

    public static bool IsHidden(string path)
    {
        try
        {
            var name = Path.GetFileName(path);
            return (File.GetAttributes(path) & FileAttributes.Hidden) != 0
                   || (!string.IsNullOrEmpty(name) && name.StartsWith('.'));
        }
        catch { return false; }
    }

    public static bool IsIgnoredDirectory(string path)
    {
        var name = Path.GetFileName(path);
        return name.Equals(".git", StringComparison.OrdinalIgnoreCase)
            || name.Equals("node_modules", StringComparison.OrdinalIgnoreCase)
            || name.Equals("__pycache__", StringComparison.OrdinalIgnoreCase)
            || name.Equals("bin", StringComparison.OrdinalIgnoreCase)
            || name.Equals("obj", StringComparison.OrdinalIgnoreCase);
    }

    private static string FormatSize(long bytes)
    {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024d).ToString("0.#") + " KB";
        if (bytes < 1024L * 1024 * 1024) return (bytes / 1024d / 1024d).ToString("0.#") + " MB";
        return (bytes / 1024d / 1024d / 1024d).ToString("0.##") + " GB";
    }
}

public sealed class RecentWorkspaceItem
{
    public RecentWorkspaceItem(string path) { FullPath = path; }
    public string FullPath { get; }
    public string Name => Path.GetFileName(FullPath);
    public string DirectoryName => Path.GetDirectoryName(FullPath) ?? string.Empty;
}

public partial class WorkspaceControl : UserControl
{
    private const long MaxEditableBytes = 5L * 1024 * 1024;
    private static readonly HashSet<string> MarkdownExtensions = new(StringComparer.OrdinalIgnoreCase) { ".md", ".markdown" };
    private static readonly HashSet<string> CodeExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".py", ".cs", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
        ".html", ".css", ".scss", ".sql", ".sh", ".bat", ".cmd", ".ps1", ".tex"
    };
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".csv",
        ".log", ".gitignore", ".env"
    };

    private readonly AppSettings _settings;
    private readonly DispatcherTimer _saveTimer;
    private readonly DispatcherTimer _previewTimer;
    private string _currentDirectory = string.Empty;
    private WorkspaceNode? _selectedNode;
    private string _currentFile = string.Empty;
    private string _lastSavedText = string.Empty;
    private bool _loadingDocument;
    private bool _loaded;
    private bool _dirty;

    public event EventHandler<TerminalOpenRequestEventArgs>? OpenTerminalRequested;
    public event EventHandler? OpenSettingsRequested;

    public WorkspaceControl() : this(AppSettings.Load()) { }

    public WorkspaceControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        _saveTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(900) };
        _saveTimer.Tick += async (_, _) =>
        {
            _saveTimer.Stop();
            if (_settings.WorkspaceAutoSave) await SaveCurrentAsync(false);
        };
        _previewTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(220) };
        _previewTimer.Tick += (_, _) =>
        {
            _previewTimer.Stop();
            UpdatePreview();
        };
        IsVisibleChanged += async (_, _) =>
        {
            if (IsVisible) await EnsureLoadedAsync();
        };
        Unloaded += async (_, _) =>
        {
            if (_settings.WorkspaceAutoSave) await SaveCurrentAsync(false);
        };
        ApplySettings();
    }

    public string CurrentDirectory => Directory.Exists(_currentDirectory) ? _currentDirectory : _settings.WorkspaceRoot;

    public void ApplySettings()
    {
        EditorBox.FontSize = _settings.WorkspaceEditorFontSize;
        AutoSaveBadgeText.Text = _settings.WorkspaceAutoSave ? "自动保存" : "手动保存";
        AutoSaveBadgeText.Foreground = _settings.WorkspaceAutoSave
            ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(47, 126, 96))
            : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(130, 101, 52));
        NormalizeRecentFiles();
    }

    public void InvalidateWorkspace()
    {
        _loaded = false;
        FolderTree.ItemsSource = null;
        _selectedNode = null;
        _currentDirectory = string.Empty;
        ExplorerTitleText.Text = "资源管理器";
        ExplorerCountText.Text = string.Empty;
        ApplySettings();
    }

    public async Task EnsureLoadedAsync()
    {
        if (_loaded) return;
        if (!Directory.Exists(_settings.WorkspaceRoot))
        {
            RootBadgeText.Text = "尚未选择目录";
            StatusText.Text = "请点击“选择目录”，或在设置中指定默认工作区。";
            return;
        }

        await LoadRootAsync(_settings.WorkspaceRoot);
        if (File.Exists(_settings.LastWorkspaceFile) && IsInsideRoot(_settings.LastWorkspaceFile))
            await OpenFileAsync(WorkspaceFileItem.FromPath(_settings.LastWorkspaceFile));
        _loaded = true;
    }

    private async Task LoadRootAsync(string root)
    {
        if (!await CommitBeforeNavigationAsync()) return;
        root = Path.GetFullPath(root);
        _settings.WorkspaceRoot = root;
        _settings.Save();
        _currentDirectory = root;
        SearchBox.Text = string.Empty;

        var node = new WorkspaceNode(root) { IsExpanded = true };
        node.LoadChildren(_settings.WorkspaceShowHiddenFiles);
        FolderTree.ItemsSource = new[] { node };
        RootBadgeText.Text = Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } name ? name : root;
        RootBadgeText.ToolTip = root;
        ExplorerTitleText.Text = "资源管理器";
        ExplorerCountText.Text = $"{node.Children.Count} 项";
        StatusText.Text = root;
        NormalizeRecentFiles();
    }

    private async Task LoadDirectoryAsync(string directory)
    {
        if (!Directory.Exists(directory)) return;
        if (!await CommitBeforeNavigationAsync()) return;
        _currentDirectory = Path.GetFullPath(directory);
        StatusText.Text = _currentDirectory;

        if (!Directory.Exists(_settings.WorkspaceRoot)
            || !IsInsideRoot(_currentDirectory + Path.DirectorySeparatorChar))
        {
            await LoadRootAsync(_currentDirectory);
            return;
        }

        ExplorerTitleText.Text = Path.GetFileName(_currentDirectory.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } name
            ? name
            : "资源管理器";
    }

    private async Task SearchWorkspaceAsync()
    {
        if (!Directory.Exists(_settings.WorkspaceRoot)) return;
        var query = SearchBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(query))
        {
            await LoadRootAsync(_settings.WorkspaceRoot);
            return;
        }

        StatusText.Text = "正在搜索工作区…";
        var filter = (TypeFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all";
        var results = await Task.Run(() => SearchFiles(_settings.WorkspaceRoot, query, filter, 1500));
        FolderTree.ItemsSource = results.Select(item => new WorkspaceNode(item.FullPath)).ToArray();
        ExplorerTitleText.Text = "搜索结果";
        ExplorerCountText.Text = $"{results.Count} 项";
        StatusText.Text = results.Count >= 1500 ? "已显示前 1500 项，请缩小关键词。" : $"找到 {results.Count} 项。";
    }

    private List<WorkspaceFileItem> SearchFiles(string root, string query, string filter, int limit)
    {
        var results = new List<WorkspaceFileItem>();
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0 && results.Count < limit)
        {
            var directory = stack.Pop();
            try
            {
                foreach (var child in Directory.EnumerateFileSystemEntries(directory))
                {
                    if (!_settings.WorkspaceShowHiddenFiles && WorkspaceFileItem.IsHidden(child)) continue;
                    if (Directory.Exists(child))
                    {
                        if (!WorkspaceFileItem.IsIgnoredDirectory(child)) stack.Push(child);
                        continue;
                    }

                    var item = WorkspaceFileItem.FromPath(child);
                    if (!MatchesFilter(item, filter)
                        || !item.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase)) continue;
                    results.Add(item);
                    if (results.Count >= limit) break;
                }
            }
            catch { }
        }
        return results.OrderByDescending(item => item.Modified).ToList();
    }

    private static bool MatchesFilter(WorkspaceFileItem item, string filter) => filter switch
    {
        "markdown" => item.IsMarkdown,
        "code" => CodeExtensions.Contains(item.Extension),
        "text" => TextExtensions.Contains(item.Extension),
        "pdf" => item.IsPdf,
        _ => IsSupportedExtension(item.Extension)
    };

    private async Task OpenFileAsync(WorkspaceFileItem item)
    {
        if (item.IsDirectory)
        {
            await LoadDirectoryAsync(item.FullPath);
            return;
        }
        if (!item.IsEditable || item.Size > MaxEditableBytes)
        {
            OpenExternal(item.FullPath);
            return;
        }
        if (!await CommitBeforeNavigationAsync()) return;

        try
        {
            _loadingDocument = true;
            var text = await File.ReadAllTextAsync(item.FullPath, Encoding.UTF8);
            _currentFile = item.FullPath;
            _currentDirectory = Path.GetDirectoryName(item.FullPath) ?? _settings.WorkspaceRoot;
            _settings.LastWorkspaceFile = item.FullPath;
            _lastSavedText = text;
            _dirty = false;
            EditorBox.Text = text;
            DocumentTitleText.Text = item.Name;
            DocumentPathText.Text = item.FullPath;
            SaveButton.IsEnabled = true;
            RevealFileButton.IsEnabled = true;
            EditorEmptyState.Visibility = Visibility.Collapsed;
            PreviewModeButton.IsEnabled = item.IsMarkdown;
            SplitModeButton.IsEnabled = item.IsMarkdown;
            if (!item.IsMarkdown) EditModeButton.IsChecked = true;
            UpdateEditorMode();
            UpdatePreview();
            AddRecent(item.FullPath);
            StatusText.Text = $"已打开 {item.Name} · {item.SizeLabel}";
            EncodingText.Text = "UTF-8";
        }
        catch (Exception ex)
        {
            App.Log("Workspace file open failed: " + ex);
            MessageBox.Show("无法打开文件：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            _loadingDocument = false;
        }
    }

    private async Task<bool> CommitBeforeNavigationAsync()
    {
        if (!_dirty || string.IsNullOrWhiteSpace(_currentFile)) return true;
        if (_settings.WorkspaceAutoSave)
        {
            await SaveCurrentAsync(false);
            return true;
        }

        var result = MessageBox.Show(
            "当前文件尚未保存。是否保存后继续？",
            "Personal Workbench",
            MessageBoxButton.YesNoCancel,
            MessageBoxImage.Question);
        if (result == MessageBoxResult.Cancel) return false;
        if (result == MessageBoxResult.Yes) await SaveCurrentAsync(true);
        return true;
    }

    private async Task SaveCurrentAsync(bool showStatus)
    {
        if (!_dirty || string.IsNullOrWhiteSpace(_currentFile) || !File.Exists(_currentFile)) return;
        try
        {
            var text = EditorBox.Text;
            await File.WriteAllTextAsync(_currentFile, text, new UTF8Encoding(false));
            _lastSavedText = text;
            _dirty = false;
            DocumentTitleText.Text = Path.GetFileName(_currentFile);
            if (showStatus || _settings.WorkspaceAutoSave)
                StatusText.Text = "已保存 · " + DateTime.Now.ToString("HH:mm:ss");
        }
        catch (Exception ex)
        {
            App.Log("Workspace save failed: " + ex);
            if (showStatus)
                MessageBox.Show("保存失败：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void AddRecent(string path)
    {
        _settings.RecentWorkspaceFiles.RemoveAll(item => string.Equals(item, path, StringComparison.OrdinalIgnoreCase));
        _settings.RecentWorkspaceFiles.Insert(0, path);
        NormalizeRecentFiles();
        _settings.Save();
    }

    private void NormalizeRecentFiles()
    {
        _settings.RecentWorkspaceFiles ??= new List<string>();
        _settings.RecentWorkspaceFiles = _settings.RecentWorkspaceFiles
            .Where(File.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(_settings.WorkspaceRecentLimit)
            .ToList();
    }

    private void UpdatePreview()
    {
        if (string.IsNullOrWhiteSpace(_currentFile)
            || !MarkdownExtensions.Contains(Path.GetExtension(_currentFile))) return;
        PreviewViewer.Document = MarkdownDocumentRenderer.Render(EditorBox.Text, Math.Max(12, _settings.WorkspaceEditorFontSize));
    }

    private void UpdateEditorMode()
    {
        var markdown = !string.IsNullOrWhiteSpace(_currentFile)
                       && MarkdownExtensions.Contains(Path.GetExtension(_currentFile));
        var preview = markdown && PreviewModeButton.IsChecked == true;
        var split = markdown && SplitModeButton.IsChecked == true;
        EditorColumn.Width = preview ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
        PreviewDividerColumn.Width = split ? new GridLength(5) : new GridLength(0);
        PreviewColumn.Width = preview || split ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        EditorBox.Visibility = preview ? Visibility.Collapsed : Visibility.Visible;
        PreviewSplitter.Visibility = split ? Visibility.Visible : Visibility.Collapsed;
        PreviewViewer.Visibility = preview || split ? Visibility.Visible : Visibility.Collapsed;
        if (preview || split) UpdatePreview();
    }

    public static bool IsSupportedExtension(string extension)
        => IsEditableExtension(extension) || extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase);

    public static bool IsEditableExtension(string extension)
        => MarkdownExtensions.Contains(extension) || CodeExtensions.Contains(extension) || TextExtensions.Contains(extension);

    public static string GetTypeLabel(string extension)
    {
        if (MarkdownExtensions.Contains(extension)) return "Markdown";
        if (CodeExtensions.Contains(extension)) return "代码";
        if (TextExtensions.Contains(extension)) return "文本";
        if (extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return "PDF";
        return string.IsNullOrWhiteSpace(extension) ? "文件" : extension.TrimStart('.').ToUpperInvariant();
    }

    private bool IsInsideRoot(string path)
    {
        try
        {
            var root = Path.GetFullPath(_settings.WorkspaceRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var candidate = Path.GetFullPath(path);
            return candidate.Equals(root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase)
                   || candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static void OpenExternal(string path)
    {
        try
        {
            if (Directory.Exists(path))
                Process.Start(new ProcessStartInfo("explorer.exe", path) { UseShellExecute = true });
            else
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show("无法调用外部程序：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void ChooseRoot_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "选择本地工作区目录", Multiselect = false };
        if (Directory.Exists(_settings.WorkspaceRoot)) dialog.InitialDirectory = _settings.WorkspaceRoot;
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;
        _loaded = false;
        await LoadRootAsync(dialog.FolderName);
        _loaded = true;
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        if (Directory.Exists(_settings.WorkspaceRoot)) await LoadRootAsync(_settings.WorkspaceRoot);
    }

    private async void NewNote_Click(object sender, RoutedEventArgs e)
    {
        var directory = Directory.Exists(CurrentDirectory) ? CurrentDirectory : _settings.WorkspaceRoot;
        if (!Directory.Exists(directory))
        {
            ChooseRoot_Click(sender, e);
            return;
        }

        var baseName = "Note " + DateTime.Now.ToString("yyyy-MM-dd HHmm");
        var path = Path.Combine(directory, baseName + ".md");
        var suffix = 2;
        while (File.Exists(path)) path = Path.Combine(directory, baseName + $" ({suffix++}).md");
        await File.WriteAllTextAsync(path, $"# {Path.GetFileNameWithoutExtension(path)}\n\n", new UTF8Encoding(false));
        await LoadRootAsync(_settings.WorkspaceRoot);
        await OpenFileAsync(WorkspaceFileItem.FromPath(path));
        EditorBox.Focus();
        EditorBox.CaretIndex = EditorBox.Text.Length;
    }

    private async void NewFolder_Click(object sender, RoutedEventArgs e)
    {
        var directory = Directory.Exists(CurrentDirectory) ? CurrentDirectory : _settings.WorkspaceRoot;
        if (!Directory.Exists(directory)) return;
        var path = Path.Combine(directory, "New Folder");
        var suffix = 2;
        while (Directory.Exists(path)) path = Path.Combine(directory, $"New Folder ({suffix++})");
        Directory.CreateDirectory(path);
        await LoadRootAsync(_settings.WorkspaceRoot);
    }

    private void OpenTerminal_Click(object sender, RoutedEventArgs e)
    {
        if (!Directory.Exists(CurrentDirectory)) return;
        OpenTerminalRequested?.Invoke(this, new TerminalOpenRequestEventArgs
        {
            Shell = _settings.DefaultShell,
            Title = Path.GetFileName(CurrentDirectory.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } name ? name : "Workspace",
            WorkingDirectory = CurrentDirectory
        });
    }

    private void RevealRoot_Click(object sender, RoutedEventArgs e)
    {
        var path = _selectedNode?.FullPath;
        if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
        else if (!string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
            Process.Start(new ProcessStartInfo("explorer.exe", path) { UseShellExecute = true });
        else if (Directory.Exists(_settings.WorkspaceRoot))
            Process.Start(new ProcessStartInfo("explorer.exe", _settings.WorkspaceRoot) { UseShellExecute = true });
        else
            OpenSettingsRequested?.Invoke(this, EventArgs.Empty);
    }

    private void RevealFile_Click(object sender, RoutedEventArgs e)
    {
        if (File.Exists(_currentFile))
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_currentFile}\"") { UseShellExecute = true });
    }

    private void OpenExternal_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedNode is { IsPlaceholder: false }) OpenExternal(_selectedNode.FullPath);
        else if (File.Exists(_currentFile)) OpenExternal(_currentFile);
    }

    private void FolderItem_Expanded(object sender, RoutedEventArgs e)
    {
        if (sender is TreeViewItem { DataContext: WorkspaceNode node })
        {
            node.LoadChildren(_settings.WorkspaceShowHiddenFiles);
            FolderTree.Items.Refresh();
            ExplorerCountText.Text = node.IsDirectory ? $"{node.Children.Count} 项" : ExplorerCountText.Text;
        }
    }

    private async void FolderTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is not WorkspaceNode { IsPlaceholder: false } node) return;
        _selectedNode = node;
        if (node.IsDirectory)
        {
            _currentDirectory = node.FullPath;
            ExplorerTitleText.Text = node.Name;
            ExplorerCountText.Text = node.IsLoaded ? $"{node.Children.Count} 项" : string.Empty;
            StatusText.Text = node.FullPath;
            return;
        }

        _currentDirectory = Path.GetDirectoryName(node.FullPath) ?? _settings.WorkspaceRoot;
        await OpenFileAsync(WorkspaceFileItem.FromPath(node.FullPath));
    }

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchWorkspaceAsync();

    private async void SearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            await SearchWorkspaceAsync();
        }
    }

    private async void TypeFilter_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (IsLoaded && !string.IsNullOrWhiteSpace(SearchBox.Text))
            await SearchWorkspaceAsync();
    }

    private void EditorMode_Changed(object sender, RoutedEventArgs e)
    {
        if (IsLoaded) UpdateEditorMode();
    }

    private void EditorBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_loadingDocument || string.IsNullOrWhiteSpace(_currentFile)) return;
        _dirty = !string.Equals(EditorBox.Text, _lastSavedText, StringComparison.Ordinal);
        DocumentTitleText.Text = Path.GetFileName(_currentFile) + (_dirty ? "  •" : string.Empty);
        _previewTimer.Stop();
        _previewTimer.Start();
        if (_settings.WorkspaceAutoSave)
        {
            _saveTimer.Stop();
            _saveTimer.Start();
        }
    }

    private async void EditorBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.S && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            e.Handled = true;
            await SaveCurrentAsync(true);
        }
    }

    private async void Save_Click(object sender, RoutedEventArgs e) => await SaveCurrentAsync(true);
}
