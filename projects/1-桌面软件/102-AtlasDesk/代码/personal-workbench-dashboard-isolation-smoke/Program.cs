using AtlasDesk.DashboardHost;
using PersonalWorkbench;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Windows;
using System.Windows.Threading;

internal static class Program
{
    private const string ProtocolPrefix = "ATLASDESK_DASHBOARD";
    private static string _phase = "not started";

    [STAThread]
    private static int Main()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "atlasdesk-dashboard-isolation-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);

        try
        {
            SetPhase("starting local Dashboard server");
            using var server = LocalDashboardServer.Start();

            SetPhase("creating WPF process surface");
            var app = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
            var surface = new DashboardProcessSurface();
            var window = new Window
            {
                Title = "AtlasDesk Dashboard isolation smoke",
                Width = 920,
                Height = 620,
                MinWidth = 640,
                MinHeight = 420,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Content = surface,
                ShowInTaskbar = false
            };
            window.Show();
            PumpDispatcher(TimeSpan.FromMilliseconds(600));
            AssertWindowAlive(window, "after creating the native surface");
            if (surface.HostHandle == IntPtr.Zero)
                throw new InvalidOperationException("DashboardProcessSurface did not create a native host HWND.");

            SetPhase("starting first dedicated DashboardHost");
            using (var first = StartDashboardHost(server.Url, Path.Combine(root, "profile")))
            {
                var firstHandle = WaitForHandle(first, TimeSpan.FromSeconds(60));
                surface.AttachDashboardWindow(firstHandle);
                WaitForReady(first, TimeSpan.FromSeconds(15));
                PumpDispatcher(TimeSpan.FromSeconds(1));
                AssertWindowAlive(window, "after embedding the first dedicated DashboardHost");

                SetPhase("verifying cross-process Dashboard input focus");
                window.Activate();
                if (!surface.ActivateDashboardInput())
                    throw new InvalidOperationException("DashboardProcessSurface could not transfer focus to the dedicated host.");
                first.Process.StandardInput.WriteLine("focus");
                first.Process.StandardInput.Flush();
                _ = WaitForMessage(first, "FOCUS", TimeSpan.FromSeconds(10));
                AssertWindowAlive(window, "after transferring keyboard focus to DashboardHost");

                SetPhase("verifying same-WebView Access session continuity");
                first.Process.StandardInput.WriteLine("test-auth-flow");
                first.Process.StandardInput.Flush();
                var authStart = WaitForMessage(first, "AUTHMODE", TimeSpan.FromSeconds(15));
                RequirePayloadStartsWith(authStart, "start|");
                _ = WaitForMessage(first, "AUTHWINDOW", TimeSpan.FromSeconds(15));
                var authComplete = WaitForMessage(first, "AUTHMODE", TimeSpan.FromSeconds(15));
                RequirePayloadEquals(authComplete, "success");

                SetPhase("verifying automatic Dashboard input focus after authentication re-embed");
                _ = WaitForMessage(first, "FOCUS", TimeSpan.FromSeconds(10));
                PumpDispatcher(TimeSpan.FromSeconds(1));
                AssertWindowAlive(window, "after the same WebView completed Access cookie round-trip, re-embedded and automatically regained input focus");
                if (surface.DashboardHandle != firstHandle)
                    throw new InvalidOperationException("Authentication replaced the DashboardHost HWND instead of reusing the same window.");

                SetPhase("forcing dedicated DashboardHost process loss");
                first.Process.Kill(entireProcessTree: true);
                if (!first.Process.WaitForExit(10000))
                    throw new TimeoutException("The first dedicated DashboardHost did not terminate after Kill.");
                surface.DetachDashboardWindow();
                PumpDispatcher(TimeSpan.FromSeconds(1));
                AssertWindowAlive(window, "after forcibly terminating the dedicated DashboardHost");
                if (Process.GetCurrentProcess().HasExited)
                    throw new InvalidOperationException("The smoke-test primary process exited with DashboardHost.");
            }

            SetPhase("starting replacement dedicated DashboardHost");
            using (var second = StartDashboardHost(server.Url, Path.Combine(root, "profile")))
            {
                var secondHandle = WaitForHandle(second, TimeSpan.FromSeconds(60));
                surface.AttachDashboardWindow(secondHandle);
                WaitForReady(second, TimeSpan.FromSeconds(15));
                PumpDispatcher(TimeSpan.FromSeconds(1));
                AssertWindowAlive(window, "after embedding the replacement dedicated DashboardHost");

                SetPhase("verifying replacement Dashboard input focus");
                if (!surface.ActivateDashboardInput())
                    throw new InvalidOperationException("Replacement DashboardHost could not receive cross-process focus.");
                second.Process.StandardInput.WriteLine("focus");
                second.Process.StandardInput.Flush();
                _ = WaitForMessage(second, "FOCUS", TimeSpan.FromSeconds(10));

                SetPhase("shutting replacement dedicated DashboardHost down cleanly");
                second.Process.StandardInput.WriteLine("shutdown");
                second.Process.StandardInput.Flush();
                if (!second.Process.WaitForExit(10000))
                    throw new TimeoutException("The replacement dedicated DashboardHost did not shut down cleanly.");
                surface.DetachDashboardWindow();
                PumpDispatcher(TimeSpan.FromMilliseconds(500));
                AssertWindowAlive(window, "after clean dedicated DashboardHost shutdown");
            }

            SetPhase("closing smoke window");
            window.Close();
            PumpDispatcher(TimeSpan.FromMilliseconds(200));
            app.Shutdown(0);

            SetPhase("completed");
            Console.WriteLine(
                "PASS AtlasDesk.DashboardHost used one real WebView2 for a CF_Authorization cookie round-trip, detached and re-embedded the same HWND, automatically regained cross-process input focus after authentication, survived forced host termination in the primary WPF process, and restarted successfully");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("FAIL Dashboard process-isolation smoke during phase: " + _phase);
            Console.Error.WriteLine(ex);
            return 1;
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }

    private static DashboardHostProcess StartDashboardHost(string url, string profile)
    {
        Directory.CreateDirectory(profile);
        var assembly = typeof(DashboardHostMarker).Assembly.Location;
        if (string.IsNullOrWhiteSpace(assembly) || !File.Exists(assembly))
        {
            throw new FileNotFoundException(
                "AtlasDesk.DashboardHost managed assembly is unavailable for process-isolation smoke testing.",
                assembly);
        }

        var dotnet = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH");
        if (string.IsNullOrWhiteSpace(dotnet))
            dotnet = "dotnet";

        var info = new ProcessStartInfo(dotnet)
        {
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(assembly) ?? AppContext.BaseDirectory
        };
        info.Environment["ATLASDESK_DASHBOARD_PROXY"] = "direct";
        info.ArgumentList.Add(assembly);
        info.ArgumentList.Add("--dashboard-url");
        info.ArgumentList.Add(url);
        info.ArgumentList.Add("--dashboard-profile");
        info.ArgumentList.Add(profile);
        info.ArgumentList.Add("--parent-process");
        info.ArgumentList.Add(Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));

        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        var messages = new BlockingCollection<string>();
        var errors = new ConcurrentQueue<string>();
        process.OutputDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
                messages.Add(args.Data);
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
                errors.Enqueue(args.Data);
        };

        if (!process.Start())
            throw new InvalidOperationException("Dedicated DashboardHost smoke process did not start.");
        process.StandardInput.AutoFlush = true;
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        return new DashboardHostProcess(process, messages, errors);
    }

    private static IntPtr WaitForHandle(DashboardHostProcess host, TimeSpan timeout)
    {
        var line = WaitForMessage(host, "HWND", timeout);
        var parts = line.Split('|', 3);
        if (parts.Length != 3 || !long.TryParse(parts[2], out var raw) || raw == 0)
            throw new InvalidOperationException("DashboardHost returned an invalid HWND: " + line);
        return new IntPtr(raw);
    }

    private static void WaitForReady(DashboardHostProcess host, TimeSpan timeout)
        => _ = WaitForMessage(host, "READY", timeout);

    private static string WaitForMessage(DashboardHostProcess host, string kind, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            PumpDispatcher(TimeSpan.FromMilliseconds(40));
            if (host.Messages.TryTake(out var line, 40))
            {
                Console.WriteLine("DASHBOARD-HOST " + line);
                var parts = line.Split('|', 3);
                if (parts.Length == 3
                    && string.Equals(parts[0], ProtocolPrefix, StringComparison.Ordinal)
                    && string.Equals(parts[1], kind, StringComparison.Ordinal))
                {
                    return line;
                }
            }

            if (host.Process.HasExited)
            {
                var stderr = string.Join(" | ", host.Errors);
                throw new InvalidOperationException(
                    $"DashboardHost exited before {kind}; code={host.Process.ExitCode}; stderr={stderr}");
            }
        }

        throw new TimeoutException("Timed out waiting for DashboardHost protocol message: " + kind);
    }

    private static void RequirePayloadStartsWith(string line, string expectedPrefix)
    {
        var parts = line.Split('|', 3);
        if (parts.Length != 3 || !parts[2].StartsWith(expectedPrefix, StringComparison.Ordinal))
            throw new InvalidOperationException("Unexpected protocol payload: " + line);
    }

    private static void RequirePayloadEquals(string line, string expected)
    {
        var parts = line.Split('|', 3);
        if (parts.Length != 3 || !string.Equals(parts[2], expected, StringComparison.Ordinal))
            throw new InvalidOperationException("Unexpected protocol payload: " + line);
    }

    private static void AssertWindowAlive(Window window, string phase)
    {
        if (!window.IsLoaded || !window.IsVisible)
            throw new InvalidOperationException("Primary WPF window closed " + phase + ".");
    }

    private static void SetPhase(string value)
    {
        _phase = value;
        Console.WriteLine("DASHBOARD-ISOLATION " + value);
    }

    private static void PumpDispatcher(TimeSpan duration)
    {
        var frame = new DispatcherFrame();
        var timer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = duration
        };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            frame.Continue = false;
        };
        timer.Start();
        Dispatcher.PushFrame(frame);
    }

    private sealed class DashboardHostProcess : IDisposable
    {
        public DashboardHostProcess(
            Process process,
            BlockingCollection<string> messages,
            ConcurrentQueue<string> errors)
        {
            Process = process;
            Messages = messages;
            Errors = errors;
        }

        public Process Process { get; }
        public BlockingCollection<string> Messages { get; }
        public ConcurrentQueue<string> Errors { get; }

        public void Dispose()
        {
            try
            {
                if (!Process.HasExited)
                    Process.Kill(entireProcessTree: true);
            }
            catch { }
            try { Process.WaitForExit(3000); } catch { }
            Process.Dispose();
            Messages.Dispose();
        }
    }

    private sealed class LocalDashboardServer : IDisposable
    {
        private readonly TcpListener _listener;
        private readonly CancellationTokenSource _lifetime = new();
        private readonly Task _loop;

        private LocalDashboardServer(TcpListener listener)
        {
            _listener = listener;
            var endpoint = (IPEndPoint)_listener.LocalEndpoint;
            Url = $"http://127.0.0.1:{endpoint.Port}/";
            _loop = Task.Run(AcceptLoopAsync);
        }

        public string Url { get; }

        public static LocalDashboardServer Start()
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            return new LocalDashboardServer(listener);
        }

        private async Task AcceptLoopAsync()
        {
            while (!_lifetime.IsCancellationRequested)
            {
                TcpClient client;
                try { client = await _listener.AcceptTcpClientAsync(_lifetime.Token); }
                catch (OperationCanceledException) { return; }
                catch (ObjectDisposedException) { return; }

                _ = Task.Run(() => RespondAsync(client));
            }
        }

        private static async Task RespondAsync(TcpClient client)
        {
            using (client)
            await using (var stream = client.GetStream())
            {
                var requestBuffer = new byte[8192];
                int read;
                try { read = await stream.ReadAsync(requestBuffer); } catch { return; }
                var request = Encoding.ASCII.GetString(requestBuffer, 0, Math.Max(0, read));
                var firstLine = request.Split(new[] { "\r\n" }, StringSplitOptions.None).FirstOrDefault() ?? string.Empty;
                var parts = firstLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var path = parts.Length > 1 ? parts[1] : "/";

                if (path.StartsWith("/cdn-cgi/access/login", StringComparison.OrdinalIgnoreCase))
                {
                    var redirect = Encoding.ASCII.GetBytes(
                        "HTTP/1.1 302 Found\r\n"
                        + "Location: /\r\n"
                        + "Set-Cookie: CF_Authorization=smoke-session; Path=/; HttpOnly\r\n"
                        + "Content-Length: 0\r\n"
                        + "Connection: close\r\n\r\n");
                    try
                    {
                        await stream.WriteAsync(redirect);
                        await stream.FlushAsync();
                    }
                    catch { }
                    return;
                }

                const string html = "<!doctype html><html><head><meta charset='utf-8'><title>AtlasDesk Isolation Test</title></head><body><input id='focus' autofocus aria-label='focus test'><button id='overview'>主页概览</button><script>document.getElementById('overview').addEventListener('click',()=>document.body.dataset.clicked='1');</script></body></html>";
                var body = Encoding.UTF8.GetBytes(html);
                var headers = Encoding.ASCII.GetBytes(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: "
                    + body.Length
                    + "\r\nConnection: close\r\n\r\n");
                try
                {
                    await stream.WriteAsync(headers);
                    await stream.WriteAsync(body);
                    await stream.FlushAsync();
                }
                catch { }
            }
        }

        public void Dispose()
        {
            _lifetime.Cancel();
            _listener.Stop();
            try { _loop.Wait(2000); } catch { }
            _lifetime.Dispose();
        }
    }
}
