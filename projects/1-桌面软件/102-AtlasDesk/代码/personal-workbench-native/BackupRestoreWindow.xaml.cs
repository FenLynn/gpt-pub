using Microsoft.Win32;
using System.Diagnostics;
using System.Windows;

namespace PersonalWorkbench;

public partial class BackupRestoreWindow : Window
{
    private string _lastPath = string.Empty;
    private string _lastResult = string.Empty;
    private bool _busy;

    public BackupRestoreWindow()
    {
        InitializeComponent();
        VersionText.Text = "v" + WorkbenchVersion.Current;
        StatusText.Text = "配置目录：" + App.AppDataDirectory;
    }

    private async void Export_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog
        {
            Title = "导出 AtlasDesk 备份",
            Filter = "AtlasDesk 备份 (*.pwbak)|*.pwbak|ZIP 文件 (*.zip)|*.zip",
            FileName = $"AtlasDesk_{WorkbenchVersion.Current}_{DateTime.Now:yyyyMMdd_HHmmss}.pwbak",
            DefaultExt = ".pwbak",
            AddExtension = true
        };
        if (dialog.ShowDialog(this) != true) return;
        await RunAsync("正在导出备份…", async () =>
        {
            await WorkbenchBackupService.ExportAsync(App.AppDataDirectory, dialog.FileName);
            var validation = await WorkbenchBackupService.ValidateAsync(dialog.FileName);
            if (!validation.IsValid) throw new InvalidDataException(string.Join(Environment.NewLine, validation.Errors));
            _lastPath = dialog.FileName;
            _lastResult = validation.Summary + Environment.NewLine + Environment.NewLine + "保存位置：" + dialog.FileName;
            ResultTitle.Text = "备份已导出并通过校验";
            ResultSubtitle.Text = "浏览器登录和本机缓存未写入备份。";
            ResultText.Text = _lastResult;
            EnableResultActions();
        });
    }

    private async void Validate_Click(object sender, RoutedEventArgs e)
    {
        var path = SelectBackup("选择要检查的备份");
        if (string.IsNullOrWhiteSpace(path)) return;
        await RunAsync("正在检查备份…", async () =>
        {
            var validation = await WorkbenchBackupService.ValidateAsync(path);
            _lastPath = path;
            _lastResult = validation.Summary + Environment.NewLine + Environment.NewLine + "文件：" + path;
            ResultTitle.Text = validation.IsValid ? "备份有效" : "备份无效";
            ResultSubtitle.Text = validation.IsValid ? "文件白名单、大小和 SHA-256 均已通过。" : "该文件不会被恢复。";
            ResultText.Text = _lastResult;
            EnableResultActions();
        });
    }

    private async void Restore_Click(object sender, RoutedEventArgs e)
    {
        var path = SelectBackup("选择要恢复的备份");
        if (string.IsNullOrWhiteSpace(path)) return;
        await RunAsync("正在预检查备份…", async () =>
        {
            var validation = await WorkbenchBackupService.ValidateAsync(path);
            if (!validation.IsValid)
            {
                _lastPath = path;
                _lastResult = validation.Summary;
                ResultTitle.Text = "备份无效，未执行恢复";
                ResultSubtitle.Text = "恢复前校验未通过。";
                ResultText.Text = _lastResult;
                EnableResultActions();
                return;
            }

            var confirmation = MessageBox.Show(this,
                validation.Summary + "\n\n恢复包将在当前运行中完成再次校验并安全暂存。"
                + "\n真正的配置替换将在下次启动、任何模块加载之前执行。"
                + "\n暂存前会自动创建当前配置快照。是否继续？",
                "确认暂存恢复", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirmation != MessageBoxResult.Yes)
            {
                ResultTitle.Text = "恢复已取消";
                ResultSubtitle.Text = "当前配置没有改变。";
                return;
            }

            ResultTitle.Text = "正在暂存恢复包…";
            ResultSubtitle.Text = "当前 settings.json 和任务历史不会在本次运行中被替换。";
            var staged = await PendingRestoreService.StageAsync(path, App.AppDataDirectory);
            _lastPath = staged.PreRestoreSnapshotPath;
            _lastResult = string.Join(Environment.NewLine, new[]
            {
                "恢复已安全暂存",
                "待恢复：" + (staged.Files.Count == 0 ? "无文件" : string.Join("、", staged.Files)),
                "来源：" + staged.SourceBackupPath,
                "暂存包：" + staged.PendingBackupPath,
                "恢复前快照：" + staged.PreRestoreSnapshotPath,
                string.Empty,
                "当前运行中的配置没有被替换。",
                "请关闭并重新启动 AtlasDesk；下次启动会在模块加载前再次校验并应用。"
            });
            ResultTitle.Text = "恢复已暂存";
            ResultSubtitle.Text = "恢复前快照已保留；重启后自动应用。";
            ResultText.Text = _lastResult;
            EnableResultActions();
            MessageBox.Show(this,
                "恢复包已暂存，当前配置未改变。\n\n请关闭并重新启动 AtlasDesk。",
                "备份与迁移", MessageBoxButton.OK, MessageBoxImage.Information);
        });
    }

    private async Task RunAsync(string message, Func<Task> operation)
    {
        if (_busy) return;
        _busy = true;
        SetButtons(false);
        OperationProgress.IsIndeterminate = true;
        ResultTitle.Text = message;
        ResultSubtitle.Text = "操作期间不会访问 Dashboard 登录资料。";
        try
        {
            await operation();
            StatusText.Text = "操作完成 · " + DateTime.Now.ToString("HH:mm:ss");
        }
        catch (Exception ex)
        {
            App.Log("Backup operation failed: " + ex);
            _lastResult = ex.ToString();
            ResultTitle.Text = "操作失败";
            ResultSubtitle.Text = ex.Message;
            ResultText.Text = _lastResult;
            CopyButton.IsEnabled = true;
            MessageBox.Show(this, "操作失败：\n" + ex.Message, "备份与迁移", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            OperationProgress.IsIndeterminate = false;
            _busy = false;
            SetButtons(true);
        }
    }

    private string SelectBackup(string title)
    {
        var dialog = new OpenFileDialog
        {
            Title = title,
            Filter = "AtlasDesk 备份 (*.pwbak;*.zip)|*.pwbak;*.zip|所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };
        return dialog.ShowDialog(this) == true ? dialog.FileName : string.Empty;
    }

    private void SetButtons(bool enabled)
    {
        ExportButton.IsEnabled = enabled;
        ValidateButton.IsEnabled = enabled;
        RestoreButton.IsEnabled = enabled;
    }

    private void EnableResultActions()
    {
        CopyButton.IsEnabled = !string.IsNullOrWhiteSpace(_lastResult);
        OpenFolderButton.IsEnabled = File.Exists(_lastPath) || Directory.Exists(_lastPath);
    }

    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_lastResult)) return;
        try { Clipboard.SetText(_lastResult); ResultSubtitle.Text = "结果已复制"; }
        catch (Exception ex) { App.Log("Backup result copy failed: " + ex.Message); }
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_lastPath)) return;
        try
        {
            if (File.Exists(_lastPath))
                Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + _lastPath + "\"") { UseShellExecute = true });
            else if (Directory.Exists(_lastPath))
                Process.Start(new ProcessStartInfo("explorer.exe", _lastPath) { UseShellExecute = true });
        }
        catch (Exception ex) { App.Log("Backup location open failed: " + ex.Message); }
    }
}
