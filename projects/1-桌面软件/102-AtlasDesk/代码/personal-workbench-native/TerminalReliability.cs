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

        // Working directory is supplied directly to CreateProcess. /K executes a
        // one-time, silent UTF-8 initialization command and then keeps the same
        // real system CMD process in interactive mode. No input is injected after
        // the process has been created.
        return new TerminalLaunchSpec
        {
            Title = string.IsNullOrWhiteSpace(title) ? "CMD" : title,
            Executable = command,
            Arguments = "/d /q /k \"chcp 65001>nul & rem " + NativeHostMarker + "\"",
            WorkingDirectory = directory,
            InitialInput = string.Empty
        };
    }

    public static bool IsSupervisedCmd(TerminalLaunchSpec spec)
        => Path.GetFileName(spec.Executable).Equals("cmd.exe", StringComparison.OrdinalIgnoreCase)
           && spec.Arguments.Contains(NativeHostMarker, StringComparison.OrdinalIgnoreCase)
           && string.IsNullOrEmpty(spec.InitialInput)
           && spec.Title.StartsWith("CMD", StringComparison.OrdinalIgnoreCase);

    public static string ResolveProxyPath()
        => Path.Combine(Environment.SystemDirectory, "cmd.exe");
}
