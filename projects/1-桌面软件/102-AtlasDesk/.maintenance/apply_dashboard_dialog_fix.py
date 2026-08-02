from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "代码"
NATIVE = ROOT / "personal-workbench-native"
SMOKE = ROOT / "personal-workbench-smoke"

main_path = NATIVE / "MainWindow.xaml.cs"
main = main_path.read_text(encoding="utf-8")
old = '''        core.Settings.AreBrowserAcceleratorKeysEnabled = true;

        core.NavigationStarting += (_, args) =>
'''
new = '''        core.Settings.AreBrowserAcceleratorKeysEnabled = true;

        if (isMainDashboard)
            ConfigureDashboardDiagnostics(core);

        core.NavigationStarting += (_, args) =>
'''
if old not in main:
    raise SystemExit("MainWindow dashboard settings anchor not found")
if "ConfigureDashboardDiagnostics(core);" in main:
    raise SystemExit("MainWindow dashboard diagnostics already installed")
main_path.write_text(main.replace(old, new, 1), encoding="utf-8", newline="\n")

partial = r'''using Microsoft.Web.WebView2.Core;

namespace PersonalWorkbench;

public partial class MainWindow
{
    private const string DashboardDiagnosticPrefix = "atlasdesk-dashboard-diagnostics:";

    private void ConfigureDashboardDiagnostics(CoreWebView2 core)
    {
        core.WebMessageReceived += DashboardDiagnostics_WebMessageReceived;
        _ = InstallDashboardDiagnosticsAsync(core);
    }

    private async Task InstallDashboardDiagnosticsAsync(CoreWebView2 core)
    {
        const string script = """
(() => {
  if (window.__atlasdeskDashboardDiagnosticsInstalled) return;
  window.__atlasdeskDashboardDiagnosticsInstalled = true;

  const prefix = 'atlasdesk-dashboard-diagnostics:';
  const safeText = value => {
    try {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value;
      if (value instanceof Error) return value.stack || value.message || String(value);
      return JSON.stringify(value);
    } catch (_) {
      try { return String(value); } catch (_) { return '<unprintable>'; }
    }
  };
  const send = (kind, payload) => {
    try {
      window.chrome?.webview?.postMessage(prefix + JSON.stringify({ kind, ...payload }));
    } catch (_) { }
  };
  const looksLikeRuntimeError = text =>
    /(?:TypeError|ReferenceError|SyntaxError|RangeError|Unhandled Promise Rejection|Cannot use ['\"]in['\"] operator|Cannot read properties of|is not defined)/i.test(text || '');

  const nativeAlert = window.alert.bind(window);
  window.alert = value => {
    const text = safeText(value);
    if (looksLikeRuntimeError(text)) {
      send('suppressed-alert', { message: text, href: location.href });
      return;
    }
    nativeAlert(text);
  };

  window.addEventListener('error', event => {
    send('error', {
      message: event.message || '',
      source: event.filename || '',
      line: event.lineno || 0,
      column: event.colno || 0,
      stack: safeText(event.error),
      href: location.href
    });
  }, true);

  window.addEventListener('unhandledrejection', event => {
    send('unhandledrejection', {
      message: safeText(event.reason),
      href: location.href
    });
  }, true);
})();
""";

        try
        {
            await core.AddScriptToExecuteOnDocumentCreatedAsync(script);
            App.Log("Dashboard JavaScript diagnostics installed");
        }
        catch (Exception ex)
        {
            App.Log("Install Dashboard JavaScript diagnostics failed: " + ex);
        }
    }

    private void DashboardDiagnostics_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            var message = args.TryGetWebMessageAsString();
            if (!message.StartsWith(DashboardDiagnosticPrefix, StringComparison.Ordinal))
                return;

            var detail = message[DashboardDiagnosticPrefix.Length..];
            if (detail.Length > 6000)
                detail = detail[..6000] + "…";
            App.Log("Dashboard JavaScript diagnostic: " + detail);

            if (_currentView == "dashboard")
            {
                AccessStatusText.Text = "页面脚本异常已记录";
                _ = RestoreDashboardStatusAsync();
            }
        }
        catch (ArgumentException)
        {
            // Ignore non-string web messages that belong to the hosted page itself.
        }
        catch (Exception ex)
        {
            App.Log("Read Dashboard JavaScript diagnostic failed: " + ex);
        }
    }

    private async Task RestoreDashboardStatusAsync()
    {
        await Task.Delay(3500);
        if (_currentView != "dashboard" || AccessStatusText.Text != "页面脚本异常已记录")
            return;
        UpdateAccessStatus(_dashboardWebView?.Source?.AbsoluteUri);
    }
}
'''
partial_path = NATIVE / "MainWindow.DashboardDiagnostics.cs"
if partial_path.exists():
    raise SystemExit("MainWindow.DashboardDiagnostics.cs already exists")
partial_path.write_text(partial, encoding="utf-8", newline="\n")

smoke_path = SMOKE / "V081SourceBoundaryChecks.cs"
smoke = smoke_path.read_text(encoding="utf-8")
anchor = '''        Console.WriteLine("PASS AtlasDesk v0.8.1 shell, WorkArea, development, Dashboard and startup-order source boundaries");
'''
insert = '''        RequireTokens(
            Path.Combine(nativeRoot, "MainWindow.xaml.cs"),
            "ConfigureDashboardDiagnostics(core)");

        var dashboardDiagnostics = File.ReadAllText(Path.Combine(nativeRoot, "MainWindow.DashboardDiagnostics.cs"));
        foreach (var required in new[]
                 {
                     "AddScriptToExecuteOnDocumentCreatedAsync",
                     "window.alert = value =>",
                     "suppressed-alert",
                     "unhandledrejection",
                     "TryGetWebMessageAsString",
                     "Dashboard JavaScript diagnostic"
                 })
        {
            if (!dashboardDiagnostics.Contains(required, StringComparison.Ordinal))
                throw new InvalidOperationException("Missing Dashboard diagnostic boundary: " + required);
        }
        Reject(dashboardDiagnostics, "AreDefaultScriptDialogsEnabled = false",
            "Dashboard diagnostics must not disable normal JavaScript dialogs");

        Console.WriteLine("PASS AtlasDesk v0.8.1 shell, WorkArea, development, Dashboard, startup-order and script-diagnostic source boundaries");
'''
if anchor not in smoke:
    raise SystemExit("V081 smoke anchor not found")
if "MainWindow.DashboardDiagnostics.cs" in smoke:
    raise SystemExit("V081 Dashboard diagnostics checks already installed")
smoke_path.write_text(smoke.replace(anchor, insert, 1), encoding="utf-8", newline="\n")

print("Applied AtlasDesk Dashboard dialog and JavaScript diagnostic fix")
