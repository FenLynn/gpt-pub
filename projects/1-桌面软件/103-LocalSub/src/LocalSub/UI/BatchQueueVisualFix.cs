using System.Runtime.CompilerServices;

namespace LocalSub.UI;

/// <summary>
/// WinForms ListBox caches display strings for mutable items. The batch queue
/// changes each item's state after insertion, so plain Refresh() can leave the
/// visible text stuck at "待处理". Owner drawing asks ToString() on every paint.
/// </summary>
public static class BatchQueueVisualFix
{
    static readonly ConditionalWeakTable<ListBox, object> Attached = new();

    public static void Attach(Form root)
    {
        var tabs = FindControls<TabControl>(root).FirstOrDefault();
        var page = tabs?.TabPages.Cast<TabPage>().FirstOrDefault(x => x.Text == "后台转写");
        if (page == null) return;

        void ApplyLater()
        {
            try { page.BeginInvoke(new Action(() => Apply(page))); }
            catch { }
        }

        page.Enter += (_, _) => ApplyLater();
        ApplyLater();
    }

    static void Apply(Control page)
    {
        var list = FindControls<ListBox>(page).FirstOrDefault();
        if (list == null || Attached.TryGetValue(list, out _)) return;
        Attached.Add(list, new object());
        list.DrawMode = DrawMode.OwnerDrawFixed;
        list.ItemHeight = Math.Max(list.ItemHeight, 20);
        list.DrawItem += DrawItem;
        list.Invalidate();
    }

    static void DrawItem(object? sender, DrawItemEventArgs e)
    {
        if (sender is not ListBox list || e.Index < 0 || e.Index >= list.Items.Count) return;
        e.DrawBackground();
        var text = list.Items[e.Index]?.ToString() ?? string.Empty;
        var selected = (e.State & DrawItemState.Selected) != 0;
        var fore = selected ? SystemColors.HighlightText : list.ForeColor;
        TextRenderer.DrawText(
            e.Graphics,
            text,
            list.Font,
            e.Bounds,
            fore,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        e.DrawFocusRectangle();
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
