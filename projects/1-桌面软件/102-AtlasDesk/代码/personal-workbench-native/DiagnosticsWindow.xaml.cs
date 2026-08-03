using Microsoft.Win32;
using System.Diagnostics;
using System.Windows;

namespace PersonalWorkbench;

public partial class DiagnosticsWindow : Window
{
    private readonly AppSettings _settings;
    private IReadOnlyList<DiagnosticCheck> _checks = Array.Empty<DiagnosticCheck>();
    private CancellationTokenSource? _operationCancellation;
    private long _operationGeneration;

    public DiagnosticsWindow(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        VersionText.Text = "v" + WorkbenchVersion.Current;
        Loaded += async (_, _) => await RefreshAsync();
        Closed += (_, _) => CancelOperation();
    }

    private async Task RefreshAsync()
    {
        var operation = BeginOperation();
        LoadingPanel.Visibility = Visibility.Visible;
        ChecksList.Visibility = Visibility.Collapsed;
        StatusText.Text = "正在检查…";
        try
        {
            var checks = (await DiagnosticsService.RunAsync(_settings, operation.Token)).ToList();
            checks.Insert(0, UiAdaptiveAuditService.CreateDiagnosticCheck());
            if (!IsCurrent(operation)) return;
            _checks = checks;
            ChecksList.ItemsSource = _checks;
            var errors = _checks.Count(item => item.Severity == DiagnosticSeverity.Error);
            var warnings = _checks.Count(item => item.Severity == DiagnosticSeverity.Warning);
            StatusText.Text = errors > 0
                ? $"发现 {errors} 个异常、{warnings} 个注意项"
                : warnings > 0
                    ? $"检查完成 · {warnings} 个注意项"
                    : "检查完成 · 未发现异常";
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            App.Log("Diagnostics refresh failed: " + ex);
            if (IsCurrent(operation)) StatusText.Text = "检查失败：" + ex.Message;
        }
        finally
        {
            if (IsCurrent(operation))
            {
                LoadingPanel.Visibility = Visibility.Collapsed;
                ChecksList.Visibility = Visibility.Visible;
                CompleteOperation(operation);
            }
        }
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

    private void OpenLogs_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Directory.CreateDirectory(App.LogDirectory);
            Process.Start(new ProcessStartInfo("explorer.exe", App.LogDirectory) { UseShellExecute = true });
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "打开日志失败", MessageBoxButton.OK, MessageBoxImage.Error); }
    }

    private void CopySummary_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetText(DiagnosticsService.BuildSummary(_checks));
            StatusText.Text = "诊断摘要已复制";
        }
        catch (Exception ex) { StatusText.Text = "复制失败：" + ex.Message; }
    }

    private async void Export_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog
        {
            Title = "导出 AtlasDesk 支持包",
            Filter = "ZIP 支持包 (*.zip)|*.zip",
            FileName = $"AtlasDesk_Support_{DateTime.Now:yyyyMMdd_HHmmss}.zip",
            AddExtension = true,
            DefaultExt = ".zip"
        };
        if (dialog.ShowDialog(this) != true) return;

        var operation = BeginOperation();
        try
        {
            LoadingPanel.Visibility = Visibility.Visible;
            StatusText.Text = "正在生成支持包…";
            await DiagnosticsService.ExportSupportBundleAsync(_settings, dialog.FileName, operation.Token);
            if (IsCurrent(operation)) StatusText.Text = "支持包已导出 · " + dialog.FileName;
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            App.Log("Support bundle export failed: " + ex);
            if (IsCurrent(operation))
                MessageBox.Show(this, "导出失败：\n" + ex.Message, "诊断中心", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            if (IsCurrent(operation))
            {
                LoadingPanel.Visibility = Visibility.Collapsed;
                CompleteOperation(operation);
            }
        }
    }

    private OperationToken BeginOperation()
    {
        CancelOperation();
        var cancellation = new CancellationTokenSource();
        _operationCancellation = cancellation;
        return new OperationToken(
            Interlocked.Increment(ref _operationGeneration),
            cancellation,
            cancellation.Token);
    }

    private bool IsCurrent(OperationToken operation)
        => operation.Generation == _operationGeneration
           && ReferenceEquals(_operationCancellation, operation.Cancellation)
           && !operation.Token.IsCancellationRequested;

    private void CompleteOperation(OperationToken operation)
    {
        if (!ReferenceEquals(_operationCancellation, operation.Cancellation)) return;
        _operationCancellation = null;
        operation.Cancellation.Dispose();
    }

    private void CancelOperation()
    {
        Interlocked.Increment(ref _operationGeneration);
        var cancellation = Interlocked.Exchange(ref _operationCancellation, null);
        if (cancellation is null) return;
        try { cancellation.Cancel(); } catch { }
        cancellation.Dispose();
    }

    private readonly record struct OperationToken(
        long Generation,
        CancellationTokenSource Cancellation,
        CancellationToken Token);
}
