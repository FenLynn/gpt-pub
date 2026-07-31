using System.Diagnostics;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class V063ProjectEnhancer
{
    private readonly MainWindow _window;
    private readonly WorkbenchFeaturePipeline _pipeline;
    private readonly WorkspaceControl _workspace;
    private readonly TerminalDrawerControl _terminal;
    private ProjectHubWindow? _projectWindow;

    private V063ProjectEnhancer(MainWindow window, WorkbenchFeaturePipeline pipeline)
    {
        _window = window;
        _pipeline = pipeline;
        _workspace = ReadField<WorkspaceControl>(pipeline.Base, "_workspace")
                     ?? throw new InvalidOperationException("Workspace module is unavailable.");
        _terminal = ReadField<TerminalDrawerControl>(pipeline.Base, "_terminal")
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");
        InstallProjectButton();
    }

    public static V063ProjectEnhancer Attach(MainWindow window, WorkbenchFeaturePipeline pipeline) => new(window, pipeline);

    private static T? ReadField<T>(object instance, string name) where T : class
        => instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance) as T;

    private void InstallProjectButton()
    {
        if (_window.FindName("PopoutButton") is not Button popout || popout.Parent is not StackPanel actions) return;
        if (actions.Children.OfType<Button>().Any(button => Equals(button.Tag, "project-hub-v063"))) return;
        var button = new Button
        {
            Tag = "project-hub-v063",
            Style = Application.Current.TryFindResource("IconButton") as Style,
            ToolTip = "项目中心 · 识别工作区中的 Git、Python、Node、LaTeX 和 .NET 项目"
        };
        button.Content = new Viewbox
        {
            Width = 17, Height = 17,
            Child = new System.Windows.Shapes.Path
            {
                Data = Geometry.Parse("M3,6 H10 L12,8 H21 V20 H3 Z M3,10 H21 M8,13 V17 M12,13 V17 M16,13 V17"),
                Stroke = new SolidColorBrush(Color.FromRgb(91, 111, 139)), StrokeThickness = 1.7,
                Fill = Brushes.Transparent, StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round, StrokeLineJoin = PenLineJoin.Round
            }
        };
        button.Click += (_, _) => OpenProjectHub();
        actions.Children.Insert(Math.Max(0, actions.Children.Count - 1), button);
    }

    private void OpenProjectHub()
    {
        if (_projectWindow is { IsVisible: true })
        {
            _projectWindow.Activate();
            return;
        }
        _projectWindow = new ProjectHubWindow(_pipeline.Settings) { Owner = _window };
        _projectWindow.ActionRequested += ProjectWindow_ActionRequested;
        _projectWindow.Closed += (_, _) => _projectWindow = null;
        _projectWindow.Show();
    }

    private async void ProjectWindow_ActionRequested(object? sender, ProjectActionEventArgs e)
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
                catch (Exception ex) { App.Log("Open project explorer failed: " + ex.Message); }
                break;
        }
    }

    private void ShowTerminal()
    {
        try
        {
            _pipeline.Base.GetType().GetMethod("ShowTerminal", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(_pipeline.Base, null);
        }
        catch (Exception ex) { App.Log("Show project terminal failed: " + ex.Message); }
    }
}
