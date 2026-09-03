namespace DavBridge;
internal sealed partial class UiInteractionCleanV0215
{
    private static IEnumerable<Control> Walk(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Walk(child)) yield return nested;
        }
    }
}
