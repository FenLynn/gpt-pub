using System.Windows;

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

        var host = new DashboardHostWindow(options);
        Application.Current.MainWindow = host;
        Application.Current.ShutdownMode = ShutdownMode.OnMainWindowClose;
        host.Show();
        Close();
    }
}
