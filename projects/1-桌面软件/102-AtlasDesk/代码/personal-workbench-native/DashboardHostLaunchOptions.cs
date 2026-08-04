namespace PersonalWorkbench;

public sealed record DashboardHostLaunchOptions(
    string DashboardUrl,
    string ProfileDirectory,
    int ParentProcessId)
{
    public static bool TryParse(IReadOnlyList<string> arguments, out DashboardHostLaunchOptions options)
    {
        options = default!;
        if (!arguments.Any(value => string.Equals(value, "--dashboard-host", StringComparison.Ordinal)))
            return false;

        string? url = null;
        string? profile = null;
        var parentProcessId = 0;

        for (var index = 0; index < arguments.Count; index++)
        {
            var argument = arguments[index];
            if (string.Equals(argument, "--dashboard-url", StringComparison.Ordinal)
                && index + 1 < arguments.Count)
            {
                url = arguments[++index];
            }
            else if (string.Equals(argument, "--dashboard-profile", StringComparison.Ordinal)
                     && index + 1 < arguments.Count)
            {
                profile = arguments[++index];
            }
            else if (string.Equals(argument, "--parent-process", StringComparison.Ordinal)
                     && index + 1 < arguments.Count)
            {
                _ = int.TryParse(arguments[++index], out parentProcessId);
            }
        }

        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsedUrl)
            || parsedUrl.Scheme is not ("http" or "https")
            || string.IsNullOrWhiteSpace(profile)
            || parentProcessId <= 0)
        {
            return false;
        }

        options = new DashboardHostLaunchOptions(
            parsedUrl.AbsoluteUri,
            Path.GetFullPath(profile),
            parentProcessId);
        return true;
    }
}
