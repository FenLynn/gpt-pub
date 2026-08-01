using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace PersonalWorkbench;

internal static class WorkspaceMediaRoutingBootstrap
{
    [ModuleInitializer]
    internal static void RegisterHandlers()
    {
        EventManager.RegisterClassHandler(
            typeof(TreeView),
            TreeView.SelectedItemChangedEvent,
            new RoutedPropertyChangedEventHandler<object>(OnTreeSelectionChanged));
        EventManager.RegisterClassHandler(
            typeof(TreeViewItem),
            TreeViewItem.ExpandedEvent,
            new RoutedEventHandler(OnTreeItemExpanded),
            true);
    }

    private static void OnTreeSelectionChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (sender is not TreeView { Name: "FolderTree" } tree
            || FindWorkspace(tree) is not { } workspace
            || e.NewValue is not WorkspaceNode { IsPlaceholder: false } node)
            return;

        if (workspace.IsWorkspaceImage(node.FullPath))
        {
            e.Handled = true;
            _ = workspace.OpenWorkspaceImageAsync(node);
            return;
        }

        workspace.HideWorkspaceImagePreview();
        if (!node.IsDirectory)
            _ = workspace.ConfigureCodePreviewAfterOpenAsync(node.FullPath);
    }

    private static void OnTreeItemExpanded(object sender, RoutedEventArgs e)
    {
        if (e.OriginalSource is not TreeViewItem { DataContext: WorkspaceNode node } item
            || FindWorkspace(item) is not { } workspace)
            return;
        _ = workspace.InjectWorkspaceImagesWhenReadyAsync(node);
    }

    private static WorkspaceControl? FindWorkspace(DependencyObject source)
    {
        DependencyObject? current = source;
        while (current is not null)
        {
            if (current is WorkspaceControl workspace) return workspace;
            current = VisualTreeHelper.GetParent(current) ?? LogicalTreeHelper.GetParent(current);
        }
        return null;
    }
}

public partial class WorkspaceControl
{
    private static readonly HashSet<string> WorkspaceImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"
    };

    private ScrollViewer? _workspaceImageViewer;
    private Image? _workspaceImage;
    private bool _workspaceMediaAttached;
    private bool _workspaceImageInjectionQueued;

    internal void EnableMediaAndSyntaxSupport()
    {
        if (_workspaceMediaAttached) return;
        _workspaceMediaAttached = true;

        _workspaceImage = new Image
        {
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            SnapsToDevicePixels = true
        };
        _workspaceImageViewer = new ScrollViewer
        {
            Background = new SolidColorBrush(Color.FromRgb(24, 31, 43)),
            HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Visibility = Visibility.Collapsed,
            Content = new Border
            {
                Padding = new Thickness(18),
                MinWidth = 320,
                MinHeight = 240,
                Child = _workspaceImage
            }
        };
        Grid.SetColumnSpan(_workspaceImageViewer, 3);
        Panel.SetZIndex(_workspaceImageViewer, 20);
        EditorHost.Children.Add(_workspaceImageViewer);

        EditModeButton.Checked += (_, _) => UpdateEnhancedEditorMode();
        SplitModeButton.Checked += (_, _) => UpdateEnhancedEditorMode();
        PreviewModeButton.Checked += (_, _) => UpdateEnhancedEditorMode();
        _previewTimer.Tick += (_, _) =>
        {
            if (IsCurrentCodePreview()) UpdateEnhancedCodePreview();
        };
        FolderTree.LayoutUpdated += (_, _) => QueueWorkspaceImageInjection();
        QueueWorkspaceImageInjection();
    }

    internal bool IsWorkspaceImage(string path)
        => !string.IsNullOrWhiteSpace(path)
           && WorkspaceImageExtensions.Contains(Path.GetExtension(path));

    internal async Task InjectWorkspaceImagesWhenReadyAsync(WorkspaceNode node)
    {
        if (!node.IsDirectory) return;
        for (var attempt = 0; attempt < 24 && !node.IsLoaded; attempt++)
            await Task.Delay(50);
        if (!node.IsLoaded || !Directory.Exists(node.FullPath)) return;
        await InjectWorkspaceImagesAsync(node);
    }

    private void QueueWorkspaceImageInjection()
    {
        if (_workspaceImageInjectionQueued || !_workspaceMediaAttached) return;
        _workspaceImageInjectionQueued = true;
        Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(async () =>
        {
            try
            {
                await Task.Delay(30);
                if (FolderTree.ItemsSource is IEnumerable<WorkspaceNode> roots)
                {
                    foreach (var root in roots.ToArray())
                        await InjectImagesIntoLoadedTreeAsync(root);
                }
            }
            catch (Exception ex)
            {
                App.Log("Workspace image tree injection failed: " + ex.Message);
            }
            finally
            {
                _workspaceImageInjectionQueued = false;
            }
        }));
    }

    private async Task InjectImagesIntoLoadedTreeAsync(WorkspaceNode node)
    {
        if (!node.IsDirectory || !node.IsLoaded) return;
        await InjectWorkspaceImagesAsync(node);
        foreach (var child in node.Children.Where(item => item.IsDirectory && item.IsLoaded).ToArray())
            await InjectImagesIntoLoadedTreeAsync(child);
    }

    private async Task InjectWorkspaceImagesAsync(WorkspaceNode node)
    {
        var paths = await Task.Run(() =>
        {
            var result = new List<string>();
            try
            {
                foreach (var path in Directory.EnumerateFiles(node.FullPath))
                {
                    if (!WorkspaceImageExtensions.Contains(Path.GetExtension(path))) continue;
                    if (!_settings.WorkspaceShowHiddenFiles && WorkspaceFileItem.IsHidden(path)) continue;
                    result.Add(path);
                    if (result.Count >= MaxChildrenPerDirectory) break;
                }
            }
            catch { }
            return result.OrderBy(Path.GetFileName, StringComparer.CurrentCultureIgnoreCase).ToArray();
        });

        var existing = node.Children.Select(item => item.FullPath).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var changed = false;
        foreach (var path in paths)
        {
            if (existing.Add(path))
            {
                node.Children.Add(new WorkspaceNode(path));
                changed = true;
            }
        }
        if (changed)
        {
            FolderTree.Items.Refresh();
            if (ReferenceEquals(_selectedNode, node)) ExplorerCountText.Text = $"{node.Children.Count} 项";
        }
    }

    internal async Task OpenWorkspaceImageAsync(WorkspaceNode node)
    {
        if (_workspaceImageViewer is null || _workspaceImage is null || !File.Exists(node.FullPath)) return;
        if (!await CommitBeforeNavigationAsync()) return;

        try
        {
            _loadingDocument = true;
            _selectedNode = node;
            _currentFile = node.FullPath;
            _currentDirectory = Path.GetDirectoryName(node.FullPath) ?? _settings.WorkspaceRoot;
            _settings.LastWorkspaceFile = node.FullPath;
            _settings.Save();
            _lastSavedText = string.Empty;
            _dirty = false;
            EditorBox.Text = string.Empty;

            var bitmap = new BitmapImage();
            await using (var stream = new FileStream(node.FullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                bitmap.BeginInit();
                bitmap.CacheOption = BitmapCacheOption.OnLoad;
                bitmap.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
                bitmap.StreamSource = stream;
                bitmap.EndInit();
            }
            bitmap.Freeze();
            _workspaceImage.Source = bitmap;
            _workspaceImage.Width = double.NaN;
            _workspaceImage.Height = double.NaN;
            _workspaceImage.MaxWidth = Math.Max(320, EditorHost.ActualWidth - 48);
            _workspaceImage.MaxHeight = Math.Max(240, EditorHost.ActualHeight - 48);

            DocumentTitleText.Text = node.Name;
            DocumentPathText.Text = node.FullPath;
            SaveButton.IsEnabled = false;
            RevealFileButton.IsEnabled = true;
            EditorEmptyState.Visibility = Visibility.Collapsed;
            EditModeButton.IsChecked = false;
            SplitModeButton.IsChecked = false;
            PreviewModeButton.IsChecked = true;
            EditModeButton.IsEnabled = false;
            SplitModeButton.IsEnabled = false;
            PreviewModeButton.IsEnabled = false;
            EditorBox.Visibility = Visibility.Collapsed;
            PreviewViewer.Visibility = Visibility.Collapsed;
            PreviewSplitter.Visibility = Visibility.Collapsed;
            EditorColumn.Width = new GridLength(0);
            PreviewDividerColumn.Width = new GridLength(0);
            PreviewColumn.Width = new GridLength(0);
            _workspaceImageViewer.Visibility = Visibility.Visible;
            AddRecent(node.FullPath);
            StatusText.Text = $"图片 · {bitmap.PixelWidth} × {bitmap.PixelHeight}";
            EncodingText.Text = Path.GetExtension(node.FullPath).TrimStart('.').ToUpperInvariant();
        }
        catch (Exception ex)
        {
            App.Log("Workspace image preview failed: " + ex);
            StatusText.Text = "图片预览失败：" + ex.Message;
            OpenExternal(node.FullPath);
        }
        finally
        {
            _loadingDocument = false;
        }
    }

    internal void HideWorkspaceImagePreview()
    {
        if (_workspaceImageViewer is null || _workspaceImageViewer.Visibility != Visibility.Visible) return;
        _workspaceImageViewer.Visibility = Visibility.Collapsed;
        if (_workspaceImage is not null) _workspaceImage.Source = null;
        EditModeButton.IsEnabled = true;
        EditorBox.Visibility = Visibility.Visible;
    }

    internal async Task ConfigureCodePreviewAfterOpenAsync(string path)
    {
        if (!CodeExtensions.Contains(Path.GetExtension(path))) return;
        for (var attempt = 0; attempt < 30; attempt++)
        {
            if (string.Equals(_currentFile, path, StringComparison.OrdinalIgnoreCase)) break;
            await Task.Delay(50);
        }
        if (!string.Equals(_currentFile, path, StringComparison.OrdinalIgnoreCase)) return;

        await Dispatcher.InvokeAsync(() =>
        {
            SplitModeButton.IsEnabled = true;
            PreviewModeButton.IsEnabled = true;
            UpdateEnhancedCodePreview();
            UpdateEnhancedEditorMode();
        });
    }

    private bool IsCurrentCodePreview()
        => !string.IsNullOrWhiteSpace(_currentFile)
           && CodeExtensions.Contains(Path.GetExtension(_currentFile));

    private void UpdateEnhancedCodePreview()
    {
        if (!IsCurrentCodePreview() || _workspaceImageViewer?.Visibility == Visibility.Visible) return;
        try
        {
            PreviewViewer.Document = CodeDocumentRenderer.Render(
                EditorBox.Text,
                Path.GetExtension(_currentFile).ToLowerInvariant(),
                Math.Max(11, _settings.WorkspaceEditorFontSize));
        }
        catch (Exception ex)
        {
            App.Log("Workspace code preview failed: " + ex.Message);
            StatusText.Text = "代码高亮预览失败，编辑内容未受影响。";
        }
    }

    private void UpdateEnhancedEditorMode()
    {
        if (!IsCurrentCodePreview() || _workspaceImageViewer?.Visibility == Visibility.Visible) return;
        var preview = PreviewModeButton.IsChecked == true;
        var split = SplitModeButton.IsChecked == true;
        EditorColumn.Width = preview ? new GridLength(0) : new GridLength(1, GridUnitType.Star);
        PreviewDividerColumn.Width = split ? new GridLength(5) : new GridLength(0);
        PreviewColumn.Width = preview || split ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        EditorBox.Visibility = preview ? Visibility.Collapsed : Visibility.Visible;
        PreviewSplitter.Visibility = split ? Visibility.Visible : Visibility.Collapsed;
        PreviewViewer.Visibility = preview || split ? Visibility.Visible : Visibility.Collapsed;
        if (preview || split) UpdateEnhancedCodePreview();
    }
}
