using DavBridge.Core;

namespace DavBridge;

internal sealed record ExistingReplicaValidationPlan(
    string GroupKey,
    IReadOnlyList<WebDavEntry> Members,
    long TotalBytes,
    int VisibleTargetObjects);

internal sealed record ExistingReplicaValidationResult(
    string GroupKey,
    bool Success,
    long UploadBytes,
    long DownloadBytes,
    IReadOnlyList<TransferRecord> Records,
    string Message);

internal static class ExistingReplicaValidationRunner
{
    public static async Task<ExistingReplicaValidationPlan> PrepareAsync(AppHost host, CancellationToken cancellationToken)
    {
        if (host.Config.MigrationEnabled)
            throw new InvalidOperationException("请先暂停长期迁移，再执行既有副本验证。");
        if (host.Config.NextResetAt == default)
            throw new InvalidOperationException("请先校准坚果云流量。");

        var secrets = await host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
        using var source = new WebDavReadClient(host.Config.SourceBaseUrl, host.Config.SourceUsername, secrets.SourcePassword);
        var gate = new RequestGate(TimeSpan.FromMilliseconds(host.Config.TargetMinimumRequestIntervalMs));
        using var target = new WebDavWriteClient(host.Config.TargetBaseUrl, host.Config.TargetUsername, secrets.TargetPassword, gate);

        var sourceEntries = await source.ListDirectoryAsync(host.Config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        var targetEntries = await target.ListDirectoryAsync(host.Config.TargetRootPath, cancellationToken).ConfigureAwait(false);
        var visibleTargetPaths = targetEntries
            .Where(x => !x.IsCollection)
            .Select(x => x.RelativePath)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var selected = MigrationPlanner.CreateGroups(sourceEntries)
            .Where(IsCompleteZoteroGroup)
            .Where(group => !IsAlreadyStronglyVerified(host.State, group))
            .Where(group => group.Members.All(member => visibleTargetPaths.Contains(member.RelativePath)))
            .OrderBy(group => group.TotalBytes)
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();

        if (selected is null)
            throw new InvalidOperationException("本次坚果云可见列表中没有找到一个同时存在 zip + prop 的未验证完整组。不会扩大请求范围或写入目标，请稍后再处理。\n\n注意：750+ 只是单次可见列表，不代表目标端没有其他既有副本。");

        foreach (var member in selected.Members)
        {
            var metadata = await target.GetMetadataAsync(JoinPath(host.Config.TargetRootPath, member.RelativePath), cancellationToken).ConfigureAwait(false);
            if (metadata is null)
                throw new InvalidOperationException($"准备验证时目标成员已经不可见：{member.RelativePath}。已停止，不会上传。 ");
        }

        return new ExistingReplicaValidationPlan(
            selected.Key,
            selected.Members,
            selected.TotalBytes,
            visibleTargetPaths.Count);
    }

    public static async Task<ExistingReplicaValidationResult> ExecuteAsync(
        AppHost host,
        string groupKey,
        IProgress<EngineProgress>? progress,
        CancellationToken cancellationToken)
    {
        if (host.Config.MigrationEnabled)
            throw new InvalidOperationException("长期迁移必须保持暂停，既有副本验证不会与整库迁移并行运行。");

        var secrets = await host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
        using var sourceInner = new WebDavReadClient(host.Config.SourceBaseUrl, host.Config.SourceUsername, secrets.SourcePassword);
        var sourceEntries = await sourceInner.ListDirectoryAsync(host.Config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        var group = MigrationPlanner.CreateGroups(sourceEntries)
            .FirstOrDefault(x => string.Equals(x.Key, groupKey, StringComparison.OrdinalIgnoreCase))
            ?? throw new InvalidOperationException("源端已找不到所选既有副本组，已停止验证。");

        if (!IsCompleteZoteroGroup(group))
            throw new InvalidOperationException("所选对象不再是完整 zip + prop 组，已停止验证。");

        var gate = new RequestGate(TimeSpan.FromMilliseconds(host.Config.TargetMinimumRequestIntervalMs));
        using var targetInner = new WebDavWriteClient(host.Config.TargetBaseUrl, host.Config.TargetUsername, secrets.TargetPassword, gate);
        foreach (var member in group.Members)
        {
            var metadata = await targetInner.GetMetadataAsync(JoinPath(host.Config.TargetRootPath, member.RelativePath), cancellationToken).ConfigureAwait(false);
            if (metadata is null)
                throw new InvalidOperationException($"目标成员已缺失：{member.RelativePath}。既有副本验证禁止 PUT，因此立即停止。");
        }

        var stateStore = new StateStore(host.Paths.StatePath);
        var filteredSource = new SingleGroupSourceClient(sourceInner, group.Members);
        var noWriteTarget = new NoWriteTargetClient(targetInner);
        var engine = new MigrationEngine(host.Config, host.State, stateStore, filteredSource, noWriteTarget, host.Paths.TempRoot);
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
        var uploadDelta = Math.Max(0, host.State.UploadAttemptBytesSinceCalibration - uploadBefore);
        var downloadDelta = Math.Max(0, host.State.VerifiedDownloadBytesSinceCalibration - downloadBefore);
        var success = uploadDelta == 0 &&
                      records.Length == group.Members.Count &&
                      records.All(record => record.Status == TransferStatus.StrongVerified);

        host.State.EngineState = EngineState.Paused;
        host.State.CurrentGroupKey = null;
        await stateStore.SaveAsync(host.State, CancellationToken.None).ConfigureAwait(false);

        var message = success
            ? "既有 GoodSync 副本已经仅通过目标 GET + SHA-256 安全接管，全程未发生 PUT。"
            : uploadDelta != 0
                ? "安全断言失败：既有副本验证出现了上传记账，结果不予通过。"
                : records.FirstOrDefault(record => record.Status != TransferStatus.StrongVerified)?.LastError
                  ?? "既有副本验证未完成。";

        return new ExistingReplicaValidationResult(
            group.Key,
            success,
            uploadDelta,
            downloadDelta,
            records,
            message);
    }

    private static bool IsCompleteZoteroGroup(AttachmentGroup group)
    {
        if (group.Members.Count != 2) return false;
        return group.Members.Any(x => Path.GetExtension(x.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase)) &&
               group.Members.Any(x => Path.GetExtension(x.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
    }

    private static bool IsAlreadyStronglyVerified(MigrationState state, AttachmentGroup group) =>
        group.Members.All(member => state.Files.TryGetValue(member.RelativePath, out var record) &&
                                    record.Status == TransferStatus.StrongVerified &&
                                    record.SourceSize == (member.ContentLength ?? record.SourceSize));

    private static string JoinPath(string root, string relative)
    {
        var left = root.Replace('\\', '/').Trim('/');
        var right = relative.Replace('\\', '/').Trim('/');
        if (left.Length == 0) return right;
        if (right.Length == 0) return left;
        return left + "/" + right;
    }

    private sealed class NoWriteTargetClient : IWritableWebDavClient
    {
        private readonly IWritableWebDavClient _inner;
        public NoWriteTargetClient(IWritableWebDavClient inner) => _inner = inner;

        public Task<IReadOnlyList<WebDavEntry>> ListDirectoryAsync(string relativeDirectory, CancellationToken cancellationToken) =>
            _inner.ListDirectoryAsync(relativeDirectory, cancellationToken);
        public Task<WebDavEntry?> GetMetadataAsync(string relativePath, CancellationToken cancellationToken) =>
            _inner.GetMetadataAsync(relativePath, cancellationToken);
        public Task<DownloadResult> DownloadToFileAsync(string relativePath, string destinationPath, CancellationToken cancellationToken) =>
            _inner.DownloadToFileAsync(relativePath, destinationPath, cancellationToken);
        public Task<DownloadResult> DownloadAndHashAsync(string relativePath, CancellationToken cancellationToken) =>
            _inner.DownloadAndHashAsync(relativePath, cancellationToken);
        public Task<PutResult> PutFileAsync(string relativePath, string localFilePath, int bytesPerSecond, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("既有副本验证处于 NO-WRITE 模式，禁止任何 PUT。目标缺失或内容不一致时必须停止。");
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
