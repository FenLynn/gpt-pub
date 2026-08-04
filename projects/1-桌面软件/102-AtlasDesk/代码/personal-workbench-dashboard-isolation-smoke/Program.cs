using Microsoft.Web.WebView2.Wpf;
using PersonalWorkbench;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;

internal static class Program
{
    private const uint InputKeyboard = 1;
    private const uint KeyEventUnicode = 0x0004;
    private const uint KeyEventKeyUp = 0x0002;
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
            ConfigureIsolatedSettings(server.Url, workspace);

            SetPhase("creating real AtlasDesk WPF application");
            var app = new App();
            app.InitializeComponent();
            app.ShutdownMode = ShutdownMode.OnExplicitShutdown;

            Exception? failure = null;
            var completed = false;
            var scheduled = false;
            var watchdog = new DispatcherTimer(DispatcherPriority.Send)
            {
                Interval = TimeSpan.FromSeconds(90)
            };
            watchdog.Tick += (_, _) =>
            {
                watchdog.Stop();
                failure ??= new TimeoutException("The real AtlasDesk Dashboard verification exceeded 90 seconds during: " + _phase);
                app.Shutdown(1);
            };

            app.Activated += (_, _) =>
            {
                if (scheduled)
                    return;
                scheduled = true;
                watchdog.Start();
                _ = app.Dispatcher.BeginInvoke(
                    DispatcherPriority.ApplicationIdle,
                    new Action(async () =>
                    {
                        try
                        {
                            await VerifyDashboardAsync(app);
                            completed = true;
                        }
                        catch (Exception ex)
                        {
                            failure = ex;
                        }
                        finally
                        {
                            watchdog.Stop();
                            app.Shutdown(failure is null ? 0 : 1);
                        }
                    }));
            };

            SetPhase("starting real WPF Application.Run event loop");
            var exitCode = app.Run();
            if (failure is not null)
                throw new InvalidOperationException("Real AtlasDesk Dashboard verification failed.", failure);
            if (!completed || exitCode != 0)
                throw new InvalidOperationException($"Real AtlasDesk Dashboard verification ended incompletely; completed={completed}; exitCode={exitCode}.");

            SetPhase("completed");
            Console.WriteLine(
                "PASS AtlasDesk in-process Dashboard created one WPF WebView2 inside the real MainWindow event loop and accepted real Unicode keyboard input without HWND embedding or a dedicated host process");
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

    private static void ConfigureIsolatedSettings(string dashboardUrl, string workspace)
    {
        var settings = AppSettings.Load();
        settings.DashboardAutoOpen = false;
        settings.DashboardName = "AtlasDesk in-process smoke";
        settings.DashboardUrl = dashboardUrl;
        settings.WorkspaceRoot = workspace;
        settings.CondaPath = string.Empty;
        settings.UvPath = string.Empty;
        settings.Save();
    }

    private static async Task VerifyDashboardAsync(App app)
    {
        SetPhase("waiting for StartupUri MainWindow");
        var window = await WaitForMainWindowAsync(app, TimeSpan.FromSeconds(15));
        AssertWindowAlive(window, "after StartupUri startup");

        SetPhase("waiting for the complete production feature pipeline");
        var pipeline = await WaitForPipelineAsync(app, TimeSpan.FromSeconds(15));
        if (pipeline.Dashboard is null)
            throw new InvalidOperationException("Dashboard simplicity coordinator is unavailable.");

        SetPhase("opening Dashboard through MainWindow view owner");
        _ = window.FindName("DashboardNav") as RadioButton
            ?? throw new InvalidOperationException("Dashboard navigation is unavailable.");
        await InvokeShowViewAsync(window, "dashboard");

        var view = await WaitForDashboardViewAsync(window, TimeSpan.FromSeconds(45));
        await WaitForDocumentAsync(view, TimeSpan.FromSeconds(20));
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

        SetPhase("activating real WebView2 input target");
        window.Activate();
        _ = SetForegroundWindow(new WindowInteropHelper(window).Handle);
        view.Focus();
        _ = Keyboard.Focus(view);
        await Dispatcher.Yield(DispatcherPriority.Input);
        await Task.Delay(200);

        var activeElement = await view.CoreWebView2.ExecuteScriptAsync(
            "const input=document.getElementById('atlasdesk-input'); input.value=''; input.focus(); document.activeElement.id;");
        if (!string.Equals(activeElement, "\"atlasdesk-input\"", StringComparison.Ordinal))
            throw new InvalidOperationException("Dashboard document input did not become the active element: " + activeElement);

        SetPhase("sending real Unicode keyboard input to WebView2");
        const string expectedInput = "AtlasDesk physical input";
        SendUnicodeText(expectedInput);
        await Task.Delay(350);
        var physicalInput = await view.CoreWebView2.ExecuteScriptAsync("document.activeElement.value;");
        if (!string.Equals(physicalInput, "\"" + expectedInput + "\"", StringComparison.Ordinal))
            throw new InvalidOperationException("Dashboard did not receive real keyboard input: " + physicalInput);

        SetPhase("verifying no dedicated Dashboard process is required");
        if (File.Exists(Path.Combine(App.RuntimeDirectory, "DashboardHost", "AtlasDesk.DashboardHost.exe")))
        {
            Console.WriteLine("NOTE an older local Runtime may still contain DashboardHost, but v1.1.10 does not start or publish it.");
        }

        SetPhase("closing real MainWindow normally");
        window.Close();
        await Dispatcher.Yield(DispatcherPriority.ApplicationIdle);
        GC.KeepAlive(pipeline);
    }

    private static void SendUnicodeText(string text)
    {
        var inputs = new List<NativeInput>(text.Length * 2);
        foreach (var character in text)
        {
            inputs.Add(CreateUnicodeInput(character, keyUp: false));
            inputs.Add(CreateUnicodeInput(character, keyUp: true));
        }

        var sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<NativeInput>());
        if (sent != inputs.Count)
        {
            throw new InvalidOperationException(
                $"SendInput delivered {sent} of {inputs.Count} keyboard events; Win32={Marshal.GetLastWin32Error()}.");
        }
    }

    private static NativeInput CreateUnicodeInput(char character, bool keyUp)
        => new()
        {
            Type = InputKeyboard,
            Data = new InputUnion
            {
                Keyboard = new KeyboardInput
                {
                    VirtualKey = 0,
                    ScanCode = character,
                    Flags = KeyEventUnicode | (keyUp ? KeyEventKeyUp : 0),
                    Time = 0,
                    ExtraInfo = UIntPtr.Zero
                }
            }
        };

    private static async Task<MainWindow> WaitForMainWindowAsync(App app, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (app.MainWindow is MainWindow window && window.IsLoaded && window.IsVisible)
                return window;
            await Task.Delay(50);
        }
        throw new TimeoutException("Timed out waiting for the real StartupUri MainWindow.");
    }

    private static async Task<WorkbenchFeaturePipeline> WaitForPipelineAsync(App app, TimeSpan timeout)
    {
        var field = typeof(App).GetField("_pipeline", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingFieldException(typeof(App).FullName, "_pipeline");
        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (field.GetValue(app) is WorkbenchFeaturePipeline pipeline)
                return pipeline;
            await Task.Delay(50);
        }
        throw new TimeoutException("Timed out waiting for the production WorkbenchFeaturePipeline.");
    }

    private static async Task InvokeShowViewAsync(MainWindow window, string viewName)
    {
        var method = typeof(MainWindow).GetMethod(
            "ShowViewAsync",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingMethodException(typeof(MainWindow).FullName, "ShowViewAsync");
        var task = method.Invoke(window, new object[] { viewName }) as Task
            ?? throw new InvalidOperationException("MainWindow.ShowViewAsync did not return a Task.");
        await task;
    }

    private static async Task<WebView2> WaitForDashboardViewAsync(MainWindow window, TimeSpan timeout)
    {
        var field = typeof(MainWindow).GetField(
            "_dashboardWebView",
            BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new MissingFieldException(typeof(MainWindow).FullName, "_dashboardWebView");

        var deadline = DateTimeOffset.UtcNow + timeout;
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (field.GetValue(window) is WebView2 view && view.CoreWebView2 is not null)
                return view;
            AssertWindowAlive(window, "while waiting for Dashboard WebView2");
            await Task.Delay(80);
        }

        throw new TimeoutException(
            "Timed out waiting for MainWindow's in-process Dashboard WebView2. "
            + DescribeDashboardState(window));
    }

    private static string DescribeDashboardState(MainWindow window)
    {
        var type = typeof(MainWindow);
        object? Read(string name) => type.GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(window);
        var settings = Read("_settings") as AppSettings;
        var errorText = (window.FindName("DashboardErrorText") as TextBlock)?.Text ?? "<missing>";
        return $"url={settings?.DashboardUrl}; currentView={Read("_currentView")}; "
               + $"initializing={Read("_isInitializingDashboard")}; recovery={Read("_dashboardRecoveryInProgress")}; "
               + $"environment={(Read("_webViewEnvironment") is null ? "null" : "ready")}; errorText={errorText}";
    }

    private static async Task WaitForDocumentAsync(WebView2 view, TimeSpan timeout)
    {
        var deadline = DateTimeOffset.UtcNow + timeout;
        Exception? last = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                var state = await view.CoreWebView2.ExecuteScriptAsync("document.readyState");
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
            await Task.Delay(100);
        }
        throw new TimeoutException("Dashboard document did not become ready.", last);
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

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeInput
    {
        public uint Type;
        public InputUnion Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public KeyboardInput Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint inputCount, NativeInput[] inputs, int inputSize);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr windowHandle);

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
