using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using DavBridge.Core;

internal static class WaitQuotaManualSweepSmokeV0222
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
                Console.Error.WriteLine("FAIL v0.2.22 full manual wait-quota sweep: " + ex);
                Environment.ExitCode = 1;
            }
        };
    }

    private static async Task RunAsync()
    {
        var zip = Bytes("zip-data");
        var prop = Bytes("prop-data");
        var sourceFiles = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < 30; i++)
        {
            sourceFiles[$"zotero/G{i:00}.zip"] = zip;
            sourceFiles[$"zotero/G{i:00}.prop"] = prop;
        }

        // The only pre-existing target group is deliberately beyond the former 24-group
        // automatic safety window. A full user-started sweep must still reach it.
        var targetFiles = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase)
        {
            ["zotero/G29.zip"] = zip,
            ["zotero/G29.prop"] = prop
        };

        var source = new SourceClient(sourceFiles);
        var target = new NoWriteTarget(targetFiles);
        var root = Path.Combine(Path.GetTempPath(), "DavBridge-ManualSweepSmoke-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var config = new DavBridgeConfig
            {
                SourceRootPath = "zotero",
                TargetRootPath = "zotero",
                UploadQuotaBytes = 1_000_000_000,
                DownloadQuotaBytes = 3_000_000_000,
                NormalReserveBytes = 50_000_000,
                SprintReserveBytes = 5_000_000,
                NextResetAt = DateTimeOffset.Now.AddDays(10),
                TargetSingleFileLimitBytes = 500_000_000
            };
            var state = new MigrationState { EngineState = EngineState.WaitQuota };
            var store = new StateStore(Path.Combine(root, "state.json"));

            var summary = await WaitQuotaReplicaMaintenance.ExecuteManualAsync(
                config,
                state,
                store,
                source,
                target,
                progress: null,
                CancellationToken.None);

            Check(summary.ProbedGroups == 30, "manual sweep must not stop at the former 24-group background limit");
            Check(summary.AdoptedGroups == 1, "manual sweep must reach and adopt the group beyond index 24");
            Check(summary.AdoptedMembers == 2, "manual sweep must strongly verify zip and prop");
            Check(target.PutCount == 0, "manual sweep must remain NO-WRITE");
            Check(state.Files["G29.zip"].Status == TransferStatus.StrongVerified, "late zip must be strongly verified");
            Check(state.Files["G29.prop"].Status == TransferStatus.StrongVerified, "late prop must be strongly verified");
            Check(state.VerifiedDownloadBytesSinceCalibration == zip.LongLength + prop.LongLength,
                "only actual target GET bytes should count against target download quota");
            Console.WriteLine("PASS manual wait-quota sweep reaches beyond 24 groups with PUT=0");
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }

    private static byte[] Bytes(string value) => System.Text.Encoding.UTF8.GetBytes(value);
    private static string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();

    private sealed class SourceClient : IReadOnlyWebDavClient
    {
        private readonly Dictionary<string, byte[]> _files;
        public SourceClient(Dictionary<string, byte[]> files) => _files = files;

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
        {
            var prefix = relativeDirectory.Trim('/') + "/";
            IReadOnlyList<WebDavEntry> entries = _files
                .Where(x => x.Key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                .Select(x => Entry(x.Key[prefix.Length..], x.Value))
                .ToArray();
            return Task.FromResult(entries);
        }

        public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(_files.TryGetValue(relativePath, out var data) ? Entry(Path.GetFileName(relativePath), data) : null);

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

        private static WebDavEntry Entry(string path, byte[] data) =>
            new(path, false, data.LongLength, $"\"{Hash(data)}\"", DateTimeOffset.UnixEpoch.AddSeconds(data.Length));
    }

    private sealed class NoWriteTarget : IWritableWebDavClient
    {
        private readonly Dictionary<string, byte[]> _files;
        public int PutCount { get; private set; }
        public NoWriteTarget(Dictionary<string, byte[]> files) => _files = files;

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("manual direct-path sweep must not require target directory LIST");

        public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken) =>
            Task.FromResult(_files.TryGetValue(relativePath, out var data)
                ? new WebDavEntry(Path.GetFileName(relativePath), false, data.LongLength, $"\"{Hash(data)}\"", DateTimeOffset.UnixEpoch.AddSeconds(data.Length))
                : null);

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

        public Task<PutResult> PutFileAsync(string relativePath, string localFilePath, int bytesPerSecond, CancellationToken cancellationToken)
        {
            PutCount++;
            throw new InvalidOperationException("manual sweep attempted forbidden PUT");
        }
    }
}
