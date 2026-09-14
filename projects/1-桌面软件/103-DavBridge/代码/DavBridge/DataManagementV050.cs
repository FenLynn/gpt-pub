using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;

namespace DavBridge;

internal sealed record DataFileViewV050(
    string Key,
    string Label,
    string Category,
    string Path,
    string Purpose,
    string BackupPolicy,
    string Status,
    bool Exists);

internal sealed record DataOverviewV050(
    string DataRoot,
    string LocalRoot,
    string BootstrapPath,
    string BackupDirectory,
    string LastBackupText,
    string LastBackupPath,
    bool HasManualBackup,
    int PresentPersistentCount,
    IReadOnlyList<DataFileViewV050> Files);

internal sealed record BackupInspectionV050(
    string ProductVersion,
    DateTimeOffset CreatedAt,
    int FileCount,
    bool ContainsMachineBoundSecrets);

internal sealed record RestoreResultV050(
    int RestoredCount,
    bool SecretsSkipped,
    string SafetyBackupPath);

internal static class DataBootstrapV050
{
    private sealed class BootstrapState
    {
        public int SchemaVersion { get; set; } = 1;
        public string DataRoot { get; set; } = string.Empty;
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public static string ResolveDataRoot(string defaultRoot, string bootstrapPath)
    {
        var fallback = Path.GetFullPath(defaultRoot);
        try
        {
            if (File.Exists(bootstrapPath))
            {
                var state = JsonSerializer.Deserialize<BootstrapState>(File.ReadAllText(bootstrapPath), JsonOptions);
                if (state is not null && !string.IsNullOrWhiteSpace(state.DataRoot))
                    return Path.GetFullPath(Environment.ExpandEnvironmentVariables(state.DataRoot.Trim()));
            }
        }
        catch
        {
        }

        try { SetDataRoot(bootstrapPath, fallback); } catch { }
        return fallback;
    }

    public static void SetDataRoot(string bootstrapPath, string dataRoot)
    {
        var normalized = Path.GetFullPath(Environment.ExpandEnvironmentVariables(dataRoot.Trim()));
        Directory.CreateDirectory(Path.GetDirectoryName(bootstrapPath)!);
        var temp = bootstrapPath + ".tmp";
        var backup = bootstrapPath + ".bak";
        var json = JsonSerializer.Serialize(new BootstrapState { DataRoot = normalized }, JsonOptions);
        File.WriteAllText(temp, json);
        using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            stream.Flush(true);
        if (File.Exists(bootstrapPath))
            File.Copy(bootstrapPath, backup, true);
        File.Move(temp, bootstrapPath, true);
    }
}

internal static class DataManagementV050
{
    private const int BackupFormatVersion = 1;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    private sealed record Descriptor(
        string Key,
        string Label,
        string Category,
        string FullPath,
        string Purpose,
        string BackupPolicy,
        bool IsDirectory,
        bool Persistent);

    private sealed class BackupManifest
    {
        public int FormatVersion { get; set; } = BackupFormatVersion;
        public string Product { get; set; } = "DavBridge";
        public string ProductVersion { get; set; } = BuildInfoV044.Version;
        public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.Now;
        public List<BackupManifestFile> Files { get; set; } = new();
    }

    private sealed class BackupManifestFile
    {
        public string Entry { get; set; } = string.Empty;
        public string Sha256 { get; set; } = string.Empty;
        public long Size { get; set; }
        public bool MachineBound { get; set; }
    }

    private sealed class BackupStatus
    {
        public DateTimeOffset? LastManualBackupAt { get; set; }
        public string LastManualBackupPath { get; set; } = string.Empty;
    }

    public static string GetBackupDirectory(AppPaths paths) => Path.Combine(paths.DataRoot, "Backups");

    public static DataOverviewV050 BuildOverview(AppPaths paths)
    {
        var descriptors = BuildDescriptors(paths);
        var files = descriptors.Select(ToView).ToArray();
        var status = ReadBackupStatus(paths);
        var lastPath = status?.LastManualBackupPath ?? string.Empty;
        var lastText = status?.LastManualBackupAt is DateTimeOffset at
            ? at.ToLocalTime().ToString("MM-dd HH:mm")
            : "尚未备份";
        if (!string.IsNullOrWhiteSpace(lastPath) && !File.Exists(lastPath))
            lastText += " · 文件已移动";

        return new DataOverviewV050(
            paths.DataRoot,
            paths.LocalRoot,
            paths.BootstrapPath,
            GetBackupDirectory(paths),
            lastText,
            lastPath,
            status?.LastManualBackupAt.HasValue == true,
            descriptors.Count(x => x.Persistent && !x.IsDirectory && File.Exists(x.FullPath)),
            files);
    }

    public static void OpenFolder(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
    }

    public static BackupInspectionV050 InspectBackup(string zipPath)
    {
        var manifest = ReadAndValidateManifest(zipPath, verifyHashes: true);
        return new BackupInspectionV050(
            manifest.ProductVersion,
            manifest.CreatedAt,
            manifest.Files.Count,
            manifest.Files.Any(x => x.MachineBound));
    }

    public static string CreateBackup(AppPaths paths, string zipPath, bool updateManualStatus)
    {
        var target = Path.GetFullPath(zipPath);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        if (File.Exists(target))
            File.Delete(target);

        var manifest = new BackupManifest();
        using (var archive = ZipFile.Open(target, ZipArchiveMode.Create))
        {
            foreach (var source in BackupSources(paths))
            {
                if (!File.Exists(source.Path)) continue;
                var info = new FileInfo(source.Path);
                var entry = archive.CreateEntry(source.Entry, CompressionLevel.Optimal);
                using (var input = new FileStream(source.Path, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var output = entry.Open())
                    input.CopyTo(output);

                manifest.Files.Add(new BackupManifestFile
                {
                    Entry = source.Entry,
                    Sha256 = HashFile(source.Path),
                    Size = info.Length,
                    MachineBound = source.MachineBound
                });
            }

            var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
            using var writer = new StreamWriter(manifestEntry.Open());
            writer.Write(JsonSerializer.Serialize(manifest, JsonOptions));
        }

        ReadAndValidateManifest(target, verifyHashes: true);
        if (updateManualStatus)
            WriteBackupStatus(paths, new BackupStatus
            {
                LastManualBackupAt = DateTimeOffset.Now,
                LastManualBackupPath = target
            });
        return target;
    }

    public static RestoreResultV050 RestoreBackup(AppPaths paths, string zipPath)
    {
        var manifest = ReadAndValidateManifest(zipPath, verifyHashes: true);
        var safetyDirectory = GetBackupDirectory(paths);
        Directory.CreateDirectory(safetyDirectory);
        var safetyBackup = Path.Combine(
            safetyDirectory,
            "DavBridge-before-restore-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".zip");
        CreateBackup(paths, safetyBackup, false);

        var staging = Path.Combine(paths.TempRoot, "RestoreStaging", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(staging);
        var restored = 0;
        var secretsSkipped = false;

        try
        {
            using var archive = ZipFile.OpenRead(zipPath);
            foreach (var item in manifest.Files)
            {
                var destination = ResolveRestoreDestination(paths, item.Entry);
                if (destination is null) continue;
                var entry = archive.GetEntry(item.Entry) ?? throw new InvalidDataException("备份缺少文件：" + item.Entry);
                var staged = Path.Combine(staging, item.Entry.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(Path.GetDirectoryName(staged)!);
                using (var input = entry.Open())
                using (var output = new FileStream(staged, FileMode.Create, FileAccess.Write, FileShare.None))
                    input.CopyTo(output);

                if (!string.Equals(HashFile(staged), item.Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("恢复 staging 校验失败：" + item.Entry);

                if (item.MachineBound && item.Entry.Equals("data/secrets.dat", StringComparison.OrdinalIgnoreCase) && !CanDecryptSecrets(staged))
                {
                    secretsSkipped = true;
                    continue;
                }

                CopyAtomic(staged, destination);
                if (!string.Equals(HashFile(staged), HashFile(destination), StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("恢复后校验失败：" + item.Entry);
                restored++;
            }
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }

        return new RestoreResultV050(restored, secretsSkipped, safetyBackup);
    }

    public static void MigrateDataRoot(AppPaths paths, string targetRoot)
    {
        var source = NormalizeDirectory(paths.DataRoot);
        var target = NormalizeDirectory(targetRoot);
        if (string.Equals(source, target, StringComparison.OrdinalIgnoreCase)) return;
        if (IsNested(source, target) || IsNested(target, source))
            throw new InvalidOperationException("新旧数据目录不能互相嵌套。请选择独立目录。");
        if (IsNested(NormalizeDirectory(paths.LocalRoot), target) || string.Equals(NormalizeDirectory(paths.LocalRoot), target, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("持久数据目录不能放进 DavBridge 本机运行目录。");

        Directory.CreateDirectory(target);
        ProbeWritable(target);
        if (Directory.EnumerateFileSystemEntries(target).Any())
            throw new InvalidOperationException("目标数据目录必须为空。为避免覆盖其他文件，请选择或新建一个空目录。");

        foreach (var name in PersistentFileNames())
        {
            var destination = Path.Combine(target, name);
            if (File.Exists(destination))
                throw new InvalidOperationException("目标目录已经存在 DavBridge 管理文件：" + name + "。为避免覆盖，请选择空目录或新的目录。");
        }

        foreach (var name in PersistentFileNames())
        {
            var sourcePath = Path.Combine(source, name);
            if (!File.Exists(sourcePath)) continue;
            var destination = Path.Combine(target, name);
            CopyAtomic(sourcePath, destination);
            if (!string.Equals(HashFile(sourcePath), HashFile(destination), StringComparison.OrdinalIgnoreCase))
                throw new IOException("数据目录迁移校验失败：" + name);
        }

        var sourceBackups = Path.Combine(source, "Backups");
        var targetBackups = Path.Combine(target, "Backups");
        if (Directory.Exists(sourceBackups))
            CopyDirectoryVerified(sourceBackups, targetBackups);

        DataBootstrapV050.SetDataRoot(paths.BootstrapPath, target);
    }

    public static bool ValidateForSelfTest(string root)
    {
        try
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
            var data = Path.Combine(root, "data");
            var local = Path.Combine(root, "local");
            Directory.CreateDirectory(data);
            Directory.CreateDirectory(local);
            var bootstrap = Path.Combine(local, "bootstrap.json");
            var paths = CreateTestPaths(data, local, bootstrap);

            File.WriteAllText(paths.ConfigPath, "{\"sample\":\"config\"}");
            File.WriteAllText(paths.StatePath, "{\"sample\":\"state\"}");
            File.WriteAllText(Path.Combine(paths.DataRoot, "reconcile.json"), "{\"sample\":\"reconcile\"}");
            File.WriteAllText(Path.Combine(paths.LocalRoot, "product-experience.json"), "{\"sample\":\"experience\"}");

            DataBootstrapV050.SetDataRoot(bootstrap, data);
            if (!string.Equals(DataBootstrapV050.ResolveDataRoot(Path.Combine(root, "fallback"), bootstrap), Path.GetFullPath(data), StringComparison.OrdinalIgnoreCase))
                return false;

            var zip = Path.Combine(root, "test-backup.zip");
            CreateBackup(paths, zip, true);
            var inspection = InspectBackup(zip);
            if (inspection.FileCount < 4) return false;

            var migrated = Path.Combine(root, "migrated");
            MigrateDataRoot(paths, migrated);
            if (!File.Exists(Path.Combine(migrated, "state.json"))) return false;

            var migratedPaths = CreateTestPaths(migrated, local, bootstrap);
            File.WriteAllText(migratedPaths.ConfigPath, "{\"sample\":\"broken\"}");
            var result = RestoreBackup(migratedPaths, zip);
            if (result.RestoredCount < 4) return false;
            return File.ReadAllText(migratedPaths.ConfigPath).Contains("config", StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    private static AppPaths CreateTestPaths(string dataRoot, string localRoot, string bootstrapPath) => new(
        dataRoot,
        dataRoot,
        localRoot,
        Path.Combine(localRoot, "Temp"),
        Path.Combine(dataRoot, "config.json"),
        Path.Combine(dataRoot, "state.json"),
        Path.Combine(dataRoot, "secrets.dat"),
        bootstrapPath);

    private static IReadOnlyList<Descriptor> BuildDescriptors(AppPaths paths)
    {
        var data = paths.DataRoot;
        var local = paths.LocalRoot;
        return new[]
        {
            new Descriptor("config", "config.json", "核心配置", paths.ConfigPath, "连接、额度、调度和后台运行设置。", "迁移备份", false, true),
            new Descriptor("config-bak", "config.json.bak", "核心备份", paths.ConfigPath + ".bak", "config.json 的自动回退副本。", "迁移备份", false, true),
            new Descriptor("state", "state.json", "迁移账本", paths.StatePath, "StrongVerified、迁移断点、文件状态和额度增量。", "迁移备份", false, true),
            new Descriptor("state-bak", "state.json.bak", "核心备份", paths.StatePath + ".bak", "state.json 的自动回退副本。", "迁移备份", false, true),
            new Descriptor("reconcile", "reconcile.json", "对账状态", Path.Combine(data, "reconcile.json"), "Cycle 对账、缺失观察、回收站与删除资格。", "迁移备份", false, true),
            new Descriptor("reconcile-bak", "reconcile.json.bak", "核心备份", Path.Combine(data, "reconcile.json.bak"), "reconcile.json 的自动回退副本。", "迁移备份", false, true),
            new Descriptor("compat", "v2-compat.json", "兼容状态", Path.Combine(data, "v2-compat.json"), "旧任务安全指纹与兼容状态。", "迁移备份", false, true),
            new Descriptor("compat-bak", "v2-compat.json.bak", "核心备份", Path.Combine(data, "v2-compat.json.bak"), "v2-compat.json 的回退副本。", "迁移备份", false, true),
            new Descriptor("secrets", "secrets.dat", "凭据", paths.SecretsPath, "Windows DPAPI CurrentUser 保护的 WebDAV 凭据。", "本机可恢复，跨 Windows 用户可能跳过", false, true),
            new Descriptor("backups", "Backups", "备份目录", GetBackupDirectory(paths), "默认保存手动备份与恢复前自动安全快照。", "自身不嵌套进入备份包", true, true),
            new Descriptor("bootstrap", "bootstrap.json", "固定入口", paths.BootstrapPath, "只保存唯一持久数据目录位置。固定留在 LocalAppData。", "不随迁移包恢复", false, false),
            new Descriptor("bootstrap-bak", "bootstrap.json.bak", "固定入口备份", paths.BootstrapPath + ".bak", "上一次 bootstrap 指针的自动回退副本。", "不随迁移包恢复", false, false),
            new Descriptor("experience", "product-experience.json", "体验记录", Path.Combine(local, "product-experience.json"), "About 健康、活动、初始化与观察连续性。", "迁移备份", false, false),
            new Descriptor("experience-bak", "product-experience.json.bak", "体验备份", Path.Combine(local, "product-experience.json.bak"), "体验记录的自动回退副本。", "迁移备份", false, false),
            new Descriptor("window", "window.json", "本机外观", Path.Combine(local, "window.json"), "窗口位置、尺寸与最大化状态。", "不迁移", false, false),
            new Descriptor("session", "runtime-session.json", "运行会话", Path.Combine(local, "runtime-session.json"), "当前进程会话 marker，用于识别异常中断。", "不迁移", false, false),
            new Descriptor("backup-status", "backup-status.json", "备份索引", Path.Combine(local, "backup-status.json"), "记录最近一次手动备份的时间与位置。", "不迁移", false, false),
            new Descriptor("startup-log", "startup-error.log", "本机日志", Path.Combine(local, "startup-error.log"), "启动失败时的脱敏本地诊断日志。", "不备份", false, false),
            new Descriptor("temp", "Temp", "临时目录", paths.TempRoot, "下载、探测和恢复 staging 临时文件。", "不备份", true, false),
            new Descriptor("webview", "WebView2", "运行缓存", Path.Combine(local, "WebView2"), "Microsoft WebView2 用户数据和缓存。", "不备份", true, false),
            new Descriptor("webui", "WebUi", "界面缓存", Path.Combine(local, "WebUi"), "当前版本嵌入式 Vue UI 的本地展开缓存。", "不备份", true, false)
        };
    }

    private static DataFileViewV050 ToView(Descriptor descriptor)
    {
        var exists = descriptor.IsDirectory ? Directory.Exists(descriptor.FullPath) : File.Exists(descriptor.FullPath);
        var status = !exists
            ? "未创建"
            : descriptor.IsDirectory
                ? "目录"
                : "存在 · " + FormatBytes(new FileInfo(descriptor.FullPath).Length);
        return new DataFileViewV050(
            descriptor.Key,
            descriptor.Label,
            descriptor.Category,
            descriptor.FullPath,
            descriptor.Purpose,
            descriptor.BackupPolicy,
            status,
            exists);
    }

    private static IEnumerable<(string Entry, string Path, bool MachineBound)> BackupSources(AppPaths paths)
    {
        foreach (var name in PersistentFileNames())
            yield return ("data/" + name, Path.Combine(paths.DataRoot, name), name.Equals("secrets.dat", StringComparison.OrdinalIgnoreCase));
        yield return ("local/product-experience.json", Path.Combine(paths.LocalRoot, "product-experience.json"), false);
        yield return ("local/product-experience.json.bak", Path.Combine(paths.LocalRoot, "product-experience.json.bak"), false);
    }

    private static string[] PersistentFileNames() =>
        new[]
        {
            "config.json", "config.json.bak",
            "state.json", "state.json.bak",
            "reconcile.json", "reconcile.json.bak",
            "v2-compat.json", "v2-compat.json.bak",
            "secrets.dat"
        };

    private static string? ResolveRestoreDestination(AppPaths paths, string entry)
    {
        if (entry.StartsWith("data/", StringComparison.OrdinalIgnoreCase))
        {
            var name = entry["data/".Length..];
            if (!PersistentFileNames().Contains(name, StringComparer.OrdinalIgnoreCase)) return null;
            return Path.Combine(paths.DataRoot, name);
        }
        if (entry.Equals("local/product-experience.json", StringComparison.OrdinalIgnoreCase))
            return Path.Combine(paths.LocalRoot, "product-experience.json");
        if (entry.Equals("local/product-experience.json.bak", StringComparison.OrdinalIgnoreCase))
            return Path.Combine(paths.LocalRoot, "product-experience.json.bak");
        return null;
    }

    private static BackupManifest ReadAndValidateManifest(string zipPath, bool verifyHashes)
    {
        if (!File.Exists(zipPath)) throw new FileNotFoundException("找不到 DavBridge 备份包。", zipPath);
        using var archive = ZipFile.OpenRead(zipPath);
        var manifestEntry = archive.GetEntry("manifest.json") ?? throw new InvalidDataException("不是有效的 DavBridge 备份包：缺少 manifest.json。");
        BackupManifest? manifest;
        using (var stream = manifestEntry.Open())
            manifest = JsonSerializer.Deserialize<BackupManifest>(stream, JsonOptions);
        if (manifest is null || !string.Equals(manifest.Product, "DavBridge", StringComparison.Ordinal) || manifest.FormatVersion != BackupFormatVersion)
            throw new InvalidDataException("DavBridge 备份格式不受支持。");

        var duplicate = manifest.Files.GroupBy(x => x.Entry, StringComparer.OrdinalIgnoreCase).FirstOrDefault(x => x.Count() > 1);
        if (duplicate is not null) throw new InvalidDataException("备份 manifest 包含重复条目：" + duplicate.Key);

        foreach (var item in manifest.Files)
        {
            if (ResolveEntryKind(item.Entry) is null)
                throw new InvalidDataException("备份包含未知或不允许恢复的条目：" + item.Entry);
            var entry = archive.GetEntry(item.Entry) ?? throw new InvalidDataException("备份缺少文件：" + item.Entry);
            if (entry.Length != item.Size)
                throw new InvalidDataException("备份文件大小不一致：" + item.Entry);
            if (!verifyHashes) continue;
            using var input = entry.Open();
            var hash = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
            if (!string.Equals(hash, item.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("备份 SHA-256 校验失败：" + item.Entry);
        }
        return manifest;
    }

    private static string? ResolveEntryKind(string entry)
    {
        if (entry.StartsWith("data/", StringComparison.OrdinalIgnoreCase))
        {
            var name = entry["data/".Length..];
            return PersistentFileNames().Contains(name, StringComparer.OrdinalIgnoreCase) ? "data" : null;
        }
        if (entry.Equals("local/product-experience.json", StringComparison.OrdinalIgnoreCase) ||
            entry.Equals("local/product-experience.json.bak", StringComparison.OrdinalIgnoreCase))
            return "local";
        return null;
    }

    private static bool CanDecryptSecrets(string path)
    {
        try
        {
            var protectedBytes = File.ReadAllBytes(path);
            var clear = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
            var secrets = JsonSerializer.Deserialize<WebDavSecrets>(clear);
            return secrets is not null;
        }
        catch
        {
            return false;
        }
    }

    private static void CopyAtomic(string source, string destination)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        var temp = destination + ".incoming-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, temp, true);
            using (var stream = new FileStream(temp, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                stream.Flush(true);
            File.Move(temp, destination, true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
        }
    }

    private static void CopyDirectoryVerified(string source, string destination)
    {
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(source, file);
            var target = Path.Combine(destination, relative);
            CopyAtomic(file, target);
            if (!string.Equals(HashFile(file), HashFile(target), StringComparison.OrdinalIgnoreCase))
                throw new IOException("备份目录迁移校验失败：" + relative);
        }
    }

    private static void ProbeWritable(string directory)
    {
        var probe = Path.Combine(directory, ".davbridge-write-probe-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.WriteAllText(probe, "DavBridge");
            using var stream = new FileStream(probe, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            stream.Flush(true);
        }
        finally
        {
            try { if (File.Exists(probe)) File.Delete(probe); } catch { }
        }
    }

    private static string NormalizeDirectory(string path) =>
        Path.GetFullPath(Environment.ExpandEnvironmentVariables(path.Trim())).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    private static bool IsNested(string parent, string child)
    {
        var p = parent.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var c = child.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return c.StartsWith(p, StringComparison.OrdinalIgnoreCase);
    }

    private static string HashFile(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1_000_000_000) return (bytes / 1_000_000_000d).ToString("0.0") + " GB";
        if (bytes >= 1_000_000) return (bytes / 1_000_000d).ToString("0.0") + " MB";
        if (bytes >= 1_000) return (bytes / 1_000d).ToString("0.0") + " KB";
        return bytes + " B";
    }

    private static string BackupStatusPath(AppPaths paths) => Path.Combine(paths.LocalRoot, "backup-status.json");

    private static BackupStatus? ReadBackupStatus(AppPaths paths)
    {
        try
        {
            var path = BackupStatusPath(paths);
            if (!File.Exists(path)) return null;
            return JsonSerializer.Deserialize<BackupStatus>(File.ReadAllText(path), JsonOptions);
        }
        catch
        {
            return null;
        }
    }

    private static void WriteBackupStatus(AppPaths paths, BackupStatus status)
    {
        Directory.CreateDirectory(paths.LocalRoot);
        var path = BackupStatusPath(paths);
        var temp = path + ".tmp";
        File.WriteAllText(temp, JsonSerializer.Serialize(status, JsonOptions));
        File.Move(temp, path, true);
    }
}

internal sealed class DataRootDialogV050 : Form
{
    private readonly TextBox _path = new();

    private DataRootDialogV050(string current)
    {
        Text = "DavBridge 数据目录";
        Icon = AppBranding.CreateIcon();
        Width = 650;
        Height = 210;
        MinimumSize = new Size(560, 210);
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 9.5F);
        BackColor = Color.FromArgb(248, 251, 254);

        var text = new Label
        {
            Text = "这是 DavBridge 唯一需要长期记住的持久数据根目录。可以直接输入路径，或浏览选择文件夹。",
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 46,
            Padding = new Padding(18, 14, 18, 0),
            ForeColor = Color.FromArgb(74, 93, 111)
        };

        _path.Text = current;
        _path.Dock = DockStyle.Fill;
        _path.BorderStyle = BorderStyle.FixedSingle;

        var browse = new Button { Text = "浏览…", Width = 78, Dock = DockStyle.Right };
        browse.Click += (_, _) =>
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = "选择 DavBridge 持久数据目录",
                UseDescriptionForTitle = true,
                ShowNewFolderButton = true
            };
            try { if (Directory.Exists(_path.Text)) dialog.SelectedPath = _path.Text; } catch { }
            if (dialog.ShowDialog(this) == DialogResult.OK)
                _path.Text = dialog.SelectedPath;
        };

        var field = new Panel { Dock = DockStyle.Top, Height = 34, Padding = new Padding(18, 0, 18, 0) };
        field.Controls.Add(_path);
        field.Controls.Add(browse);
        browse.BringToFront();

        var ok = new Button { Text = "迁移到此目录", Width = 112, Height = 30, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "取消", Width = 82, Height = 30, DialogResult = DialogResult.Cancel };
        var footer = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            Height = 55,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 10, 18, 0)
        };
        footer.Controls.Add(ok);
        footer.Controls.Add(cancel);

        Controls.Add(footer);
        Controls.Add(field);
        Controls.Add(text);
        AcceptButton = ok;
        CancelButton = cancel;
    }

    public static string? Show(IWin32Window owner, string current)
    {
        using var dialog = new DataRootDialogV050(current);
        if (dialog.ShowDialog(owner) != DialogResult.OK) return null;
        var value = dialog._path.Text.Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            MessageBox.Show(owner, "请输入有效的数据目录。", "DavBridge 数据目录", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return null;
        }
        try
        {
            return Path.GetFullPath(Environment.ExpandEnvironmentVariables(value));
        }
        catch (Exception ex)
        {
            MessageBox.Show(owner, "路径无效：" + ex.Message, "DavBridge 数据目录", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return null;
        }
    }
}
