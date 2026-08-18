using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class ProjectWorkflowRuntimeVerifier
{
    public static void Verify()
    {
        var settings = new AppSettings { WorkspaceRoot = Path.GetTempPath() };
        using var projects = new ProjectCenterControl(settings);
        var environment = new Border { Child = new TextBlock { Text = "Environment" } };
        var terminal = new Border { Child = new TextBlock { Text = "Terminal" } };
        var tabs = new TabControl();
        tabs.Items.Add(new TabItem { Header = "项目", Content = projects });
        tabs.Items.Add(new TabItem { Header = "环境", Content = environment });
        tabs.Items.Add(new TabItem { Header = "终端", Content = terminal });
        tabs.SelectedIndex = 0;
        tabs.Measure(new Size(1100, 720));
        tabs.Arrange(new Rect(0, 0, 1100, 720));
        tabs.UpdateLayout();
        if (tabs.Items.Count != 3 || projects.FindName("ProjectList") is not ListView)
            throw new InvalidOperationException("Project / Environment / Terminal workflow tabs are incomplete.");
        var visual = new DrawingVisual();
        using var context = visual.RenderOpen();
        context.DrawRectangle(new VisualBrush(tabs), null, new Rect(0, 0, 1100, 720));
    }
}
