namespace DavBridge;

internal sealed partial class UiInteractionCleanV0215
{
    private void InstallCalibration()
    {
        if (Field<Label>("_cycleTitle") is not { } title || title.Parent is not TableLayoutPanel section) return;
        var pos = section.GetPositionFromControl(title);
        section.Controls.Remove(title);
        var host = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 1, RowCount = 2, Margin = Padding.Empty, BackColor = Color.White };
        title.Margin = new Padding(0, 0, 0, 5);
        host.Controls.Add(title, 0, 0);
        var button = new Button { Text = "校准", Width = 66, Height = 27, FlatStyle = FlatStyle.Flat, BackColor = Color.White, TextAlign = ContentAlignment.MiddleCenter, Padding = Padding.Empty, TabStop = false };
        button.FlatAppearance.BorderColor = Color.FromArgb(205, 216, 224);
        button.Click += async (_, _) => await CalibrateAsync();
        host.Controls.Add(button, 0, 1);
        section.Controls.Add(host, pos.Column, pos.Row);
        if (section.RowCount > pos.Row + 1) section.SetRowSpan(host, 2);
    }
}
