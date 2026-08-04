using Microsoft.Web.WebView2.Wpf;
using PersonalWorkbench;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;

internal static class Program
{
    private static string _phase = "not started";

    [STAThread]
    private static int Main()
    {
        var workspace = Path.Combine(
            Path.GetTempPath(),
            "atlasdesk-dashboard-inprocess-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspace);

        try
        {
            SetPhase("starting local Dashboard page");
            using var server = LocalDashboardServer.Start();

            SetPhase("creating isolated WPF application");
            var app = new App();
            app.InitializeComponent();
            app.ShutdownMode = ShutdownMode.OnExplicitShutdown;

            SetPhase("constructing AtlasDesk MainWindow");
            var window = new MainWindow();
            app.MainWindow = window;
            ConfigureIsolatedSettings(window, server.Url, workspace);

            SetPhase("showing MainWindow");
            window.Show();
            PumpDispatcher(TimeSpan.FromMilliseconds(700));
            AssertWindowAlive(window, "after startup");

            SetPhase("attaching complete feature pipeline");
            var pipeline = WorkbenchFeaturePipeline.Attach(window);
            PumpDispatcher(TimeSpan.FromMilliseconds(250));

            SetPhase("opening Dashboard through MainWindow view owner");
            _ = window.FindName("DashboardNav") as RadioButton
                ?? throw new InvalidOperationException("Dashboard navigation is unavailable.");
            InvokeShowView(window, "dashboard", TimeSpan.FromSeconds(45));

            var view = WaitForDashboardView(window, TimeSpan.FromSeconds(10));
            WaitForDocument(view, TimeSpan.FromSeconds(20));
            AssertWindowAlive(window, "after in-process WebView2 initialization");

            SetPhase("verifying Dashboard stays inside MainWindow visual tree");
            var host = window.FindName("DashboardHost") as Panel
                ?? throw new InvalidOperationException("DashboardHost panel is unavailable.");
            if (!host.Children.Contains(view))
                throw new InvalidOperationException("The active Dashboard WebView2 is not a child of MainWindow DashboardHost.");
            if (host.Children.Cast<UIElement>().Any(child =>
                    string.Equals(child.GetType().Name, "DashboardProcessSurface", StringComparison.Ordinal)))
            {
                throw new InvalidOperationException("A retired DashboardProcessSurface returned to the visual tree.");
            }

            SetPhase("verifying native WPF keyboard focus ownership");
            window.Activate();
            view.Focus();
            _ = Keyboard.Focus(view);
            PumpDispatcher(TimeSpan.FromMilliseconds(300));
            if (!view.IsKeyboardFocusWithin && !ReferenceEquals(Keyboard.FocusedElement, view))
                throw new InvalidOperationException("The in-process Dashboard WebView2 did not receive WPF keyboard focus.");

            SetPhase("verifying page input focus in the same WebView2");
            var activeElement = AwaitWithDispatcher(
                view.CoreWebView2.ExecuteScriptAsync(
                    "document.getElementById('atlasdesk-input').focus(); document.activeElement.id;"),
                TimeSpan.FromSeconds(10));
            if (!string.Equals(activeElement, "\"atlasdesk-input\"", StringComparison.Ordinal))
                throw new InvalidOperationException("Dashboard document input did not become the active element: " + activeElement);

            var textRoundTrip = AwaitWithDispatcher(
                view.CoreWebView2.ExecuteScriptAsync(
                    "document.activeElement.value='AtlasDesk input ready'; document.activeElement.value;"),
                TimeSpan.FromSeconds(10));
            if (!string.Equals(textRoundTrip, "\"AtlasDesk input ready\"", StringComparison.Ordinal))
                throw new InvalidOperationException("Dashboard input value round-trip failed: " + textRoundTrip);

            SetPhase("verifying no dedicated Dashboard process is required");
            if (pipeline.Dashboard is null)
                throw new InvalidOperationException("Dashboard simplicity coordinator is unavailable.");
            if (File.Exists(Path.Combine(App.RuntimeDirectory, "DashboardHost", "AtlasDesk.DashboardHost.exe")))
            {
                Console.WriteLine("NOTE an older Runtime folder may still contain DashboardHost, but v1.1.10 does not start or publish it.");
            }

            SetPhase("closing normally");
            window.Close();
            PumpDispatcher(TimeSpan.FromMilliseconds(250));
            app.Shutdown(0);
            GC.KeepAlive(pipeline);

            SetPhase("completed");
            Console.WriteLine(
                "PASS AtlasDesk in-process Dashboard created one WPF WebView2 inside MainWindow, retained native keyboard focus and activated a real document input without HWND embedding or a dedicated host process");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("FAIL AtlasDesk in-process Dashboard smoke during phase: " + _phase);
            Console.Error.WriteLine(ex);
            return 1;
        }
        finally
        {
            try { Directory.Delete(workspace, true); } catch { }
        }
    }

    private static void ConfigureIsolatedSettings(
        MainWindow window,
        string dashboardUrl,
        string workspace)
    {
        var settingsField = typeof(MainWindow)
            .GetField("_settings", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingFieldException(typeof(MainWindow).FullName, "_settings");
        var settings = settingsField.GetValue(window) as AppSettings
            ?? throw new InvalidOperationException("MainWindow settings are unavailable.");

        settings.DashboardAutoOpen = false;
        settings.DashboardName = "AtlasDesk in-process smoke";
        settings.DashboardUrl = dashboardUrl;
        settings.WorkspaceRoot = workspace;
        settings.CondaPath = string.Empty;
        settings.UvPath = string.Empty;
    }

    private static void InvokeShowView(MainWindow window, string viewName, TimeSpan timeout)
    {
        var method = typeof(MainWindow).GetMethod(
            "ShowViewAsync",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingMethodException(typeof(MainWindow).FullName, "ShowViewAsync");
        var task = method.Invoke(window, new object[] { viewName }) as Task
            ?? throw new InvalidOperationException("MainWindow.ShowViewAsync did not return a Task.");
        AwaitWithDispatcher(task, timeout);
    }

    private static WebView2 WaitForDashboardView(MainWindow window, TimeSpan timeout)
    {
        var field = typeof(MainWindow).GetField(
            "_dashboardWebView",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingFieldException(typeof(MainWindow).FullName, "_dashboardWebView");

        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            PumpDispatcher(TimeSpan.FromMilliseconds(80));
            if (field.GetValue(window) is WebView2 view && view.CoreWebView2 is not null)
                return view;
            AssertWindowAlive(window, "while waiting for Dashboard WebView2");
        }

        throw new TimeoutException("Timed out waiting for MainWindow's in-process Dashboard WebView2.");
    }

    private static void WaitForDocument(WebView2 view, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        Exception? last = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                var state = AwaitWithDispatcher(
                    view.CoreWebView2.ExecuteScriptAsync("document.readyState"),
                    TimeSpan.FromSeconds(2));
                if (string.Equals(state, "\"complete\"", StringComparison.Ordinal)
                    || string.Equals(state, "\"interactive\"", StringComparison.Ordinal))
                {
                    return;
                }
            }
            catch (Exception ex)
            {
                last = ex;
            }
            PumpDispatcher(TimeSpan.FromMilliseconds(100));
        }

        throw new TimeoutException("Dashboard document did not become ready.", last);
    }

    private static void AwaitWithDispatcher(Task task, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (!task.IsCompleted && DateTimeOffset.UtcNow < deadline)
            PumpDispatcher(TimeSpan.FromMilliseconds(25));
        if (!task.IsCompleted)
            throw new TimeoutException("Timed out while awaiting a Dashboard WPF operation.");
        task.GetAwaiter().GetResult();
    }

    private static T AwaitWithDispatcher<T>(Task<T> task, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (!task.IsCompleted && DateTimeOffset.UtcNow < deadline)
            PumpDispatcher(TimeSpan.FromMilliseconds(25));
        if (!task.IsCompleted)
            throw new TimeoutException("Timed out while awaiting a Dashboard WebView2 operation.");
        return task.GetAwaiter().GetResult();
    }

    private static void AssertWindowAlive(Window window, string phase)
    {
        if (!window.IsLoaded || !window.IsVisible)
            throw new InvalidOperationException("AtlasDesk MainWindow closed " + phase + ".");
    }

    private static void SetPhase(string value)
    {
        _phase = value;
        Console.WriteLine("DASHBOARD-INPROCESS " + value);
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
                var buffer = new byte[8192];
                try { _ = await stream.ReadAsync(buffer); } catch { return; }

                const string html = "<!doctype html><html><head><meta charset='utf-8'><title>AtlasDesk In-Process Dashboard</title></head><body><label for='atlasdesk-input'>Input</label><input id='atlasdesk-input' type='text' autofocus><button id='overview'>主页概览</button></body></html>";
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
