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
            if ((zip || prop) && zip != prop)
                unpaired.Add(group.Key);
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
        foreach (var group in groups)
        {
            cancellationToken.ThrowIfCancellationRequested();

            if (group.Members.Any(x => (x.ContentLength ?? 0L) > _config.TargetSingleFileLimitBytes))
            {
                foreach (var member in group.Members)
                {
                    var record = GetOrCreateRecord(member, group.Key);
                    if ((member.ContentLength ?? 0L) > _config.TargetSingleFileLimitBytes)
                    {
                        record.Status = TransferStatus.BlockedOversize;
                        record.LastError = $"Object exceeds target single-file limit: {member.ContentLength} bytes";
                    }
                }
                await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                continue;
            }

            if (IsGroupCurrentAndVerified(group))
                continue;

            var quota = QuotaPolicy.GetSnapshot(_config, _state, DateTimeOffset.Now);
            if (!QuotaPolicy.CanStart(group.TotalBytes, quota))
            {
                await SetEngineStateAsync(EngineState.WaitQuota, group.Key, null,
                    $"Safe upload budget exhausted. Remaining={quota.SafeRemainingBytes} bytes", cancellationToken).ConfigureAwait(false);
                return;
            }

            _state.CurrentGroupKey = group.Key;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);

            foreach (var member in group.Members.OrderBy(MemberOrder).ThenBy(x => x.RelativePath, StringComparer.OrdinalIgnoreCase))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var record = GetOrCreateRecord(member, group.Key);
                if (IsRecordCurrentAndVerified(record, member))
                    continue;

                try
                {
                    await ProcessMemberAsync(member, record, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (HttpRequestException ex)
                {
                    record.Status = TransferStatus.Failed;
                    record.LastError = ex.Message;
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    await SetEngineStateAsync(EngineState.WaitNetwork, group.Key, member.RelativePath, ex.Message, cancellationToken).ConfigureAwait(false);
                    return;
                }
                catch (WebDavException ex)
                {
                    record.Status = TransferStatus.Failed;
                    record.LastError = ex.Message;
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    await SetEngineStateAsync(EngineState.WaitRetry, group.Key, member.RelativePath, ex.Message, cancellationToken).ConfigureAwait(false);
                    return;
                }
                catch (Exception ex)
                {
                    record.Status = TransferStatus.Failed;
                    record.LastError = ex.Message;
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    OnProgress(EngineState.WaitRetry, group.Key, member.RelativePath, ex.Message);
                    break;
                }
            }
        }

        _state.CurrentGroupKey = null;
        await SetEngineStateAsync(EngineState.Complete, null, null, "Current source manifest is strongly verified at target.", cancellationToken).ConfigureAwait(false);
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
                if (string.IsNullOrWhiteSpace(record.TargetSha256))
                {
                    record.Status = TransferStatus.Conflict;
                    record.LastError = "Target object already exists but DavBridge has no trusted prior target hash.";
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    return;
                }

                var currentTarget = await _target.DownloadAndHashAsync(targetPath, cancellationToken).ConfigureAwait(false);
                _state.VerifiedDownloadBytesSinceCalibration += currentTarget.Bytes;
                await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                if (!string.Equals(currentTarget.Sha256, record.TargetSha256, StringComparison.OrdinalIgnoreCase))
                {
                    record.Status = TransferStatus.Conflict;
                    record.LastError = "Target object changed outside DavBridge since the last trusted write.";
                    await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                    return;
                }
            }

            record.Status = TransferStatus.Uploading;
            _state.UploadAttemptBytesSinceCalibration += sourceDownload.Bytes;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            OnProgress(EngineState.Running, record.GroupKey, record.RelativePath, "Uploading target object.");

            await _target.PutFileAsync(targetPath, tempPath, _config.UploadLimitBytesPerSecond, cancellationToken).ConfigureAwait(false);

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
            {
                throw new InvalidDataException("Target strong verification failed: byte length or SHA-256 differs from source.");
            }

            var after = await _source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false)
                        ?? throw new WebDavException("Source object disappeared during transfer.");
            if (MetadataChanged(before, after))
            {
                record.Status = TransferStatus.SourceChanged;
                record.LastError = "Source object changed during transfer; target result is not accepted as current.";
                await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
                return;
            }

            record.TargetSha256 = targetDownload.Sha256;
            record.TargetETag = confirmed.ETag;
            record.Status = TransferStatus.StrongVerified;
            record.VerifiedAt = DateTimeOffset.UtcNow;
            record.LastError = null;
            await _stateStore.SaveAsync(_state, cancellationToken).ConfigureAwait(false);
            OnProgress(EngineState.Running, record.GroupKey, record.RelativePath, "Strong verification complete.");
        }
        finally
        {
            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
        }
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
        else
        {
            record.GroupKey = groupKey;
        }
        return record;
    }

    private bool IsGroupCurrentAndVerified(AttachmentGroup group) =>
        group.Members.All(member =>
            _state.Files.TryGetValue(member.RelativePath, out var record) && IsRecordCurrentAndVerified(record, member));

    private static bool IsRecordCurrentAndVerified(TransferRecord record, WebDavEntry entry)
    {
        if (record.Status != TransferStatus.StrongVerified)
            return false;
        if (entry.ContentLength.HasValue && record.SourceSize != entry.ContentLength.Value)
            return false;
        if (!string.IsNullOrWhiteSpace(entry.ETag) && !string.Equals(record.SourceETag, entry.ETag, StringComparison.Ordinal))
            return false;
        if (entry.LastModified.HasValue && record.SourceLastModified.HasValue && entry.LastModified.Value != record.SourceLastModified.Value)
            return false;
        return true;
    }

    private static bool MetadataChanged(WebDavEntry before, WebDavEntry after)
    {
        if (before.ContentLength != after.ContentLength)
            return true;
        if (!string.IsNullOrWhiteSpace(before.ETag) && !string.IsNullOrWhiteSpace(after.ETag) &&
            !string.Equals(before.ETag, after.ETag, StringComparison.Ordinal))
            return true;
        if (before.LastModified.HasValue && after.LastModified.HasValue && before.LastModified.Value != after.LastModified.Value)
            return true;
        return false;
    }

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
}
