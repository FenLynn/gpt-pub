using Microsoft.Win32;
using System.Collections.Specialized;
using System.ComponentModel;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;

namespace PersonalWorkbench;

public partial class TaskCenterControl : UserControl, IDisposable
{
    private readonly AppSettings _settings;
    private readonly WorkbenchTaskService _service;
    private readonly ICollectionView _taskView;
    private WorkbenchTaskRecord? _selected;
    private bool _viewReady;
    private bool _disposed;

    public TaskCenterControl() : this(AppSettings.Load()) { }

    public TaskCenterControl(AppSettings settings)
    {
        _settings = settings;
        _service = WorkbenchTaskHub.Service;
        InitializeComponent();
        DataContext = _service;
        HistoryPathText.Text = WorkbenchTaskService.HistoryPath;
        _taskView = CollectionViewSource.GetDefaultView(_service.Tasks);
        _taskView.Filter = FilterTask;
        TaskList.ItemsSource = _taskView;
        _viewReady = true;
        _service.Tasks.CollectionChanged += Tasks_CollectionChanged;
        foreach (var record in _service.Tasks) record.PropertyChanged += Record_PropertyChanged;
        UpdateOverview();
        if (!_taskView.IsEmpty) TaskList.SelectedIndex = 0;
    }

    private void Tasks_CollectionChanged(object? sender, NotifyCollectionChangedEventArgs e)
    {
        if (e.OldItems is not null)
            foreach (WorkbenchTaskRecord item in e.OldItems) item.PropertyChanged -= Record_PropertyChanged;
        if (e.NewItems is not null)
            foreach (WorkbenchTaskRecord item in e.NewItems) item.PropertyChanged += Record_PropertyChanged;
        _taskView.Refresh();
        UpdateOverview();
        if (TaskList.SelectedItem is null && !_taskView.IsEmpty) TaskList.SelectedIndex = 0;
    }

    private void Record_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(WorkbenchTaskRecord.State) or nameof(WorkbenchTaskRecord.StateLabel))
            _taskView.Refresh();
        UpdateOverview();
        if (ReferenceEquals(sender, _selected)) UpdateDetails();
    }

    private bool FilterTask(object item)
    {
        if (item is not WorkbenchTaskRecord record) return false;
        var query = TaskSearchBox?.Text?.Trim() ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(query)
            && !record.Title.Contains(query, StringComparison.CurrentCultureIgnoreCase)
            && !record.TargetPath.Contains(query, StringComparison.CurrentCultureIgnoreCase)
            && !record.TypeLabel.Contains(query, StringComparison.CurrentCultureIgnoreCase))
            return false;

        var filter = (TaskFilter?.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "all";
        return filter switch
        {
            "active" => record.State is WorkbenchTaskState.Queued or WorkbenchTaskState.Running,
            "completed" => record.State == WorkbenchTaskState.Completed,
            "problem" => record.State is WorkbenchTaskState.Failed or WorkbenchTaskState.Cancelled,
            _ => true
        };
    }

    private void TaskFilter_Changed(object sender, EventArgs e)
    {
        if (!_viewReady) return;
        _taskView.Refresh();
        UpdateOverview();
        if (TaskList.SelectedItem is null && !_taskView.IsEmpty) TaskList.SelectedIndex = 0;
    }

    private void UpdateOverview()
    {
        var running = _service.Tasks.Count(item => item.State == WorkbenchTaskState.Running);
        var queued = _service.Tasks.Count(item => item.State == WorkbenchTaskState.Queued);
        RunningBadgeText.Text = queued > 0
            ? $"{running} 运行 · {queued} 排队"
            : running + " 个运行中";
        var visible = _taskView.Cast<object>().Count();
        VisibleCountText.Text = $"{visible} / {_service.Tasks.Count}";
        EmptyState.Visibility = visible == 0 ? Visibility.Visible : Visibility.Collapsed;
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
                    ? $"等待执行槽位 · 常规任务最多并行 {_service.MaxConcurrency} 个"
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
        SelectNewRecord(record);
    }

    private void ScanWorkspace_Click(object sender, RoutedEventArgs e)
    {
        if (!Directory.Exists(_settings.WorkspaceRoot))
        {
            MessageBox.Show(Window.GetWindow(this), "请先在设置中选择有效的默认工作区。", "任务中心", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        var record = _service.StartDirectoryStatistics(_settings.WorkspaceRoot);
        SelectNewRecord(record);
    }

    private void SelectNewRecord(WorkbenchTaskRecord record)
    {
        TaskFilter.SelectedIndex = 0;
        TaskSearchBox.Clear();
        _taskView.Refresh();
        TaskList.SelectedItem = record;
    }

    private void ClearFinished_Click(object sender, RoutedEventArgs e)
    {
        _service.ClearFinished();
        _taskView.Refresh();
        if (_taskView.IsEmpty) SelectTask(null);
        UpdateOverview();
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
        if (_selected is null) return;
        _service.Cancel(_selected.Id);
        FileIntegrityTaskBridge.Cancel(_selected.Id);
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
                Process.Start(new ProcessStartInfo("explorer.exe", "/select,\"" + _selected.TargetPath + "\"") { UseShellExecute = true });
            else if (Directory.Exists(_selected.TargetPath))
                Process.Start(new ProcessStartInfo("explorer.exe", _selected.TargetPath) { UseShellExecute = true });
        }
        catch (Exception ex) { App.Log("Task target open failed: " + ex.Message); }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _service.Tasks.CollectionChanged -= Tasks_CollectionChanged;
        foreach (var record in _service.Tasks) record.PropertyChanged -= Record_PropertyChanged;
    }
}
