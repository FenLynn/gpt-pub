using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using DavBridge.Core;

internal static class MaintenanceSmokeV0220
{
    [ModuleInitializer]
    public static void Run()
    {
        RunAsync().GetAwaiter().GetResult();
    }

    private static async Task RunAsync()
    {
        await TestWaitQuotaNoWriteAdoptionAsync();
        Console.WriteLine("PASS wait-quota NO-WRITE adoption");
        await TestSourceDriftPriorityAsync();
        Console.WriteLine("PASS source-drift priority refresh");
        await TestSecondFinalManifestGateAsync();
        Console.WriteLine("PASS second final manifest gate");
    }

    private static async Task TestWaitQuotaNoWriteAdoptionAsync()
    {
        var source = new FakeReadClient(new Dictionary<string, byte[]>
        {
            ["zotero/A.bin"] = Bytes("needs-upload-and-blocks-normal-progress"),
            ["zotero/Z.zip"] = Bytes("already-in-target-zip"),
            ["zotero/Z.prop"] = Bytes("already-in-target-prop")
        });
        var target = new FakeWriteClient(new Dictionary<string, byte[]>
        {
            ["zotero/Z.zip"] = Bytes("already-in-target-zip"),
            ["zotero/Z.prop"] = Bytes("already-in-target-prop")
        });
        var config = Config();
        config.UploadQuotaBytes = 50;
        config.NormalReserveBytes = 50;
        var root = TempRoot();
        try
        {
            var state = new MigrationState();
            var store = new StateStore(Path.Combine(root, "state.json"));
            var engine = new MigrationEngine(config, state, store, source, target, Path.Combine(root, "temp"));
            await engine.RunAsync(CancellationToken.None);

            Check(state.EngineState == EngineState.WaitQuota, "upload exhaustion should remain WaitQuota after maintenance");
            Check(state.Files.TryGetValue("Z.zip", out var zip) && zip.Status == TransferStatus.StrongVerified,
                "visible preexisting zip must be adopted during WaitQuota");
            Check(state.Files.TryGetValue("Z.prop", out var prop) && prop.Status == TransferStatus.StrongVerified,
                "visible preexisting prop must be adopted during WaitQuota");
            Check(target.PutCount == 0, "WaitQuota maintenance must never PUT");
            Check(target.DownloadCount == 2, "WaitQuota adoption should read each target member exactly once");
            Check(state.UploadAttemptBytesSinceCalibration == 0, "NO-WRITE adoption must not consume upload accounting");
        }
        finally { Directory.Delete(root, true); }
    }

    private static async Task TestSourceDriftPriorityAsync()
    {
        var oldData = Bytes("old");
        var newData = Bytes("changed-now");
        var pending = Bytes("new-pending-file");
        var source = new FakeReadClient(new Dictionary<string, byte[]>
        {
            ["zotero/A.bin"] = pending,
            ["zotero/Z.bin"] = newData
        });
        var target = new FakeWriteClient(new Dictionary<string, byte[]>
        {
            ["zotero/Z.bin"] = oldData
        });
        var state = new MigrationState
        {
            Files = new Dictionary<string, TransferRecord>(StringComparer.OrdinalIgnoreCase)
            {
                ["Z.bin"] = new TransferRecord
                {
                    RelativePath = "Z.bin",
                    GroupKey = "Z.bin",
                    SourceSize = oldData.LongLength,
                    SourceETag = ETag(oldData),
                    SourceLastModified = DateTimeOffset.UnixEpoch.AddSeconds(oldData.Length),
                    SourceSha256 = Hash(oldData),
                    TargetSha256 = Hash(oldData),
                    Status = TransferStatus.StrongVerified,
                    VerifiedAt = DateTimeOffset.UtcNow.AddDays(-10)
                }
            }
        };
        var config = Config();
        config.NormalReserveBytes = 0;
        config.UploadQuotaBytes = newData.LongLength;
        var root = TempRoot();
        try
        {
            var store = new StateStore(Path.Combine(root, "state.json"));
            var engine = new MigrationEngine(config, state, store, source, target, Path.Combine(root, "temp"));
            await engine.RunAsync(CancellationToken.None);

            Check(state.Files["Z.bin"].Status == TransferStatus.StrongVerified,
                "changed previously-verified source must be refreshed first");
            Check(string.Equals(state.Files["Z.bin"].SourceSha256, Hash(newData), StringComparison.OrdinalIgnoreCase),
                "refreshed record must point to the new source version");
            Check(!state.Files.TryGetValue("A.bin", out var a) || a.Status != TransferStatus.StrongVerified,
                "ordinary pending file must not consume the only upload budget before source drift");
            Check(target.PutCount == 1, "only the changed trusted target should be refreshed in this quota window");
            Check(state.UploadAttemptBytesSinceCalibration == newData.LongLength,
                "source-drift refresh must consume exactly the new version upload bytes");
        }
        finally { Directory.Delete(root, true); }
    }

    private static async Task TestSecondFinalManifestGateAsync()
    {
        var a = Bytes("stable-a");
        var b = Bytes("appears-during-finalization");
        var source = new FinalizationChangingSource(a, b);
        var target = new FakeWriteClient();
        var root = TempRoot();
        try
        {
            var state = new MigrationState();
            var store = new StateStore(Path.Combine(root, "state.json"));
            var engine = new MigrationEngine(Config(), state, store, source, target, Path.Combine(root, "temp"));
            await engine.RunAsync(CancellationToken.None);

            Check(state.EngineState == EngineState.WaitRetry,
                "a new source object between the two final manifests must block Complete");
            Check(target.PutCount == 1, "only the original source object should have been uploaded before finalization detected drift");
        }
        finally { Directory.Delete(root, true); }
    }

    private static DavBridgeConfig Config() => new()
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

    private static string TempRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "DavBridge-MaintenanceSmoke-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static byte[] Bytes(string value) => System.Text.Encoding.UTF8.GetBytes(value);
    private static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
    private static string ETag(byte[] data) => $"\"{Hash(data)}\"";
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private sealed class FinalizationChangingSource : IReadOnlyWebDavClient
    {
        private readonly byte[] _a;
        private readonly byte[] _b;
        private int _listCalls;

        public FinalizationChangingSource(byte[] a, byte[] b)
        {
            _a = a;
            _b = b;
        }

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
        {
            _listCalls++;
            var entries = new List<WebDavEntry> { Entry("A.bin", _a) };
            if (_listCalls >= 3) entries.Add(Entry("B.bin", _b));
            return Task.FromResult<IReadOnlyList<WebDavEntry>>(entries);
        }

        public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken)
        {
            var name = Path.GetFileName(relativePath);
            return Task.FromResult<WebDavEntry?>(name switch
            {
                "A.bin" => Entry("A.bin", _a),
                "B.bin" => Entry("B.bin", _b),
                _ => null
            });
        }

        public async Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken)
        {
            var data = Data(relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
            await File.WriteAllBytesAsync(destinationPath, data, cancellationToken);
            return new DownloadResult(data.LongLength, Hash(data));
        }

        public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken)
        {
            var data = Data(relativePath);
            return Task.FromResult(new DownloadResult(data.LongLength, Hash(data)));
        }

        private byte[] Data(string relativePath) => Path.GetFileName(relativePath) == "B.bin" ? _b : _a;
        private static WebDavEntry Entry(string path, byte[] data) =>
            new(path, false, data.LongLength, ETag(data), DateTimeOffset.UnixEpoch.AddSeconds(data.Length));
    }
}
