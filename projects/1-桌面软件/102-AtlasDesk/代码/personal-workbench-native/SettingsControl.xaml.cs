using Microsoft.Win32;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public sealed class SettingsSavedEventArgs : EventArgs
{
    public bool DashboardChanged { get; init; }
    public bool WorkspaceChanged { get; init; }
    public bool ZoteroChanged { get; init; }
    public bool PythonChanged { get; init; }
    public bool TerminalChanged { get; init; }
}

public partial class SettingsControl : UserControl
{
    private enum PathExpectation { File, Directory }

    private static readonly Brush ValidPathBrush = new SolidColorBrush(Color.FromRgb(88, 163, 124));
    private static readonly Brush MissingPathBrush = new SolidColorBrush(Color.FromRgb(210, 142, 67));
    private static readonly Brush NeutralPathBrush = new SolidColorBrush(Color.FromRgb(216, 224, 234));

    private readonly AppSettings _settings;

    public event EventHandler<SettingsSavedEventArgs>? SettingsSaved;
    public event EventHandler? ClearAccessRequested;

    public SettingsControl() : this(AppSettings.Load()) { }

    public SettingsControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        InstallPathValidation();
        InstallDataBoundaryButtons();
        LoadFromSettings();
    }

    public void LoadFromSettings()
    {
        UserNameBox.Text = _settings.UserName;
        DashboardNameBox.Text = _settings.DashboardName;
        DashboardUrlBox.Text = _settings.DashboardUrl;
        WorkspaceBox.Text = _settings.WorkspaceRoot;
        WorkspaceAutoSaveCheck.IsChecked = _settings.WorkspaceAutoSave;
        WorkspaceHiddenCheck.IsChecked = _settings.WorkspaceShowHiddenFiles;
        WorkspaceRecentLimitBox.Text = _settings.WorkspaceRecentLimit.ToString();
        SelectComboByContent(WorkspaceFontSizeBox, _settings.WorkspaceEditorFontSize.ToString(), 2);
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
        SelectComboByContent(TerminalFontSizeBox, _settings.TerminalFontSize.ToString(), 2);
        TerminalHeightBox.Text = _settings.TerminalDrawerHeight.ToString();
        UpdatePdfControls();
        UpdateLoadModeControls();
        SaveStatus.Text = string.Empty;
        UpdateSecurityStatus();
        UpdateAllPathValidation();
    }

    private void InstallPathValidation()
    {
        DashboardUrlBox.TextChanged += (_, _) => UpdateDashboardValidation();
        WorkspaceBox.TextChanged += (_, _) => UpdatePathValidation(WorkspaceBox, PathExpectation.Directory, "工作区目录", optional: true);
        ZoteroBox.TextChanged += (_, _) => UpdatePathValidation(ZoteroBox, PathExpectation.File, "Zotero 数据库", optional: true);
        PdfReaderBox.TextChanged += (_, _) => UpdateAllPathValidation();
        CondaBox.TextChanged += (_, _) => UpdatePathValidation(CondaBox, PathExpectation.File, "Conda", optional: true);
        UvBox.TextChanged += (_, _) => UpdatePathValidation(UvBox, PathExpectation.File, "uv", optional: true);
    }

    private void InstallDataBoundaryButtons()
    {
        if (Content is not ScrollViewer { Content: Grid root }) return;
        var footer = root.Children.OfType<Grid>().FirstOrDefault(item => Grid.GetRow(item) == 10);
        var actions = footer?.Children.OfType<StackPanel>().FirstOrDefault(item => item.Orientation == Orientation.Horizontal);
        if (actions is null) return;

        actions.Children.Add(CreateFooterButton("打开 Runtime", "查看可整体覆盖升级的程序目录", (_, _) => OpenKnownDirectory(App.RuntimeDirectory, create: false)));
        actions.Children.Add(CreateFooterButton("打开日志", "查看本机日志目录；日志不会进入 Runtime 包", (_, _) => OpenKnownDirectory(App.LogDirectory, create: true)));
    }

    private static Button CreateFooterButton(string text, string tooltip, RoutedEventHandler click)
    {
        var button = new Button
        {
            Content = text,
            Style = Application.Current.TryFindResource("SecondaryButton") as Style,
            Height = 34,
            Margin = new Thickness(8, 0, 0, 0),
            ToolTip = tooltip
        };
        button.Click += click;
        return button;
    }

    private void UpdateAllPathValidation()
    {
        UpdateDashboardValidation();
        UpdatePathValidation(WorkspaceBox, PathExpectation.Directory, "工作区目录", optional: true);
        UpdatePathValidation(ZoteroBox, PathExpectation.File, "Zotero 数据库", optional: true);
        if (SystemPdfCheck.IsChecked == true)
        {
            PdfReaderBox.BorderBrush = NeutralPathBrush;
            PdfReaderBox.ToolTip = "当前使用系统默认 PDF 程序；自定义路径不会被调用。";
        }
        else
        {
            UpdatePathValidation(PdfReaderBox, PathExpectation.File, "PDF 阅读器", optional: false);
        }
        UpdatePathValidation(CondaBox, PathExpectation.File, "Conda", optional: true);
        UpdatePathValidation(UvBox, PathExpectation.File, "uv", optional: true);
    }

    private void UpdateDashboardValidation()
    {
        var value = DashboardUrlBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            DashboardUrlBox.BorderBrush = NeutralPathBrush;
            DashboardUrlBox.ToolTip = "可选；未配置时 Dashboard 页面会显示明确空状态。";
            return;
        }

        var valid = Uri.TryCreate(value, UriKind.Absolute, out var uri)
                    && uri.Scheme is Uri.UriSchemeHttp or Uri.UriSchemeHttps;
        DashboardUrlBox.BorderBrush = valid ? ValidPathBrush : MissingPathBrush;
        DashboardUrlBox.ToolTip = valid
            ? "地址格式有效；保存后才会应用。"
            : "地址必须以 http:// 或 https:// 开头。";
    }

    private static void UpdatePathValidation(TextBox box, PathExpectation expectation, string label, bool optional)
    {
        var value = box.Text.Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            box.BorderBrush = NeutralPathBrush;
            box.ToolTip = optional ? label + "未配置。" : label + "不能为空。";
            return;
        }

        var exists = expectation == PathExpectation.Directory ? Directory.Exists(value) : File.Exists(value);
        box.BorderBrush = exists ? ValidPathBrush : MissingPathBrush;
        box.ToolTip = exists
            ? label + "存在；保存后应用。"
            : label + "当前不存在。AtlasDesk 不会自动创建、搜索或猜测该路径。";
    }

    private static void SelectComboByContent(ComboBox box, string value, int fallbackIndex)
    {
        foreach (ComboBoxItem item in box.Items)
            if (item.Content?.ToString() == value) box.SelectedItem = item;
        box.SelectedIndex = box.SelectedIndex < 0 ? Math.Clamp(fallbackIndex, 0, box.Items.Count - 1) : box.SelectedIndex;
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        var url = DashboardUrlBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(url) && (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)))
        {
            MessageBox.Show("Dashboard 地址必须以 http:// 或 https:// 开头。", ProductIdentity.ProductName, MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (!int.TryParse(CalibrationLimitBox.Text, out var limit)) limit = 250;
        if (!int.TryParse(TerminalHeightBox.Text, out var terminalHeight)) terminalHeight = 320;
        if (!int.TryParse(WorkspaceRecentLimitBox.Text, out var recentLimit)) recentLimit = 12;
        var terminalFontText = (TerminalFontSizeBox.SelectedItem as ComboBoxItem)?.Content?.ToString();
        if (!int.TryParse(terminalFontText, out var terminalFont)) terminalFont = 14;
        var workspaceFontText = (WorkspaceFontSizeBox.SelectedItem as ComboBoxItem)?.Content?.ToString();
        if (!int.TryParse(workspaceFontText, out var workspaceFont)) workspaceFont = 14;
        var shell = (DefaultShellBox.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "powershell";
        var workspaceRoot = WorkspaceBox.Text.Trim();

        var dashboardChanged = !string.Equals(_settings.DashboardUrl.TrimEnd('/'), url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase)
                               || !string.Equals(_settings.DashboardName, DashboardNameBox.Text.Trim(), StringComparison.Ordinal);
        var workspaceChanged = !string.Equals(_settings.WorkspaceRoot, workspaceRoot, StringComparison.OrdinalIgnoreCase)
                               || _settings.WorkspaceAutoSave != (WorkspaceAutoSaveCheck.IsChecked == true)
                               || _settings.WorkspaceShowHiddenFiles != (WorkspaceHiddenCheck.IsChecked == true)
                               || _settings.WorkspaceEditorFontSize != workspaceFont
                               || _settings.WorkspaceRecentLimit != recentLimit;
        var zoteroChanged = !string.Equals(_settings.ZoteroDbPath, ZoteroBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)
                            || _settings.ZoteroLoadFullLibrary != (FullModeRadio.IsChecked == true)
                            || _settings.ZoteroCalibrationLimit != limit
                            || _settings.UseSystemPdfReader != (SystemPdfCheck.IsChecked == true)
                            || !string.Equals(_settings.PdfReaderPath, PdfReaderBox.Text.Trim(), StringComparison.OrdinalIgnoreCase);
        var pythonChanged = !string.Equals(_settings.WorkspaceRoot, workspaceRoot, StringComparison.OrdinalIgnoreCase)
                            || !string.Equals(_settings.CondaPath, CondaBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)
                            || !string.Equals(_settings.UvPath, UvBox.Text.Trim(), StringComparison.OrdinalIgnoreCase);
        var terminalChanged = !string.Equals(_settings.DefaultShell, shell, StringComparison.OrdinalIgnoreCase)
                              || _settings.TerminalFontSize != terminalFont
                              || _settings.TerminalDrawerHeight != terminalHeight;

        _settings.UserName = UserNameBox.Text.Trim();
        _settings.DashboardName = DashboardNameBox.Text.Trim();
        _settings.DashboardUrl = url;
        _settings.WorkspaceRoot = workspaceRoot;
        _settings.WorkspaceAutoSave = WorkspaceAutoSaveCheck.IsChecked == true;
        _settings.WorkspaceShowHiddenFiles = WorkspaceHiddenCheck.IsChecked == true;
        _settings.WorkspaceEditorFontSize = Math.Clamp(workspaceFont, 11, 24);
        _settings.WorkspaceRecentLimit = Math.Clamp(recentLimit, 4, 50);
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
            DashboardChanged = dashboardChanged,
            WorkspaceChanged = workspaceChanged,
            ZoteroChanged = zoteroChanged,
            PythonChanged = pythonChanged,
            TerminalChanged = terminalChanged
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

    private void SystemPdfCheck_Changed(object sender, RoutedEventArgs e)
    {
        UpdatePdfControls();
        UpdateAllPathValidation();
    }

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

    private void OpenConfig_Click(object sender, RoutedEventArgs e) => OpenKnownDirectory(App.AppDataDirectory, create: true);

    private void OpenSecurity_Click(object sender, RoutedEventArgs e)
    {
        new SecurityCenterWindow { Owner = Window.GetWindow(this) }.ShowDialog();
        UpdateSecurityStatus();
    }

    private void LockNow_Click(object sender, RoutedEventArgs e)
    {
        if (!SecurityService.IsPinEnabled)
        {
            MessageBox.Show("尚未设置四位临时密码。请先打开安全中心进行设置。",
                ProductIdentity.ProductName, MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        new TemporaryLockWindow { Owner = Window.GetWindow(this) }.ShowDialog();
    }

    private void OpenLocalData_Click(object sender, RoutedEventArgs e) => OpenKnownDirectory(App.LocalDataDirectory, create: true);

    private void OpenKnownDirectory(string path, bool create)
    {
        try
        {
            if (create) Directory.CreateDirectory(path);
            if (!Directory.Exists(path))
            {
                MessageBox.Show("目录当前不存在：\n" + path, ProductIdentity.ProductName, MessageBoxButton.OK, MessageBoxImage.Information);
                return;
            }
            Process.Start(new ProcessStartInfo("explorer.exe", path) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            App.Log("Open settings directory failed: " + ex);
            MessageBox.Show("无法打开目录：\n" + ex.Message, ProductIdentity.ProductName, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void UpdateSecurityStatus()
    {
        if (SecurityStatusText is not null)
            SecurityStatusText.Text = SecurityService.GetStatusSummary();
    }
}
