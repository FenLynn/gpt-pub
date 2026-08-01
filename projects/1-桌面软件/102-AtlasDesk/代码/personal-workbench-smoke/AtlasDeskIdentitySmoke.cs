using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class AtlasDeskIdentitySmoke
{
    [ModuleInitializer]
    internal static void Verify()
    {
        if (ProductIdentity.ProductName != "AtlasDesk")
            throw new InvalidOperationException("AtlasDesk product identity is not fixed.");
        if (!ProductIdentity.AppDataDirectory.EndsWith(Path.DirectorySeparatorChar + "AtlasDesk", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("AtlasDesk roaming data directory is incorrect.");

        var root = Path.Combine(Path.GetTempPath(), "atlasdesk-identity-" + Guid.NewGuid().ToString("N"));
        var legacy = Path.Combine(root, ProductIdentity.LegacyStorageName);
        var target = Path.Combine(root, ProductIdentity.ProductName);
        try
        {
            Directory.CreateDirectory(legacy);
            File.WriteAllText(Path.Combine(legacy, "settings.json"), "{}");
            var migrated = ProductIdentity.MigrateLegacyDirectory(legacy, target);
            if (!migrated.Migrated || !File.Exists(Path.Combine(target, "settings.json")) || Directory.Exists(legacy))
                throw new InvalidOperationException("Legacy roaming data was not moved to AtlasDesk.");

            Directory.CreateDirectory(legacy);
            File.WriteAllText(Path.Combine(legacy, "legacy.json"), "{}");
            var existingTarget = ProductIdentity.MigrateLegacyDirectory(legacy, target);
            if (existingTarget.Status != LegacyDataMigrationStatus.TargetAlreadyExists || !Directory.Exists(legacy))
                throw new InvalidOperationException("Existing AtlasDesk data directory was not protected.");
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
        }

        var repositoryRoot = Environment.CurrentDirectory;
        var codeRoot = Path.Combine(repositoryRoot, "projects", "1-桌面软件", "102-AtlasDesk", "代码");
        if (!Directory.Exists(codeRoot))
            return;

        var extensions = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".cs", ".xaml", ".go", ".txt", ".md"
        };
        var legacyVisiblePhrase = "Personal" + " Workbench";
        var legacyVisibleNameFiles = Directory.EnumerateFiles(codeRoot, "*", SearchOption.AllDirectories)
            .Where(path => extensions.Contains(Path.GetExtension(path)))
            .Where(path => File.ReadAllText(path).Contains(legacyVisiblePhrase, StringComparison.Ordinal))
            .Select(path => Path.GetRelativePath(repositoryRoot, path))
            .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (legacyVisibleNameFiles.Length > 0)
            throw new InvalidOperationException("Legacy visible product name remains in: " + string.Join(", ", legacyVisibleNameFiles));

        var summary = DiagnosticsService.BuildSummary(new[]
        {
            new DiagnosticCheck { Name = "Identity", Detail = "ok", Severity = DiagnosticSeverity.Ok }
        });
        if (!summary.StartsWith("AtlasDesk ", StringComparison.Ordinal)
            || summary.Contains(legacyVisiblePhrase, StringComparison.Ordinal))
            throw new InvalidOperationException("Diagnostics still expose the legacy product name.");
    }
}
