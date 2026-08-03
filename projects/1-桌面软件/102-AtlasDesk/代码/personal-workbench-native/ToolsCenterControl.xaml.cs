using Microsoft.Win32;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public partial class ToolsCenterControl : UserControl, IDisposable
{
    private readonly AppSettings _settings;
    private Guid? _activeTaskId;
    private WorkbenchTaskRecord? _activeRecord;
    private string _currentDetail = string.Empty;
    private string _currentPath = string.Empty;
    private bool _disposed;

    public ToolsCenterControl() : this(AppSettings.Load()) { }

    public ToolsCenterControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        WorkspaceBadgeText.Text = Directory.Exists(settings.WorkspaceRoot) ? settings.WorkspaceRoot : "未配置工作区";
        GenerateButton.IsEnabled = Directory.Exists(settings.WorkspaceRoot);
    }

    private async void Generate_Click(object sender, RoutedEventArgs e)
    {
        if (!Directory.Exists(_settings.WorkspaceRoot))
        {
            ShowMessage("请先在设置中选择有效的默认工作区。");
            return;
        }
        var rootName = Path.GetFileName(_settings.WorkspaceRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var dialog = new SaveFileDialog
        {
            Title = "保存 SHA-256 清单",
            Filter = "SHA-256 清单 (*.sha256)|*.sha256|文本文件 (*.txt)|*.txt",
            FileName = (string.IsNullOrWhiteSpace(rootName) ? "workspace" : rootName) + ".sha256",
            DefaultExt = ".sha256",
            AddExtension = true
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;

        IReadOnlyList<FileIntegrityEntry>? entries = null;
        var record = await RunOperationAsync(
            "生成工作区 SHA-256 清单",
            dialog.FileName,
            async (progress, token) =>
            {
                entries = await FileIntegrityService.CreateManifestAsync(_settings.WorkspaceRoot, dialog.FileName, progress, token);
                await FileIntegrityService.WriteManifestAtomicAsync(dialog.FileName, entries);
                return string.Join(Environment.NewLine, new[]
                {
                    "SHA-256 清单已写入：", dialog.FileName, string.Empty,
                    $"根目录：{_settings.WorkspaceRoot}", $"记录数：{entries.Count:N0}",
                    "格式：AtlasDesk SHA256 v1"
                });
            });
        if (record.State != WorkbenchTaskState.Completed || entries is null) return;

        VerificationList.ItemsSource = null;
        EmptyState.Visibility = Visibility.Visible;
        ResultTitle.Text = "清单已生成";
        ResultCountText.Text = entries.Count + " 个文件";
        _currentPath = dialog.FileName;
        _currentDetail = record.Result;
        DetailTitle.Text = "生成完成";
        DetailSubtitle.Text = "任务已写入统一历史；清单采用相对路径。";
        SelectedPathText.Text = dialog.FileName;
        DetailText.Text = _currentDetail;
        CopyButton.IsEnabled = true;
        OpenPathButton.IsEnabled = true;
    }

    private async void Verify_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 SHA-256 清单",
            Filter = "SHA-256 清单 (*.sha256;*.txt)|*.sha256;*.txt|所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;
        var root = Directory.Exists(_settings.WorkspaceRoot)
            ? _settings.WorkspaceRoot
            : Path.GetDirectoryName(dialog.FileName) ?? Environment.CurrentDirectory;

        IReadOnlyList<IntegrityVerificationItem>? results = null;
        var record = await RunOperationAsync(
            "验证 SHA-256 清单",
            dialog.FileName,
            async (progress, token) =>
            {
                results = await FileIntegrityService.VerifyManifestAsync(dialog.FileName, root, progress, token);
                var matched = results.Count(item => item.Status == IntegrityVerificationStatus.Match);
                var missing = results.Count(item => item.Status == IntegrityVerificationStatus.Missing);
                var changed = results.Count(item => item.Status == IntegrityVerificationStatus.Changed);
                var unsafeCount = results.Count(item => item.Status == IntegrityVerificationStatus.UnsafePath);
                var errors = results.Count(item => item.Status == IntegrityVerificationStatus.Error);
                return string.Join(Environment.NewLine, new[]
                {
                    $"根目录：{root}", $"清单：{dialog.FileName}", string.Empty,
                    $"匹配：{matched:N0}", $"缺失：{missing:N0}", $"改变：{changed:N0}",
                    $"不安全路径：{unsafeCount:N0}", $"读取错误：{errors:N0}"
                });
            });
        if (record.State != WorkbenchTaskState.Completed || results is null) return;

        VerificationList.ItemsSource = results;
        EmptyState.Visibility = results.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        var matchedCount = results.Count(item => item.Status == IntegrityVerificationStatus.Match);
        ResultTitle.Text = "清单验证结果";
        ResultCountText.Text = $"{matchedCount} 匹配 · {results.Count - matchedCount} 异常";
        _currentPath = dialog.FileName;
        _currentDetail = record.Result;
        DetailTitle.Text = results.Count == matchedCount ? "全部文件匹配" : "发现完整性差异";
        DetailSubtitle.Text = "结果已写入统一任务历史；点击记录查看详情。";
        SelectedPathText.Text = dialog.FileName;
        DetailText.Text = _currentDetail;
        CopyButton.IsEnabled = true;
        OpenPathButton.IsEnabled = true;
        if (results.Count > 0) VerificationList.SelectedIndex = 0;
    }

    private async void Compare_Click(object sender, RoutedEventArgs e)
    {
        var first = SelectFile("选择第一个文件");
        if (string.IsNullOrWhiteSpace(first)) return;
        var second = SelectFile("选择第二个文件");
        if (string.IsNullOrWhiteSpace(second)) return;

        FileComparisonResult? comparison = null;
        var record = await RunOperationAsync(
            "比较两个文件的 SHA-256",
            first,
            async (progress, token) =>
            {
                comparison = await FileIntegrityService.CompareFilesAsync(first, second, progress, token);
                return comparison.Summary;
            });
        if (record.State != WorkbenchTaskState.Completed || comparison is null) return;

        VerificationList.ItemsSource = null;
        EmptyState.Visibility = Visibility.Visible;
        ResultTitle.Text = comparison.IsIdentical ? "文件完全一致" : "文件不同";
        ResultCountText.Text = comparison.IsIdentical ? "SHA-256 与大小均相同" : "存在差异";
        _currentPath = first;
        _currentDetail = record.Result;
        DetailTitle.Text = comparison.IsIdentical ? "比较通过" : "比较结果不同";
        DetailSubtitle.Text = "结果已写入统一任务历史。";
        SelectedPathText.Text = first + Environment.NewLine + second;
        DetailText.Text = comparison.Summary;
        CopyButton.IsEnabled = true;
        OpenPathButton.IsEnabled = true;
    }

    private async Task<WorkbenchTaskRecord> RunOperationAsync(
        string title,
        string targetPath,
        Func<IProgress<double>, CancellationToken, Task<string>> operation)
    {
        if (_activeTaskId is Guid active)
            FileIntegrityTaskBridge.Cancel(active);
        DetachActiveRecord();

        var handle = FileIntegrityTaskBridge.Start(title, targetPath, operation);
        _activeTaskId = handle.Record.Id;
        _activeRecord = handle.Record;
        _activeRecord.PropertyChanged += ActiveRecord_PropertyChanged;
        SetBusy(true, title + "…");
        UpdateProgress(handle.Record);

        var record = await handle.Completion;
        UpdateProgress(record);
        if (record.State == WorkbenchTaskState.Cancelled)
        {
            DetailTitle.Text = "操作已取消";
            DetailSubtitle.Text = "任务历史已记录取消状态；未完成清单不会替换目标文件。";
        }
        else if (record.State == WorkbenchTaskState.Failed)
        {
            DetailTitle.Text = "操作失败";
            DetailSubtitle.Text = record.Error;
            DetailText.Text = record.Error;
            ShowMessage("操作失败：\n" + record.Error, MessageBoxImage.Error);
        }

        DetachActiveRecord();
        SetBusy(false, string.Empty);
        return record;
    }

    private void ActiveRecord_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is WorkbenchTaskRecord record)
            Dispatcher.BeginInvoke(new Action(() => UpdateProgress(record)));
    }

    private void UpdateProgress(WorkbenchTaskRecord record)
    {
        OperationProgress.IsIndeterminate = record.Progress < 0 && record.State == WorkbenchTaskState.Running;
        if (record.Progress >= 0) OperationProgress.Value = Math.Clamp(record.Progress, 0, 100);
        ProgressText.Text = record.StateLabel + " · " + record.ProgressLabel;
    }

    private void DetachActiveRecord()
    {
        if (_activeRecord is not null)
            _activeRecord.PropertyChanged -= ActiveRecord_PropertyChanged;
        _activeRecord = null;
        _activeTaskId = null;
    }

    private void SetBusy(bool busy, string message)
    {
        GenerateButton.IsEnabled = !busy && Directory.Exists(_settings.WorkspaceRoot);
        VerifyButton.IsEnabled = !busy;
        CompareButton.IsEnabled = !busy;
        CancelButton.IsEnabled = busy;
        if (busy)
        {
            DetailTitle.Text = message;
            DetailSubtitle.Text = "任务同时显示在任务中心，可从任一页面取消。";
            OperationProgress.Value = 0;
            OperationProgress.IsIndeterminate = false;
            ProgressText.Text = "等待中 · 排队";
        }
    }

    private string SelectFile(string title)
    {
        var dialog = new OpenFileDialog
        {
            Title = title,
            Filter = "所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };
        return dialog.ShowDialog(Window.GetWindow(this)) == true ? dialog.FileName : string.Empty;
    }

    private void VerificationList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (VerificationList.SelectedItem is not IntegrityVerificationItem item) return;
        _currentPath = item.FullPath;
        _currentDetail = string.Join(Environment.NewLine, new[]
        {
            "状态：" + item.StatusLabel,
            "文件：" + item.Entry.RelativePath,
            "完整路径：" + (string.IsNullOrWhiteSpace(item.FullPath) ? "未解析" : item.FullPath),
            string.Empty,
            "期望 SHA-256：", item.Entry.Sha256,
            string.Empty,
            "实际 SHA-256：", string.IsNullOrWhiteSpace(item.ActualSha256) ? "无" : item.ActualSha256,
            string.Empty,
            item.Message
        });
        DetailTitle.Text = item.Entry.RelativePath;
        DetailSubtitle.Text = item.StatusLabel + " · " + item.Message;
        SelectedPathText.Text = item.FullPath;
        DetailText.Text = _currentDetail;
        CopyButton.IsEnabled = true;
        OpenPathButton.IsEnabled = File.Exists(item.FullPath) || Directory.Exists(item.FullPath);
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (_activeTaskId is Guid id)
            FileIntegrityTaskBridge.Cancel(id);
    }

    private void Copy_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_currentDetail)) return;
        try { Clipboard.SetText(_currentDetail); DetailSubtitle.Text = "详情已复制"; }
        catch (Exception ex) { App.Log("Integrity detail copy failed: " + ex.Message); }
    }

    private void OpenPath_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_currentPath)) return;
        try
        {
            if (File.Exists(_currentPath))
                Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + _currentPath + "\"") { UseShellExecute = true });
            else if (Directory.Exists(_currentPath))
                Process.Start(new ProcessStartInfo("explorer.exe", _currentPath) { UseShellExecute = true });
        }
        catch (Exception ex) { App.Log("Integrity path open failed: " + ex.Message); }
    }

    private void ShowMessage(string text, MessageBoxImage image = MessageBoxImage.Information)
        => MessageBox.Show(Window.GetWindow(this), text, "文件完整性", MessageBoxButton.OK, image);

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_activeTaskId is Guid id) FileIntegrityTaskBridge.Cancel(id);
        DetachActiveRecord();
    }
}
