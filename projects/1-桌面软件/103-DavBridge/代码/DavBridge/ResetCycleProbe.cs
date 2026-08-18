using DavBridge.Core;

namespace DavBridge;

internal sealed record ResetCycleProbeResult(
    bool Success,
    string? GroupKey,
    long UploadBytes,
    long DownloadBytes,
    IReadOnlyList<TransferRecord> Records,
    string Message);

internal static class ResetCycleProbeRunner
{
    public static async Task<ResetCycleProbeResult> ExecuteAsync(AppHost host, CancellationToken cancellationToken)
    {
        var secrets = await host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
        using var sourceInner = new WebDavReadClient(host.Config.SourceBaseUrl, host.Config.SourceUsername, secrets.SourcePassword);
        var entries = await sourceInner.ListDirectoryAsync(host.Config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        var groups = MigrationPlanner.CreateGroups(entries)
            .Where(IsCompleteZoteroGroup)
            .Where(group => !IsAlreadyStronglyVerified(host.State, group))
            .OrderBy(group => group.TotalBytes)
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var gate = new RequestGate(TimeSpan.FromMilliseconds(host.Config.TargetMinimumRequestIntervalMs));
        using var target = new WebDavWriteClient(host.Config.TargetBaseUrl, host.Config.TargetUsername, secrets.TargetPassword, gate);

        AttachmentGroup? selected = null;
        foreach (var group in groups)
        {
            var needsPut = false;
            foreach (var member in group.Members)
            {
                var targetPath = JoinPath(host.Config.TargetRootPath, member.RelativePath);
                if (await target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false) is null)
                {
                    needsPut = true;
                    break;
                }
            }

            if (needsPut)
            {
                selected = group;
                break;
            }
        }

        if (selected is null)
        {
            return new ResetCycleProbeResult(
                false,
                null,
                0,
                0,
                Array.Empty<TransferRecord>(),
                "当前没有找到仍需真实 PUT 的完整 zip + prop 逻辑组，因此无法用真实上传确认新周期。DavBridge 不会擅自清零流量账本。可稍后重试或人工校准。" );
        }

        var probeConfig = CloneForProbe(host.Config);
        var probeState = new MigrationState();
        var probeStatePath = Path.Combine(host.Paths.TempRoot, "reset-probe-state.json");
        TryDelete(probeStatePath);
        TryDelete(probeStatePath + ".bak");
        var probeStore = new StateStore(probeStatePath);
        var filteredSource = new SingleGroupSourceClient(sourceInner, selected.Members);
        var engine = new MigrationEngine(probeConfig, probeState, probeStore, filteredSource, target, host.Paths.TempRoot);

        try
        {
            await engine.RunAsync(cancellationToken).ConfigureAwait(false);
            var records = selected.Members
                .Select(member => probeState.Files.TryGetValue(member.RelativePath, out var record) ? CloneRecord(record) : null)
                .Where(record => record is not null)
                .Cast<TransferRecord>()
                .ToArray();

            var success = probeState.UploadAttemptBytesSinceCalibration > 0 &&
                          records.Length == selected.Members.Count &&
                          records.All(record => record.Status == TransferStatus.StrongVerified);

            var message = success
                ? "09:00 后真实 PUT、准确资源确认、目标重新 GET 和 SHA-256 已全部通过，可以确认坚果云当前允许上传。"
                : records.FirstOrDefault(record => record.Status != TransferStatus.StrongVerified)?.LastError
                  ?? "真实上传探测未完成，DavBridge 不会清零旧周期流量账本。";

            return new ResetCycleProbeResult(
                success,
                selected.Key,
                probeState.UploadAttemptBytesSinceCalibration,
                probeState.VerifiedDownloadBytesSinceCalibration,
                records,
                message);
        }
        finally
        {
            TryDelete(probeStatePath);
            TryDelete(probeStatePath + ".bak");
            TryDelete(probeStatePath + ".tmp");
        }
    }

    private static DavBridgeConfig CloneForProbe(DavBridgeConfig source)
    {
        return new DavBridgeConfig
        {
            SourceBaseUrl = source.SourceBaseUrl,
            SourceRootPath = source.SourceRootPath,
            SourceUsername = source.SourceUsername,
            TargetBaseUrl = source.TargetBaseUrl,
            TargetRootPath = source.TargetRootPath,
            TargetUsername = source.TargetUsername,
            UploadQuotaBytes = source.UploadQuotaBytes,
            DownloadQuotaBytes = source.DownloadQuotaBytes,
            NormalReserveBytes = source.NormalReserveBytes,
            SprintReserveBytes = source.SprintReserveBytes,
            SprintWindowHours = source.SprintWindowHours,
            UploadLimitBytesPerSecond = source.UploadLimitBytesPerSecond,
            TargetMinimumRequestIntervalMs = source.TargetMinimumRequestIntervalMs,
            TargetSingleFileLimitBytes = source.TargetSingleFileLimitBytes,
            NextResetAt = ResetSchedulePolicy.NormalizeResetDate(DateTimeOffset.Now.AddMonths(1)),
            CalibrationAt = DateTimeOffset.Now,
            CalibrationUploadUsedBytes = 0,
            CalibrationDownloadUsedBytes = 0,
            MigrationEnabled = true,
            AutoStartWithWindows = source.AutoStartWithWindows,
            StartMinimized = source.StartMinimized,
            AutoResume = source.AutoResume,
            EndOfCycleSprintEnabled = source.EndOfCycleSprintEnabled
        };
    }

    private static TransferRecord CloneRecord(TransferRecord source)
    {
        return new TransferRecord
        {
            RelativePath = source.RelativePath,
            GroupKey = source.GroupKey,
            SourceSize = source.SourceSize,
            SourceETag = source.SourceETag,
            SourceLastModified = source.SourceLastModified,
            SourceSha256 = source.SourceSha256,
            LastAttemptedUploadSha256 = source.LastAttemptedUploadSha256,
            TargetETag = source.TargetETag,
            TargetSha256 = source.TargetSha256,
            Status = source.Status,
            AttemptCount = source.AttemptCount,
            LastError = source.LastError,
            VerifiedAt = source.VerifiedAt
        };
    }

    private static bool IsAlreadyStronglyVerified(MigrationState state, AttachmentGroup group)
    {
        return group.Members.All(member =>
            state.Files.TryGetValue(member.RelativePath, out var record) &&
            record.Status == TransferStatus.StrongVerified &&
            record.SourceSize == (member.ContentLength ?? record.SourceSize));
    }

    private static bool IsCompleteZoteroGroup(AttachmentGroup group)
    {
        if (group.Members.Count != 2)
            return false;
        return group.Members.Any(member => Path.GetExtension(member.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase)) &&
               group.Members.Any(member => Path.GetExtension(member.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
    }

    private static string JoinPath(string root, string relative)
    {
        var left = root.Replace('\\', '/').Trim('/');
        var right = relative.Replace('\\', '/').Trim('/');
        if (left.Length == 0) return right;
        if (right.Length == 0) return left;
        return left + "/" + right;
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch
        {
        }
    }

    private sealed class SingleGroupSourceClient : IReadOnlyWebDavClient
    {
        private readonly IReadOnlyWebDavClient _inner;
        private readonly IReadOnlyList<WebDavEntry> _members;

        public SingleGroupSourceClient(IReadOnlyWebDavClient inner, IReadOnlyList<WebDavEntry> members)
        {
            _inner = inner;
            _members = members;
        }

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken) =>
            Task.FromResult(_members);

        public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken) =>
            _inner.GetMetadataAsync(relativePath, cancellationToken);

        public Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken) =>
            _inner.DownloadToFileAsync(relativePath, destinationPath, cancellationToken);

        public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken) =>
            _inner.DownloadAndHashAsync(relativePath, cancellationToken);
    }
}
