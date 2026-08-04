using System.Runtime.CompilerServices;
using System.Xml.Linq;

namespace PersonalWorkbench.Smoke;

internal static class V118AccessSessionContinuityChecks
{
    [ModuleInitializer]
    internal static void Verify()
    {
        var nativeRoot = FindProjectSourceRoot("personal-workbench-native");
        var hostRoot = FindProjectSourceRoot("personal-workbench-dashboard-host");
        var versionText = XDocument.Load(Path.Combine(nativeRoot, "Version.props"))
            .Descendants("WorkbenchVersion")
            .Select(node => node.Value.Trim())
            .FirstOrDefault();
        if (!Version.TryParse(versionText, out var version) || version < new Version(1, 1, 8))
            throw new InvalidOperationException("AtlasDesk must not move below the v1.1.8 Access session-continuity baseline.");

        var host = File.ReadAllText(RequireFile(hostRoot, "DashboardHostForm.cs"));
        var proxy = File.ReadAllText(RequireFile(hostRoot, "DashboardProxyResolver.cs"));
        var releaseNotes = File.ReadAllText(RequireFile(nativeRoot, "RELEASE_NOTES.txt"));

        RequireContains(host,
            "one WebView owns Dashboard and Access authentication",
            "EnterAuthenticationMode",
            "TryDetachForAuthentication",
            "SetParent(Handle, IntPtr.Zero)",
            "RestoreEmbeddedMode",
            "HasApplicationAccessCookieAsync",
            "CF_Authorization",
            "IsDashboardApplicationUri",
            "IsAuthenticationFlowUri",
            "New-window authentication kept in the existing Dashboard WebView",
            "case \"test-auth-flow\"",
            "AUTHMODE",
            "AUTHWINDOW",
            "DashboardProxyConfiguration.Resolve()");
        RequireAbsent(host,
            "_authenticationForm",
            "_authenticationView",
            "EnsureAuthenticationWindowAsync",
            "AuthenticationPopup_FormClosed",
            "args.NewWindow =");

        RequireContains(proxy,
            "ATLASDESK_DASHBOARD_PROXY",
            "HTTPS_PROXY",
            "HTTP_PROXY",
            "ProxyEnable",
            "ProxyServer",
            "AutoConfigURL",
            "--proxy-server=",
            "--proxy-pac-url=",
            "--disable-gpu",
            "contained credentials");

        RequireContains(releaseNotes,
            "AtlasDesk v1.1.8 Access session-continuity hotfix",
            "same WebView2 instance",
            "CF_Authorization",
            "Windows user proxy",
            "ATLASDESK_DASHBOARD_PROXY",
            "main remains the formal v1.0.0 baseline");

        Console.WriteLine(
            "PASS AtlasDesk retains the v1.1.8 single-WebView Access session, application-cookie verification and DashboardHost proxy-routing baseline");
    }

    private static string RequireFile(string root, string fileName)
    {
        var path = Path.Combine(root, fileName);
        if (!File.Exists(path))
            throw new InvalidOperationException("Missing v1.1.8 Access session-continuity source: " + fileName);
        return path;
    }

    private static void RequireContains(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (!source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing v1.1.8 Access session-continuity token: " + token);
        }
    }

    private static void RequireAbsent(string source, params string[] tokens)
    {
        foreach (var token in tokens)
        {
            if (source.Contains(token, StringComparison.Ordinal))
                throw new InvalidOperationException("Forbidden v1.1.8 split-session authentication token returned: " + token);
        }
    }

    private static string FindProjectSourceRoot(string projectDirectory)
    {
        foreach (var candidate in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var current = new DirectoryInfo(candidate);
            while (current is not null)
            {
                var path = Path.Combine(
                    current.FullName,
                    "projects",
                    "1-桌面软件",
                    "102-AtlasDesk",
                    "代码",
                    projectDirectory);
                if (Directory.Exists(path))
                    return path;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate AtlasDesk v1.1.8 sources.");
    }
}
