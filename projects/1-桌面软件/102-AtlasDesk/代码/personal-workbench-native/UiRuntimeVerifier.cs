using System.Collections;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class UiRuntimeVerifier
{
    public static void VerifyCorrectiveVisuals()
    {
        VerifyTreeStylesAndGlyphs();
        VerifyCodePreviewRenderer();
        VerifyWorkspaceImageRegistration();
        VerifyZoteroPdfToggleTemplate();
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
