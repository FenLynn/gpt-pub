using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PersonalWorkbench;

public partial class MainWindow : Window
{
    private readonly AppSettings _settings;
    private WebView2? _dashboardWebView;
    private CoreWebView2Environment? _webViewEnvironment;
    private Window? _dashboardPopup;
    private WebView2? _popupWebView;
    private bool _sidebarCollapsed;
    private bool _focusMode;
    private bool _isInitializingDashboard;
    private bool _dashboardHasNavigated;
    private string _dashboardRootUrl = string.Empty;
    private bool _zoteroInitialized;
    private bool _pythonInitialized;
    private string _currentView = "home";
    private ZoteroRecord? _selectedZoteroRecord;
    private PythonEnvironmentInfo? _selectedPythonEnvironment;
    private PythonDiscoveryResult? _pythonDiscovery;

    private WindowStyle _savedWindowStyle;
    private WindowState _savedWindowState;
    private ResizeMode _savedResizeMode;
    private Thickness _savedRootMargin;

    public MainWindow()
    {
        _settings = AppSettings.Load();
        InitializeComponent();

        _sidebarCollapsed = _settings.SidebarCollapsed;
        LoadSettingsIntoUi();
        ApplySidebarState();
        UpdateHomeStatus();

        PreviewKeyDown += MainWindow_PreviewKeyDown;
        Loaded += MainWindow_Loaded;
        Closed += MainWindow_Closed;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        App.Log("Main window loaded");
        if (_settings.DashboardAutoOpen && IsValidHttpUrl(_settings.DashboardUrl))
        {
            DashboardNav.IsChecked = true;
            await ShowViewAsync("dashboard");
        }
    }

    private void MainWindow_Closed(object? sender, EventArgs e)
    {
        try
        {
            _dashboardPopup?.Close();
            _popupWebView?.Dispose();
            _dashboardWebView?.Dispose();
        }
        catch (Exception ex)
        {
            App.Log("Shutdown cleanup failed: " + ex);
        }
    }

    private void LoadSettingsIntoUi()
    {
        UserNameText.Text = string.IsNullOrWhiteSpace(_settings.UserName) ? "Fenlynn" : _settings.UserName;
        UserCard.ToolTip = UserNameText.Text + " · 本地工作台";
        UserNameBox.Text = _settings.UserName;
        DashboardNameBox.Text = _settings.DashboardName;
        DashboardUrlBox.Text = _settings.DashboardUrl;
        WorkspaceBox.Text = _settings.WorkspaceRoot;
        ZoteroBox.Text = _settings.ZoteroDbPath;
        CondaBox.Text = _settings.CondaPath;
        UvBox.Text = _settings.UvPath;
        ZoteroPathText.Text = _settings.ZoteroDbPath;
    }

    private void UpdateHomeStatus()
    {
        HomeZoteroStatus.Text = File.Exists(_settings.ZoteroDbPath)
            ? "已绑定 " + Path.GetFileName(Path.GetDirectoryName(_settings.ZoteroDbPath) ?? "Zotero")
            : "等待首次定位";

        if (!string.IsNullOrWhiteSpace(_settings.CondaPath) || !string.IsNullOrWhiteSpace(_settings.UvPath))
            HomePythonStatus.Text = "已保存环境工具路径";
        else
            HomePythonStatus.Text = "等待首次检测";
    }

    private async void Navigation_Checked(object sender, RoutedEventArgs e)
    {
        if (!IsLoaded || sender is not RadioButton radio || radio.Tag is not string view)
            return;

        await ShowViewAsync(view);
    }

    private async Task ShowViewAsync(string view)
    {
        _currentView = view;
        HomeView.Visibility = Visibility.Collapsed;
        DashboardView.Visibility = Visibility.Collapsed;
        LibraryView.Visibility = Visibility.Collapsed;
        DevelopmentView.Visibility = Visibility.Collapsed;
        PlaceholderView.Visibility = Visibility.Collapsed;
        SettingsView.Visibility = Visibility.Collapsed;
        BrowserControls.Visibility = Visibility.Collapsed;
        AccessBadge.Visibility = Visibility.Collapsed;
        PopoutButton.Visibility = Visibility.Collapsed;
        FullscreenButton.Visibility = Visibility.Collapsed;
        NavigationProgress.Visibility = Visibility.Collapsed;

        switch (view)
        {
            case "home":
                PageTitle.Text = "首页";
                PageSubtitle.Text = "  ·  Personal Workbench";
                HomeView.Visibility = Visibility.Visible;
                break;

            case "dashboard":
                PageTitle.Text = string.IsNullOrWhiteSpace(_settings.DashboardName) ? "Dashboard" : _settings.DashboardName;
                PageSubtitle.Text = Uri.TryCreate(_dashboardWebView?.Source?.AbsoluteUri ?? _settings.DashboardUrl, UriKind.Absolute, out var dashUri)
                    ? "  ·  " + dashUri.Host
                    : "  ·  Cloudflare Pages";
                DashboardView.Visibility = Visibility.Visible;
                BrowserControls.Visibility = Visibility.Visible;
                AccessBadge.Visibility = Visibility.Visible;
                PopoutButton.Visibility = Visibility.Visible;
                FullscreenButton.Visibility = Visibility.Visible;
                await EnsureDashboardAsync();
                break;

            case "library":
                PageTitle.Text = "资料库";
                PageSubtitle.Text = "  ·  Zotero 只读检索";
                LibraryView.Visibility = Visibility.Visible;
                await EnsureZoteroReadyAsync();
                break;

            case "development":
                PageTitle.Text = "开发";
                PageSubtitle.Text = "  ·  Conda 与 uv";
                DevelopmentView.Visibility = Visibility.Visible;
                await EnsurePythonReadyAsync();
                break;

            case "settings":
                PageTitle.Text = "设置";
                PageSubtitle.Text = "  ·  本地路径与服务";
                SettingsView.Visibility = Visibility.Visible;
                LoadSettingsIntoUi();
                break;

            default:
                var titles = new Dictionary<string, (string title, string subtitle)>
                {
                    ["workspace"] = ("工作区", "项目上下文与快捷动作"),
                    ["tools"] = ("工具", "本地软件与批处理模块"),
                    ["tasks"] = ("任务", "统一队列、进度与历史")
                };
                (string title, string subtitle) text = titles.TryGetValue(view, out var item)
                    ? item
                    : ("模块", "功能准备中");
                PageTitle.Text = text.title;
                PageSubtitle.Text = "  ·  " + text.subtitle;
                PlaceholderTitle.Text = text.title;
                PlaceholderSubtitle.Text = text.subtitle;
                PlaceholderView.Visibility = Visibility.Visible;
                break;
        }
    }

    private async Task EnsureDashboardAsync(bool forceReload = false)
    {
        if (!IsValidHttpUrl(_settings.DashboardUrl))
        {
            DashboardEmpty.Visibility = Visibility.Visible;
            DashboardError.Visibility = Visibility.Collapsed;
            DashboardHost.Visibility = Visibility.Collapsed;
            AccessStatusText.Text = "尚未配置";
            return;
        }

        DashboardEmpty.Visibility = Visibility.Collapsed;
        DashboardError.Visibility = Visibility.Collapsed;
        DashboardHost.Visibility = Visibility.Visible;

        if (_isInitializingDashboard)
            return;

        try
        {
            _isInitializingDashboard = true;
            if (_currentView == "dashboard")
                NavigationProgress.Visibility = Visibility.Visible;

            if (_webViewEnvironment is null)
            {
                var profilePath = Path.Combine(App.AppDataDirectory, "WebView2Profile");
                Directory.CreateDirectory(profilePath);
                App.Log("Creating WebView2 environment at " + profilePath);
                _webViewEnvironment = await CoreWebView2Environment.CreateAsync(null, profilePath, null);
            }

            if (_dashboardWebView is null)
            {
                _dashboardWebView = new WebView2
                {
                    HorizontalAlignment = HorizontalAlignment.Stretch,
                    VerticalAlignment = VerticalAlignment.Stretch,
                    ZoomFactor = 1.0
                };
                DashboardHost.Children.Add(_dashboardWebView);
                await _dashboardWebView.EnsureCoreWebView2Async(_webViewEnvironment);
                ConfigureWebView(_dashboardWebView, isMainDashboard: true);
                App.Log("Main Dashboard WebView2 initialized");
            }

            var configuredRoot = _settings.DashboardUrl.TrimEnd('/');
            if (!_dashboardHasNavigated || !string.Equals(_dashboardRootUrl, configuredRoot, StringComparison.OrdinalIgnoreCase))
            {
                App.Log("Navigating Dashboard to " + _settings.DashboardUrl);
                _dashboardRootUrl = configuredRoot;
                _dashboardHasNavigated = true;
                _dashboardWebView.Source = new Uri(_settings.DashboardUrl);
            }
            else if (forceReload)
            {
                App.Log("Reloading current Dashboard page");
                _dashboardWebView.Reload();
            }
            else
            {
                // Intentionally do nothing. The existing WebView remains alive in the background,
                // preserving the current route, scroll position, forms and JavaScript state.
                if (_currentView == "dashboard")
                    NavigationProgress.Visibility = Visibility.Collapsed;
            }
        }
        catch (Exception ex)
        {
            App.Log("Dashboard initialization failed: " + ex);
            ShowDashboardError(ex);
        }
        finally
        {
            _isInitializingDashboard = false;
        }
    }

    private void ConfigureWebView(WebView2 view, bool isMainDashboard)
    {
        if (view.CoreWebView2 is null)
            return;

        var core = view.CoreWebView2;
        core.Settings.AreDefaultScriptDialogsEnabled = true;
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = true;
        core.Settings.AreBrowserAcceleratorKeysEnabled = true;

        core.NavigationStarting += (_, args) =>
        {
            if (_currentView == "dashboard")
                NavigationProgress.Visibility = Visibility.Visible;
            UpdateAccessStatus(args.Uri);
            App.Log("Navigation starting: " + args.Uri);
        };

        core.NavigationCompleted += (_, args) =>
        {
            if (_currentView == "dashboard")
                NavigationProgress.Visibility = Visibility.Collapsed;
            if (!args.IsSuccess)
            {
                App.Log($"Navigation failed: {args.WebErrorStatus}");
                if (isMainDashboard && _currentView == "dashboard")
                {
                    DashboardErrorText.Text = "页面载入失败：" + args.WebErrorStatus + "\n\n请确认地址、网络和 Cloudflare Access 配置。";
                    DashboardError.Visibility = Visibility.Visible;
                }
            }
            else if (isMainDashboard)
            {
                DashboardError.Visibility = Visibility.Collapsed;
            }
        };

        core.SourceChanged += (_, _) =>
        {
            var source = core.Source;
            UpdateAccessStatus(source);
            if (isMainDashboard && _currentView == "dashboard" && Uri.TryCreate(source, UriKind.Absolute, out var uri))
                PageSubtitle.Text = "  ·  " + uri.Host;
        };

        core.DocumentTitleChanged += (_, _) =>
        {
            if (isMainDashboard && _currentView == "dashboard" && !string.IsNullOrWhiteSpace(core.DocumentTitle))
                PageTitle.Text = core.DocumentTitle.Length > 42 ? core.DocumentTitle[..42] + "…" : core.DocumentTitle;
        };

        core.NewWindowRequested += async (_, args) => await HandleNewWindowRequestedAsync(args);
        core.ProcessFailed += (_, args) =>
        {
            App.Log("WebView2 process failed: " + args.ProcessFailedKind);
            if (isMainDashboard)
                Dispatcher.Invoke(() => ShowDashboardError(new InvalidOperationException("WebView2 进程异常退出：" + args.ProcessFailedKind)));
        };
    }

    private async Task HandleNewWindowRequestedAsync(CoreWebView2NewWindowRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            App.Log("New window requested: " + args.Uri);
            if (_webViewEnvironment is null)
                return;

            var popupView = new WebView2();
            var popup = new Window
            {
                Title = "Cloudflare Access 登录",
                Width = 1080,
                Height = 760,
                MinWidth = 720,
                MinHeight = 520,
                WindowStartupLocation = WindowStartupLocation.CenterOwner,
                Owner = this,
                Background = Brushes.White,
                Content = popupView
            };

            await popupView.EnsureCoreWebView2Async(_webViewEnvironment);
            ConfigureWebView(popupView, isMainDashboard: false);
            args.NewWindow = popupView.CoreWebView2;
            args.Handled = true;
            popup.Closed += (_, _) =>
            {
                popupView.Dispose();
                try
                {
                    if (!_dashboardHasNavigated && IsValidHttpUrl(_settings.DashboardUrl))
                        _dashboardWebView?.CoreWebView2.Navigate(_settings.DashboardUrl);
                    else
                        _dashboardWebView?.Reload();
                }
                catch { }
            };
            popup.Show();
        }
        catch (Exception ex)
        {
            App.Log("New window handling failed: " + ex);
            args.Handled = false;
        }
        finally
        {
            deferral.Complete();
        }
    }

    private void UpdateAccessStatus(string? source)
    {
        if (string.IsNullOrWhiteSpace(source))
        {
            AccessStatusText.Text = "会话目录已启用";
            return;
        }

        var lower = source.ToLowerInvariant();
        AccessStatusText.Text = lower.Contains("github.com/login") || lower.Contains("cloudflareaccess.com") || lower.Contains("/cdn-cgi/access/")
            ? "正在验证 Access"
            : "Access 会话已保存";
    }

    private void ShowDashboardError(Exception ex)
    {
        DashboardHost.Visibility = Visibility.Collapsed;
        DashboardEmpty.Visibility = Visibility.Collapsed;
        DashboardError.Visibility = Visibility.Visible;
        DashboardErrorText.Text = ex.Message + "\n\n日志：" + App.LogPath;
        NavigationProgress.Visibility = Visibility.Collapsed;
    }

    private async Task EnsureZoteroReadyAsync()
    {
        ZoteroPathText.Text = _settings.ZoteroDbPath;
        if (_zoteroInitialized)
            return;

        if (!File.Exists(_settings.ZoteroDbPath))
        {
            var candidates = ZoteroLibrary.DetectDatabaseCandidates();
            if (candidates.Count > 0)
            {
                _settings.ZoteroDbPath = candidates[0];
                _settings.Save();
                ZoteroBox.Text = _settings.ZoteroDbPath;
                ZoteroPathText.Text = _settings.ZoteroDbPath;
                ZoteroStatusText.Text = candidates.Count == 1
                    ? "已自动定位 Zotero 数据库。"
                    : $"自动发现 {candidates.Count} 个数据库，当前使用第一个；可点击“手动选择”更换。";
            }
            else
            {
                ZoteroStatusText.Text = "未自动找到 zotero.sqlite，请点击“手动选择”。";
                HomeZoteroStatus.Text = "未找到数据库";
                return;
            }
        }

        await SearchZoteroAsync(string.Empty);
        _zoteroInitialized = true;
    }

    private async Task SearchZoteroAsync(string? query)
    {
        if (!File.Exists(_settings.ZoteroDbPath))
        {
            ZoteroStatusText.Text = "请先选择有效的 zotero.sqlite。";
            return;
        }

        try
        {
            ZoteroStatusText.Text = "正在读取 Zotero 数据库…";
            var results = await ZoteroLibrary.SearchAsync(_settings.ZoteroDbPath, query, 250);
            ZoteroResults.ItemsSource = results;
            ZoteroStatusText.Text = string.IsNullOrWhiteSpace(query)
                ? $"最近文献 {results.Count} 条（最多显示 250 条）"
                : $"找到 {results.Count} 条匹配结果";
            HomeZoteroStatus.Text = $"数据库已就绪 · {results.Count} 条已载入";
            if (results.Count > 0)
                ZoteroResults.SelectedIndex = 0;
        }
        catch (Exception ex)
        {
            App.Log("Zotero search failed: " + ex);
            ZoteroStatusText.Text = "读取失败：" + ex.Message;
            MessageBox.Show("Zotero 数据库读取失败：\n\n" + ex.Message + "\n\n数据库始终以只读方式打开，原文件未被修改。", "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async Task EnsurePythonReadyAsync()
    {
        if (_pythonInitialized)
            return;
        await RefreshPythonEnvironmentsAsync();
    }

    private async Task RefreshPythonEnvironmentsAsync()
    {
        try
        {
            PythonStatusText.Text = "正在检测 Conda、uv、工作区 venv 与系统 Python…";
            _pythonDiscovery = await PythonEnvironmentService.DiscoverAsync(_settings);
            PythonEnvironments.ItemsSource = _pythonDiscovery.Environments;

            CondaStatusText.Text = string.IsNullOrWhiteSpace(_pythonDiscovery.CondaExecutable)
                ? "未检测到；可手动指定 conda.exe 或 conda.bat"
                : $"{_pythonDiscovery.CondaVersion} · {_pythonDiscovery.CondaExecutable}";
            UvStatusText.Text = string.IsNullOrWhiteSpace(_pythonDiscovery.UvExecutable)
                ? "未检测到；uv 为可选工具"
                : $"{_pythonDiscovery.UvVersion} · {_pythonDiscovery.UvExecutable}";

            if (string.IsNullOrWhiteSpace(_settings.CondaPath) && !string.IsNullOrWhiteSpace(_pythonDiscovery.CondaExecutable))
                _settings.CondaPath = _pythonDiscovery.CondaExecutable;
            if (string.IsNullOrWhiteSpace(_settings.UvPath) && !string.IsNullOrWhiteSpace(_pythonDiscovery.UvExecutable))
                _settings.UvPath = _pythonDiscovery.UvExecutable;
            _settings.Save();
            CondaBox.Text = _settings.CondaPath;
            UvBox.Text = _settings.UvPath;

            PythonStatusText.Text = $"发现 {_pythonDiscovery.Environments.Count} 个可用 Python 环境。软件未安装任何 Python 包。";
            HomePythonStatus.Text = $"已发现 {_pythonDiscovery.Environments.Count} 个环境";
            _pythonInitialized = true;

            if (_pythonDiscovery.Environments.Count > 0)
            {
                var selectedIndex = 0;
                if (!string.IsNullOrWhiteSpace(_settings.SelectedPythonEnvironment))
                {
                    var match = _pythonDiscovery.Environments
                        .Select((item, index) => new { item, index })
                        .FirstOrDefault(pair => string.Equals(pair.item.Prefix, _settings.SelectedPythonEnvironment, StringComparison.OrdinalIgnoreCase));
                    if (match is not null)
                        selectedIndex = match.index;
                }
                PythonEnvironments.SelectedIndex = selectedIndex;
            }
        }
        catch (Exception ex)
        {
            App.Log("Python discovery failed: " + ex);
            PythonStatusText.Text = "环境检测失败：" + ex.Message;
        }
    }

    private void ToggleSidebar_Click(object sender, RoutedEventArgs e)
    {
        _sidebarCollapsed = !_sidebarCollapsed;
        _settings.SidebarCollapsed = _sidebarCollapsed;
        _settings.Save();
        ApplySidebarState();
    }

    private void ApplySidebarState()
    {
        SidebarColumn.Width = new GridLength(_sidebarCollapsed ? 64 : 224);
        BrandText.Visibility = _sidebarCollapsed ? Visibility.Collapsed : Visibility.Visible;
        CommandButton.Visibility = _sidebarCollapsed ? Visibility.Collapsed : Visibility.Visible;
        WorkLabel.Visibility = _sidebarCollapsed ? Visibility.Collapsed : Visibility.Visible;
        AbilityLabel.Visibility = _sidebarCollapsed ? Visibility.Collapsed : Visibility.Visible;
        UserText.Visibility = _sidebarCollapsed ? Visibility.Collapsed : Visibility.Visible;

        foreach (var text in new[] { HomeNavText, WorkspaceNavText, LibraryNavText, DevelopmentNavText, ToolsNavText, DashboardNavText, TasksNavText, SettingsNavText })
            text.Visibility = _sidebarCollapsed ? Visibility.Collapsed : Visibility.Visible;
    }

    private async void OpenDashboard_Click(object sender, RoutedEventArgs e)
    {
        DashboardNav.IsChecked = true;
        await ShowViewAsync("dashboard");
    }

    private async void OpenLibrary_Click(object sender, RoutedEventArgs e)
    {
        LibraryNav.IsChecked = true;
        await ShowViewAsync("library");
    }

    private async void OpenDevelopment_Click(object sender, RoutedEventArgs e)
    {
        DevelopmentNav.IsChecked = true;
        await ShowViewAsync("development");
    }

    private void OpenSettings_Click(object sender, RoutedEventArgs e) => SettingsNav.IsChecked = true;

    private async void RetryDashboard_Click(object sender, RoutedEventArgs e)
    {
        DashboardHost.Visibility = Visibility.Visible;
        DashboardError.Visibility = Visibility.Collapsed;
        await EnsureDashboardAsync(forceReload: true);
    }

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        if (_dashboardWebView?.CoreWebView2?.CanGoBack == true)
            _dashboardWebView.CoreWebView2.GoBack();
    }

    private void Forward_Click(object sender, RoutedEventArgs e)
    {
        if (_dashboardWebView?.CoreWebView2?.CanGoForward == true)
            _dashboardWebView.CoreWebView2.GoForward();
    }

    private void Refresh_Click(object sender, RoutedEventArgs e) => _dashboardWebView?.Reload();

    private async void DashboardHome_Click(object sender, RoutedEventArgs e)
    {
        if (IsValidHttpUrl(_settings.DashboardUrl))
        {
            await EnsureDashboardAsync();
            _dashboardWebView!.Source = new Uri(_settings.DashboardUrl);
        }
    }

    private async void Popout_Click(object sender, RoutedEventArgs e)
    {
        if (_dashboardPopup is not null)
        {
            DockDashboard();
            return;
        }

        await EnsureDashboardAsync();
        if (_webViewEnvironment is null || _dashboardWebView is null)
            return;

        try
        {
            var source = _dashboardWebView.Source?.AbsoluteUri ?? _settings.DashboardUrl;
            _popupWebView = new WebView2();
            var host = new Grid { Background = Brushes.White };
            host.Children.Add(_popupWebView);

            _dashboardPopup = new Window
            {
                Title = _settings.DashboardName,
                Width = 1280,
                Height = 820,
                MinWidth = 800,
                MinHeight = 560,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Background = Brushes.White,
                Content = host
            };

            _dashboardPopup.Closing += (_, args) =>
            {
                args.Cancel = true;
                DockDashboard();
            };
            _dashboardPopup.PreviewKeyDown += (_, args) =>
            {
                if (args.Key == Key.F11)
                    TogglePopupFullscreen();
                else if (args.Key == Key.Escape && _dashboardPopup.WindowStyle == WindowStyle.None)
                    TogglePopupFullscreen();
            };

            await _popupWebView.EnsureCoreWebView2Async(_webViewEnvironment);
            ConfigureWebView(_popupWebView, isMainDashboard: false);
            _popupWebView.Source = new Uri(source);
            _dashboardWebView.Visibility = Visibility.Collapsed;
            _dashboardPopup.Show();
            PopoutButton.ToolTip = "收回 Dashboard";
            App.Log("Dashboard popped out");
        }
        catch (Exception ex)
        {
            App.Log("Popout failed: " + ex);
            MessageBox.Show("Dashboard 弹出失败：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void DockDashboard()
    {
        if (_dashboardPopup is null)
            return;

        try
        {
            var source = _popupWebView?.Source?.AbsoluteUri;
            _dashboardPopup.Content = null;
            _dashboardPopup.Hide();
            _popupWebView?.Dispose();
            _popupWebView = null;
            _dashboardPopup = null;
            if (_dashboardWebView is not null)
            {
                _dashboardWebView.Visibility = Visibility.Visible;
                if (Uri.TryCreate(source, UriKind.Absolute, out var uri))
                    _dashboardWebView.Source = uri;
            }
            PopoutButton.ToolTip = "弹出 Dashboard";
            App.Log("Dashboard docked");
        }
        catch (Exception ex)
        {
            App.Log("Dock failed: " + ex);
        }
    }

    private void Fullscreen_Click(object sender, RoutedEventArgs e)
    {
        if (_dashboardPopup is not null)
        {
            TogglePopupFullscreen();
            return;
        }
        ToggleFocusMode();
    }

    private void ToggleFocusMode()
    {
        if (!_focusMode)
        {
            _savedWindowStyle = WindowStyle;
            _savedWindowState = WindowState;
            _savedResizeMode = ResizeMode;
            _savedRootMargin = RootGrid.Margin;
            Sidebar.Visibility = Visibility.Collapsed;
            SidebarColumn.Width = new GridLength(0);
            TopBarRow.Height = new GridLength(0);
            RootGrid.Margin = new Thickness(0);
            WindowStyle = WindowStyle.None;
            ResizeMode = ResizeMode.NoResize;
            WindowState = WindowState.Maximized;
            _focusMode = true;
        }
        else
        {
            WindowState = WindowState.Normal;
            WindowStyle = _savedWindowStyle;
            ResizeMode = _savedResizeMode;
            RootGrid.Margin = _savedRootMargin;
            Sidebar.Visibility = Visibility.Visible;
            ApplySidebarState();
            TopBarRow.Height = new GridLength(44);
            WindowState = _savedWindowState;
            _focusMode = false;
        }
    }

    private void TogglePopupFullscreen()
    {
        if (_dashboardPopup is null)
            return;

        if (_dashboardPopup.WindowStyle != WindowStyle.None)
        {
            _dashboardPopup.WindowStyle = WindowStyle.None;
            _dashboardPopup.ResizeMode = ResizeMode.NoResize;
            _dashboardPopup.WindowState = WindowState.Maximized;
        }
        else
        {
            _dashboardPopup.WindowState = WindowState.Normal;
            _dashboardPopup.WindowStyle = WindowStyle.SingleBorderWindow;
            _dashboardPopup.ResizeMode = ResizeMode.CanResize;
        }
    }

    private async void ZoteroDetect_Click(object sender, RoutedEventArgs e)
    {
        var candidates = ZoteroLibrary.DetectDatabaseCandidates();
        if (candidates.Count == 0)
        {
            ZoteroStatusText.Text = "未自动找到 zotero.sqlite，请手动选择。";
            return;
        }

        _settings.ZoteroDbPath = candidates[0];
        _settings.Save();
        ZoteroBox.Text = _settings.ZoteroDbPath;
        ZoteroPathText.Text = _settings.ZoteroDbPath;
        _zoteroInitialized = false;
        ZoteroStatusText.Text = candidates.Count == 1
            ? "已自动定位 Zotero 数据库。"
            : $"发现 {candidates.Count} 个候选数据库，已使用第一个。";
        await EnsureZoteroReadyAsync();
    }

    private async void ZoteroBrowse_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 Zotero 数据库",
            Filter = "Zotero 数据库 (zotero.sqlite)|zotero.sqlite|SQLite 数据库 (*.sqlite)|*.sqlite|所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };
        if (dialog.ShowDialog(this) != true)
            return;

        _settings.ZoteroDbPath = dialog.FileName;
        _settings.Save();
        ZoteroBox.Text = dialog.FileName;
        ZoteroPathText.Text = dialog.FileName;
        _zoteroInitialized = false;
        await EnsureZoteroReadyAsync();
    }

    private async void ZoteroSearch_Click(object sender, RoutedEventArgs e) => await SearchZoteroAsync(ZoteroSearchBox.Text);

    private async void ZoteroSearchBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            await SearchZoteroAsync(ZoteroSearchBox.Text);
        }
    }

    private void ZoteroResults_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedZoteroRecord = ZoteroResults.SelectedItem as ZoteroRecord;
        if (_selectedZoteroRecord is null)
        {
            ZoteroDetailTitle.Text = "选择一篇文献";
            ZoteroDetailAuthors.Text = string.Empty;
            ZoteroDetailPublication.Text = string.Empty;
            ZoteroDetailDoi.Text = string.Empty;
            ZoteroDetailAbstract.Text = "暂无摘要";
            OpenPdfButton.IsEnabled = false;
            CopyDoiButton.IsEnabled = false;
            return;
        }

        ZoteroDetailTitle.Text = _selectedZoteroRecord.DisplayTitle;
        ZoteroDetailAuthors.Text = _selectedZoteroRecord.Authors;
        ZoteroDetailPublication.Text = string.Join(" · ", new[] { _selectedZoteroRecord.Publication, _selectedZoteroRecord.Year, _selectedZoteroRecord.ItemType }.Where(value => !string.IsNullOrWhiteSpace(value)));
        ZoteroDetailDoi.Text = string.IsNullOrWhiteSpace(_selectedZoteroRecord.Doi) ? "" : "DOI: " + _selectedZoteroRecord.Doi;
        ZoteroDetailAbstract.Text = string.IsNullOrWhiteSpace(_selectedZoteroRecord.Abstract) ? "暂无摘要" : _selectedZoteroRecord.Abstract;
        OpenPdfButton.IsEnabled = File.Exists(_selectedZoteroRecord.ResolvedPdfPath);
        CopyDoiButton.IsEnabled = !string.IsNullOrWhiteSpace(_selectedZoteroRecord.Doi);
    }

    private void OpenSelectedPdf_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedZoteroRecord is null || !File.Exists(_selectedZoteroRecord.ResolvedPdfPath))
            return;
        Process.Start(new ProcessStartInfo(_selectedZoteroRecord.ResolvedPdfPath) { UseShellExecute = true });
    }

    private void CopySelectedDoi_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_selectedZoteroRecord?.Doi))
            Clipboard.SetText(_selectedZoteroRecord.Doi);
    }

    private async void RefreshPython_Click(object sender, RoutedEventArgs e)
    {
        _pythonInitialized = false;
        await RefreshPythonEnvironmentsAsync();
    }

    private async void BrowseConda_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 conda.exe 或 conda.bat",
            Filter = "Conda (conda.exe;conda.bat)|conda.exe;conda.bat|可执行文件 (*.exe;*.bat)|*.exe;*.bat|所有文件 (*.*)|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) != true)
            return;

        _settings.CondaPath = dialog.FileName;
        _settings.Save();
        CondaBox.Text = dialog.FileName;
        _pythonInitialized = false;
        await RefreshPythonEnvironmentsAsync();
    }

    private async void BrowseUv_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 uv.exe",
            Filter = "uv (uv.exe)|uv.exe|可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*",
            CheckFileExists = true
        };
        if (dialog.ShowDialog(this) != true)
            return;

        _settings.UvPath = dialog.FileName;
        _settings.Save();
        UvBox.Text = dialog.FileName;
        _pythonInitialized = false;
        await RefreshPythonEnvironmentsAsync();
    }

    private void PythonEnvironments_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedPythonEnvironment = PythonEnvironments.SelectedItem as PythonEnvironmentInfo;
        if (_selectedPythonEnvironment is null)
        {
            PythonDetailName.Text = "选择一个 Python 环境";
            PythonDetailKind.Text = string.Empty;
            PythonDetailPath.Text = string.Empty;
            PythonDetailSource.Text = string.Empty;
            OpenPythonTerminalButton.IsEnabled = false;
            CopyPythonPathButton.IsEnabled = false;
            OpenPythonFolderButton.IsEnabled = false;
            return;
        }

        PythonDetailName.Text = _selectedPythonEnvironment.DisplayName + (string.IsNullOrWhiteSpace(_selectedPythonEnvironment.Version) ? "" : " · Python " + _selectedPythonEnvironment.Version);
        PythonDetailKind.Text = _selectedPythonEnvironment.KindLabel;
        PythonDetailPath.Text = _selectedPythonEnvironment.PythonExecutable;
        PythonDetailSource.Text = _selectedPythonEnvironment.Source;
        OpenPythonTerminalButton.IsEnabled = true;
        CopyPythonPathButton.IsEnabled = true;
        OpenPythonFolderButton.IsEnabled = Directory.Exists(_selectedPythonEnvironment.Prefix);
        _settings.SelectedPythonEnvironment = _selectedPythonEnvironment.Prefix;
        _settings.Save();
    }

    private void OpenPythonTerminal_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedPythonEnvironment is null)
            return;
        PythonEnvironmentService.OpenTerminal(_selectedPythonEnvironment, _settings.WorkspaceRoot, _pythonDiscovery?.CondaExecutable ?? _settings.CondaPath);
    }

    private void CopyPythonPath_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrWhiteSpace(_selectedPythonEnvironment?.PythonExecutable))
            Clipboard.SetText(_selectedPythonEnvironment.PythonExecutable);
    }

    private void OpenPythonFolder_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedPythonEnvironment is not null && Directory.Exists(_selectedPythonEnvironment.Prefix))
            OpenDirectory(_selectedPythonEnvironment.Prefix);
    }

    private async void SaveSettings_Click(object sender, RoutedEventArgs e)
    {
        var url = DashboardUrlBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(url) && !IsValidHttpUrl(url))
        {
            MessageBox.Show("Dashboard 地址必须以 http:// 或 https:// 开头。", "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var dashboardChanged = !string.Equals(_settings.DashboardUrl.TrimEnd('/'), url.TrimEnd('/'), StringComparison.OrdinalIgnoreCase);
        var zoteroChanged = !string.Equals(_settings.ZoteroDbPath, ZoteroBox.Text.Trim(), StringComparison.OrdinalIgnoreCase);
        var pythonChanged = !string.Equals(_settings.WorkspaceRoot, WorkspaceBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)
                            || !string.Equals(_settings.CondaPath, CondaBox.Text.Trim(), StringComparison.OrdinalIgnoreCase)
                            || !string.Equals(_settings.UvPath, UvBox.Text.Trim(), StringComparison.OrdinalIgnoreCase);

        _settings.UserName = UserNameBox.Text.Trim();
        _settings.DashboardName = DashboardNameBox.Text.Trim();
        _settings.DashboardUrl = url;
        _settings.WorkspaceRoot = WorkspaceBox.Text.Trim();
        _settings.ZoteroDbPath = ZoteroBox.Text.Trim();
        _settings.CondaPath = CondaBox.Text.Trim();
        _settings.UvPath = UvBox.Text.Trim();
        _settings.Save();

        UserNameText.Text = string.IsNullOrWhiteSpace(_settings.UserName) ? "Fenlynn" : _settings.UserName;
        UserCard.ToolTip = UserNameText.Text + " · 本地工作台";
        ZoteroPathText.Text = _settings.ZoteroDbPath;
        if (dashboardChanged)
        {
            _dashboardHasNavigated = false;
            _dashboardRootUrl = string.Empty;
            if (_currentView == "dashboard")
                await EnsureDashboardAsync();
        }
        if (zoteroChanged)
            _zoteroInitialized = false;
        if (pythonChanged)
            _pythonInitialized = false;
        UpdateHomeStatus();
        PageTitle.Text = "设置";
        MessageBox.Show("设置已保存。", "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void ClearSession_Click(object sender, RoutedEventArgs e)
    {
        var result = MessageBox.Show("清除 Cloudflare Access、GitHub 登录和 Dashboard 的本地浏览数据？", "清除会话", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (result != MessageBoxResult.Yes)
            return;

        try
        {
            if (_dashboardWebView?.CoreWebView2?.Profile is not null)
                await _dashboardWebView.CoreWebView2.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.AllProfile);
            AccessStatusText.Text = "会话已清除";
            _dashboardHasNavigated = false;
            if (IsValidHttpUrl(_settings.DashboardUrl))
                await EnsureDashboardAsync();
        }
        catch (Exception ex)
        {
            App.Log("Clear session failed: " + ex);
            MessageBox.Show("清除会话失败：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void OpenConfig_Click(object sender, RoutedEventArgs e) => OpenDirectory(App.AppDataDirectory);
    private void OpenLogs_Click(object sender, RoutedEventArgs e) => OpenDirectory(App.LogDirectory);

    private static void OpenDirectory(string path)
    {
        Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", path) { UseShellExecute = true });
    }

    private void CommandButton_Click(object sender, RoutedEventArgs e)
    {
        MessageBox.Show(
            "快捷键\n\nCtrl + B  折叠目录\nCtrl + Shift + D  弹出或收回 Dashboard\nF11  Dashboard 全屏\nEsc  退出全屏\n\n当前版本已接入 Zotero 只读检索和 Conda / uv 环境发现。",
            "命令面板",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
    }

    private void MainWindow_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.B && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            ToggleSidebar_Click(this, new RoutedEventArgs());
            e.Handled = true;
        }
        else if (e.Key == Key.D && Keyboard.Modifiers.HasFlag(ModifierKeys.Control) && Keyboard.Modifiers.HasFlag(ModifierKeys.Shift))
        {
            Popout_Click(this, new RoutedEventArgs());
            e.Handled = true;
        }
        else if (e.Key == Key.F11 && _currentView == "dashboard")
        {
            Fullscreen_Click(this, new RoutedEventArgs());
            e.Handled = true;
        }
        else if (e.Key == Key.Escape && _focusMode)
        {
            ToggleFocusMode();
            e.Handled = true;
        }
        else if (e.Key == Key.K && Keyboard.Modifiers.HasFlag(ModifierKeys.Control))
        {
            CommandButton_Click(this, new RoutedEventArgs());
            e.Handled = true;
        }
    }

    private static bool IsValidHttpUrl(string? value)
        => Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
}
