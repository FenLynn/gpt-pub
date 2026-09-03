namespace DavBridge;
internal sealed partial class UiInteractionCleanV0215
{
    private void PolishOpenForms()
    {
        foreach (var dialog in Application.OpenForms.OfType<SettingsDialog>()) PolishSettings(dialog);
    }
    private static void PolishSettings(SettingsDialog dialog)
    {
        PolishSettingsFooter(dialog);
        PolishSettingsContent(dialog);
    }
}
