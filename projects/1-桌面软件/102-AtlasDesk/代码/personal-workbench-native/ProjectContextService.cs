using System.ComponentModel;
using System.Diagnostics;

namespace PersonalWorkbench;

public sealed class ProjectWorkflowContext
{
    public string ProjectRoot { get; init; } = string.Empty;
    public string GitSummary { get; init; } = string.Empty;
    public string EnvironmentSummary { get; init; } = string.Empty;
    public string RecentFilesSummary { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public bool GitAvailable { get; init; }
    public bool HasChanges { get; init; }

    public string TitleSuffix => string.IsNullOrWhiteSpace(GitSummary) ? string.Empty : " · " + GitSummary;

    public string DetailSummary
    {
        get
        {
            var values = new[] { EnvironmentSummary, RecentFilesSummary, Status }
                .Where(value => !string.IsNullOrWhiteSpace(value));
            return string.Join(" · ", values);
        }
    }
}

/// <summary>
/// Reads one explicitly selected project's context. It never scans every project
/// at startup and never launches language runtimes. Marker and recent-file work is
/// isolated from the WPF Dispatcher; Git is bounded by cancellation and timeout.
/// </summary>
public static class ProjectContextService
{
    private static readonly TimeSpan GitTimeout = TimeSpan.FromSeconds(3);

    public static async Task<ProjectWorkflowContext> ReadAsync(
        ProjectDescriptor project,
        AppSettings settings,
        CancellationToken cancellationToken)
    {
        if (!Directory.Exists(project.RootPath))
        {
            return new ProjectWorkflowContext
            {
                ProjectRoot = project.RootPath,
                Status = "项目路径不存在"
            };
        }

        var local = await Task.Run(
            () => ReadLocalContext(project, settings, cancellationToken),
            cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();

        if (!project.Kind.HasFlag(ProjectKind.Git))
            return local;

        var git = await ReadGitContextAsync(project.RootPath, settings, cancellationToken).ConfigureAwait(false);
        return new ProjectWorkflowContext
        {
            ProjectRoot = project.RootPath,
            GitSummary = git.Summary,
            GitAvailable = git.Available,
            HasChanges = git.HasChanges,
            EnvironmentSummary = local.EnvironmentSummary,
            RecentFilesSummary = local.RecentFilesSummary,
            Status = git.Status
        };
    }

    private static ProjectWorkflowContext ReadLocalContext(
        ProjectDescriptor project,
        AppSettings settings,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var environment = BuildEnvironmentSummary(project);
        var recent = BuildRecentFilesSummary(project.RootPath, settings.RecentWorkspaceFiles, cancellationToken);
        return new ProjectWorkflowContext
        {
            ProjectRoot = project.RootPath,
            EnvironmentSummary = environment,
            RecentFilesSummary = recent,
            Status = project.Kind.HasFlag(ProjectKind.Git) ? string.Empty : "非 Git 项目"
        };
    }

    private static string BuildEnvironmentSummary(ProjectDescriptor project)
    {
        var values = new List<string>();
        if (project.Kind.HasFlag(ProjectKind.Python)) values.Add("Python");
        if (project.Kind.HasFlag(ProjectKind.Node)) values.Add("Node");
        if (project.Kind.HasFlag(ProjectKind.DotNet)) values.Add(".NET");
        if (project.Kind.HasFlag(ProjectKind.Latex)) values.Add("LaTeX");
        if (project.Kind.HasFlag(ProjectKind.Rust)) values.Add("Rust");
        if (project.Kind.HasFlag(ProjectKind.Go)) values.Add("Go");
        return values.Count == 0 ? "无运行环境标记" : "环境 " + string.Join(" / ", values);
    }

    private static string BuildRecentFilesSummary(
        string projectRoot,
        IEnumerable<string> recentFiles,
        CancellationToken cancellationToken)
    {
        string root;
        try
        {
            root = Path.GetFullPath(projectRoot)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
        }
        catch
        {
            return string.Empty;
        }

        var count = 0;
        foreach (var candidate in recentFiles ?? Array.Empty<string>())
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var full = Path.GetFullPath(candidate);
                if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase) && File.Exists(full))
                    count++;
            }
            catch { }
            if (count >= 99) break;
        }
        return count == 0 ? "无最近文件" : $"最近文件 {count}";
    }

    private static async Task<GitContextResult> ReadGitContextAsync(
        string projectRoot,
        AppSettings settings,
        CancellationToken cancellationToken)
    {
        var executable = File.Exists(settings.GitPath) ? settings.GitPath : "git.exe";
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            }
        };
        process.StartInfo.ArgumentList.Add("-C");
        process.StartInfo.ArgumentList.Add(projectRoot);
        process.StartInfo.ArgumentList.Add("status");
        process.StartInfo.ArgumentList.Add("--short");
        process.StartInfo.ArgumentList.Add("--branch");
        process.StartInfo.ArgumentList.Add("--untracked-files=no");

        try
        {
            if (!process.Start())
                return new GitContextResult(false, false, string.Empty, "Git 无法启动");

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(GitTimeout);
            var outputTask = process.StandardOutput.ReadToEndAsync(timeout.Token);
            var errorTask = process.StandardError.ReadToEndAsync(timeout.Token);
            try
            {
                await process.WaitForExitAsync(timeout.Token).ConfigureAwait(false);
                var output = await outputTask.ConfigureAwait(false);
                var error = await errorTask.ConfigureAwait(false);
                cancellationToken.ThrowIfCancellationRequested();

                if (process.ExitCode != 0)
                {
                    var reason = string.IsNullOrWhiteSpace(error) ? "Git 状态读取失败" : error.Trim();
                    return new GitContextResult(true, false, string.Empty, reason);
                }

                var lines = output
                    .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var branch = lines.FirstOrDefault(line => line.StartsWith("## ", StringComparison.Ordinal));
                var branchName = branch is null ? string.Empty : branch[3..].Split("...", 2, StringSplitOptions.None)[0];
                var changes = lines.Count(line => !line.StartsWith("## ", StringComparison.Ordinal));
                var summary = string.IsNullOrWhiteSpace(branchName) ? "Git" : "分支 " + branchName;
                return new GitContextResult(true, changes > 0, summary,
                    changes == 0 ? "工作区干净" : $"未提交变化 {changes}");
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                TryKill(process);
                return new GitContextResult(true, false, string.Empty, "Git 状态读取超时");
            }
        }
        catch (Win32Exception)
        {
            return new GitContextResult(false, false, string.Empty, "未找到 Git");
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            throw;
        }
        catch (Exception ex)
        {
            App.Log("Project Git context failed: " + ex.Message);
            return new GitContextResult(false, false, string.Empty, "Git 状态不可用");
        }
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch { }
    }

    private sealed record GitContextResult(bool Available, bool HasChanges, string Summary, string Status);
}
