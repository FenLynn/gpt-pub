using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class V101DailyPolishChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var settings = File.ReadAllText(Path.Combine(nativeRoot, "SettingsControl.xaml.cs"));
        var zotero = File.ReadAllText(Path.Combine(nativeRoot, "ZoteroV0612Polish.cs"));
        var workRecord = File.ReadAllText(Path.Combine(nativeRoot, "..", "..", "工作记录.md"));

        RequireContains(settings,
            "InstallPathValidation",
            "InstallDataBoundaryButtons",
            "UpdatePathValidation",
            "App.RuntimeDirectory",
            "App.LogDirectory",
            "OpenKnownDirectory");
        RequireContains(settings,
            "AtlasDesk 不会自动创建、搜索或猜测该路径",
            "使用系统默认 PDF 程序");
        RequireAbsent(settings,
            "Directory.CreateDirectory(WorkspaceBox.Text",
            "Directory.CreateDirectory(ZoteroBox.Text",
            "Directory.CreateDirectory(CondaBox.Text",
            "Directory.CreateDirectory(UvBox.Text");

        RequireContains(zotero,
            "AttachResponsiveLibraryLayout",
            "ApplyResponsiveLibraryLayout",
            "< 900 => 156",
            "< 900 => 320",
            "DetailTitle.FontSize");
        RequireAbsent(zotero,
            "ZoteroLibrary.ReadSnapshotAsync",
            "SqliteOpenMode.ReadWrite",
            "File.WriteAllText");

        RequireContains(workRecord,
            "v1.0.1",
            "不因显示主页而扫描工作区",
            "未经用户验证，不合入 `main`");

        Console.WriteLine("PASS AtlasDesk v1.0.1 daily polish keeps settings explicit and Zotero three-column layout responsive");
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.0.1 daily polish token: " + token);
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.0.1 daily polish token returned: " + token);
    }

    private static string FindProjectSourceRoot(string projectDirectory)
    {
        foreach (var candidate in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(candidate);
            while (current is not null)
            {
                var path = Path.Combine(current.FullName, "projects", "1-桌面软件", "102-AtlasDesk", "代码", projectDirectory);
                if (Directory.Exists(path)) return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.0.1 sources.");
    }
}
