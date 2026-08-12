using System.Runtime.CompilerServices;
using DavBridge.Core;

internal static class ResetScheduleSmoke
{
    [ModuleInitializer]
    internal static void Run()
    {
        var localValue = new DateTimeOffset(DateTime.SpecifyKind(new DateTime(2026, 9, 7, 1, 23, 0), DateTimeKind.Local));
        var normalized = ResetSchedulePolicy.NormalizeResetDate(localValue);
        Assert(normalized.LocalDateTime.Date == new DateTime(2026, 9, 7), "reset date must preserve the local calendar date");
        Assert(normalized.LocalDateTime.TimeOfDay == TimeSpan.Zero, "reset value must be normalized to date-only midnight storage");

        var probeAt = ResetSchedulePolicy.GetProbeStart(normalized);
        Assert(probeAt.LocalDateTime.Date == new DateTime(2026, 9, 7), "probe must stay on the displayed reset date");
        Assert(probeAt.LocalDateTime.Hour == 9 && probeAt.LocalDateTime.Minute == 0, "probe must start at local 09:00");

        var before = new DateTimeOffset(DateTime.SpecifyKind(new DateTime(2026, 9, 7, 8, 59, 0), DateTimeKind.Local));
        var after = new DateTimeOffset(DateTime.SpecifyKind(new DateTime(2026, 9, 7, 9, 0, 0), DateTimeKind.Local));
        Assert(!ResetSchedulePolicy.CanStartProbe(normalized, before), "probe must not start before 09:00");
        Assert(ResetSchedulePolicy.CanStartProbe(normalized, after), "probe must be allowed from 09:00");

        var next = ResetSchedulePolicy.GetNextResetDateAfterConfirmedProbe(normalized, after);
        Assert(next.LocalDateTime.Date == new DateTime(2026, 10, 7), "confirmed reset must advance to the same calendar day next month");
        Assert(next.LocalDateTime.TimeOfDay == TimeSpan.Zero, "next reset must remain date-only");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException("Reset schedule smoke failed: " + message);
    }
}
