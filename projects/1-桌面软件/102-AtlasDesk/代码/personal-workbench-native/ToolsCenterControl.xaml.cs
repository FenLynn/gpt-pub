using Microsoft.Win32;
using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public partial class ToolsCenterControl : UserControl, IDisposable
{
    private readonly AppSettings _settings;
    private CancellationTokenSource? _operationCancellation;
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
        await RunOperationAsync("正在生成工作区清单…", async (progress, token) =>
        {
            var entries = await FileIntegrityService.CreateManifestAsync(_settings.WorkspaceRoot, dialog.FileName, progress, token);
            await FileIntegrityService.WriteManifestAtomicAsync(dialog.FileName, entries);
            VerificationList.ItemsSource = null;
            EmptyState.Visibility = Visibility.Visible;
            ResultTitle.Text = "清单已生成";
            ResultCountText.Text = entries.Count + " 个文件";
            _currentPath = dialog.FileName;
            _currentDetail = string.Join(Environment.NewLine, new[]
            {
                "SHA-256 清单已写入：", dialog.FileName, string.Empty,
                $"根目录：{_settings.WorkspaceRoot}", $"记录数：{entries.Count:N0}",
                "格式：AtlasDesk SHA256 v1"
            });
            DetailTitle.Text = "生成完成";
            DetailSubtitle.Text = "清单采用相对路径，不写入本机绝对工作区路径。";
            SelectedPathText.Text = dialog.FileName;
            DetailText.Text = _currentDetail;
            CopyButton.IsEnabled = true;
            OpenPathButton.IsEnabled = true;
        });
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

        await RunOperationAsync("正在验证清单…", async (progress, token) =>
        {
            var results = await FileIntegrityService.VerifyManifestAsync(dialog.FileName, root, progress, token);
            VerificationList.ItemsSource = results;
            EmptyState.Visibility = results.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            var matched = results.Count(item => item.Status == IntegrityVerificationStatus.Match);
            var missing = results.Count(item => item.Status == IntegrityVerificationStatus.Missing);
            var changed = results.Count(item => item.Status == IntegrityVerificationStatus.Changed);
            var unsafeCount = results.Count(item => item.Status == IntegrityVerificationStatus.UnsafePath);
            var errors = results.Count(item => item.Status == IntegrityVerificationStatus.Error);
            ResultTitle.Text = "清单验证结果";
            ResultCountText.Text = $"{matched} 匹配 · {results.Count - matched} 异常";
            _currentPath = dialog.FileName;
            _currentDetail = string.Join(Environment.NewLine, new[]
            {
                $"根目录：{root}", $"清单：{dialog.FileName}", string.Empty,
                $"匹配：{matched:N0}", $"缺失：{missing:N0}", $"改变：{changed:N0}",
                $"不安全路径：{unsafeCount:N0}", $"读取错误：{errors:N0}"
            });
            DetailTitle.Text = results.Count == matched ? "全部文件匹配" : "发现完整性差异";
            DetailSubtitle.Text = "点击左侧记录查看期望值与实际值。";
            SelectedPathText.Text = dialog.FileName;
            DetailText.Text = _currentDetail;
            CopyButton.IsEnabled = true;
            OpenPathButton.IsEnabled = true;
            if (results.Count > 0) VerificationList.SelectedIndex = 0;
        });
    }

    private async void Compare_Click(object sender, RoutedEventArgs e)
    {
        var first = SelectFile("选择第一个文件");
        if (string.IsNullOrWhiteSpace(first)) return;
        var second = SelectFile("选择第二个文件");
        if (string.IsNullOrWhiteSpace(second)) return;

        await RunOperationAsync("正在比较两个文件…", async (progress, token) =>
        {
            var result = await FileIntegrityService.CompareFilesAsync(first, second, progress, token);
            VerificationList.ItemsSource = null;
            EmptyState.Visibility = Visibility.Visible;
            ResultTitle.Text = result.IsIdentical ? "文件完全一致" : "文件不同";
            ResultCountText.Text = result.IsIdentical ? "SHA-256 与大小均相同" : "存在差异";
            _currentPath = first;
            _currentDetail = result.Summary;
            DetailTitle.Text = result.IsIdentical ? "比较通过" : "比较结果不同";
            DetailSubtitle.Text = "SHA-256 和文件大小已分别计算。";
            SelectedPathText.Text = first + Environment.NewLine + second;
            DetailText.Text = result.Summary;
            CopyButton.IsEnabled = true;
            OpenPathButton.IsEnabled = true;
        });
    }

    private async Task RunOperationAsync(
        string message,
        Func<IProgress<double>, CancellationToken, Task> operation)
    {
        _operationCancellation?.Cancel();
        _operationCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _operationCancellation = cancellation;
        SetBusy(true, message);
        var progress = new Progress<double>(value =>
        {
            OperationProgress.IsIndeterminate = value < 0;
            if (value >= 0) OperationProgress.Value = Math.Clamp(value, 0, 100);
            ProgressText.Text = value < 0 ? "处理中" : Math.Clamp(value, 0, 100).ToString("0") + "%";
        });
        try
        {
            await operation(progress, cancellation.Token);
            ProgressText.Text = "完成";
            OperationProgress.IsIndeterminate = false;
            OperationProgress.Value = 100;
        }
        catch (OperationCanceledException)
        {
            DetailTitle.Text = "操作已取消";
            DetailSubtitle.Text = "未完成的清单不会替换目标文件。";
            ProgressText.Text = "已取消";
        }
        catch (Exception ex)
        {
            App.Log("File integrity operation failed: " + ex);
            DetailTitle.Text = "操作失败";
            DetailSubtitle.Text = ex.Message;
            DetailText.Text = ex.ToString();
            ProgressText.Text = "失败";
            ShowMessage("操作失败：\n" + ex.Message, MessageBoxImage.Error);
        }
        finally
        {
            if (ReferenceEquals(_operationCancellation, cancellation))
            {
                _operationCancellation = null;
                cancellation.Dispose();
            }
            SetBusy(false, string.Empty);
        }
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
            DetailSubtitle.Text = "可随时取消；原文件不会被修改。";
            OperationProgress.Value = 0;
            OperationProgress.IsIndeterminate = false;
            ProgressText.Text = "0%";
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

    private void Cancel_Click(object sender, RoutedEventArgs e) => _operationCancellation?.Cancel();

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
        _operationCancellation?.Cancel();
        _operationCancellation?.Dispose();
        _operationCancellation = null;
    }
}
