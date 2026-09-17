using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace MediaIndex.App;

internal sealed record StorageBinding(
    string LibraryPath,
    string StorageRoot,
    string StorageId,
    string LibraryRelativePath,
    string IndexId);

internal static class StorageIdentity
{
    private const int BufferLength = 1024;

    public static StorageBinding Resolve(string library)
    {
        var full = Path.TrimEndingDirectorySeparator(
            Path.GetFullPath(library));

        var pathRoot = Path.GetPathRoot(full);

        if (string.IsNullOrWhiteSpace(pathRoot))
        {
            throw new InvalidOperationException(
                $"Cannot resolve storage root for: {full}");
        }

        string root;
        string storageId;

        if (OperatingSystem.IsWindows()
            && !full.StartsWith(
                @"\\",
                StringComparison.Ordinal))
        {
            var volumePath = new StringBuilder(BufferLength);

            if (!GetVolumePathName(
                    full,
                    volumePath,
                    (uint)volumePath.Capacity)
                || volumePath.Length == 0)
            {
                throw new InvalidOperationException(
                    "Cannot resolve Windows volume mount point "
                    + $"for: {full}");
            }

            root = EnsureRootSeparator(
                volumePath.ToString());

            var volumeName = new StringBuilder(BufferLength);

            if (GetVolumeNameForVolumeMountPoint(
                    root,
                    volumeName,
                    (uint)volumeName.Capacity)
                && volumeName.Length > 0)
            {
                storageId =
                    "win-volume:"
                    + volumeName
                        .ToString()
                        .TrimEnd('\\')
                        .ToUpperInvariant();
            }
            else
            {
                var fileSystem = new StringBuilder(BufferLength);

                if (!GetVolumeInformation(
                        root,
                        null,
                        0,
                        out var serial,
                        out _,
                        out _,
                        fileSystem,
                        (uint)fileSystem.Capacity))
                {
                    throw new InvalidOperationException(
                        "Cannot resolve stable Windows volume "
                        + $"identity for: {root}");
                }

                storageId =
                    $"win-serial:{serial:X8}:"
                    + fileSystem
                        .ToString()
                        .ToUpperInvariant();
            }
        }
        else
        {
            root = EnsureRootSeparator(pathRoot);

            if (root.StartsWith(
                    @"\\",
                    StringComparison.Ordinal))
            {
                storageId =
                    "unc:"
                    + root
                        .TrimEnd('\\', '/')
                        .ToUpperInvariant();
            }
            else
            {
                storageId =
                    "root:"
                    + root
                        .TrimEnd(
                            Path.DirectorySeparatorChar,
                            Path.AltDirectorySeparatorChar)
                        .ToUpperInvariant();
            }
        }

        var relative = NormalizeRelative(
            Path.GetRelativePath(root, full));

        var indexId = ComputeIndexId(
            storageId,
            relative);

        return new StorageBinding(
            full,
            root,
            storageId,
            relative,
            indexId);
    }

    public static string ComputeIndexId(
        string storageId,
        string libraryRelativePath)
    {
        var key =
            storageId
                .Trim()
                .ToUpperInvariant()
            + "\n"
            + NormalizeRelative(
                    libraryRelativePath)
                .ToUpperInvariant();

        var bytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(key));

        return Convert
            .ToHexString(bytes)
            .ToLowerInvariant()[..16];
    }

    private static string NormalizeRelative(string value)
    {
        var normalized = value
            .Replace('\\', '/')
            .Trim('/');

        return string.IsNullOrWhiteSpace(normalized)
               || normalized == "."
            ? "."
            : normalized;
    }

    private static string EnsureRootSeparator(string root)
    {
        if (root.EndsWith(Path.DirectorySeparatorChar)
            || root.EndsWith(Path.AltDirectorySeparatorChar))
        {
            return root;
        }

        return root + Path.DirectorySeparatorChar;
    }

    [DllImport(
        "kernel32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumePathName(
        string lpszFileName,
        StringBuilder lpszVolumePathName,
        uint cchBufferLength);

    [DllImport(
        "kernel32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumeNameForVolumeMountPoint(
        string lpszVolumeMountPoint,
        StringBuilder lpszVolumeName,
        uint cchBufferLength);

    [DllImport(
        "kernel32.dll",
        CharSet = CharSet.Unicode,
        SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetVolumeInformation(
        string lpRootPathName,
        StringBuilder? lpVolumeNameBuffer,
        uint nVolumeNameSize,
        out uint lpVolumeSerialNumber,
        out uint lpMaximumComponentLength,
        out uint lpFileSystemFlags,
        StringBuilder? lpFileSystemNameBuffer,
        uint nFileSystemNameSize);
}
