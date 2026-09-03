using System.Runtime.CompilerServices;
using System.Text.Json;
using DavBridge.Core;

namespace DavBridge;

internal sealed record ReconciliationGateV030(
    ReconciliationSummary Summary,
    int HumanActionGroups,
    bool RequiresHumanAction)
{
    public string Message => RequiresHumanAction
        ? $"周期对账已完成，{HumanActionGroups} 个附件组需要人工审查。普通迁移将在审查后继续。"
        : Summary.Message;
}

internal sealed class ReconciliationStoreV030
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private readonly string _path;
    private readonly bool _persistent;

    public ReconciliationStoreV030(string roamingRoot, bool persistent)
    {
        _path = Path.Combine(roamingRoot, "reconcile.json");
        _persistent = persistent;
    }

    public ReconciliationState Load()
    {
        if (!_persistent) return new ReconciliationState();
        if (TryLoad(_path, out var state)) return state;
        if (TryLoad(_path + ".bak", out state)) return state;
        return new ReconciliationState();
    }

    public async Task SaveAsync(ReconciliationState state, CancellationToken cancellationToken = default)
    {
        if (!_persistent) return;
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var temp = _path + ".tmp";
        var backup = _path + ".bak";
        var json = JsonSerializer.Serialize(state, JsonOptions);
        await File.WriteAllTextAsync(temp, json, cancellationToken).ConfigureAwait(false);
        using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            stream.Flush(true);
        if (File.Exists(_path)) File.Copy(_path, backup, true);
        File.Move(temp, _path, true);
    }

    private static bool TryLoad(string path, out ReconciliationState state)
    {
        state = new ReconciliationState();
        if (!File.Exists(path)) return false;
        try
        {
            state = JsonSerializer.Deserialize<ReconciliationState>(File.ReadAllText(path), JsonOptions) ?? new ReconciliationState();
            state.Groups = new Dictionary<string, ReconciliationGroupState>(state.Groups, StringComparer.OrdinalIgnoreCase);
            return true;
        }
        catch
        {
            return false;
        }
    }
}

internal sealed class ReconciliationRuntimeV030 : IDisposable
{
    private static readonly ConditionalWeakTable<AppHost, ReconciliationRuntimeV030> Runtimes = new();

    private readonly AppHost _host;
    private readonly ReconciliationStoreV030 _store;
    private readonly SemaphoreSlim _operationGate = new(1, 1);
    private readonly StateStore _migrationStateStore;
    private bool _disposed;

    public ReconciliationState State { get; private set; }
    public bool IsAuditing { get; private set; }
    public event EventHandler? Changed;

    private ReconciliationRuntimeV030(AppHost host, bool persistent)
    {
        _host = host;
        _store = new ReconciliationStoreV030(host.Paths.RoamingRoot, persistent);
        _migrationStateStore = new StateStore(host.Paths.StatePath);
        State = _store.Load();
        RefreshCycleIdentity();
    }

    public static ReconciliationRuntimeV030 Attach(AppHost host, bool persistent = true) =>
        Runtimes.GetValue(host, key => new ReconciliationRuntimeV030(key, persistent));

    public static async Task<ReconciliationGateV030> BeforeMigrationAsync(AppHost host, CancellationToken cancellationToken)
    {
        var runtime = Runtimes.GetValue(host, key => new ReconciliationRuntimeV030(key, persistent: true));
        return await runtime.EnsureAuditAsync(cancellationToken).ConfigureAwait(false);
    }

    public string? CurrentCycleId
    {
        get
        {
            RefreshCycleIdentity();
            return State.CurrentCycleId;
        }
    }

    public bool NeedsAudit
    {
        get
        {
            RefreshCycleIdentity();
            return !string.IsNullOrWhiteSpace(State.CurrentCycleId) &&
                   !string.Equals(State.LastReconciledCycleId, State.CurrentCycleId, StringComparison.OrdinalIgnoreCase);
        }
    }

    public IReadOnlyList<ReconciliationGroupState> GetRecycleGroups()
    {
        RefreshCycleIdentity();
        return State.Groups.Values
            .Where(group => !string.IsNullOrWhiteSpace(group.FirstMissingCycleId) ||
                            group.RemovedAt.HasValue ||
                            ReconciliationPolicy.IsBlocked(group))
            .OrderBy(group => RecycleOrder(ReconciliationPolicy.GetDisposition(group, State.CurrentCycleId)))
            .ThenBy(group => group.FirstMissingAt ?? DateTimeOffset.MaxValue)
            .ThenBy(group => group.GroupKey, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public int GetHumanActionCount()
    {
        RefreshCycleIdentity();
        return State.Groups.Values.Count(RequiresHumanAction);
    }

    public async Task<ReconciliationGateV030> EnsureAuditAsync(CancellationToken cancellationToken = default, bool force = false)
    {
        await _operationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            RefreshCycleIdentity();
            if (string.IsNullOrWhiteSpace(State.CurrentCycleId))
                return BuildGate(BuildSummary(false, "流量周期尚未校准，源端周期对账暂未启动。"));
            if (!force && string.Equals(State.LastReconciledCycleId, State.CurrentCycleId, StringComparison.OrdinalIgnoreCase))
                return BuildGate(BuildSummary(false, "本周期源端对账已经完成。"));
            if (!_host.IsConfigured)
                return BuildGate(BuildSummary(false, "连接尚未配置，源端周期对账暂未启动。"));

            IsAuditing = true;
            RaiseChanged();
            return BuildGate(await AuditCoreAsync(cancellationToken).ConfigureAwait(false));
        }
        finally
        {
            IsAuditing = false;
            RaiseChanged();
            _operationGate.Release();
        }
    }

    public async Task DeferGroupsAsync(IEnumerable<string> groupKeys, CancellationToken cancellationToken = default)
    {
        await _operationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            RefreshCycleIdentity();
            if (string.IsNullOrWhiteSpace(State.CurrentCycleId)) return;
            var keys = groupKeys.ToHashSet(StringComparer.OrdinalIgnoreCase);
            var now = DateTimeOffset.Now;
            foreach (var group in State.Groups.Values.Where(group => keys.Contains(group.GroupKey)))
            {
                if (!RequiresHumanAction(group)) continue;
                group.LastDeferredCycleId = State.CurrentCycleId;
                group.LastDeferredAt = now;
            }
            await _store.SaveAsync(State, cancellationToken).ConfigureAwait(false);
            RaiseChanged();
        }
        finally
        {
            _operationGate.Release();
        }
    }

    internal async Task SaveAsync(CancellationToken cancellationToken = default)
    {
        await _store.SaveAsync(State, cancellationToken).ConfigureAwait(false);
        RaiseChanged();
    }

    internal async Task SaveMigrationStateAsync(CancellationToken cancellationToken = default) =>
        await _migrationStateStore.SaveAsync(_host.State, cancellationToken).ConfigureAwait(false);

    internal ReconciliationGroupState? FindGroup(string groupKey) =>
        State.Groups.TryGetValue(groupKey, out var group) ? group : null;

    internal AppHost Host => _host;

    internal async Task<T> ExecuteExclusiveAsync<T>(Func<Task<T>> operation, CancellationToken cancellationToken)
    {
        await _operationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            return await operation().ConfigureAwait(false);
        }
        finally
        {
            _operationGate.Release();
        }
    }

    private async Task<ReconciliationSummary> AuditCoreAsync(CancellationToken cancellationToken)
    {
        var secrets = await _host.GetSecretsAsync(cancellationToken).ConfigureAwait(false);
        using var source = new WebDavReadClient(_host.Config.SourceBaseUrl, _host.Config.SourceUsername, secrets.SourcePassword);
        var entries = await source.ListDirectoryAsync(_host.Config.SourceRootPath, cancellationToken).ConfigureAwait(false);
        var sourceGroups = MigrationPlanner.CreateGroups(entries)
            .ToDictionary(group => group.Key, StringComparer.OrdinalIgnoreCase);

        var allRecordsByGroup = _host.State.Files.Values
            .Where(record => !string.IsNullOrWhiteSpace(record.GroupKey))
            .GroupBy(record => record.GroupKey, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.OrdinalIgnoreCase);
        var knownGroupKeys = allRecordsByGroup.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase);

        var changedGroups = 0;
        foreach (var (groupKey, allRecords) in allRecordsByGroup)
        {
            var trustedRecords = allRecords.Where(ReconciliationPolicy.IsHistoricallyVerified).ToArray();
            if (trustedRecords.Length == 0) continue;
            var recycle = GetOrCreateGroup(groupKey);

            if (!sourceGroups.TryGetValue(groupKey, out var currentGroup))
            {
                if (allRecords.Length == trustedRecords.Length && ReconciliationPolicy.IsCompleteHistoricalGroup(trustedRecords))
                {
                    if (!recycle.RemovedAt.HasValue && string.IsNullOrWhiteSpace(recycle.FirstMissingCycleId))
                    {
                        recycle.FirstMissingCycleId = State.CurrentCycleId;
                        recycle.FirstMissingAt = DateTimeOffset.Now;
                        recycle.LastDeferredCycleId = null;
                        recycle.LastDeferredAt = null;
                        recycle.LastIssue = null;
                    }
                }
                else
                {
                    recycle.LastIssue = "历史附件组并非完整 StrongVerified 组，DavBridge 不会把它进入删除候选。";
                }
                continue;
            }

            recycle.LastSeenCycleId = State.CurrentCycleId;
            var hadRemovedState = recycle.RemovedAt.HasValue;
            var hadMissingState = !string.IsNullOrWhiteSpace(recycle.FirstMissingCycleId);
            var sourceMembers = currentGroup.Members.ToDictionary(member => member.RelativePath, StringComparer.OrdinalIgnoreCase);
            var isHistoricalZoteroPair = trustedRecords.Any(record => IsZoteroMember(record.RelativePath));
            if (isHistoricalZoteroPair && !trustedRecords.All(record => sourceMembers.ContainsKey(record.RelativePath)))
            {
                ClearMissingObservation(recycle);
                recycle.LastIssue = "BLOCKED: InfiniCLOUD 当前只显示历史 Zotero 附件组的部分成员。DavBridge 不会按单个 zip 或 prop 推断删除，请人工保留并等待源端恢复或确认。";
                continue;
            }

            if (hadMissingState || hadRemovedState)
                ClearMissingAndRemoved(recycle);
            if (ReconciliationPolicy.IsBlocked(recycle))
            {
                recycle.LastIssue = null;
                recycle.LastDeferredCycleId = null;
                recycle.LastDeferredAt = null;
            }

            var groupChanged = false;
            foreach (var record in trustedRecords)
            {
                if (!sourceMembers.TryGetValue(record.RelativePath, out var member)) continue;

                if (hadRemovedState)
                {
                    record.Status = TransferStatus.SourceChanged;
                    record.LastError = "源端对象在人工删除目标后重新出现，将优先恢复到坚果云并重新强校验。";
                    groupChanged = true;
                    continue;
                }

                if (record.Status != TransferStatus.StrongVerified || ReconciliationPolicy.IsMetadataCurrent(record, member))
                    continue;

                groupChanged |= await RefreshSourceHashAsync(source, record, member, cancellationToken).ConfigureAwait(false);
            }
            if (groupChanged) changedGroups++;
        }

        var newGroups = sourceGroups.Keys.Count(groupKey => !knownGroupKeys.Contains(groupKey));
        State.LastManifestObjectCount = entries.Count(entry => !entry.IsCollection);
        State.LastManifestGroupCount = sourceGroups.Count;
        State.LastChangedGroupCount = changedGroups;
        State.LastNewGroupCount = newGroups;
        State.LastMissingGroupCount = State.Groups.Values.Count(group => !group.RemovedAt.HasValue && !string.IsNullOrWhiteSpace(group.FirstMissingCycleId));
        State.LastReconciledCycleId = State.CurrentCycleId;
        State.LastReconciledAt = DateTimeOffset.Now;

        await _migrationStateStore.SaveAsync(_host.State, cancellationToken).ConfigureAwait(false);
        await _store.SaveAsync(State, cancellationToken).ConfigureAwait(false);
        RaiseChanged();

        var review = State.Groups.Values.Count(RequiresHumanAction);
        var message = review > 0
            ? $"周期 {State.CurrentCycleId} 对账完成：源端 {State.LastManifestGroupCount:N0} 组，确认内容变化 {changedGroups:N0} 组，新增 {newGroups:N0} 组，{review:N0} 组需要人工审查。"
            : $"周期 {State.CurrentCycleId} 对账完成：源端 {State.LastManifestGroupCount:N0} 组，确认内容变化 {changedGroups:N0} 组，新增 {newGroups:N0} 组。";
        return new ReconciliationSummary(
            State.CurrentCycleId,
            State.LastManifestObjectCount,
            State.LastManifestGroupCount,
            changedGroups,
            newGroups,
            State.LastMissingGroupCount,
            review,
            true,
            message);
    }

    private async Task<bool> RefreshSourceHashAsync(
        WebDavReadClient source,
        TransferRecord record,
        WebDavEntry manifestMember,
        CancellationToken cancellationToken)
    {
        var sourcePath = JoinPath(_host.Config.SourceRootPath, manifestMember.RelativePath);
        var before = await source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        if (before is null)
        {
            record.Status = TransferStatus.SourceChanged;
            record.LastError = "源端 metadata 变化后对象又消失，等待下一轮重新判断。";
            return true;
        }

        var download = await source.DownloadAndHashAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        var after = await source.GetMetadataAsync(sourcePath, cancellationToken).ConfigureAwait(false);
        if (after is null || MetadataChanged(before, after))
        {
            record.Status = TransferStatus.SourceChanged;
            record.LastError = "源端对象在本次 SHA-256 核验期间继续变化，结果未采用。";
            return true;
        }

        if (string.Equals(download.Sha256, record.SourceSha256, StringComparison.OrdinalIgnoreCase))
        {
            record.SourceSize = download.Bytes;
            record.SourceETag = after.ETag;
            record.SourceLastModified = after.LastModified;
            record.Status = TransferStatus.StrongVerified;
            record.LastError = null;
            return false;
        }

        // Keep the last StrongVerified source metadata until ordinary migration establishes a new
        // source and target baseline. This preserves the identity of the still-current target copy.
        record.Status = TransferStatus.SourceChanged;
        record.LastError = "InfiniCLOUD 当前 SHA-256 与历史 StrongVerified 基线不同，将优先刷新坚果云副本。";
        return true;
    }

    private ReconciliationGroupState GetOrCreateGroup(string groupKey)
    {
        if (State.Groups.TryGetValue(groupKey, out var group)) return group;
        group = new ReconciliationGroupState { GroupKey = groupKey };
        State.Groups[groupKey] = group;
        return group;
    }

    private void RefreshCycleIdentity()
    {
        var current = ReconciliationPolicy.DeriveCurrentCycleId(_host.Config.NextResetAt);
        if (string.IsNullOrWhiteSpace(current)) return;
        if (string.Equals(State.CurrentCycleId, current, StringComparison.OrdinalIgnoreCase)) return;
        State.CurrentCycleId = current;
    }

    private ReconciliationSummary BuildSummary(bool reconciledThisPass, string message) => new(
        State.CurrentCycleId,
        State.LastManifestObjectCount,
        State.LastManifestGroupCount,
        State.LastChangedGroupCount,
        State.LastNewGroupCount,
        State.LastMissingGroupCount,
        State.Groups.Values.Count(RequiresHumanAction),
        reconciledThisPass,
        message);

    private ReconciliationGateV030 BuildGate(ReconciliationSummary summary)
    {
        var human = State.Groups.Values.Count(RequiresHumanAction);
        return new ReconciliationGateV030(summary with { ReviewRequiredGroups = human }, human, human > 0);
    }

    private bool RequiresHumanAction(ReconciliationGroupState group) =>
        ReconciliationPolicy.RequiresReview(group, State.CurrentCycleId);

    private static int RecycleOrder(RecycleDisposition disposition) => disposition switch
    {
        RecycleDisposition.ReviewRequired => 0,
        RecycleDisposition.Blocked => 0,
        RecycleDisposition.Observing => 1,
        RecycleDisposition.DeferredThisCycle => 2,
        RecycleDisposition.Removed => 3,
        _ => 4
    };

    private static bool MetadataChanged(WebDavEntry before, WebDavEntry after)
    {
        if (before.ContentLength != after.ContentLength) return true;
        if (!string.IsNullOrWhiteSpace(before.ETag) && !string.IsNullOrWhiteSpace(after.ETag) &&
            !string.Equals(before.ETag, after.ETag, StringComparison.Ordinal)) return true;
        if (before.LastModified.HasValue && after.LastModified.HasValue && before.LastModified.Value != after.LastModified.Value) return true;
        return false;
    }

    private static void ClearMissingObservation(ReconciliationGroupState recycle)
    {
        recycle.FirstMissingCycleId = null;
        recycle.FirstMissingAt = null;
        recycle.LastDeferredCycleId = null;
        recycle.LastDeferredAt = null;
    }

    private static void ClearMissingAndRemoved(ReconciliationGroupState recycle)
    {
        ClearMissingObservation(recycle);
        recycle.RemovedCycleId = null;
        recycle.RemovedAt = null;
    }

    private static bool IsZoteroMember(string relativePath)
    {
        var extension = Path.GetExtension(relativePath);
        return extension.Equals(".zip", StringComparison.OrdinalIgnoreCase) ||
               extension.Equals(".prop", StringComparison.OrdinalIgnoreCase);
    }

    private static string JoinPath(string root, string relative) =>
        string.Join('/', new[] { root, relative }
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value.Trim('/')));

    private void RaiseChanged()
    {
        try { Changed?.Invoke(this, EventArgs.Empty); } catch { }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(ReconciliationRuntimeV030));
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _operationGate.Dispose();
    }
}
