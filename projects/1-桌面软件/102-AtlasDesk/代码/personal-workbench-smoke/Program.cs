using PersonalWorkbench;
using System.Text.Json.Nodes;

var failures = new List<string>();

void Check(bool condition, string name)
{
    if (condition) Console.WriteLine("PASS " + name);
    else { Console.WriteLine("FAIL " + name); failures.Add(name); }
}

var now = new DateTimeOffset(2026, 7, 31, 1, 0, 0, TimeSpan.Zero);
var first = StartupGuard.CreateNext(null, "0.6.2", now);
Check(first.Running && !first.PreviousSessionUnclean && first.ConsecutiveUncleanStarts == 0, "first startup is clean");

var crashed = StartupGuard.CreateNext(new StartupGuardState
{
    Version = "0.6.2", Running = true, ConsecutiveUncleanStarts = 1, LastStartUtc = now.AddMinutes(-2)
}, "0.6.2", now);
Check(crashed.PreviousSessionUnclean && crashed.ConsecutiveUncleanStarts == 2, "unclean startup increments counter");

var clean = StartupGuard.MarkClean(crashed, now.AddMinutes(1));
Check(!clean.Running && clean.ConsecutiveUncleanStarts == 0 && clean.LastCleanExitUtc.HasValue, "clean shutdown resets counter");

var sanitized = SupportBundleSanitizer.SanitizeSettingsJson("""
{
  "userName":"Fenlynn",
  "dashboardUrl":"https://example.com/private?token=abc",
  "workspaceRoot":"C:\\Users\\Fenlynn\\Research",
  "zoteroDbPath":"D:\\Zotero\\zotero.sqlite",
  "recentWorkspaceFiles":["C:\\secret\\a.md"]
}
""");
var sanitizedObject = JsonNode.Parse(sanitized)!.AsObject();
Check(sanitizedObject["userName"]?.GetValue<string>() == "<redacted>", "user name is redacted");
Check(sanitizedObject["dashboardUrl"]?.GetValue<string>() == "https://example.com", "dashboard query is removed");
Check(sanitizedObject["workspaceRoot"]?.GetValue<string>() == "<redacted-path>"
      && sanitizedObject["zoteroDbPath"]?.GetValue<string>() == "<redacted-path>"
      && sanitizedObject["recentWorkspaceFiles"]?.AsArray().All(item => item?.GetValue<string>() == "<redacted-path>") == true,
    "local paths are redacted");

var summary = DiagnosticsService.BuildSummary(new[]
{
    new DiagnosticCheck { Name = "Smoke", Detail = "ok", Severity = DiagnosticSeverity.Ok }
});
Check(summary.Contains("[正常] Smoke: ok", StringComparison.Ordinal), "diagnostic summary is stable");
Check(WorkbenchVersion.Current == "0.6.2", "assembly version matches Version.props");

if (failures.Count == 0)
{
    Console.WriteLine("SMOKE TESTS PASSED");
    return 0;
}

Console.Error.WriteLine("SMOKE TESTS FAILED: " + string.Join(", ", failures));
return 1;
