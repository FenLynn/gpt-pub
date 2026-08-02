using System.Diagnostics;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PersonalWorkbench;

/// <summary>
/// Long-term owner for the Project / Environment / Terminal development surface.
/// Project context is read only after an explicit project selection or refresh;
/// stale Git and environment results are discarded through generation gating.
/// </summary>
public sealed class ProjectWorkflowCoordinator
{
    private const int ProjectTabIndex = 0;
    private const int EnvironmentTabIndex = 1;
    private const int TerminalTabIndex = 2;

    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly WorkspaceControl _workspace;
    private readonly TerminalDrawerControl _terminal;
    private readonly DevelopmentControl _development;
    private readonly ProjectCenterControl _projects;
    private readonly ContentControl _terminalHost;
    private readonly TabControl _tabs;
    private CancellationTokenSource? _contextCancellation;
    private long _contextGeneration;
    private bool _movingTerminal;

    private ProjectWorkflowCoordinator(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _pipeline = pipeline;
        _workspace = ReadField<WorkspaceControl>(pipeline.Base, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _terminal = ReadField<TerminalDrawerControl>(pipeline.Base, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        _development = ReadField<DevelopmentControl>(pipeline.Base, "_development")
                       ?? throw new InvalidOperationException("Development environment module is unavailable.");
        _projects = new ProjectCenterControl(pipeline.Settings);
        _projects.ActionRequested += ProjectActionRequested;
        _projects.ProjectSelectionChanged += ProjectSelectionChanged;
        _terminalHost = new ContentControl
        {
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            VerticalContentAlignment = VerticalAlignment.Stretch,
            Background = new SolidColorBrush(Color.FromRgb(13, 19, 32))
        };

        _tabs = BuildTabs();
        _tabs.SelectionChanged += Tabs_SelectionChanged;
        _tabs.SelectedIndex = ProjectTabIndex;

        Install();
        RemoveLegacyProjectButton();
        WireNavigation();
        WireTerminalPage();
        _window.Closed += (_, _) => Dispose();
    }

    public static ProjectWorkflowCoordinator Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private TabControl BuildTabs()
    {
        RemoveFromParent(_development);
        _development.Visibility = Visibility.Visible;

        var tabs = new TabControl
        {
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Margin = new Thickness(0)
        };
        tabs.Items.Add(new TabItem { Header = "项目", Content = _projects });
        tabs.Items.Add(new TabItem { Header = "环境", Content = _development });
        tabs.Items.Add(new TabItem { Header = "终端", Content = _terminalHost });
        return tabs;
    }

    private async void Tabs_SelectionChanged(object sender, SelectionChangedEventArgs args)
    {
        if (!ReferenceEquals(args.Source, _tabs))
            return;
        try
        {
            await RefreshSelectedTabAsync();
        }
        catch (Exception ex)
        {
            App.Log("Refresh project workflow tab failed: " + ex);
        }
    }

    private async Task RefreshSelectedTabAsync()
    {
        switch (_tabs.SelectedIndex)
        {
            case ProjectTabIndex:
                await _projects.RefreshIfNeededAsync();
                break;
            case EnvironmentTabIndex:
                _development.Visibility = Visibility.Visible;
                await _development.EnsureLoadedAsync();
                break;
            case TerminalTabIndex:
                ShowTerminalPage();
                break;
        }
    }

    private void Install()
    {
        if (_window.FindName("DevelopmentView") is not Grid host)
            throw new InvalidOperationException("Development host view is unavailable.");
        host.Children.Clear();
        host.Margin = new Thickness(0);
        _development.Visibility = Visibility.Visible;
        host.Children.Add(_tabs);
    }

    private void RemoveLegacyProjectButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions) return;
        var legacy = actions.Children.OfType<Button>().FirstOrDefault(button => Equals(button.Tag, "project-hub-v063"));
        if (legacy is not null) actions.Children.Remove(legacy);
    }

    private void WireNavigation()
    {
        if (_window.FindName("DevelopmentNav") is RadioButton developmentNav)
        {
            developmentNav.Checked += async (_, _) =>
            {
                try
                {
                    if (_tabs.SelectedIndex == TerminalTabIndex)
                        ShowTerminalPage();
                    else
                        await RefreshSelectedTabAsync();
                }
                catch (Exception ex)
                {
                    App.Log("Refresh development navigation failed: " + ex);
                }
            };
        }
    }

    private void WireTerminalPage()
    {
        _development.OpenTerminalRequested += (_, _) => ShowTerminalPage();
        _terminal.EmbedDevelopmentRequested += (_, _) => ShowTerminalPage();
        _terminal.DockBottomRequested += (_, _) =>
        {
            _terminalHost.Content = null;
            if (_tabs.SelectedIndex == TerminalTabIndex)
                _tabs.SelectedIndex = EnvironmentTabIndex;
        };

        if (FindTopTerminalButton() is { } terminalButton)
        {
            terminalButton.PreviewMouseLeftButtonDown += (_, args) =>
            {
                ShowTerminalPage();
                args.Handled = true;
            };
            terminalButton.PreviewKeyDown += (_, args) =>
            {
                if (args.Key is Key.Enter or Key.Space)
                {
                    ShowTerminalPage();
                    args.Handled = true;
                }
            };
            terminalButton.ToolTip = "打开开发终端（Ctrl+`） · 新建 Ctrl+Shift+T · 重开最近 Ctrl+Shift+R";
        }

        _window.AddHandler(
            Keyboard.PreviewKeyDownEvent,
            new KeyEventHandler((_, args) =>
            {
                var openExisting = args.Key == Key.Oem3 && Keyboard.Modifiers.HasFlag(ModifierKeys.Control);
                var openNew = args.Key == Key.T
                              && Keyboard.Modifiers.HasFlag(ModifierKeys.Control)
                              && Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
                var reopenLast = args.Key == Key.R
                                 && Keyboard.Modifiers.HasFlag(ModifierKeys.Control)
                                 && Keyboard.Modifiers.HasFlag(ModifierKeys.Shift);
                if (openExisting || openNew || reopenLast)
                    ShowTerminalPage();
            }),
            handledEventsToo: true);
    }

    private Button? FindTopTerminalButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions)
            return null;
        return actions.Children
            .OfType<Button>()
            .FirstOrDefault(button => button.ToolTip?.ToString()?.Contains("终端", StringComparison.Ordinal) == true);
    }

    private void ShowTerminalPage()
    {
        if (_movingTerminal)
            return;

        try
        {
            _movingTerminal = true;
            if (_window.FindName("DevelopmentNav") is RadioButton developmentNav
                && developmentNav.IsChecked != true)
                developmentNav.IsChecked = true;

            try
            {
                _pipeline.Base.GetType()
                    .GetMethod("HideTerminal", BindingFlags.Instance | BindingFlags.NonPublic)
                    ?.Invoke(_pipeline.Base, null);
            }
            catch (Exception ex)
            {
                App.Log("Hide bottom terminal before page hosting failed: " + ex.Message);
            }

            RemoveFromParent(_terminal);
            _terminalHost.Content = _terminal;
            _terminal.Visibility = Visibility.Visible;
            _terminal.HorizontalAlignment = HorizontalAlignment.Stretch;
            _terminal.VerticalAlignment = VerticalAlignment.Stretch;
            _terminal.SetHostMode(TerminalHostMode.Development);
            if (_tabs.SelectedIndex != TerminalTabIndex)
                _tabs.SelectedIndex = TerminalTabIndex;
            _terminal.Dispatcher.BeginInvoke(new Action(ApplyTerminalButtonContrast));
        }
        catch (Exception ex)
        {
            App.Log("Show dedicated terminal page failed: " + ex);
        }
        finally
        {
            _movingTerminal = false;
        }
    }

    private void ApplyTerminalButtonContrast()
    {
        foreach (var button in FindVisualChildren<Button>(_terminal))
        {
            button.Foreground = Brushes.White;
            button.Background = new SolidColorBrush(button.IsEnabled
                ? Color.FromRgb(42, 77, 116)
                : Color.FromRgb(35, 52, 75));
            button.BorderBrush = new SolidColorBrush(button.IsEnabled
                ? Color.FromRgb(105, 145, 193)
                : Color.FromRgb(72, 91, 117));
            button.Opacity = 1;
        }
    }

    private static IEnumerable<T> FindVisualChildren<T>(DependencyObject root) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(root); index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T match)
                yield return match;
            foreach (var nested in FindVisualChildren<T>(child))
                yield return nested;
        }
    }

    private async void ProjectSelectionChanged(object? sender, ProjectSelectionChangedEventArgs e)
    {
        CancelContextRead();
        if (e.Project is null)
            return;

        var project = e.Project;
        var cancellation = new CancellationTokenSource();
        _contextCancellation = cancellation;
        var generation = Interlocked.Increment(ref _contextGeneration);
        _projects.ShowContextLoading(project);

        try
        {
            var context = await ProjectContextService.ReadAsync(
                project,
                _pipeline.Settings,
                cancellation.Token);
            if (generation != _contextGeneration || cancellation.IsCancellationRequested)
                return;
            _projects.ApplyContext(context);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            App.Log("Project context read failed: " + ex);
            if (generation == _contextGeneration)
            {
                _projects.ApplyContext(new ProjectWorkflowContext
                {
                    ProjectRoot = project.RootPath,
                    Status = "项目上下文读取失败"
                });
            }
        }
        finally
        {
            if (ReferenceEquals(_contextCancellation, cancellation))
            {
                _contextCancellation = null;
                cancellation.Dispose();
            }
        }
    }

    private async void ProjectActionRequested(object? sender, ProjectActionEventArgs e)
    {
        switch (e.Action)
        {
            case "workspace":
                if (_window.FindName("WorkspaceNav") is RadioButton workspaceNav) workspaceNav.IsChecked = true;
                await _window.Dispatcher.InvokeAsync(() => { }, System.Windows.Threading.DispatcherPriority.Loaded);
                await _workspace.OpenFromGlobalSearchAsync(e.Project.RootPath);
                break;
            case "terminal":
                ShowTerminalPage();
                await _pipeline.WorkspaceTerminal.OpenProjectTerminalAsync(e.Project.RootPath, e.Project.Name);
                break;
            case "explorer":
                try { Process.Start(new ProcessStartInfo("explorer.exe", e.Project.RootPath) { UseShellExecute = true }); }
                catch (Exception ex) { App.Log("Open project explorer failed: " + ex.Message); }
                break;
        }
    }

    private void CancelContextRead()
    {
        Interlocked.Increment(ref _contextGeneration);
        _contextCancellation?.Cancel();
        _contextCancellation?.Dispose();
        _contextCancellation = null;
    }

    private void Dispose()
    {
        CancelContextRead();
        _projects.Dispose();
    }

    private static void RemoveFromParent(FrameworkElement element)
    {
        if (element.Parent is Panel panel)
            panel.Children.Remove(element);
        else if (element.Parent is Decorator decorator)
            decorator.Child = null;
        else if (element.Parent is ContentControl content)
            content.Content = null;
    }
}
