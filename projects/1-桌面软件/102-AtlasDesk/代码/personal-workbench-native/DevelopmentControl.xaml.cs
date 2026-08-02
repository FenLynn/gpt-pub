using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class TerminalOpenRequestEventArgs : EventArgs
{
    public string Shell { get; init; } = "powershell";
    public PythonEnvironmentInfo? Environment { get; init; }
    public string Title { get; init; } = string.Empty;
    public string WorkingDirectory { get; init; } = string.Empty;
}

public partial class DevelopmentControl : UserControl
{
    private readonly AppSettings _settings;
    private bool _loaded;
    private bool _busy;
    private PythonDiscoveryResult? _discovery;
    private PythonEnvironmentInfo? _selected;

    public event EventHandler<TerminalOpenRequestEventArgs>? OpenTerminalRequested;

    public DevelopmentControl() : this(AppSettings.Load()) { }

    public DevelopmentControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();

        // Environment discovery is deliberately not bound to IsVisibleChanged.
        // This control is reparented while the development tabs are assembled;
        // visibility transitions during that process must not start background tools.
        // V070ProjectCenterEnhancer explicitly calls EnsureLoadedAsync only after the
        // Environment tab changes, and this control independently verifies that the
        // change came from an interaction inside the development TabControl.
    }

    public void InvalidateEnvironments()
    {
        if (_busy)
            return;

        _loaded = false;
        EnvironmentList.ItemsSource = null;
        _selected = null;
        UpdateEnvironmentDetails();
        StatusText.Text = "环境列表已失效，点击“刷新环境”重新检测。";
    }

    public async Task EnsureLoadedAsync()
    {
        if (_loaded || _busy)
            return;

        if (!AuthorizeInteractiveEnvironmentRequest())
            return;

        await RefreshAsync();
    }

    private bool AuthorizeInteractiveEnvironmentRequest()
    {
        var tabs = FindVisualAncestor<TabControl>(this);
        if (tabs is null)
            return IsKeyboardFocusWithin;

        var keyboardRequest = tabs.IsKeyboardFocusWithin;
        var mouseRequest = tabs.IsMouseOver
                           && Mouse.LeftButton == MouseButtonState.Pressed;
        if (keyboardRequest || mouseRequest)
            return true;

        // WPF can transiently select the Environment TabItem when the hidden
        // DevelopmentView is made visible. That is a layout/selection side effect,
        // not user intent. Restore the project page and never launch external tools.
        if (tabs.SelectedItem is TabItem selected
            && ReferenceEquals(selected.Content, this)
            && tabs.Items.Count > 0)
        {
            tabs.SelectedIndex = 0;
        }

        App.Log("Ignored non-interactive environment discovery request");
        return false;
    }

    private static T? FindVisualAncestor<T>(DependencyObject child) where T : DependencyObject
    {
        DependencyObject? current = child;
        while (current is not null)
        {
            if (current is T match)
                return match;
            current = VisualTreeHelper.GetParent(current);
        }
        return null;
    }

    private async Task RefreshAsync()
    {
        if (_busy)
            return;

        try
        {
            _busy = true;
            SetBusyState(true);
            StatusText.Text = "正在检测 Conda、uv、工作区 venv 与系统 Python…";

            _discovery = await PythonEnvironmentService.DiscoverAsync(_settings);
            EnvironmentList.ItemsSource = _discovery.Environments;
            CondaSummary.Text = string.IsNullOrWhiteSpace(_discovery.CondaExecutable)
                ? "未检测到 · 可在设置中手动指定"
                : string.IsNullOrWhiteSpace(_discovery.CondaVersion) ? "已检测" : _discovery.CondaVersion;
            UvSummary.Text = string.IsNullOrWhiteSpace(_discovery.UvExecutable)
                ? "未检测到 · 可选"
                : string.IsNullOrWhiteSpace(_discovery.UvVersion) ? "已检测" : _discovery.UvVersion;
            EnvironmentSummary.Text = $"{_discovery.Environments.Count} 个可用环境";
            StatusText.Text = $"发现 {_discovery.Environments.Count} 个环境。工作台未安装或携带任何 Python 包。";

            var settingsChanged = false;
            if (string.IsNullOrWhiteSpace(_settings.CondaPath) && !string.IsNullOrWhiteSpace(_discovery.CondaExecutable))
            {
                _settings.CondaPath = _discovery.CondaExecutable;
                settingsChanged = true;
            }
            if (string.IsNullOrWhiteSpace(_settings.UvPath) && !string.IsNullOrWhiteSpace(_discovery.UvExecutable))
            {
                _settings.UvPath = _discovery.UvExecutable;
                settingsChanged = true;
            }
            if (settingsChanged)
                _settings.Save();

            _loaded = true;
            if (_discovery.Environments.Count > 0)
            {
                var selected = _discovery.Environments
                    .Select((item, index) => new { item, index })
                    .FirstOrDefault(pair => string.Equals(
                        pair.item.Prefix,
                        _settings.SelectedPythonEnvironment,
                        StringComparison.OrdinalIgnoreCase));
                EnvironmentList.SelectedIndex = selected?.index ?? 0;
                EnvironmentList.ScrollIntoView(EnvironmentList.SelectedItem);
            }
            else
            {
                _selected = null;
                UpdateEnvironmentDetails();
            }
        }
        catch (Exception ex)
        {
            App.Log("Python discovery failed: " + ex);
            StatusText.Text = "环境检测失败：" + ex.Message;
        }
        finally
        {
            _busy = false;
            SetBusyState(false);
        }
    }

    private void SetBusyState(bool busy)
    {
        RefreshButton.IsEnabled = !busy;
        EnvironmentList.IsEnabled = !busy;
        DiscoveryProgress.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        if (_busy)
            return;

        _loaded = false;
        await RefreshAsync();
    }

    private void OpenPowerShell_Click(object sender, RoutedEventArgs e) =>
        OpenTerminalRequested?.Invoke(this, new TerminalOpenRequestEventArgs
        {
            Shell = "powershell",
            Title = "PowerShell",
            WorkingDirectory = _settings.WorkspaceRoot
        });

    private void OpenCmd_Click(object sender, RoutedEventArgs e) =>
        OpenTerminalRequested?.Invoke(this, new TerminalOpenRequestEventArgs
        {
            Shell = "cmd",
            Title = "CMD",
            WorkingDirectory = _settings.WorkspaceRoot
        });

    private void EnvironmentList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selected = EnvironmentList.SelectedItem as PythonEnvironmentInfo;
        UpdateEnvironmentDetails();
    }

    private void UpdateEnvironmentDetails()
    {
        if (_selected is null)
        {
            DetailName.Text = "选择一个 Python 环境";
            DetailKind.Text = DetailPython.Text = DetailPrefix.Text = DetailSource.Text = string.Empty;
            OpenIntegratedButton.IsEnabled = false;
            SetDefaultButton.IsEnabled = false;
            CopyPathButton.IsEnabled = false;
            OpenFolderButton.IsEnabled = false;
            return;
        }

        DetailName.Text = _selected.DisplayName
            + (string.IsNullOrWhiteSpace(_selected.Version) ? string.Empty : " · Python " + _selected.Version);
        DetailKind.Text = _selected.KindLabel;
        DetailPython.Text = _selected.PythonExecutable;
        DetailPrefix.Text = _selected.Prefix;
        DetailSource.Text = _selected.Source;
        OpenIntegratedButton.IsEnabled = true;
        SetDefaultButton.IsEnabled = true;
        CopyPathButton.IsEnabled = !string.IsNullOrWhiteSpace(_selected.PythonExecutable);
        OpenFolderButton.IsEnabled = Directory.Exists(_selected.Prefix);
    }

    private void EnvironmentList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (_selected is not null)
            OpenSelectedEnvironment();
    }

    private void OpenIntegrated_Click(object sender, RoutedEventArgs e) => OpenSelectedEnvironment();

    private void OpenSelectedEnvironment()
    {
        if (_selected is null)
            return;

        OpenTerminalRequested?.Invoke(this, new TerminalOpenRequestEventArgs
        {
            Shell = "cmd",
            Environment = _selected,
            Title = _selected.DisplayName,
            WorkingDirectory = Directory.Exists(_settings.WorkspaceRoot)
                ? _settings.WorkspaceRoot
                : _selected.Prefix
        });
    }

    private void SetDefault_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is null)
            return;

        _settings.SelectedPythonEnvironment = _selected.Prefix;
        _settings.Save();
        StatusText.Text = $"默认环境已设为：{_selected.DisplayName}";
    }

    private void CopyPath_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_selected?.PythonExecutable))
            Clipboard.SetText(_selected.PythonExecutable);
    }

    private void OpenFolder_Click(object sender, RoutedEventArgs e)
    {
        if (_selected is not null && Directory.Exists(_selected.Prefix))
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(
                "explorer.exe",
                _selected.Prefix)
            {
                UseShellExecute = true
            });
        }
    }
}
