using PersonalWorkbench;
using System.Runtime.CompilerServices;
using System.Text;

internal static class TerminalReliabilitySmokeModule
{
    [ModuleInitializer]
    internal static void Schedule()
    {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 17763)) return;

        // Do not run an event-driven terminal session while the CLR still owns
        // the module-initialization lock. Output callbacks that enter this module
        // would otherwise wait for initialization to finish while the initializer
        // itself waits for those callbacks. A foreground thread keeps the smoke
        // process alive, starts after the lock is released, and fails the process
        // immediately if any real CMD regression check fails.
        var thread = new Thread(() =>
        {
            try
            {
                RunCore();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("TERMINAL RELIABILITY SMOKE FAILED: " + ex);
                Environment.Exit(1);
            }
        })
        {
            IsBackground = false,
            Name = "PersonalWorkbench Terminal Reliability Smoke"
        };
        thread.Start();
    }

    private static void RunCore()
    {
        var root = Path.Combine(Path.GetTempPath(), "PWB 终端 smoke spaces " + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var settings = new AppSettings { WorkspaceRoot = root, DefaultShell = "cmd" };
            for (var iteration = 1; iteration <= 5; iteration++)
                RunOne(settings, root, iteration);
            Console.WriteLine("PASS system ConPTY CMD reliability suite: 5 consecutive sessions");
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    private static void RunOne(AppSettings settings, string root, int iteration)
    {
        var spec = TerminalReliability.CreateCmd(settings, "CMD smoke " + iteration, root);
        var readyMarker = "__PWB_READY_" + iteration + "__";
        var secondMarker = "__PWB_SECOND_" + iteration + "__";
        var pwdMarker = "__PWB_PWD_OK_" + iteration + "__";
        var cwdSentinel = ".pwb-cwd-" + iteration + "-" + Guid.NewGuid().ToString("N") + ".sentinel";
        File.WriteAllText(Path.Combine(root, cwdSentinel), "cwd");
        using var promptSeen = new ManualResetEventSlim(false);
        using var readySeen = new ManualResetEventSlim(false);
        using var secondSeen = new ManualResetEventSlim(false);
        using var pwdSeen = new ManualResetEventSlim(false);
        using var exited = new ManualResetEventSlim(false);
        var output = new StringBuilder();
        var exitCode = int.MinValue;
        ITerminalSession? session = null;

        try
        {
            session = TerminalSessionFactory.Start(spec, 100, 28);
            session.OutputReceived += (_, text) =>
            {
                lock (output)
                {
                    output.Append(text);
                    var clean = StripAnsi(output.ToString());
                    if (clean.Contains('>')) promptSeen.Set();
                    if (ContainsCommandResult(clean, readyMarker)) readySeen.Set();
                    if (ContainsCommandResult(clean, secondMarker)) secondSeen.Set();
                    if (ContainsCommandResult(clean, pwdMarker)) pwdSeen.Set();
                }
            };
            session.Exited += (_, code) =>
            {
                exitCode = code;
                exited.Set();
            };

            Require(!exited.Wait(TimeSpan.FromMilliseconds(700)), "CMD exited before accepting input", iteration, output, exited, exitCode);
            WriteWithTimeout(session, "echo " + readyMarker + "\r", "readiness command");
            Require(readySeen.Wait(TimeSpan.FromSeconds(5)), "CMD did not execute the readiness command", iteration, output, exited, exitCode);
            Require(promptSeen.IsSet, "CMD did not render a prompt after its first command", iteration, output, exited, exitCode);

            session.Resize(132, 36);
            WriteWithTimeout(session, "echo " + secondMarker + "\r", "second command");
            Require(secondSeen.Wait(TimeSpan.FromSeconds(5)), "CMD did not execute a second command after resize", iteration, output, exited, exitCode);

            WriteWithTimeout(
                session,
                "if exist \"" + cwdSentinel + "\" echo " + pwdMarker + "\r",
                "working-directory command");
            Require(pwdSeen.Wait(TimeSpan.FromSeconds(5)), "CMD working directory was not preserved", iteration, output, exited, exitCode);
            Require(!exited.Wait(TimeSpan.FromMilliseconds(700)), "CMD exited while idle after multiple commands", iteration, output, exited, exitCode);

            WriteWithTimeout(session, "exit\r", "exit command");
            Require(exited.Wait(TimeSpan.FromSeconds(5)), "CMD did not exit cleanly", iteration, output, exited, exitCode);
            Require(exitCode == 0, "CMD returned non-zero exit code " + exitCode, iteration, output, exited, exitCode);
        }
        finally
        {
            if (session is not null)
                session.DisposeAsync().AsTask().GetAwaiter().GetResult();
        }
    }

    private static void WriteWithTimeout(ITerminalSession session, string text, string label)
    {
        var write = session.WriteAsync(text);
        if (Task.WhenAny(write, Task.Delay(TimeSpan.FromSeconds(2))).GetAwaiter().GetResult() != write)
            throw new InvalidOperationException(
                "CMD write timed out while sending " + label
                + ". NativeTrace=" + ReadNativeDiagnosticTail());
        write.GetAwaiter().GetResult();
    }

    private static void Require(bool condition, string message, int iteration, StringBuilder output, ManualResetEventSlim exited, int exitCode)
    {
        if (condition) return;
        string snapshot;
        lock (output) snapshot = StripAnsi(output.ToString());
        throw new InvalidOperationException(
            message
            + ". Iteration=" + iteration
            + ", Exited=" + exited.IsSet
            + ", ExitCode=" + (exitCode == int.MinValue ? "<pending>" : exitCode)
            + ", Output=" + snapshot
            + ", AppLogTail=" + ReadLogTail()
            + ", NativeTrace=" + ReadNativeDiagnosticTail());
    }

    private static string ReadLogTail()
    {
        try
        {
            if (!File.Exists(App.LogPath)) return "<missing>";
            var content = File.ReadAllText(App.LogPath);
            const int limit = 6000;
            return content.Length <= limit ? content : content[^limit..];
        }
        catch (Exception ex)
        {
            return "<unreadable: " + ex.Message + ">";
        }
    }

    private static string ReadNativeDiagnosticTail()
    {
        try
        {
            var file = new DirectoryInfo(Path.GetTempPath())
                .EnumerateFiles("PersonalWorkbench-Terminal-*.log", SearchOption.TopDirectoryOnly)
                .OrderByDescending(item => item.LastWriteTimeUtc)
                .FirstOrDefault();
            if (file is null) return "<missing>";
            var content = File.ReadAllText(file.FullName);
            const int limit = 6000;
            return content.Length <= limit ? content : content[^limit..];
        }
        catch (Exception ex)
        {
            return "<unreadable: " + ex.Message + ">";
        }
    }

    private static bool ContainsCommandResult(string value, string expected)
    {
        var searchFrom = 0;
        while (searchFrom < value.Length)
        {
            var index = value.IndexOf(expected, searchFrom, StringComparison.Ordinal);
            if (index < 0) return false;

            var prefixStart = Math.Max(0, index - 5);
            var prefix = value[prefixStart..index];
            if (!prefix.EndsWith("echo ", StringComparison.OrdinalIgnoreCase))
                return true;

            searchFrom = index + expected.Length;
        }
        return false;
    }

    private static string StripAnsi(string value)
    {
        var result = new StringBuilder(value.Length);
        var state = 0;
        foreach (var character in value)
        {
            if (state == 0)
            {
                if (character == '\u001b') state = 1;
                else if (character != '\a') result.Append(character);
            }
            else if (state == 1) state = character == '[' ? 2 : character == ']' ? 3 : 0;
            else if (state == 2) { if (character is >= '@' and <= '~') state = 0; }
            else if (character == '\a') state = 0;
        }
        return result.ToString();
    }
}
