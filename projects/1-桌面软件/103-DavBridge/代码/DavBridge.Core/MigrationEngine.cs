using System.Net;

namespace DavBridge.Core;

public sealed record ReadinessReport(
    int ObjectCount,
    int GroupCount,
    long TotalBytes,
    long LargestFileBytes,
    IReadOnlyList<string> OversizeObjects,
    IReadOnlyList<string> UnpairedZoteroObjects);

public sealed record EngineProgress(
    EngineState State,
    string? GroupKey,
    string? RelativePath,
    string Message,
    QuotaSnapshot Quota);

public sealed class MigrationEngine
{
    private readonly DavBridgeConfig _config;
    private readonly MigrationState _state;
    private readonly StateStore _stateStore;
    private readonly IReadOnlyWebDavClient _source;
    private readonly IWritableWebDavClient _target;
    private readonly string _tempRoot;

    public event EventHandler<EngineProgress>? ProgressChanged;

    public MigrationEngine(
        DavBridgeConfig config,
        MigrationState state,
        StateStore stateStore,
        IReadOnlyWebDavClient source,
        IWritableWebDavClient target,
        string tempRoot)
    {
        _config = config;
        _state = state;
        _stateStore = stateStore;
        _source = source;
        _target = target;
        _tempRoot = tempRoot;
    }

    public async Task<ReadinessReport> ScanReadinessAsync(CancellationToken cancellationToken)
    {
        var entries = await _source.ListDirectoryAsync(_config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        var files = entries.Where(x => !x.IsCollection).ToArray();
        var groups = MigrationPlanner.CreateGroups(files);
        var oversize = files.Where(x => (x.ContentLength ?? 0) > _config.TargetSingleFileLimitBytes)
            .Select(x => x.RelativePath).OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray();

        var unpaired = new List<string>();
        foreach (var group in groups)
        {
            var zip = group.Members.Any(x => Path.GetExtension(x.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase));
            var prop = group.Members.Any(x => Path.GetExtension(x.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
            if ((zip || prop) && zip != prop) unpaired.Add(group.Key);
        }

        return new ReadinessReport(
            files.Length,
            groups.Count,
            files.Sum(x => x.ContentLength ?? 0L),
            files.Length == 0 ? 0 : files.Max(x => x.ContentLength ?? 0L),
            oversize,
            unpaired);
    }

    public async Task RunAsync(CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_tempRoot);
        QuotaPolicy.AdvanceCycleIfNeeded(_config, _state, DateTimeOffset.Now);
        _state.EngineState = EngineState.Running;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

        IReadOnlyList<WebDavEntry> entries;
        try
        {
            entries = await _source.ListDirectoryAsync(_config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            await SetEngineStateAsync(EngineState.WaitNetwork, null, null, ex.Message, cancellationToken).ConfigureAwait(false);
            return;
        }

        var groups = MigrationPlanner.CreateGroups(entries);
        var changedGroups = await MarkSourceDriftAsync(groups, cancellationToken).ConfigureAwait(false);
        if (changedGroups > 0)
            OnProgress(EngineState.Running, null, null,
                $"检测到 {changedGroups} 个已迁移附件组的源版本发生变化，将优先刷新目标副本。");

        var orderedGroups = groups
            .OrderByDescending(GroupHasSourceDrift)
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var group in orderedGroups)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var outstanding = group.Members
                .Where(member => !_state.Files.TryGetValue(member.RelativePath, out var existingRecord) ||
                                 !IsRecordCurrentAndVerified(existingRecord, member))
                .OrderBy(MemberOrder)
                .ThenBy(x => x.RelativePath, StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (outstanding.Length == 0) continue;

            var oversize = outstanding.FirstOrDefault(x => (x.ContentLength ?? 0L) > _config.TargetSingleFileLimitBytes);
            if (oversize is not null)
            {
                var record = GetOrCreateRecord(oversize, group.Key);
                record.Status = TransferStatus.BlockedOversize;
                record.LastError = $"Object exceeds target single-file limit: {oversize.ContentLength} bytes";
                await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                await SetEngineStateAsync(EngineState.WaitRetry, group.Key, oversize.RelativePath, record.LastError, cancellationToken).ConfigureAwait(false);
                return;
            }

            var requiredBytes = await GetRequiredUploadBytesAsync(outstanding, cancellationToken).ConfigureAwait(false);
            var quota = QuotaPolicy.GetSnapshot(_config, _state, DateTimeOffset.Now);
            if (!QuotaPolicy.CanStartUpload(requiredBytes, quota))
            {
                var adoption = await TryAdoptExistingReplicaGroupsAsync(groups, cancellationToken).ConfigureAwait(false);
                var driftWaiting = CountSourceDriftGroups(groups);
                var extra = adoption.AdoptedGroups > 0
                    ? $" 已利用剩余下载额度只读接管 {adoption.AdoptedGroups} 组、{adoption.AdoptedMembers} 个文件，未发生 PUT。"
                    : adoption.Message;
                if (driftWaiting > 0)
                    extra += $" 另有 {driftWaiting} 个源端变更组等待下个可用上传周期优先刷新。";

                await SetEngineStateAsync(EngineState.WaitQuota, group.Key, null,
                    $"Safe upload budget exhausted. Group still needs {requiredBytes} bytes; remaining={quota.SafeRemainingBytes} bytes.{extra}",
                    cancellationToken).ConfigureAwait(false);
                return;
            }

            _state.CurrentGroupKey = group.Key;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

            foreach (var member in outstanding)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var record = GetOrCreateRecord(member, group.Key);
                try
                {
                    await ProcessMemberAsync(member, record, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) { throw; }
                catch (QuotaExceededException ex)
                {
                    record.Status = record.SourceSha256 is null ? TransferStatus.Pending : TransferStatus.SourceReady;
                    record.LastError = ex.Message;
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    await SetEngineStateAsync(EngineState.WaitQuota, group.Key, member.RelativePath, ex.Message, cancellationToken).ConfigureAwait(false);
                    return;
                }
                catch (HttpRequestException ex)
                {
                    if (record.Status != TransferStatus.WriteUnknown) record.Status = TransferStatus.Failed;
                    record.LastError = ex.Message;
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    await SetEngineStateAsync(EngineState.WaitNetwork, group.Key, member.RelativePath, ex.Message, cancellationToken).ConfigureAwait(false);
                    return;
                }
                catch (WebDavException ex)
                {
                    if (record.Status is not TransferStatus.WriteUnknown and not TransferStatus.Conflict)
                        record.Status = TransferStatus.Failed;
                    record.LastError = DescribeWebDavFailure(ex);
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    await SetEngineStateAsync(IsTransient(ex.StatusCode) ? EngineState.WaitNetwork : EngineState.WaitRetry,
                        group.Key, member.RelativePath, record.LastError, cancellationToken).ConfigureAwait(false);
                    return;
                }
                catch (Exception ex)
                {
                    if (record.Status != TransferStatus.WriteUnknown) record.Status = TransferStatus.Failed;
                    record.LastError = ex.Message;
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    await SetEngineStateAsync(EngineState.WaitRetry, group.Key, member.RelativePath, ex.Message, cancellationToken).ConfigureAwait(false);
                    return;
                }

                if (record.Status != TransferStatus.StrongVerified)
                {
                    await SetEngineStateAsync(EngineState.WaitRetry, group.Key, member.RelativePath,
                        record.LastError ?? $"Member stopped in state {record.Status}.", cancellationToken).ConfigureAwait(false);
                    return;
                }
            }
        }

        if (!groups.All(IsGroupCurrentAndVerified))
        {
            await SetEngineStateAsync(EngineState.WaitRetry, _state.CurrentGroupKey, null,
                "At least one source object is not strongly verified at the target.", cancellationToken).ConfigureAwait(false);
            return;
        }

        // Finalization gate: two consecutive low-traffic source manifests must both still match the
        // strongly verified state. This prevents a long-running migration from declaring completion
        // while Zotero is still adding or changing attachments.
        IReadOnlyList<WebDavEntry> finalEntries;
        try
        {
            OnProgress(EngineState.Running, null, null, "正在进行最终一致性确认：读取第 1 次源清单。");
            finalEntries = await _source.ListDirectoryAsync(_config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            await SetEngineStateAsync(EngineState.WaitNetwork, null, null,
                "Final source manifest refresh failed: " + ex.Message, cancellationToken).ConfigureAwait(false);
            return;
        }
        var finalGroups = MigrationPlanner.CreateGroups(finalEntries);
        if (!finalGroups.All(IsGroupCurrentAndVerified))
        {
            await SetEngineStateAsync(EngineState.WaitRetry, null, null,
                "Source manifest changed while migration was running. New or changed objects will be processed on the next safe pass.",
                cancellationToken).ConfigureAwait(false);
            return;
        }

        IReadOnlyList<WebDavEntry> stableEntries;
        try
        {
            OnProgress(EngineState.Running, null, null, "第 1 次源清单稳定，正在进行第 2 次最终一致性确认。");
            await Task.Delay(TimeSpan.FromSeconds(2), cancellationToken).ConfigureAwait(false);
            stableEntries = await _source.ListDirectoryAsync(_config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            await SetEngineStateAsync(EngineState.WaitNetwork, null, null,
                "Second final source manifest refresh failed: " + ex.Message, cancellationToken).ConfigureAwait(false);
            return;
        }

        var stableGroups = MigrationPlanner.CreateGroups(stableEntries);
        if (!stableGroups.All(IsGroupCurrentAndVerified) || !ManifestEquivalent(finalEntries, stableEntries))
        {
            await SetEngineStateAsync(EngineState.WaitRetry, null, null,
                "最终一致性确认发现源端仍在变化。DavBridge 不会宣告完成，将在下一安全轮次继续处理。",
                cancellationToken).ConfigureAwait(false);
            return;
        }

        _state.CurrentGroupKey = null;
        await SetEngineStateAsync(EngineState.Complete, null, null,
            "最终两次源清单一致，当前源版本已在目标端完成强 SHA-256 校验。",
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<int> MarkSourceDriftAsync(IReadOnlyList<AttachmentGroup> groups, CancellationToken cancellationToken)
    {
        var changedGroups = 0;
        var changedAny = false;
        foreach (var group in groups)
        {
            var groupChanged = false;
            foreach (var member in group.Members)
            {
                if (!_state.Files.TryGetValue(member.RelativePath, out var record) ||
                    record.Status != TransferStatus.StrongVerified ||
                    IsRecordCurrentAndVerified(record, member))
                    continue;

                record.Status = TransferStatus.SourceChanged;
                record.LastError = "源端附件在上次强校验后发生变化，将优先刷新坚果云副本。";
                groupChanged = true;
                changedAny = true;
            }
            if (groupChanged) changedGroups++;
        }

        if (changedAny)
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        return changedGroups;
    }

    private bool GroupHasSourceDrift(AttachmentGroup group) =>
        group.Members.Any(member =>
            _state.Files.TryGetValue(member.RelativePath, out var record) && record.Status == TransferStatus.SourceChanged);

    private int CountSourceDriftGroups(IEnumerable<AttachmentGroup> groups) => groups.Count(GroupHasSourceDrift);

    private async Task<ExistingReplicaAdoptionSummary> TryAdoptExistingReplicaGroupsAsync(
        IReadOnlyList<AttachmentGroup> groups,
        CancellationToken cancellationToken)
    {
        var snapshot = QuotaPolicy.GetSnapshot(_config, _state, DateTimeOffset.Now);
        if (snapshot.SafeDownloadRemainingBytes <= 0)
            return new ExistingReplicaAdoptionSummary(0, 0, 0, " 下载安全额度也已不足，等待下一周期。");

        IReadOnlyList<WebDavEntry> targetEntries;
        try
        {
            OnProgress(EngineState.WaitQuota, null, null,
                "上传额度不足，正在检查坚果云当前可见的既有副本，尝试用剩余下载额度进行 NO-WRITE 接管。");
            targetEntries = await _target.ListDirectoryAsync(_config.TargetRootPath, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is HttpRequestException or WebDavException)
        {
            return new ExistingReplicaAdoptionSummary(0, 0, 0,
                $" 既有副本只读接管暂未执行：{ex.Message}");
        }

        var visibleTargets = targetEntries
            .Where(entry => !entry.IsCollection)
            .ToDictionary(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase);

        var perPassLimit = snapshot.IsSprint ? 500_000_000L : 100_000_000L;
        var passRemaining = Math.Min(snapshot.SafeDownloadRemainingBytes, perPassLimit);
        var adoptedGroups = 0;
        var adoptedMembers = 0;
        long downloadedBytes = 0;

        var candidates = groups
            .Where(IsCompleteZoteroGroup)
            .Where(group => !IsGroupCurrentAndVerified(group))
            .Where(group => !GroupHasSourceDrift(group))
            .Where(group => !GroupHasUnsafeMaintenanceState(group))
            .Where(group => group.Members.All(member => visibleTargets.ContainsKey(member.RelativePath)))
            .OrderBy(group => group.TotalBytes)
            .ThenBy(group => group.Key, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        foreach (var group in candidates)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var outstanding = group.Members
                .Where(member => !_state.Files.TryGetValue(member.RelativePath, out var record) ||
                                 !IsRecordCurrentAndVerified(record, member))
                .OrderBy(MemberOrder)
                .ToArray();
            if (outstanding.Length == 0) continue;

            var expectedDownload = outstanding.Sum(member =>
                Math.Max(0, visibleTargets[member.RelativePath].ContentLength ?? member.ContentLength ?? 0L));
            var currentQuota = QuotaPolicy.GetSnapshot(_config, _state, DateTimeOffset.Now);
            if (expectedDownload <= 0 || expectedDownload > passRemaining || !QuotaPolicy.CanStartDownload(expectedDownload, currentQuota))
                continue;

            var groupOk = true;
            foreach (var member in outstanding)
            {
                var targetEntry = visibleTargets[member.RelativePath];
                var result = await TryAdoptExistingMemberAsync(group.Key, member, targetEntry, cancellationToken).ConfigureAwait(false);
                downloadedBytes += result.DownloadedBytes;
                passRemaining = Math.Max(0, passRemaining - result.DownloadedBytes);
                if (result.Success) adoptedMembers++;
                else
                {
                    groupOk = false;
                    break;
                }
            }

            if (groupOk && IsGroupCurrentAndVerified(group)) adoptedGroups++;
            if (passRemaining <= 0) break;
        }

        if (adoptedGroups == 0)
        {
            var visibleNote = visibleTargets.Count >= 750
                ? " 当前坚果云单次可见列表已达到 750 项，不据此判断其余文件不存在。"
                : string.Empty;
            return new ExistingReplicaAdoptionSummary(0, 0, downloadedBytes,
                " 当前可见目标中没有可安全自动接管的完整未验证副本。" + visibleNote);
        }

        return new ExistingReplicaAdoptionSummary(adoptedGroups, adoptedMembers, downloadedBytes, string.Empty);
    }

    private async Task<AdoptionMemberResult> TryAdoptExistingMemberAsync(
        string groupKey,
        WebDavEntry sourceManifest,
        WebDavEntry targetManifest,
        CancellationToken cancellationToken)
    {
        var record = GetOrCreateRecord(sourceManifest, groupKey);
        var sourcePath = JoinPath(_config.SourceRootPath, sourceManifest.RelativePath);
        var targetPath = JoinPath(_config.TargetRootPath, sourceManifest.RelativePath);
        var before = await _source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        if (before is null)
        {
            record.Status = TransferStatus.SourceChanged;
            record.LastError = "后台只读接管时源文件已经消失，未修改坚果云。";
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            return new AdoptionMemberResult(false, 0);
        }

        var targetMetadata = await _target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false);
        if (targetMetadata is null)
        {
            record.LastError = "后台只读接管发现目标文件已缺失，已跳过且不会 PUT。";
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            return new AdoptionMemberResult(false, 0);
        }

        var expectedTargetBytes = Math.Max(0, targetMetadata.ContentLength ?? targetManifest.ContentLength ?? before.ContentLength ?? 0L);
        EnsureDownloadBudget(expectedTargetBytes, $"NO-WRITE adoption of {sourceManifest.RelativePath}");

        record.AttemptCount++;
        record.SourceSize = before.ContentLength ?? sourceManifest.ContentLength ?? 0L;
        record.SourceETag = before.ETag;
        record.SourceLastModified = before.LastModified;
        record.LastError = null;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        OnProgress(EngineState.WaitQuota, groupKey, sourceManifest.RelativePath,
            "上传额度不足，正在只读读取源文件并核验坚果云已有副本；本步骤禁止 PUT。");

        var sourceDownload = await _source.DownloadAndHashAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        var after = await _source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        if (after is null || MetadataChanged(before, after))
        {
            record.Status = TransferStatus.SourceChanged;
            record.LastError = "源文件在后台只读核验期间发生变化，结果未接管。";
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            return new AdoptionMemberResult(false, 0);
        }

        var targetDownload = await _target.DownloadAndHashAsync(targetPath, cancellationToken).ConfigureAwait(false);
        _state.VerifiedDownloadBytesSinceCalibration += targetDownload.Bytes;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

        record.SourceSize = sourceDownload.Bytes;
        record.SourceSha256 = sourceDownload.Sha256;
        record.SourceETag = before.ETag;
        record.SourceLastModified = before.LastModified;

        if (targetDownload.Bytes != sourceDownload.Bytes ||
            !string.Equals(targetDownload.Sha256, sourceDownload.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            record.Status = TransferStatus.Conflict;
            record.LastError = "坚果云既有副本与当前源文件不同。后台 NO-WRITE 模式不会覆盖，已停止自动接管此组。";
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            OnProgress(EngineState.WaitQuota, groupKey, sourceManifest.RelativePath,
                "既有副本与当前源文件不同，已安全跳过并保持 NO-WRITE。需要后续处理冲突。");
            return new AdoptionMemberResult(false, targetDownload.Bytes);
        }

        record.TargetSha256 = targetDownload.Sha256;
        record.TargetETag = targetMetadata.ETag;
        record.Status = TransferStatus.StrongVerified;
        record.VerifiedAt = DateTimeOffset.UtcNow;
        record.LastError = null;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        OnProgress(EngineState.WaitQuota, groupKey, sourceManifest.RelativePath,
            "既有副本已通过 NO-WRITE SHA-256 强校验并安全接管，未发生上传。");
        return new AdoptionMemberResult(true, targetDownload.Bytes);
    }

    private bool GroupHasUnsafeMaintenanceState(AttachmentGroup group) =>
        group.Members.Any(member =>
            _state.Files.TryGetValue(member.RelativePath, out var record) &&
            record.Status is TransferStatus.Conflict or TransferStatus.WriteUnknown or TransferStatus.SourceChanged);

    private static bool IsCompleteZoteroGroup(AttachmentGroup group)
    {
        if (group.Members.Count != 2) return false;
        var zip = group.Members.Any(member => Path.GetExtension(member.RelativePath).Equals(".zip", StringComparison.OrdinalIgnoreCase));
        var prop = group.Members.Any(member => Path.GetExtension(member.RelativePath).Equals(".prop", StringComparison.OrdinalIgnoreCase));
        return zip && prop;
    }

    private async Task<long> GetRequiredUploadBytesAsync(IEnumerable<WebDavEntry> members, CancellationToken cancellationToken)
    {
        long total = 0;
        foreach (var member in members)
        {
            if (_state.Files.TryGetValue(member.RelativePath, out var record) && record.Status == TransferStatus.SourceChanged)
            {
                var changedLength = member.ContentLength;
                if (!changedLength.HasValue)
                {
                    var changedMetadata = await _source.GetMetadataAsync(JoinPath(_config.SourceRootPath, member.RelativePath), cancellationToken).ConfigureAwait(false)
                                          ?? throw new WebDavException($"Changed source object disappeared during quota preflight: {member.RelativePath}");
                    changedLength = changedMetadata.ContentLength;
                }
                if (!changedLength.HasValue || changedLength.Value < 0)
                    throw new WebDavException($"Changed source length is unavailable; refusing to budget an unknown-size object: {member.RelativePath}");
                checked { total += changedLength.Value; }
                continue;
            }

            var targetPath = JoinPath(_config.TargetRootPath, member.RelativePath);
            var existingTarget = await _target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false);
            if (existingTarget is not null) continue;

            var length = member.ContentLength;
            if (!length.HasValue)
            {
                var metadata = await _source.GetMetadataAsync(JoinPath(_config.SourceRootPath, member.RelativePath), cancellationToken).ConfigureAwait(false)
                               ?? throw new WebDavException($"Source object disappeared during quota preflight: {member.RelativePath}");
                length = metadata.ContentLength;
            }
            if (!length.HasValue || length.Value < 0)
                throw new WebDavException($"Source length is unavailable; refusing to budget an unknown-size object: {member.RelativePath}");
            checked { total += length.Value; }
        }
        return total;
    }

    private async Task ProcessMemberAsync(WebDavEntry manifestEntry, TransferRecord record, CancellationToken cancellationToken)
    {
        var sourcePath = JoinPath(_config.SourceRootPath, manifestEntry.RelativePath);
        var targetPath = JoinPath(_config.TargetRootPath, manifestEntry.RelativePath);
        var before = await _source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false)
                     ?? throw new WebDavException($"Source object disappeared before transfer: {manifestEntry.RelativePath}");

        if ((before.ContentLength ?? 0L) > _config.TargetSingleFileLimitBytes)
        {
            record.Status = TransferStatus.BlockedOversize;
            record.LastError = "Source object exceeds configured target single-file limit.";
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            return;
        }

        record.Status = TransferStatus.DownloadingSource;
        record.AttemptCount++;
        record.LastError = null;
        record.SourceSize = before.ContentLength ?? manifestEntry.ContentLength ?? 0L;
        record.SourceETag = before.ETag;
        record.SourceLastModified = before.LastModified;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        OnProgress(EngineState.Running, record.GroupKey, record.RelativePath, "Downloading source and calculating SHA-256.");

        var tempPath = Path.Combine(_tempRoot, Guid.NewGuid().ToString("N") + ".part");
        try
        {
            var sourceDownload = await _source.DownloadToFileAsync(sourcePath, tempPath, cancellationToken).ConfigureAwait(false);
            if (before.ContentLength.HasValue && sourceDownload.Bytes != before.ContentLength.Value)
                throw new InvalidDataException($"Source length changed during GET. Expected={before.ContentLength.Value}, Actual={sourceDownload.Bytes}");

            record.SourceSize = sourceDownload.Bytes;
            record.SourceSha256 = sourceDownload.Sha256;
            record.Status = TransferStatus.SourceReady;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

            var existing = await _target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false);
            if (existing is not null)
            {
                EnsureDownloadBudget(existing.ContentLength ?? sourceDownload.Bytes,
                    $"Verifying existing target {manifestEntry.RelativePath}");
                OnProgress(EngineState.Running, record.GroupKey, record.RelativePath,
                    "Target already exists; downloading it for safe takeover verification.");
                var currentTarget = await _target.DownloadAndHashAsync(targetPath, cancellationToken).ConfigureAwait(false);
                _state.VerifiedDownloadBytesSinceCalibration += currentTarget.Bytes;
                await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

                if (currentTarget.Bytes == sourceDownload.Bytes &&
                    string.Equals(currentTarget.Sha256, sourceDownload.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    await CompleteStrongVerificationAsync(record, before, sourcePath, existing, sourceDownload, currentTarget, cancellationToken).ConfigureAwait(false);
                    return;
                }

                var trustedHash = !string.IsNullOrWhiteSpace(record.TargetSha256)
                    ? record.TargetSha256
                    : record.LastAttemptedUploadSha256;
                if (string.IsNullOrWhiteSpace(trustedHash))
                {
                    record.Status = TransferStatus.Conflict;
                    record.LastError = "Preexisting target object differs from the current source; DavBridge will not overwrite an untrusted object.";
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    return;
                }
                if (!string.Equals(currentTarget.Sha256, trustedHash, StringComparison.OrdinalIgnoreCase))
                {
                    record.Status = TransferStatus.Conflict;
                    record.LastError = "Target object differs from the last content DavBridge can prove it wrote.";
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    return;
                }
            }

            EnsureUploadBudget(sourceDownload.Bytes, $"Uploading {manifestEntry.RelativePath}");
            EnsureDownloadBudget(sourceDownload.Bytes, $"Post-upload verification of {manifestEntry.RelativePath}");

            record.Status = TransferStatus.Uploading;
            record.LastAttemptedUploadSha256 = sourceDownload.Sha256;
            _state.UploadAttemptBytesSinceCalibration += sourceDownload.Bytes;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            OnProgress(EngineState.Running, record.GroupKey, record.RelativePath, "Uploading target object.");

            try
            {
                if (_target is IConditionalWebDavClient conditional)
                {
                    var condition = existing is null
                        ? new ConditionalPutOptions(CreateOnly: true)
                        : new ConditionalPutOptions(CreateOnly: false, IfMatchETag: existing.ETag);
                    await conditional.PutFileConditionallyAsync(targetPath, tempPath, _config.UploadLimitBytesPerSecond, condition, cancellationToken).ConfigureAwait(false);
                }
                else
                {
                    await _target.PutFileAsync(targetPath, tempPath, _config.UploadLimitBytesPerSecond, cancellationToken).ConfigureAwait(false);
                }
            }
            catch (WebDavWriteUncertainException ex)
            {
                await ReconcileUnknownWriteAsync(record, before, sourcePath, targetPath, sourceDownload, ex.Message, cancellationToken).ConfigureAwait(false);
                return;
            }
            catch (WebDavException ex) when (ex.StatusCode == HttpStatusCode.PreconditionFailed)
            {
                await ReconcileUnknownWriteAsync(record, before, sourcePath, targetPath, sourceDownload,
                    "Conditional PUT precondition failed; target changed between preflight and write.", cancellationToken).ConfigureAwait(false);
                return;
            }

            var confirmed = await _target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false);
            if (confirmed is null)
                throw new WebDavException("Target returned success to PUT but the object is absent during independent confirmation.");
            if (confirmed.ContentLength.HasValue && confirmed.ContentLength.Value != sourceDownload.Bytes)
                throw new WebDavException($"Target length mismatch after PUT. Source={sourceDownload.Bytes}, Target={confirmed.ContentLength.Value}");

            record.Status = TransferStatus.RemotePresent;
            record.TargetETag = confirmed.ETag;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

            record.Status = TransferStatus.Verifying;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            OnProgress(EngineState.Running, record.GroupKey, record.RelativePath, "Re-downloading target for strong SHA-256 verification.");

            var targetDownload = await _target.DownloadAndHashAsync(targetPath, cancellationToken).ConfigureAwait(false);
            _state.VerifiedDownloadBytesSinceCalibration += targetDownload.Bytes;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            if (targetDownload.Bytes != sourceDownload.Bytes ||
                !string.Equals(targetDownload.Sha256, sourceDownload.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Target strong verification failed: byte length or SHA-256 differs from source.");

            await CompleteStrongVerificationAsync(record, before, sourcePath, confirmed, sourceDownload, targetDownload, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
        }
    }

    private async Task ReconcileUnknownWriteAsync(
        TransferRecord record,
        WebDavEntry before,
        string sourcePath,
        string targetPath,
        DownloadResult sourceDownload,
        string reason,
        CancellationToken cancellationToken)
    {
        record.Status = TransferStatus.WriteUnknown;
        record.LastError = reason;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        OnProgress(EngineState.Running, record.GroupKey, record.RelativePath,
            "Re-downloading target to reconcile uncertain PUT outcome.");

        try
        {
            var metadata = await _target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false);
            if (metadata is null)
            {
                record.Status = TransferStatus.SourceReady;
                record.LastError = "PUT outcome was uncertain, but the target is absent after reconciliation. A later pass may retry safely.";
                await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                return;
            }

            if (metadata.ContentLength.HasValue && metadata.ContentLength.Value != sourceDownload.Bytes)
            {
                record.Status = TransferStatus.Conflict;
                record.LastError = "PUT outcome was uncertain and the target now exists with a different length. DavBridge will not overwrite it.";
                await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                return;
            }

            EnsureDownloadBudget(metadata.ContentLength ?? sourceDownload.Bytes,
                $"Reconciling uncertain upload {record.RelativePath}");
            var targetDownload = await _target.DownloadAndHashAsync(targetPath, cancellationToken).ConfigureAwait(false);
            _state.VerifiedDownloadBytesSinceCalibration += targetDownload.Bytes;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

            if (targetDownload.Bytes == sourceDownload.Bytes &&
                string.Equals(targetDownload.Sha256, sourceDownload.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                await CompleteStrongVerificationAsync(record, before, sourcePath, metadata, sourceDownload, targetDownload, cancellationToken).ConfigureAwait(false);
                return;
            }

            record.Status = TransferStatus.Conflict;
            record.LastError = "PUT outcome was uncertain and the target bytes do not match the source. DavBridge will not upload again automatically.";
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        }
        catch (QuotaExceededException) { throw; }
        catch (Exception ex)
        {
            record.Status = TransferStatus.WriteUnknown;
            record.LastError = $"PUT outcome remains unknown because reconciliation could not finish: {ex.Message}";
            await _stateStore.SaveAsync(_state, CancellationToken.None).ConfigureAwait(false);
        }
    }

    private void EnsureUploadBudget(long expectedBytes, string operation)
    {
        var quota = QuotaPolicy.GetSnapshot(_config, _state, DateTimeOffset.Now);
        if (!QuotaPolicy.CanStartUpload(expectedBytes, quota))
            throw new QuotaExceededException(
                $"Safe target upload budget exhausted before {operation}. Need about {expectedBytes} bytes; remaining={quota.SafeRemainingBytes} bytes.", false);
    }

    private void EnsureDownloadBudget(long expectedBytes, string operation)
    {
        var quota = QuotaPolicy.GetSnapshot(_config, _state, DateTimeOffset.Now);
        if (!QuotaPolicy.CanStartDownload(expectedBytes, quota))
            throw new QuotaExceededException(
                $"Safe target download budget exhausted before {operation}. Need about {expectedBytes} bytes; remaining={quota.SafeDownloadRemainingBytes} bytes.", true);
    }

    private async Task CompleteStrongVerificationAsync(
        TransferRecord record,
        WebDavEntry before,
        string sourcePath,
        WebDavEntry targetMetadata,
        DownloadResult sourceDownload,
        DownloadResult targetDownload,
        CancellationToken cancellationToken)
    {
        var after = await _source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false)
                    ?? throw new WebDavException("Source object disappeared during transfer.");
        if (MetadataChanged(before, after))
        {
            record.Status = TransferStatus.SourceChanged;
            record.LastError = "Source object changed during transfer; target result is not accepted as current.";
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            return;
        }
        if (targetDownload.Bytes != sourceDownload.Bytes ||
            !string.Equals(targetDownload.Sha256, sourceDownload.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Strong verification completion received non-identical source and target content.");

        record.TargetSha256 = targetDownload.Sha256;
        record.TargetETag = targetMetadata.ETag;
        record.Status = TransferStatus.StrongVerified;
        record.VerifiedAt = DateTimeOffset.UtcNow;
        record.LastError = null;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        OnProgress(EngineState.Running, record.GroupKey, record.RelativePath, "Strong verification complete.");
    }

    private TransferRecord GetOrCreateRecord(WebDavEntry entry, string groupKey)
    {
        if (!_state.Files.TryGetValue(entry.RelativePath, out var record))
        {
            record = new TransferRecord
            {
                RelativePath = entry.RelativePath,
                GroupKey = groupKey,
                SourceSize = entry.ContentLength ?? 0L,
                SourceETag = entry.ETag,
                SourceLastModified = entry.LastModified
            };
            _state.Files[entry.RelativePath] = record;
        }
        else record.GroupKey = groupKey;
        return record;
    }

    private bool IsGroupCurrentAndVerified(AttachmentGroup group) =>
        group.Members.All(member =>
            _state.Files.TryGetValue(member.RelativePath, out var record) && IsRecordCurrentAndVerified(record, member));

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
        if (before.ContentLength != after.ContentLength) return true;
        if (!string.IsNullOrWhiteSpace(before.ETag) && !string.IsNullOrWhiteSpace(after.ETag) &&
            !string.Equals(before.ETag, after.ETag, StringComparison.Ordinal)) return true;
        if (before.LastModified.HasValue && after.LastModified.HasValue && before.LastModified.Value != after.LastModified.Value) return true;
        return false;
    }

    private static bool ManifestEquivalent(IEnumerable<WebDavEntry> left, IEnumerable<WebDavEntry> right)
    {
        var leftFiles = left.Where(entry => !entry.IsCollection)
            .OrderBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        var rightFiles = right.Where(entry => !entry.IsCollection)
            .OrderBy(entry => entry.RelativePath, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (leftFiles.Length != rightFiles.Length) return false;
        for (var i = 0; i < leftFiles.Length; i++)
        {
            if (!string.Equals(leftFiles[i].RelativePath, rightFiles[i].RelativePath, StringComparison.OrdinalIgnoreCase)) return false;
            if (MetadataChanged(leftFiles[i], rightFiles[i])) return false;
        }
        return true;
    }

    private static bool IsTransient(HttpStatusCode? status) => status is
        HttpStatusCode.RequestTimeout or HttpStatusCode.TooManyRequests or
        HttpStatusCode.InternalServerError or HttpStatusCode.BadGateway or
        HttpStatusCode.ServiceUnavailable or HttpStatusCode.GatewayTimeout;

    private static string DescribeWebDavFailure(WebDavException ex) => ex.StatusCode switch
    {
        HttpStatusCode.Unauthorized => "Authentication failed; automatic retries are paused until credentials are corrected. " + ex.Message,
        HttpStatusCode.Forbidden => "Permission denied by the WebDAV server. " + ex.Message,
        HttpStatusCode.TooManyRequests => "WebDAV server rate limit reached; DavBridge will wait before retrying. " + ex.Message,
        HttpStatusCode.PreconditionFailed => "Conditional write precondition failed; target state changed and must be reconciled. " + ex.Message,
        HttpStatusCode.ServiceUnavailable or HttpStatusCode.BadGateway or HttpStatusCode.GatewayTimeout =>
            "WebDAV server is temporarily unavailable; DavBridge will retry later. " + ex.Message,
        _ => ex.Message
    };

    private async Task SetEngineStateAsync(EngineState engineState, string? groupKey, string? relativePath, string message, CancellationToken cancellationToken)
    {
        _state.EngineState = engineState;
        _state.CurrentGroupKey = groupKey;
        await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
        OnProgress(engineState, groupKey, relativePath, message);
    }

    private void OnProgress(EngineState engineState, string? groupKey, string? relativePath, string message) =>
        ProgressChanged?.Invoke(this, new EngineProgress(engineState, groupKey, relativePath, message,
            QuotaPolicy.GetSnapshot(_config, _state, DateTimeOffset.Now)));

    private static int MemberOrder(WebDavEntry entry) => Path.GetExtension(entry.RelativePath).ToLowerInvariant() switch
    {
        ".zip" => 0,
        ".prop" => 1,
        _ => 2
    };

    private static string JoinPath(string root, string relative) =>
        string.Join('/', new[] { root, relative }.Where(x => !string.IsNullOrWhiteSpace(x)).Select(x => x.Trim('/')));

    private sealed record ExistingReplicaAdoptionSummary(int AdoptedGroups, int AdoptedMembers, long DownloadedBytes, string Message);
    private sealed record AdoptionMemberResult(bool Success, long DownloadedBytes);
}
