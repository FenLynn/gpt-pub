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
    [ModuleInitializer]
    internal static void Verify()
    {
        Exception? failure = null;
        using var completed = new ManualResetEventSlim(false);

        var thread = new Thread(() =>
        {
            var workspace = Path.Combine(Path.GetTempPath(), "atlasdesk-startup-probe-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(workspace);
            try
            {
                var app = new App();
                app.InitializeComponent();

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

                var pipeline = WorkbenchFeaturePipeline.Attach(window);
                window.Show();
                PumpDispatcher(TimeSpan.FromSeconds(1));

                if (!window.IsLoaded || !window.IsVisible)
                    throw new InvalidOperationException("AtlasDesk main window did not remain visible after startup.");

                if (window.FindName("DevelopmentNav") is not RadioButton developmentNav)
                    throw new InvalidOperationException("Development navigation button is unavailable.");
                developmentNav.IsChecked = true;
                PumpDispatcher(TimeSpan.FromSeconds(1));

                if (window.FindName("DevelopmentView") is not DependencyObject developmentHost)
                    throw new InvalidOperationException("Development host is unavailable.");
                var tabs = FindVisualChild<TabControl>(developmentHost)
                    ?? throw new InvalidOperationException("Development tab control is unavailable.");
                if (tabs.Items.Count < 3)
                    throw new InvalidOperationException("Development project/environment/terminal tabs are incomplete.");

                tabs.SelectedIndex = 1;
                PumpDispatcher(TimeSpan.FromSeconds(8));

                GC.KeepAlive(pipeline);
                if (!window.IsLoaded || !window.IsVisible)
                    throw new InvalidOperationException(
                        "AtlasDesk main window closed while the Environment tab was active.");

                window.Close();
                PumpDispatcher(TimeSpan.FromMilliseconds(250));
            }
            catch (Exception ex)
            {
                failure = ex;
            }
            finally
            {
                try { Directory.Delete(workspace, true); } catch { }
                completed.Set();
                Dispatcher.CurrentDispatcher.InvokeShutdown();
            }
        })
        {
            IsBackground = true,
            Name = "AtlasDesk.MainWindowStartupProbe"
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        if (!completed.Wait(TimeSpan.FromSeconds(35)))
            throw new TimeoutException(
                "AtlasDesk startup and development-page residency probe did not complete within 35 seconds.");

        thread.Join(TimeSpan.FromSeconds(2));
        if (failure is not null)
        {
            throw new InvalidOperationException(
                "AtlasDesk MainWindow + development-page residency probe failed.",
                failure);
        }

        Console.WriteLine(
            "PASS AtlasDesk MainWindow remains alive through full pipeline attach and Environment-tab discovery");
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
