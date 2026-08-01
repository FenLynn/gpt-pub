using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class WorkspaceSafetySmokeModule
{
    [ModuleInitializer]
    internal static void Run()
    {
        var root = Path.Combine(Path.GetTempPath(), "pw-workspace-safety-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(root);
            Directory.CreateDirectory(Path.Combine(root, "node_modules"));
            File.WriteAllText(Path.Combine(root, "node_modules", "ignored.txt"), "ignored");
            for (var index = 0; index < 25; index++)
                File.WriteAllText(Path.Combine(root, $"file-{index:00}.md"), "# smoke");
            File.WriteAllText(Path.Combine(root, "unsupported.bin"), "ignored");

            var node = new WorkspaceNode(root);
            if (!node.TryBeginLoad())
                throw new InvalidOperationException("Workspace root did not enter the safe loading state.");
            var snapshot = node.ReadChildren(showHidden: false, limit: 10);
            if (!snapshot.Truncated || snapshot.Items.Count != 10)
                throw new InvalidOperationException("Workspace directory enumeration is not bounded.");
            if (snapshot.Items.Any(item => item.FullPath.Contains("node_modules", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("Workspace tree did not exclude generated dependency directories.");
            if (snapshot.Items.Any(item => item.Extension.Equals(".bin", StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("Workspace tree included an unsupported file type.");

            node.ApplyChildren(snapshot);
            if (!node.IsLoaded || node.IsLoading || node.Children.Count != 10)
                throw new InvalidOperationException("Workspace snapshot did not commit safely on completion.");

            if (!WorkspaceFileItem.IsIgnoredDirectory("junction", FileAttributes.Directory | FileAttributes.ReparsePoint))
                throw new InvalidOperationException("Workspace traversal did not reject a reparse-point directory.");
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
        }
    }
}
