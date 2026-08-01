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
            File.WriteAllText(notes, "AtlasDesk v0.7.3");

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
                throw new InvalidOperationException("Command Center static page, tool, task or configuration entries are incomplete.");

            var results = CommandCenterCatalog.SearchAsync(settings, "laser").GetAwaiter().GetResult();
            if (!results.Any(item => item.Kind == GlobalSearchResultKind.Project && item.Target == project))
                throw new InvalidOperationException("Command Center did not surface the bounded project catalog result.");
            if (results.Count > CommandCenterCatalog.MaxTotalResults)
                throw new InvalidOperationException("Command Center exceeded its total result boundary.");

            var fileResults = CommandCenterCatalog.SearchWorkspaceFilesBounded(root, "command-center", false);
            if (!fileResults.Contains(notes, StringComparer.OrdinalIgnoreCase)
                || fileResults.Count > CommandCenterCatalog.MaxWorkspaceResults)
                throw new InvalidOperationException("Command Center bounded workspace search is incomplete.");

            using var cancelled = new CancellationTokenSource();
            cancelled.Cancel();
            try
            {
                CommandCenterCatalog.SearchWorkspaceFilesBounded(root, "notes", false, cancelled.Token);
                throw new InvalidOperationException("Command Center workspace search ignored cancellation.");
            }
            catch (OperationCanceledException) { }

            var window = new GlobalSearchWindow(settings);
            window.Measure(new Size(820, 560));
            window.Arrange(new Rect(0, 0, 820, 560));
            window.UpdateLayout();
            if (window.Title != "AtlasDesk Command Center"
                || window.FindName("QueryBox") is not TextBox
                || window.FindName("ResultsList") is not ListBox
                || window.FindName("StatusText") is not TextBlock)
                throw new InvalidOperationException("AtlasDesk Command Center visual structure is incomplete.");
            var visual = new DrawingVisual();
            using var context = visual.RenderOpen();
            context.DrawRectangle(new VisualBrush(window), null, new Rect(0, 0, 820, 560));
            window.Close();
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }
}
