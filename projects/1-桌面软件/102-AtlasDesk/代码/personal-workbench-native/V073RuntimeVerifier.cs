using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class V073RuntimeVerifier
{
    public static void Verify()
    {
        var root = Path.Combine(Path.GetTempPath(), "atlasdesk-command-center-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var project = Path.Combine(root, "laser-model");
            Directory.CreateDirectory(Path.Combine(project, ".git"));
            File.WriteAllText(Path.Combine(project, ".git", "HEAD"), "ref: refs/heads/feature/command-center\n");
            File.WriteAllText(Path.Combine(project, "pyproject.toml"), "[project]\nname='laser-model'\n");
            var notes = Path.Combine(project, "command-center-notes.md");
            File.WriteAllText(notes, "AtlasDesk focused Command Center");

            var settings = new AppSettings
            {
                WorkspaceRoot = root,
                RecentWorkspaceFiles = new List<string> { notes },
                WorkspaceShowHiddenFiles = false
            };

            var staticItems = CommandCenterCatalog.BuildStaticResults(settings, string.Empty);
            if (!staticItems.Any(item => item.Action == "navigate" && item.Target == "tools")
                || !staticItems.Any(item => item.Action == "navigate" && item.Target == "tasks")
                || !staticItems.Any(item => item.Action == "navigate" && item.Target == "development")
                || !staticItems.Any(item => item.Action == "open-config"))
                throw new InvalidOperationException("Command Center static page and local-action entries are incomplete.");

            var recentResults = CommandCenterCatalog.SearchAsync(settings, "command-center").GetAwaiter().GetResult();
            if (!recentResults.Any(item => item.Kind == GlobalSearchResultKind.Workspace
                                          && string.Equals(item.Target, notes, StringComparison.OrdinalIgnoreCase)))
                throw new InvalidOperationException("Command Center did not surface the configured recent file.");
            if (recentResults.Count > CommandCenterCatalog.MaxTotalResults)
                throw new InvalidOperationException("Command Center exceeded its total result boundary.");

            var projectResults = CommandCenterCatalog.SearchAsync(settings, "laser-model").GetAwaiter().GetResult();
            if (projectResults.Any(item => item.Kind == GlobalSearchResultKind.Project && item.Target == project))
                throw new InvalidOperationException("Command Center unexpectedly rescanned the workspace project catalog.");

            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            try
            {
                CommandCenterCatalog.SearchAsync(settings, "notes", cancelled.Token).GetAwaiter().GetResult();
                throw new InvalidOperationException("Command Center search ignored cancellation.");
            }
            catch (OperationCanceledException)
            {
            }

            var window = new GlobalSearchWindow(settings);
            window.Measure(new Size(720, 480));
            window.Arrange(new Rect(0, 0, 720, 480));
            window.UpdateLayout();
            if (window.Title != "AtlasDesk 快速打开"
                || window.FindName("QueryBox") is not TextBox
                || window.FindName("ResultsList") is not ListBox
                || window.FindName("StatusText") is not TextBlock)
                throw new InvalidOperationException("AtlasDesk focused Command Center visual structure is incomplete.");
            var visual = new DrawingVisual();
            using var context = visual.RenderOpen();
            context.DrawRectangle(new VisualBrush(window), null, new Rect(0, 0, 720, 480));
            window.Close();
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }
}
