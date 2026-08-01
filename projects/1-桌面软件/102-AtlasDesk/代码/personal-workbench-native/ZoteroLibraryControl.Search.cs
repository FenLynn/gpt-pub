namespace PersonalWorkbench;

public partial class ZoteroLibraryControl
{
    public async Task ApplyExternalSearchAsync(string query)
    {
        await EnsureLoadedAsync();
        SearchBox.Text = query ?? string.Empty;
        await SearchAsync();
        if (ItemsList.Items.Count > 0)
        {
            ItemsList.SelectedIndex = 0;
            ItemsList.ScrollIntoView(ItemsList.SelectedItem);
        }
    }
}
