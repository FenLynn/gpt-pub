using System.Runtime.CompilerServices;
using System.Threading;
using System.Windows;
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
            try
            {
                var app = new App();
                app.InitializeComponent();

                var window = new MainWindow();
                _ = WorkbenchFeaturePipeline.Attach(window);
                window.Close();
            }
            catch (Exception ex)
            {
                failure = ex;
            }
            finally
            {
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

        if (!completed.Wait(TimeSpan.FromSeconds(20)))
            throw new TimeoutException("AtlasDesk main-window startup probe did not complete within 20 seconds.");

        thread.Join(TimeSpan.FromSeconds(2));
        if (failure is not null)
            throw new InvalidOperationException(
                "AtlasDesk MainWindow + WorkbenchFeaturePipeline startup probe failed.", failure);

        Console.WriteLine("PASS AtlasDesk MainWindow and full feature pipeline attach on an STA thread");
    }
}
