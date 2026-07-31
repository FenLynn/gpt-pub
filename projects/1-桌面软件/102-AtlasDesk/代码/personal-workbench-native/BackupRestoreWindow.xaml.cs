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
            Title = "导出 Personal Workbench 备份",
            Filter = "Personal Workbench 备份 (*.pwbak)|*.pwbak|ZIP 文件 (*.zip)|*.zip",
            FileName = $"PersonalWorkbench_{WorkbenchVersion.Current}_{DateTime.Now:yyyyMMdd_HHmmss}.pwbak",
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
                validation.Summary + "\n\n恢复将替换当前 settings.json 和备份中包含的任务历史。"
                + "\n恢复前会自动创建当前配置快照。是否继续？",
                "确认恢复备份", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (confirmation != MessageBoxResult.Yes)
            {
                ResultTitle.Text = "恢复已取消";
                ResultSubtitle.Text = "当前配置没有改变。";
                return;
            }

            ResultTitle.Text = "正在恢复…";
            ResultSubtitle.Text = "正在创建恢复前快照并原子写入配置。";
            var restored = await WorkbenchBackupService.RestoreAsync(path, App.AppDataDirectory, createPreRestoreSnapshot: true);
            _lastPath = restored.PreRestoreSnapshotPath;
            _lastResult = string.Join(Environment.NewLine, new[]
            {
                "恢复完成",
                "已恢复：" + (restored.RestoredFiles.Count == 0 ? "无文件" : string.Join("、", restored.RestoredFiles)),
                "来源：" + restored.BackupPath,
                "恢复前快照：" + restored.PreRestoreSnapshotPath,
                string.Empty,
                "请关闭并重新启动 Personal Workbench，使设置完整生效。"
            });
            ResultTitle.Text = "恢复完成";
            ResultSubtitle.Text = "恢复前快照已保留；重启工作台后生效。";
            ResultText.Text = _lastResult;
            EnableResultActions();
            MessageBox.Show(this, "配置已恢复。请重启 Personal Workbench。", "备份与迁移", MessageBoxButton.OK, MessageBoxImage.Information);
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
            Filter = "Personal Workbench 备份 (*.pwbak;*.zip)|*.pwbak;*.zip|所有文件 (*.*)|*.*",
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
