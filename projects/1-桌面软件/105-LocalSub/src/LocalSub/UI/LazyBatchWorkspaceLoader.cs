namespace LocalSub.UI;

public static class LazyBatchWorkspaceLoader
{
    public static void Attach(Form root)
    {
        var tabs = FindControls<TabControl>(root).FirstOrDefault();
        var prototype = tabs?.TabPages.Cast<TabPage>().FirstOrDefault(x => x.Text == "后台转写");
        if (tabs == null || prototype == null) return;

        var loaded = false;
        void EnsureLoaded()
        {
            if (loaded) return;
            loaded = true;

            // MainForm still builds the early prototype tab for compatibility. Replace the
            // whole page instead of clearing its controls so its old drag/drop and selection
            // handlers cannot perform duplicate hidden media analysis.
            var index = tabs.TabPages.IndexOf(prototype);
            var production = new TabPage("后台转写") { AllowDrop = true };
            tabs.TabPages.Remove(prototype);
            prototype.Dispose();
            tabs.TabPages.Insert(Math.Max(0, index), production);
            tabs.SelectedTab = production;
            BatchWorkspaceEnhancer.Attach(root);
        }

        prototype.Enter += (_, _) => EnsureLoaded();
        if (tabs.SelectedTab == prototype) EnsureLoaded();
    }

    static IEnumerable<T> FindControls<T>(Control root) where T : Control
    {
        foreach (Control child in root.Controls)
        {
            if (child is T t) yield return t;
            foreach (var nested in FindControls<T>(child)) yield return nested;
        }
    }
}
