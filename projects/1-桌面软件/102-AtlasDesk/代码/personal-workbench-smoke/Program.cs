using PersonalWorkbench;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

var failures = new List<string>();
void Check(bool condition, string name)
{
    if (condition) Console.WriteLine("PASS " + name);
    else { Console.WriteLine("FAIL " + name); failures.Add(name); }
}

void CheckThrows<T>(Action action, string name) where T : Exception
{
    try { action(); }
    catch (T) { Check(true, name); return; }
    Check(false, name);
}

var now = new DateTimeOffset(2026, 7, 31, 1, 0, 0, TimeSpan.Zero);
Check(WorkbenchVersion.Current == "0.6.6", "assembly version matches Version.props");

var firstStart = StartupGuard.CreateNext(null, WorkbenchVersion.Current, now);
var uncleanStart = StartupGuard.CreateNext(new StartupGuardState
{
    Version = WorkbenchVersion.Current, Running = true, ConsecutiveUncleanStarts = 1, LastStartUtc = now.AddMinutes(-1)
}, WorkbenchVersion.Current, now);
var cleanExit = StartupGuard.MarkClean(uncleanStart, now.AddMinutes(1));
Check(firstStart.Running && !firstStart.PreviousSessionUnclean, "startup guard recognizes first clean start");
Check(uncleanStart.PreviousSessionUnclean && uncleanStart.ConsecutiveUncleanStarts == 2, "startup guard counts interrupted sessions");
Check(!cleanExit.Running && cleanExit.ConsecutiveUncleanStarts == 0, "startup guard records clean exit");

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
Check(sanitizedObject["userName"]?.GetValue<string>() == "<redacted>", "support bundle redacts user name");
Check(sanitizedObject["dashboardUrl"]?.GetValue<string>() == "https://example.com", "support bundle removes dashboard query");
Check(sanitizedObject["workspaceRoot"]?.GetValue<string>() == "<redacted-path>"
      && sanitizedObject["zoteroDbPath"]?.GetValue<string>() == "<redacted-path>", "support bundle redacts local paths");

var projectRoot = NewTemp("pw-project");
try
{
    var python = Path.Combine(projectRoot, "laser-model");
    Directory.CreateDirectory(Path.Combine(python, ".git"));
    File.WriteAllText(Path.Combine(python, ".git", "HEAD"), "ref: refs/heads/feature/thermal-model\n");
    File.WriteAllText(Path.Combine(python, "pyproject.toml"), "[project]\nname='laser-model'\n");
    var paper = Path.Combine(projectRoot, "paper");
    Directory.CreateDirectory(paper);
    File.WriteAllText(Path.Combine(paper, "main.tex"), "\\documentclass{article}");
    var analyzer = Path.Combine(projectRoot, "tools", "analyzer");
    Directory.CreateDirectory(analyzer);
    File.WriteAllText(Path.Combine(analyzer, "Analyzer.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk\" />");
    var ignored = Path.Combine(projectRoot, "node_modules", "ignored");
    Directory.CreateDirectory(ignored);
    File.WriteAllText(Path.Combine(ignored, "package.json"), "{}");

    var projects = ProjectCatalogService.Scan(projectRoot, 2, 20);
    var detectedPython = projects.SingleOrDefault(item => item.Name == "laser-model");
    Check(detectedPython is not null && detectedPython.Kind.HasFlag(ProjectKind.Git)
          && detectedPython.Kind.HasFlag(ProjectKind.Python), "project center detects Git Python project");
    Check(detectedPython?.GitBranch == "feature/thermal-model", "project center reads Git branch");
    Check(projects.Any(item => item.Kind.HasFlag(ProjectKind.Latex))
          && projects.Any(item => item.Kind.HasFlag(ProjectKind.DotNet)), "project center detects LaTeX and .NET");
    Check(projects.All(item => !item.RootPath.Contains("node_modules", StringComparison.OrdinalIgnoreCase)), "project center skips generated directories");
    using var cancelled = new CancellationTokenSource();
    cancelled.Cancel();
    CheckThrows<OperationCanceledException>(() => ProjectCatalogService.Scan(projectRoot, 2, 20, cancelled.Token), "project scan is cancellable");
}
finally { DeleteTree(projectRoot); }

var taskRoot = NewTemp("pw-task");
try
{
    Directory.CreateDirectory(Path.Combine(taskRoot, "sub"));
    Directory.CreateDirectory(Path.Combine(taskRoot, "node_modules", "ignored"));
    var abc = Path.Combine(taskRoot, "abc.txt");
    File.WriteAllText(abc, "abc");
    File.WriteAllBytes(Path.Combine(taskRoot, "sub", "payload.bin"), new byte[1024]);
    File.WriteAllBytes(Path.Combine(taskRoot, "node_modules", "ignored", "skip.bin"), new byte[50]);

    var hash = await WorkbenchTaskOperations.ComputeSha256Async(abc);
    Check(hash == "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD", "task hash matches known SHA-256 vector");
    var statistics = WorkbenchTaskOperations.ScanDirectory(taskRoot);
    Check(statistics.FileCount == 2 && statistics.DirectoryCount == 1 && statistics.TotalBytes == 1027, "task directory statistics are correct");
    Check(statistics.SkippedEntries >= 1, "task statistics skip generated folders");

    var history = WorkbenchTaskStore.Deserialize(WorkbenchTaskStore.Serialize(new[]
    {
        new WorkbenchTaskRecord { Title = "running", State = WorkbenchTaskState.Running, CreatedAt = now },
        new WorkbenchTaskRecord { Title = "done", State = WorkbenchTaskState.Completed, Result = "ok", CreatedAt = now.AddMinutes(-1) }
    }));
    Check(history.Any(item => item.Title == "running" && item.State == WorkbenchTaskState.Failed), "task history normalizes interrupted work");
    using var low = new WorkbenchTaskService(0);
    using var high = new WorkbenchTaskService(99);
    Check(low.MaxConcurrency == 1 && high.MaxConcurrency == 8 && WorkbenchTaskService.DefaultMaxConcurrency == 2, "task concurrency is bounded");
}
finally { DeleteTree(taskRoot); }

var integrityRoot = NewTemp("pw-integrity");
try
{
    Directory.CreateDirectory(Path.Combine(integrityRoot, "sub"));
    Directory.CreateDirectory(Path.Combine(integrityRoot, "node_modules", "ignored"));
    var alpha = Path.Combine(integrityRoot, "alpha.txt");
    var beta = Path.Combine(integrityRoot, "sub", "beta.bin");
    File.WriteAllText(alpha, "abc");
    File.WriteAllBytes(beta, new byte[] { 1, 2, 3, 4, 5 });
    File.WriteAllText(Path.Combine(integrityRoot, "node_modules", "ignored", "skip.txt"), "skip");

    var entries = await FileIntegrityService.CreateManifestAsync(integrityRoot);
    Check(entries.Count == 2 && entries.All(item => !Path.IsPathRooted(item.RelativePath)), "integrity manifest is relative and skips generated folders");
    var parsed = FileIntegrityService.ParseManifest(FileIntegrityService.FormatManifest(entries));
    Check(parsed.Count == entries.Count, "integrity manifest round-trips");
    var manifestPath = Path.Combine(integrityRoot, "outside.sha256");
    await FileIntegrityService.WriteManifestAtomicAsync(manifestPath, entries);
    var verified = await FileIntegrityService.VerifyManifestAsync(manifestPath, integrityRoot);
    Check(verified.All(item => item.Status == IntegrityVerificationStatus.Match), "integrity manifest verifies fresh files");

    var copy = Path.Combine(integrityRoot, "alpha-copy.txt");
    File.Copy(alpha, copy);
    Check((await FileIntegrityService.CompareFilesAsync(alpha, copy)).IsIdentical, "integrity comparison detects identical files");
    File.AppendAllText(copy, "changed");
    Check(!(await FileIntegrityService.CompareFilesAsync(alpha, copy)).IsIdentical, "integrity comparison detects differences");
    File.Delete(copy);
    File.AppendAllText(beta, "changed");
    File.Delete(alpha);
    var changed = await FileIntegrityService.VerifyManifestAsync(manifestPath, integrityRoot);
    Check(changed.Any(item => item.Status == IntegrityVerificationStatus.Changed)
          && changed.Any(item => item.Status == IntegrityVerificationStatus.Missing), "integrity verification detects change and deletion");

    var unsafeText = FileIntegrityService.Header + Environment.NewLine
        + "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD *../escape.txt" + Environment.NewLine;
    File.WriteAllText(manifestPath, unsafeText);
    Check((await FileIntegrityService.VerifyManifestAsync(manifestPath, integrityRoot)).Single().Status == IntegrityVerificationStatus.UnsafePath,
        "integrity verification rejects path traversal");
}
finally { DeleteTree(integrityRoot); }

var backupRoot = NewTemp("pw-backup");
try
{
    var source = Path.Combine(backupRoot, "source");
    var target = Path.Combine(backupRoot, "target");
    Directory.CreateDirectory(source);
    Directory.CreateDirectory(target);
    File.WriteAllText(Path.Combine(source, "settings.json"), "{\"userName\":\"source\",\"workspaceRoot\":\"D:/Research\"}");
    File.WriteAllText(Path.Combine(source, "task-history.json"), "[]");
    File.WriteAllText(Path.Combine(source, "startup-state.json"), "{\"running\":true}");
    Directory.CreateDirectory(Path.Combine(source, "WebView2Profile"));
    File.WriteAllText(Path.Combine(source, "WebView2Profile", "Cookies"), "secret-cookie");
    Directory.CreateDirectory(Path.Combine(source, "BrowserProfile"));
    File.WriteAllText(Path.Combine(source, "BrowserProfile", "session"), "secret-session");

    File.WriteAllText(Path.Combine(target, "settings.json"), "{\"userName\":\"target-before\"}");
    File.WriteAllText(Path.Combine(target, "task-history.json"), "[{\"title\":\"old\"}]");
    var backupPath = Path.Combine(backupRoot, "config.pwbak");
    await WorkbenchBackupService.ExportAsync(source, backupPath);
    var validation = await WorkbenchBackupService.ValidateAsync(backupPath);
    Check(validation.IsValid, "backup validates after export");
    Check(validation.Files.OrderBy(item => item).SequenceEqual(new[] { "settings.json", "task-history.json" }), "backup contains only allowlisted files");
    using (var zip = ZipFile.OpenRead(backupPath))
    {
        Check(zip.Entries.All(entry => !entry.FullName.Contains("WebView2", StringComparison.OrdinalIgnoreCase)
                                      && !entry.FullName.Contains("BrowserProfile", StringComparison.OrdinalIgnoreCase)
                                      && !entry.FullName.Contains("startup-state", StringComparison.OrdinalIgnoreCase)),
            "backup excludes browser sessions and startup state");
    }

    var restored = await WorkbenchBackupService.RestoreAsync(backupPath, target, createPreRestoreSnapshot: true);
    Check(File.ReadAllText(Path.Combine(target, "settings.json")).Contains("source"), "backup restore writes settings");
    Check(File.ReadAllText(Path.Combine(target, "task-history.json")) == "[]", "backup restore writes task history");
    Check(File.Exists(restored.PreRestoreSnapshotPath), "backup restore creates pre-restore snapshot");
    Check((await WorkbenchBackupService.ValidateAsync(restored.PreRestoreSnapshotPath)).IsValid, "pre-restore snapshot validates");

    var corrupted = Path.Combine(backupRoot, "corrupted.pwbak");
    CreateCustomBackup(corrupted, "data/settings.json", Encoding.UTF8.GetBytes("{\"x\":1}"), declaredHash: new string('0', 64));
    Check(!(await WorkbenchBackupService.ValidateAsync(corrupted)).IsValid, "backup rejects checksum corruption");

    var traversal = Path.Combine(backupRoot, "traversal.pwbak");
    using (var archive = ZipFile.Open(traversal, ZipArchiveMode.Create))
    {
        WriteZipEntry(archive, "manifest.json", "{\"format\":\"PersonalWorkbench-Backup-v1\",\"sourceVersion\":\"0.6.6\",\"createdUtc\":\"2026-07-31T00:00:00Z\",\"entries\":[]}");
        WriteZipEntry(archive, "data/../evil.json", "{}");
    }
    Check(!(await WorkbenchBackupService.ValidateAsync(traversal)).IsValid, "backup rejects zip path traversal");
}
finally { DeleteTree(backupRoot); }

var summary = DiagnosticsService.BuildSummary(new[] { new DiagnosticCheck { Name = "Smoke", Detail = "ok", Severity = DiagnosticSeverity.Ok } });
Check(summary.Contains("[正常] Smoke: ok", StringComparison.Ordinal), "diagnostic summary remains stable");

if (failures.Count == 0)
{
    Console.WriteLine("SMOKE TESTS PASSED");
    return 0;
}
Console.Error.WriteLine("SMOKE TESTS FAILED: " + string.Join(", ", failures));
return 1;

static string NewTemp(string prefix)
{
    var path = Path.Combine(Path.GetTempPath(), prefix + "-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(path);
    return path;
}

static void DeleteTree(string path)
{
    try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { }
}

static void CreateCustomBackup(string path, string entryName, byte[] payload, string declaredHash)
{
    using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
    var manifest = new WorkbenchBackupManifest
    {
        Format = WorkbenchBackupService.FormatName,
        SourceVersion = "0.6.6",
        CreatedUtc = DateTimeOffset.UtcNow,
        Entries = new List<WorkbenchBackupEntry>
        {
            new() { Name = "settings.json", Size = payload.LongLength, Sha256 = declaredHash }
        }
    };
    WriteZipEntry(archive, "manifest.json", JsonSerializer.Serialize(manifest));
    var entry = archive.CreateEntry(entryName);
    using var stream = entry.Open();
    stream.Write(payload);
}

static void WriteZipEntry(ZipArchive archive, string name, string content)
{
    var entry = archive.CreateEntry(name);
    using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
    writer.Write(content);
}
