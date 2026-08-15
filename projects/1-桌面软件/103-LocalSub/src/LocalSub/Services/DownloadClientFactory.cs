using System.Net;
using LocalSub.Models;

namespace LocalSub.Services;

public static class DownloadClientFactory
{
    public static HttpClient Create(AppSettings settings)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.All,
            ConnectTimeout = TimeSpan.FromSeconds(20),
            PooledConnectionLifetime = TimeSpan.FromMinutes(5)
        };
        switch (settings.ProxyMode)
        {
            case ProxyMode.Direct:
                handler.UseProxy = false;
                break;
            case ProxyMode.Socks5:
                if (!Uri.TryCreate(settings.Socks5Url, UriKind.Absolute, out var proxyUri) || !proxyUri.Scheme.Equals("socks5", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("SOCKS5 地址格式应类似 socks5://127.0.0.1:7890");
                handler.UseProxy = true;
                handler.Proxy = new WebProxy(proxyUri);
                break;
            default:
                handler.UseProxy = true;
                break;
        }
        return new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
    }
}
