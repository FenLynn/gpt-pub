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

            SetPhase("verifying compact adaptive layout");
            AssertAdaptiveLayout(window, 1100, 700, UiDensityMode.Compact, 2);

            SetPhase("verifying standard adaptive layout");
            AssertAdaptiveLayout(window, 1320, 780, UiDensityMode.Standard, 4);

            SetPhase("verifying spacious adaptive layout");
            AssertAdaptiveLayout(window, 1500, 860, UiDensityMode.Spacious, 4);

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
                "PASS AtlasDesk isolated process remained alive, adaptive modes converged and environment discovery stayed lazy");
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

    private static void AssertAdaptiveLayout(
        MainWindow window,
        double width,
        double height,
        UiDensityMode expectedMode,
        int expectedMetricColumns)
    {
        window.WindowState = WindowState.Normal;
        window.Width = width;
        window.Height = height;
        PumpDispatcher(TimeSpan.FromMilliseconds(450));
        window.UpdateLayout();
        PumpDispatcher(TimeSpan.FromMilliseconds(180));
        AssertWindowAlive(window, $"after resizing to {width:0}x{height:0}");

        var snapshot = UiAdaptiveAuditService.Current
            ?? throw new InvalidOperationException("UI adaptive audit did not publish a snapshot.");
        if (snapshot.Mode != expectedMode)
        {
            throw new InvalidOperationException(
                $"Adaptive mode mismatch at {width:0}x{height:0}: expected {expectedMode}, got {snapshot.Mode}.");
        }
        if (snapshot.ContentWidth <= 0 || snapshot.ContentHeight <= 0 || snapshot.DpiScale <= 0)
            throw new InvalidOperationException("UI adaptive audit published invalid geometry or DPI.");

        var home = FindVisualChild<HomeDashboardControl>(window)
            ?? throw new InvalidOperationException("Home dashboard is unavailable during adaptive residency.");
        var metrics = FindVisualChild<UniformGrid>(home)
            ?? throw new InvalidOperationException("Home metric grid is unavailable during adaptive residency.");
        if (metrics.Columns != expectedMetricColumns)
        {
            throw new InvalidOperationException(
                $"Home metric columns mismatch in {expectedMode}: expected {expectedMetricColumns}, got {metrics.Columns}.");
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
