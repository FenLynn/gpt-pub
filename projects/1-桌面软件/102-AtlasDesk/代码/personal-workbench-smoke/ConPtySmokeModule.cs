using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class ConPtySmokeModule
{
    [ModuleInitializer]
    internal static void Run()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763))
            return;

        var comSpec = Environment.GetEnvironmentVariable("ComSpec")
                      ?? Path.Combine(Environment.SystemDirectory, "cmd.exe");
        using var outputSeen = new ManualResetEventSlim(false);
        using var exited = new ManualResetEventSlim(false);
        ConPtySession? session = null;
        try
        {
            session = ConPtySession.Start(new TerminalLaunchSpec
            {
                Title = "CI CMD",
                Executable = comSpec,
                Arguments = "/d /q",
                WorkingDirectory = Path.GetTempPath()
            }, 100, 28);
            session.OutputReceived += (_, text) =>
            {
                if (!string.IsNullOrEmpty(text)) outputSeen.Set();
            };
            session.Exited += (_, _) => exited.Set();

            if (!outputSeen.Wait(TimeSpan.FromSeconds(10)))
                throw new InvalidOperationException("ConPTY CMD produced no output through the pseudoconsole channel.");

            session.WriteAsync("exit\r").GetAwaiter().GetResult();
            if (!exited.Wait(TimeSpan.FromSeconds(10)))
                throw new InvalidOperationException("ConPTY CMD did not accept the exit command through the input channel.");

            if (session.ProcessId <= 0)
                throw new InvalidOperationException("ConPTY CMD did not expose a valid process identifier.");
        }
        finally
        {
            if (session is not null)
                session.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }
}
