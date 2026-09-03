namespace DavBridge;
internal sealed partial class UiInteractionCleanV0215
{
    private static void HideCalibrationRow(SettingsDialog dialog)
    {
        var rows = Walk(dialog).OfType<TableLayoutPanel>()
            .Where(x => x.ColumnCount == 3 && x.Controls.Count >= 3)
            .ToArray();
        if (rows.Length >= 3) rows[2].Visible = false;
    }
}
