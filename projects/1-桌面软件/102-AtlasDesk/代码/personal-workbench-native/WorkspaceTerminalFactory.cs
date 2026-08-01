using System.IO;

namespace PersonalWorkbench;

public static class WorkspaceTerminalFactory
{
    public static TerminalLaunchSpec Create(AppSettings settings, string shell, string workingDirectory, string? title = null)
    {
        var directory = Directory.Exists(workingDirectory)
            ? workingDirectory
            : Directory.Exists(settings.WorkspaceRoot)
                ? settings.WorkspaceRoot
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        if (string.Equals(shell, "cmd", StringComparison.OrdinalIgnoreCase))
            return TerminalReliability.CreateCmd(settings, title ?? "CMD", directory);

        var pwsh = FindExecutable("pwsh.exe");
        var executable = !string.IsNullOrWhiteSpace(pwsh)
            ? pwsh
            : Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
        var escaped = directory.Replace("'", "''", StringComparison.Ordinal);
        return new TerminalLaunchSpec
        {
            Title = title ?? (Path.GetFileName(executable).Equals("pwsh.exe", StringComparison.OrdinalIgnoreCase) ? "PowerShell 7" : "PowerShell"),
            Executable = executable,
            Arguments = "-NoLogo -NoExit",
            WorkingDirectory = directory,
            InitialInput = $"Set-Location -LiteralPath '{escaped}'\r"
        };
    }

    private static string FindExecutable(string name)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
        foreach (var segment in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var candidate = Path.Combine(segment.Trim().Trim('"'), name);
                if (File.Exists(candidate)) return candidate;
            }
            catch { }
        }
        return string.Empty;
    }
}
