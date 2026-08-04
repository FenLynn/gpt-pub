using Microsoft.Win32;

namespace AtlasDesk.DashboardHost;

internal sealed record DashboardProxyConfiguration(
    string BrowserArguments,
    string Description)
{
    private const string InternetSettingsPath = @"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    public static DashboardProxyConfiguration Resolve()
    {
        var explicitProxy = Environment.GetEnvironmentVariable("ATLASDESK_DASHBOARD_PROXY");
        if (!string.IsNullOrWhiteSpace(explicitProxy))
        {
            if (string.Equals(explicitProxy.Trim(), "direct", StringComparison.OrdinalIgnoreCase)
                || string.Equals(explicitProxy.Trim(), "none", StringComparison.OrdinalIgnoreCase))
            {
                return Direct("环境变量明确要求直连");
            }

            if (TryBuildProxySwitch(explicitProxy, out var explicitSwitch))
                return WithSwitch(explicitSwitch, "AtlasDesk 环境变量代理");

            DashboardHostProtocol.Log(
                "ATLASDESK_DASHBOARD_PROXY was ignored because the value was invalid or contained credentials");
        }

        var httpsProxy = Environment.GetEnvironmentVariable("HTTPS_PROXY");
        if (TryBuildProxySwitch(httpsProxy, out var httpsSwitch))
            return WithSwitch(httpsSwitch, "HTTPS_PROXY 环境代理");

        var httpProxy = Environment.GetEnvironmentVariable("HTTP_PROXY");
        if (TryBuildProxySwitch(httpProxy, out var httpSwitch))
            return WithSwitch(httpSwitch, "HTTP_PROXY 环境代理");

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(InternetSettingsPath, writable: false);
            if (key is not null)
            {
                var enabled = Convert.ToInt32(key.GetValue("ProxyEnable") ?? 0) != 0;
                var proxyServer = key.GetValue("ProxyServer") as string;
                if (enabled && TryBuildProxySwitch(proxyServer, out var systemSwitch))
                    return WithSwitch(systemSwitch, "Windows 当前用户系统代理");

                var autoConfigUrl = key.GetValue("AutoConfigURL") as string;
                if (TryBuildPacSwitch(autoConfigUrl, out var pacSwitch))
                    return WithSwitch(pacSwitch, "Windows 当前用户 PAC 代理");
            }
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Log("Unable to inspect Windows user proxy settings: " + ex.Message);
        }

        return Direct("Windows 未检测到可用代理，使用系统默认网络路径");
    }

    private static DashboardProxyConfiguration Direct(string description)
        => new("--disable-gpu", description);

    private static DashboardProxyConfiguration WithSwitch(string proxySwitch, string description)
        => new("--disable-gpu " + proxySwitch, description);

    private static bool TryBuildProxySwitch(string? value, out string result)
    {
        result = string.Empty;
        var normalized = NormalizeSwitchValue(value);
        if (string.IsNullOrWhiteSpace(normalized))
            return false;

        if (Uri.TryCreate(normalized, UriKind.Absolute, out var uri)
            && !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        result = "--proxy-server=\"" + normalized + "\"";
        return true;
    }

    private static bool TryBuildPacSwitch(string? value, out string result)
    {
        result = string.Empty;
        var normalized = NormalizeSwitchValue(value);
        if (string.IsNullOrWhiteSpace(normalized)
            || !Uri.TryCreate(normalized, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https" or "file"))
        {
            return false;
        }

        result = "--proxy-pac-url=\"" + normalized + "\"";
        return true;
    }

    private static string NormalizeSwitchValue(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        var normalized = value.Trim();
        if (normalized.Length > 2048
            || normalized.Contains('"')
            || normalized.Contains('\r')
            || normalized.Contains('\n'))
        {
            return string.Empty;
        }

        return normalized;
    }
}
