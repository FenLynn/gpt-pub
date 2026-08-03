namespace PersonalWorkbench;

public static class ExecutableLocator
{
    public static string? Resolve(string? configuredPath, params string[] candidateNames)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            try
            {
                var full = Path.GetFullPath(configuredPath.Trim());
                if (File.Exists(full)) return full;
            }
            catch { }
        }

        var pathValue = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        var pathExtensions = (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT;.COM")
            .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var rawDirectory in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            string directory;
            try { directory = Path.GetFullPath(rawDirectory.Trim('"')); }
            catch { continue; }
            if (!Directory.Exists(directory)) continue;

            foreach (var candidate in candidateNames.Where(name => !string.IsNullOrWhiteSpace(name)))
            {
                var fileName = candidate.Trim();
                if (Path.HasExtension(fileName))
                {
                    var exact = Path.Combine(directory, fileName);
                    if (File.Exists(exact)) return exact;
                    continue;
                }

                foreach (var extension in pathExtensions)
                {
                    var path = Path.Combine(directory, fileName + extension.ToLowerInvariant());
                    if (File.Exists(path)) return path;
                    path = Path.Combine(directory, fileName + extension.ToUpperInvariant());
                    if (File.Exists(path)) return path;
                }
            }
        }

        return null;
    }
}
