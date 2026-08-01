using System.Text;

namespace PersonalWorkbench;

public sealed class IntegrityManifestEntry
{
    public string RelativePath { get; init; } = string.Empty;
    public long Size { get; init; }
    public string Sha256 { get; init; } = string.Empty;
}

public enum IntegrityVerificationStatus { Match, Missing, Changed, UnsafePath, Error }

public sealed class IntegrityVerificationItem
{
    public IntegrityManifestEntry Entry { get; init; } = new();
    public string FullPath { get; init; } = string.Empty;
    public IntegrityVerificationStatus Status { get; init; }
    public string ActualSha256 { get; init; } = string.Empty;
    public string Message { get; init; } = string.Empty;

    public string StatusLabel => Status switch
    {
        IntegrityVerificationStatus.Match => "匹配",
        IntegrityVerificationStatus.Missing => "缺失",
        IntegrityVerificationStatus.Changed => "已改变",
        IntegrityVerificationStatus.UnsafePath => "不安全路径",
        _ => "错误"
    };
    public string StatusBackground => Status switch
    {
        IntegrityVerificationStatus.Match => "#E7F7F0",
        IntegrityVerificationStatus.Missing => "#FFF4DF",
        IntegrityVerificationStatus.Changed or IntegrityVerificationStatus.UnsafePath => "#FDEAEA",
        _ => "#EEF2F7"
    };
    public string StatusForeground => Status switch
    {
        IntegrityVerificationStatus.Match => "#187A58",
        IntegrityVerificationStatus.Missing => "#A86812",
        IntegrityVerificationStatus.Changed or IntegrityVerificationStatus.UnsafePath => "#B13D48",
        _ => "#64748B"
    };
}

public sealed class FileComparisonResult
{
    public string FirstPath { get; init; } = string.Empty;
    public string SecondPath { get; init; } = string.Empty;
    public long FirstSize { get; init; }
    public long SecondSize { get; init; }
    public string FirstSha256 { get; init; } = string.Empty;
    public string SecondSha256 { get; init; } = string.Empty;
    public bool IsIdentical => FirstSize == SecondSize && string.Equals(FirstSha256, SecondSha256, StringComparison.OrdinalIgnoreCase);

    public string Summary => string.Join(Environment.NewLine, new[]
    {
        IsIdentical ? "结论：两个文件完全一致" : "结论：两个文件不同",
        string.Empty,
        Path.GetFileName(FirstPath) + $" · {DirectoryStatisticsResult.FormatBytes(FirstSize)}",
        FirstSha256,
        string.Empty,
        Path.GetFileName(SecondPath) + $" · {DirectoryStatisticsResult.FormatBytes(SecondSize)}",
        SecondSha256
    });
}

public static class FileIntegrityService
{
    public const string Header = "# AtlasDesk SHA256 v1";
    public const int MaxManifestEntries = 500_000;
    public const int MaxManifestLineLength = 32_768;
    public const long MaxManifestBytes = 64L * 1024 * 1024;

    private static readonly HashSet<string> IgnoredDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".idea", ".vs", "node_modules", "bin", "obj", "dist", "build",
        "__pycache__", ".venv", "venv", "env", "target", ".pytest_cache", ".mypy_cache"
    };

    public static async Task<IReadOnlyList<IntegrityManifestEntry>> CreateManifestAsync(
        string root,
        string? excludedOutputPath = null,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException("工作区不存在：" + root);
        root = Path.GetFullPath(root);
        var excluded = string.IsNullOrWhiteSpace(excludedOutputPath) ? string.Empty : Path.GetFullPath(excludedOutputPath);
        var files = await Task.Run(() => EnumerateFiles(root, excluded, cancellationToken), cancellationToken);
        var entries = new List<IntegrityManifestEntry>(files.Count);

        for (var index = 0; index < files.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var file = files[index];
            var itemIndex = index;
            var itemProgress = new Progress<double>(value =>
            {
                var overall = files.Count == 0 ? 100 : ((itemIndex + Math.Clamp(value, 0, 100) / 100d) / files.Count) * 100d;
                progress?.Report(overall);
            });
            var hash = await WorkbenchTaskOperations.ComputeSha256Async(file, itemProgress, cancellationToken);
            entries.Add(new IntegrityManifestEntry
            {
                RelativePath = NormalizeManifestPath(Path.GetRelativePath(root, file)),
                Size = new FileInfo(file).Length,
                Sha256 = hash
            });
        }
        progress?.Report(100);
        return entries.OrderBy(item => item.RelativePath, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public static async Task WriteManifestAtomicAsync(string path, IEnumerable<IntegrityManifestEntry> entries)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? Environment.CurrentDirectory);
        var temp = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            await File.WriteAllTextAsync(temp, FormatManifest(entries), new UTF8Encoding(false));
            File.Move(temp, path, true);
        }
        finally
        {
            try { if (File.Exists(temp)) File.Delete(temp); } catch { }
        }
    }

    public static string FormatManifest(IEnumerable<IntegrityManifestEntry> entries)
    {
        var materialized = entries.Take(MaxManifestEntries + 1).ToArray();
        if (materialized.Length > MaxManifestEntries) throw new InvalidDataException("清单记录数超过安全上限。");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var builder = new StringBuilder();
        builder.AppendLine(Header);
        builder.AppendLine("# Generated: " + DateTimeOffset.UtcNow.ToString("O"));
        foreach (var entry in materialized.OrderBy(item => item.RelativePath, StringComparer.OrdinalIgnoreCase))
        {
            ValidateHash(entry.Sha256);
            var path = NormalizeManifestPath(entry.RelativePath);
            ValidateManifestPathText(path);
            if (!seen.Add(path)) throw new InvalidDataException("清单包含重复路径：" + path);
            var line = entry.Sha256.ToUpperInvariant() + " *" + path;
            if (line.Length > MaxManifestLineLength) throw new InvalidDataException("清单记录过长：" + path);
            builder.AppendLine(line);
        }
        return builder.ToString();
    }

    public static IReadOnlyList<IntegrityManifestEntry> ParseManifest(string content)
    {
        if (content is null) throw new InvalidDataException("清单内容为空。");
        if (Encoding.UTF8.GetByteCount(content) > MaxManifestBytes) throw new InvalidDataException("清单文件超过 64 MB 安全上限。");
        var entries = new List<IntegrityManifestEntry>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var reader = new StringReader(content);
        string? line;
        var lineNumber = 0;
        while ((line = reader.ReadLine()) is not null)
        {
            lineNumber++;
            if (line.Length > MaxManifestLineLength) throw new InvalidDataException($"清单第 {lineNumber} 行过长。");
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#')) continue;
            if (line.Length < 67 || line[64] != ' ' || line[65] != '*')
                throw new InvalidDataException($"清单第 {lineNumber} 行格式无效。");
            var hash = line[..64];
            ValidateHash(hash);
            var relativePath = NormalizeManifestPath(line[66..]);
            ValidateManifestPathText(relativePath);
            if (!seen.Add(relativePath)) throw new InvalidDataException("清单包含重复路径：" + relativePath);
            entries.Add(new IntegrityManifestEntry { RelativePath = relativePath, Sha256 = hash.ToUpperInvariant() });
            if (entries.Count > MaxManifestEntries) throw new InvalidDataException("清单记录数超过安全上限。");
        }
        if (entries.Count == 0) throw new InvalidDataException("清单中没有可验证的文件记录。");
        return entries;
    }

    public static async Task<IReadOnlyList<IntegrityVerificationItem>> VerifyManifestAsync(
        string manifestPath,
        string root,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(manifestPath)) throw new FileNotFoundException("清单文件不存在。", manifestPath);
        if (!Directory.Exists(root)) throw new DirectoryNotFoundException("验证根目录不存在：" + root);
        var manifestInfo = new FileInfo(manifestPath);
        if (manifestInfo.Length > MaxManifestBytes) throw new InvalidDataException("清单文件超过 64 MB 安全上限。");
        root = Path.GetFullPath(root);
        var entries = ParseManifest(await File.ReadAllTextAsync(manifestPath, cancellationToken));
        var results = new List<IntegrityVerificationItem>(entries.Count);

        for (var index = 0; index < entries.Count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var entry = entries[index];
            if (!TryResolveSafePath(root, entry.RelativePath, out var fullPath))
            {
                results.Add(new IntegrityVerificationItem
                {
                    Entry = entry, Status = IntegrityVerificationStatus.UnsafePath,
                    Message = "清单路径尝试离开验证根目录。"
                });
                progress?.Report((index + 1d) / entries.Count * 100d);
                continue;
            }
            if (!File.Exists(fullPath))
            {
                results.Add(new IntegrityVerificationItem
                {
                    Entry = entry, FullPath = fullPath, Status = IntegrityVerificationStatus.Missing,
                    Message = "文件不存在。"
                });
                progress?.Report((index + 1d) / entries.Count * 100d);
                continue;
            }
            try
            {
                var itemIndex = index;
                var itemProgress = new Progress<double>(value =>
                {
                    var overall = ((itemIndex + Math.Clamp(value, 0, 100) / 100d) / entries.Count) * 100d;
                    progress?.Report(overall);
                });
                var actual = await WorkbenchTaskOperations.ComputeSha256Async(fullPath, itemProgress, cancellationToken);
                var match = string.Equals(actual, entry.Sha256, StringComparison.OrdinalIgnoreCase);
                results.Add(new IntegrityVerificationItem
                {
                    Entry = entry, FullPath = fullPath, ActualSha256 = actual,
                    Status = match ? IntegrityVerificationStatus.Match : IntegrityVerificationStatus.Changed,
                    Message = match ? "SHA-256 一致。" : "实际 SHA-256 与清单不一致。"
                });
            }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                results.Add(new IntegrityVerificationItem
                {
                    Entry = entry, FullPath = fullPath, Status = IntegrityVerificationStatus.Error,
                    Message = ex.Message
                });
            }
        }
        progress?.Report(100);
        return results;
    }

    public static async Task<FileComparisonResult> CompareFilesAsync(
        string firstPath,
        string secondPath,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!File.Exists(firstPath)) throw new FileNotFoundException("第一个文件不存在。", firstPath);
        if (!File.Exists(secondPath)) throw new FileNotFoundException("第二个文件不存在。", secondPath);
        var firstProgress = new Progress<double>(value => progress?.Report(Math.Clamp(value, 0, 100) / 2d));
        var firstHash = await WorkbenchTaskOperations.ComputeSha256Async(firstPath, firstProgress, cancellationToken);
        var secondProgress = new Progress<double>(value => progress?.Report(50d + Math.Clamp(value, 0, 100) / 2d));
        var secondHash = await WorkbenchTaskOperations.ComputeSha256Async(secondPath, secondProgress, cancellationToken);
        progress?.Report(100);
        return new FileComparisonResult
        {
            FirstPath = Path.GetFullPath(firstPath), SecondPath = Path.GetFullPath(secondPath),
            FirstSize = new FileInfo(firstPath).Length, SecondSize = new FileInfo(secondPath).Length,
            FirstSha256 = firstHash, SecondSha256 = secondHash
        };
    }

    public static bool TryResolveSafePath(string root, string manifestPath, out string fullPath)
    {
        fullPath = string.Empty;
        try
        {
            if (string.IsNullOrEmpty(manifestPath)) return false;
            ValidateManifestPathText(manifestPath);
            var normalized = manifestPath.Replace('/', Path.DirectorySeparatorChar);
            if (Path.IsPathRooted(normalized)) return false;
            var segments = normalized.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0 || segments.Any(segment => segment is "." or "..")) return false;
            var rootFull = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var candidate = Path.GetFullPath(Path.Combine(rootFull, normalized));
            var prefix = rootFull + Path.DirectorySeparatorChar;
            if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return false;
            fullPath = candidate;
            return true;
        }
        catch { return false; }
    }

    private static List<string> EnumerateFiles(string root, string excludedPath, CancellationToken cancellationToken)
    {
        var files = new List<string>();
        var queue = new Queue<string>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        queue.Enqueue(root);
        while (queue.Count > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = queue.Dequeue();
            string normalized;
            try { normalized = Path.GetFullPath(directory); }
            catch { continue; }
            if (!visited.Add(normalized)) continue;
            IEnumerable<string> entries;
            try { entries = Directory.EnumerateFileSystemEntries(normalized); }
            catch { continue; }
            foreach (var entry in entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var attributes = File.GetAttributes(entry);
                    if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
                    if ((attributes & FileAttributes.Directory) != 0)
                    {
                        var name = Path.GetFileName(entry);
                        if (IgnoredDirectories.Contains(name) || name.StartsWith(".", StringComparison.Ordinal)) continue;
                        queue.Enqueue(entry);
                    }
                    else
                    {
                        var full = Path.GetFullPath(entry);
                        if (!string.IsNullOrWhiteSpace(excludedPath) && string.Equals(full, excludedPath, StringComparison.OrdinalIgnoreCase)) continue;
                        files.Add(full);
                        if (files.Count > MaxManifestEntries) throw new InvalidDataException("工作区文件数超过清单安全上限。");
                    }
                }
                catch (InvalidDataException) { throw; }
                catch { }
            }
        }
        return files.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static string NormalizeManifestPath(string path)
    {
        var value = (path ?? string.Empty).Replace('\\', '/');
        if (string.IsNullOrEmpty(value)) throw new InvalidDataException("清单路径为空。");
        return value;
    }

    private static void ValidateManifestPathText(string path)
    {
        if (path.Length > MaxManifestLineLength - 67) throw new InvalidDataException("清单路径过长。");
        if (path.Any(character => character == '\0' || character == '\r' || character == '\n' || (char.IsControl(character) && character != '\t')))
            throw new InvalidDataException("清单路径包含控制字符。");
    }

    private static void ValidateHash(string value)
    {
        if (value.Length != 64 || value.Any(character => !Uri.IsHexDigit(character)))
            throw new InvalidDataException("清单包含无效的 SHA-256：" + value);
    }
}
