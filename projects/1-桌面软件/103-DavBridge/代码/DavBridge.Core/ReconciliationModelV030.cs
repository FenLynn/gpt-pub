using System.Globalization;

namespace DavBridge.Core;

public enum RecycleDisposition
{
    Active,
    Observing,
    ReviewRequired,
    DeferredThisCycle,
    Removed,
    Blocked
}

public sealed class ReconciliationState
{
    public int SchemaVersion { get; set; } = 1;
    public string? CurrentCycleId { get; set; }
    public string? LastReconciledCycleId { get; set; }
    public DateTimeOffset? LastReconciledAt { get; set; }
    public int LastManifestObjectCount { get; set; }
    public int LastManifestGroupCount { get; set; }
    public int LastChangedGroupCount { get; set; }
    public int LastNewGroupCount { get; set; }
    public int LastMissingGroupCount { get; set; }
    public IDictionary<string, ReconciliationGroupState> Groups { get; set; } =
        new Dictionary<string, ReconciliationGroupState>(StringComparer.OrdinalIgnoreCase);
}

public sealed class ReconciliationGroupState
{
    public string GroupKey { get; set; } = string.Empty;
    public string? LastSeenCycleId { get; set; }
    public string? FirstMissingCycleId { get; set; }
    public DateTimeOffset? FirstMissingAt { get; set; }
    public string? LastDeferredCycleId { get; set; }
    public DateTimeOffset? LastDeferredAt { get; set; }
    public string? RemovedCycleId { get; set; }
    public DateTimeOffset? RemovedAt { get; set; }
    public string? LastIssue { get; set; }
}

public sealed record ReconciliationSummary(
    string? CycleId,
    int SourceObjects,
    int SourceGroups,
    int ChangedGroups,
    int NewGroups,
    int MissingGroups,
    int ReviewRequiredGroups,
    bool ReconciledThisPass,
    string Message);

public static class ReconciliationPolicy
{
    public static string FormatCycleId(DateTimeOffset resetDate) =>
        resetDate.ToString("yyMMdd", CultureInfo.InvariantCulture);

    public static string? DeriveCurrentCycleId(DateTimeOffset nextResetAt)
    {
        if (nextResetAt == default) return null;
        var nextResetDate = ResetSchedulePolicy.NormalizeResetDate(nextResetAt);
        return FormatCycleId(nextResetDate.AddMonths(-1));
    }

    public static RecycleDisposition GetDisposition(ReconciliationGroupState group, string? currentCycleId)
    {
        if (group.RemovedAt.HasValue) return RecycleDisposition.Removed;
        if (!string.IsNullOrWhiteSpace(group.LastIssue) && group.LastIssue.StartsWith("BLOCKED:", StringComparison.Ordinal))
            return RecycleDisposition.Blocked;
        if (string.IsNullOrWhiteSpace(group.FirstMissingCycleId)) return RecycleDisposition.Active;
        if (string.IsNullOrWhiteSpace(currentCycleId) ||
            string.Equals(group.FirstMissingCycleId, currentCycleId, StringComparison.OrdinalIgnoreCase))
            return RecycleDisposition.Observing;
        if (string.Equals(group.LastDeferredCycleId, currentCycleId, StringComparison.OrdinalIgnoreCase))
            return RecycleDisposition.DeferredThisCycle;
        return RecycleDisposition.ReviewRequired;
    }

    public static bool RequiresReview(ReconciliationGroupState group, string? currentCycleId) =>
        GetDisposition(group, currentCycleId) == RecycleDisposition.ReviewRequired;

    public static bool IsHistoricallyVerified(TransferRecord record) =>
        record.VerifiedAt.HasValue &&
        !string.IsNullOrWhiteSpace(record.SourceSha256) &&
        !string.IsNullOrWhiteSpace(record.TargetSha256);

    public static bool IsMetadataCurrent(TransferRecord record, WebDavEntry entry)
    {
        if (entry.ContentLength.HasValue && record.SourceSize != entry.ContentLength.Value) return false;
        if (!string.IsNullOrWhiteSpace(entry.ETag) &&
            !string.Equals(record.SourceETag, entry.ETag, StringComparison.Ordinal)) return false;
        if (entry.LastModified.HasValue && record.SourceLastModified.HasValue &&
            entry.LastModified.Value != record.SourceLastModified.Value) return false;
        return true;
    }

    public static bool IsCompleteHistoricalGroup(IReadOnlyCollection<TransferRecord> records)
    {
        if (records.Count == 0 || records.Any(record => !IsHistoricallyVerified(record))) return false;
        var zoteroMembers = records
            .Where(record =>
                Path.GetExtension(record.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase) ||
                Path.GetExtension(record.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (zoteroMembers.Length == 0) return records.Count == 1;
        return zoteroMembers.Length == 2 &&
               zoteroMembers.Any(record => Path.GetExtension(record.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase)) &&
               zoteroMembers.Any(record => Path.GetExtension(record.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
    }
}
