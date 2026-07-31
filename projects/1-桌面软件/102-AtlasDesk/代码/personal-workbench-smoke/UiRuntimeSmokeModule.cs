using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class UiRuntimeSmokeModule
{
    [ModuleInitializer]
    internal static void Run()
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try { UiRuntimeVerifier.VerifyCorrectiveVisuals(); }
            catch (Exception ex) { failure = ex; }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(TimeSpan.FromSeconds(20)))
            throw new TimeoutException("Corrective UI runtime verification timed out.");
        if (failure is not null)
            throw new InvalidOperationException("Corrective UI runtime verification failed.", failure);
    }
}
