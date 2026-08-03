using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V092ZoteroReadOnlyChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var xamlPath = Path.Combine(nativeRoot, "ZoteroLibraryControl.xaml");
        var xaml = File.ReadAllText(xamlPath);
        RequireTokens(
            xamlPath,
            "Citation Key",
            "DoiValueText",
            "CitationPreviewText",
            "CopyCitationKey_Click",
            "CopyCitation_Click",
            "CopyLatexCitation_Click",
            "CopyPandocCitation_Click",
            "ShowPdfFolder_Click",
            "正式投稿仍以 Zotero/CSL 输出为准");
        if (xaml.Any(character => character < 0x20 && character is not '\r' and not '\n' and not '\t'))
            throw new InvalidOperationException("Zotero XAML contains an invalid control character.");

        var panePath = Path.Combine(nativeRoot, "ZoteroLibraryControl.ReferencePane.cs");
        RequireTokens(
            panePath,
            "ItemsList_SelectionChanged_Reference",
            "ZoteroCitationFormatter.ResolveCitationKey",
            "explorer.exe",
            "/select,",
            "Clipboard.SetText",
            "只读 · 引用预览不修改 Zotero 数据");

        var libraryPath = Path.Combine(nativeRoot, "ZoteroLibrary.cs");
        RequireTokens(libraryPath, "SqliteOpenMode.ReadOnly", "PRAGMA query_only=ON");

        VerifyCitationFormatting();
        Console.WriteLine("PASS AtlasDesk v0.9.2 Zotero pane is read-only and exposes citation/file quick actions");
    }

    private static void VerifyCitationFormatting()
    {
        var record = new ZoteroRecord
        {
            ItemType = "journalArticle",
            Title = "Thermally induced coupling dynamics",
            Authors = "Fenlynn Li, Ada Smith",
            Year = "2026",
            Publication = "Optics Express",
            Doi = "https://doi.org/10.1234/example"
        };
        var native = new ZoteroItemDetails
        {
            Record = record,
            Creators = new[]
            {
                new ZoteroCreatorInfo { Name = "Fenlynn Li", Role = "作者" },
                new ZoteroCreatorInfo { Name = "Ada Smith", Role = "作者" }
            },
            Fields = new[]
            {
                new ZoteroFieldInfo { Name = "citationKey", Value = "Li2026Coupling" }
            }
        };
        if (ZoteroCitationFormatter.ResolveCitationKey(native) != "Li2026Coupling")
            throw new InvalidOperationException("Native Zotero citation key was not resolved.");
        if (ZoteroCitationFormatter.BuildLatexCitation("Li2026Coupling") != "\\cite{Li2026Coupling}")
            throw new InvalidOperationException("LaTeX citation copy format is invalid.");
        if (ZoteroCitationFormatter.BuildPandocCitation("Li2026Coupling") != "[@Li2026Coupling]")
            throw new InvalidOperationException("Pandoc citation copy format is invalid.");

        var legacy = new ZoteroItemDetails
        {
            Record = record,
            Fields = new[]
            {
                new ZoteroFieldInfo { Name = "extra", Value = "Original Date: 2025\nCitation Key: Legacy2026Key\ntex.note: demo" }
            }
        };
        if (ZoteroCitationFormatter.ResolveCitationKey(legacy) != "Legacy2026Key")
            throw new InvalidOperationException("Legacy Better BibTeX citation key was not resolved from Extra.");

        var gbt = ZoteroCitationFormatter.FormatReference(native, ZoteroCitationFormat.Gbt7714Quick);
        var apa = ZoteroCitationFormatter.FormatReference(native, ZoteroCitationFormat.ApaQuick);
        if (!gbt.Contains("10.1234/example", StringComparison.Ordinal)
            || !apa.Contains("https://doi.org/10.1234/example", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Quick citation formats lost DOI information.");
        }
    }

    private static string FindProjectSourceRoot(string projectDirectory)
    {
        foreach (var candidate in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(candidate);
            while (current is not null)
            {
                var path = Path.Combine(current.FullName, "projects", "1-桌面软件", "102-AtlasDesk", "代码", projectDirectory);
                if (Directory.Exists(path))
                    return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v0.9.2 sources.");
    }

    private static void RequireTokens(string path, params string[] tokens)
    {
        var source = File.ReadAllText(path);
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException($"Missing v0.9.2 token '{token}' in {path}.");
        }
    }
}
