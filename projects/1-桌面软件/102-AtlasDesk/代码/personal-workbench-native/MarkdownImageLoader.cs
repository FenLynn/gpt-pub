using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace PersonalWorkbench;

internal static class MarkdownImageLoader
{
    public static ImageSource? Load(string rawTarget, string? documentPath)
    {
        try
        {
            var target = (rawTarget ?? string.Empty).Trim().Trim('<', '>');
            if (target.Length == 0) return null;

            if (Uri.TryCreate(target, UriKind.Absolute, out var absolute)
                && absolute.Scheme is "http" or "https")
            {
                var remote = new BitmapImage();
                remote.BeginInit();
                remote.UriSource = absolute;
                remote.CacheOption = BitmapCacheOption.OnLoad;
                remote.CreateOptions = BitmapCreateOptions.IgnoreImageCache;
                remote.EndInit();
                if (remote.CanFreeze) remote.Freeze();
                return remote;
            }

            string path;
            if (Uri.TryCreate(target, UriKind.Absolute, out absolute) && absolute.IsFile)
            {
                path = absolute.LocalPath;
            }
            else
            {
                var decoded = Uri.UnescapeDataString(target.Replace('/', Path.DirectorySeparatorChar));
                path = Path.IsPathRooted(decoded)
                    ? decoded
                    : Path.Combine(Path.GetDirectoryName(documentPath) ?? Environment.CurrentDirectory, decoded);
                path = Path.GetFullPath(path);
            }
            if (!File.Exists(path)) return null;

            using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);
            var decoder = BitmapDecoder.Create(
                stream,
                BitmapCreateOptions.PreservePixelFormat | BitmapCreateOptions.IgnoreColorProfile,
                BitmapCacheOption.OnLoad);
            if (decoder.Frames.Count == 0) return null;
            var frame = decoder.Frames[0];
            if (frame.CanFreeze) frame.Freeze();
            return frame;
        }
        catch (Exception ex)
        {
            App.Log("Markdown image load failed: " + ex.Message);
            return null;
        }
    }
}
