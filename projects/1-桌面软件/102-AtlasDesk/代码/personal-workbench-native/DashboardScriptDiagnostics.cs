using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;

namespace PersonalWorkbench;

/// <summary>
/// Adds read-only JavaScript diagnostics to the existing Dashboard WebView2 instances.
/// Normal alert/confirm/prompt dialogs remain owned by WebView2. Only the confirmed,
/// repeatedly reported runtime-error alert is suppressed inside the page.
/// </summary>
public sealed class DashboardScriptDiagnostics : IDisposable
{
    private const string MessageChannel = "atlasdesk-dashboard-diagnostic";
    private const string RepeatedRuntimeAlert = "Cannot use 'in' operator to search for 'type' in undefined";

    private static readonly FieldInfo? MainDashboardField = typeof(MainWindow)
        .GetField("_dashboardWebView", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly FieldInfo? PopupDashboardField = typeof(MainWindow)
        .GetField("_popupWebView", BindingFlags.Instance | BindingFlags.NonPublic);
    private static readonly Regex UrlPattern = new(
        @"https?://[^\s\)\]\}\""']+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private readonly MainWindow _window;
    private readonly HashSet<CoreWebView2> _configuredCores = new();
    private bool _configurationInProgress;
    private bool _disposed;

    private DashboardScriptDiagnostics(MainWindow window)
    {
        _window = window;
        _window.LayoutUpdated += Window_LayoutUpdated;
        _window.Closed += Window_Closed;
        _window.Dispatcher.BeginInvoke(new Action(() => _ = ConfigureCurrentViewsAsync()));
    }

    public static DashboardScriptDiagnostics Attach(MainWindow window) => new(window);

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;
        _window.LayoutUpdated -= Window_LayoutUpdated;
        _window.Closed -= Window_Closed;
        _configuredCores.Clear();
    }

    private void Window_Closed(object? sender, EventArgs e) => Dispose();

    private async void Window_LayoutUpdated(object? sender, EventArgs e)
    {
        await ConfigureCurrentViewsAsync();
    }

    private async Task ConfigureCurrentViewsAsync()
    {
        if (_disposed || _configurationInProgress)
            return;

        _configurationInProgress = true;
        try
        {
            await ConfigureViewAsync(MainDashboardField?.GetValue(_window) as WebView2, "main");
            await ConfigureViewAsync(PopupDashboardField?.GetValue(_window) as WebView2, "authentication-popup");
        }
        catch (Exception ex)
        {
            App.Log("Dashboard script diagnostics attachment failed: " + ex);
        }
        finally
        {
            _configurationInProgress = false;
        }
    }

    private async Task ConfigureViewAsync(WebView2? view, string role)
    {
        if (view?.CoreWebView2 is not { } core || !_configuredCores.Add(core))
            return;

        try
        {
            // Keep WebView2's native dialogs for normal website behavior. The injected
            // wrapper suppresses only the confirmed repeating runtime-error alert.
            core.Settings.AreDefaultScriptDialogsEnabled = true;
            core.WebMessageReceived += Core_WebMessageReceived;
            await core.AddScriptToExecuteOnDocumentCreatedAsync(InjectionScript);

            try
            {
                await core.ExecuteScriptAsync(InjectionScript);
            }
            catch (Exception ex)
            {
                // There may be no active document yet. Future navigations are already covered.
                App.Log($"Dashboard diagnostics current-document injection deferred [{role}]: {ex.Message}");
            }

            App.Log("Dashboard script diagnostics attached: " + role);
        }
        catch
        {
            _configuredCores.Remove(core);
            core.WebMessageReceived -= Core_WebMessageReceived;
            throw;
        }
    }

    private static void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            if (!TryParseDiagnostic(args.WebMessageAsJson, args.Source, out var diagnostic))
                return;

            App.Log(diagnostic.ToLogLine());
        }
        catch (Exception ex)
        {
            App.Log("Dashboard script diagnostic message could not be parsed: " + ex.Message);
        }
    }

    internal static bool TryParseDiagnostic(
        string json,
        string? eventSource,
        out DashboardScriptDiagnostic diagnostic)
    {
        diagnostic = default;
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !TryGetString(root, "channel", out var channel)
            || !string.Equals(channel, MessageChannel, StringComparison.Ordinal))
        {
            return false;
        }

        var kind = GetString(root, "kind", "unknown");
        var message = GetString(root, "message", "Unknown script error");
        var page = SanitizeUrl(GetString(root, "page", eventSource ?? string.Empty));
        var source = SanitizeUrl(GetString(root, "source", eventSource ?? string.Empty));
        var stack = SanitizeText(GetString(root, "stack", string.Empty), 4096);
        var frame = SanitizeText(GetString(root, "frame", "unknown"), 32);
        var line = GetInt(root, "line");
        var column = GetInt(root, "column");

        diagnostic = new DashboardScriptDiagnostic(
            SanitizeText(kind, 64),
            SanitizeText(message, 1024),
            page,
            source,
            line,
            column,
            frame,
            stack);
        return true;
    }

    internal static bool IsRepeatedRuntimeAlert(string? message)
        => string.Equals(message?.Trim(), RepeatedRuntimeAlert, StringComparison.Ordinal);

    private static bool TryGetString(JsonElement root, string property, out string value)
    {
        value = string.Empty;
        return root.TryGetProperty(property, out var element)
               && element.ValueKind == JsonValueKind.String
               && (value = element.GetString() ?? string.Empty) is not null;
    }

    private static string GetString(JsonElement root, string property, string fallback)
        => TryGetString(root, property, out var value) ? value : fallback;

    private static int GetInt(JsonElement root, string property)
        => root.TryGetProperty(property, out var element) && element.TryGetInt32(out var value)
            ? value
            : 0;

    private static string SanitizeUrl(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return string.Empty;

        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
            return SanitizeText(value, 512);

        if (uri.Scheme is not ("http" or "https"))
            return SanitizeText(uri.GetLeftPart(UriPartial.Path), 512);

        var builder = new UriBuilder(uri)
        {
            Query = string.Empty,
            Fragment = string.Empty
        };
        return SanitizeText(builder.Uri.AbsoluteUri, 512);
    }

    private static string SanitizeText(string? value, int maximumLength)
    {
        if (string.IsNullOrEmpty(value))
            return string.Empty;

        var withoutSensitiveUrls = UrlPattern.Replace(value, match => SanitizeUrl(match.Value));
        var compact = withoutSensitiveUrls
            .Replace("\r\n", " | ", StringComparison.Ordinal)
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Trim();
        return compact.Length <= maximumLength ? compact : compact[..maximumLength] + "…";
    }

    private const string InjectionScript = """
(() => {
  if (window.__atlasDeskDashboardDiagnosticsInstalled) return;
  window.__atlasDeskDashboardDiagnosticsInstalled = true;

  const channel = 'atlasdesk-dashboard-diagnostic';
  const repeatedAlert = "Cannot use 'in' operator to search for 'type' in undefined";
  const recent = new Map();

  const cleanUrl = value => {
    try {
      const url = new URL(String(value || ''), location.href);
      url.search = '';
      url.hash = '';
      return url.href;
    } catch {
      return String(value || '').slice(0, 512);
    }
  };

  const asText = value => {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); }
    catch { return String(value); }
  };

  const post = payload => {
    try {
      const key = [payload.kind, payload.message, payload.source, payload.line, payload.column].join('|');
      const now = Date.now();
      const previous = recent.get(key) || 0;
      if (now - previous < 5000) return;
      recent.set(key, now);
      window.chrome.webview.postMessage({
        channel,
        page: cleanUrl(location.href),
        frame: window.top === window ? 'top' : 'child',
        kind: String(payload.kind || 'unknown'),
        message: asText(payload.message).slice(0, 1024),
        source: cleanUrl(payload.source || location.href),
        line: Number(payload.line || 0),
        column: Number(payload.column || 0),
        stack: asText(payload.stack).slice(0, 4096)
      });
    } catch {
      // Diagnostics must never change page behavior.
    }
  };

  window.addEventListener('error', event => {
    post({
      kind: 'error',
      message: event.message || 'Script error',
      source: event.filename || location.href,
      line: event.lineno,
      column: event.colno,
      stack: event.error && event.error.stack ? event.error.stack : ''
    });
  }, true);

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    post({
      kind: 'unhandledrejection',
      message: reason && reason.message ? reason.message : asText(reason),
      source: location.href,
      stack: reason && reason.stack ? reason.stack : ''
    });
  });

  const nativeAlert = window.alert.bind(window);
  window.alert = value => {
    const message = asText(value);
    if (message.trim() === repeatedAlert) {
      post({
        kind: 'suppressed-alert',
        message,
        source: location.href,
        stack: new Error('Dashboard alert source').stack || ''
      });
      return;
    }
    return nativeAlert(value);
  };
})();
""";
}

public readonly record struct DashboardScriptDiagnostic(
    string Kind,
    string Message,
    string Page,
    string Source,
    int Line,
    int Column,
    string Frame,
    string Stack)
{
    public string ToLogLine()
        => $"Dashboard JS [{Kind}] message={Message}; page={Page}; source={Source}; line={Line}:{Column}; frame={Frame}; stack={Stack}";
}
