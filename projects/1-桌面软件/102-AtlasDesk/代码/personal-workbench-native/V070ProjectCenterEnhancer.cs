using System.Diagnostics;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public sealed class V070ProjectCenterEnhancer
{
    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly WorkspaceControl _workspace;
    private readonly TerminalDrawerControl _terminal;
    private readonly DevelopmentControl _development;
    private readonly ProjectCenterControl _projects;
    private readonly TabControl _tabs;

    private V070ProjectCenterEnhancer(MainWindow window, WorkbenchFeaturePipeline pipeline)
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
        _tabs = BuildTabs();
        Install();
        RemoveLegacyProjectButton();
        WireNavigation();
        _window.Closed += (_, _) => _projects.Dispose();
    }

    public static V070ProjectCenterEnhancer Attach(MainWindow window, WorkbenchFeaturePipeline pipeline)
        => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private TabControl BuildTabs()
    {
        if (_development.Parent is Panel parent) parent.Children.Remove(_development);
        else if (_development.Parent is ContentControl content) content.Content = null;
        _development.Visibility = Visibility.Visible;

        var tabs = new TabControl
        {
            Background = System.Windows.Media.Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Margin = new Thickness(0)
        };
        tabs.Items.Add(new TabItem { Header = "项目", Content = _projects });
        tabs.Items.Add(new TabItem { Header = "环境", Content = _development });
        tabs.SelectionChanged += async (_, args) =>
        {
            if (ReferenceEquals(args.Source, tabs))
                await RefreshSelectedTabAsync();
        };
        tabs.SelectedIndex = 0;
        return tabs;
    }

    private async Task RefreshSelectedTabAsync()
    {
        if (_tabs.SelectedIndex == 0)
        {
            await _projects.RefreshIfNeededAsync();
            return;
        }

        _development.Visibility = Visibility.Visible;
        await _development.EnsureLoadedAsync();
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
            developmentNav.Checked += async (_, _) => await RefreshSelectedTabAsync();
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
                ShowTerminal();
                await _terminal.OpenAsync(WorkspaceTerminalFactory.Create(
                    _pipeline.Settings, _pipeline.Settings.DefaultShell, e.Project.RootPath, e.Project.Name));
                break;
            case "explorer":
                try { Process.Start(new ProcessStartInfo("explorer.exe", e.Project.RootPath) { UseShellExecute = true }); }
                catch (Exception ex) { App.Log("Open integrated project explorer failed: " + ex.Message); }
                break;
        }
    }

    private void ShowTerminal()
    {
        try
        {
            _pipeline.Base.GetType().GetMethod("ShowTerminal", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_pipeline.Base, null);
        }
        catch (Exception ex) { App.Log("Show integrated project terminal failed: " + ex.Message); }
    }
}
