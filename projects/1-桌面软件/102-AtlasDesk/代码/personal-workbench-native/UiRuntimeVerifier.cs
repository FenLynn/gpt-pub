using System.Collections;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using WpfMath.Controls;

namespace PersonalWorkbench;

public static class UiRuntimeVerifier
{
    public static void VerifyCorrectiveVisuals()
    {
        VerifyTreeStylesAndGlyphs();
        VerifyCodePreviewRenderer();
        VerifyWorkspaceImageRegistration();
        VerifyZoteroPdfToggleTemplate();
        VerifyHomeAndTerminalLayouts();
        VerifyEnhancedMarkdownRenderer();
        VerifyZoteroColumnDefinitions();
    }

    private static void VerifyTreeStylesAndGlyphs()
    {
        var workspaceStyle = TreeStyleFactory.Create(bindExpanded: true);
        var zoteroStyle = TreeStyleFactory.Create(bindExpanded: false);
        if (workspaceStyle.TargetType != typeof(TreeViewItem) || zoteroStyle.TargetType != typeof(TreeViewItem))
            throw new InvalidOperationException("Corrective tree styles target the wrong control type.");

        var workspaceTree = new TreeView { ItemContainerStyle = workspaceStyle };
        workspaceTree.Items.Add(new WorkspaceNode(Path.GetTempPath()));
        workspaceTree.ApplyTemplate();

        var zoteroTree = new TreeView { ItemContainerStyle = zoteroStyle };
        zoteroTree.Items.Add(new ZoteroCollectionNode { Name = "Root", Count = 1 });
        zoteroTree.ApplyTemplate();

        var glyphs = new FrameworkElement[]
        {
            new ZoteroItemTypeGlyph { ItemType = "thesis", Width = 24, Height = 24 },
            new ZoteroItemTypeGlyph { ItemType = "journalArticle", Width = 24, Height = 24 },
            new ZoteroAttachmentGlyph { Kind = ZoteroAttachmentVisualKind.Pdf, Width = 24, Height = 24 },
            new ZoteroAttachmentGlyph { Kind = ZoteroAttachmentVisualKind.Word, Width = 24, Height = 24 },
            new ZoteroAttachmentGlyph { Kind = ZoteroAttachmentVisualKind.PowerPoint, Width = 24, Height = 24 },
            new ZoteroAttachmentGlyph { Kind = ZoteroAttachmentVisualKind.Other, Width = 24, Height = 24 }
        };
        foreach (var glyph in glyphs)
            RenderElement(glyph, 24, 24);
    }

    private static void VerifyCodePreviewRenderer()
    {
        var python = CodeDocumentRenderer.Render(
            "def hello(name):\n    # comment\n    return f\"Hello {name}\"",
            ".py",
            14);
        var latex = CodeDocumentRenderer.Render(
            "\\section{Result}\nThe value is $42$. % comment",
            ".tex",
            14);
        if (python.Blocks.Count == 0 || latex.Blocks.Count == 0)
            throw new InvalidOperationException("Code preview renderer returned an empty document.");
        if (python.FontFamily is null || latex.FontFamily is null)
            throw new InvalidOperationException("Code preview renderer did not configure a code font.");
    }

    private static void VerifyWorkspaceImageRegistration()
    {
        var field = typeof(WorkspaceControl).GetField(
            "WorkspaceImageExtensions",
            BindingFlags.Static | BindingFlags.NonPublic);
        if (field?.GetValue(null) is not IEnumerable values)
            throw new InvalidOperationException("Workspace image extension registry is unavailable.");
        var extensions = values.Cast<object>()
            .Select(value => value?.ToString() ?? string.Empty)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var required in new[] { ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff" })
        {
            if (!extensions.Contains(required))
                throw new InvalidOperationException("Workspace image extension is missing: " + required);
        }
    }

    private static void VerifyZoteroPdfToggleTemplate()
    {
        var method = typeof(V0611CorrectiveEnhancer).GetMethod(
            "BuildPdfToggleTemplate",
            BindingFlags.Static | BindingFlags.NonPublic);
        if (method?.Invoke(null, null) is not ControlTemplate template)
            throw new InvalidOperationException("Zotero PDF toggle template is unavailable.");

        var checkbox = new CheckBox
        {
            Width = 30,
            Height = 29,
            Template = template,
            Content = new TextBlock { Text = "PDF" }
        };
        checkbox.ApplyTemplate();
        checkbox.IsChecked = true;
        RenderElement(checkbox, 30, 29);
        if (checkbox.Template.FindName("Root", checkbox) is not Border)
            throw new InvalidOperationException("Zotero PDF toggle root was not created.");
    }

    private static void VerifyHomeAndTerminalLayouts()
    {
        var settings = new AppSettings();
        var home = new HomeDashboardControl(settings);
        RenderElement(home, 1180, 760);
        if (home.FindName("DateText") is not TextBlock || home.FindName("RecentFilesList") is not ItemsControl)
            throw new InvalidOperationException("Responsive Home dashboard controls are missing.");

        var terminal = new TerminalDrawerControl(settings);
        RenderElement(terminal, 1180, 680);
        if (terminal.FindName("SessionSummary") is not TextBlock
            || terminal.FindName("TerminalTabs") is not TabControl
            || terminal.FindName("HostActionButton") is not Button
            || terminal.FindName("HostModeButton") is not Button)
            throw new InvalidOperationException("Single-row terminal chrome is incomplete.");
        terminal.DisposeAsync().AsTask().GetAwaiter().GetResult();
    }

    private static void VerifyEnhancedMarkdownRenderer()
    {
        var directory = Path.Combine(Path.GetTempPath(), "pwb-markdown-smoke-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            var imagePath = Path.Combine(directory, "figure.png");
            File.WriteAllBytes(imagePath, Convert.FromBase64String(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4NQAAAAASUVORK5CYII="));
            var markdownPath = Path.Combine(directory, "note.md");
            File.WriteAllText(markdownPath, "# Result\n\nInline $x^2+y^2$\n\n$$\\frac{a}{b}$$\n\n![figure](figure.png)");

            var document = MarkdownDocumentRenderer.Render(File.ReadAllText(markdownPath), 14, markdownPath);
            if (!Descendants(document).OfType<FormulaControl>().Any())
                throw new InvalidOperationException("Markdown mathematics did not create FormulaControl content.");
            if (!Descendants(document).OfType<Image>().Any(image => image.Source is not null))
                throw new InvalidOperationException("Markdown relative image did not create image content.");
        }
        finally
        {
            try { Directory.Delete(directory, recursive: true); } catch { }
        }
    }

    private static IEnumerable<DependencyObject> Descendants(DependencyObject root)
    {
        if (root is FlowDocument document)
        {
            foreach (var block in document.Blocks)
            foreach (var item in Descendants(block))
                yield return item;
            yield break;
        }
        if (root is BlockUIContainer blockContainer && blockContainer.Child is { } blockChild)
        {
            yield return blockChild;
            foreach (var item in Descendants(blockChild)) yield return item;
        }
        if (root is Paragraph paragraph)
        {
            foreach (var inline in paragraph.Inlines)
            {
                if (inline is InlineUIContainer inlineContainer && inlineContainer.Child is { } inlineChild)
                {
                    yield return inlineChild;
                    foreach (var item in Descendants(inlineChild)) yield return item;
                }
                else if (inline is Span span)
                {
                    foreach (var nested in span.Inlines.OfType<DependencyObject>())
                    foreach (var item in Descendants(nested))
                        yield return item;
                }
            }
        }
        if (root is Panel panel)
        {
            foreach (UIElement panelChild in panel.Children)
            {
                yield return panelChild;
                foreach (var item in Descendants(panelChild)) yield return item;
            }
        }
        else if (root is Decorator decorator && decorator.Child is { } decoratedChild)
        {
            yield return decoratedChild;
            foreach (var item in Descendants(decoratedChild)) yield return item;
        }
        else if (root is ContentControl content && content.Content is DependencyObject contentChild)
        {
            yield return contentChild;
            foreach (var item in Descendants(contentChild)) yield return item;
        }
    }

    private static void VerifyZoteroColumnDefinitions()
    {
        var field = typeof(V0612ExperienceEnhancer).GetField(
            "ZoteroColumns",
            BindingFlags.Static | BindingFlags.NonPublic);
        if (field?.GetValue(null) is not IEnumerable values)
            throw new InvalidOperationException("Zotero configurable column registry is unavailable.");
        var keys = values.Cast<object>()
            .Select(value => value.GetType().GetProperty("Key")?.GetValue(value)?.ToString() ?? string.Empty)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var required in new[] { "title", "authors", "publication", "dateAdded", "dateModified", "tags", "notes", "attachments", "pdf" })
        {
            if (!keys.Contains(required))
                throw new InvalidOperationException("Zotero configurable column is missing: " + required);
        }
    }

    private static void RenderElement(FrameworkElement element, double width, double height)
    {
        element.Measure(new Size(width, height));
        element.Arrange(new Rect(0, 0, width, height));
        element.UpdateLayout();
        var visual = new DrawingVisual();
        using var context = visual.RenderOpen();
        context.DrawRectangle(new VisualBrush(element), null, new Rect(0, 0, width, height));
    }
}
