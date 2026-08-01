using PersonalWorkbench;
using System.Runtime.CompilerServices;
using System.Windows;

internal static class UiRuntimeSmokeModule
{
    [ModuleInitializer]
    internal static void Run()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                if (Application.Current is null)
                {
                    var app = new App();
                    app.InitializeComponent();
                }
                UiRuntimeVerifier.VerifyCorrectiveVisuals();
            }
            catch (Exception ex) { failure = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(TimeSpan.FromSeconds(30)))
            throw new TimeoutException("Corrective UI runtime verification timed out.");
        if (failure is not null)
            throw new InvalidOperationException("Corrective UI runtime verification failed.", failure);
    }
}
