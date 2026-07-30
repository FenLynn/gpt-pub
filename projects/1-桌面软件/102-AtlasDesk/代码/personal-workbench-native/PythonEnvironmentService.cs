using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PersonalWorkbench;

public sealed class PythonEnvironmentInfo
{
    public string Kind { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Prefix { get; init; } = string.Empty;
    public string PythonExecutable { get; init; } = string.Empty;
    public string Version { get; init; } = string.Empty;
    public string Source { get; init; } = string.Empty;

    public string DisplayName => string.IsNullOrWhiteSpace(Name) ? Path.GetFileName(Prefix.TrimEnd(Path.DirectorySeparatorChar)) : Name;
    public string KindLabel => Kind switch
    {
        "conda" => "Conda",
        "uv" => "uv / venv",
        "system" => "系统 Python",
        _ => Kind
    };
}

public sealed class PythonDiscoveryResult
{
    public string CondaExecutable { get; init; } = string.Empty;
    public string CondaVersion { get; init; } = string.Empty;
    public string UvExecutable { get; init; } = string.Empty;
    public string UvVersion { get; init; } = string.Empty;
    public IReadOnlyList<PythonEnvironmentInfo> Environments { get; init; } = Array.Empty<PythonEnvironmentInfo>();
}

public static class PythonEnvironmentService
{
    public static async Task<PythonDiscoveryResult> DiscoverAsync(AppSettings settings)
    {
        var environments = new List<PythonEnvironmentInfo>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var conda = await FindCondaAsync(settings.CondaPath).ConfigureAwait(false);
        var condaVersion = string.Empty;
        if (!string.IsNullOrWhiteSpace(conda))
        {
            condaVersion = (await RunToolAsync(conda, "--version", 5000).ConfigureAwait(false)).Output.Trim();
            foreach (var prefix in await ReadCondaEnvironmentsAsync(conda).ConfigureAwait(false))
            {
                var python = Path.Combine(prefix, "python.exe");
                if (!File.Exists(python) || !seen.Add(Path.GetFullPath(python)))
                    continue;

                environments.Add(new PythonEnvironmentInfo
                {
                    Kind = "conda",
                    Name = GetCondaEnvironmentName(prefix),
                    Prefix = prefix,
                    PythonExecutable = python,
                    Version = await ReadPythonVersionAsync(python).ConfigureAwait(false),
                    Source = "conda env list --json"
                });
            }
        }

        var workspace = settings.WorkspaceRoot;
        if (!string.IsNullOrWhiteSpace(workspace) && Directory.Exists(workspace))
        {
            foreach (var candidate in new[]
                     {
                         Path.Combine(workspace, ".venv"),
                         Path.Combine(workspace, "venv"),
                         Path.Combine(workspace, ".python")
                     })
            {
                var python = Path.Combine(candidate, "Scripts", "python.exe");
                if (!File.Exists(python) || !seen.Add(Path.GetFullPath(python)))
                    continue;

                environments.Add(new PythonEnvironmentInfo
                {
                    Kind = "uv",
                    Name = Path.GetFileName(candidate),
                    Prefix = candidate,
                    PythonExecutable = python,
                    Version = await ReadPythonVersionAsync(python).ConfigureAwait(false),
                    Source = "当前工作区"
                });
            }
        }

        foreach (var python in await FindSystemPythonsAsync().ConfigureAwait(false))
        {
            if (!File.Exists(python) || !seen.Add(Path.GetFullPath(python)))
                continue;

            environments.Add(new PythonEnvironmentInfo
            {
                Kind = "system",
                Name = Path.GetFileName(Path.GetDirectoryName(python) ?? python),
                Prefix = Path.GetDirectoryName(python) ?? string.Empty,
                PythonExecutable = python,
                Version = await ReadPythonVersionAsync(python).ConfigureAwait(false),
                Source = "PATH / Python Launcher"
            });
        }

        var uv = await FindUvAsync(settings.UvPath).ConfigureAwait(false);
        var uvVersion = string.Empty;
        if (!string.IsNullOrWhiteSpace(uv))
            uvVersion = (await RunToolAsync(uv, "--version", 5000).ConfigureAwait(false)).Output.Trim();

        return new PythonDiscoveryResult
        {
            CondaExecutable = conda,
            CondaVersion = condaVersion,
            UvExecutable = uv,
            UvVersion = uvVersion,
            Environments = environments
                .OrderBy(item => item.Kind == "conda" ? 0 : item.Kind == "uv" ? 1 : 2)
                .ThenBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToArray()
        };
    }

    public static void OpenTerminal(PythonEnvironmentInfo environment, string? workspace, string? condaExecutable)
    {
        var startDirectory = !string.IsNullOrWhiteSpace(workspace) && Directory.Exists(workspace)
            ? workspace
            : environment.Prefix;
        if (!Directory.Exists(startDirectory))
            startDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        string command;
        if (environment.Kind == "conda")
        {
            var condaBat = ResolveCondaBatch(condaExecutable);
            command = !string.IsNullOrWhiteSpace(condaBat)
                ? $"call \"{condaBat}\" activate \"{environment.Prefix}\" && cd /d \"{startDirectory}\""
                : $"cd /d \"{startDirectory}\"";
        }
        else if (environment.Kind == "uv")
        {
            var activate = Path.Combine(environment.Prefix, "Scripts", "activate.bat");
            command = File.Exists(activate)
                ? $"call \"{activate}\" && cd /d \"{startDirectory}\""
                : $"cd /d \"{startDirectory}\"";
        }
        else
        {
            command = $"cd /d \"{startDirectory}\"";
        }

        Process.Start(new ProcessStartInfo("cmd.exe", "/d /k " + command)
        {
            UseShellExecute = true,
            WorkingDirectory = startDirectory
        });
    }

    public static async Task<string> FindCondaAsync(string? configuredPath)
    {
        var candidates = new List<string>();
        AddIfPresent(candidates, configuredPath);
        candidates.AddRange(await FindOnPathAsync("conda.exe").ConfigureAwait(false));
        candidates.AddRange(await FindOnPathAsync("conda.bat").ConfigureAwait(false));

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        foreach (var root in new[]
                 {
                     Path.Combine(home, "anaconda3"),
                     Path.Combine(home, "miniconda3"),
                     Path.Combine(home, "miniforge3"),
                     Path.Combine(local, "anaconda3"),
                     Path.Combine(local, "miniconda3"),
                     Path.Combine(programData, "anaconda3"),
                     Path.Combine(programData, "miniconda3")
                 })
        {
            AddIfPresent(candidates, Path.Combine(root, "Scripts", "conda.exe"));
            AddIfPresent(candidates, Path.Combine(root, "condabin", "conda.bat"));
        }

        return candidates.FirstOrDefault(File.Exists) ?? string.Empty;
    }

    public static async Task<string> FindUvAsync(string? configuredPath)
    {
        var candidates = new List<string>();
        AddIfPresent(candidates, configuredPath);
        candidates.AddRange(await FindOnPathAsync("uv.exe").ConfigureAwait(false));
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        AddIfPresent(candidates, Path.Combine(home, ".local", "bin", "uv.exe"));
        AddIfPresent(candidates, Path.Combine(home, ".cargo", "bin", "uv.exe"));
        return candidates.FirstOrDefault(File.Exists) ?? string.Empty;
    }

    private static async Task<IReadOnlyList<string>> ReadCondaEnvironmentsAsync(string conda)
    {
        var result = await RunToolAsync(conda, "env list --json", 12000).ConfigureAwait(false);
        if (result.ExitCode != 0 || string.IsNullOrWhiteSpace(result.Output))
            return Array.Empty<string>();

        try
        {
            using var document = JsonDocument.Parse(result.Output);
            if (!document.RootElement.TryGetProperty("envs", out var envs) || envs.ValueKind != JsonValueKind.Array)
                return Array.Empty<string>();

            return envs.EnumerateArray()
                .Select(item => item.GetString())
                .Where(path => !string.IsNullOrWhiteSpace(path) && Directory.Exists(path))
                .Select(path => Path.GetFullPath(path!))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch (Exception ex)
        {
            App.Log("Conda environment JSON parse failed: " + ex);
            return Array.Empty<string>();
        }
    }

    private static async Task<string> ReadPythonVersionAsync(string python)
    {
        var result = await RunToolAsync(python, "-c \"import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')\"", 5000).ConfigureAwait(false);
        return result.ExitCode == 0 ? result.Output.Trim() : string.Empty;
    }

    private static async Task<IReadOnlyList<string>> FindSystemPythonsAsync()
    {
        var results = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in await FindOnPathAsync("python.exe").ConfigureAwait(false))
            results.Add(path);

        var output = await RunToolAsync("py.exe", "-0p", 5000).ConfigureAwait(false);
        foreach (var line in output.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var match = Regex.Match(line, @"(?<path>[A-Za-z]:\\.*?python\.exe)\s*$", RegexOptions.IgnoreCase);
            if (match.Success && File.Exists(match.Groups["path"].Value))
                results.Add(Path.GetFullPath(match.Groups["path"].Value));
        }

        return results.ToArray();
    }

    private static async Task<IReadOnlyList<string>> FindOnPathAsync(string executable)
    {
        var result = await RunToolAsync("where.exe", executable, 4000).ConfigureAwait(false);
        if (result.ExitCode != 0)
            return Array.Empty<string>();
        return result.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(value => value.Trim())
            .Where(File.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string GetCondaEnvironmentName(string prefix)
    {
        var normalized = prefix.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var parent = Path.GetFileName(Path.GetDirectoryName(normalized) ?? string.Empty);
        return string.Equals(parent, "envs", StringComparison.OrdinalIgnoreCase)
            ? Path.GetFileName(normalized)
            : "base";
    }

    private static string ResolveCondaBatch(string? condaExecutable)
    {
        if (string.IsNullOrWhiteSpace(condaExecutable))
            return string.Empty;
        if (condaExecutable.EndsWith(".bat", StringComparison.OrdinalIgnoreCase) && File.Exists(condaExecutable))
            return condaExecutable;

        try
        {
            var scripts = Path.GetDirectoryName(condaExecutable);
            var root = scripts is null ? null : Directory.GetParent(scripts)?.FullName;
            if (root is null)
                return string.Empty;
            var candidate = Path.Combine(root, "condabin", "conda.bat");
            return File.Exists(candidate) ? candidate : string.Empty;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static void AddIfPresent(List<string> candidates, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value) && File.Exists(value))
            candidates.Add(Path.GetFullPath(value));
    }

    private static async Task<ToolResult> RunToolAsync(string fileName, string arguments, int timeoutMilliseconds)
    {
        try
        {
            var actualFile = fileName;
            var actualArguments = arguments;
            var extension = Path.GetExtension(fileName);
            if (extension.Equals(".bat", StringComparison.OrdinalIgnoreCase) || extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase))
            {
                actualFile = "cmd.exe";
                actualArguments = $"/d /s /c \"\"{fileName}\" {arguments}\"";
            }

            var info = new ProcessStartInfo(actualFile, actualArguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8
            };

            using var process = new Process { StartInfo = info };
            if (!process.Start())
                return new ToolResult(-1, string.Empty, "无法启动进程");

            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(timeoutMilliseconds);
            try
            {
                await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(true); } catch { }
                return new ToolResult(-1, await outputTask.ConfigureAwait(false), "执行超时");
            }

            return new ToolResult(process.ExitCode, await outputTask.ConfigureAwait(false), await errorTask.ConfigureAwait(false));
        }
        catch (Exception ex)
        {
            App.Log($"Tool execution failed: {fileName} {arguments}: {ex}");
            return new ToolResult(-1, string.Empty, ex.Message);
        }
    }

    private sealed record ToolResult(int ExitCode, string Output, string Error);
}
