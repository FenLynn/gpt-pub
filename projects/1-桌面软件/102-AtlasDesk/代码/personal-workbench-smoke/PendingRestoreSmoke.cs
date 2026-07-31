using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class PendingRestoreSmoke
{
    [ModuleInitializer]
    internal static void Run()
        => RunAsync().GetAwaiter().GetResult();

    private static async Task RunAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), "pw-pending-restore-" + Guid.NewGuid().ToString("N"));
        var source = Path.Combine(root, "source");
        var target = Path.Combine(root, "target");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(target);
        try
        {
            File.WriteAllText(Path.Combine(source, "settings.json"), "{\"userName\":\"restored-user\"}");
            File.WriteAllText(Path.Combine(source, "task-history.json"), "[]");
            File.WriteAllText(Path.Combine(target, "settings.json"), "{\"userName\":\"live-user\"}");
            File.WriteAllText(Path.Combine(target, "task-history.json"), "[{\"title\":\"live-task\"}]");

            var backup = Path.Combine(root, "restore.pwbak");
            await WorkbenchBackupService.ExportAsync(source, backup);
            var staged = await PendingRestoreService.StageAsync(backup, target);

            Require(File.Exists(staged.PendingBackupPath), "pending restore package is created");
            Require(File.Exists(staged.PreRestoreSnapshotPath), "pre-restore snapshot is created while staging");
            Require((await WorkbenchBackupService.ValidateAsync(staged.PendingBackupPath)).IsValid,
                "pending restore package validates after staging");
            Require((await WorkbenchBackupService.ValidateAsync(staged.PreRestoreSnapshotPath)).IsValid,
                "pre-restore snapshot validates after staging");
            Require(File.ReadAllText(Path.Combine(target, "settings.json")).Contains("live-user", StringComparison.Ordinal),
                "staging does not mutate live settings");
            Require(File.ReadAllText(Path.Combine(target, "task-history.json")).Contains("live-task", StringComparison.Ordinal),
                "staging does not mutate live task history");

            var applied = await PendingRestoreService.ApplyIfPendingAsync(target);
            Require(applied is not null, "pending restore is discovered on next startup");
            Require(File.ReadAllText(Path.Combine(target, "settings.json")).Contains("restored-user", StringComparison.Ordinal),
                "pending restore applies settings before modules load");
            Require(File.ReadAllText(Path.Combine(target, "task-history.json")) == "[]",
                "pending restore applies task history before modules load");
            Require(!File.Exists(staged.PendingBackupPath), "pending package is removed only after successful apply");
            Require(await PendingRestoreService.ApplyIfPendingAsync(target) is null,
                "pending restore is idempotent after successful apply");

            Console.WriteLine("PASS deferred restore lifecycle");
        }
        finally
        {
            try { if (Directory.Exists(root)) Directory.Delete(root, true); } catch { }
        }
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("SMOKE FAIL: " + message);
    }
}
