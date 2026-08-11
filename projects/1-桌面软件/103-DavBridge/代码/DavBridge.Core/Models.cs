using System.Collections.ObjectModel;

namespace DavBridge.Core;

public enum TransferStatus
{
    Pending,
    DownloadingSource,
    SourceReady,
    Uploading,
    RemotePresent,
    Verifying,
    StrongVerified,
    SourceChanged,
    Conflict,
    BlockedOversize,
    Failed
}

public enum EngineState
{
    Paused,
    Running,
    WaitNetwork,
    WaitQuota,
    WaitRetry,
    Complete
}

public sealed class DavBridgeConfig
{
    public string SourceBaseUrl { get; set; } = string.Empty;
    public string SourceRootPath { get; set; } = "zotero";
    public string SourceUsername { get; set; } = string.Empty;
    public string TargetBaseUrl { get; set; } = string.Empty;
    public string TargetRootPath { get; set; } = "zotero";
    public string TargetUsername { get; set; } = string.Empty;

    public long UploadQuotaBytes { get; set; } = 1_000_000_000L;
    public long DownloadQuotaBytes { get; set; } = 3_000_000_000L;
    public long NormalReserveBytes { get; set; } = 50_000_000L;
    public long SprintReserveBytes { get; set; } = 5_000_000L;
    public int SprintWindowHours { get; set; } = 24;
    public int UploadLimitBytesPerSecond { get; set; } = 300_000;
    public int TargetMinimumRequestIntervalMs { get; set; } = 4_200;
    public long TargetSingleFileLimitBytes { get; set; } = 500_000_000L;

    public DateTimeOffset NextResetAt { get; set; }
    public DateTimeOffset CalibrationAt { get; set; } = DateTimeOffset.UtcNow;
    public long CalibrationUploadUsedBytes { get; set; }
    public long CalibrationDownloadUsedBytes { get; set; }

    public bool MigrationEnabled { get; set; }
    public bool AutoStartWithWindows { get; set; } = true;
    public bool StartMinimized { get; set; } = true;
    public bool AutoResume { get; set; } = true;
    public bool EndOfCycleSprintEnabled { get; set; } = true;
}

public sealed class MigrationState
{
    public int SchemaVersion { get; set; } = 1;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public long UploadAttemptBytesSinceCalibration { get; set; }
    public long VerifiedDownloadBytesSinceCalibration { get; set; }
    public EngineState EngineState { get; set; } = EngineState.Paused;
    public string? CurrentGroupKey { get; set; }
    public Dictionary<string, TransferRecord> Files { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class TransferRecord
{
    public string RelativePath { get; set; } = string.Empty;
    public string GroupKey { get; set; } = string.Empty;
    public long SourceSize { get; set; }
    public string? SourceETag { get; set; }
    public DateTimeOffset? SourceLastModified { get; set; }
    public string? SourceSha256 { get; set; }
    public string? LastAttemptedUploadSha256 { get; set; }
    public string? TargetETag { get; set; }
    public string? TargetSha256 { get; set; }
    public TransferStatus Status { get; set; } = TransferStatus.Pending;
    public int AttemptCount { get; set; }
    public string? LastError { get; set; }
    public DateTimeOffset? VerifiedAt { get; set; }
}

public sealed record WebDavEntry(
    string RelativePath,
    bool IsCollection,
    long? ContentLength,
    string? ETag,
    DateTimeOffset? LastModified);

public sealed class AttachmentGroup
{
    public required string Key { get; init; }
    public required IReadOnlyList<WebDavEntry> Members { get; init; }
    public long TotalBytes => Members.Sum(x => x.ContentLength ?? 0L);
}

public static class MigrationPlanner
{
    public static IReadOnlyList<AttachmentGroup> CreateGroups(IEnumerable<WebDavEntry> entries)
    {
        var files = entries.Where(x => !x.IsCollection).ToArray();
        var consumed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var groups = new List<AttachmentGroup>();
        var byPath = files.ToDictionary(x => x.RelativePath, StringComparer.OrdinalIgnoreCase);

        foreach (var entry in files.OrderBy(x => x.RelativePath, StringComparer.OrdinalIgnoreCase))
        {
            if (!consumed.Add(entry.RelativePath))
                continue;

            var extension = Path.GetExtension(entry.RelativePath);
            if (extension.Equals(".zip", StringComparison.OrdinalIgnoreCase) ||
                extension.Equals(".prop", StringComparison.OrdinalIgnoreCase))
            {
                var stem = entry.RelativePath[..^extension.Length];
                var zipPath = stem + ".zip";
                var propPath = stem + ".prop";
                var members = new List<WebDavEntry>(2);

                if (byPath.TryGetValue(zipPath, out var zip))
                {
                    members.Add(zip);
                    consumed.Add(zip.RelativePath);
                }
                if (byPath.TryGetValue(propPath, out var prop))
                {
                    members.Add(prop);
                    consumed.Add(prop.RelativePath);
                }

                groups.Add(new AttachmentGroup
                {
                    Key = stem,
                    Members = new ReadOnlyCollection<WebDavEntry>(members)
                });
            }
            else
            {
                groups.Add(new AttachmentGroup
                {
                    Key = entry.RelativePath,
                    Members = new ReadOnlyCollection<WebDavEntry>(new[] { entry })
                });
            }
        }

        return groups;
    }
}
