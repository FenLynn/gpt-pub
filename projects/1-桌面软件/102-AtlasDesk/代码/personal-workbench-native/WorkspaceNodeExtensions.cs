using System.Windows;

namespace PersonalWorkbench;

public static class WorkspaceNodeExtensions
{
    public static async void LoadChildren(this WorkspaceNode node, bool showHidden)
    {
        if (!node.TryBeginLoad()) return;
        try
        {
            var snapshot = await Task.Run(() => node.ReadChildren(showHidden, 1200));
            if (Application.Current?.Dispatcher is { } dispatcher && !dispatcher.CheckAccess())
                await dispatcher.InvokeAsync(() => node.ApplyChildren(snapshot));
            else
                node.ApplyChildren(snapshot);
        }
        catch (Exception ex)
        {
            node.CancelLoad();
            App.Log("Workspace lazy tree load failed: " + ex.Message);
        }
    }
}
