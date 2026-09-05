using System.Text;

namespace PersonalWorkbench;

internal static class DashboardHostProtocol
{
    public const string Prefix = "ATLASDESK_DASHBOARD";

    public static string Decode(string payload)
    {
        try { return Encoding.UTF8.GetString(Convert.FromBase64String(payload)); }
        catch { return payload; }
    }
}
