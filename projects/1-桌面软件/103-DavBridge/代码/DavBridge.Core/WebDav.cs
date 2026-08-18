using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;

namespace DavBridge.Core;

public sealed record DownloadResult(long Bytes, string Sha256);
public sealed record PutResult(HttpStatusCode StatusCode, bool Accepted);

public sealed class WebDavException : Exception
{
    public HttpStatusCode? StatusCode { get; }
    public string? ResponseBody { get; }

    public WebDavException(string message, HttpStatusCode? statusCode = null, string? responseBody = null)
        : base(message)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}

public interface IReadOnlyWebDavClient
{
    Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken);
    Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken);
    Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken);
    Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken);
}

public interface IWritableWebDavClient : IReadOnlyWebDavClient
{
    Task<PutResult> PutFileAsync(string relativePath, string localFilePath, int bytesPerSecond, CancellationToken cancellationToken);
}

public sealed class RequestGate
{
    private readonly SemaphoreSlim _mutex = new(1, 1);
    private readonly TimeSpan _minimumInterval;
    private DateTimeOffset _nextAllowed = DateTimeOffset.MinValue;

    public RequestGate(TimeSpan minimumInterval)
    {
        _minimumInterval = minimumInterval < TimeSpan.Zero ? TimeSpan.Zero : minimumInterval;
    }

    public async Task WaitAsync(CancellationToken cancellationToken)
    {
        await _mutex.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var now = DateTimeOffset.UtcNow;
            if (_nextAllowed > now)
                await Task.Delay(_nextAllowed - now, cancellationToken).ConfigureAwait(false);
            _nextAllowed = DateTimeOffset.UtcNow + _minimumInterval;
        }
        finally
        {
            _mutex.Release();
        }
    }
}

public class WebDavReadClient : IReadOnlyWebDavClient, IDisposable
{
    protected readonly HttpClient Http;
    protected readonly Uri BaseUri;
    protected readonly RequestGate? Gate;

    public WebDavReadClient(string baseUrl, string username, string password, RequestGate? gate = null, HttpMessageHandler? handler = null)
    {
        if (!baseUrl.EndsWith('/'))
            baseUrl += "/";
        BaseUri = new Uri(baseUrl, UriKind.Absolute);
        Gate = gate;

        if (handler is null)
        {
            var httpHandler = new HttpClientHandler
            {
                Credentials = new NetworkCredential(username, password),
                PreAuthenticate = true,
                AllowAutoRedirect = true,
                AutomaticDecompression = DecompressionMethods.All
            };
            Http = new HttpClient(httpHandler, disposeHandler: true);
        }
        else
        {
            Http = new HttpClient(handler, disposeHandler: true);
        }

        Http.Timeout = TimeSpan.FromMinutes(30);

        // InfiniCLOUD explicitly supports pre-emptive BASIC authentication. Keep the
        // header for the first request, while HttpClientHandler.Credentials also lets
        // .NET answer a fresh BASIC challenge after a benign endpoint redirect.
        var token = Convert.ToBase64String(Encoding.UTF8.GetBytes(username + ":" + password));
        Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", token);
        Http.DefaultRequestHeaders.UserAgent.ParseAdd("DavBridge/0.1.1");
    }

    public async Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
    {
        var uri = BuildUri(relativeDirectory, directory: true);
        using var request = BuildPropFind(uri, depth: "1");
        using var response = await SendAsync(request, cancellationToken).ConfigureAwait(false);
        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (response.StatusCode != HttpStatusCode.MultiStatus)
            throw BuildFailure("PROPFIND Depth:1", uri, response, body);

        return ParseMultiStatus(body, uri)
            .Where(x => !string.IsNullOrWhiteSpace(x.RelativePath))
            .ToArray();
    }

    public async Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken)
    {
        var uri = BuildUri(relativePath, directory: false);
        using var request = BuildPropFind(uri, depth: "0");
        using var response = await SendAsync(request, cancellationToken).ConfigureAwait(false);
        if (response.StatusCode == HttpStatusCode.NotFound)
            return null;

        var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (response.StatusCode != HttpStatusCode.MultiStatus)
            throw BuildFailure("PROPFIND Depth:0", uri, response, body);

        return ParseMultiStatus(body, uri).FirstOrDefault();
    }

    public async Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken)
    {
        var uri = BuildUri(relativePath, directory: false);
        await WaitGateAsync(cancellationToken).ConfigureAwait(false);
        using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw BuildFailure("GET", uri, response, body);
        }

        var directory = Path.GetDirectoryName(destinationPath);
        if (!string.IsNullOrWhiteSpace(directory))
            Directory.CreateDirectory(directory);

        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        await using var target = new FileStream(destinationPath, FileMode.Create, FileAccess.Write, FileShare.None, 128 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[128 * 1024];
        long total = 0;
        while (true)
        {
            var read = await source.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
            if (read == 0)
                break;
            await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            sha.AppendData(buffer, 0, read);
            total += read;
        }
        await target.FlushAsync(cancellationToken).ConfigureAwait(false);
        return new DownloadResult(total, Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant());
    }

    public async Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken)
    {
        var uri = BuildUri(relativePath, directory: false);
        await WaitGateAsync(cancellationToken).ConfigureAwait(false);
        using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw BuildFailure("GET verify", uri, response, body);
        }

        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
        using var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[128 * 1024];
        long total = 0;
        while (true)
        {
            var read = await source.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
            if (read == 0)
                break;
            sha.AppendData(buffer, 0, read);
            total += read;
        }
        return new DownloadResult(total, Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant());
    }

    protected async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await WaitGateAsync(cancellationToken).ConfigureAwait(false);
        return await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
    }

    protected async Task WaitGateAsync(CancellationToken cancellationToken)
    {
        if (Gate is not null)
            await Gate.WaitAsync(cancellationToken).ConfigureAwait(false);
    }

    protected Uri BuildUri(string relativePath, bool directory)
    {
        var clean = relativePath.Replace('\\', '/').Trim('/');
        var encoded = string.Join('/', clean.Split('/', StringSplitOptions.RemoveEmptyEntries).Select(Uri.EscapeDataString));
        if (directory && encoded.Length > 0 && !encoded.EndsWith('/'))
            encoded += "/";
        return new Uri(BaseUri, encoded);
    }

    private static HttpRequestMessage BuildPropFind(Uri uri, string depth)
    {
        const string body = "<?xml version=\"1.0\" encoding=\"utf-8\" ?>" +
                            "<d:propfind xmlns:d=\"DAV:\"><d:prop>" +
                            "<d:resourcetype/><d:getcontentlength/><d:getetag/><d:getlastmodified/>" +
                            "</d:prop></d:propfind>";
        var request = new HttpRequestMessage(new HttpMethod("PROPFIND"), uri);
        request.Headers.TryAddWithoutValidation("Depth", depth);
        request.Content = new StringContent(body, Encoding.UTF8, "application/xml");
        return request;
    }

    private static WebDavException BuildFailure(string operation, Uri uri, HttpResponseMessage response, string body)
    {
        var challenge = string.Join(", ", response.Headers.WwwAuthenticate.Select(x => x.ToString()));
        var suffix = string.IsNullOrWhiteSpace(challenge) ? string.Empty : $"; WWW-Authenticate={challenge}";
        return new WebDavException(
            $"{operation} failed for {uri.GetLeftPart(UriPartial.Path)}: {(int)response.StatusCode} {response.ReasonPhrase}{suffix}",
            response.StatusCode,
            body);
    }

    private IReadOnlyList<WebDavEntry> ParseMultiStatus(string xml, Uri requestUri)
    {
        XNamespace d = "DAV:";
        var doc = XDocument.Parse(xml, LoadOptions.None);
        var result = new List<WebDavEntry>();
        var requestDirectory = requestUri.AbsolutePath.EndsWith('/')
            ? requestUri.AbsolutePath
            : requestUri.AbsolutePath[..(requestUri.AbsolutePath.LastIndexOf('/') + 1)];

        foreach (var response in doc.Descendants(d + "response"))
        {
            var hrefValue = response.Element(d + "href")?.Value;
            if (string.IsNullOrWhiteSpace(hrefValue))
                continue;

            Uri hrefUri;
            if (Uri.TryCreate(hrefValue, UriKind.Absolute, out var parsedHref) && parsedHref is not null)
                hrefUri = parsedHref;
            else
                hrefUri = new Uri(BaseUri, hrefValue);

            var absolutePath = Uri.UnescapeDataString(hrefUri.AbsolutePath);
            var baseDirectory = Uri.UnescapeDataString(requestDirectory);
            string relative;
            if (absolutePath.StartsWith(baseDirectory, StringComparison.OrdinalIgnoreCase))
                relative = absolutePath[baseDirectory.Length..].Trim('/');
            else
                relative = absolutePath.Trim('/').Split('/').LastOrDefault() ?? string.Empty;

            var prop = response.Descendants(d + "prop").FirstOrDefault();
            var isCollection = prop?.Element(d + "resourcetype")?.Element(d + "collection") is not null;
            long? length = null;
            if (long.TryParse(prop?.Element(d + "getcontentlength")?.Value, out var parsedLength))
                length = parsedLength;
            var etag = prop?.Element(d + "getetag")?.Value?.Trim();
            DateTimeOffset? modified = null;
            if (DateTimeOffset.TryParse(prop?.Element(d + "getlastmodified")?.Value, out var parsedModified))
                modified = parsedModified;

            result.Add(new WebDavEntry(relative, isCollection, length, etag, modified));
        }

        return result;
    }

    public void Dispose() => Http.Dispose();
}

public sealed class WebDavWriteClient : WebDavReadClient, IWritableWebDavClient
{
    public WebDavWriteClient(string baseUrl, string username, string password, RequestGate? gate = null, HttpMessageHandler? handler = null)
        : base(baseUrl, username, password, gate, handler)
    {
    }

    public async Task<PutResult> PutFileAsync(string relativePath, string localFilePath, int bytesPerSecond, CancellationToken cancellationToken)
    {
        var uri = BuildUri(relativePath, directory: false);
        await WaitGateAsync(cancellationToken).ConfigureAwait(false);
        await using var file = new FileStream(localFilePath, FileMode.Open, FileAccess.Read, FileShare.Read, 128 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var throttled = new ThrottledReadStream(file, bytesPerSecond);
        using var content = new StreamContent(throttled, 128 * 1024);
        content.Headers.ContentLength = file.Length;
        using var request = new HttpRequestMessage(HttpMethod.Put, uri) { Content = content };
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw new WebDavException($"PUT failed for {uri.GetLeftPart(UriPartial.Path)}: {(int)response.StatusCode} {response.ReasonPhrase}", response.StatusCode, body);
        }
        return new PutResult(response.StatusCode, true);
    }
}

internal sealed class ThrottledReadStream : Stream
{
    private readonly Stream _inner;
    private readonly int _bytesPerSecond;
    private readonly System.Diagnostics.Stopwatch _watch = System.Diagnostics.Stopwatch.StartNew();
    private long _bytesRead;

    public ThrottledReadStream(Stream inner, int bytesPerSecond)
    {
        _inner = inner;
        _bytesPerSecond = bytesPerSecond;
    }

    private async ValueTask ThrottleAsync(int justRead, CancellationToken cancellationToken)
    {
        if (_bytesPerSecond <= 0 || justRead <= 0)
            return;
        _bytesRead += justRead;
        var expected = TimeSpan.FromSeconds((double)_bytesRead / _bytesPerSecond);
        var delay = expected - _watch.Elapsed;
        if (delay > TimeSpan.Zero)
            await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
    }

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var read = await _inner.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        await ThrottleAsync(read, cancellationToken).ConfigureAwait(false);
        return read;
    }

    public override int Read(byte[] buffer, int offset, int count)
    {
        var read = _inner.Read(buffer, offset, count);
        if (_bytesPerSecond > 0 && read > 0)
        {
            _bytesRead += read;
            var expected = TimeSpan.FromSeconds((double)_bytesRead / _bytesPerSecond);
            var delay = expected - _watch.Elapsed;
            if (delay > TimeSpan.Zero)
                Thread.Sleep(delay);
        }
        return read;
    }

    public override bool CanRead => _inner.CanRead;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => _inner.Length;
    public override long Position { get => _inner.Position; set => throw new NotSupportedException(); }
    public override void Flush() => _inner.Flush();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
