using System.Text;
using System.Windows;
using System.Windows.Threading;

namespace PersonalWorkbench;

public partial class DashboardHostBootstrapWindow : Window
{
    public DashboardHostBootstrapWindow()
    {
        EmitProbe("bootstrap-constructor");
        InitializeComponent();
        Loaded += Window_Loaded;
    }

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        EmitProbe("bootstrap-loaded");
        Loaded -= Window_Loaded;
        var arguments = Environment.GetCommandLineArgs().Skip(1).ToArray();
        if (!DashboardHostLaunchOptions.TryParse(arguments, out var options))
        {
            EmitProbe("bootstrap-arguments-invalid");
            Application.Current.Shutdown(64);
            return;
        }

        var application = Application.Current;
        var host = new DashboardHostWindow(options);

        // Keep the hidden StartupUri window alive until the real host reaches Loaded.
        // Closing the StartupUri immediately after Show can leave the replacement WPF
        // window between SourceInitialized and Loaded, so WebView2 initialization never
        // begins and the parent waits forever for the HWND/READY handshake.
        application.ShutdownMode = ShutdownMode.OnExplicitShutdown;
        application.MainWindow = host;
        host.Loaded += Host_Loaded;
        EmitProbe("bootstrap-showing-host");
        host.Show();

        void Host_Loaded(object hostSender, RoutedEventArgs hostArgs)
        {
            EmitProbe("dashboard-host-loaded");
            host.Loaded -= Host_Loaded;
            application.MainWindow = host;
            application.ShutdownMode = ShutdownMode.OnMainWindowClose;
            _ = Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(Close));
        }
    }

    private static void EmitProbe(string message)
    {
        try
        {
            var payload = Convert.ToBase64String(Encoding.UTF8.GetBytes("startup-probe:" + message));
            Console.Out.WriteLine(DashboardHostWindow.ProtocolPrefix + "|LOG|" + payload);
            Console.Out.Flush();
        }
        catch
        {
            // A diagnostic probe must never change helper startup behavior.
        }
    }
}
