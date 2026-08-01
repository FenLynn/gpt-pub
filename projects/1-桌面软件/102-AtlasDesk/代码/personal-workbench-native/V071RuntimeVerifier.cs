using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class V071RuntimeVerifier
{
    public static void Verify()
    {
        var settings = new AppSettings { WorkspaceRoot = Path.GetTempPath() };
        using var tasks = new TaskCenterControl(settings);
        tasks.Measure(new Size(1240, 760));
        tasks.Arrange(new Rect(0, 0, 1240, 760));
        tasks.UpdateLayout();
        if (tasks.FindName("TaskSearchBox") is not TextBox
            || tasks.FindName("TaskFilter") is not ComboBox
            || tasks.FindName("TaskList") is not ListView
            || tasks.FindName("DetailResult") is not TextBlock
            || tasks.FindName("VisibleCountText") is not TextBlock)
            throw new InvalidOperationException("Task Center launch/filter/list/detail structure is incomplete.");
        var visual = new DrawingVisual();
        using var context = visual.RenderOpen();
        context.DrawRectangle(new VisualBrush(tasks), null, new Rect(0, 0, 1240, 760));
    }
}
