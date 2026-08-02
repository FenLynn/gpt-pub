using System.Collections;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Shell;

namespace PersonalWorkbench;

/// <summary>
/// v0.6.10 corrective layer. This layer is intentionally limited to the
/// navigation focus flash, tree layout, Zotero chrome/icons, terminal launch
/// reliability, and the application title bar reported against v0.6.9.
/// </summary>
public sealed class V069UiFixEnhancer
{
    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly WorkspaceControl _workspace;
    private readonly ZoteroLibraryControl _zotero;
    private readonly TerminalDrawerControl _terminal;
    private readonly HashSet<Button> _reliableCmdButtons = new();
    private readonly List<FrameworkElement> _libraryChrome = new();
    private bool _defaultCmdRecoveryAttempted;
    private HwndSource? _windowSource;
    private bool _windowHookInstalled;

    private V069UiFixEnhancer(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _pipeline = pipeline;
        _workspace = ReadBaseField<WorkspaceControl>("_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _zotero = ReadBaseField<ZoteroLibraryControl>("_zotero")
                  ?? throw new InvalidOperationException("Zotero module is unavailable.");
        _terminal = ReadBaseField<TerminalDrawerControl>("_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");

        InstallNeutralWindowChrome();
        _window.SourceInitialized += (_, _) => InstallWindowWorkAreaHook();
        _window.Closed += (_, _) => RemoveWindowWorkAreaHook();
        InstallWindowWorkAreaHook();
        RemoveNavigationFocusFlash();
        RepairWorkspaceTree();
        RepairZoteroTree();
        IntegrateZoteroChrome();
        InstallZoteroIcons();
        WirePageVisibility();
        WireReliableTerminalLaunch();

        if (_window.IsLoaded)
            _window.Dispatcher.BeginInvoke(FinalizeLoadedVisuals);
        else
            _window.Loaded += (_, _) => FinalizeLoadedVisuals();
    }

    public static V069UiFixEnhancer Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private T? ReadBaseField<T>(string name) where T : class
        => _pipeline.Base.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_pipeline.Base) as T;

    private void FinalizeLoadedVisuals()
    {
        InstallWindowWorkAreaHook();
        RemoveNavigationFocusFlash();
        InstallReliableCmdButtons();
        UpdateLibraryChromeVisibility();
    }

    private void RemoveNavigationFocusFlash()
    {
        foreach (var name in new[]
                 {
                     "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav", "ToolsNav",
                     "DashboardNav", "TasksNav", "SettingsNav"
                 })
        {
            if (_window.FindName(name) is not RadioButton navigation) continue;
            navigation.FocusVisualStyle = null;
            navigation.IsTabStop = false;
        }

        if (_window.FindName("CommandButton") is Button command)
            command.FocusVisualStyle = null;
        if (_window.FindName("BrandToggleButton") is Button brand)
            brand.FocusVisualStyle = null;
    }

    private void RepairWorkspaceTree()
    {
        if (_workspace.FindName("FolderTree") is not TreeView tree) return;
        tree.ItemContainerStyle = TreeStyleFactory.Create(bindExpanded: true);
        tree.SetValue(VirtualizingStackPanel.IsVirtualizingProperty, false);
        tree.SetValue(ScrollViewer.HorizontalScrollBarVisibilityProperty, ScrollBarVisibility.Disabled);
        tree.AddHandler(TreeViewItem.ExpandedEvent, new RoutedEventHandler(WorkspaceTreeItem_Expanded), true);
        tree.Items.Refresh();
    }

    private void WorkspaceTreeItem_Expanded(object sender, RoutedEventArgs e)
    {
        if (e.OriginalSource is not TreeViewItem item || item.DataContext is not WorkspaceNode node)
            return;
        node.LoadChildren(_pipeline.Settings.WorkspaceShowHiddenFiles);
    }

    private void RepairZoteroTree()
    {
        if (_zotero.FindName("CollectionTree") is not TreeView tree) return;
        tree.ItemContainerStyle = TreeStyleFactory.Create(bindExpanded: false);
        tree.SetValue(VirtualizingStackPanel.IsVirtualizingProperty, false);
        tree.SetValue(ScrollViewer.HorizontalScrollBarVisibilityProperty, ScrollBarVisibility.Disabled);
        tree.Items.Refresh();
    }

    private void IntegrateZoteroChrome()
    {
        if (_zotero.Content is Grid root && root.RowDefinitions.Count >= 3)
        {
            root.RowDefinitions[0].Height = new GridLength(0);
            root.RowDefinitions[1].Height = new GridLength(0);
            root.Margin = new Thickness(8, 6, 8, 8);
        }

        if (_window.FindName("PageTitle") is TextBlock pageTitle && pageTitle.Parent is StackPanel titleStack)
        {
            if (_zotero.FindName("ConnectionText") is TextBlock connectionText)
            {
                var badge = CreateBoundBadge(connectionText, "#EAF8F2", "#2F7E60");
                titleStack.Children.Add(badge);
                _libraryChrome.Add(badge);
            }
            if (_zotero.FindName("LoadModeText") is TextBlock modeText)
            {
                var badge = CreateBoundBadge(modeText, "#EEF3FA", "#60758F");
                titleStack.Children.Add(badge);
                _libraryChrome.Add(badge);
            }
        }

        if (_window.FindName("FullscreenButton") is Button fullscreen && fullscreen.Parent is StackPanel actions)
        {
            var refresh = CreateTopIconButton("刷新 Zotero 文献库", "M19,8 A7,7 0 1 0 19,16 M19,8 V3 M19,8 H14");
            refresh.Click += (_, _) => InvokeZotero("Refresh_Click", refresh);
            actions.Children.Insert(0, refresh);
            _libraryChrome.Add(refresh);

            var settings = CreateTopIconButton("Zotero 与阅读器设置", "M12,8 A4,4 0 1 0 12,16 A4,4 0 1 0 12,8 M12,3 V6 M12,18 V21 M3,12 H6 M18,12 H21");
            settings.Click += (_, _) => InvokeZotero("OpenSettings_Click", settings);
            actions.Children.Insert(1, settings);
            _libraryChrome.Add(settings);
        }
    }

    private static Border CreateBoundBadge(TextBlock source, string background, string foreground)
    {
        var text = new TextBlock { FontSize = 10.2, Foreground = (Brush)new BrushConverter().ConvertFromString(foreground)! };
        text.SetBinding(TextBlock.TextProperty, new Binding(nameof(TextBlock.Text)) { Source = source });
        return new Border
        {
            Background = (Brush)new BrushConverter().ConvertFromString(background)!,
            CornerRadius = new CornerRadius(7),
            Padding = new Thickness(7, 2, 7, 2),
            Margin = new Thickness(7, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center,
            Child = text,
            Visibility = Visibility.Collapsed
        };
    }

    private static Button CreateTopIconButton(string tooltip, string geometry)
    {
        var button = new Button
        {
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = tooltip,
            Visibility = Visibility.Collapsed
        };
        button.Content = new Viewbox
        {
            Width = 16,
            Height = 16,
            Child = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse(geometry),
                Stroke = new SolidColorBrush(Color.FromRgb(95, 112, 135)),
                StrokeThickness = 1.75,
                Fill = Brushes.Transparent,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round
            }
        };
        return button;
    }

    private void InvokeZotero(string methodName, object sender)
    {
        try
        {
            _zotero.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.NonPublic)
                ?.Invoke(_zotero, new[] { sender, new RoutedEventArgs() });
        }
        catch (Exception ex)
        {
            App.Log("Invoke Zotero top action failed: " + ex.Message);
        }
    }

    private void InstallZoteroIcons()
    {
        if (_zotero.FindName("ItemsList") is ListView list && list.View is GridView grid && grid.Columns.Count > 0)
        {
            grid.Columns[0].Width = 38;
            grid.Columns[0].CellTemplate = BuildItemTypeTemplate();
            if (grid.Columns.Count > 5)
            {
                grid.Columns[5].Width = 48;
                grid.Columns[5].CellTemplate = BuildRecordAttachmentTemplate();
            }
        }

        if (_zotero.FindName("AttachmentsList") is ListBox attachments)
            attachments.ItemTemplate = BuildAttachmentRowTemplate();
    }

    private static DataTemplate BuildItemTypeTemplate()
    {
        var visual = new FrameworkElementFactory(typeof(ZoteroItemTypeGlyph));
        visual.SetValue(FrameworkElement.WidthProperty, 22d);
        visual.SetValue(FrameworkElement.HeightProperty, 22d);
        visual.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        visual.SetBinding(ZoteroItemTypeGlyph.ItemTypeProperty, new Binding(nameof(ZoteroRecord.ItemType)));
        visual.SetBinding(FrameworkElement.ToolTipProperty, new Binding(nameof(ZoteroRecord.ItemTypeLabel)));
        return new DataTemplate { VisualTree = visual };
    }

    private static DataTemplate BuildRecordAttachmentTemplate()
    {
        var visual = new FrameworkElementFactory(typeof(ZoteroRecordAttachmentGlyph));
        visual.SetValue(FrameworkElement.WidthProperty, 24d);
        visual.SetValue(FrameworkElement.HeightProperty, 24d);
        visual.SetValue(FrameworkElement.HorizontalAlignmentProperty, HorizontalAlignment.Center);
        visual.SetBinding(ZoteroRecordAttachmentGlyph.HasPdfProperty, new Binding(nameof(ZoteroRecord.HasPdf)));
        visual.SetBinding(ZoteroRecordAttachmentGlyph.AttachmentCountProperty, new Binding(nameof(ZoteroRecord.AttachmentCount)));
        return new DataTemplate { VisualTree = visual };
    }

    private static DataTemplate BuildAttachmentRowTemplate()
    {
        var visual = new FrameworkElementFactory(typeof(ZoteroAttachmentRow));
        return new DataTemplate { VisualTree = visual };
    }

    private void WirePageVisibility()
    {
        foreach (var name in new[]
                 {
                     "HomeNav", "WorkspaceNav", "LibraryNav", "DevelopmentNav", "ToolsNav",
                     "DashboardNav", "TasksNav", "SettingsNav"
                 })
        {
            if (_window.FindName(name) is RadioButton navigation)
                navigation.Checked += (_, _) => UpdateLibraryChromeVisibility();
        }
    }

    private void UpdateLibraryChromeVisibility()
    {
        var visible = _window.FindName("LibraryNav") is RadioButton library && library.IsChecked == true;
        foreach (var item in _libraryChrome)
            item.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
    }

    private void WireReliableTerminalLaunch()
    {
        _terminal.Loaded += (_, _) => InstallReliableCmdButtons();
        if (_window.FindName("DevelopmentNav") is RadioButton development)
        {
            development.Checked += (_, _) =>
            {
                _window.Dispatcher.BeginInvoke(InstallReliableCmdButtons);
                _ = RecoverExitedDefaultCmdAsync();
            };
        }
    }

    private void InstallReliableCmdButtons()
    {
        foreach (var button in Descendants<Button>(_terminal))
        {
            var label = button.Content?.ToString()?.Trim();
            if (label is not ("CMD" or "新建 CMD") || !_reliableCmdButtons.Add(button))
                continue;

            button.PreviewMouseLeftButtonDown += async (_, args) =>
            {
                args.Handled = true;
                await _terminal.OpenAsync(TerminalReliability.CreateCmd(_pipeline.Settings));
            };
            button.PreviewMouseLeftButtonUp += (_, args) => args.Handled = true;
        }
    }

    private async Task RecoverExitedDefaultCmdAsync()
    {
        if (_defaultCmdRecoveryAttempted) return;
        await Task.Delay(2400);
        if (_defaultCmdRecoveryAttempted) return;

        try
        {
            var tabsField = typeof(TerminalDrawerControl).GetField("_tabs", BindingFlags.Instance | BindingFlags.NonPublic);
            if (tabsField?.GetValue(_terminal) is not IDictionary states) return;

            foreach (DictionaryEntry entry in states)
            {
                var state = entry.Value;
                if (state is null) continue;
                var type = state.GetType();
                var exited = type.GetProperty("Exited")?.GetValue(state) as bool? == true;
                var intentional = type.GetProperty("IntentionalExit")?.GetValue(state) as bool? == true;
                var spec = type.GetProperty("Spec")?.GetValue(state) as TerminalLaunchSpec;
                var isCmd = spec is not null && Path.GetFileName(spec.Executable).Equals("cmd.exe", StringComparison.OrdinalIgnoreCase);
                if (!exited || intentional || !isCmd) continue;

                _defaultCmdRecoveryAttempted = true;
                if (_terminal.FindName("TerminalTabs") is TabControl tabs && entry.Key is TabItem tab)
                    tabs.SelectedItem = tab;
                if (typeof(TerminalDrawerControl).GetMethod("CloseSelectedAsync", BindingFlags.Instance | BindingFlags.NonPublic)
                        ?.Invoke(_terminal, null) is Task closeTask)
                    await closeTask;
                await _terminal.OpenAsync(TerminalReliability.CreateCmd(_pipeline.Settings, "开发终端"));
                return;
            }
        }
        catch (Exception ex)
        {
            App.Log("Terminal automatic recovery failed: " + ex.Message);
        }
    }

    private void InstallNeutralWindowChrome()
    {
        if (_window.Content is not FrameworkElement original || Equals(original.Tag, "v069-window-content"))
            return;

        _window.WindowStyle = WindowStyle.None;
        _window.ResizeMode = ResizeMode.CanResize;
        _window.Background = new SolidColorBrush(Color.FromRgb(246, 248, 251));
        WindowChrome.SetWindowChrome(_window, new WindowChrome
        {
            CaptionHeight = 0,
            ResizeBorderThickness = new Thickness(7),
            GlassFrameThickness = new Thickness(0),
            CornerRadius = new CornerRadius(0),
            UseAeroCaptionButtons = false
        });

        var shell = new Grid { Tag = "v069-window-content", Background = new SolidColorBrush(Color.FromRgb(246, 248, 251)) };
        shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(36) });
        shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

        var titleBar = new Border
        {
            Background = new SolidColorBrush(Color.FromRgb(248, 249, 251)),
            BorderBrush = new SolidColorBrush(Color.FromRgb(226, 230, 236)),
            BorderThickness = new Thickness(0, 0, 0, 1)
        };
        var titleGrid = new Grid();
        titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        titleGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var identity = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(11, 0, 0, 0),
            IsHitTestVisible = false
        };
        identity.Children.Add(new Border
        {
            Width = 19,
            Height = 19,
            CornerRadius = new CornerRadius(6),
            Background = new SolidColorBrush(Color.FromRgb(99, 126, 236)),
            Child = new TextBlock
            {
                Text = "W",
                Foreground = Brushes.White,
                FontSize = 10,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            }
        });
        identity.Children.Add(new TextBlock
        {
            Text = "AtlasDesk",
            FontSize = 11.5,
            FontWeight = FontWeights.SemiBold,
            Foreground = new SolidColorBrush(Color.FromRgb(48, 57, 71)),
            Margin = new Thickness(7, 0, 0, 0),
            VerticalAlignment = VerticalAlignment.Center
        });
        titleGrid.Children.Add(identity);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right };
        Grid.SetColumn(actions, 1);
        var minimize = CreateCaptionButton("—", false);
        minimize.Click += (_, _) => _window.WindowState = WindowState.Minimized;
        actions.Children.Add(minimize);

        var maximize = CreateCaptionButton("□", false);
        maximize.Click += (_, _) => ToggleMaximize();
        actions.Children.Add(maximize);

        var close = CreateCaptionButton("×", true);
        close.Click += (_, _) => _window.Close();
        actions.Children.Add(close);
        titleGrid.Children.Add(actions);
        titleBar.Child = titleGrid;

        titleBar.MouseLeftButtonDown += (_, args) =>
        {
            if (FindAncestor<Button>(args.OriginalSource as DependencyObject) is not null) return;
            if (args.ClickCount == 2)
            {
                ToggleMaximize();
                return;
            }
            if (_window.WindowState == WindowState.Normal)
            {
                try { _window.DragMove(); } catch { }
            }
        };
        _window.StateChanged += (_, _) =>
        {
            maximize.Content = _window.WindowState == WindowState.Maximized ? "❐" : "□";
        };

        original.Margin = new Thickness(0);
        _window.Content = null;
        Grid.SetRow(titleBar, 0);
        Grid.SetRow(original, 1);
        shell.Children.Add(titleBar);
        shell.Children.Add(original);
        _window.Content = shell;
    }

    private void InstallWindowWorkAreaHook()
    {
        if (_windowHookInstalled)
            return;

        var handle = new WindowInteropHelper(_window).Handle;
        if (handle == IntPtr.Zero)
            return;

        _windowSource = HwndSource.FromHwnd(handle);
        if (_windowSource is null)
            return;

        _windowSource.AddHook(WindowMessageHook);
        _windowHookInstalled = true;
    }

    private void RemoveWindowWorkAreaHook()
    {
        if (!_windowHookInstalled || _windowSource is null)
            return;
        _windowSource.RemoveHook(WindowMessageHook);
        _windowSource = null;
        _windowHookInstalled = false;
    }

    private IntPtr WindowMessageHook(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WM_GETMINMAXINFO = 0x0024;
        if (message != WM_GETMINMAXINFO)
            return IntPtr.Zero;

        var monitor = MonitorFromWindow(hwnd, 0x00000002);
        if (monitor == IntPtr.Zero)
            return IntPtr.Zero;

        var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref monitorInfo))
            return IntPtr.Zero;

        var info = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        var work = monitorInfo.WorkArea;
        var bounds = monitorInfo.MonitorArea;
        info.MaxPosition.X = work.Left - bounds.Left;
        info.MaxPosition.Y = work.Top - bounds.Top;
        info.MaxSize.X = work.Right - work.Left;
        info.MaxSize.Y = work.Bottom - work.Top;
        info.MaxTrackSize = info.MaxSize;
        Marshal.StructureToPtr(info, lParam, false);
        handled = true;
        return IntPtr.Zero;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect MonitorArea;
        public NativeRect WorkArea;
        public uint Flags;
    }

    private static Button CreateCaptionButton(string glyph, bool close)
    {
        var button = new Button
        {
            Width = 46,
            Height = 35,
            Content = glyph,
            FontFamily = new FontFamily("Segoe UI Symbol"),
            FontSize = close ? 16 : 13,
            Foreground = new SolidColorBrush(Color.FromRgb(64, 73, 87)),
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            FocusVisualStyle = null,
            Cursor = Cursors.Arrow
        };
        button.MouseEnter += (_, _) =>
        {
            button.Background = new SolidColorBrush(close ? Color.FromRgb(224, 67, 67) : Color.FromRgb(232, 235, 240));
            if (close) button.Foreground = Brushes.White;
        };
        button.MouseLeave += (_, _) =>
        {
            button.Background = Brushes.Transparent;
            button.Foreground = new SolidColorBrush(Color.FromRgb(64, 73, 87));
        };
        WindowChrome.SetIsHitTestVisibleInChrome(button, true);
        return button;
    }

    private void ToggleMaximize()
        => _window.WindowState = _window.WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;

    private static T? FindAncestor<T>(DependencyObject? start) where T : DependencyObject
    {
        var current = start;
        while (current is not null)
        {
            if (current is T found) return found;
            current = VisualTreeHelper.GetParent(current);
        }
        return null;
    }

    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T : DependencyObject
    {
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T typed) yield return typed;
            foreach (var descendant in Descendants<T>(child))
                yield return descendant;
        }
    }
}

internal static class TreeStyleFactory
{
    public static Style Create(bool bindExpanded)
    {
        var style = (Style)XamlReader.Parse("""
<Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
       xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
       TargetType="{x:Type TreeViewItem}">
    <Setter Property="Padding" Value="0"/>
    <Setter Property="Margin" Value="0"/>
    <Setter Property="MinHeight" Value="27"/>
    <Setter Property="HorizontalContentAlignment" Value="Stretch"/>
    <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
    <Setter Property="Template">
        <Setter.Value>
            <ControlTemplate TargetType="{x:Type TreeViewItem}">
                <StackPanel>
                    <Grid x:Name="HeaderRow" Height="27" Background="Transparent">
                        <Grid.ColumnDefinitions>
                            <ColumnDefinition Width="18"/>
                            <ColumnDefinition Width="*"/>
                        </Grid.ColumnDefinitions>
                        <ToggleButton x:Name="Expander" Width="18" Height="27"
                                      IsChecked="{Binding IsExpanded, RelativeSource={RelativeSource TemplatedParent}}"
                                      Background="Transparent" BorderThickness="0" Focusable="False">
                            <ToggleButton.Template>
                                <ControlTemplate TargetType="{x:Type ToggleButton}">
                                    <Border Background="Transparent">
                                        <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
                                    </Border>
                                </ControlTemplate>
                            </ToggleButton.Template>
                            <Path x:Name="Chevron" Data="M5,4 L9,8 L5,12" Stroke="#7E8DA1"
                                  StrokeThickness="1.45" Fill="Transparent" RenderTransformOrigin="0.5,0.5"
                                  StrokeStartLineCap="Round" StrokeEndLineCap="Round"/>
                        </ToggleButton>
                        <Border x:Name="Selection" Grid.Column="1" Background="Transparent" CornerRadius="6" Padding="3,0">
                            <ContentPresenter ContentSource="Header" VerticalAlignment="Center"/>
                        </Border>
                    </Grid>
                    <ItemsPresenter x:Name="ItemsHost" Margin="18,0,0,0" Visibility="Collapsed"/>
                </StackPanel>
                <ControlTemplate.Triggers>
                    <Trigger Property="HasItems" Value="False">
                        <Setter TargetName="Expander" Property="Visibility" Value="Hidden"/>
                    </Trigger>
                    <Trigger Property="IsExpanded" Value="True">
                        <Setter TargetName="ItemsHost" Property="Visibility" Value="Visible"/>
                        <Setter TargetName="Chevron" Property="RenderTransform">
                            <Setter.Value><RotateTransform Angle="90"/></Setter.Value>
                        </Setter>
                    </Trigger>
                    <Trigger Property="IsSelected" Value="True">
                        <Setter TargetName="Selection" Property="Background" Value="#E7F0FF"/>
                    </Trigger>
                    <Trigger Property="IsKeyboardFocusWithin" Value="True">
                        <Setter TargetName="Selection" Property="BorderBrush" Value="#C8DAF7"/>
                        <Setter TargetName="Selection" Property="BorderThickness" Value="1"/>
                    </Trigger>
                </ControlTemplate.Triggers>
            </ControlTemplate>
        </Setter.Value>
    </Setter>
</Style>
""");
        if (bindExpanded)
            style.Setters.Add(new Setter(TreeViewItem.IsExpandedProperty, new Binding(nameof(WorkspaceNode.IsExpanded)) { Mode = BindingMode.TwoWay }));
        return style;
    }
}
