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
        Name = placeholder ? string.Empty : Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (string.IsNullOrWhiteSpace(Name) && !placeholder) Name = path;
        if (!placeholder) Children.Add(Placeholder());
    }

    public string Name { get; }
    public string FullPath { get; }
    public bool IsPlaceholder { get; }
    public bool IsLoaded { get; private set; }
    public bool IsExpanded { get; set; }
    public ObservableCollection<WorkspaceNode> Children { get; } = new();

    public void LoadChildren(bool showHidden)
    {
        if (IsPlaceholder || IsLoaded) return;
        Children.Clear();
        try
        {
            foreach (var directory in Directory.EnumerateDirectories(FullPath).OrderBy(path => Path.GetFileName(path), StringComparer.CurrentCultureIgnoreCase))
            {
                if (!showHidden && WorkspaceFileItem.IsHidden(directory)) continue;
                if (WorkspaceFileItem.IsIgnoredDirectory(directory)) continue;
                Children.Add(new WorkspaceNode(directory));
            }
        }
        catch (Exception ex) { App.Log("Workspace tree load failed: " + ex.Message); }
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
                Size = 0;
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
    public bool IsPdf => Extension == ".pdf";
    public bool IsEditable => !IsDirectory && WorkspaceControl.IsEditableExtension(Extension);

    public static WorkspaceFileItem FromPath(string path) => new(path, Directory.Exists(path));

    public static bool IsHidden(string path)
    {
        try { return (File.GetAttributes(path) & FileAttributes.Hidden) != 0 || Path.GetFileName(path).StartsWith('.'); }
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
    private static readonly HashSet<string> CodeExtensions = new(StringComparer.OrdinalIgnoreCase) { ".py", ".cs", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp", ".html", ".css", ".scss", ".sql", ".sh", ".bat", ".cmd", ".ps1", ".tex" };
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase) { ".txt", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".xml", ".csv", ".log", ".gitignore", ".env" };

    private readonly AppSettings _settings;
    private readonly DispatcherTimer _saveTimer;
    private readonly DispatcherTimer _previewTimer;
    private string _currentDirectory = string.Empty;
    private WorkspaceFileItem? _selectedItem;
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
        _saveTimer.Tick += async (_, _) => { _saveTimer.Stop(); if (_settings.WorkspaceAutoSave) await SaveCurrentAsync(false); };
        _previewTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(220) };
        _previewTimer.Tick += (_, _) => { _previewTimer.Stop(); UpdatePreview(); };
        IsVisibleChanged += async (_, _) => { if (IsVisible) await EnsureLoadedAsync(); };
        Unloaded += async (_, _) => { if (_settings.WorkspaceAutoSave) await SaveCurrentAsync(false); };
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
        RefreshRecentFiles();
    }

    public void InvalidateWorkspace()
    {
        _loaded = false;
        FolderTree.ItemsSource = null;
        FileList.ItemsSource = null;
        _currentDirectory = string.Empty;
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
        root = Path.GetFullPath(root);
        _settings.WorkspaceRoot = root;
        _settings.Save();
        var node = new WorkspaceNode(root) { IsExpanded = true };
        node.LoadChildren(_settings.WorkspaceShowHiddenFiles);
        FolderTree.ItemsSource = new[] { node };
        RootBadgeText.Text = Path.GetFileName(root.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } name ? name : root;
        RootBadgeText.ToolTip = root;
        await LoadDirectoryAsync(root);
        RefreshRecentFiles();
    }

    private async Task LoadDirectoryAsync(string directory)
    {
        if (!Directory.Exists(directory)) return;
        if (!await CommitBeforeNavigationAsync()) return;
        _currentDirectory = directory;
        FolderTitleText.Text = Path.GetFileName(directory.TrimEnd(Path.DirectorySeparatorChar)) is { Length: > 0 } name ? name : directory;
        FolderTitleText.ToolTip = directory;
        var items = await Task.Run(() => EnumerateDirectory(directory));
        FileList.ItemsSource = items;
        ItemCountText.Text = $"{items.Count} 项";
        StatusText.Text = directory;
    }

    private List<WorkspaceFileItem> EnumerateDirectory(string directory)
    {
        var result = new List<WorkspaceFileItem>();
        try
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                if (!_settings.WorkspaceShowHiddenFiles && WorkspaceFileItem.IsHidden(path)) continue;
                var item = WorkspaceFileItem.FromPath(path);
                if (item.IsDirectory)
                {
                    if (!WorkspaceFileItem.IsIgnoredDirectory(path)) result.Add(item);
                    continue;
                }
                if (IsSupported(item.Extension)) result.Add(item);
            }
        }
        catch (Exception ex) { App.Log("Workspace directory enumeration failed: " + ex); }
        return result.OrderByDescending(item => item.IsDirectory).ThenBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
    }

    private async Task SearchWorkspaceAsync()
    {
        if (!Directory.Exists(_settings.WorkspaceRoot)) return;
        var query = SearchBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(query))
        {
            await LoadDirectoryAsync(Directory.Exists(_currentDirectory) ? _currentDirectory : _settings.WorkspaceRoot);
            return;
        }
        StatusText.Text = "正在搜索工作区…";
        var filter = (TypeFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all";
        var results = await Task.Run(() => SearchFiles(_settings.WorkspaceRoot, query, filter, 1500));
        FileList.ItemsSource = results;
        FolderTitleText.Text = "搜索结果";
        ItemCountText.Text = $"{results.Count} 项";
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
                    if (!MatchesFilter(item, filter) || !item.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase)) continue;
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
        _ => IsSupported(item.Extension)
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
        finally { _loadingDocument = false; }
    }

    private async Task<bool> CommitBeforeNavigationAsync()
    {
        if (!_dirty || string.IsNullOrWhiteSpace(_currentFile)) return true;
        if (_settings.WorkspaceAutoSave)
        {
            await SaveCurrentAsync(false);
            return true;
        }
        var result = MessageBox.Show("当前文件尚未保存。是否保存后继续？", "Personal Workbench", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
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
            if (showStatus || _settings.WorkspaceAutoSave) StatusText.Text = "已保存 · " + DateTime.Now.ToString("HH:mm:ss");
        }
        catch (Exception ex)
        {
            App.Log("Workspace save failed: " + ex);
            if (showStatus) MessageBox.Show("保存失败：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void AddRecent(string path)
    {
        _settings.RecentWorkspaceFiles.RemoveAll(item => string.Equals(item, path, StringComparison.OrdinalIgnoreCase));
        _settings.RecentWorkspaceFiles.Insert(0, path);
        _settings.RecentWorkspaceFiles = _settings.RecentWorkspaceFiles.Where(File.Exists).Take(_settings.WorkspaceRecentLimit).ToList();
        _settings.Save();
        RefreshRecentFiles();
    }

    private void RefreshRecentFiles()
    {
        _settings.RecentWorkspaceFiles ??= new List<string>();
        RecentFilesList.ItemsSource = _settings.RecentWorkspaceFiles.Where(File.Exists).Take(_settings.WorkspaceRecentLimit).Select(path => new RecentWorkspaceItem(path)).ToList();
    }

    private void UpdatePreview()
    {
        if (string.IsNullOrWhiteSpace(_currentFile) || !MarkdownExtensions.Contains(Path.GetExtension(_currentFile))) return;
        PreviewViewer.Document = MarkdownDocumentRenderer.Render(EditorBox.Text, Math.Max(12, _settings.WorkspaceEditorFontSize));
    }

    private void UpdateEditorMode()
    {
        var markdown = !string.IsNullOrWhiteSpace(_currentFile) && MarkdownExtensions.Contains(Path.GetExtension(_currentFile));
        var preview = markdown && PreviewModeButton.IsChecked == true;
        var split = markdown && SplitModeButton.IsChecked == true;
        EditorColumn.Width = preview ? new GridLength(0) : split ? new GridLength(1, GridUnitType.Star) : new GridLength(1, GridUnitType.Star);
        PreviewDividerColumn.Width = split ? new GridLength(5) : new GridLength(0);
        PreviewColumn.Width = preview ? new GridLength(1, GridUnitType.Star) : split ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        EditorBox.Visibility = preview ? Visibility.Collapsed : Visibility.Visible;
        PreviewSplitter.Visibility = split ? Visibility.Visible : Visibility.Collapsed;
        PreviewViewer.Visibility = preview || split ? Visibility.Visible : Visibility.Collapsed;
        if (preview || split) UpdatePreview();
    }

    private static bool IsSupported(string extension) => IsEditableExtension(extension) || extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase);
    public static bool IsEditableExtension(string extension) => MarkdownExtensions.Contains(extension) || CodeExtensions.Contains(extension) || TextExtensions.Contains(extension);
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
            return Path.GetFullPath(path).StartsWith(root, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    private static void OpenExternal(string path)
    {
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); }
        catch (Exception ex) { MessageBox.Show("无法调用外部程序：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error); }
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
        if (!Directory.Exists(directory)) { ChooseRoot_Click(sender, e); return; }
        var baseName = "Note " + DateTime.Now.ToString("yyyy-MM-dd HHmm");
        var path = Path.Combine(directory, baseName + ".md");
        var suffix = 2;
        while (File.Exists(path)) path = Path.Combine(directory, baseName + $" ({suffix++}).md");
        await File.WriteAllTextAsync(path, $"# {Path.GetFileNameWithoutExtension(path)}\n\n", new UTF8Encoding(false));
        await LoadDirectoryAsync(directory);
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
        await LoadDirectoryAsync(directory);
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
        if (Directory.Exists(_settings.WorkspaceRoot)) Process.Start(new ProcessStartInfo("explorer.exe", _settings.WorkspaceRoot) { UseShellExecute = true });
        else OpenSettingsRequested?.Invoke(this, EventArgs.Empty);
    }

    private void RevealFile_Click(object sender, RoutedEventArgs e)
    {
        if (File.Exists(_currentFile)) Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{_currentFile}\"") { UseShellExecute = true });
    }

    private void OpenExternal_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedItem is not null) OpenExternal(_selectedItem.FullPath);
        else if (File.Exists(_currentFile)) OpenExternal(_currentFile);
    }

    private async void FolderItem_Expanded(object sender, RoutedEventArgs e)
    {
        if (sender is TreeViewItem { DataContext: WorkspaceNode node })
        {
            await Task.Run(() => node.LoadChildren(_settings.WorkspaceShowHiddenFiles));
            FolderTree.Items.Refresh();
        }
    }

    private async void FolderTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is WorkspaceNode { IsPlaceholder: false } node) await LoadDirectoryAsync(node.FullPath);
    }

    private async void FileList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedItem = FileList.SelectedItem as WorkspaceFileItem;
        if (_selectedItem is { IsDirectory: false, IsEditable: true } && _selectedItem.Size <= MaxEditableBytes)
            await OpenFileAsync(_selectedItem);
    }

    private async void FileList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (_selectedItem is null) return;
        await OpenFileAsync(_selectedItem);
    }

    private async void RecentFilesList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (RecentFilesList.SelectedItem is RecentWorkspaceItem recent && File.Exists(recent.FullPath))
            await OpenFileAsync(WorkspaceFileItem.FromPath(recent.FullPath));
    }

    private async void Search_Click(object sender, RoutedEventArgs e) => await SearchWorkspaceAsync();
    private async void SearchBox_KeyDown(object sender, KeyEventArgs e) { if (e.Key == Key.Enter) { e.Handled = true; await SearchWorkspaceAsync(); } }
    private async void TypeFilter_SelectionChanged(object sender, SelectionChangedEventArgs e) { if (IsLoaded && !string.IsNullOrWhiteSpace(SearchBox.Text)) await SearchWorkspaceAsync(); }
    private void EditorMode_Changed(object sender, RoutedEventArgs e) { if (IsLoaded) UpdateEditorMode(); }

    private void EditorBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_loadingDocument || string.IsNullOrWhiteSpace(_currentFile)) return;
        _dirty = !string.Equals(EditorBox.Text, _lastSavedText, StringComparison.Ordinal);
        DocumentTitleText.Text = Path.GetFileName(_currentFile) + (_dirty ? "  •" : string.Empty);
        _previewTimer.Stop(); _previewTimer.Start();
        if (_settings.WorkspaceAutoSave) { _saveTimer.Stop(); _saveTimer.Start(); }
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