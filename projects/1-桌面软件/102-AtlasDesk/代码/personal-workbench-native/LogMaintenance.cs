namespace PersonalWorkbench;

public static class LogMaintenance
{
    public const long DefaultMaxBytes = 4L * 1024 * 1024;
    public const int DefaultArchiveCount = 2;

    public static bool Prepare(
        string path,
        long maxBytes = DefaultMaxBytes,
        int archiveCount = DefaultArchiveCount)
    {
        try
        {
            return RotateIfNeeded(path, maxBytes, archiveCount);
        }
        catch
        {
            // Logging maintenance must never block application startup.
            return false;
        }
    }

    public static bool RotateIfNeeded(string path, long maxBytes, int archiveCount = DefaultArchiveCount)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        if (maxBytes < 1024) throw new ArgumentOutOfRangeException(nameof(maxBytes));
        archiveCount = Math.Clamp(archiveCount, 1, 10);

        if (!File.Exists(path) || new FileInfo(path).Length <= maxBytes)
            return false;

        var directory = Path.GetDirectoryName(Path.GetFullPath(path))
                        ?? throw new InvalidOperationException("日志路径没有有效目录。");
        Directory.CreateDirectory(directory);

        var oldest = ArchivePath(path, archiveCount);
        if (File.Exists(oldest)) File.Delete(oldest);
        for (var index = archiveCount - 1; index >= 1; index--)
        {
            var source = ArchivePath(path, index);
            if (!File.Exists(source)) continue;
            File.Move(source, ArchivePath(path, index + 1), overwrite: true);
        }

        File.Move(path, ArchivePath(path, 1), overwrite: true);
        return true;
    }

    public static string ArchivePath(string path, int index)
        => path + "." + Math.Max(1, index).ToString(System.Globalization.CultureInfo.InvariantCulture);
}
