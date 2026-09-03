using System.Reflection;

namespace DavBridge;

/// <summary>
/// Gives the v0.3.1 route surface exclusive ownership of the route row.
/// UiShellV030 keeps its legacy route field for status compatibility, but the detached legacy
/// control no longer participates in TableLayoutPanel measurement or painting.
/// </summary>
internal static class UiLayoutRepairV031
{
    public static void Apply(UiPolishV031 polish)
    {
        var type = typeof(UiPolishV031);
        var root = type.GetField("_overviewRoot", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(polish) as TableLayoutPanel
                   ?? throw new InvalidOperationException("v0.3.1 route repair could not resolve overview root.");
        var route = type.GetField("_route", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(polish) as Control
                    ?? throw new InvalidOperationException("v0.3.1 route repair could not resolve polished route.");
        var legacy = type.GetField("_oldRoute", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(polish) as Control
                     ?? throw new InvalidOperationException("v0.3.1 route repair could not resolve legacy route.");

        root.SuspendLayout();
        try
        {
            if (legacy.Parent == root)
                root.Controls.Remove(legacy);
            if (route.Parent == root)
                root.Controls.Remove(route);

            route.Visible = true;
            route.Dock = DockStyle.Fill;
            route.Margin = Padding.Empty;
            root.Controls.Add(route, 0, 1);
            root.SetColumnSpan(route, Math.Max(1, root.ColumnCount));
            route.BringToFront();
        }
        finally
        {
            root.ResumeLayout(true);
        }
    }
}
