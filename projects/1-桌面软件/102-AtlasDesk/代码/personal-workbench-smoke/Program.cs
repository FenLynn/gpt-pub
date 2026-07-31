using PersonalWorkbench;
using System.Text.Json.Nodes;

var failures = new List<string>();

void Check(bool condition, string name)
{
    if (condition) Console.WriteLine("PASS " + name);
    else { Console.WriteLine("FAIL " + name); failures.Add(name); }
}

var now = new DateTimeOffset(2026, 7, 31, 1, 0, 0, TimeSpan.Zero);
var first = StartupGuard.CreateNext(null, WorkbenchVersion.Current, now);
Check(first.Running && !first.PreviousSessionUnclean && first.ConsecutiveUncleanStarts == 0, "first startup is clean");

var crashed = StartupGuard.CreateNext(new StartupGuardState
{
    Version = WorkbenchVersion.Current, Running = true, ConsecutiveUncleanStarts = 1, LastStartUtc = now.AddMinutes(-2)
}, WorkbenchVersion.Current, now);
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

var tempRoot = Path.Combine(Path.GetTempPath(), "pw-project-smoke-" + Guid.NewGuid().ToString("N"));
try
{
    var pythonProject = Path.Combine(tempRoot, "laser-model");
    Directory.CreateDirectory(Path.Combine(pythonProject, ".git"));
    File.WriteAllText(Path.Combine(pythonProject, ".git", "HEAD"), "ref: refs/heads/feature/thermal-model\n");
    File.WriteAllText(Path.Combine(pythonProject, "pyproject.toml"), "[project]\nname='laser-model'\n");

    var latexProject = Path.Combine(tempRoot, "paper");
    Directory.CreateDirectory(latexProject);
    File.WriteAllText(Path.Combine(latexProject, "main.tex"), "\\documentclass{article}");

    var dotnetProject = Path.Combine(tempRoot, "tools", "analyzer");
    Directory.CreateDirectory(dotnetProject);
    File.WriteAllText(Path.Combine(dotnetProject, "Analyzer.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\" />");

    var ignoredProject = Path.Combine(tempRoot, "node_modules", "ignored");
    Directory.CreateDirectory(ignoredProject);
    File.WriteAllText(Path.Combine(ignoredProject, "package.json"), "{}");

    var projects = ProjectCatalogService.Scan(tempRoot, 2, 20);
    var python = projects.SingleOrDefault(item => item.Name == "laser-model");
    Check(python is not null && python.Kind.HasFlag(ProjectKind.Git) && python.Kind.HasFlag(ProjectKind.Python), "git python project is detected");
    Check(python?.GitBranch == "feature/thermal-model", "git branch is parsed");
    Check(projects.Any(item => item.Kind.HasFlag(ProjectKind.Latex)), "latex project is detected");
    Check(projects.Any(item => item.Kind.HasFlag(ProjectKind.DotNet)), "nested dotnet project is detected");
    Check(projects.All(item => !item.RootPath.Contains("node_modules", StringComparison.OrdinalIgnoreCase)), "ignored directories are skipped");

    using var cancelled = new CancellationTokenSource();
    cancelled.Cancel();
    var cancellationObserved = false;
    try { _ = ProjectCatalogService.Scan(tempRoot, 2, 20, cancelled.Token); }
    catch (OperationCanceledException) { cancellationObserved = true; }
    Check(cancellationObserved, "project scan honors cancellation");
}
finally
{
    try { if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); } catch { }
}

var taskRoot = Path.Combine(Path.GetTempPath(), "pw-task-smoke-" + Guid.NewGuid().ToString("N"));
try
{
    Directory.CreateDirectory(Path.Combine(taskRoot, "sub"));
    Directory.CreateDirectory(Path.Combine(taskRoot, "node_modules", "ignored"));
    var abcPath = Path.Combine(taskRoot, "abc.txt");
    File.WriteAllText(abcPath, "abc");
    File.WriteAllBytes(Path.Combine(taskRoot, "sub", "payload.bin"), new byte[1024]);
    File.WriteAllBytes(Path.Combine(taskRoot, "node_modules", "ignored", "skip.bin"), new byte[50]);

    var hash = await WorkbenchTaskOperations.ComputeSha256Async(abcPath);
    Check(hash == "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD", "SHA-256 operation matches known vector");

    var statistics = WorkbenchTaskOperations.ScanDirectory(taskRoot);
    Check(statistics.FileCount == 2 && statistics.DirectoryCount == 1, "directory statistics count visible entries");
    Check(statistics.TotalBytes == 1027 && statistics.SkippedEntries >= 1, "directory statistics skip generated folders");

    using var cancelledHash = new CancellationTokenSource();
    cancelledHash.Cancel();
    var hashCancelled = false;
    try { _ = await WorkbenchTaskOperations.ComputeSha256Async(abcPath, cancellationToken: cancelledHash.Token); }
    catch (OperationCanceledException) { hashCancelled = true; }
    Check(hashCancelled, "file hash honors cancellation");

    var historyJson = WorkbenchTaskStore.Serialize(new[]
    {
        new WorkbenchTaskRecord { Type = WorkbenchTaskType.FileHash, Title = "running", TargetPath = abcPath, State = WorkbenchTaskState.Running, CreatedAt = now },
        new WorkbenchTaskRecord { Type = WorkbenchTaskType.DirectoryStatistics, Title = "done", TargetPath = taskRoot, State = WorkbenchTaskState.Completed, Result = "ok", CreatedAt = now.AddMinutes(-1) }
    });
    var restored = WorkbenchTaskStore.Deserialize(historyJson);
    Check(restored.Count == 2 && restored.Any(item => item.Title == "done" && item.State == WorkbenchTaskState.Completed), "task history round-trips completed records");
    Check(restored.Any(item => item.Title == "running" && item.State == WorkbenchTaskState.Failed && item.Error.Contains("中断")), "interrupted task history is normalized");

    using var lowConcurrency = new WorkbenchTaskService(0);
    using var highConcurrency = new WorkbenchTaskService(99);
    Check(WorkbenchTaskService.DefaultMaxConcurrency == 2 && lowConcurrency.MaxConcurrency == 1 && highConcurrency.MaxConcurrency == 8,
        "task concurrency policy is bounded");
    Check(new WorkbenchTaskRecord { State = WorkbenchTaskState.Queued }.ProgressLabel == "排队", "queued task has explicit progress label");
}
finally
{
    try { if (Directory.Exists(taskRoot)) Directory.Delete(taskRoot, true); } catch { }
}

var integrityRoot = Path.Combine(Path.GetTempPath(), "pw-integrity-smoke-" + Guid.NewGuid().ToString("N"));
try
{
    Directory.CreateDirectory(Path.Combine(integrityRoot, "sub"));
    Directory.CreateDirectory(Path.Combine(integrityRoot, "node_modules", "ignored"));
    var firstPath = Path.Combine(integrityRoot, "alpha.txt");
    var secondPath = Path.Combine(integrityRoot, "sub", "beta.bin");
    var ignoredPath = Path.Combine(integrityRoot, "node_modules", "ignored", "skip.txt");
    File.WriteAllText(firstPath, "abc");
    File.WriteAllBytes(secondPath, new byte[] { 1, 2, 3, 4, 5 });
    File.WriteAllText(ignoredPath, "skip");

    var manifestEntries = await FileIntegrityService.CreateManifestAsync(integrityRoot);
    Check(manifestEntries.Count == 2 && manifestEntries.All(item => !Path.IsPathRooted(item.RelativePath)), "manifest uses relative paths and skips generated folders");
    var manifestText = FileIntegrityService.FormatManifest(manifestEntries);
    var parsedEntries = FileIntegrityService.ParseManifest(manifestText);
    Check(parsedEntries.Count == 2 && parsedEntries.Select(item => item.RelativePath).SequenceEqual(manifestEntries.Select(item => item.RelativePath)), "manifest format round-trips");

    var manifestPath = Path.Combine(Path.GetTempPath(), "pw-integrity-" + Guid.NewGuid().ToString("N") + ".sha256");
    try
    {
        await FileIntegrityService.WriteManifestAtomicAsync(manifestPath, manifestEntries);
        var verified = await FileIntegrityService.VerifyManifestAsync(manifestPath, integrityRoot);
        Check(verified.Count == 2 && verified.All(item => item.Status == IntegrityVerificationStatus.Match), "fresh manifest verifies successfully");

        var copyPath = Path.Combine(integrityRoot, "alpha-copy.txt");
        File.Copy(firstPath, copyPath);
        var same = await FileIntegrityService.CompareFilesAsync(firstPath, copyPath);
        Check(same.IsIdentical, "identical files compare equal");
        File.AppendAllText(copyPath, "changed");
        var different = await FileIntegrityService.CompareFilesAsync(firstPath, copyPath);
        Check(!different.IsIdentical, "changed files compare different");
        File.Delete(copyPath);

        File.AppendAllText(secondPath, "changed");
        File.Delete(firstPath);
        var changedVerification = await FileIntegrityService.VerifyManifestAsync(manifestPath, integrityRoot);
        Check(changedVerification.Any(item => item.Status == IntegrityVerificationStatus.Changed), "modified file is detected");
        Check(changedVerification.Any(item => item.Status == IntegrityVerificationStatus.Missing), "missing file is detected");

        var unsafeManifest = FileIntegrityService.Header + Environment.NewLine
            + "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD *../escape.txt" + Environment.NewLine;
        await File.WriteAllTextAsync(manifestPath, unsafeManifest);
        var unsafeVerification = await FileIntegrityService.VerifyManifestAsync(manifestPath, integrityRoot);
        Check(unsafeVerification.Single().Status == IntegrityVerificationStatus.UnsafePath, "manifest path traversal is rejected");
    }
    finally
    {
        try { if (File.Exists(manifestPath)) File.Delete(manifestPath); } catch { }
    }
}
finally
{
    try { if (Directory.Exists(integrityRoot)) Directory.Delete(integrityRoot, true); } catch { }
}

var summary = DiagnosticsService.BuildSummary(new[]
{
    new DiagnosticCheck { Name = "Smoke", Detail = "ok", Severity = DiagnosticSeverity.Ok }
});
Check(summary.Contains("[正常] Smoke: ok", StringComparison.Ordinal), "diagnostic summary is stable");
Check(WorkbenchVersion.Current == "0.6.5", "assembly version matches Version.props");

if (failures.Count == 0)
{
    Console.WriteLine("SMOKE TESTS PASSED");
    return 0;
}

Console.Error.WriteLine("SMOKE TESTS FAILED: " + string.Join(", ", failures));
return 1;
