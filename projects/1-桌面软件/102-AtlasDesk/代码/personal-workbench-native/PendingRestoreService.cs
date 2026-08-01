namespace PersonalWorkbench;

public sealed class PendingRestoreStageResult
{
    public string SourceBackupPath { get; init; } = string.Empty;
    public string PendingBackupPath { get; init; } = string.Empty;
    public string PreRestoreSnapshotPath { get; init; } = string.Empty;
    public IReadOnlyList<string> Files { get; init; } = Array.Empty<string>();
}

public static class PendingRestoreService
{
    public const string PendingFileName = "pending-restore.pwbak";

    public static string GetPendingPath(string targetDirectory)
        => Path.Combine(Path.GetFullPath(targetDirectory), PendingFileName);

    public static async Task<PendingRestoreStageResult> StageAsync(
        string backupPath,
        string targetDirectory,
        CancellationToken cancellationToken = default)
    {
        targetDirectory = Path.GetFullPath(targetDirectory);
        Directory.CreateDirectory(targetDirectory);
        var validation = await WorkbenchBackupService.ValidateAsync(backupPath, cancellationToken);
        if (!validation.IsValid) throw new InvalidDataException(string.Join(Environment.NewLine, validation.Errors));

        var snapshotsDirectory = Path.Combine(targetDirectory, "backups");
        Directory.CreateDirectory(snapshotsDirectory);
        var snapshot = Path.Combine(snapshotsDirectory, $"pre-restore-{DateTime.Now:yyyyMMdd-HHmmss-fff}.pwbak");
        await WorkbenchBackupService.ExportAsync(targetDirectory, snapshot, cancellationToken);

        var pending = GetPendingPath(targetDirectory);
        var temp = pending + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await using (var source = new FileStream(backupPath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, FileOptions.Asynchronous | FileOptions.SequentialScan))
            await using (var target = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, FileOptions.Asynchronous))
            {
                if (source.Length > WorkbenchBackupService.MaxArchiveBytes) throw new InvalidDataException("备份包超过安全上限。");
                await source.CopyToAsync(target, cancellationToken);
                await target.FlushAsync(cancellationToken);
            }
            File.Move(temp, pending, true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
        }

        return new PendingRestoreStageResult
        {
            SourceBackupPath = Path.GetFullPath(backupPath),
            PendingBackupPath = pending,
            PreRestoreSnapshotPath = snapshot,
            Files = validation.Files
        };
    }

    public static async Task<BackupRestoreResult?> ApplyIfPendingAsync(
        string targetDirectory,
        CancellationToken cancellationToken = default)
    {
        var pending = GetPendingPath(targetDirectory);
        if (!File.Exists(pending)) return null;

        // RestoreAsync validates the staged archive again immediately before writing.
        var result = await WorkbenchBackupService.RestoreAsync(
            pending, targetDirectory, createPreRestoreSnapshot: false, cancellationToken);
        try { File.Delete(pending); }
        catch (Exception ex) { App.Log("Pending restore cleanup failed: " + ex.Message); }
        return result;
    }
}
