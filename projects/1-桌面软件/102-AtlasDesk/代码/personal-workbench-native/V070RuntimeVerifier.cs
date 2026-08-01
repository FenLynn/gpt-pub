using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class V070RuntimeVerifier
{
    public static void Verify()
    {
        var settings = new AppSettings { WorkspaceRoot = Path.GetTempPath() };
        using var projects = new ProjectCenterControl(settings);
        var environment = new Border { Child = new TextBlock { Text = "Environment" } };
        var tabs = new TabControl();
        tabs.Items.Add(new TabItem { Header = "项目", Content = projects });
        tabs.Items.Add(new TabItem { Header = "环境", Content = environment });
        tabs.SelectedIndex = 0;
        tabs.Measure(new Size(1100, 720));
        tabs.Arrange(new Rect(0, 0, 1100, 720));
        tabs.UpdateLayout();
        if (tabs.Items.Count != 2 || projects.FindName("ProjectList") is not ListView)
            throw new InvalidOperationException("Integrated Project / Environment tabs are incomplete.");
        var visual = new DrawingVisual();
        using var context = visual.RenderOpen();
        context.DrawRectangle(new VisualBrush(tabs), null, new Rect(0, 0, 1100, 720));
    }
}
