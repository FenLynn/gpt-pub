namespace DavBridge;
internal sealed partial class UiInteractionCleanV0215
{
    private static void PolishSettingsFooter(SettingsDialog dialog)
    {
        var buttons = Walk(dialog).OfType<Button>().ToArray();
        var save = buttons.FirstOrDefault(x => x.Text == "保存");
        var cancel = buttons.FirstOrDefault(x => x.Text == "取消");
        foreach (var button in new[] { save, cancel }.Where(x => x is not null).Cast<Button>())
        {
            button.TextAlign = ContentAlignment.MiddleCenter;
            button.Padding = Padding.Empty;
            button.Height = 34;
        }
        if (save?.Parent is FlowLayoutPanel flow && flow.Parent is Panel footer && footer.Parent is TableLayoutPanel shell && shell.RowStyles.Count > 1)
        {
            shell.RowStyles[1].SizeType = SizeType.Absolute;
            shell.RowStyles[1].Height = 76;
            footer.Padding = new Padding(20,8,26,24);
        }
    }
}
