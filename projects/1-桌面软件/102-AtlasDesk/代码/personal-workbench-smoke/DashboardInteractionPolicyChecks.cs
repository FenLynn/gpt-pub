using System.Runtime.CompilerServices;

namespace PersonalWorkbench.Smoke;

internal static class DashboardInteractionPolicyChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        const string root = "https://660415.xyz";

        Check(!DashboardInteractionCoordinator.ShouldOpenExternally(root + "/", root),
            "Dashboard root remains internal");
        Check(!DashboardInteractionCoordinator.ShouldOpenExternally(root + "/#reading", root),
            "Dashboard same-origin routes remain internal");
        Check(!DashboardInteractionCoordinator.ShouldOpenExternally(
                "https://example.cloudflareaccess.com/cdn-cgi/access/login", root),
            "Cloudflare Access remains internal");
        Check(!DashboardInteractionCoordinator.ShouldOpenExternally(
                "https://accounts.google.com/o/oauth2/v2/auth", root),
            "Google authentication remains internal");
        Check(DashboardInteractionCoordinator.ShouldOpenExternally(
                "https://www.editorialmanager.com/jolt/default2.aspx", root),
            "Editorial Manager opens in the default browser");
        Check(DashboardInteractionCoordinator.ShouldOpenExternally(
                "https://aistudio.google.com/prompts/new_chat", root),
            "Google AI Studio opens in the default browser");
        Check(!DashboardInteractionCoordinator.ShouldOpenExternally("about:blank", root),
            "non-HTTP bootstrap navigation is not redirected");

        Console.WriteLine("PASS Dashboard top-level mixed-navigation policy");
    }

    private static void Check(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException(message);
    }
}
