using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class TerminalProductionRoutingSmokeModule
{
    [ModuleInitializer]
    internal static void VerifyProductionRouting()
    {
        var repositoryRoot = FindRepositoryRoot();
        var sourcePath = Path.Combine(
            repositoryRoot,
            "personal-workbench-native",
            "TerminalDrawerControl.xaml.cs");
        if (!File.Exists(sourcePath))
            throw new InvalidOperationException("Unable to locate production terminal UI source: " + sourcePath);

        var source = File.ReadAllText(sourcePath);
        Require(
            source.Contains("TerminalSessionFactory.Start(state.Spec", StringComparison.Ordinal),
            "Production terminal UI must start sessions through TerminalSessionFactory.");
        Require(
            !source.Contains("ConPtySession.Start(state.Spec", StringComparison.Ordinal),
            "Production terminal UI bypasses the verified terminal factory.");

        var settings = new AppSettings
        {
            WorkspaceRoot = Path.GetTempPath(),
            DefaultShell = "cmd"
        };
        var standard = TerminalLaunchSpec.Create(settings, "cmd");
        var supervised = TerminalReliability.CreateCmd(settings);
        Require(TerminalReliability.IsSystemCmd(standard), "Standard CMD launch spec was not recognized.");
        Require(TerminalReliability.IsSystemCmd(supervised), "Supervised CMD launch spec was not recognized.");
        Console.WriteLine("PASS production terminal UI uses verified session factory");
    }

    private static string FindRepositoryRoot()
    {
        var candidates = new[]
        {
            Environment.GetEnvironmentVariable("GITHUB_WORKSPACE"),
            Directory.GetCurrentDirectory(),
            AppContext.BaseDirectory
        };
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            var current = new DirectoryInfo(Path.GetFullPath(candidate));
            while (current is not null)
            {
                if (Directory.Exists(Path.Combine(current.FullName, "personal-workbench-native"))
                    && Directory.Exists(Path.Combine(current.FullName, "personal-workbench-smoke")))
                    return current.FullName;
                current = current.Parent;
            }
        }
        throw new DirectoryNotFoundException("Unable to locate the Personal Workbench repository root.");
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
