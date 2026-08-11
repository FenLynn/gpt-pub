using System.Security.Cryptography;
using DavBridge.Core;

var tests = new List<(string Name, Func<Task> Run)>
{
    ("zip-prop grouping", TestGroupingAsync),
    ("quota reserve and sprint", TestQuotaAsync),
    ("state backup recovery", TestStateRecoveryAsync),
    ("strong verified happy path", TestHappyPathAsync),
    ("put success but target absent", TestFalseSuccessAsync),
    ("source changes during transfer", TestSourceChangedAsync)
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
    Check(Path.GetExtension(zotero.Members[0].RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase) ||
          Path.GetExtension(zotero.Members[1].RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase), "zip missing");
    return Task.CompletedTask;
}

static Task TestQuotaAsync()
{
    var config = new DavBridgeConfig
    {
        UploadQuotaBytes = 1_000_000_000,
        NormalReserveBytes = 50_000_000,
        SprintReserveBytes = 5_000_000,
        NextResetAt = DateTimeOffset.Now.AddDays(2),
        CalibrationUploadUsedBytes = 900_000_000
    };
    var state = new MigrationState();
    var normal = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
    Check(normal.ReservedBytes == 50_000_000, "normal reserve must be 50 MB");
    Check(normal.SafeRemainingBytes == 50_000_000, "normal remaining mismatch");
    Check(!normal.IsSprint, "must not sprint two days before reset");

    config.NextResetAt = DateTimeOffset.Now.AddHours(1);
    var sprint = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
    Check(sprint.IsSprint, "must sprint within 24 hours");
    Check(sprint.ReservedBytes == 5_000_000, "sprint reserve must be 5 MB");
    Check(sprint.SafeRemainingBytes == 95_000_000, "sprint remaining mismatch");
    return Task.CompletedTask;
}

static async Task TestStateRecoveryAsync()
{
    var root = NewTempRoot();
    try
    {
        var path = Path.Combine(root, "state.json");
        var store = new StateStore(path);
        var first = new MigrationState { UploadAttemptBytesSinceCalibration = 111 };
        await store.SaveAsync(first);
        var second = new MigrationState { UploadAttemptBytesSinceCalibration = 222 };
        await store.SaveAsync(second);
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
        var config = TestConfig();
        var store = new StateStore(Path.Combine(root, "state.json"));
        var engine = new MigrationEngine(config, state, store, source, target, Path.Combine(root, "temp"));
        await engine.RunAsync(CancellationToken.None);
        Check(state.EngineState == EngineState.Complete, "engine should complete");
        Check(state.Files.Count == 2, "two records expected");
        Check(state.Files.Values.All(x => x.Status == TransferStatus.StrongVerified), "all members must be strongly verified");
        Check(state.UploadAttemptBytesSinceCalibration == source.TotalBytes, "all PUT attempts must be conservatively counted");
        Check(state.VerifiedDownloadBytesSinceCalibration == source.TotalBytes, "target verification downloads must be counted");
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
    }
    finally { Directory.Delete(root, true); }
}

static DavBridgeConfig TestConfig() => new()
{
    SourceRootPath = "zotero",
    TargetRootPath = "zotero",
    UploadQuotaBytes = 1_000_000_000,
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

static void Check(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}

sealed class FakeReadClient : IReadOnlyWebDavClient
{
    protected readonly Dictionary<string, byte[]> Files;
    private readonly Dictionary<string, int> _metadataReads = new(StringComparer.OrdinalIgnoreCase);
    public bool MutateOnSecondMetadataRead { get; set; }
    public long TotalBytes => Files.Values.Sum(x => (long)x.Length);

    public FakeReadClient(Dictionary<string, byte[]> files)
    {
        Files = new Dictionary<string, byte[]>(files, StringComparer.OrdinalIgnoreCase);
    }

    public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
    {
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
        return new DownloadResult(data.LongLength, Hash(data));
    }

    public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken)
    {
        var data = Files[relativePath];
        return Task.FromResult(new DownloadResult(data.LongLength, Hash(data)));
    }

    protected static WebDavEntry Entry(string relativePath, byte[] data) =>
        new(relativePath, false, data.LongLength, $"\"{Hash(data)}\"", DateTimeOffset.UnixEpoch.AddSeconds(data.Length));

    protected static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
}

sealed class FakeWriteClient : IWritableWebDavClient
{
    private readonly Dictionary<string, byte[]> _files = new(StringComparer.OrdinalIgnoreCase);
    public bool DropWrites { get; set; }

    public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
    {
        var prefix = relativeDirectory.Trim('/') + "/";
        IReadOnlyList<WebDavEntry> result = _files.Where(x => x.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .Select(x => new WebDavEntry(x.Key[prefix.Length..], false, x.Value.LongLength, $"\"{Hash(x.Value)}\"", DateTimeOffset.UnixEpoch))
            .ToArray();
        return Task.FromResult(result);
    }

    public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken)
    {
        if (!_files.TryGetValue(relativePath, out var data)) return Task.FromResult<WebDavEntry?>(null);
        return Task.FromResult<WebDavEntry?>(new WebDavEntry(Path.GetFileName(relativePath), false, data.LongLength, $"\"{Hash(data)}\"", DateTimeOffset.UnixEpoch));
    }

    public async Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken)
    {
        var data = _files[relativePath];
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        await File.WriteAllBytesAsync(destinationPath, data, cancellationToken);
        return new DownloadResult(data.LongLength, Hash(data));
    }

    public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken)
    {
        var data = _files[relativePath];
        return Task.FromResult(new DownloadResult(data.LongLength, Hash(data)));
    }

    public async Task<PutResult> PutFileAsync(string relativePath, string localFilePath, int bytesPerSecond, CancellationToken cancellationToken)
    {
        var data = await File.ReadAllBytesAsync(localFilePath, cancellationToken);
        if (!DropWrites)
            _files[relativePath] = data;
        return new PutResult(System.Net.HttpStatusCode.Created, true);
    }

    private static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
}
