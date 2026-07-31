namespace PersonalWorkbench;

public static class TerminalReliability
{
    private const string NativeHostMarker = "PersonalWorkbenchNativeHost";

    public static TerminalLaunchSpec CreateCmd(AppSettings settings, string? title = null, string? workingDirectory = null)
    {
        var directory = Directory.Exists(workingDirectory)
            ? workingDirectory!
            : Directory.Exists(settings.WorkspaceRoot)
                ? settings.WorkspaceRoot
                : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var command = Path.Combine(Environment.SystemDirectory, "cmd.exe");

        // The working directory is supplied directly to CreateProcess. /K performs
        // one silent UTF-8 initialization command and then keeps the same real
        // Windows CMD process alive in interactive mode.
        return new TerminalLaunchSpec
        {
            Title = string.IsNullOrWhiteSpace(title) ? "CMD" : title,
            Executable = command,
            Arguments = "/d /q /k \"chcp 65001>nul & rem " + NativeHostMarker + "\"",
            WorkingDirectory = directory,
            InitialInput = string.Empty
        };
    }

    public static bool IsSystemCmd(TerminalLaunchSpec spec)
    {
        if (spec is null || string.IsNullOrWhiteSpace(spec.Executable)) return false;
        try
        {
            var executable = Path.GetFullPath(spec.Executable);
            var systemCmd = Path.GetFullPath(Path.Combine(Environment.SystemDirectory, "cmd.exe"));
            return executable.Equals(systemCmd, StringComparison.OrdinalIgnoreCase)
                   || Path.GetFileName(executable).Equals("cmd.exe", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return Path.GetFileName(spec.Executable).Equals("cmd.exe", StringComparison.OrdinalIgnoreCase);
        }
    }

    public static bool IsSupervisedCmd(TerminalLaunchSpec spec)
        => IsSystemCmd(spec)
           && spec.Arguments.Contains(NativeHostMarker, StringComparison.OrdinalIgnoreCase)
           && string.IsNullOrEmpty(spec.InitialInput);

    public static string ResolveProxyPath()
        => Path.Combine(Environment.SystemDirectory, "cmd.exe");
}
