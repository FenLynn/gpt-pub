using System.IO;

namespace PersonalWorkbench;

public static class TerminalAssetManager
{
    public static string EnsureAvailable()
    {
        var root = ProductIdentity.TerminalAssetsDirectory;
        var required = new[]
        {
            Path.Combine(root, "terminal.html"),
            Path.Combine(root, "terminal-host.js"),
            Path.Combine(root, "vendor", "xterm.js"),
            Path.Combine(root, "vendor", "xterm.css"),
            Path.Combine(root, "vendor", "addon-fit.js")
        };
        var missing = required.Where(path => !File.Exists(path)).ToArray();
        if (missing.Length > 0)
            throw new FileNotFoundException(
                "AtlasDesk Runtime 中的终端资源不完整：" +
                string.Join(", ", missing.Select(path => Path.GetRelativePath(App.RuntimeDirectory, path))));
        return root;
    }

    // Compatibility name retained for callers; the method no longer extracts or writes files.
    public static string EnsureExtracted() => EnsureAvailable();
}
