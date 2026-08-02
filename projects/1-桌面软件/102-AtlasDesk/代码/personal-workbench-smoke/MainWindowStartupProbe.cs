using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;

namespace PersonalWorkbench.Smoke;

internal static class MainWindowStartupProbe
{
    private static string _phase = "scheduled";

    [ModuleInitializer]
    internal static void Start()
    {
        // Never wait for this thread from the module initializer. The worker may
        // execute code from this assembly only after the initializer returns and
        // releases the CLR module-initialization lock.
        var thread = new Thread(RunProbe)
        {
            IsBackground = false,
            Name = "AtlasDesk.MainWindowStartupProbe"
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
    }

    private static void RunProbe()
    {
        var workspace = Path.Combine(
            Path.GetTempPath(),
            "atlasdesk-startup-probe-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspace);

        using var watchdog = new Timer(
            _ => Environment.FailFast(
                "AtlasDesk startup residency probe exceeded 30 seconds. Last phase: "
                + Volatile.Read(ref _phase)),
            null,
            TimeSpan.FromSeconds(30),
            Timeout.InfiniteTimeSpan);

        try
        {
            SetPhase("creating WPF application");
            var app = new App();
            app.InitializeComponent();

            SetPhase("constructing main window");
            var window = new MainWindow();
            var settingsField = typeof(MainWindow)
                .GetField("_settings", BindingFlags.Instance | BindingFlags.NonPublic)
                ?? throw new MissingFieldException(typeof(MainWindow).FullName, "_settings");
            var settings = settingsField.GetValue(window) as AppSettings
                ?? throw new InvalidOperationException("MainWindow settings are unavailable.");
            settings.DashboardAutoOpen = false;
            settings.DashboardUrl = string.Empty;
            settings.WorkspaceRoot = workspace;
            settings.CondaPath = string.Empty;
            settings.UvPath = string.Empty;

            SetPhase("attaching complete feature pipeline");
            var pipeline = WorkbenchFeaturePipeline.Attach(window);
            var development = ReadDevelopmentControl(pipeline);
            var busyField = typeof(DevelopmentControl)
                .GetField("_busy", BindingFlags.Instance | BindingFlags.NonPublic)
                ?? throw new MissingFieldException(typeof(DevelopmentControl).FullName, "_busy");

            SetPhase("showing main window");
            window.Show();
            PumpDispatcher(TimeSpan.FromSeconds(1));
            AssertWindowAlive(window, "immediately after startup");

            SetPhase("holding startup window without opening Development");
            PumpDispatcher(TimeSpan.FromSeconds(10));
            AssertWindowAlive(window, "after ten-second startup residency");
            AssertEnvironmentIdle(development, busyField,
                "environment discovery started during normal startup");

            SetPhase("opening Development project tab");
            if (window.FindName("DevelopmentNav") is not RadioButton developmentNav)
                throw new InvalidOperationException("Development navigation button is unavailable.");
            developmentNav.IsChecked = true;
            PumpDispatcher(TimeSpan.FromSeconds(2));
            AssertWindowAlive(window, "after opening Development project tab");
            AssertEnvironmentIdle(development, busyField,
                "opening the Development project tab started environment discovery");

            SetPhase("verifying three-tab development surface");
            if (window.FindName("DevelopmentView") is not DependencyObject developmentHost)
                throw new InvalidOperationException("Development host is unavailable.");
            var tabs = FindVisualChild<TabControl>(developmentHost)
                ?? throw new InvalidOperationException("Development tab control is unavailable.");
            if (tabs.Items.Count < 3 || tabs.SelectedIndex != 0)
            {
                throw new InvalidOperationException(
                    "Development project/environment/terminal tab state is invalid.");
            }

            SetPhase("closing main window normally");
            GC.KeepAlive(pipeline);
            window.Close();
            PumpDispatcher(TimeSpan.FromMilliseconds(250));
            SetPhase("completed");
            Console.WriteLine(
                "PASS AtlasDesk MainWindow remains alive and environment discovery stays lazy during startup");
        }
        catch (Exception ex)
        {
            Environment.FailFast(
                "AtlasDesk startup residency probe failed during phase: "
                + Volatile.Read(ref _phase),
                ex);
        }
        finally
        {
            try { Directory.Delete(workspace, true); } catch { }
            Dispatcher.CurrentDispatcher.InvokeShutdown();
        }
    }

    private static void SetPhase(string value)
    {
        Volatile.Write(ref _phase, value);
        Console.WriteLine("PROBE " + value);
    }

    private static DevelopmentControl ReadDevelopmentControl(WorkbenchFeaturePipeline pipeline)
    {
        return pipeline.Base.GetType()
                   .GetField("_development", BindingFlags.Instance | BindingFlags.NonPublic)
                   ?.GetValue(pipeline.Base) as DevelopmentControl
               ?? throw new InvalidOperationException("DevelopmentControl is unavailable.");
    }

    private static void AssertEnvironmentIdle(
        DevelopmentControl development,
        FieldInfo busyField,
        string message)
    {
        if (busyField.GetValue(development) is true)
            throw new InvalidOperationException(message);
    }

    private static void AssertWindowAlive(Window window, string phase)
    {
        if (!window.IsLoaded || !window.IsVisible)
            throw new InvalidOperationException("AtlasDesk main window closed " + phase + ".");
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

    private static T? FindVisualChild<T>(DependencyObject root) where T : DependencyObject
    {
        for (var index = 0; index < VisualTreeHelper.GetChildrenCount(root); index++)
        {
            var child = VisualTreeHelper.GetChild(root, index);
            if (child is T match)
                return match;
            var nested = FindVisualChild<T>(child);
            if (nested is not null)
                return nested;
        }
        return null;
    }
}
