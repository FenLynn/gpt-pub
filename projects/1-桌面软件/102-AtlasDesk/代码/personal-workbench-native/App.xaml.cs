using System.ComponentModel;
using System.IO;
using System.Windows;

namespace PersonalWorkbench;

public partial class App : Application
{
    private WorkbenchFeaturePipeline? _pipeline;
    private bool _windowLifetimeLoggingAttached;

    public static string RuntimeDirectory => ProductIdentity.RuntimeDirectory;
    public static string AppDataDirectory => ProductIdentity.RoamingDataDirectory;
    public static string LocalDataDirectory => ProductIdentity.LocalDataDirectory;
    public static string DashboardProfileDirectory => ProductIdentity.DashboardProfileDirectory;
    public static string TerminalProfileDirectory => ProductIdentity.TerminalProfileDirectory;
    public static string CacheDirectory => ProductIdentity.CacheDirectory;
    public static string LogDirectory => ProductIdentity.LogDirectory;
    public static string StateDirectory => ProductIdentity.StateDirectory;
    public static string CrashDirectory => ProductIdentity.CrashDirectory;
    public static string LogPath { get; } = Path.Combine(LogDirectory, "atlasdesk.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        ProductIdentity.EnsureDataDirectories();
        ApplyPendingRestoreBeforeStartup();
        StartupGuard.Begin(WorkbenchVersion.Current);

        Exit += (_, args) =>
        {
            Log($"Application Exit event. Code={args.ApplicationExitCode}");
            StartupGuard.Complete();
            SecurityService.LockVault();
        };
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
            Log("CLR ProcessExit event");

        GlobalShortcutBootstrap.Initialize();
        Log($"Starting AtlasDesk {WorkbenchVersion.Current}");
        Log("Runtime=" + RuntimeDirectory);
        Log("RoamingData=" + AppDataDirectory);
        Log("LocalData=" + LocalDataDirectory);

        DispatcherUnhandledException += (_, args) =>
        {
            Log("Dispatcher exception: " + args.Exception);
            MessageBox.Show(
                "程序发生错误，详情已写入：\n" + LogPath + "\n\n" + args.Exception.Message,
                ProductIdentity.ProductName,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            args.Handled = true;
        };

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            Log($"Unhandled exception. IsTerminating={args.IsTerminating}: {args.ExceptionObject}");

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
                "AtlasDesk 恢复失败",
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
            AttachWindowLifetimeLogging(window);
            Log("AtlasDesk " + WorkbenchVersion.Current + " modules attached");
        }
        catch (Exception ex)
        {
            Log("Feature pipeline failed: " + ex);
            MessageBox.Show(
                "工作台功能模块初始化失败：\n" + ex.Message + "\n\n日志：" + LogPath,
                ProductIdentity.ProductName,
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    private void AttachWindowLifetimeLogging(MainWindow window)
    {
        if (_windowLifetimeLoggingAttached)
            return;

        _windowLifetimeLoggingAttached = true;
        window.Closing += MainWindow_Closing;
        window.Closed += (_, _) => Log("Main window Closed event");
    }

    private static void MainWindow_Closing(object? sender, CancelEventArgs args)
    {
        if (sender is Window window)
        {
            Log($"Main window Closing event. Cancel={args.Cancel}; "
                + $"Visible={window.IsVisible}; Loaded={window.IsLoaded}; State={window.WindowState}");
        }
        else
        {
            Log("Main window Closing event");
        }
    }

    public static void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(LogDirectory);
            File.AppendAllText(
                LogPath,
                $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never crash the UI.
        }
    }
}
