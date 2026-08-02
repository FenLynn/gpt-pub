namespace PersonalWorkbench;

public enum DashboardNavigationTarget
{
    MainDashboard,
    AuthenticationPopup,
    ExternalBrowser
}

public static class DashboardNavigationPolicy
{
    public static DashboardNavigationTarget Classify(string? requestedUri, string? dashboardRootUri)
    {
        if (!Uri.TryCreate(requestedUri, UriKind.Absolute, out var requested)
            || requested.Scheme is not ("http" or "https"))
            return DashboardNavigationTarget.ExternalBrowser;

        if (IsAuthenticationUri(requested))
            return DashboardNavigationTarget.AuthenticationPopup;

        if (Uri.TryCreate(dashboardRootUri, UriKind.Absolute, out var root)
            && SameOrigin(requested, root))
            return DashboardNavigationTarget.MainDashboard;

        return DashboardNavigationTarget.ExternalBrowser;
    }

    private static bool SameOrigin(Uri left, Uri right)
        => string.Equals(left.Scheme, right.Scheme, StringComparison.OrdinalIgnoreCase)
           && string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase)
           && left.Port == right.Port;

    private static bool IsAuthenticationUri(Uri uri)
    {
        var host = uri.Host.ToLowerInvariant();
        var path = uri.AbsolutePath.ToLowerInvariant();

        if (path.Contains("/cdn-cgi/access/", StringComparison.Ordinal))
            return true;
        if (host == "cloudflareaccess.com" || host.EndsWith(".cloudflareaccess.com", StringComparison.Ordinal)
            || host == "cloudflareaccess.org" || host.EndsWith(".cloudflareaccess.org", StringComparison.Ordinal))
            return true;
        if (host == "github.com" && (path.StartsWith("/login", StringComparison.Ordinal)
                                      || path.StartsWith("/session", StringComparison.Ordinal)
                                      || path.StartsWith("/sessions", StringComparison.Ordinal)))
            return true;
        if (host == "accounts.google.com" || host == "login.microsoftonline.com")
            return true;

        return false;
    }
}
