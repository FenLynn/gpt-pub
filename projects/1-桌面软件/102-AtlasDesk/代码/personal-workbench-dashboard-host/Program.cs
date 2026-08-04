namespace AtlasDesk.DashboardHost;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        DashboardHostProtocol.Log("startup-probe:dedicated-host-main");
        if (!DashboardHostOptions.TryParse(args, out var options))
        {
            DashboardHostProtocol.Log("startup-probe:dedicated-host-arguments-invalid");
            return 64;
        }

        try
        {
            DashboardHostProtocol.Log("startup-probe:dedicated-host-arguments-accepted");
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using var form = new DashboardHostForm(options);
            Application.Run(form);
            return Environment.ExitCode;
        }
        catch (Exception ex)
        {
            DashboardHostProtocol.Error(ex);
            return 70;
        }
    }
}
