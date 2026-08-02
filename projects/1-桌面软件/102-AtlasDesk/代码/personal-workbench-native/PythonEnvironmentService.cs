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
    private static readonly string[] WorkspaceEnvironmentNames = [".venv", "venv", ".python"];
    private static readonly HashSet<string> IgnoredWorkspaceDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".idea", ".vs", ".vscode", "node_modules", "bin", "obj", "build", "dist", "out",
        ".cache", ".pytest_cache", "__pycache__", ".venv", "venv", ".python"
    };

    public static async Task<PythonDiscoveryResult> DiscoverAsync(AppSettings settings, CancellationToken cancellationToken = default)
    {
        var candidates = new List<EnvironmentCandidate>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var condaTask = FindCondaAsync(settings.CondaPath, cancellationToken);
        var uvTask = FindUvAsync(settings.UvPath, cancellationToken);
        var conda = await condaTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();

        var condaVersion = string.Empty;
        if (!string.IsNullOrWhiteSpace(conda))
        {
            var versionResult = await RunToolAsync(conda, "--version", 5000, cancellationToken).ConfigureAwait(false);
            condaVersion = PreferredOutput(versionResult).Trim();
            foreach (var prefix in await ReadCondaEnvironmentsAsync(conda, cancellationToken).ConfigureAwait(false))
            {
                AddCandidate(candidates, seen, new EnvironmentCandidate(
                    "conda",
                    GetCondaEnvironmentName(prefix),
                    prefix,
                    Path.Combine(prefix, "python.exe"),
                    "conda env list --json"));
            }
        }

        foreach (var workspaceEnvironment in EnumerateWorkspaceEnvironmentCandidates(settings.WorkspaceRoot))
        {
            AddCandidate(candidates, seen, new EnvironmentCandidate(
                "uv",
                workspaceEnvironment.Name,
                workspaceEnvironment.Prefix,
                Path.Combine(workspaceEnvironment.Prefix, "Scripts", "python.exe"),
                workspaceEnvironment.Source));
        }

        foreach (var python in await FindSystemPythonsAsync(cancellationToken).ConfigureAwait(false))
        {
            AddCandidate(candidates, seen, new EnvironmentCandidate(
                "system",
                Path.GetFileName(Path.GetDirectoryName(python) ?? python),
                Path.GetDirectoryName(python) ?? string.Empty,
                python,
                "PATH / Python Launcher"));
        }

        var uv = await uvTask.ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        var uvVersion = string.Empty;
        if (!string.IsNullOrWhiteSpace(uv))
        {
            var versionResult = await RunToolAsync(uv, "--version", 5000, cancellationToken).ConfigureAwait(false);
            uvVersion = PreferredOutput(versionResult).Trim();
        }

        var environments = await MaterializeCandidatesAsync(candidates, cancellationToken).ConfigureAwait(false);
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

    public static IReadOnlyList<string> ParsePythonLauncherPaths(string output)
    {
        if (string.IsNullOrWhiteSpace(output))
            return Array.Empty<string>();

        var results = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var match = Regex.Match(
                line,
                @"(?<path>(?:[A-Za-z]:\\|\\\\).*?python(?:w)?\.exe)\s*$",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (match.Success)
                results.Add(match.Groups["path"].Value.Trim());
        }
        return results.ToArray();
    }

    public static IReadOnlyList<string> EnumerateWorkspaceEnvironmentPrefixes(string? workspace, int maxProjectDirectories = 120) =>
        EnumerateWorkspaceEnvironmentCandidates(workspace, maxProjectDirectories)
            .Select(item => item.Prefix)
            .ToArray();

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

    public static Task<string> FindCondaAsync(string? configuredPath) =>
        FindCondaAsync(configuredPath, CancellationToken.None);

    public static Task<string> FindUvAsync(string? configuredPath) =>
        FindUvAsync(configuredPath, CancellationToken.None);

    private static async Task<string> FindCondaAsync(string? configuredPath, CancellationToken cancellationToken)
    {
        var candidates = new List<string>();
        AddIfPresent(candidates, configuredPath);
        candidates.AddRange(await FindOnPathAsync("conda.exe", cancellationToken).ConfigureAwait(false));
        candidates.AddRange(await FindOnPathAsync("conda.bat", cancellationToken).ConfigureAwait(false));

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

    private static async Task<string> FindUvAsync(string? configuredPath, CancellationToken cancellationToken)
    {
        var candidates = new List<string>();
        AddIfPresent(candidates, configuredPath);
        candidates.AddRange(await FindOnPathAsync("uv.exe", cancellationToken).ConfigureAwait(false));
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        AddIfPresent(candidates, Path.Combine(home, ".local", "bin", "uv.exe"));
        AddIfPresent(candidates, Path.Combine(home, ".cargo", "bin", "uv.exe"));
        return candidates.FirstOrDefault(File.Exists) ?? string.Empty;
    }

    private static async Task<IReadOnlyList<string>> ReadCondaEnvironmentsAsync(string conda, CancellationToken cancellationToken)
    {
        var result = await RunToolAsync(conda, "env list --json", 12000, cancellationToken).ConfigureAwait(false);
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
            App.Log("Conda environment JSON parse failed: " + ex.Message);
            return Array.Empty<string>();
        }
    }

    private static async Task<IReadOnlyList<PythonEnvironmentInfo>> MaterializeCandidatesAsync(
        IReadOnlyList<EnvironmentCandidate> candidates,
        CancellationToken cancellationToken)
    {
        using var gate = new SemaphoreSlim(4);
        var tasks = candidates.Select(async candidate =>
        {
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                return new PythonEnvironmentInfo
                {
                    Kind = candidate.Kind,
                    Name = candidate.Name,
                    Prefix = candidate.Prefix,
                    PythonExecutable = candidate.PythonExecutable,
                    Version = await ReadPythonVersionAsync(candidate.PythonExecutable, cancellationToken).ConfigureAwait(false),
                    Source = candidate.Source
                };
            }
            finally
            {
                gate.Release();
            }
        });
        return await Task.WhenAll(tasks).ConfigureAwait(false);
    }

    private static async Task<string> ReadPythonVersionAsync(string python, CancellationToken cancellationToken)
    {
        var result = await RunToolAsync(
            python,
            "-c \"import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')\"",
            5000,
            cancellationToken,
            logFailure: false).ConfigureAwait(false);
        return result.ExitCode == 0 ? result.Output.Trim() : string.Empty;
    }

    private static async Task<IReadOnlyList<string>> FindSystemPythonsAsync(CancellationToken cancellationToken)
    {
        var results = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in await FindOnPathAsync("python.exe", cancellationToken).ConfigureAwait(false))
            results.Add(path);

        var launcher = (await FindOnPathAsync("py.exe", cancellationToken).ConfigureAwait(false)).FirstOrDefault();
        if (string.IsNullOrWhiteSpace(launcher))
            return results.ToArray();

        var output = await RunToolAsync(launcher, "-0p", 5000, cancellationToken, logFailure: false).ConfigureAwait(false);
        foreach (var path in ParsePythonLauncherPaths(output.Output))
        {
            if (File.Exists(path))
                results.Add(Path.GetFullPath(path));
        }

        return results.ToArray();
    }

    private static async Task<IReadOnlyList<string>> FindOnPathAsync(string executable, CancellationToken cancellationToken)
    {
        var result = await RunToolAsync("where.exe", executable, 4000, cancellationToken, logFailure: false).ConfigureAwait(false);
        if (result.ExitCode != 0)
            return Array.Empty<string>();
        return result.Output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Select(value => value.Trim())
            .Where(File.Exists)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static IReadOnlyList<WorkspaceEnvironmentCandidate> EnumerateWorkspaceEnvironmentCandidates(
        string? workspace,
        int maxProjectDirectories = 120)
    {
        if (string.IsNullOrWhiteSpace(workspace) || !Directory.Exists(workspace))
            return Array.Empty<WorkspaceEnvironmentCandidate>();

        var results = new List<WorkspaceEnvironmentCandidate>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddFromRoot(string root, string source, string? projectName)
        {
            foreach (var environmentName in WorkspaceEnvironmentNames)
            {
                var prefix = Path.Combine(root, environmentName);
                var python = Path.Combine(prefix, "Scripts", "python.exe");
                if (!File.Exists(python))
                    continue;

                var fullPrefix = Path.GetFullPath(prefix);
                if (!seen.Add(fullPrefix))
                    continue;

                results.Add(new WorkspaceEnvironmentCandidate(
                    string.IsNullOrWhiteSpace(projectName) ? environmentName : projectName + " · " + environmentName,
                    fullPrefix,
                    source));
            }
        }

        var fullWorkspace = Path.GetFullPath(workspace);
        AddFromRoot(fullWorkspace, "当前工作区", null);
        try
        {
            foreach (var projectDirectory in Directory.EnumerateDirectories(fullWorkspace)
                         .Where(path => !IgnoredWorkspaceDirectories.Contains(Path.GetFileName(path)))
                         .OrderBy(path => path, StringComparer.OrdinalIgnoreCase)
                         .Take(Math.Clamp(maxProjectDirectories, 1, 500)))
            {
                var projectName = Path.GetFileName(projectDirectory);
                AddFromRoot(projectDirectory, "工作区项目：" + projectName, projectName);
            }
        }
        catch (Exception ex)
        {
            App.Log("Workspace Python environment scan skipped: " + ex.Message);
        }

        return results;
    }

    private static void AddCandidate(
        ICollection<EnvironmentCandidate> candidates,
        ISet<string> seen,
        EnvironmentCandidate candidate)
    {
        if (!File.Exists(candidate.PythonExecutable))
            return;

        var python = Path.GetFullPath(candidate.PythonExecutable);
        if (!seen.Add(python))
            return;

        candidates.Add(candidate with
        {
            Prefix = string.IsNullOrWhiteSpace(candidate.Prefix) ? string.Empty : Path.GetFullPath(candidate.Prefix),
            PythonExecutable = python
        });
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

    private static void AddIfPresent(ICollection<string> candidates, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value) && File.Exists(value))
            candidates.Add(Path.GetFullPath(value));
    }

    private static string PreferredOutput(ToolResult result) =>
        string.IsNullOrWhiteSpace(result.Output) ? result.Error : result.Output;

    private static async Task<ToolResult> RunToolAsync(
        string fileName,
        string arguments,
        int timeoutMilliseconds,
        CancellationToken cancellationToken = default,
        bool logFailure = true)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
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
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(timeoutMilliseconds);
            try
            {
                await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                try { process.Kill(true); } catch { }
                throw;
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(true); } catch { }
                try { await process.WaitForExitAsync().ConfigureAwait(false); } catch { }
                return new ToolResult(-1, await outputTask.ConfigureAwait(false), "执行超时");
            }

            return new ToolResult(process.ExitCode, await outputTask.ConfigureAwait(false), await errorTask.ConfigureAwait(false));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            if (logFailure)
                App.Log($"Tool execution failed: {fileName} {arguments}: {ex}");
            return new ToolResult(-1, string.Empty, ex.Message);
        }
    }

    private sealed record EnvironmentCandidate(
        string Kind,
        string Name,
        string Prefix,
        string PythonExecutable,
        string Source);

    private sealed record WorkspaceEnvironmentCandidate(string Name, string Prefix, string Source);
    private sealed record ToolResult(int ExitCode, string Output, string Error);
}
