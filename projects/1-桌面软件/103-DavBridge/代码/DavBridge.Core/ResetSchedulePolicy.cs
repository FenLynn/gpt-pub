namespace DavBridge.Core;

public static class ResetSchedulePolicy
{
    public const int ProbeHourLocal = 9;

    public static DateTimeOffset NormalizeResetDate(DateTimeOffset value)
    {
        if (value == default)
            return default;

        var localDate = value.LocalDateTime.Date;
        return new DateTimeOffset(DateTime.SpecifyKind(localDate, DateTimeKind.Local));
    }

    public static DateTimeOffset GetProbeStart(DateTimeOffset resetDate)
    {
        if (resetDate == default)
            return default;

        var localDate = NormalizeResetDate(resetDate).LocalDateTime.Date;
        var localProbe = DateTime.SpecifyKind(localDate.AddHours(ProbeHourLocal), DateTimeKind.Local);
        return new DateTimeOffset(localProbe);
    }

    public static bool IsResetDateReached(DateTimeOffset resetDate, DateTimeOffset now)
    {
        if (resetDate == default)
            return false;

        return now.LocalDateTime.Date >= NormalizeResetDate(resetDate).LocalDateTime.Date;
    }

    public static bool CanStartProbe(DateTimeOffset resetDate, DateTimeOffset now)
    {
        if (!IsResetDateReached(resetDate, now))
            return false;

        return now >= GetProbeStart(resetDate);
    }

    public static DateTimeOffset GetNextResetDateAfterConfirmedProbe(DateTimeOffset currentResetDate, DateTimeOffset now)
    {
        if (currentResetDate == default)
            throw new ArgumentException("A reset date is required.", nameof(currentResetDate));

        var next = NormalizeResetDate(currentResetDate).AddMonths(1);
        while (next.LocalDateTime.Date <= now.LocalDateTime.Date)
            next = next.AddMonths(1);
        return NormalizeResetDate(next);
    }

    public static TimeSpan GetWaitUntilProbe(DateTimeOffset resetDate, DateTimeOffset now)
    {
        if (resetDate == default)
            return TimeSpan.FromHours(6);

        var probeAt = GetProbeStart(resetDate);
        if (now >= probeAt)
            return TimeSpan.FromHours(1);

        var remaining = probeAt - now;
        return remaining < TimeSpan.FromHours(6) ? remaining : TimeSpan.FromHours(6);
    }
}
