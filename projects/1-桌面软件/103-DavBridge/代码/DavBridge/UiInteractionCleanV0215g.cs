namespace DavBridge;
internal sealed partial class UiInteractionCleanV0215
{
    private static void PolishSettingsContent(SettingsDialog dialog)
    {
        UpdateCalibrationHint(dialog);
        HideCalibrationRow(dialog);
    }
}
