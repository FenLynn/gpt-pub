using System.Collections;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace PersonalWorkbench;

/// <summary>
/// v0.6.12 presentation and content polish. This layer does not add a new
/// product module; it closes the reported Home, window chrome, Workspace,
/// Markdown, Zotero and terminal layout gaps on top of the verified v0.6.11
/// terminal backend.
/// </summary>
public sealed class V0612ExperienceEnhancer
{
    private sealed record ZoteroColumnDefinition(string Key, string Label, double Width, string? Property = null);

    private static readonly ZoteroColumnDefinition[] ZoteroColumns =
    {
        new("type", "类型", 52),
        new("title", "标题", 390, nameof(ZoteroRecord.DisplayTitle)),
        new("authors", "作者", 190, nameof(ZoteroRecord.Authors)),
        new("year", "年份", 62, nameof(ZoteroRecord.Year)),
        new("publication", "来源", 190, nameof(ZoteroRecord.Publication)),
        new("dateAdded", "添加时间", 138, nameof(ZoteroRecord.DateAdded)),
        new("dateModified", "修改时间", 138, nameof(ZoteroRecord.DateModified)),
        new("tags", "标签", 155, nameof(ZoteroRecord.TagsPreview)),
        new("notes", "笔记", 58, nameof(ZoteroRecord.NoteCount)),
        new("attachments", "附件", 58, nameof(ZoteroRecord.AttachmentCount)),
        new("pdf", "PDF", 52)
    };

    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly AppSettings _settings;
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;
    private readonly TerminalDrawerControl _terminal;
    private readonly HomeDashboardControl? _home;
    private readonly List<FrameworkElement> _workspaceTopChrome = new();
    private DataTemplate? _zoteroTypeTemplate;
    private DataTemplate? _zoteroPdfTemplate;
    private Button? _zoteroColumnsButton;
    private string _zoteroSortKey = "dateModified";
    private bool _zoteroSortAscending;

    private V0612ExperienceEnhancer(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _pipeline = pipeline;
        _settings = pipeline.Settings;
        _workspace = ReadBaseField<WorkspaceControl>("_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _zotero = ReadBaseField<ZoteroLibraryControl>("_zotero")
                  ?? throw new InvalidOperationException("Zotero module is unavailable.");
        _terminal = ReadBaseField<TerminalDrawerControl>("_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _home = pipeline.Experience.GetType()
            .GetField("_home", BindingFlags.Instance | BindingFlags.NonPublic)
            ?.GetValue(pipeline.Experience) as HomeDashboardControl;

        EnsureRealHomeInstalled();
        PolishWindowChrome();
        PolishWorkspace();
        PolishZotero();
        _workspace.EnableV0612WorkspacePolish();
        _zotero.EnableV0612DetailPolish();
        WirePageVisibility();

        if (_window.IsLoaded)
            _window.Dispatcher.BeginInvoke(FinalizeLoadedState);
        else
            _window.Loaded += (_, _) => FinalizeLoadedState();
    }

    public static V0612ExperienceEnhancer Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private T? ReadBaseField<T>(string name) where T : class
        => _pipeline.Base.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_pipeline.Base) as T;

    private void FinalizeLoadedState()
    {
        EnsureRealHomeInstalled();
        UpdateWorkspaceChromeVisibility();
        UpdateWindowChromeState();
    }

    private void EnsureRealHomeInstalled()
    {
        if (_home is null || _window.FindName("HomeView") is not Panel host)
            return;
        if (host.Children.Count == 1 && ReferenceEquals(host.Children[0], _home))
            return;
        if (_home.Parent is Panel oldParent)
            oldParent.Children.Remove(_home);
        else if (_home.Parent is ContentControl oldContent)
            oldContent.Content = null;
        host.Children.Clear();
        host.Children.Add(_home);
        _ = _home.RefreshAsync();
    }

    private void PolishWindowChrome()
    {
        if (_window.Content is not Grid shell || !Equals(shell.Tag, "v069-window-content") || shell.Children.Count < 2)
            return;
        shell.RowDefinitions[0].Height = new GridLength(32);
        var titleBar = shell.Children.OfType<Border>().FirstOrDefault(item => Grid.GetRow(item) == 0);
        if (titleBar?.Child is not Grid titleGrid)
            return;

        titleBar.BorderBrush = new SolidColorBrush(Color.FromRgb(220, 224, 230));
        titleBar.BorderThickness = new Thickness(0, 0, 0, 1);
        titleBar.Tag = "v0612-titlebar";

        var actions = titleGrid.Children.OfType<StackPanel>()
            .FirstOrDefault(panel => Grid.GetColumn(panel) == 1 && panel.Orientation == Orientation.Horizontal);
        if (actions is not null)
        {
            actions.Height = 32;
            var buttons = actions.Children.OfType<Button>().Take(3).ToArray();
            if (buttons.Length == 3)
            {
                ConfigureCaptionButton(buttons[0], CaptionGlyph.Minimize);
                ConfigureCaptionButton(buttons[1], _window.WindowState == WindowState.Maximized ? CaptionGlyph.Restore : CaptionGlyph.Maximize);
                ConfigureCaptionButton(buttons[2], CaptionGlyph.Close);
                _window.StateChanged += (_, _) => ConfigureCaptionButton(
                    buttons[1],
                    _window.WindowState == WindowState.Maximized ? CaptionGlyph.Restore : CaptionGlyph.Maximize);
            }
        }

        _window.Activated += (_, _) => titleBar.Background = new SolidColorBrush(Color.FromRgb(238, 240, 243));
        _window.Deactivated += (_, _) => titleBar.Background = Brushes.White;
        UpdateWindowChromeState();
    }

    private void UpdateWindowChromeState()
    {
        if (_window.Content is not Grid shell) return;
        var titleBar = shell.Children.OfType<Border>().FirstOrDefault(item => Equals(item.Tag, "v0612-titlebar"));
        if (titleBar is not null)
            titleBar.Background = _window.IsActive
                ? new SolidColorBrush(Color.FromRgb(238, 240, 243))
                : Brushes.White;
    }

    private enum CaptionGlyph { Minimize, Maximize, Restore, Close }

    private static void ConfigureCaptionButton(Button button, CaptionGlyph glyph)
    {
        button.Width = 44;
        button.Height = 31;
        button.Padding = new Thickness(0);
        button.Margin = new Thickness(0);
        button.HorizontalContentAlignment = HorizontalAlignment.Center;
        button.VerticalContentAlignment = VerticalAlignment.Center;
        button.BorderThickness = new Thickness(0);
        button.FocusVisualStyle = null;
        button.ToolTip = glyph switch
        {
            CaptionGlyph.Minimize => "最小化",
            CaptionGlyph.Maximize => "最大化",
            CaptionGlyph.Restore => "还原",
            _ => "关闭"
        };

        var path = new Path
        {
            Data = Geometry.Parse(glyph switch
            {
                CaptionGlyph.Minimize => "M3,8 H13",
                CaptionGlyph.Maximize => "M3.5,3.5 H12.5 V12.5 H3.5 Z",
                CaptionGlyph.Restore => "M5,3 H13 V11 M3,5 H11 V13 H3 Z",
                _ => "M4,4 L12,12 M12,4 L4,12"
            }),
            StrokeThickness = glyph == CaptionGlyph.Close ? 1.55 : 1.35,
            Fill = Brushes.Transparent,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round
        };
        path.SetBinding(Shape.StrokeProperty, new Binding(nameof(Control.Foreground))
        {
            RelativeSource = new RelativeSource(RelativeSourceMode.FindAncestor, typeof(Button), 1)
        });
        button.Content = new Viewbox { Width = 16, Height = 16, Child = path };
    }

    private void PolishWorkspace()
    {
        if (_workspace.Content is Grid root && root.RowDefinitions.Count >= 2)
        {
            root.RowDefinitions[0].Height = new GridLength(0);
            root.RowDefinitions[1].Height = new GridLength(0);
            root.Margin = new Thickness(8, 6, 8, 8);
        }

        if (_window.FindName("FullscreenButton") is not Button fullscreen || fullscreen.Parent is not StackPanel actions)
            return;

        AddWorkspaceTopButton(actions, "选择工作区目录", "M3,6 H9 L11,8 H21 V19 H3 Z M12,12 H17 M14.5,9.5 V14.5", "ChooseRoot_Click");
        AddWorkspaceTopButton(actions, "新建 Markdown 笔记", "M6,3 H15 L20,8 V21 H6 Z M15,3 V8 H20 M9,14 H17 M13,10 V18", "NewNote_Click");
        AddWorkspaceTopButton(actions, "在当前目录打开终端", "M4,5 H20 V19 H4 Z M7,9 L10,12 L7,15 M12,15 H17", "OpenTerminal_Click");
        AddWorkspaceTopButton(actions, "刷新工作区目录", "M19,8 A7,7 0 1 0 19,16 M19,8 V3 M19,8 H14", "Refresh_Click");
    }

    private void AddWorkspaceTopButton(StackPanel actions, string tooltip, string geometry, string methodName)
    {
        var button = CreateTopIconButton(tooltip, geometry);
        button.Visibility = Visibility.Collapsed;
        button.Click += (_, _) => InvokeWorkspace(methodName, button);
        actions.Children.Insert(Math.Min(_workspaceTopChrome.Count, actions.Children.Count), button);
        _workspaceTopChrome.Add(button);
    }

    private static Button CreateTopIconButton(string tooltip, string geometry)
    {
        var button = new Button
        {
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = tooltip,
            Width = 30,
            Height = 30,
            Margin = new Thickness(1, 0, 1, 0),
            FocusVisualStyle = null
        };
        button.Content = new Viewbox
        {
            Width = 16,
            Height = 16,
            Child = new Path
            {
                Data = Geometry.Parse(geometry),
                Stroke = new SolidColorBrush(Color.FromRgb(91, 110, 136)),
                StrokeThickness = 1.7,
                Fill = Brushes.Transparent,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round
            }
        };
        return button;
    }

    private void InvokeWorkspace(string methodName, object sender)
    {
        try
        {
            _workspace.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic)
                ?.Invoke(_workspace, new[] { sender, new RoutedEventArgs() });
        }
        catch (Exception ex)
        {
            App.Log("Invoke Workspace top action failed: " + ex.Message);
        }
    }

    private void PolishZotero()
    {
        if (_zotero.FindName("ItemsList") is not ListView list || list.View is not GridView grid)
            return;
        list.SetValue(ScrollViewer.HorizontalScrollBarVisibilityProperty, ScrollBarVisibility.Auto);
        list.SetValue(ScrollViewer.VerticalScrollBarVisibilityProperty, ScrollBarVisibility.Auto);
        _zoteroTypeTemplate = grid.Columns.FirstOrDefault()?.CellTemplate;
        _zoteroPdfTemplate = grid.Columns.LastOrDefault()?.CellTemplate;
        InstallZoteroColumnMenu();
        RebuildZoteroColumns();
    }

    private void InstallZoteroColumnMenu()
    {
        if (_zotero.FindName("SortFilter") is not ComboBox sort || sort.Parent is not Grid filterGrid)
            return;
        sort.Visibility = Visibility.Collapsed;
        if (filterGrid.ColumnDefinitions.Count > 4)
            filterGrid.ColumnDefinitions[4].Width = new GridLength(78);

        _zoteroColumnsButton = new Button
        {
            Content = "列设置",
            Height = 29,
            MinWidth = 0,
            Padding = new Thickness(11, 0, 11, 0),
            FontSize = 10.8,
            Background = new SolidColorBrush(Color.FromRgb(247, 249, 252)),
            Foreground = new SolidColorBrush(Color.FromRgb(75, 94, 119)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(216, 224, 234)),
            BorderThickness = new Thickness(1),
            FocusVisualStyle = null,
            Cursor = Cursors.Hand,
            ToolTip = "选择中间文献列表显示的列"
        };
        _zoteroColumnsButton.Click += (_, _) =>
        {
            if (_zoteroColumnsButton.ContextMenu is { } menu)
            {
                menu.PlacementTarget = _zoteroColumnsButton;
                menu.IsOpen = true;
            }
        };
        Grid.SetColumn(_zoteroColumnsButton, 4);
        filterGrid.Children.Add(_zoteroColumnsButton);
        RebuildZoteroColumnMenu();
    }

    private void RebuildZoteroColumnMenu()
    {
        if (_zoteroColumnsButton is null) return;
        var menu = new ContextMenu { StaysOpen = true };
        foreach (var definition in ZoteroColumns)
        {
            var item = new MenuItem
            {
                Header = definition.Label,
                Tag = definition.Key,
                IsCheckable = true,
                IsChecked = _settings.ZoteroVisibleColumns.Contains(definition.Key, StringComparer.OrdinalIgnoreCase),
                StaysOpenOnClick = true,
                IsEnabled = !definition.Key.Equals("title", StringComparison.OrdinalIgnoreCase),
                ToolTip = definition.Key.Equals("title", StringComparison.OrdinalIgnoreCase) ? "标题列始终保留" : null
            };
            item.Click += ZoteroColumnMenu_Click;
            menu.Items.Add(item);
        }
        _zoteroColumnsButton.ContextMenu = menu;
    }

    private void ZoteroColumnMenu_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not MenuItem { Tag: string key } item) return;
        if (item.IsChecked)
        {
            if (!_settings.ZoteroVisibleColumns.Contains(key, StringComparer.OrdinalIgnoreCase))
                _settings.ZoteroVisibleColumns.Add(key);
        }
        else
        {
            _settings.ZoteroVisibleColumns.RemoveAll(value => value.Equals(key, StringComparison.OrdinalIgnoreCase));
        }
        _settings.Save();
        RebuildZoteroColumns();
    }

    private void RebuildZoteroColumns()
    {
        if (_zotero.FindName("ItemsList") is not ListView list || list.View is not GridView grid)
            return;
        grid.Columns.Clear();
        foreach (var definition in ZoteroColumns.Where(definition =>
                     _settings.ZoteroVisibleColumns.Contains(definition.Key, StringComparer.OrdinalIgnoreCase)))
        {
            var column = new GridViewColumn
            {
                Width = definition.Width,
                Header = CreateZoteroColumnHeader(definition)
            };
            if (definition.Key == "type")
                column.CellTemplate = _zoteroTypeTemplate;
            else if (definition.Key == "pdf")
                column.CellTemplate = _zoteroPdfTemplate;
            else if (definition.Property is not null)
                column.DisplayMemberBinding = new Binding(definition.Property);
            grid.Columns.Add(column);
        }
        UpdateZoteroHeaderIndicators();
    }

    private GridViewColumnHeader CreateZoteroColumnHeader(ZoteroColumnDefinition definition)
    {
        var header = new GridViewColumnHeader
        {
            Content = definition.Label,
            Tag = definition.Key,
            ToolTip = "点击按“" + definition.Label + "”排序",
            Cursor = Cursors.Hand,
            HorizontalContentAlignment = HorizontalAlignment.Center
        };
        header.Click += ZoteroColumnHeader_Click;
        return header;
    }

    private void ZoteroColumnHeader_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not GridViewColumnHeader { Tag: string key }) return;
        if (_zoteroSortKey.Equals(key, StringComparison.OrdinalIgnoreCase))
            _zoteroSortAscending = !_zoteroSortAscending;
        else
        {
            _zoteroSortKey = key;
            _zoteroSortAscending = key is "title" or "authors" or "publication" or "tags" or "type";
        }
        ApplyZoteroColumnSort();
        UpdateZoteroHeaderIndicators();
    }

    private void ApplyZoteroColumnSort()
    {
        if (_zotero.FindName("ItemsList") is not ListView list
            || list.ItemsSource is not IEnumerable source)
            return;
        var records = source.Cast<object>().OfType<ZoteroRecord>().ToArray();
        if (records.Length == 0) return;
        var selectedId = (list.SelectedItem as ZoteroRecord)?.ItemId;

        IEnumerable<ZoteroRecord> sorted = _zoteroSortKey switch
        {
            "notes" => _zoteroSortAscending ? records.OrderBy(item => item.NoteCount) : records.OrderByDescending(item => item.NoteCount),
            "attachments" => _zoteroSortAscending ? records.OrderBy(item => item.AttachmentCount) : records.OrderByDescending(item => item.AttachmentCount),
            "pdf" => _zoteroSortAscending ? records.OrderBy(item => item.HasPdf) : records.OrderByDescending(item => item.HasPdf),
            _ => SortZoteroText(records, _zoteroSortKey, _zoteroSortAscending)
        };
        var result = sorted.ToArray();
        list.ItemsSource = result;
        if (selectedId.HasValue)
            list.SelectedItem = result.FirstOrDefault(item => item.ItemId == selectedId.Value);
    }

    private static IEnumerable<ZoteroRecord> SortZoteroText(IEnumerable<ZoteroRecord> records, string key, bool ascending)
    {
        string Selector(ZoteroRecord item) => key switch
        {
            "type" => item.ItemTypeLabel,
            "title" => item.DisplayTitle,
            "authors" => item.Authors,
            "year" => item.Year,
            "publication" => item.Publication,
            "dateAdded" => item.DateAdded,
            "dateModified" => item.DateModified,
            "tags" => item.TagsPreview,
            _ => item.DisplayTitle
        };
        return ascending
            ? records.OrderBy(Selector, StringComparer.CurrentCultureIgnoreCase)
            : records.OrderByDescending(Selector, StringComparer.CurrentCultureIgnoreCase);
    }

    private void UpdateZoteroHeaderIndicators()
    {
        if (_zotero.FindName("ItemsList") is not ListView list || list.View is not GridView grid)
            return;
        foreach (var column in grid.Columns)
        {
            if (column.Header is not GridViewColumnHeader { Tag: string key } header) continue;
            var definition = ZoteroColumns.FirstOrDefault(item => item.Key.Equals(key, StringComparison.OrdinalIgnoreCase));
            if (definition is null) continue;
            header.Content = definition.Label + (key.Equals(_zoteroSortKey, StringComparison.OrdinalIgnoreCase)
                ? (_zoteroSortAscending ? "  ↑" : "  ↓")
                : string.Empty);
        }
    }

    private void WirePageVisibility()
    {
        foreach (var name in new[]
                 {
                     "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav", "ToolsNav",
                     "DashboardNav", "TasksNav", "SettingsNav"
                 })
        {
            if (_window.FindName(name) is not RadioButton navigation) continue;
            navigation.Checked += (_, _) =>
            {
                if (name == "HomeNav")
                    _window.Dispatcher.BeginInvoke(EnsureRealHomeInstalled);
                UpdateWorkspaceChromeVisibility();
            };
        }
    }

    private void UpdateWorkspaceChromeVisibility()
    {
        var visible = _window.FindName("WorkspaceNav") is RadioButton workspace && workspace.IsChecked == true;
        foreach (var item in _workspaceTopChrome)
            item.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        if (visible && _workspaceTopChrome.Count > 0)
        {
            var root = _settings.WorkspaceRoot;
            _workspaceTopChrome[0].ToolTip = Directory.Exists(root)
                ? "更换工作区目录\n当前：" + root
                : "选择工作区目录";
            if (_workspaceTopChrome.Count > 1)
                _workspaceTopChrome[1].ToolTip = _settings.WorkspaceAutoSave
                    ? "新建 Markdown 笔记 · 当前为自动保存"
                    : "新建 Markdown 笔记 · 当前为手动保存";
        }
    }
}
