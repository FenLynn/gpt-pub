using System.Text;

namespace PersonalWorkbench;

public static class AtomicFileStore
{
    public static void WriteAllText(string path, string content, string? backupPath = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        content ??= string.Empty;

        var fullPath = Path.GetFullPath(path);
        var directory = Path.GetDirectoryName(fullPath)
                        ?? throw new InvalidOperationException("目标文件没有有效目录。");
        Directory.CreateDirectory(directory);

        var tempPath = Path.Combine(
            directory,
            "." + Path.GetFileName(fullPath) + "." + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(
                       tempPath,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       16 * 1024,
                       FileOptions.WriteThrough))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false)))
            {
                writer.Write(content);
                writer.Flush();
                stream.Flush(flushToDisk: true);
            }

            if (File.Exists(fullPath))
            {
                if (!string.IsNullOrWhiteSpace(backupPath))
                {
                    var fullBackupPath = Path.GetFullPath(backupPath);
                    Directory.CreateDirectory(Path.GetDirectoryName(fullBackupPath) ?? directory);
                    try
                    {
                        File.Replace(tempPath, fullPath, fullBackupPath, ignoreMetadataErrors: true);
                        return;
                    }
                    catch (PlatformNotSupportedException) { }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }

                    File.Copy(fullPath, fullBackupPath, overwrite: true);
                }

                File.Move(tempPath, fullPath, overwrite: true);
            }
            else
            {
                File.Move(tempPath, fullPath);
            }
        }
        finally
        {
            try
            {
                if (File.Exists(tempPath)) File.Delete(tempPath);
            }
            catch { }
        }
    }

    public static string? Quarantine(string path, string reason)
    {
        try
        {
            if (!File.Exists(path)) return null;
            var directory = Path.GetDirectoryName(path) ?? string.Empty;
            var stem = Path.GetFileNameWithoutExtension(path);
            var extension = Path.GetExtension(path);
            var safeReason = new string((reason ?? "invalid")
                .Where(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_')
                .Take(32)
                .ToArray());
            if (string.IsNullOrWhiteSpace(safeReason)) safeReason = "invalid";
            var target = Path.Combine(
                directory,
                $"{stem}.{safeReason}.{DateTime.UtcNow:yyyyMMddHHmmssfff}{extension}");
            File.Move(path, target, overwrite: false);
            return target;
        }
        catch (Exception ex)
        {
            App.Log("Quarantine failed for " + path + ": " + ex.Message);
            return null;
        }
    }
}
