using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using DavBridge.Core;

internal static class WaitQuotaDirectProbeSmokeV0221
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
                Console.Error.WriteLine("FAIL v0.2.21 direct-path wait-quota maintenance: " + ex);
                Environment.ExitCode = 1;
            }
        };
    }

    private static async Task RunAsync()
    {
        var zip = Bytes("existing-zip-beyond-directory-window");
        var prop = Bytes("existing-prop-beyond-directory-window");
        var source = new DirectProbeSource(new Dictionary<string, byte[]>
        {
            ["zotero/A.zip"] = zip,
            ["zotero/A.prop"] = prop
        });
        var target = new DirectoryBlindTarget(new Dictionary<string, byte[]>
        {
            ["zotero/A.zip"] = zip,
            ["zotero/A.prop"] = prop
        });
        var root = Path.Combine(Path.GetTempPath(), "DavBridge-DirectProbeSmoke-" + Guid.NewGuid().ToString("N"));
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

            var summary = await WaitQuotaReplicaMaintenance.ExecuteAsync(
                config,
                state,
                store,
                source,
                target,
                progress: null,
                CancellationToken.None);

            Check(target.ListDirectoryCalls == 0, "maintenance must not depend on target directory LIST");
            Check(target.PutCount == 0, "direct-path maintenance must never PUT");
            Check(summary.AdoptedGroups == 1, "existing group beyond directory window must be adopted");
            Check(summary.AdoptedMembers == 2, "both zip and prop must be strongly verified");
            Check(state.Files["A.zip"].Status == TransferStatus.StrongVerified, "zip must be strongly verified");
            Check(state.Files["A.prop"].Status == TransferStatus.StrongVerified, "prop must be strongly verified");
            Check(state.VerifiedDownloadBytesSinceCalibration == zip.LongLength + prop.LongLength,
                "only target verification bytes should be charged to target download accounting");
            Console.WriteLine("PASS direct-path wait-quota maintenance bypasses target directory window with PUT=0");
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

    private sealed class DirectProbeSource : IReadOnlyWebDavClient
    {
        private readonly Dictionary<string, byte[]> _files;
        public DirectProbeSource(Dictionary<string, byte[]> files) =>
            _files = new Dictionary<string, byte[]>(files, StringComparer.OrdinalIgnoreCase);

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

    private sealed class DirectoryBlindTarget : IWritableWebDavClient
    {
        private readonly Dictionary<string, byte[]> _files;
        public int ListDirectoryCalls { get; private set; }
        public int PutCount { get; private set; }

        public DirectoryBlindTarget(Dictionary<string, byte[]> files) =>
            _files = new Dictionary<string, byte[]>(files, StringComparer.OrdinalIgnoreCase);

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken)
        {
            ListDirectoryCalls++;
            throw new InvalidOperationException("target directory LIST must not be used by direct-path maintenance");
        }

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
            throw new InvalidOperationException("direct-path maintenance attempted a forbidden PUT");
        }
    }
}
