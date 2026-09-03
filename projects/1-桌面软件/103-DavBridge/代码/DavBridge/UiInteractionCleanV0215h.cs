namespace DavBridge;
internal sealed partial class UiInteractionCleanV0215
{
    private static void UpdateCalibrationHint(SettingsDialog dialog)
    {
        foreach (var label in Walk(dialog).OfType<Label>())
            if (label.Text.Contains("人工校准入口位于", StringComparison.Ordinal))
                label.Text = "当前周期已用量与重置日期由主页显示；人工校准入口位于主页“当前周期”。";
    }
}
