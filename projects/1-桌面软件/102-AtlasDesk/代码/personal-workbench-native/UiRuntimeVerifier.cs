using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public static class UiRuntimeVerifier
{
    public static void VerifyCorrectiveVisuals()
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
        {
            glyph.Measure(new Size(24, 24));
            glyph.Arrange(new Rect(0, 0, 24, 24));
            var visual = new DrawingVisual();
            using var context = visual.RenderOpen();
            var brush = new VisualBrush(glyph);
            context.DrawRectangle(brush, null, new Rect(0, 0, 24, 24));
        }
    }
}
