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
        var full = Path.GetFullPath(library)
            .TrimEnd(
                Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar);

        var root = Path.GetPathRoot(full);

        if (string.IsNullOrWhiteSpace(root))
        {
            throw new InvalidOperationException(
                $"Cannot resolve storage root for: {full}");
        }

        root = EnsureRootSeparator(root);

        string storageId;

        if (OperatingSystem.IsWindows()
            && !root.StartsWith(
                @"\\",
                StringComparison.Ordinal))
        {
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
        else if (root.StartsWith(
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
