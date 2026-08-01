using System.IO;
using System.Windows;

namespace PersonalWorkbench;

public partial class App : Application
{
    private WorkbenchFeaturePipeline? _pipeline;

    public static string AppDataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "PersonalWorkbench");

    public static string LogDirectory { get; } = Path.Combine(AppDataDirectory, "logs");
    public static string LogPath { get; } = Path.Combine(LogDirectory, "workbench-native.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        Directory.CreateDirectory(AppDataDirectory);
        Directory.CreateDirectory(LogDirectory);
        ApplyPendingRestoreBeforeStartup();
        StartupGuard.Begin(WorkbenchVersion.Current);
        Exit += (_, _) => StartupGuard.Complete();
        GlobalShortcutBootstrap.Initialize();
        Log("Starting Personal Workbench " + WorkbenchVersion.Current);

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

    private static void ApplyPendingRestoreBeforeStartup()
    {
        try
        {
            var result = PendingRestoreService.ApplyIfPendingAsync(AppDataDirectory).GetAwaiter().GetResult();
            if (result is not null)
                Log("Applied pending restore before startup: " + string.Join(", ", result.RestoredFiles));
        }
        catch (Exception ex)
        {
            Log("Pending restore failed before startup: " + ex);
            MessageBox.Show(
                "暂存的配置恢复未能应用。\n\n"
                + "暂存包已保留，现有配置不会以半恢复状态继续写入。\n"
                + "可在备份与迁移中心重新检查备份，或查看日志：\n" + LogPath + "\n\n"
                + ex.Message,
                "Personal Workbench 恢复失败",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    private void App_Activated(object? sender, EventArgs e)
    {
        if (_pipeline is not null || MainWindow is not MainWindow window)
            return;
        try
        {
            _pipeline = WorkbenchFeaturePipeline.Attach(window);
            Log("Workbench " + WorkbenchVersion.Current + " modules attached");
        }
        catch (Exception ex)
        {
            Log("Feature pipeline failed: " + ex);
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
