using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace PersonalWorkbench;

public partial class ToolsCenterControl
{
    protected override void OnInitialized(EventArgs e)
    {
        base.OnInitialized(e);
        SizeChanged += (_, _) => ApplyResponsiveInsets();
        Dispatcher.BeginInvoke(ApplyResponsiveInsets, DispatcherPriority.Loaded);
    }

    private void ApplyResponsiveInsets()
    {
        if (Content is not Grid root)
            return;

        var verticalInset = ActualHeight switch
        {
            < 700 => 6,
            < 840 => 9,
            _ => 16
        };

        root.Margin = new Thickness(16, verticalInset, 16, verticalInset);
        root.MinHeight = 0;
    }
}
