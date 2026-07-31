namespace PersonalWorkbench;

public partial class WorkspaceControl
{
    public async Task OpenFromGlobalSearchAsync(string path)
    {
        await EnsureLoadedAsync();
        if (Directory.Exists(path))
        {
            await LoadDirectoryAsync(path);
            return;
        }
        if (File.Exists(path))
            await OpenFileAsync(WorkspaceFileItem.FromPath(path));
    }
}
