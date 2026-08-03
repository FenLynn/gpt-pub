using PersonalWorkbench;
using System.Runtime.CompilerServices;

internal static class AuditFailureDetail
{
    [ModuleInitializer]
    internal static void Install()
    {
        AppDomain.CurrentDomain.UnhandledException += (_, _) =>
        {
            var snapshot = UiQualityAuditService.Current;
            if (snapshot is not null)
                Console.Error.WriteLine("UI AUDIT DETAIL: " + snapshot.Detail);
        };
    }
}
