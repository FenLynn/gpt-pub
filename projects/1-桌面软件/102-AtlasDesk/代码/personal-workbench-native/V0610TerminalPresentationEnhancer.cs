using System.Collections;
using System.Reflection;
using System.Windows.Controls;

namespace PersonalWorkbench;

public sealed class V0610TerminalPresentationEnhancer
{
    private readonly TerminalDrawerControl _terminal;

    private V0610TerminalPresentationEnhancer(WorkbenchFeaturePipeline pipeline)
    {
        _terminal = pipeline.Base.GetType()
                        .GetField("_terminal", BindingFlags.Instance | BindingFlags.NonPublic)
                        ?.GetValue(pipeline.Base) as TerminalDrawerControl
                    ?? throw new InvalidOperationException("Terminal module is unavailable.");

        if (_terminal.FindName("TerminalTabs") is TabControl tabs)
            tabs.SelectionChanged += (_, _) => tabs.Dispatcher.BeginInvoke(UpdatePresentation);
        _terminal.SessionCountChanged += (_, _) => UpdatePresentation();
        _terminal.LayoutUpdated += (_, _) => UpdatePresentation();
        _terminal.Dispatcher.BeginInvoke(UpdatePresentation);
    }

    public static V0610TerminalPresentationEnhancer Attach(WorkbenchFeaturePipeline pipeline)
        => new(pipeline);

    private void UpdatePresentation()
    {
        try
        {
            if (_terminal.FindName("TerminalTabs") is not TabControl tabs
                || tabs.SelectedItem is not TabItem selected)
                return;
            var statesField = typeof(TerminalDrawerControl).GetField("_tabs", BindingFlags.Instance | BindingFlags.NonPublic);
            if (statesField?.GetValue(_terminal) is not IDictionary states || !states.Contains(selected))
                return;
            var state = states[selected];
            var spec = state?.GetType().GetProperty("Spec")?.GetValue(state) as TerminalLaunchSpec;
            if (spec is null || !TerminalReliability.IsSupervisedCmd(spec)) return;

            if (_terminal.FindName("SelectedModeText") is TextBlock mode)
            {
                var placement = _terminal.HostMode switch
                {
                    TerminalHostMode.Development => "开发页主区域",
                    TerminalHostMode.Bottom => "底部固定",
                    _ => "独立窗口"
                };
                var text = "cmd · " + placement;
                if (!string.Equals(mode.Text, text, StringComparison.Ordinal)) mode.Text = text;
            }
        }
        catch (Exception ex)
        {
            App.Log("Update CMD presentation failed: " + ex.Message);
        }
    }
}
