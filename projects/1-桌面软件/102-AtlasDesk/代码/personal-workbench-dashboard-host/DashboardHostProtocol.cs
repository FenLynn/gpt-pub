using System.Text;

namespace AtlasDesk.DashboardHost;

public static class DashboardHostMarker
{
}

internal static class DashboardHostProtocol
{
    public const string Prefix = "ATLASDESK_DASHBOARD";

    public static void Emit(string kind, string payload = "")
    {
        try
        {
            Console.Out.WriteLine(Prefix + "|" + kind + "|" + payload);
            Console.Out.Flush();
        }
        catch
        {
            // The parent process may already be gone.
        }
    }

    public static void Log(string message)
        => Emit("LOG", Encode(message));

    public static void Error(Exception exception)
        => Emit("ERROR", Encode(exception.ToString()));

    public static string Encode(string value)
        => Convert.ToBase64String(Encoding.UTF8.GetBytes(value ?? string.Empty));
}
