using System.Runtime.CompilerServices;
using DavBridge.Core;

internal static class TaskModelSmoke
{
    [ModuleInitializer]
    internal static void Run()
    {
        var legacy = new DavBridgeConfig
        {
            SourceBaseUrl = "https://source.example/dav/",
            SourceRootPath = "zotero",
            TargetBaseUrl = "https://target.example/dav/",
            TargetRootPath = "zotero",
            UploadQuotaBytes = 1_000_000_000,
            DownloadQuotaBytes = 3_000_000_000,
            NormalReserveBytes = 50_000_000,
            SprintReserveBytes = 5_000_000,
            UploadLimitBytesPerSecond = 123_000,
            TargetMinimumRequestIntervalMs = 4_200,
            TargetSingleFileLimitBytes = 500_000_000,
            MigrationEnabled = true,
            AutoResume = true
        };

        var projection = LegacyV017Adapter.Project(legacy);
        Check(!projection.RequiresConfigRewrite, "legacy config must remain untouched in v0.2 projection phase");
        Check(!projection.RequiresStateRewrite, "legacy state must remain untouched in v0.2 projection phase");
        Check(!projection.RequiresSecretsRewrite, "legacy secrets must remain untouched in v0.2 projection phase");
        Check(projection.Task.Id == LegacyV017Adapter.LegacyTaskId, "legacy task id must be deterministic");
        Check(projection.Task.TemplateId == TaskTemplates.ZoteroWebDavTemplateId, "legacy job must project to Zotero template");
        Check(projection.Task.Source.ReadOnly, "legacy InfiniCLOUD source must stay read-only");
        Check(projection.Task.Policy.Grouping == GroupingMode.ZoteroZipPropByStem, "legacy Zotero grouping must be preserved");
        Check(!projection.Task.Policy.DeleteExtraneousTargetObjects, "generic task model must not silently delete target extras");
        Check(!projection.Task.Policy.PropagateSourceDeletes, "generic task model must not become bidirectional sync");
        Check(projection.Task.Policy.Quota.UploadQuotaBytes == legacy.UploadQuotaBytes, "upload quota must project exactly");
        Check(projection.Task.Policy.Quota.DownloadQuotaBytes == legacy.DownloadQuotaBytes, "download quota must project exactly");
        Check(projection.Task.Policy.Quota.NormalReserveBytes == legacy.NormalReserveBytes, "reserve must project exactly");
        Check(projection.Task.Policy.UploadLimitBytesPerSecond == legacy.UploadLimitBytesPerSecond, "speed limit must project exactly");

        Console.WriteLine("PASS v0.2 generic task model legacy projection");
    }

    private static void Check(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException(message);
    }
}
