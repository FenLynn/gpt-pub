using System.IO;
using System.Reflection;

namespace PersonalWorkbench;

public static class TerminalAssetManager
{
    private const string AssetVersion = "xterm-6.0.0-fit-0.11.0-v1";

    public static string EnsureExtracted()
    {
        var root = Path.Combine(App.AppDataDirectory, "terminal-assets", AssetVersion);
        var marker = Path.Combine(root, ".complete");
        if (File.Exists(marker) && File.Exists(Path.Combine(root, "terminal.html")))
            return root;

        Directory.CreateDirectory(root);
        var assembly = Assembly.GetExecutingAssembly();
        var resources = assembly.GetManifestResourceNames()
            .Where(name => name.Contains("TerminalAssets", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        foreach (var resource in resources)
        {
            var relative = ResourceToRelativePath(resource);
            if (string.IsNullOrWhiteSpace(relative)) continue;
            var target = Path.Combine(root, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target) ?? root);
            using var input = assembly.GetManifestResourceStream(resource)
                ?? throw new InvalidOperationException("Missing embedded terminal asset: " + resource);
            using var output = File.Create(target);
            input.CopyTo(output);
        }

        var required = new[]
        {
            Path.Combine(root, "terminal.html"), Path.Combine(root, "terminal-host.js"),
            Path.Combine(root, "vendor", "xterm.js"), Path.Combine(root, "vendor", "xterm.css"),
            Path.Combine(root, "vendor", "addon-fit.js")
        };
        var missing = required.Where(path => !File.Exists(path)).ToArray();
        if (missing.Length > 0)
            throw new FileNotFoundException("Terminal assets are incomplete: " + string.Join(", ", missing.Select(Path.GetFileName)));

        File.WriteAllText(marker, DateTime.UtcNow.ToString("O"));
        return root;
    }

    private static string ResourceToRelativePath(string resource)
    {
        var marker = ".TerminalAssets.";
        var index = resource.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return string.Empty;
        var tail = resource[(index + marker.Length)..];
        if (tail.Equals("terminal.html", StringComparison.OrdinalIgnoreCase)) return "terminal.html";
        if (tail.Equals("terminal-host.js", StringComparison.OrdinalIgnoreCase)) return "terminal-host.js";
        if (tail.EndsWith("vendor.xterm.js", StringComparison.OrdinalIgnoreCase)) return Path.Combine("vendor", "xterm.js");
        if (tail.EndsWith("vendor.xterm.css", StringComparison.OrdinalIgnoreCase)) return Path.Combine("vendor", "xterm.css");
        if (tail.EndsWith("vendor.addon-fit.js", StringComparison.OrdinalIgnoreCase)) return Path.Combine("vendor", "addon-fit.js");
        return string.Empty;
    }
}
