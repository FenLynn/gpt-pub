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
        // Cycle identity follows the configured reset calendar date itself. Do not convert through
        // the runner or machine local timezone, because that can move an offset date across midnight.
        var nextCalendarDate = new DateTimeOffset(
            nextResetAt.Year,
            nextResetAt.Month,
            nextResetAt.Day,
            0, 0, 0,
            nextResetAt.Offset);
        return FormatCycleId(nextCalendarDate.AddMonths(-1));
    }

    public static RecycleDisposition GetDisposition(ReconciliationGroupState group, string? currentCycleId)
    {
        if (!string.IsNullOrWhiteSpace(currentCycleId) &&
            string.Equals(group.LastDeferredCycleId, currentCycleId, StringComparison.OrdinalIgnoreCase) &&
            (!string.IsNullOrWhiteSpace(group.FirstMissingCycleId) || IsBlocked(group)))
            return RecycleDisposition.DeferredThisCycle;
        if (IsBlocked(group)) return RecycleDisposition.Blocked;
        if (group.RemovedAt.HasValue) return RecycleDisposition.Removed;
        if (string.IsNullOrWhiteSpace(group.FirstMissingCycleId)) return RecycleDisposition.Active;
        if (string.IsNullOrWhiteSpace(currentCycleId) ||
            string.Equals(group.FirstMissingCycleId, currentCycleId, StringComparison.OrdinalIgnoreCase))
            return RecycleDisposition.Observing;
        return RecycleDisposition.ReviewRequired;
    }

    public static bool RequiresReview(ReconciliationGroupState group, string? currentCycleId) =>
        GetDisposition(group, currentCycleId) is RecycleDisposition.ReviewRequired or RecycleDisposition.Blocked;

    public static bool IsBlocked(ReconciliationGroupState group) =>
        !string.IsNullOrWhiteSpace(group.LastIssue) &&
        group.LastIssue.StartsWith("BLOCKED:", StringComparison.Ordinal);

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
