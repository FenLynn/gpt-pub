using System.Net;
using DavBridge.Core;

namespace DavBridge;

internal sealed record RemovalActionResultV030(
    string GroupKey,
    bool Removed,
    bool Recovered,
    bool Blocked,
    string Message);

internal sealed class WebDavDeleteClientV030 : WebDavReadClient
{
    public WebDavDeleteClientV030(string baseUrl, string username, string password, RequestGate gate)
        : base(baseUrl, username, password, gate) { }

    public async Task DeleteObjectAsync(string relativePath, CancellationToken cancellationToken)
    {
        var uri = BuildUri(relativePath, directory: false);
        await WaitGateAsync(cancellationToken).ConfigureAwait(false);
        using var request = new HttpRequestMessage(HttpMethod.Delete, uri);
        HttpResponseMessage response;
        try
        {
            response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);
        }
        catch (HttpRequestException ex)
        {
            var afterFailure = await GetMetadataAsync(relativePath, cancellationToken).ConfigureAwait(false);
            if (afterFailure is null) return;
            throw new WebDavException(
                $"DELETE connection failed and the target still exists: {uri.GetLeftPart(UriPartial.Path)}",
                null, null, ex);
        }
        catch (OperationCanceledException ex) when (!cancellationToken.IsCancellationRequested)
        {
            var afterTimeout = await GetMetadataAsync(relativePath, cancellationToken).ConfigureAwait(false);
            if (afterTimeout is null) return;
            throw new WebDavException(
                $"DELETE timed out and the target still exists: {uri.GetLeftPart(UriPartial.Path)}",
                null, null, ex);
        }

        using (response)
        {
            if (response.StatusCode != HttpStatusCode.NotFound && !response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                throw new WebDavException(
                    $"DELETE failed for {uri.GetLeftPart(UriPartial.Path)}: {(int)response.StatusCode} {response.ReasonPhrase}",
                    response.StatusCode,
                    body);
            }
        }

        var confirmed = await GetMetadataAsync(relativePath, cancellationToken).ConfigureAwait(false);
        if (confirmed is not null)
            throw new WebDavException($"DELETE returned but the target still exists: {uri.GetLeftPart(UriPartial.Path)}");
    }
}

internal static class ReconciliationRemovalV030
{
    public static async Task<IReadOnlyList<RemovalActionResultV030>> DeleteGroupsAsync(
        this ReconciliationRuntimeV030 runtime,
        IEnumerable<string> groupKeys,
        CancellationToken cancellationToken = default)
    {
        var host = runtime.Host;
        var currentCycle = runtime.CurrentCycleId;
        if (string.IsNullOrWhiteSpace(currentCycle))
            throw new InvalidOperationException("当前没有已确认的坚果云额度周期，不能执行删除审查。");
        if (!host.IsConfigured)
            throw new InvalidOperationException("连接尚未配置，不能执行删除审查。");

        var secrets = await host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
        using var source = new WebDavReadClient(host.Config.SourceBaseUrl, host.Config.SourceUsername, secrets.SourcePassword);
        var requestGate = new RequestGate(TimeSpan.FromMilliseconds(host.Config.TargetMinimumRequestIntervalMs));
        using var target = new WebDavWriteClient(host.Config.TargetBaseUrl, host.Config.TargetUsername, secrets.TargetPassword, requestGate);
        using var deleteClient = new WebDavDeleteClientV030(host.Config.TargetBaseUrl, host.Config.TargetUsername, secrets.TargetPassword, requestGate);

        var results = new List<RemovalActionResultV030>();
        foreach (var groupKey in groupKeys.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            results.Add(await DeleteOneAsync(runtime, groupKey, source, target, deleteClient, cancellationToken).ConfigureAwait(false));
        }

        await runtime.SaveAsync(cancellationToken).ConfigureAwait(false);
        await runtime.SaveMigrationStateAsync(cancellationToken).ConfigureAwait(false);
        return results;
    }

    private static async Task<RemovalActionResultV030> DeleteOneAsync(
        ReconciliationRuntimeV030 runtime,
        string groupKey,
        WebDavReadClient source,
        WebDavWriteClient target,
        WebDavDeleteClientV030 deleteClient,
        CancellationToken cancellationToken)
    {
        var host = runtime.Host;
        var recycle = runtime.FindGroup(groupKey);
        if (recycle is null)
            return new RemovalActionResultV030(groupKey, false, false, true, "回收站中已经找不到该附件组。已停止删除。");

        // A delete transaction is legal only while the current cycle still exposes the group as
        // an actionable review item. This is a core safety gate, not merely a UI convention.
        var disposition = ReconciliationPolicy.GetDisposition(recycle, runtime.CurrentCycleId);
        if (disposition is not RecycleDisposition.ReviewRequired and not RecycleDisposition.Blocked)
            return new RemovalActionResultV030(groupKey, false, false, true, "该附件组当前不处于可人工审查状态。已停止删除。");

        var records = host.State.Files.Values
            .Where(record => string.Equals(record.GroupKey, groupKey, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        var trusted = records.Where(ReconciliationPolicy.IsHistoricallyVerified).ToArray();
        if (records.Length != trusted.Length || !ReconciliationPolicy.IsCompleteHistoricalGroup(trusted))
        {
            recycle.LastIssue = "BLOCKED: 历史附件组不是完整 StrongVerified 组，禁止删除。";
            return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue);
        }

        // Recheck every exact source member immediately before any destructive target action.
        // A full recovery cancels deletion. A partial zip/prop recovery is an anomaly and must never
        // be simplified into either "still deleted" or "fully restored".
        var sourceNow = new Dictionary<string, WebDavEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var record in trusted)
        {
            var sourcePath = JoinPath(host.Config.SourceRootPath, record.RelativePath);
            var sourceMetadata = await source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false);
            if (sourceMetadata is not null)
                sourceNow[record.RelativePath] = sourceMetadata;
        }

        if (sourceNow.Count > 0)
        {
            recycle.FirstMissingCycleId = null;
            recycle.FirstMissingAt = null;
            recycle.LastDeferredCycleId = null;
            recycle.LastDeferredAt = null;
            recycle.LastSeenCycleId = runtime.CurrentCycleId;

            if (sourceNow.Count != trusted.Length)
            {
                recycle.LastIssue = "BLOCKED: 删除审查前 InfiniCLOUD 只恢复了该 Zotero 附件组的部分成员。DavBridge 已禁止删除，请本周期保留并等待源端恢复或再次确认。";
                return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue);
            }

            recycle.LastIssue = null;
            foreach (var record in trusted)
            {
                var sourceMetadata = sourceNow[record.RelativePath];
                if (!ReconciliationPolicy.IsMetadataCurrent(record, sourceMetadata))
                {
                    record.Status = TransferStatus.SourceChanged;
                    record.LastError = "删除审查时发现源端对象已经恢复且版本发生变化，将重新进入迁移校验。";
                }
            }
            return new RemovalActionResultV030(groupKey, false, true, false, "InfiniCLOUD 中已经完整恢复该附件组，删除已自动取消。");
        }

        var presentTargets = new List<TransferRecord>();
        foreach (var record in trusted)
        {
            var targetPath = JoinPath(host.Config.TargetRootPath, record.RelativePath);
            var metadata = await target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false);
            if (metadata is null) continue;
            if (metadata.ContentLength.HasValue && metadata.ContentLength.Value != record.SourceSize)
            {
                recycle.LastIssue = $"BLOCKED: 目标大小与历史 StrongVerified 记录不一致：{record.RelativePath}。";
                return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue);
            }

            var etagMatches = !string.IsNullOrWhiteSpace(record.TargetETag) &&
                              !string.IsNullOrWhiteSpace(metadata.ETag) &&
                              string.Equals(record.TargetETag, metadata.ETag, StringComparison.Ordinal);
            if (!etagMatches)
            {
                if (string.IsNullOrWhiteSpace(record.TargetSha256))
                {
                    recycle.LastIssue = $"BLOCKED: 无法证明目标身份：{record.RelativePath}。";
                    return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue);
                }

                var expected = Math.Max(0, metadata.ContentLength ?? record.SourceSize);
                var quota = QuotaPolicy.GetSnapshot(host.Config, host.State, DateTimeOffset.Now);
                if (!QuotaPolicy.CanStartDownload(expected, quota))
                {
                    recycle.LastIssue = $"BLOCKED: 删除前需要重新核验目标，但当前安全下载额度不足：{record.RelativePath}。";
                    return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue);
                }

                var download = await target.DownloadAndHashAsync(targetPath, cancellationToken).ConfigureAwait(false);
                host.State.VerifiedDownloadBytesSinceCalibration += download.Bytes;
                if (download.Bytes != record.SourceSize ||
                    !string.Equals(download.Sha256, record.TargetSha256, StringComparison.OrdinalIgnoreCase))
                {
                    recycle.LastIssue = $"BLOCKED: 目标内容已经不是历史 StrongVerified 对象：{record.RelativePath}。";
                    return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue);
                }
                record.TargetETag = metadata.ETag;
            }
            presentTargets.Add(record);
        }

        try
        {
            foreach (var record in presentTargets.OrderBy(record => MemberOrder(record.RelativePath)))
            {
                var targetPath = JoinPath(host.Config.TargetRootPath, record.RelativePath);
                await deleteClient.DeleteObjectAsync(targetPath, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or WebDavException)
        {
            recycle.LastIssue = "BLOCKED: 本次人工删除没有完整结束。DavBridge 不会盲目重发删除请求，请重新打开清单再次人工审查。";
            return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue + " " + ex.Message);
        }

        foreach (var record in trusted)
        {
            var targetPath = JoinPath(host.Config.TargetRootPath, record.RelativePath);
            if (await target.GetMetadataAsync(targetPath, cancellationToken).ConfigureAwait(false) is not null)
            {
                recycle.LastIssue = $"BLOCKED: 删除后目标仍然存在：{record.RelativePath}。";
                return new RemovalActionResultV030(groupKey, false, false, true, recycle.LastIssue);
            }
        }

        recycle.RemovedCycleId = runtime.CurrentCycleId;
        recycle.RemovedAt = DateTimeOffset.Now;
        recycle.LastIssue = null;
        recycle.LastDeferredCycleId = null;
        recycle.LastDeferredAt = null;
        return new RemovalActionResultV030(groupKey, true, false, false, "坚果云目标附件组已经按人工确认删除，并完成准确路径不存在复核。");
    }

    private static int MemberOrder(string relativePath) => Path.GetExtension(relativePath).ToLowerInvariant() switch
    {
        ".zip" => 0,
        ".prop" => 1,
        _ => 2
    };

    private static string JoinPath(string root, string relative) =>
        string.Join('/', new[] { root, relative }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim('/')));
}
