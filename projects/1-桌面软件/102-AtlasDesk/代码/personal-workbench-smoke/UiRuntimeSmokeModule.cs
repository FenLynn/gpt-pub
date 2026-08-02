using PersonalWorkbench;
using PersonalWorkbench.Smoke;
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
                V070RuntimeVerifier.Verify();
                V071RuntimeVerifier.Verify();
                V072RuntimeVerifier.Verify();
                V073RuntimeVerifier.Verify();
                MainWindowStartupProbe.VerifyOnCurrentStaThread();
            }
            catch (Exception ex)
            {
                failure = ex;
            }
        })
        {
            Name = "AtlasDesk.UiRuntimeSmoke"
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        if (!thread.Join(TimeSpan.FromSeconds(75)))
        {
            throw new TimeoutException(
                "Corrective UI and startup residency verification timed out. Last startup phase: "
                + MainWindowStartupProbe.CurrentPhase);
        }
        if (failure is not null)
        {
            throw new InvalidOperationException(
                "Corrective UI and startup residency verification failed.",
                failure);
        }
    }
}
