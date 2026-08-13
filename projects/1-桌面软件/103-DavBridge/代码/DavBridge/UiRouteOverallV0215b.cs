namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private T? Field<T>(string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.GetValue(_dashboard) as T; }
        catch { return null; }
    }
    private static void Clear(Control host)
    {
        foreach (Control child in host.Controls.Cast<Control>().ToArray()) { host.Controls.Remove(child); child.Dispose(); }
    }
}
