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
        foreach (var group in groups)
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
                await SetEngineStateAsync(EngineState.WaitQuota, group.Key, null,
                    $"Safe upload budget exhausted. Group still needs {requiredBytes} bytes; remaining={quota.SafeRemainingBytes} bytes.",
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

        // A long migration can run while Zotero adds new attachments. Before declaring completion,
        // take one more low-traffic source manifest snapshot. If anything is new or changed, do not
        // emit a false Complete; the background loop will immediately continue it on the next pass.
        IReadOnlyList<WebDavEntry> finalEntries;
        try
        {
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

        _state.CurrentGroupKey = null;
        await SetEngineStateAsync(EngineState.Complete, null, null,
            "Current source manifest is strongly verified at target.", cancellationToken).ConfigureAwait(false);
    }

    private async Task<long> GetRequiredUploadBytesAsync(IEnumerable<WebDavEntry> members, CancellationToken cancellationToken)
    {
        long total = 0;
        foreach (var member in members)
        {
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
}
