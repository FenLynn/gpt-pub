using System.Net;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using DavBridge.Core;

internal static class SafetyTransactionSmoke
{
    [ModuleInitializer]
    internal static void Initialize()
    {
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            try
            {
                RunAsync().GetAwaiter().GetResult();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("FAIL v0.2.9 safety transactions: " + ex);
                Environment.ExitCode = 1;
            }
        };
    }

    private static async Task RunAsync()
    {
        await Run("conditional create-only PUT", TestConditionalCreateAsync);
        await Run("uncertain PUT reconciles without second upload", TestWriteUnknownReconcileAsync);
        await Run("conditional race reconciles safely", TestPreconditionRaceAsync);
        await Run("final manifest detects new source object", TestFinalManifestRefreshAsync);
        TestPlainHttpRejected();
        Console.WriteLine("PASS HTTPS-only WebDAV endpoints");
    }

    private static async Task Run(string name, Func<Task> test)
    {
        await test();
        Console.WriteLine($"PASS {name}");
    }

    private static async Task TestConditionalCreateAsync()
    {
        var data = Bytes("conditional-create");
        var source = new SafetySourceClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
        var target = new SafetyTargetClient();
        var root = NewTempRoot();
        try
        {
            var state = new MigrationState();
            var engine = CreateEngine(root, state, source, target);
            await engine.RunAsync(CancellationToken.None);
            Check(state.EngineState == EngineState.Complete, "conditional create path must complete");
            Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "conditional create must finish strongly verified");
            Check(target.PutCount == 1, "conditional create must issue exactly one PUT");
            Check(target.LastOptions?.CreateOnly == true, "new target object must use If-None-Match create-only semantics");
        }
        finally { Directory.Delete(root, true); }
    }

    private static async Task TestWriteUnknownReconcileAsync()
    {
        var data = Bytes("write-was-accepted-but-response-was-lost");
        var source = new SafetySourceClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
        var target = new SafetyTargetClient { ThrowUncertainAfterWriteOnce = true };
        var root = NewTempRoot();
        try
        {
            var state = new MigrationState();
            var engine = CreateEngine(root, state, source, target);
            await engine.RunAsync(CancellationToken.None);
            Check(state.EngineState == EngineState.Complete, "uncertain PUT whose bytes reached target must reconcile to Complete");
            Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "reconciled uncertain PUT must become StrongVerified");
            Check(target.PutCount == 1, "uncertain PUT must not trigger an immediate second upload");
            Check(target.DownloadCount == 1, "reconciliation should use one target GET for strong proof");
        }
        finally { Directory.Delete(root, true); }
    }

    private static async Task TestPreconditionRaceAsync()
    {
        var data = Bytes("another-client-created-the-same-object");
        var source = new SafetySourceClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = data });
        var target = new SafetyTargetClient { SimulateCreateRaceOnce = true };
        var root = NewTempRoot();
        try
        {
            var state = new MigrationState();
            var engine = CreateEngine(root, state, source, target);
            await engine.RunAsync(CancellationToken.None);
            Check(state.EngineState == EngineState.Complete, "412 race with identical target bytes must reconcile safely");
            Check(state.Files["A.bin"].Status == TransferStatus.StrongVerified, "race result must be proven before adoption");
            Check(target.PutCount == 1, "412 race must not blindly retry PUT");
            Check(target.LastOptions?.CreateOnly == true, "race test must have used create-only conditional PUT");
        }
        finally { Directory.Delete(root, true); }
    }

    private static async Task TestFinalManifestRefreshAsync()
    {
        var source = new SafetySourceClient(new Dictionary<string, byte[]> { ["zotero/A.bin"] = Bytes("first") })
        {
            AddOnSecondList = new KeyValuePair<string, byte[]>("zotero/B.bin", Bytes("arrived-during-migration"))
        };
        var target = new SafetyTargetClient();
        var root = NewTempRoot();
        try
        {
            var state = new MigrationState();
            var engine = CreateEngine(root, state, source, target);
            await engine.RunAsync(CancellationToken.None);
            Check(source.ListCount >= 2, "engine must take a second source manifest before Complete");
            Check(state.EngineState == EngineState.WaitRetry, "new object in final source manifest must prevent false Complete");
            Check(state.Files.TryGetValue("A.bin", out var a) && a.Status == TransferStatus.StrongVerified, "already processed source object must stay verified");
            Check(!state.Files.ContainsKey("B.bin"), "new object should be picked up by the next safe pass, not fabricated as verified");
        }
        finally { Directory.Delete(root, true); }
    }

    private static void TestPlainHttpRejected()
    {
        var threw = false;
        try { using var _ = new WebDavReadClient("http://example.invalid/", "u", "p"); }
        catch (InvalidOperationException) { threw = true; }
        Check(threw, "plaintext HTTP WebDAV must be rejected before credentials are sent");
    }

    private static MigrationEngine CreateEngine(string root, MigrationState state, SafetySourceClient source, SafetyTargetClient target)
    {
        var store = new StateStore(Path.Combine(root, "state.json"));
        return new MigrationEngine(TestConfig(), state, store, source, target, Path.Combine(root, "temp"));
    }

    private static DavBridgeConfig TestConfig() => new()
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

    private static string NewTempRoot()
    {
        var path = Path.Combine(Path.GetTempPath(), "DavBridge-SafetySmoke-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static byte[] Bytes(string value) => Encoding.UTF8.GetBytes(value);
    private static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    private static string ETag(byte[] data) => $"\"{Hash(data)}\"";
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class SafetySourceClient : IReadOnlyWebDavClient
    {
        private readonly Dictionary<string, byte[]> _files;
        public int ListCount { get; private set; }
        public KeyValuePair<string, byte[]>? AddOnSecondList { get; init; }

        public SafetySourceClient(Dictionary<string, byte[]> files) =>
            _files = new Dictionary<string, byte[]>(files, StringComparer.OrdinalIgnoreCase);

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
        {
            ListCount++;
            if (ListCount == 2 && AddOnSecondList.HasValue)
                _files[AddOnSecondList.Value.Key] = AddOnSecondList.Value.Value;
            var prefix = relativeDirectory.Trim('/') + "/";
            IReadOnlyList<WebDavEntry> result = _files
                .Where(x => x.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                .Select(x => Entry(x.Key[prefix.Length..], x.Value))
                .ToArray();
            return Task.FromResult(result);
        }

        public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken)
        {
            if (!_files.TryGetValue(relativePath, out var data)) return Task.FromResult<WebDavEntry?>(null);
            return Task.FromResult<WebDavEntry?>(Entry(Path.GetFileName(relativePath), data));
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

        private static WebDavEntry Entry(string relativePath, byte[] data) =>
            new(relativePath, false, data.LongLength, ETag(data), DateTimeOffset.UnixEpoch.AddSeconds(data.Length));
    }

    private sealed class SafetyTargetClient : IConditionalWebDavClient
    {
        private readonly Dictionary<string, byte[]> _files = new(StringComparer.OrdinalIgnoreCase);
        public bool ThrowUncertainAfterWriteOnce { get; init; }
        public bool SimulateCreateRaceOnce { get; init; }
        public int PutCount { get; private set; }
        public int DownloadCount { get; private set; }
        public ConditionalPutOptions? LastOptions { get; private set; }
        private bool _uncertainThrown;
        private bool _raceThrown;

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
        {
            var prefix = relativeDirectory.Trim('/') + "/";
            IReadOnlyList<WebDavEntry> result = _files
                .Where(x => x.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                .Select(x => Entry(x.Key[prefix.Length..], x.Value))
                .ToArray();
            return Task.FromResult(result);
        }

        public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken)
        {
            if (!_files.TryGetValue(relativePath, out var data)) return Task.FromResult<WebDavEntry?>(null);
            return Task.FromResult<WebDavEntry?>(Entry(Path.GetFileName(relativePath), data));
        }

        public async Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken)
        {
            DownloadCount++;
            var data = _files[relativePath];
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            await File.WriteAllBytesAsync(destinationPath, data, cancellationToken);
            return new DownloadResult(data.LongLength, Hash(data));
        }

        public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken)
        {
            DownloadCount++;
            var data = _files[relativePath];
            return Task.FromResult(new DownloadResult(data.LongLength, Hash(data)));
        }

        public Task<PutResult> PutFileAsync(string relativePath, string localFilePath, int bytesPerSecond, CancellationToken cancellationToken) =>
            PutFileConditionallyAsync(relativePath, localFilePath, bytesPerSecond, new ConditionalPutOptions(false), cancellationToken);

        public async Task<PutResult> PutFileConditionallyAsync(string relativePath, string localFilePath, int bytesPerSecond, ConditionalPutOptions options, CancellationToken cancellationToken)
        {
            PutCount++;
            LastOptions = options;
            var data = await File.ReadAllBytesAsync(localFilePath, cancellationToken);

            if (options.CreateOnly)
            {
                if (SimulateCreateRaceOnce && !_raceThrown)
                {
                    _raceThrown = true;
                    _files[relativePath] = data;
                    throw new WebDavException("simulated 412 race", HttpStatusCode.PreconditionFailed);
                }
                if (_files.ContainsKey(relativePath))
                    throw new WebDavException("create-only target already exists", HttpStatusCode.PreconditionFailed);
            }
            else if (!string.IsNullOrWhiteSpace(options.IfMatchETag))
            {
                if (!_files.TryGetValue(relativePath, out var current) || !string.Equals(ETag(current), options.IfMatchETag, StringComparison.Ordinal))
                    throw new WebDavException("If-Match failed", HttpStatusCode.PreconditionFailed);
            }

            _files[relativePath] = data;
            if (ThrowUncertainAfterWriteOnce && !_uncertainThrown)
            {
                _uncertainThrown = true;
                throw new WebDavWriteUncertainException("simulated response loss after server accepted PUT", new HttpRequestException("connection reset"));
            }
            return new PutResult(HttpStatusCode.Created, true);
        }

        private static WebDavEntry Entry(string relativePath, byte[] data) =>
            new(relativePath, false, data.LongLength, ETag(data), DateTimeOffset.UnixEpoch);
    }
}
