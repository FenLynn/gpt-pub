using Microsoft.Win32;
using System.Diagnostics;
using System.Windows;

namespace PersonalWorkbench;

public partial class DiagnosticsWindow : Window
{
    private readonly AppSettings _settings;
    private IReadOnlyList<DiagnosticCheck> _checks = Array.Empty<DiagnosticCheck>();

    public DiagnosticsWindow(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        VersionText.Text = "v" + WorkbenchVersion.Current;
        Loaded += async (_, _) => await RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        LoadingPanel.Visibility = Visibility.Visible;
        ChecksList.Visibility = Visibility.Collapsed;
        StatusText.Text = "正在检查…";
        try
        {
            _checks = await DiagnosticsService.RunAsync(_settings);
            ChecksList.ItemsSource = _checks;
            var errors = _checks.Count(item => item.Severity == DiagnosticSeverity.Error);
            var warnings = _checks.Count(item => item.Severity == DiagnosticSeverity.Warning);
            StatusText.Text = errors > 0 ? $"发现 {errors} 个异常、{warnings} 个注意项" : warnings > 0 ? $"检查完成 · {warnings} 个注意项" : "检查完成 · 未发现异常";
        }
        catch (Exception ex)
        {
            App.Log("Diagnostics refresh failed: " + ex);
            StatusText.Text = "检查失败：" + ex.Message;
        }
        finally
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            ChecksList.Visibility = Visibility.Visible;
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
        try
        {
            StatusText.Text = "正在生成支持包…";
            await DiagnosticsService.ExportSupportBundleAsync(_settings, dialog.FileName);
            StatusText.Text = "支持包已导出 · " + dialog.FileName;
        }
        catch (Exception ex)
        {
            App.Log("Support bundle export failed: " + ex);
            MessageBox.Show(this, "导出失败：\n" + ex.Message, "诊断中心", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }
}
