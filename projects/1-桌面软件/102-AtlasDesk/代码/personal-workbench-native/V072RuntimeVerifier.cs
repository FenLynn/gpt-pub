using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class V072RuntimeVerifier
{
    public static void Verify()
    {
        var settings = new AppSettings { WorkspaceRoot = Path.GetTempPath() };
        using var tools = new ToolsCenterControl(settings);
        tools.Measure(new Size(1240, 760));
        tools.Arrange(new Rect(0, 0, 1240, 760));
        tools.UpdateLayout();
        if (tools.FindName("IntegrityToolItem") is not Border
            || tools.FindName("GenerateButton") is not Button
            || tools.FindName("VerifyButton") is not Button
            || tools.FindName("CompareButton") is not Button
            || tools.FindName("VerificationList") is not ListView
            || tools.FindName("DetailText") is not TextBlock)
            throw new InvalidOperationException("Tools Center catalog/action/result/detail structure is incomplete.");
        var visual = new DrawingVisual();
        using var context = visual.RenderOpen();
        context.DrawRectangle(new VisualBrush(tools), null, new Rect(0, 0, 1240, 760));
    }
}
