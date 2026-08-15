using System.Runtime.CompilerServices;
using DavBridge.Core;

namespace DavBridge.Smoke;

internal static class ReconciliationSmokeV030
{
    [ModuleInitializer]
    internal static void Run()
    {
        CycleIdUsesConfirmedResetDate();
        RecycleRequiresLaterCycle();
        DeferralOnlyCoversCurrentCycle();
        BlockedDeferralOnlyCoversCurrentCycle();
        HistoricalGroupMustBeComplete();
        WaitUserWasAppended();
    }

    private static void CycleIdUsesConfirmedResetDate()
    {
        var nextReset = new DateTimeOffset(2026, 10, 7, 0, 0, 0, TimeSpan.FromHours(8));
        var cycle = ReconciliationPolicy.DeriveCurrentCycleId(nextReset);
        Require(cycle == "260907", $"Expected cycle 260907, got {cycle ?? "null"}.");
        Require(ReconciliationPolicy.FormatCycleId(new DateTimeOffset(2026, 9, 7, 0, 0, 0, TimeSpan.Zero)) == "260907",
            "Cycle formatting must be yyMMdd.");
    }

    private static void RecycleRequiresLaterCycle()
    {
        var group = new ReconciliationGroupState
        {
            GroupKey = "A",
            FirstMissingCycleId = "260907"
        };
        Require(ReconciliationPolicy.GetDisposition(group, "260907") == RecycleDisposition.Observing,
            "A first-missing group must only be observed in the same cycle.");
        Require(ReconciliationPolicy.GetDisposition(group, "261007") == RecycleDisposition.ReviewRequired,
            "A group still missing in a later confirmed cycle must require human review.");
    }

    private static void DeferralOnlyCoversCurrentCycle()
    {
        var group = new ReconciliationGroupState
        {
            GroupKey = "B",
            FirstMissingCycleId = "260807",
            LastDeferredCycleId = "260907"
        };
        Require(ReconciliationPolicy.GetDisposition(group, "260907") == RecycleDisposition.DeferredThisCycle,
            "A human keep decision must unblock only the reviewed cycle.");
        Require(ReconciliationPolicy.GetDisposition(group, "261007") == RecycleDisposition.ReviewRequired,
            "A deferred group must return to review in the next confirmed cycle if still missing.");
    }

    private static void BlockedDeferralOnlyCoversCurrentCycle()
    {
        var group = new ReconciliationGroupState
        {
            GroupKey = "C",
            LastIssue = "BLOCKED: partial source group",
            LastDeferredCycleId = "260907"
        };
        Require(ReconciliationPolicy.GetDisposition(group, "260907") == RecycleDisposition.DeferredThisCycle,
            "A manually deferred safety anomaly must not keep the current cycle blocked.");
        Require(ReconciliationPolicy.GetDisposition(group, "261007") == RecycleDisposition.Blocked,
            "A deferred safety anomaly must surface again in the next cycle if it still exists.");
        Require(!ReconciliationPolicy.RequiresReview(group, "260907") && ReconciliationPolicy.RequiresReview(group, "261007"),
            "Blocked review gating must follow the current-cycle deferral decision.");
    }

    private static void HistoricalGroupMustBeComplete()
    {
        var zip = Record("A.zip");
        var prop = Record("A.prop");
        Require(ReconciliationPolicy.IsCompleteHistoricalGroup(new[] { zip, prop }),
            "A strongly verified zip+prop pair must be a complete historical group.");
        Require(!ReconciliationPolicy.IsCompleteHistoricalGroup(new[] { zip }),
            "A lone strongly verified zip must not be eligible for recycle deletion.");

        var generic = Record("metadata.json");
        Require(ReconciliationPolicy.IsCompleteHistoricalGroup(new[] { generic }),
            "A generic single-file group may be complete.");
    }

    private static void WaitUserWasAppended()
    {
        Require((int)EngineState.Paused == 0 &&
                (int)EngineState.Running == 1 &&
                (int)EngineState.WaitNetwork == 2 &&
                (int)EngineState.WaitQuota == 3 &&
                (int)EngineState.WaitRetry == 4 &&
                (int)EngineState.Complete == 5 &&
                (int)EngineState.WaitUser == 6,
            "EngineState legacy numeric values changed while adding WaitUser.");
    }

    private static TransferRecord Record(string relativePath) => new()
    {
        RelativePath = relativePath,
        GroupKey = Path.GetFileNameWithoutExtension(relativePath),
        SourceSha256 = "source",
        TargetSha256 = "target",
        VerifiedAt = DateTimeOffset.UtcNow,
        Status = TransferStatus.StrongVerified
    };

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("Reconciliation v0.3 smoke failed: " + message);
    }
}
