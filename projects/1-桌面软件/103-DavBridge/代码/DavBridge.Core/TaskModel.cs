namespace DavBridge.Core;

public enum TransferTaskKind
{
    Migration,
    Backup,
    Mirror
}

public enum EndpointKind
{
    WebDav,
    LocalFolder
}

public enum GroupingMode
{
    IndividualFiles,
    ZoteroZipPropByStem
}

public enum ExistingTargetPolicy
{
    AdoptIfIdenticalOtherwiseConflict
}

public enum VerificationMode
{
    StrongSha256
}

public sealed class EndpointDefinition
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string DisplayName { get; set; } = string.Empty;
    public EndpointKind Kind { get; set; } = EndpointKind.WebDav;
    public string BaseUrl { get; set; } = string.Empty;
    public string RootPath { get; set; } = string.Empty;
    public string CredentialKey { get; set; } = string.Empty;
    public bool ReadOnly { get; set; }
    public string? ProviderId { get; set; }
}

public sealed class QuotaDefinition
{
    public bool Enabled { get; set; }
    public long UploadQuotaBytes { get; set; }
    public long DownloadQuotaBytes { get; set; }
    public long NormalReserveBytes { get; set; }
    public long SprintReserveBytes { get; set; }
    public int SprintWindowHours { get; set; }
    public DateTimeOffset NextResetDate { get; set; }
    public int ResetProbeLocalHour { get; set; } = 9;
}

public sealed class TransferPolicyDefinition
{
    public GroupingMode Grouping { get; set; } = GroupingMode.IndividualFiles;
    public VerificationMode Verification { get; set; } = VerificationMode.StrongSha256;
    public ExistingTargetPolicy ExistingTarget { get; set; } = ExistingTargetPolicy.AdoptIfIdenticalOtherwiseConflict;
    public bool DeleteExtraneousTargetObjects { get; set; }
    public bool PropagateSourceDeletes { get; set; }
    public int UploadLimitBytesPerSecond { get; set; } = 300_000;
    public int TargetMinimumRequestIntervalMs { get; set; }
    public long TargetSingleFileLimitBytes { get; set; } = long.MaxValue;
    public QuotaDefinition Quota { get; set; } = new();
}

public sealed class TransferTaskDefinition
{
    public int SchemaVersion { get; set; } = 1;
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = string.Empty;
    public string TemplateId { get; set; } = TaskTemplates.GenericWebDavTemplateId;
    public TransferTaskKind Kind { get; set; } = TransferTaskKind.Migration;
    public EndpointDefinition Source { get; set; } = new();
    public EndpointDefinition Target { get; set; } = new();
    public TransferPolicyDefinition Policy { get; set; } = new();
    public bool Enabled { get; set; }
    public bool AutoResume { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public static class TaskTemplates
{
    public const string GenericWebDavTemplateId = "generic-webdav-one-way";
    public const string ZoteroWebDavTemplateId = "zotero-webdav-one-way";
    public const string NutstoreProviderId = "nutstore";
    public const string InfiniCloudProviderId = "infinicloud";

    public static TransferTaskDefinition CreateGenericWebDav(string name = "WebDAV 迁移") => new()
    {
        Name = name,
        TemplateId = GenericWebDavTemplateId,
        Kind = TransferTaskKind.Migration,
        Source = new EndpointDefinition
        {
            DisplayName = "源 WebDAV",
            Kind = EndpointKind.WebDav,
            CredentialKey = "source",
            ReadOnly = true
        },
        Target = new EndpointDefinition
        {
            DisplayName = "目标 WebDAV",
            Kind = EndpointKind.WebDav,
            CredentialKey = "target"
        },
        Policy = new TransferPolicyDefinition
        {
            Grouping = GroupingMode.IndividualFiles,
            Verification = VerificationMode.StrongSha256,
            ExistingTarget = ExistingTargetPolicy.AdoptIfIdenticalOtherwiseConflict,
            DeleteExtraneousTargetObjects = false,
            PropagateSourceDeletes = false
        }
    };

    public static TransferTaskDefinition CreateZoteroWebDav(string name = "Zotero WebDAV 迁移")
    {
        var task = CreateGenericWebDav(name);
        task.TemplateId = ZoteroWebDavTemplateId;
        task.Policy.Grouping = GroupingMode.ZoteroZipPropByStem;
        return task;
    }
}

public sealed record LegacyV017TaskProjection(
    TransferTaskDefinition Task,
    bool RequiresConfigRewrite,
    bool RequiresStateRewrite,
    bool RequiresSecretsRewrite,
    string CompatibilityMode);

public static class LegacyV017Adapter
{
    public const string LegacyTaskId = "legacy-zotero-v017";

    /// <summary>
    /// Projects the v0.1.7 single-job configuration into the v0.2 task model without writing or mutating
    /// config.json, state.json or secrets.dat. This is intentionally a read-only compatibility layer.
    /// </summary>
    public static LegacyV017TaskProjection Project(DavBridgeConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);

        var task = TaskTemplates.CreateZoteroWebDav("Zotero 附件迁移");
        task.Id = LegacyTaskId;
        task.Enabled = config.MigrationEnabled;
        task.AutoResume = config.AutoResume;

        task.Source.BaseUrl = config.SourceBaseUrl;
        task.Source.RootPath = config.SourceRootPath;
        task.Source.ProviderId = TaskTemplates.InfiniCloudProviderId;
        task.Source.ReadOnly = true;

        task.Target.BaseUrl = config.TargetBaseUrl;
        task.Target.RootPath = config.TargetRootPath;
        task.Target.ProviderId = TaskTemplates.NutstoreProviderId;

        task.Policy.UploadLimitBytesPerSecond = config.UploadLimitBytesPerSecond;
        task.Policy.TargetMinimumRequestIntervalMs = config.TargetMinimumRequestIntervalMs;
        task.Policy.TargetSingleFileLimitBytes = config.TargetSingleFileLimitBytes;
        task.Policy.Quota = new QuotaDefinition
        {
            Enabled = true,
            UploadQuotaBytes = config.UploadQuotaBytes,
            DownloadQuotaBytes = config.DownloadQuotaBytes,
            NormalReserveBytes = config.NormalReserveBytes,
            SprintReserveBytes = config.SprintReserveBytes,
            SprintWindowHours = config.SprintWindowHours,
            NextResetDate = config.NextResetAt,
            ResetProbeLocalHour = 9
        };

        return new LegacyV017TaskProjection(
            task,
            RequiresConfigRewrite: false,
            RequiresStateRewrite: false,
            RequiresSecretsRewrite: false,
            CompatibilityMode: "read-only projection over v0.1.7 data");
    }
}
