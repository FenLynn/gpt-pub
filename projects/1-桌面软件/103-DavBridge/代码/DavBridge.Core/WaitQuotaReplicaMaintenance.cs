namespace DavBridge.Core;

public sealed record WaitQuotaReplicaMaintenanceSummary(
    int ProbedGroups,
    int ExistingGroups,
    int AdoptedGroups,
    int AdoptedMembers,
    long DownloadedBytes,
    string Message);

public static class WaitQuotaReplicaMaintenance
{
    private const int NormalProbeGroupsPerPass = 24;
    private const int SprintProbeGroupsPerPass = 48;
    private const long NormalDownloadBytesPerPass = 100_000_000L;
    private const long SprintDownloadBytesPerPass = 500_000_000L;

    public static Task<WaitQuotaReplicaMaintenanceSummary> ExecuteAsync(
        DavBridgeConfig config,
        MigrationState state,
        StateStore stateStore,
        IReadOnlyWebDavClient source,
        IWritableWebDavClient target,
        Action<EngineProgress>? progress,
        CancellationToken cancellationToken) =>
        ExecuteCoreAsync(
            config,
            state,
            stateStore,
            source,
            target,
            progress,
            cancellationToken,
            manual: false);

    /// <summary>
    /// Explicit user-started NO-WRITE sweep. Unlike the background safety pass, this scans the
    /// whole eligible candidate set and may consume the entire safe target download budget for
    /// the current cycle. QuotaPolicy still preserves the configured reserve and this path never PUTs.
    /// </summary>
    public static Task<WaitQuotaReplicaMaintenanceSummary> ExecuteManualAsync(
        DavBridgeConfig config,
        MigrationState state,
        StateStore stateStore,
        IReadOnlyWebDavClient source,
        IWritableWebDavClient target,
        Action<EngineProgress>? progress,
        CancellationToken cancellationToken) =>
        ExecuteCoreAsync(
            config,
            state,
            stateStore,
            source,
            target,
            progress,
            cancellationToken,
            manual: true);

    private static async Task<WaitQuotaReplicaMaintenanceSummary> ExecuteCoreAsync(
        DavBridgeConfig config,
        MigrationState state,
        StateStore stateStore,
        IReadOnlyWebDavClient source,
        IWritableWebDavClient target,
        Action<EngineProgress>? progress,
        CancellationToken cancellationToken,
        bool manual)
    {
        var snapshot = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
        if (snapshot.SafeDownloadRemainingBytes <= 0)
            return new WaitQuotaReplicaMaintenanceSummary(0, 0, 0, 0, 0,
                manual
                    ? "[维护] 手动校验未启动：下载安全额度已经到达预留线。"
                    : "[维护] 下载安全额度也已不足，本轮不执行既有副本校验。");

        IReadOnlyList<WebDavEntry> sourceEntries;
        try
        {
            Report(progress, config, state, null, null,
                manual
                    ? "[维护] 手动校验已启动。正在读取 InfiniCLOUD 源清单，随后将遍历全部未验证 Zotero 组；只读目标，禁止 PUT。"
                    : "[维护] 上传额度不足，正在读取 InfiniCLOUD 源清单并准备直接路径探测，不依赖坚果云 750 项目录窗口。");
            sourceEntries = await source.ListDirectoryAsync(config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or WebDavException)
        {
            return new WaitQuotaReplicaMaintenanceSummary(0, 0, 0, 0, 0,
                $"[维护] 源清单读取失败，本轮 NO-WRITE 校验未执行：{ex.Message}");
        }

        var candidates = MigrationPlanner.CreateGroups(sourceEntries)
            .Where(IsCompleteZoteroGroup)
            .Where(group => !IsGroupCurrentAndVerified(state, group))
            .Where(group => !HasUnsafeMaintenanceState(state, group))
            .OrderBy(group => group.TotalBytes)
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        if (candidates.Length == 0)
            return new WaitQuotaReplicaMaintenanceSummary(0, 0, 0, 0, 0,
                "[维护] 当前源清单中没有可进行 NO-WRITE 接管的完整未验证 zip+prop 组。");

        var probeCount = manual
            ? candidates.Length
            : Math.Min(snapshot.IsSprint ? SprintProbeGroupsPerPass : NormalProbeGroupsPerPass, candidates.Length);
        var startIndex = manual ? 0 : GetRotatingStartIndex(candidates.Length, DateTimeOffset.Now);
        var passRemaining = manual
            ? snapshot.SafeDownloadRemainingBytes
            : Math.Min(snapshot.SafeDownloadRemainingBytes,
                snapshot.IsSprint ? SprintDownloadBytesPerPass : NormalDownloadBytesPerPass);

        var probedGroups = 0;
        var existingGroups = 0;
        var adoptedGroups = 0;
        var adoptedMembers = 0;
        long downloadedBytes = 0;

        for (var offset = 0; offset < probeCount; offset++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var group = candidates[(startIndex + offset) % candidates.Length];
            probedGroups++;

            Report(progress, config, state, group.Key, null,
                manual
                    ? $"[维护] 手动校验：正在直接探测坚果云既有副本 {probedGroups}/{probeCount}，{Path.GetFileName(group.Key)}。仅检查路径，不会 PUT。"
                    : $"[维护] 正在按目标路径探测坚果云既有副本 {probedGroups}/{probeCount}：{Path.GetFileName(group.Key)}。本阶段只读，不会 PUT。");

            var targetMetadata = new Dictionary<string, WebDavEntry>(StringComparer.OrdinalIgnoreCase);
            var completeOnTarget = true;
            foreach (var member in group.Members.OrderBy(MemberOrder))
            {
                WebDavEntry? metadata;
                try
                {
                    metadata = await target.GetMetadataAsync(JoinPath(config.TargetRootPath, member.RelativePath), cancellationToken)
                        .ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is HttpRequestException or WebDavException)
                {
                    Report(progress, config, state, group.Key, member.RelativePath,
                        $"[维护] 目标路径探测暂时失败，已跳过本组且未写入：{ex.Message}");
                    completeOnTarget = false;
                    break;
                }

                if (metadata is null)
                {
                    completeOnTarget = false;
                    break;
                }
                targetMetadata[member.RelativePath] = metadata;
            }

            if (!completeOnTarget)
                continue;

            existingGroups++;
            var expectedDownload = group.Members.Sum(member =>
                Math.Max(0, targetMetadata[member.RelativePath].ContentLength ?? member.ContentLength ?? 0L));
            var currentQuota = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
            if (expectedDownload <= 0 || expectedDownload > passRemaining || !QuotaPolicy.CanStartDownload(expectedDownload, currentQuota))
            {
                Report(progress, config, state, group.Key, null,
                    $"[维护] 已找到完整既有副本，但安全下载额度不足以校验该组，需要约 {FormatMb(expectedDownload)}，当前可安全使用 {FormatMb(Math.Min(passRemaining, currentQuota.SafeDownloadRemainingBytes))}。");
                if (manual && currentQuota.SafeDownloadRemainingBytes <= 0)
                    break;
                continue;
            }

            var groupOk = true;
            foreach (var member in group.Members.OrderBy(MemberOrder))
            {
                var result = await AdoptMemberAsync(config, state, stateStore, source, target, group.Key,
                    member, targetMetadata[member.RelativePath], progress, cancellationToken).ConfigureAwait(false);
                downloadedBytes += result.DownloadedBytes;
                passRemaining = Math.Max(0, passRemaining - result.DownloadedBytes);
                if (result.Success)
                    adoptedMembers++;
                else
                {
                    groupOk = false;
                    break;
                }
            }

            if (groupOk && IsGroupCurrentAndVerified(state, group))
                adoptedGroups++;

            var afterGroupQuota = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
            if (passRemaining <= 0 || afterGroupQuota.SafeDownloadRemainingBytes <= 0)
                break;
        }

        string summary;
        if (manual)
        {
            summary = adoptedGroups > 0
                ? $"[维护] 手动校验结束：共探测 {probedGroups}/{probeCount} 组，找到 {existingGroups} 个完整坚果云既有组，已 NO-WRITE 强校验接管 {adoptedGroups} 组、{adoptedMembers} 个文件，坚果云实际下载 {FormatMb(downloadedBytes)}，上传 0 B。"
                : existingGroups > 0
                    ? $"[维护] 手动校验结束：共探测 {probedGroups}/{probeCount} 组，找到 {existingGroups} 个完整坚果云既有组，但未有新组通过当前安全下载预算与强校验条件，上传 0 B。"
                    : $"[维护] 手动校验结束：已直接探测 {probedGroups}/{probeCount} 个未验证组，没有发现完整的坚果云 zip+prop 既有副本，因此没有下载文件内容，上传 0 B。";
        }
        else
        {
            summary = adoptedGroups > 0
                ? $"[维护] 本轮直接路径探测 {probedGroups} 组，找到 {existingGroups} 个完整坚果云既有组，已 NO-WRITE 强校验接管 {adoptedGroups} 组、{adoptedMembers} 个文件，坚果云实际下载 {FormatMb(downloadedBytes)}，上传 0 B。"
                : existingGroups > 0
                    ? $"[维护] 本轮直接路径探测 {probedGroups} 组，找到 {existingGroups} 个完整坚果云既有组，但没有组满足本轮安全下载预算或强校验条件，上传 0 B。"
                    : $"[维护] 本轮已越过 750 项目录窗口，直接按目标路径探测 {probedGroups} 个未验证组；这些组在坚果云上未形成完整 zip+prop 副本。本轮未下载文件内容，上传 0 B。";
        }

        Report(progress, config, state, null, null, summary);
        return new WaitQuotaReplicaMaintenanceSummary(
            probedGroups, existingGroups, adoptedGroups, adoptedMembers, downloadedBytes, summary);
    }

    private static async Task<AdoptionResult> AdoptMemberAsync(
        DavBridgeConfig config,
        MigrationState state,
        StateStore stateStore,
        IReadOnlyWebDavClient source,
        IWritableWebDavClient target,
        string groupKey,
        WebDavEntry sourceManifest,
        WebDavEntry targetMetadata,
        Action<EngineProgress>? progress,
        CancellationToken cancellationToken)
    {
        var sourcePath = JoinPath(config.SourceRootPath, sourceManifest.RelativePath);
        var targetPath = JoinPath(config.TargetRootPath, sourceManifest.RelativePath);
        var before = await source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        if (before is null)
            return new AdoptionResult(false, 0);

        var record = GetOrCreateRecord(state, sourceManifest, groupKey);
        record.AttemptCount++;
        record.SourceSize = before.ContentLength ?? sourceManifest.ContentLength ?? 0L;
        record.SourceETag = before.ETag;
        record.SourceLastModified = before.LastModified;
        record.LastError = null;
        await stateStore.SaveAsync(state, cancellationToken).ConfigureAwait(false);

        Report(progress, config, state, groupKey, sourceManifest.RelativePath,
            $"[维护] {Path.GetFileName(sourceManifest.RelativePath)}：正在读取 InfiniCLOUD 源文件并计算 SHA-256，随后只读校验坚果云副本。");
        var sourceDownload = await source.DownloadAndHashAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        var after = await source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        if (after is null || MetadataChanged(before, after))
        {
            record.Status = TransferStatus.SourceChanged;
            record.LastError = "源文件在 NO-WRITE 校验期间发生变化，结果未接管。";
            await stateStore.SaveAsync(state, cancellationToken).ConfigureAwait(false);
            return new AdoptionResult(false, 0);
        }

        var currentQuota = QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now);
        var expectedTargetBytes = Math.Max(0, targetMetadata.ContentLength ?? sourceDownload.Bytes);
        if (!QuotaPolicy.CanStartDownload(expectedTargetBytes, currentQuota))
        {
            record.Status = TransferStatus.SourceReady;
            record.SourceSha256 = sourceDownload.Sha256;
            record.LastError = "坚果云安全下载预算不足，源 SHA-256 已计算，等待后续只读校验。";
            await stateStore.SaveAsync(state, cancellationToken).ConfigureAwait(false);
            return new AdoptionResult(false, 0);
        }

        Report(progress, config, state, groupKey, sourceManifest.RelativePath,
            $"[维护] {Path.GetFileName(sourceManifest.RelativePath)}：正在读取坚果云已有副本并做 SHA-256 强校验，上传保持 0 B。");
        var targetDownload = await target.DownloadAndHashAsync(targetPath, cancellationToken).ConfigureAwait(false);
        state.VerifiedDownloadBytesSinceCalibration += targetDownload.Bytes;

        record.SourceSize = sourceDownload.Bytes;
        record.SourceSha256 = sourceDownload.Sha256;
        record.SourceETag = before.ETag;
        record.SourceLastModified = before.LastModified;
        record.TargetETag = targetMetadata.ETag;

        if (targetDownload.Bytes != sourceDownload.Bytes ||
            !string.Equals(targetDownload.Sha256, sourceDownload.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            record.Status = TransferStatus.Conflict;
            record.TargetSha256 = targetDownload.Sha256;
            record.LastError = "坚果云既有副本与当前源文件不同。NO-WRITE 模式不会覆盖目标。";
            await stateStore.SaveAsync(state, cancellationToken).ConfigureAwait(false);
            Report(progress, config, state, groupKey, sourceManifest.RelativePath,
                $"[维护] {Path.GetFileName(sourceManifest.RelativePath)}：目标与当前源文件不同，已标记冲突并安全跳过，未上传。");
            return new AdoptionResult(false, targetDownload.Bytes);
        }

        record.TargetSha256 = targetDownload.Sha256;
        record.Status = TransferStatus.StrongVerified;
        record.VerifiedAt = DateTimeOffset.UtcNow;
        record.LastError = null;
        await stateStore.SaveAsync(state, cancellationToken).ConfigureAwait(false);
        Report(progress, config, state, groupKey, sourceManifest.RelativePath,
            $"[维护] {Path.GetFileName(sourceManifest.RelativePath)}：源端与坚果云 SHA-256 完全一致，已安全接管，上传 0 B。");
        return new AdoptionResult(true, targetDownload.Bytes);
    }

    private static TransferRecord GetOrCreateRecord(MigrationState state, WebDavEntry entry, string groupKey)
    {
        if (!state.Files.TryGetValue(entry.RelativePath, out var record))
        {
            record = new TransferRecord
            {
                RelativePath = entry.RelativePath,
                GroupKey = groupKey,
                SourceSize = entry.ContentLength ?? 0L,
                SourceETag = entry.ETag,
                SourceLastModified = entry.LastModified,
                Status = TransferStatus.Pending
            };
            state.Files[entry.RelativePath] = record;
        }
        else
        {
            record.GroupKey = groupKey;
        }
        return record;
    }

    private static bool IsCompleteZoteroGroup(AttachmentGroup group)
    {
        if (group.Members.Count != 2) return false;
        return group.Members.Any(member => Path.GetExtension(member.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase)) &&
               group.Members.Any(member => Path.GetExtension(member.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
    }

    private static bool HasUnsafeMaintenanceState(MigrationState state, AttachmentGroup group) =>
        group.Members.Any(member => state.Files.TryGetValue(member.RelativePath, out var record) &&
            record.Status is TransferStatus.Conflict or TransferStatus.WriteUnknown or TransferStatus.SourceChanged);

    private static bool IsGroupCurrentAndVerified(MigrationState state, AttachmentGroup group) =>
        group.Members.All(member => state.Files.TryGetValue(member.RelativePath, out var record) && IsRecordCurrentAndVerified(record, member));

    private static bool IsRecordCurrentAndVerified(TransferRecord record, WebDavEntry entry)
    {
        if (record.Status != TransferStatus.StrongVerified) return false;
        if (entry.ContentLength.HasValue && record.SourceSize != entry.ContentLength.Value) return false;
        if (!string.IsNullOrWhiteSpace(entry.ETag) && !string.Equals(record.SourceETag, entry.ETag, StringComparison.Ordinal)) return false;
        if (entry.LastModified.HasValue && record.SourceLastModified.HasValue && entry.LastModified.Value != record.SourceLastModified.Value) return false;
        return true;
    }

    private static bool MetadataChanged(WebDavEntry before, WebDavEntry after)
    {
        if (before.ContentLength.HasValue && after.ContentLength.HasValue && before.ContentLength.Value != after.ContentLength.Value) return true;
        if (!string.IsNullOrWhiteSpace(before.ETag) && !string.IsNullOrWhiteSpace(after.ETag) &&
            !string.Equals(before.ETag, after.ETag, StringComparison.Ordinal)) return true;
        if (before.LastModified.HasValue && after.LastModified.HasValue && before.LastModified.Value != after.LastModified.Value) return true;
        return false;
    }

    private static int MemberOrder(WebDavEntry entry) =>
        Path.GetExtension(entry.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase) ? 0 : 1;

    private static int GetRotatingStartIndex(int count, DateTimeOffset now)
    {
        if (count <= 1) return 0;
        var sixHourSlot = now.ToUnixTimeSeconds() / (6 * 60 * 60);
        return (int)(Math.Abs(sixHourSlot) % count);
    }

    private static void Report(
        Action<EngineProgress>? progress,
        DavBridgeConfig config,
        MigrationState state,
        string? groupKey,
        string? relativePath,
        string message)
    {
        progress?.Invoke(new EngineProgress(
            EngineState.WaitQuota,
            groupKey,
            relativePath,
            message,
            QuotaPolicy.GetSnapshot(config, state, DateTimeOffset.Now)));
    }

    private static string JoinPath(string root, string relative)
    {
        var left = root.Replace('\\', '/').Trim('/');
        var right = relative.Replace('\\', '/').Trim('/');
        if (left.Length == 0) return right;
        if (right.Length == 0) return left;
        return left + "/" + right;
    }

    private static string FormatMb(long bytes) => $"{bytes / 1_000_000d:0.00} MB";
    private sealed record AdoptionResult(bool Success, long DownloadedBytes);
}
