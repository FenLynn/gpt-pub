using System.ComponentModel;
using System.Windows;

namespace PersonalWorkbench;

public partial class App : Application
{
    private WorkbenchFeaturePipeline? _pipeline;
    private bool _windowLifetimeLoggingAttached;
    private bool _safeModeNoticeShown;

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
    public static bool IsSafeMode { get; private set; }

    protected override void OnStartup(StartupEventArgs e)
    {
        // WPF does not accept StartupUri=null. Helper mode therefore redirects the
        // non-null XAML startup route to a hidden bootstrap window before base startup.
        // The bootstrap replaces itself with DashboardHostWindow and never constructs
        // MainWindow, StartupGuard, global shortcuts or the primary feature pipeline.
        if (DashboardHostLaunchOptions.TryParse(e.Args, out _))
        {
            StartupUri = new Uri("DashboardHostBootstrapWindow.xaml", UriKind.Relative);
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            base.OnStartup(e);
            return;
        }

        ProductIdentity.EnsureDataDirectories();
        LogMaintenance.Prepare(LogPath);
        ApplyPendingRestoreBeforeStartup();
        StartupGuard.Begin(WorkbenchVersion.Current);
        IsSafeMode = StartupGuard.SafeModeRecommended;
        PerformanceBaselineService.Begin(WorkbenchVersion.Current, IsSafeMode);

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
        Log("SafeMode=" + IsSafeMode);

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

        PerformanceBaselineService.MarkMainWindowLoaded();
        try
        {
            _pipeline = WorkbenchFeaturePipeline.Attach(window);
            AttachWindowLifetimeLogging(window);
            var sample = PerformanceBaselineService.MarkPipelineAttached();
            if (sample is not null)
            {
                Log($"Startup baseline: window={sample.MainWindowLoadedMs}ms; "
                    + $"pipeline={sample.PipelineAttachedMs}ms; workingSet={sample.WorkingSetBytes / 1024d / 1024d:0.0}MB");
            }
            Log("AtlasDesk " + WorkbenchVersion.Current + " modules attached");
            ShowSafeModeNotice(window);
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

    private void ShowSafeModeNotice(MainWindow window)
    {
        if (!IsSafeMode || _safeModeNoticeShown)
            return;

        _safeModeNoticeShown = true;
        window.Dispatcher.BeginInvoke(new Action(() =>
        {
            MessageBox.Show(
                "AtlasDesk 检测到连续异常退出，已进入安全启动。\n\n"
                + "本次不会自动打开 Dashboard，也不会修改你原来的自动打开设置。\n"
                + "可先在诊断中心检查配置、WebView2、终端和日志，再手动进入各页面。",
                "AtlasDesk 安全启动",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }));
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
