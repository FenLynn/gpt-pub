using DavBridge.Core;

namespace DavBridge;

internal sealed record FirstGroupValidationPlan(
    string GroupKey,
    IReadOnlyList<WebDavEntry> Members,
    long TotalBytes,
    int ExistingTargetMembers,
    long MaximumUploadBytes,
    long ExpectedTargetVerificationDownloadBytes);

internal sealed record FirstGroupValidationResult(
    string GroupKey,
    bool Success,
    long UploadBytes,
    long DownloadBytes,
    IReadOnlyList<TransferRecord> Records,
    string Message);

internal static class FirstGroupValidationRunner
{
    public static async Task<FirstGroupValidationPlan> PrepareAsync(AppHost host, CancellationToken cancellationToken)
    {
        if (host.Config.MigrationEnabled)
            throw new InvalidOperationException("请先暂停长期迁移，再执行首组验证。");
        if (host.Config.NextResetAt == default)
            throw new InvalidOperationException("请先使用“校准流量”录入坚果云当前上传、下载已用量和下一次重置时间。");

        var secrets = await host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
        using var source = new WebDavReadClient(host.Config.SourceBaseUrl, host.Config.SourceUsername, secrets.SourcePassword);
        var entries = await source.ListDirectoryAsync(host.Config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        var groups = MigrationPlanner.CreateGroups(entries)
            .Where(IsCompleteZoteroGroup)
            .Where(group => !IsAlreadyStronglyVerified(host.State, group))
            .OrderBy(group => group.TotalBytes)
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (groups.Length == 0)
            throw new InvalidOperationException("没有找到可用于首组验证的未完成 zip + prop 逻辑组。");

        var selected = groups[0];
        var gate = new RequestGate(TimeSpan.FromMilliseconds(host.Config.TargetMinimumRequestIntervalMs));
        using var target = new WebDavWriteClient(host.Config.TargetBaseUrl, host.Config.TargetUsername, secrets.TargetPassword, gate);

        var existingCount = 0;
        long maximumUpload = 0;
        foreach (var member in selected.Members)
        {
            var targetPath = JoinPath(host.Config.TargetRootPath, member.RelativePath);
            var targetMetadata = await target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false);
            if (targetMetadata is not null)
                existingCount++;
            else
                checked { maximumUpload += member.ContentLength ?? 0L; }
        }

        return new FirstGroupValidationPlan(
            selected.Key,
            selected.Members,
            selected.TotalBytes,
            existingCount,
            maximumUpload,
            selected.TotalBytes);
    }

    public static async Task<FirstGroupValidationResult> ExecuteAsync(
        AppHost host,
        string groupKey,
        IProgress<EngineProgress>? progress,
        CancellationToken cancellationToken)
    {
        if (host.Config.MigrationEnabled)
            throw new InvalidOperationException("长期迁移必须保持暂停，首组验证不会与整库迁移并行运行。");
        if (host.Config.NextResetAt == default)
            throw new InvalidOperationException("流量尚未校准，拒绝开始真实首组验证。");

        var secrets = await host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
        using var sourceInner = new WebDavReadClient(host.Config.SourceBaseUrl, host.Config.SourceUsername, secrets.SourcePassword);
        var entries = await sourceInner.ListDirectoryAsync(host.Config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        var group = MigrationPlanner.CreateGroups(entries)
            .FirstOrDefault(x => string.Equals(x.Key, groupKey, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException($"源端已找不到待验证组：{groupKey}");

        if (!IsCompleteZoteroGroup(group))
            throw new InvalidOperationException("所选对象不再是完整的 zip + prop Zotero 逻辑组，已停止验证。");

        var stateStore = new StateStore(host.Paths.StatePath);
        var gate = new RequestGate(TimeSpan.FromMilliseconds(host.Config.TargetMinimumRequestIntervalMs));
        using var target = new WebDavWriteClient(host.Config.TargetBaseUrl, host.Config.TargetUsername, secrets.TargetPassword, gate);
        var filteredSource = new SingleGroupSourceClient(sourceInner, group.Members);
        var engine = new MigrationEngine(host.Config, host.State, stateStore, filteredSource, target, host.Paths.TempRoot);
        if (progress is not null)
            engine.ProgressChanged += (_, value) => progress.Report(value);

        var uploadBefore = host.State.UploadAttemptBytesSinceCalibration;
        var downloadBefore = host.State.VerifiedDownloadBytesSinceCalibration;
        await engine.RunAsync(cancellationToken).ConfigureAwait(false);

        var records = group.Members
            .Select(member => host.State.Files.TryGetValue(member.RelativePath, out var record) ? record : null)
            .Where(record => record is not null)
            .Cast<TransferRecord>()
            .ToArray();
        var success = records.Length == group.Members.Count && records.All(record => record.Status == TransferStatus.StrongVerified);
        var message = success
            ? "首个 zip + prop 逻辑组已经在坚果云端完成强校验。"
            : records.FirstOrDefault(record => record.Status != TransferStatus.StrongVerified)?.LastError
              ?? "首组验证未完成，请查看成员状态。";

        host.State.EngineState = EngineState.Paused;
        host.State.CurrentGroupKey = null;
        await stateStore.SaveAsync(host.State, CancellationToken.None).ConfigureAwait(false);

        return new FirstGroupValidationResult(
            group.Key,
            success,
            Math.Max(0, host.State.UploadAttemptBytesSinceCalibration - uploadBefore),
            Math.Max(0, host.State.VerifiedDownloadBytesSinceCalibration - downloadBefore),
            records,
            message);
    }

    public static bool HasCompletedZoteroValidation(MigrationState state)
    {
        return state.Files.Values
            .Where(record => record.Status == TransferStatus.StrongVerified)
            .GroupBy(record => record.GroupKey, StringComparer.OrdinalIgnoreCase)
            .Any(group =>
                group.Any(record => Path.GetExtension(record.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase)) &&
                group.Any(record => Path.GetExtension(record.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase)));
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
