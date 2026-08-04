using System.Windows;
using System.Windows.Threading;

namespace PersonalWorkbench;

public partial class DashboardHostBootstrapWindow : Window
{
    public DashboardHostBootstrapWindow()
    {
        InitializeComponent();
        Loaded += Window_Loaded;
    }

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        Loaded -= Window_Loaded;
        var arguments = Environment.GetCommandLineArgs().Skip(1).ToArray();
        if (!DashboardHostLaunchOptions.TryParse(arguments, out var options))
        {
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
        host.Show();

        void Host_Loaded(object hostSender, RoutedEventArgs hostArgs)
        {
            host.Loaded -= Host_Loaded;
            application.MainWindow = host;
            application.ShutdownMode = ShutdownMode.OnMainWindowClose;
            _ = Dispatcher.BeginInvoke(DispatcherPriority.ContextIdle, new Action(Close));
        }
    }
}
