using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;

namespace PersonalWorkbench;

public sealed class SettingsSavedEventArgs : EventArgs
{
    public bool DashboardChanged { get; init; }
    public bool ZoteroChanged { get; init; }
    public bool PythonChanged { get; init; }
    public bool TerminalChanged { get; init; }
}

public partial class SettingsControl : UserControl
{
    private readonly AppSettings _settings;

    public event EventHandler<SettingsSavedEventArgs>? SettingsSaved;
    public event EventHandler? ClearAccessRequested;

    public SettingsControl() : this(AppSettings.Load()) { }

    public SettingsControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        LoadFromSettings();
    }

    public void LoadFromSettings()
    {
        UserNameBox.Text = _settings.UserName;
        DashboardNameBox.Text = _settings.DashboardName;
        DashboardUrlBox.Text = _settings.DashboardUrl;
        WorkspaceBox.Text = _settings.WorkspaceRoot;
        ZoteroBox.Text = _settings.ZoteroDbPath;
        SystemPdfCheck.IsChecked = _settings.UseSystemPdfReader;
        PdfReaderBox.Text = _settings.PdfReaderPath;
        CalibrationModeRadio.IsChecked = !_settings.ZoteroLoadFullLibrary;
        FullModeRadio.IsChecked = _settings.ZoteroLoadFullLibrary;
        CalibrationLimitBox.Text = _settings.ZoteroCalibrationLimit.ToString();
        CondaBox.Text = _settings.CondaPath;
        UvBox.Text = _settings.UvPath;
        foreach (ComboBoxItem item in DefaultShellBox.Items)
            if (string.Equals(item.Tag?.ToString(), _settings.DefaultShell, StringComparison.OrdinalIgnoreCase))
                DefaultShellBox.SelectedItem = item;
        DefaultShellBox.SelectedIndex = DefaultShellBox.SelectedIndex < 0 ? 0 : DefaultShellBox.SelectedIndex;
        foreach (ComboBoxItem item in TerminalFontSizeBox.Items)
            if (item.Content?.ToString() == _settings.TerminalFontSize.ToString())
                TerminalFontSizeBox.SelectedItem = item;
        TerminalFontSizeBox.SelectedIndex = TerminalFontSizeBox.SelectedIndex < 0 ? 2 : TerminalFontSizeBox.SelectedIndex;
        TerminalHeightBox.Text = _settings.TerminalDrawerHeight.ToString();
        UpdatePdfControls();
        UpdateLoadModeControls();
        SaveStatus.Text = string.Empty;
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        var url = DashboardUrlBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(url) && (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)))
        {
            MessageBox.Show("Dashboard 地址必须以 http:// 或 https:// 开头。", "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (!int.TryParse(CalibrationLimitBox.Text, out var limit)) limit = 250;
        if (!int.TryParse(TerminalHeightBox.Text, out var terminalHeight)) terminalHeight = 320;
        var fontText = (TerminalFontSizeBox.SelectedItem as ComboBoxItem)?.Content?.ToString();
        if (!int.TryParse(fontText, out var terminalFont)) terminalFont = 14;
        var shell = (DefaultShellBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "powershell";

        var dashboardChanged = !string.Equals(_settings.DashboardUrl.TrimEnd('/'), url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)
                               || !string.Equals(_settings.DashboardName, DashboardNameBox.Text.Trim(), StringComparison.Ordinal);
        var zoteroChanged = !string.Equals(_settings.ZoteroDbPath, ZoteroBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)
                            || _settings.ZoteroLoadFullLibrary != (FullModeRadio.IsChecked == true)
                            || _settings.ZoteroCalibrationLimit != limit
                            || _settings.UseSystemPdfReader != (SystemPdfCheck.IsChecked == true)
                            || !string.Equals(_settings.PdfReaderPath, PdfReaderBox.Text.Trim(), StringComparison.OrdinalIgnoreCase);
        var pythonChanged = !string.Equals(_settings.WorkspaceRoot, WorkspaceBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)
                            || !string.Equals(_settings.CondaPath, CondaBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)
                            || !string.Equals(_settings.UvPath, UvBox.Text.Trim(), StringComparison.OrdinalIgnoreCase);
        var terminalChanged = !string.Equals(_settings.DefaultShell, shell, StringComparison.OrdinalIgnoreCase)
                              || _settings.TerminalFontSize != terminalFont
                              || _settings.TerminalDrawerHeight != terminalHeight;

        _settings.UserName = UserNameBox.Text.Trim();
        _settings.DashboardName = DashboardNameBox.Text.Trim();
        _settings.DashboardUrl = url;
        _settings.WorkspaceRoot = WorkspaceBox.Text.Trim();
        _settings.ZoteroDbPath = ZoteroBox.Text.Trim();
        _settings.ZoteroLoadFullLibrary = FullModeRadio.IsChecked == true;
        _settings.ZoteroCalibrationLimit = Math.Clamp(limit, 50, 5000);
        _settings.UseSystemPdfReader = SystemPdfCheck.IsChecked == true;
        _settings.PdfReaderPath = PdfReaderBox.Text.Trim();
        _settings.CondaPath = CondaBox.Text.Trim();
        _settings.UvPath = UvBox.Text.Trim();
        _settings.DefaultShell = shell;
        _settings.TerminalFontSize = Math.Clamp(terminalFont, 10, 24);
        _settings.TerminalDrawerHeight = Math.Clamp(terminalHeight, 180, 700);
        _settings.Save();
        LoadFromSettings();
        SaveStatus.Text = "已保存";
        SettingsSaved?.Invoke(this, new SettingsSavedEventArgs
        {
            DashboardChanged = dashboardChanged, ZoteroChanged = zoteroChanged,
            PythonChanged = pythonChanged, TerminalChanged = terminalChanged
        });
    }

    private void DetectZotero_Click(object sender, RoutedEventArgs e)
    {
        var candidates = ZoteroLibrary.DetectDatabaseCandidates();
        if (candidates.Count == 0)
        {
            MessageBox.Show("未自动找到 zotero.sqlite。", "Zotero", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        ZoteroBox.Text = candidates[0];
        SaveStatus.Text = candidates.Count == 1 ? "已找到 Zotero 数据库" : $"发现 {candidates.Count} 个候选，已选择第一个";
    }

    private void BrowseZotero_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 Zotero 数据库", Filter = "Zotero 数据库 (zotero.sqlite)|zotero.sqlite|SQLite 数据库 (*.sqlite)|*.sqlite|所有文件 (*.*)|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) ZoteroBox.Text = dialog.FileName;
    }

    private void BrowsePdfReader_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Title = "选择 PDF 阅读器", Filter = "可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*", CheckFileExists = true };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true)
        {
            PdfReaderBox.Text = dialog.FileName;
            SystemPdfCheck.IsChecked = false;
        }
    }

    private void BrowseWorkspace_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "选择默认工作区目录", Multiselect = false };
        if (Directory.Exists(WorkspaceBox.Text)) dialog.InitialDirectory = WorkspaceBox.Text;
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) WorkspaceBox.Text = dialog.FolderName;
    }

    private void BrowseConda_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 conda.exe 或 conda.bat", Filter = "Conda (conda.exe;conda.bat)|conda.exe;conda.bat|可执行文件 (*.exe;*.bat)|*.exe;*.bat|所有文件 (*.*)|*.*", CheckFileExists = true
        };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) CondaBox.Text = dialog.FileName;
    }

    private void BrowseUv_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Title = "选择 uv.exe", Filter = "uv (uv.exe)|uv.exe|可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*", CheckFileExists = true };
        if (dialog.ShowDialog(Window.GetWindow(this)) == true) UvBox.Text = dialog.FileName;
    }

    private void SystemPdfCheck_Changed(object sender, RoutedEventArgs e) => UpdatePdfControls();
    private void LoadMode_Changed(object sender, RoutedEventArgs e) => UpdateLoadModeControls();

    private void UpdatePdfControls()
    {
        if (PdfReaderBox is null) return;
        var custom = SystemPdfCheck.IsChecked != true;
        PdfReaderBox.IsEnabled = custom;
        PdfReaderBox.Opacity = custom ? 1 : 0.55;
    }

    private void UpdateLoadModeControls()
    {
        if (CalibrationLimitBox is null) return;
        CalibrationLimitBox.IsEnabled = CalibrationModeRadio.IsChecked == true;
        CalibrationLimitBox.Opacity = CalibrationLimitBox.IsEnabled ? 1 : 0.55;
    }

    private void ClearAccess_Click(object sender, RoutedEventArgs e) => ClearAccessRequested?.Invoke(this, EventArgs.Empty);

    private void OpenConfig_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(App.AppDataDirectory);
        Process.Start(new ProcessStartInfo("explorer.exe", App.AppDataDirectory) { UseShellExecute = true });
    }
}
