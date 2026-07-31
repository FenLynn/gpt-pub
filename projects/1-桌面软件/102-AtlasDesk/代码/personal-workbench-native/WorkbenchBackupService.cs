using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PersonalWorkbench;

public sealed class WorkbenchBackupEntry
{
    public string Name { get; set; } = string.Empty;
    public long Size { get; set; }
    public string Sha256 { get; set; } = string.Empty;
}

public sealed class WorkbenchBackupManifest
{
    public string Format { get; set; } = WorkbenchBackupService.FormatName;
    public string SourceVersion { get; set; } = string.Empty;
    public DateTimeOffset CreatedUtc { get; set; }
    public List<WorkbenchBackupEntry> Entries { get; set; } = new();
}

public sealed class BackupValidationResult
{
    public bool IsValid { get; init; }
    public string BackupPath { get; init; } = string.Empty;
    public WorkbenchBackupManifest? Manifest { get; init; }
    public IReadOnlyList<string> Errors { get; init; } = Array.Empty<string>();
    public IReadOnlyList<string> Files { get; init; } = Array.Empty<string>();

    public string Summary
    {
        get
        {
            if (!IsValid) return "备份无效" + Environment.NewLine + string.Join(Environment.NewLine, Errors.Select(error => "- " + error));
            return string.Join(Environment.NewLine, new[]
            {
                "备份有效",
                "来源版本：" + (Manifest?.SourceVersion ?? "未知"),
                "创建时间：" + (Manifest?.CreatedUtc.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") ?? "未知"),
                "文件：" + (Files.Count == 0 ? "无可迁移配置" : string.Join("、", Files))
            });
        }
    }
}

public sealed class BackupRestoreResult
{
    public string BackupPath { get; init; } = string.Empty;
    public string PreRestoreSnapshotPath { get; init; } = string.Empty;
    public IReadOnlyList<string> RestoredFiles { get; init; } = Array.Empty<string>();
}

public static class WorkbenchBackupService
{
    public const string FormatName = "PersonalWorkbench-Backup-v1";
    public const long MaxArchiveBytes = 32L * 1024 * 1024;
    public const long MaxSingleFileBytes = 16L * 1024 * 1024;
    public const long MaxTotalUncompressedBytes = 24L * 1024 * 1024;

    private static readonly string[] AllowedFiles = { "settings.json", "task-history.json" };
    private static readonly HashSet<string> AllowedSet = new(AllowedFiles, StringComparer.OrdinalIgnoreCase);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public static IReadOnlyList<string> SafeFileNames => AllowedFiles;

    public static async Task ExportAsync(
        string sourceDirectory,
        string destination,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(sourceDirectory)) throw new ArgumentException("来源目录为空。", nameof(sourceDirectory));
        if (string.IsNullOrWhiteSpace(destination)) throw new ArgumentException("备份路径为空。", nameof(destination));
        sourceDirectory = Path.GetFullPath(sourceDirectory);
        destination = Path.GetFullPath(destination);
        Directory.CreateDirectory(sourceDirectory);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? Environment.CurrentDirectory);

        var payloads = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        foreach (var name in AllowedFiles)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var path = Path.Combine(sourceDirectory, name);
            if (!File.Exists(path)) continue;
            var info = new FileInfo(path);
            if (info.Length > MaxSingleFileBytes) throw new InvalidDataException($"{name} 超过 16 MB 安全上限。");
            var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
            total = checked(total + bytes.LongLength);
            if (total > MaxTotalUncompressedBytes) throw new InvalidDataException("待备份配置总量超过安全上限。");
            ValidateJson(name, bytes);
            payloads[name] = bytes;
        }

        var manifest = new WorkbenchBackupManifest
        {
            Format = FormatName,
            SourceVersion = WorkbenchVersion.Current,
            CreatedUtc = DateTimeOffset.UtcNow,
            Entries = payloads.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
                .Select(pair => new WorkbenchBackupEntry
                {
                    Name = pair.Key,
                    Size = pair.Value.LongLength,
                    Sha256 = ComputeSha256(pair.Value)
                }).ToList()
        };

        var temp = destination + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.None, 81920, FileOptions.Asynchronous))
            using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: false))
            {
                foreach (var pair in payloads)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var entry = archive.CreateEntry("data/" + pair.Key, CompressionLevel.Optimal);
                    await using var target = entry.Open();
                    await target.WriteAsync(pair.Value, cancellationToken);
                }
                var manifestEntry = archive.CreateEntry("manifest.json", CompressionLevel.Optimal);
                await using var manifestStream = manifestEntry.Open();
                var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions);
                await manifestStream.WriteAsync(manifestBytes, cancellationToken);
            }
            File.Move(temp, destination, true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
        }
    }

    public static async Task<BackupValidationResult> ValidateAsync(
        string backupPath,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var package = await ReadValidatedPackageAsync(backupPath, cancellationToken);
            return new BackupValidationResult
            {
                IsValid = true,
                BackupPath = Path.GetFullPath(backupPath),
                Manifest = package.Manifest,
                Files = package.Payloads.Keys.OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToArray()
            };
        }
        catch (Exception ex)
        {
            return new BackupValidationResult
            {
                IsValid = false,
                BackupPath = backupPath,
                Errors = new[] { ex.Message }
            };
        }
    }

    public static async Task<BackupRestoreResult> RestoreAsync(
        string backupPath,
        string targetDirectory,
        bool createPreRestoreSnapshot = true,
        CancellationToken cancellationToken = default)
    {
        targetDirectory = Path.GetFullPath(targetDirectory);
        Directory.CreateDirectory(targetDirectory);
        var package = await ReadValidatedPackageAsync(backupPath, cancellationToken);

        var snapshot = string.Empty;
        if (createPreRestoreSnapshot)
        {
            var snapshotsDirectory = Path.Combine(targetDirectory, "backups");
            Directory.CreateDirectory(snapshotsDirectory);
            snapshot = Path.Combine(snapshotsDirectory, $"pre-restore-{DateTime.Now:yyyyMMdd-HHmmss-fff}.pwbak");
            await ExportAsync(targetDirectory, snapshot, cancellationToken);
        }

        var originals = new Dictionary<string, byte[]?>(StringComparer.OrdinalIgnoreCase);
        var written = new List<string>();
        try
        {
            foreach (var pair in package.Payloads.OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var target = Path.Combine(targetDirectory, pair.Key);
                originals[pair.Key] = File.Exists(target) ? await File.ReadAllBytesAsync(target, cancellationToken) : null;
                await WriteAtomicAsync(target, pair.Value, cancellationToken);
                written.Add(pair.Key);
            }
        }
        catch
        {
            foreach (var name in written.AsEnumerable().Reverse())
            {
                try
                {
                    var target = Path.Combine(targetDirectory, name);
                    if (originals[name] is { } bytes) await WriteAtomicAsync(target, bytes, CancellationToken.None);
                    else if (File.Exists(target)) File.Delete(target);
                }
                catch (Exception rollbackEx) { App.Log("Backup rollback failed: " + rollbackEx); }
            }
            throw;
        }

        return new BackupRestoreResult
        {
            BackupPath = Path.GetFullPath(backupPath),
            PreRestoreSnapshotPath = snapshot,
            RestoredFiles = written
        };
    }

    private static async Task<ValidatedPackage> ReadValidatedPackageAsync(
        string backupPath,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(backupPath)) throw new FileNotFoundException("备份文件不存在。", backupPath);
        var archiveInfo = new FileInfo(backupPath);
        if (archiveInfo.Length > MaxArchiveBytes) throw new InvalidDataException("备份包超过 32 MB 安全上限。");

        await using var stream = new FileStream(backupPath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: false);
        if (archive.Entries.Count > AllowedFiles.Length + 1) throw new InvalidDataException("备份包包含过多条目。");

        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        foreach (var entry in archive.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var name = NormalizeArchiveName(entry.FullName);
            if (!entries.TryAdd(name, entry)) throw new InvalidDataException("备份包包含重复条目：" + name);
            if (entry.Length < 0 || entry.Length > MaxSingleFileBytes) throw new InvalidDataException("备份条目超过安全上限：" + name);
            total = checked(total + entry.Length);
            if (total > MaxTotalUncompressedBytes) throw new InvalidDataException("备份包解压后超过安全上限。");
            if (!name.Equals("manifest.json", StringComparison.OrdinalIgnoreCase)
                && !(name.StartsWith("data/", StringComparison.OrdinalIgnoreCase) && AllowedSet.Contains(name[5..])))
                throw new InvalidDataException("备份包包含未授权条目：" + name);
        }

        if (!entries.TryGetValue("manifest.json", out var manifestEntry)) throw new InvalidDataException("备份包缺少 manifest.json。");
        var manifestBytes = await ReadEntryAsync(manifestEntry, cancellationToken);
        var manifest = JsonSerializer.Deserialize<WorkbenchBackupManifest>(manifestBytes, JsonOptions)
                       ?? throw new InvalidDataException("备份清单无法解析。");
        if (!string.Equals(manifest.Format, FormatName, StringComparison.Ordinal)) throw new InvalidDataException("不支持的备份格式。");
        manifest.Entries ??= new List<WorkbenchBackupEntry>();
        if (manifest.Entries.Count > AllowedFiles.Length) throw new InvalidDataException("备份清单文件数超过白名单。");

        var manifestNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var payloads = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in manifest.Entries)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!AllowedSet.Contains(item.Name)) throw new InvalidDataException("备份清单包含未授权文件：" + item.Name);
            if (!manifestNames.Add(item.Name)) throw new InvalidDataException("备份清单包含重复文件：" + item.Name);
            if (!entries.TryGetValue("data/" + item.Name, out var dataEntry)) throw new InvalidDataException("备份包缺少文件：" + item.Name);
            var bytes = await ReadEntryAsync(dataEntry, cancellationToken);
            if (bytes.LongLength != item.Size) throw new InvalidDataException("文件大小校验失败：" + item.Name);
            if (!string.Equals(ComputeSha256(bytes), item.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("SHA-256 校验失败：" + item.Name);
            ValidateJson(item.Name, bytes);
            payloads[item.Name] = bytes;
        }

        var declaredArchiveNames = new HashSet<string>(manifestNames.Select(name => "data/" + name), StringComparer.OrdinalIgnoreCase)
        {
            "manifest.json"
        };
        if (entries.Keys.Any(name => !declaredArchiveNames.Contains(name))) throw new InvalidDataException("备份包含有清单未声明的数据。");
        return new ValidatedPackage(manifest, payloads);
    }

    private static string NormalizeArchiveName(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidDataException("备份包包含空条目名。");
        if (value.Contains('\\')) throw new InvalidDataException("备份条目必须使用标准正斜杠。");
        if (value.StartsWith('/') || Path.IsPathRooted(value)) throw new InvalidDataException("备份包包含绝对路径。");
        var segments = value.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || segments.Any(segment => segment is "." or "..")) throw new InvalidDataException("备份包包含路径穿越条目。");
        return string.Join('/', segments);
    }

    private static async Task<byte[]> ReadEntryAsync(ZipArchiveEntry entry, CancellationToken cancellationToken)
    {
        if (entry.Length > MaxSingleFileBytes) throw new InvalidDataException("备份条目超过安全上限：" + entry.FullName);
        await using var source = entry.Open();
        using var target = new MemoryStream((int)Math.Min(entry.Length, int.MaxValue));
        var buffer = new byte[81920];
        long total = 0;
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken);
            if (count <= 0) break;
            total += count;
            if (total > MaxSingleFileBytes) throw new InvalidDataException("备份条目解压后超过安全上限：" + entry.FullName);
            await target.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
        }
        return target.ToArray();
    }

    private static async Task WriteAtomicAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? Environment.CurrentDirectory);
        var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await File.WriteAllBytesAsync(temp, bytes, cancellationToken);
            File.Move(temp, path, true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
        }
    }

    private static void ValidateJson(string name, byte[] bytes)
    {
        try { using var _ = JsonDocument.Parse(bytes); }
        catch (JsonException ex) { throw new InvalidDataException(name + " 不是有效 JSON：" + ex.Message, ex); }
    }

    private static string ComputeSha256(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));

    private sealed record ValidatedPackage(
        WorkbenchBackupManifest Manifest,
        Dictionary<string, byte[]> Payloads);
}
