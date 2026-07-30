using System.IO;
using System.Windows;

namespace PersonalWorkbench;

public partial class App : Application
{
    public static string AppDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "PersonalWorkbench");

    public static string LogDirectory { get; } = Path.Combine(AppDataDirectory, "logs");
    public static string LogPath { get; } = Path.Combine(LogDirectory, "workbench-native.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        Directory.CreateDirectory(AppDataDirectory);
        Directory.CreateDirectory(LogDirectory);
        Log("Starting Personal Workbench 0.3.0");

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

        base.OnStartup(e);
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
