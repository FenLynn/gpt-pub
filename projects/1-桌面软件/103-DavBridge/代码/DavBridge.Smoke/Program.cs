using System.Security.Cryptography;
using DavBridge.Core;

var tests = new List<(string Name, Func<Task> Run)>
{
    ("zip prop grouping", TestGroupingAsync),
    ("quota reserve and sprint", TestQuotaAsync),
    ("state backup recovery", TestStateRecoveryAsync),
    ("strong verified happy path", TestHappyPathAsync),
    ("put success but target absent", TestFalseSuccessAsync),
    ("source changes during transfer", TestSourceChangedAsync),
    ("matching preexisting target is adopted", TestMatchingPreexistingTargetAsync),
    ("download quota protects preexisting verification", TestDownloadQuotaAsync),
    ("different preexisting target conflicts", TestUnknownTargetConflictAsync),
    ("crash recovery after put", TestCrashRecoveryAsync),
    ("partial group budgets only unfinished member", TestPartialGroupQuotaAsync),
    ("oversize object blocks safely", TestOversizeAsync),
    ("safe pause stops before next member", TestSafePauseAsync),
    ("repeated pause resume remains idempotent", TestRepeatedPauseResumeAsync),
    ("persistent pause restart sequence converges without duplicate put", TestPersistentPauseRestartConvergenceAsync),
    ("network list failure recovers on retry", TestNetworkRetryAsync),
    ("verification network loss recovers without re-put", TestVerificationRetryWithoutReputAsync),
    ("zero byte object verifies safely", TestZeroByteAsync),
    ("quota exact boundary is deterministic", TestQuotaExactBoundaryAsync),
    ("large zotero manifest", TestLargeManifestAsync)
};

var passed = 0;
foreach (var test in tests)
{
    try
    {
        await test.Run();
        Console.WriteLine($"PASS {test.Name}");
        passed++;
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"FAIL {test.Name}: {ex}");
        Environment.ExitCode = 1;
    }
}
Console.WriteLine($"DavBridge smoke: {passed}/{tests.Count} passed");
if (passed != tests.Count)
    Environment.Exit(1);

static Task TestGroupingAsync()
{
    var entries = new[]
    {
        new WebDavEntry("ABC.zip", false, 10, "z1", DateTimeOffset.UtcNow),
        new WebDavEntry("ABC.prop", false, 2, "p1", DateTimeOffset.UtcNow),
        new WebDavEntry("other.bin", false, 5, "o1", DateTimeOffset.UtcNow)
    };
    var groups = MigrationPlanner.CreateGroups(entries);
    Check(groups.Count == 2, "expected two logical groups");
    var zotero = groups.Single(x => x.Key.Equals("ABC", StringComparison.OrdinalIgnoreCase));
    Check(zotero.Members.Count == 2, "zip and prop must stay in one group");
    return Task.CompletedTask;
}

static Task TestQuotaAsync()
{
    var config = new DavBridgeConfig
    {
        UploadQuotaBytes = 1_000_000_000,
        DownloadQuotaBytes = 3_000_000_000,
        NormalReserveBytes = 50_000_000,
        SprintReserveBytes = 5_000_000,
        NextResetAt = DateTimeOffset.Now.AddDays(2),
        CalibrationUploadUsedBytes = 900_000_000,
        CalibrationDownloadUsedBytes = 1_000_000_000
    };
    var state = new MigrationState();
    var normal = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
    Check(normal.ReservedBytes == 50_000_000, "normal reserve must be 50 MB");
    Check(normal.SafeRemainingBytes == 50_000_000, "normal upload remaining mismatch");
    Check(normal.SafeDownloadRemainingBytes == 1_950_000_000, "normal download remaining mismatch");
    Check(!normal.IsSprint, "must not sprint two days before reset");

    config.NextResetAt = DateTimeOffset.Now.AddHours(1);
    var sprint = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
    Check(sprint.IsSprint, "must sprint within 24 hours");
    Check(sprint.ReservedBytes == 5_000_000, "sprint reserve must be 5 MB");
    Check(sprint.SafeRemainingBytes == 95_000_000, "sprint upload remaining mismatch");
    Check(sprint.SafeDownloadRemainingBytes == 1_995_000_000, "sprint download remaining mismatch");
    return Task.CompletedTask;
}

static async Task TestStateRecoveryAsync()
{
    var root = NewTempRoot();
    try
    {
        var path = Path.Combine(root, "state.json");
        var store = new StateStore(path);
        await store.SaveAsync(new MigrationState { UploadAttemptBytesSinceCalibration = 111 });
        await store.SaveAsync(new MigrationState { UploadAttemptBytesSinceCalibration = 222 });
        File.WriteAllText(path, "{broken");
        var loaded = await store.LoadAsync();
        Check(loaded.UploadAttemptBytesSinceCalibration == 111, "corrupt primary must fall back to previous backup");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestHappyPathAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]>
    {
        ["zotero/ABC.zip"] = Bytes("zip-content"),
        ["zotero/ABC.prop"] = Bytes("prop-content")
    });
    var target = new FakeWriteClient();
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "engine should complete");
        Check(state.Files.Count == 2, "two records expected");
        Check(state.Files.Values.All(x => x.Status == TransferStatus.StrongVerified), "all members must be strongly verified");
        Check(state.UploadAttemptBytesSinceCalibration == source.TotalBytes, "all PUT attempts must be conservatively counted");
        Check(state.VerifiedDownloadBytesSinceCalibration == source.TotalBytes, "target verification downloads must be counted");
        Check(target.PutCount == 2, "each member should be uploaded once");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestFalseSuccessAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = Bytes("hello") });
    var target = new FakeWriteClient { DropWrites = true };
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.WaitRetry, "fake PUT success must enter retry state when target is absent");
        Check(state.Files["A.bin"].Status == TransferStatus.Failed, "fake success must never become verified");
        Check(state.UploadAttemptBytesSinceCalibration == 5, "failed PUT must remain conservatively charged");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestSourceChangedAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = Bytes("hello") })
    {
        MutateOnSecondMetadataRead = true
    };
    var target = new FakeWriteClient();
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.Files["A.bin"].Status == TransferStatus.SourceChanged, "source mutation must invalidate the transfer");
        Check(state.EngineState == EngineState.WaitRetry, "source mutation must never end as Complete");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestMatchingPreexistingTargetAsync()
{
    var data = Bytes("goodsync-already-copied");
    var source = new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
    var target = new FakeWriteClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var config = TestConfig();
        config.UploadQuotaBytes = 50_000_001;
        config.NormalReserveBytes = 50_000_000;
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(config, state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "byte-identical preexisting target should be adopted even with no meaningful upload budget");
        Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "adopted target must become strongly verified");
        Check(target.PutCount == 0, "matching preexisting target must not be uploaded again");
        Check(state.UploadAttemptBytesSinceCalibration == 0, "adoption must not consume upload quota");
        Check(state.VerifiedDownloadBytesSinceCalibration == data.LongLength, "adoption must count the target verification download");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestDownloadQuotaAsync()
{
    var data = Bytes("0123456789");
    var source = new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
    var target = new FakeWriteClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
    var config = TestConfig();
    config.DownloadQuotaBytes = 59;
    config.NormalReserveBytes = 50;
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(config, state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.WaitQuota, "existing-target verification must wait when safe download budget is insufficient");
        Check(target.DownloadCount == 0, "download quota guard must stop before target bytes are read");
        Check(target.PutCount == 0, "download quota guard must never cause a PUT");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestUnknownTargetConflictAsync()
{
    var sourceData = Bytes("source-content");
    var targetData = Bytes("different-target-content");
    var source = new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = sourceData });
    var target = new FakeWriteClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = targetData });
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.Files["A.bin"].Status == TransferStatus.Conflict, "different untrusted target must remain a conflict");
        Check(state.EngineState == EngineState.WaitRetry, "conflict must not end as Complete");
        Check(target.PutCount == 0, "untrusted different target must not be overwritten");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestCrashRecoveryAsync()
{
    var data = Bytes("already-uploaded");
    var hash = Hash(data);
    var source = new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
    var target = new FakeWriteClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState
        {
            UploadAttemptBytesSinceCalibration = data.LongLength,
            Files = new Dictionary<string, TransferRecord>(StringComparer.OrdinalIgnoreCase)
            {
                ["A.bin"] = new TransferRecord
                {
                    RelativePath = "A.bin",
                    GroupKey = "A.bin",
                    SourceSize = data.LongLength,
                    SourceSha256 = hash,
                    LastAttemptedUploadSha256 = hash,
                    Status = TransferStatus.Uploading
                }
            }
        };
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "trusted in-flight target should recover to Complete");
        Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "recovered target must become strongly verified");
        Check(target.PutCount == 0, "crash recovery must not spend upload quota a second time when target already matches");
        Check(state.UploadAttemptBytesSinceCalibration == data.LongLength, "prior conservative upload accounting must stay unchanged");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestPartialGroupQuotaAsync()
{
    var zip = Enumerable.Repeat((byte)1, 100).ToArray();
    var prop = Enumerable.Repeat((byte)2, 10).ToArray();
    var source = new FakeReadClient(new Dictionary<string, byte[]>
    {
        ["zotero/ABC.zip"] = zip,
        ["zotero/ABC.prop"] = prop
    });
    var target = new FakeWriteClient(new Dictionary<string, byte[]> { ["zotero/ABC.zip"] = zip });
    var manifest = await source.ListDirectoryAsync("zotero", CancellationToken.None);
    var zipEntry = manifest.Single(x => x.RelativePath == "ABC.zip");

    var state = new MigrationState
    {
        Files = new Dictionary<string, TransferRecord>(StringComparer.OrdinalIgnoreCase)
        {
            ["ABC.zip"] = new TransferRecord
            {
                RelativePath = "ABC.zip",
                GroupKey = "ABC",
                SourceSize = zip.LongLength,
                SourceETag = zipEntry.ETag,
                SourceLastModified = zipEntry.LastModified,
                SourceSha256 = Hash(zip),
                TargetSha256 = Hash(zip),
                Status = TransferStatus.StrongVerified,
                VerifiedAt = DateTimeOffset.UtcNow
            }
        }
    };
    var config = TestConfig();
    config.UploadQuotaBytes = 165;
    config.NormalReserveBytes = 50;
    config.CalibrationUploadUsedBytes = 100;

    var root = NewTempRoot();
    try
    {
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(config, state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "only unfinished prop should be budgeted");
        Check(state.Files["ABC.prop"].Status == TransferStatus.StrongVerified, "prop should complete inside the remaining quota");
        Check(target.PutCount == 1, "verified zip must not be uploaded again");
        Check(state.UploadAttemptBytesSinceCalibration == 10, "only prop bytes should be charged after calibration");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestOversizeAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/large.bin"] = new byte[20] });
    var target = new FakeWriteClient();
    var config = TestConfig();
    config.TargetSingleFileLimitBytes = 10;
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(config, state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.Files["large.bin"].Status == TransferStatus.BlockedOversize, "oversize object must be blocked");
        Check(state.EngineState == EngineState.WaitRetry, "oversize object must not end as Complete");
        Check(target.PutCount == 0, "oversize object must never be uploaded");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestSafePauseAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]>
    {
        ["zotero/A.bin"] = Bytes("first-file"),
        ["zotero/B.bin"] = Bytes("second-file")
    });
    var pauseRequested = false;
    var target = new FakeWriteClient
    {
        AfterPut = count => { if (count == 1) pauseRequested = true; }
    };
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"),
            pauseRequested: () => pauseRequested);
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Paused, "safe pause must end in Paused");
        Check(target.PutCount == 1, "safe pause must not start the next member");
        Check(state.Files.TryGetValue("A.bin", out var first) && first.Status == TransferStatus.StrongVerified,
            "the in-flight member must finish strong verification before pause");
        Check(!state.Files.TryGetValue("B.bin", out var second) || second.Status != TransferStatus.StrongVerified,
            "the next member must remain unprocessed");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestRepeatedPauseResumeAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]>
    {
        ["zotero/A.bin"] = Bytes("first-file"),
        ["zotero/B.bin"] = Bytes("second-file"),
        ["zotero/C.bin"] = Bytes("third-file")
    });
    var pauseRequested = false;
    var pauseAfterPutCount = 1;
    var target = new FakeWriteClient
    {
        AfterPut = count =>
        {
            if (count == pauseAfterPutCount)
                pauseRequested = true;
        }
    };
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));

        var first = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"),
            pauseRequested: () => pauseRequested);
        await first.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Paused, "first pause must end in Paused");
        Check(target.PutCount == 1, "first pass must upload exactly one member");
        Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "first member must be verified before first pause");

        pauseRequested = false;
        pauseAfterPutCount = 2;
        var second = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"),
            pauseRequested: () => pauseRequested);
        await second.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Paused, "second pause must also end in Paused");
        Check(target.PutCount == 2, "second pass must upload exactly one additional member");
        Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "first verified member must remain verified");
        Check(state.Files["B.bin"].Status == TransferStatus.StrongVerified, "second member must be verified before second pause");

        pauseRequested = false;
        pauseAfterPutCount = int.MaxValue;
        var third = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"),
            pauseRequested: () => pauseRequested);
        await third.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "third pass should finish the remaining member");
        Check(target.PutCount == 3, "verified members must never be uploaded again after resume");
        Check(state.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified) == 3,
            "all three members must be strongly verified after repeated pause/resume");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestPersistentPauseRestartConvergenceAsync()
{
    const int fileCount = 12;
    var payloads = Enumerable.Range(0, fileCount)
        .ToDictionary(i => $"zotero/F{i:D2}.bin", i => Bytes($"payload-{i:D2}"));

    var source = new FakeReadClient(payloads);
    var pauseRequested = false;
    var pauseAfterPutCount = 1;
    var target = new FakeWriteClient
    {
        AfterPut = count =>
        {
            if (count == pauseAfterPutCount)
                pauseRequested = true;
        }
    };

    var root = NewTempRoot();
    try
    {
        var statePath = Path.Combine(root, "state.json");
        var store = new StateStore(statePath);

        for (var pass = 0; pass < fileCount; pass++)
        {
            var state = File.Exists(statePath) ? await store.LoadAsync() : new MigrationState();
            pauseRequested = false;
            pauseAfterPutCount = target.PutCount + 1;

            var engine = new MigrationEngine(
                TestConfig(),
                state,
                store,
                source,
                target,
                Path.Combine(root, "temp"),
                pauseRequested: () => pauseRequested);

            await engine.RunAsync(CancellationToken.None);

            Check(state.EngineState == EngineState.Paused,
                $"restart pass {pass + 1} must stop at the safe pause boundary");
            Check(target.PutCount == pass + 1,
                $"restart pass {pass + 1} must add exactly one PUT");
            Check(state.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified) == pass + 1,
                $"restart pass {pass + 1} must persist every completed StrongVerified member");
        }

        var finalState = await store.LoadAsync();
        pauseRequested = false;
        pauseAfterPutCount = int.MaxValue;

        var finalEngine = new MigrationEngine(
            TestConfig(),
            finalState,
            store,
            source,
            target,
            Path.Combine(root, "temp"),
            pauseRequested: () => pauseRequested);

        await finalEngine.RunAsync(CancellationToken.None);

        Check(finalState.EngineState == EngineState.Complete,
            "final restart must converge to Complete");
        Check(target.PutCount == fileCount,
            "completed members must never be PUT again across repeated process-style restarts");
        Check(finalState.Files.Values.Count(x => x.Status == TransferStatus.StrongVerified) == fileCount,
            "all members must remain StrongVerified after persistent restart convergence");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestNetworkRetryAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]>
    {
        ["zotero/A.bin"] = Bytes("network-retry")
    })
    {
        ListFailuresRemaining = 1
    };
    var target = new FakeWriteClient();
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));

        var first = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await first.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.WaitNetwork, "transient source listing failure must enter WaitNetwork");
        Check(target.PutCount == 0, "network failure before listing completes must not PUT");

        var second = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await second.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "next safe pass must recover after transient network failure");
        Check(target.PutCount == 1, "recovered pass must upload the object exactly once");
        Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "recovered object must become StrongVerified");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestVerificationRetryWithoutReputAsync()
{
    var data = Bytes("verify-after-network-loss");
    var source = new FakeReadClient(new Dictionary<string, byte[]>
    {
        ["zotero/A.bin"] = data
    });
    var target = new FakeWriteClient
    {
        DownloadFailuresRemaining = 1
    };
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));

        var first = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await first.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.WaitNetwork, "verification network loss must enter WaitNetwork");
        Check(target.PutCount == 1, "first pass must have uploaded exactly once before verification failed");
        Check(state.UploadAttemptBytesSinceCalibration == data.LongLength,
            "failed verification must not lose conservative upload accounting");

        var second = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await second.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "retry must safely adopt the already uploaded target");
        Check(target.PutCount == 1, "retry after verification loss must never PUT the same bytes again");
        Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "retry must finish StrongVerified");
        Check(state.UploadAttemptBytesSinceCalibration == data.LongLength,
            "retry must not double-charge upload bytes");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestZeroByteAsync()
{
    var source = new FakeReadClient(new Dictionary<string, byte[]>
    {
        ["zotero/empty.bin"] = Array.Empty<byte>()
    });
    var target = new FakeWriteClient();
    var root = NewTempRoot();
    try
    {
        var state = new MigrationState();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);

        Check(state.EngineState == EngineState.Complete, "zero byte object must complete safely");
        Check(target.PutCount == 1, "zero byte object still requires one target PUT");
        Check(state.Files["empty.bin"].Status == TransferStatus.StrongVerified, "zero byte object must be StrongVerified");
        Check(state.UploadAttemptBytesSinceCalibration == 0, "zero byte upload must not consume quota");
        Check(state.VerifiedDownloadBytesSinceCalibration == 0, "zero byte verification must not consume download bytes");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestQuotaExactBoundaryAsync()
{
    var exact = Bytes("0123456789");
    var config = TestConfig();
    config.UploadQuotaBytes = 60;
    config.NormalReserveBytes = 50;
    config.DownloadQuotaBytes = 1_000;
    var root = NewTempRoot();
    try
    {
        var exactState = new MigrationState();
        var exactStore = new StateStore(Path.Combine(root, "exact-state.json"));
        var exactTarget = new FakeWriteClient();
        var exactEngine = new MigrationEngine(
            config,
            exactState,
            exactStore,
            new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = exact }),
            exactTarget,
            Path.Combine(root, "exact-temp"));
        await exactEngine.RunAsync(CancellationToken.None);
        Check(exactState.EngineState == EngineState.Complete, "required bytes equal to safe remaining must be allowed");
        Check(exactTarget.PutCount == 1, "exact-boundary upload must proceed");

        var overState = new MigrationState();
        var overStore = new StateStore(Path.Combine(root, "over-state.json"));
        var overTarget = new FakeWriteClient();
        var overEngine = new MigrationEngine(
            config,
            overState,
            overStore,
            new FakeReadClient(new Dictionary<string, byte[]> { ["zotero/B.bin"] = new byte[11] }),
            overTarget,
            Path.Combine(root, "over-temp"));
        await overEngine.RunAsync(CancellationToken.None);
        Check(overState.EngineState == EngineState.WaitQuota, "one byte over safe remaining must wait for quota");
        Check(overTarget.PutCount == 0, "over-boundary object must not start PUT");
    }
    finally { Directory.Delete(root, true); }
}

static Task TestLargeManifestAsync()
{
    const int attachments = 6000;
    var entries = new List<WebDavEntry>(attachments * 2);
    for (var i = 0; i < attachments; i++)
    {
        var key = $"K{i:D7}";
        entries.Add(new WebDavEntry(key + ".zip", false, 1024 + i, "z" + i, DateTimeOffset.UnixEpoch));
        entries.Add(new WebDavEntry(key + ".prop", false, 64, "p" + i, DateTimeOffset.UnixEpoch));
    }
    var groups = MigrationPlanner.CreateGroups(entries);
    Check(groups.Count == attachments, "6000 Zotero attachments must produce 6000 logical groups");
    Check(groups.All(x => x.Members.Count == 2), "every large-manifest Zotero group must retain both members");
    return Task.CompletedTask;
}

static DavBridgeConfig TestConfig() => new()
{
    SourceRootPath = "zotero",
    TargetRootPath = "zotero",
    UploadQuotaBytes = 1_000_000_000,
    DownloadQuotaBytes = 3_000_000_000,
    NormalReserveBytes = 50_000_000,
    SprintReserveBytes = 5_000_000,
    NextResetAt = DateTimeOffset.Now.AddDays(10),
    UploadLimitBytesPerSecond = 0,
    TargetSingleFileLimitBytes = 500_000_000
};

static string NewTempRoot()
{
    var path = Path.Combine(Path.GetTempPath(), "DavBridge-Smoke-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(path);
    return path;
}

static byte[] Bytes(string value) => System.Text.Encoding.UTF8.GetBytes(value);
static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

sealed class FakeReadClient : IReadOnlyWebDavClient
{
    protected readonly Dictionary<string, byte[]> Files;
    private readonly Dictionary<string, int> _metadataReads = new(StringComparer.OrdinalIgnoreCase);
    public bool MutateOnSecondMetadataRead { get; set; }
    public int ListFailuresRemaining { get; set; }
    public long TotalBytes => Files.Values.Sum(x => (long)x.Length);

    public FakeReadClient(Dictionary<string, byte[]> files)
    {
        Files = new Dictionary<string, byte[]>(files, StringComparer.OrdinalIgnoreCase);
    }

    public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
    {
        if (ListFailuresRemaining > 0)
        {
            ListFailuresRemaining--;
            throw new HttpRequestException("simulated source listing network loss");
        }
        var prefix = relativeDirectory.Trim('/') + "/";
        IReadOnlyList<WebDavEntry> result = Files
            .Where(x => x.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .Select(x => Entry(x.Key[prefix.Length..], x.Value))
            .ToArray();
        return Task.FromResult(result);
    }

    public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken)
    {
        if (!Files.TryGetValue(relativePath, out var data))
            return Task.FromResult<WebDavEntry?>(null);

        _metadataReads.TryGetValue(relativePath, out var count);
        count++;
        _metadataReads[relativePath] = count;
        if (MutateOnSecondMetadataRead && count == 2)
        {
            data = data.Concat(new byte[] { 0x21 }).ToArray();
            Files[relativePath] = data;
        }
        return Task.FromResult<WebDavEntry?>(Entry(Path.GetFileName(relativePath), data));
    }

    public async Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken)
    {
        var data = Files[relativePath];
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        await File.WriteAllBytesAsync(destinationPath, data, cancellationToken);
        return new DownloadResult(data.LongLength, HashBytes(data));
    }

    public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken)
    {
        var data = Files[relativePath];
        return Task.FromResult(new DownloadResult(data.LongLength, HashBytes(data)));
    }

    private static WebDavEntry Entry(string relativePath, byte[] data) =>
        new(relativePath, false, data.LongLength, $"\"{HashBytes(data)}\"", DateTimeOffset.UnixEpoch.AddSeconds(data.Length));

    private static string HashBytes(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
}

sealed class FakeWriteClient : IWritableWebDavClient
{
    private readonly Dictionary<string, byte[]> _files;
    public bool DropWrites { get; set; }
    public Action<int>? AfterPut { get; init; }
    public int DownloadFailuresRemaining { get; set; }
    public int PutCount { get; private set; }
    public int DownloadCount { get; private set; }

    public FakeWriteClient(Dictionary<string, byte[]>? initial = null)
    {
        _files = initial is null
            ? new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
            : new Dictionary<string, byte[]>(initial, StringComparer.OrdinalIgnoreCase);
    }

    public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
    {
        var prefix = relativeDirectory.Trim('/') + "/";
        IReadOnlyList<WebDavEntry> result = _files.Where(x => x.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .Select(x => new WebDavEntry(x.Key[prefix.Length..], false, x.Value.LongLength, $"\"{HashBytes(x.Value)}\"", DateTimeOffset.UnixEpoch))
            .ToArray();
        return Task.FromResult(result);
    }

    public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken)
    {
        if (!_files.TryGetValue(relativePath, out var data)) return Task.FromResult<WebDavEntry?>(null);
        return Task.FromResult<WebDavEntry?>(new WebDavEntry(Path.GetFileName(relativePath), false, data.LongLength, $"\"{HashBytes(data)}\"", DateTimeOffset.UnixEpoch));
    }

    public async Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken)
    {
        DownloadCount++;
        var data = _files[relativePath];
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        await File.WriteAllBytesAsync(destinationPath, data, cancellationToken);
        return new DownloadResult(data.LongLength, HashBytes(data));
    }

    public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken)
    {
        DownloadCount++;
        if (DownloadFailuresRemaining > 0)
        {
            DownloadFailuresRemaining--;
            throw new HttpRequestException("simulated target verification network loss");
        }
        var data = _files[relativePath];
        return Task.FromResult(new DownloadResult(data.LongLength, HashBytes(data)));
    }

    public async Task<PutResult> PutFileAsync(string relativePath, string localFilePath, int bytesPerSecond, CancellationToken cancellationToken)
    {
        PutCount++;
        var data = await File.ReadAllBytesAsync(localFilePath, cancellationToken);
        AfterPut?.Invoke(PutCount);
        if (!DropWrites)
            _files[relativePath] = data;
        return new PutResult(System.Net.HttpStatusCode.Created, true);
    }

    private static string HashBytes(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
}