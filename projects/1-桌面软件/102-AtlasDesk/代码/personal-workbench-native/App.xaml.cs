using System.IO;
using System.Windows;

namespace PersonalWorkbench;

public partial class App : Application
{
    private WorkbenchFeaturePipeline? _pipeline;

    public static string AppDataDirectory => ProductIdentity.AppDataDirectory;
    public static string LogDirectory { get; } = Path.Combine(AppDataDirectory, "logs");
    public static string LogPath { get; } = Path.Combine(LogDirectory, "atlasdesk.log");

    protected override void OnStartup(StartupEventArgs e)
    {
        Exception? migrationError = null;
        LegacyDataMigrationResult? migration = null;
        try
        {
            migration = ProductIdentity.MigrateLegacyAppDataIfNeeded();
        }
        catch (Exception ex)
        {
            migrationError = ex;
        }

        Directory.CreateDirectory(AppDataDirectory);
        Directory.CreateDirectory(LogDirectory);
        if (migration is { Migrated: true })
            Log($"Migrated legacy app data via {migration.Status}: {migration.LegacyDirectory} -> {migration.TargetDirectory}");
        if (migrationError is not null)
            Log("Legacy app-data migration failed: " + migrationError);

        ApplyPendingRestoreBeforeStartup();
        StartupGuard.Begin(WorkbenchVersion.Current);
        Exit += (_, _) => StartupGuard.Complete();
        GlobalShortcutBootstrap.Initialize();
        Log("Starting AtlasDesk " + WorkbenchVersion.Current);

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
            Log("Unhandled exception: " + args.ExceptionObject);

        TaskScheduler.UnobservedTaskException += (_, args) =>
        {
            Log("Task exception: " + args.Exception);
            args.SetObserved();
        };

        Activated += App_Activated;
        base.OnStartup(e);

        if (migrationError is not null)
        {
            MessageBox.Show(
                "旧配置目录未能自动迁移到 AtlasDesk。\n\n"
                + "旧数据仍保留在：\n" + ProductIdentity.LegacyAppDataDirectory + "\n\n"
                + "AtlasDesk 当前使用：\n" + AppDataDirectory + "\n\n"
                + "详情已写入日志。",
                "AtlasDesk 配置迁移",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
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
            Log("AtlasDesk " + WorkbenchVersion.Current + " modules attached");
        }
        catch (Exception ex)
        {
            Log("Feature pipeline failed: " + ex);
            MessageBox.Show("工作台功能模块初始化失败：\n" + ex.Message + "\n\n日志：" + LogPath,
                ProductIdentity.ProductName, MessageBoxButton.OK, MessageBoxImage.Error);
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
