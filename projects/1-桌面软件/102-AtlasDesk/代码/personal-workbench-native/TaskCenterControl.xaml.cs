using Microsoft.Win32;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public partial class TaskCenterControl : UserControl, IDisposable
{
    private readonly AppSettings _settings;
    private readonly WorkbenchTaskService _service;
    private WorkbenchTaskRecord? _selected;
    private bool _disposed;

    public TaskCenterControl() : this(AppSettings.Load()) { }

    public TaskCenterControl(AppSettings settings)
    {
        _settings = settings;
        _service = new WorkbenchTaskService();
        InitializeComponent();
        DataContext = _service;
        HistoryPathText.Text = WorkbenchTaskService.HistoryPath;
        _service.Tasks.CollectionChanged += Tasks_CollectionChanged;
        foreach (var record in _service.Tasks) record.PropertyChanged += Record_PropertyChanged;
        UpdateOverview();
        if (_service.Tasks.Count > 0) TaskList.SelectedIndex = 0;
    }

    private void Tasks_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (e.OldItems is not null)
            foreach (WorkbenchTaskRecord item in e.OldItems) item.PropertyChanged -= Record_PropertyChanged;
        if (e.NewItems is not null)
            foreach (WorkbenchTaskRecord item in e.NewItems) item.PropertyChanged += Record_PropertyChanged;
        UpdateOverview();
        if (TaskList.SelectedItem is null && _service.Tasks.Count > 0) TaskList.SelectedIndex = 0;
    }

    private void Record_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        UpdateOverview();
        if (ReferenceEquals(sender, _selected)) UpdateDetails();
    }

    private void UpdateOverview()
    {
        var running = _service.Tasks.Count(item => item.State == WorkbenchTaskState.Running);
        var queued = _service.Tasks.Count(item => item.State == WorkbenchTaskState.Queued);
        RunningBadgeText.Text = queued > 0
            ? $"{running} 运行 · {queued} 排队"
            : running + " 个运行中";
        EmptyState.Visibility = _service.Tasks.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    private void UpdateDetails()
    {
        var record = _selected;
        if (record is null)
        {
            DetailTitle.Text = "选择一个任务";
            DetailType.Text = string.Empty;
            DetailPath.Text = "任务路径和结果将在这里显示。";
            DetailProgress.IsIndeterminate = false;
            DetailProgress.Value = 0;
            DetailProgressText.Text = string.Empty;
            DetailResult.Text = "无结果";
            CancelButton.IsEnabled = false;
            CopyResultButton.IsEnabled = false;
            OpenFolderButton.IsEnabled = false;
            return;
        }

        DetailTitle.Text = record.Title;
        DetailType.Text = record.TypeLabel + " · " + record.StateLabel + (string.IsNullOrWhiteSpace(record.DurationLabel) ? string.Empty : " · " + record.DurationLabel);
        DetailPath.Text = record.TargetPath;
        DetailProgress.IsIndeterminate = record.Progress < 0 && record.State == WorkbenchTaskState.Running;
        DetailProgress.Value = Math.Clamp(record.Progress, 0, 100);
        DetailProgressText.Text = record.ProgressLabel;
        DetailResult.Text = !string.IsNullOrWhiteSpace(record.Result)
            ? record.Result
            : !string.IsNullOrWhiteSpace(record.Error)
                ? "错误" + Environment.NewLine + record.Error
                : record.State == WorkbenchTaskState.Queued
                    ? $"等待执行槽位 · 最多并行 {_service.MaxConcurrency} 个任务"
                    : "任务尚未产生结果。";
        CancelButton.IsEnabled = record.CanCancel;
        CopyResultButton.IsEnabled = !string.IsNullOrWhiteSpace(record.Result) || !string.IsNullOrWhiteSpace(record.Error);
        OpenFolderButton.IsEnabled = File.Exists(record.TargetPath) || Directory.Exists(record.TargetPath);
    }

    private void HashFile_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择要计算 SHA-256 的文件",
            Filter = "所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) != true) return;
        var record = _service.StartFileHash(dialog.FileName);
        TaskList.SelectedItem = record;
    }

    private void ScanWorkspace_Click(object sender, RoutedEventArgs e)
    {
        if (!Directory.Exists(_settings.WorkspaceRoot))
        {
            MessageBox.Show(Window.GetWindow(this), "请先在设置中选择有效的默认工作区。", "任务中心", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var record = _service.StartDirectoryStatistics(_settings.WorkspaceRoot);
        TaskList.SelectedItem = record;
    }

    private void ClearFinished_Click(object sender, RoutedEventArgs e)
    {
        _service.ClearFinished();
        if (_service.Tasks.Count == 0) SelectTask(null);
    }

    private void TaskList_SelectionChanged(object sender, SelectionChangedEventArgs e)
        => SelectTask(TaskList.SelectedItem as WorkbenchTaskRecord);

    private void SelectTask(WorkbenchTaskRecord? record)
    {
        _selected = record;
        UpdateDetails();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is not null) _service.Cancel(_selected.Id);
    }

    private void CopyResult_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        var value = !string.IsNullOrWhiteSpace(_selected.Result) ? _selected.Result : _selected.Error;
        if (string.IsNullOrWhiteSpace(value)) return;
        try { Clipboard.SetText(value); DetailType.Text = _selected.TypeLabel + " · 结果已复制"; }
        catch (Exception ex) { App.Log("Task result copy failed: " + ex.Message); }
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null) return;
        try
        {
            if (File.Exists(_selected.TargetPath))
            {
                Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + _selected.TargetPath + "\"") { UseShellExecute = true });
            }
            else if (Directory.Exists(_selected.TargetPath))
            {
                Process.Start(new ProcessStartInfo("explorer.exe", _selected.TargetPath) { UseShellExecute = true });
            }
        }
        catch (Exception ex) { App.Log("Task target open failed: " + ex.Message); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _service.Tasks.CollectionChanged -= Tasks_CollectionChanged;
        foreach (var record in _service.Tasks) record.PropertyChanged -= Record_PropertyChanged;
        _service.Dispose();
    }
}
