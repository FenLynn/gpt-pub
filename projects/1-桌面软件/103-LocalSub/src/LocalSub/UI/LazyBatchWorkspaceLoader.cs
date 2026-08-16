namespace LocalSub.UI;

public static class LazyBatchWorkspaceLoader
{
    public static void Attach(Form root)
    {
        var tabs = FindControls<TabControl>(root).FirstOrDefault();
        var page = tabs?.TabPages.Cast<TabPage>().FirstOrDefault(x => x.Text == "后台转写");
        if (page == null) return;

        var loaded = false;
        void EnsureLoaded()
        {
            if (loaded) return;
            loaded = true;
            BatchWorkspaceEnhancer.Attach(root);
        }

        page.Enter += (_, _) => EnsureLoaded();
        if (tabs?.SelectedTab == page) EnsureLoaded();
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
