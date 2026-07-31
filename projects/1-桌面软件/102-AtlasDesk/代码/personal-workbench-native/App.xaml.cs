using System.IO;
using System.Windows;

namespace PersonalWorkbench;

public partial class App : Application
{
    private WorkbenchEnhancer? _enhancer;
    private V061ExperienceEnhancer? _experience;

    public static string AppDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "PersonalWorkbench");

    public static string LogDirectory { get; } = Path.Combine(AppDataDirectory, "logs");
    public static string LogPath { get; } = Path.Combine(LogDirectory, "workbench-native.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        Directory.CreateDirectory(AppDataDirectory);
        Directory.CreateDirectory(LogDirectory);
        GlobalShortcutBootstrap.Initialize();
        Log("Starting Personal Workbench 0.6.1");

        DispatcherUnhandledException += (_, args) =>
        {
            Log("Dispatcher exception: " + args.Exception);
            MessageBox.Show(
                "程序发生错误，详情已写入：\n" + LogPath + "\n\n" + args.Exception.Message,
                "Personal Workbench",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            args.Handled = true;
        };

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            Log("Unhandled exception: " + args.ExceptionObject);

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            Log("Task exception: " + args.Exception);
            args.SetObserved();
        };

        Activated += App_Activated;
        base.OnStartup(e);
    }

    private void App_Activated(object? sender, EventArgs e)
    {
        if (_enhancer is not null || MainWindow is not MainWindow window)
            return;
        try
        {
            _enhancer = WorkbenchEnhancer.Attach(window);
            _experience = V061ExperienceEnhancer.Attach(window, _enhancer);
            Log("Workbench v0.6.1 modules attached");
        }
        catch (Exception ex)
        {
            Log("Feature enhancer failed: " + ex);
            MessageBox.Show("工作台功能模块初始化失败：\n" + ex.Message + "\n\n日志：" + LogPath,
                "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    public static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);
            File.AppendAllText(LogPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never crash the UI.
        }
    }
}
