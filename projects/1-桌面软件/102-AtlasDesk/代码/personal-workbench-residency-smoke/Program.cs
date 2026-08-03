using PersonalWorkbench;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Threading;

internal static class Program
{
    private static string _phase = "not started";

    [STAThread]
    private static int Main()
    {
        var workspace = Path.Combine(
            Path.GetTempPath(),
            "atlasdesk-residency-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(workspace);

        try
        {
            SetPhase("creating isolated WPF application");
            var app = new App();
            app.InitializeComponent();
            app.ShutdownMode = ShutdownMode.OnExplicitShutdown;

            SetPhase("constructing main window");
            var window = new MainWindow();
            ConfigureIsolatedSettings(window, workspace);

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

            SetPhase("holding normal startup for ten seconds");
            PumpDispatcher(TimeSpan.FromSeconds(10));
            AssertWindowAlive(window, "after ten-second startup residency");
            AssertEnvironmentIdle(development, busyField,
                "environment discovery started during normal startup");

            SetPhase("opening explicit home surface");
            if (window.FindName("HomeNav") is not RadioButton homeNav)
                throw new InvalidOperationException("Home navigation button is unavailable.");
            homeNav.IsChecked = true;
            PumpDispatcher(TimeSpan.FromMilliseconds(350));
            if (!pipeline.Experience.Home.IsLoaded)
                throw new InvalidOperationException("Explicit home surface did not load.");

            SetPhase("verifying physical compact adaptive layout");
            AssertPhysicalCompactLayout(window, pipeline.Experience.Home);

            SetPhase("verifying detached standard adaptive layout");
            AssertDetachedHomeLayout(pipeline.Settings, 1320, 780, UiDensityMode.Standard, 4);

            SetPhase("verifying detached spacious adaptive layout");
            AssertDetachedHomeLayout(pipeline.Settings, 1500, 860, UiDensityMode.Spacious, 4);

            SetPhase("opening converged diagnostics window");
            var diagnostics = new DiagnosticsWindow(pipeline.Settings) { Owner = window };
            diagnostics.Show();
            PumpDispatcher(TimeSpan.FromMilliseconds(700));
            AssertWindowAlive(diagnostics, "after opening converged diagnostics");
            diagnostics.Close();
            PumpDispatcher(TimeSpan.FromMilliseconds(150));

            SetPhase("opening Development project tab");
            if (window.FindName("DevelopmentNav") is not RadioButton developmentNav)
                throw new InvalidOperationException("Development navigation button is unavailable.");
            developmentNav.IsChecked = true;
            PumpDispatcher(TimeSpan.FromSeconds(2));
            AssertWindowAlive(window, "after opening Development project tab");
            AssertEnvironmentIdle(development, busyField,
                "opening Development project tab started environment discovery");

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

            SetPhase("closing normally");
            GC.KeepAlive(pipeline);
            window.Close();
            PumpDispatcher(TimeSpan.FromMilliseconds(250));
            app.Shutdown(0);

            SetPhase("completed");
            Console.WriteLine(
                "PASS AtlasDesk isolated process remained alive, compact top-level and detached wide layouts converged, and environment discovery stayed lazy");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(
                "FAIL AtlasDesk isolated startup residency during phase: " + _phase);
            Console.Error.WriteLine(ex);
            return 1;
        }
        finally
        {
            try { Directory.Delete(workspace, true); } catch { }
        }
    }

    private static void ConfigureIsolatedSettings(MainWindow window, string workspace)
    {
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
    }

    private static DevelopmentControl ReadDevelopmentControl(WorkbenchFeaturePipeline pipeline)
    {
        return pipeline.Base.GetType()
                   .GetField("_development", BindingFlags.Instance | BindingFlags.NonPublic)
                   ?.GetValue(pipeline.Base) as DevelopmentControl
               ?? throw new InvalidOperationException("DevelopmentControl is unavailable.");
    }

    private static void AssertPhysicalCompactLayout(
        MainWindow window,
        HomeDashboardControl home)
    {
        window.WindowState = WindowState.Normal;
        window.Width = 1100;
        window.Height = 700;
        PumpDispatcher(TimeSpan.FromMilliseconds(500));
        window.UpdateLayout();
        PumpDispatcher(TimeSpan.FromMilliseconds(150));
        AssertWindowAlive(window, "after compact physical resize");

        var snapshot = UiAdaptiveAuditService.Current
            ?? throw new InvalidOperationException("UI adaptive audit did not publish a physical snapshot.");
        var metrics = FindVisualChild<UniformGrid>(home)
            ?? throw new InvalidOperationException("Home metric grid is unavailable in physical compact layout.");
        if (snapshot.Mode != UiDensityMode.Compact || metrics.Columns != 2)
        {
            throw new InvalidOperationException(
                $"Physical compact layout mismatch: window={window.ActualWidth:0}x{window.ActualHeight:0}; "
                + $"snapshot={snapshot.WindowWidth:0}x{snapshot.WindowHeight:0}/{snapshot.Mode}; "
                + $"metricColumns={metrics.Columns}.");
        }
        if (snapshot.ContentWidth <= 0 || snapshot.ContentHeight <= 0 || snapshot.DpiScale <= 0)
            throw new InvalidOperationException("Physical compact audit published invalid geometry or DPI.");
    }

    private static void AssertDetachedHomeLayout(
        AppSettings settings,
        double width,
        double height,
        UiDensityMode expectedMode,
        int expectedMetricColumns)
    {
        var resolveMode = typeof(UiConvergenceCoordinator).GetMethod(
            "ResolveMode",
            BindingFlags.Static | BindingFlags.NonPublic)
            ?? throw new MissingMethodException(typeof(UiConvergenceCoordinator).FullName, "ResolveMode");
        var applyHome = typeof(UiConvergenceCoordinator).GetMethod(
            "ApplyHome",
            BindingFlags.Static | BindingFlags.NonPublic)
            ?? throw new MissingMethodException(typeof(UiConvergenceCoordinator).FullName, "ApplyHome");

        var resolvedMode = (UiDensityMode)(resolveMode.Invoke(null, new object[] { width, height })
            ?? throw new InvalidOperationException("ResolveMode returned no value."));
        if (resolvedMode != expectedMode)
            throw new InvalidOperationException($"Detached mode mismatch: expected {expectedMode}, got {resolvedMode}.");

        var home = new HomeDashboardControl(settings)
        {
            Width = width,
            Height = height
        };
        home.Measure(new Size(width, height));
        home.Arrange(new Rect(0, 0, width, height));
        home.UpdateLayout();
        applyHome.Invoke(null, new object[] { home, resolvedMode });
        home.Measure(new Size(width, height));
        home.Arrange(new Rect(0, 0, width, height));
        home.UpdateLayout();

        var metrics = FindVisualChild<UniformGrid>(home)
            ?? throw new InvalidOperationException("Detached home metric grid is unavailable.");
        if (metrics.Columns != expectedMetricColumns)
        {
            throw new InvalidOperationException(
                $"Detached home columns mismatch at {width:0}x{height:0}: "
                + $"expected {expectedMetricColumns}, got {metrics.Columns}.");
        }
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
            throw new InvalidOperationException("AtlasDesk window closed " + phase + ".");
    }

    private static void SetPhase(string value)
    {
        _phase = value;
        Console.WriteLine("RESIDENCY " + value);
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
