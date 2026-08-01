using System.IO;

namespace PersonalWorkbench;

public enum LegacyDataMigrationStatus
{
    NotNeeded,
    Moved,
    Copied,
    TargetAlreadyExists
}

public sealed record LegacyDataMigrationResult(
    LegacyDataMigrationStatus Status,
    string LegacyDirectory,
    string TargetDirectory)
{
    public bool Migrated => Status is LegacyDataMigrationStatus.Moved or LegacyDataMigrationStatus.Copied;
}

public static class ProductIdentity
{
    public const string ProductName = "AtlasDesk";
    public const string LegacyStorageName = "PersonalWorkbench";

    public static string AppDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        ProductName);

    public static string LegacyAppDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        LegacyStorageName);

    public static LegacyDataMigrationResult MigrateLegacyAppDataIfNeeded()
        => MigrateLegacyDirectory(LegacyAppDataDirectory, AppDataDirectory);

    public static LegacyDataMigrationResult MigrateLegacyDirectory(string legacyDirectory, string targetDirectory)
    {
        if (string.IsNullOrWhiteSpace(legacyDirectory))
            throw new ArgumentException("Legacy directory is required.", nameof(legacyDirectory));
        if (string.IsNullOrWhiteSpace(targetDirectory))
            throw new ArgumentException("Target directory is required.", nameof(targetDirectory));

        legacyDirectory = Path.GetFullPath(legacyDirectory);
        targetDirectory = Path.GetFullPath(targetDirectory);

        if (!Directory.Exists(legacyDirectory))
            return new LegacyDataMigrationResult(LegacyDataMigrationStatus.NotNeeded, legacyDirectory, targetDirectory);
        if (Directory.Exists(targetDirectory))
            return new LegacyDataMigrationResult(LegacyDataMigrationStatus.TargetAlreadyExists, legacyDirectory, targetDirectory);

        Directory.CreateDirectory(Path.GetDirectoryName(targetDirectory) ?? Environment.CurrentDirectory);
        try
        {
            Directory.Move(legacyDirectory, targetDirectory);
            return new LegacyDataMigrationResult(LegacyDataMigrationStatus.Moved, legacyDirectory, targetDirectory);
        }
        catch (IOException)
        {
            CopyDirectory(legacyDirectory, targetDirectory);
            return new LegacyDataMigrationResult(LegacyDataMigrationStatus.Copied, legacyDirectory, targetDirectory);
        }
    }

    private static void CopyDirectory(string sourceDirectory, string targetDirectory)
    {
        Directory.CreateDirectory(targetDirectory);
        foreach (var directory in Directory.EnumerateDirectories(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDirectory, directory);
            Directory.CreateDirectory(Path.Combine(targetDirectory, relative));
        }

        foreach (var file in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDirectory, file);
            var target = Path.Combine(targetDirectory, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target) ?? targetDirectory);
            File.Copy(file, target, overwrite: false);
        }
    }
}
