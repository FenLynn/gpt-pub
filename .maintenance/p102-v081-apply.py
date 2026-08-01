from pathlib import Path
import re

ROOT = Path('projects/1-桌面软件/102-AtlasDesk/代码')
NATIVE = ROOT / 'personal-workbench-native'
SMOKE = ROOT / 'personal-workbench-smoke'


def read(path: Path) -> str:
    return path.read_text(encoding='utf-8-sig')


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding='utf-8', newline='\n')


def replace_once(path: Path, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one exact match, found {count}')
    write(path, text.replace(old, new, 1))


def regex_once(path: Path, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: expected one regex match, found {count}: {pattern}')
    write(path, updated)


# Version and release notes.
replace_once(
    NATIVE / 'Version.props',
    '<WorkbenchVersion>0.8.0</WorkbenchVersion>',
    '<WorkbenchVersion>0.8.1</WorkbenchVersion>'
)

write(NATIVE / 'RELEASE_NOTES.txt', '''AtlasDesk v0.8.1

This maintenance release repairs the shell, Windows maximize behavior, the development environment page and Dashboard external-link handling discovered during real Windows use of v0.8.0.

Interface and window behavior
- Replaced the two large outer cards with one continuous application surface and a single divider between navigation and content.
- Removed redundant outer shadows, borders and background layers while retaining local cards only where they express real information groups.
- Added monitor WorkArea handling for the custom title bar so maximized windows no longer extend behind the taskbar.
- Aligned title text and caption buttons within a consistent 36-pixel title bar.

Development workspace
- Removed the legacy path that automatically embedded the terminal over the development environment page.
- Project and environment tabs remain independent, and the environment tab actively refreshes Conda, uv, venv and system Python discovery.
- Terminal sessions remain in the global bottom drawer or their explicit window instead of replacing the environment page.

Dashboard reliability
- Dashboard same-origin routes remain inside AtlasDesk.
- Cloudflare Access and supported identity-provider login windows remain in the shared WebView2 profile.
- All other cross-origin links open in the Windows default browser.
- Added automatic WebView2 reconstruction after render-process failure or unresponsiveness.

Architecture
- No Runtime/Data boundary changes were made.
- No new version-named Enhancer layer was added; the existing controlling paths were consolidated.
''')

# Testable Dashboard route policy.
write(NATIVE / 'DashboardNavigationPolicy.cs', r'''namespace PersonalWorkbench;

public enum DashboardNavigationTarget
{
    MainDashboard,
    AuthenticationPopup,
    ExternalBrowser
}

public static class DashboardNavigationPolicy
{
    public static DashboardNavigationTarget Classify(string? requestedUri, string? dashboardRootUri)
    {
        if (!Uri.TryCreate(requestedUri, UriKind.Absolute, out var requested)
            || requested.Scheme is not ("http" or "https"))
            return DashboardNavigationTarget.ExternalBrowser;

        if (IsAuthenticationUri(requested))
            return DashboardNavigationTarget.AuthenticationPopup;

        if (Uri.TryCreate(dashboardRootUri, UriKind.Absolute, out var root)
            && SameOrigin(requested, root))
            return DashboardNavigationTarget.MainDashboard;

        return DashboardNavigationTarget.ExternalBrowser;
    }

    private static bool SameOrigin(Uri left, Uri right)
        => string.Equals(left.Scheme, right.Scheme, StringComparison.OrdinalIgnoreCase)
           && string.Equals(left.Host, right.Host, StringComparison.OrdinalIgnoreCase)
           && left.Port == right.Port;

    private static bool IsAuthenticationUri(Uri uri)
    {
        var host = uri.Host.ToLowerInvariant();
        var path = uri.AbsolutePath.ToLowerInvariant();

        if (path.Contains("/cdn-cgi/access/", StringComparison.Ordinal))
            return true;
        if (host == "cloudflareaccess.com" || host.EndsWith(".cloudflareaccess.com", StringComparison.Ordinal)
            || host == "cloudflareaccess.org" || host.EndsWith(".cloudflareaccess.org", StringComparison.Ordinal))
            return true;
        if (host == "github.com" && (path.StartsWith("/login", StringComparison.Ordinal)
                                      || path.StartsWith("/session", StringComparison.Ordinal)
                                      || path.StartsWith("/sessions", StringComparison.Ordinal)))
            return true;
        if (host == "accounts.google.com" || host == "login.microsoftonline.com")
            return true;

        return false;
    }
}
''')

# Main Dashboard mixed navigation and process recovery.
main_window = NATIVE / 'MainWindow.xaml.cs'
replace_once(
    main_window,
    '    private bool _dashboardHasNavigated;\n    private string _dashboardRootUrl = string.Empty;',
    '    private bool _dashboardHasNavigated;\n    private bool _dashboardRecoveryInProgress;\n    private string _dashboardRootUrl = string.Empty;'
)

replace_once(
    main_window,
'''        core.NewWindowRequested += async (_, args) => await HandleNewWindowRequestedAsync(args);
        core.ProcessFailed += (_, args) =>
        {
            App.Log("WebView2 process failed: " + args.ProcessFailedKind);
            if (isMainDashboard)
                Dispatcher.Invoke(() => ShowDashboardError(new InvalidOperationException("WebView2 进程异常退出：" + args.ProcessFailedKind)));
        };''',
'''        core.NewWindowRequested += async (_, args) => await HandleNewWindowRequestedAsync(args);
        core.ProcessFailed += (_, args) =>
        {
            App.Log("WebView2 process failed: " + args.ProcessFailedKind);
            if (isMainDashboard)
                Dispatcher.BeginInvoke(new Action(() => _ = RecoverDashboardAsync(args.ProcessFailedKind.ToString())));
        };'''
)

new_window_region = r'''    private async Task HandleNewWindowRequestedAsync(CoreWebView2NewWindowRequestedEventArgs args)
    {
        var deferral = args.GetDeferral();
        try
        {
            var target = DashboardNavigationPolicy.Classify(args.Uri, _settings.DashboardUrl);
            App.Log($"New window requested: {args.Uri} [{target}]");

            if (target == DashboardNavigationTarget.ExternalBrowser)
            {
                args.Handled = true;
                OpenExternalUri(args.Uri);
                return;
            }

            if (target == DashboardNavigationTarget.MainDashboard)
            {
                args.Handled = true;
                if (_dashboardWebView?.CoreWebView2 is { } dashboard)
                    dashboard.Navigate(args.Uri);
                else
                    OpenExternalUri(args.Uri);
                return;
            }

            if (_webViewEnvironment is null)
            {
                args.Handled = true;
                OpenExternalUri(args.Uri);
                return;
            }

            _dashboardPopup?.Close();
            _popupWebView?.Dispose();

            var popupView = new WebView2();
            var popup = new Window
            {
                Title = "AtlasDesk 登录验证",
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
            _dashboardPopup = popup;
            _popupWebView = popupView;

            popup.Closed += (_, _) =>
            {
                popupView.Dispose();
                if (ReferenceEquals(_dashboardPopup, popup)) _dashboardPopup = null;
                if (ReferenceEquals(_popupWebView, popupView)) _popupWebView = null;
                try
                {
                    if (!_dashboardHasNavigated && IsValidHttpUrl(_settings.DashboardUrl))
                        _dashboardWebView?.CoreWebView2.Navigate(_settings.DashboardUrl);
                    else
                        _dashboardWebView?.Reload();
                }
                catch (Exception ex)
                {
                    App.Log("Dashboard refresh after authentication failed: " + ex.Message);
                }
            };
            popup.Show();
        }
        catch (Exception ex)
        {
            App.Log("New window handling failed: " + ex);
            args.Handled = true;
            OpenExternalUri(args.Uri);
        }
        finally
        {
            deferral.Complete();
        }
    }

    private void OpenExternalUri(string? target)
    {
        if (!Uri.TryCreate(target, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https"))
        {
            App.Log("External link rejected because it is not a valid HTTP URL: " + target);
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            App.Log("Opened external link in the default browser: " + uri.AbsoluteUri);
        }
        catch (Exception ex)
        {
            App.Log("Open external browser failed: " + ex);
            MessageBox.Show("无法使用默认浏览器打开该链接：\n\n" + uri.AbsoluteUri + "\n\n" + ex.Message,
                ProductIdentity.ProductName, MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async Task RecoverDashboardAsync(string reason)
    {
        if (_dashboardRecoveryInProgress)
            return;

        _dashboardRecoveryInProgress = true;
        try
        {
            App.Log("Rebuilding main Dashboard WebView2 after process failure: " + reason);
            DashboardHost.Visibility = Visibility.Visible;
            DashboardEmpty.Visibility = Visibility.Collapsed;
            DashboardError.Visibility = Visibility.Visible;
            DashboardErrorText.Text = "Dashboard 渲染进程异常，AtlasDesk 正在自动重建页面…\n\n原因：" + reason;
            if (_currentView == "dashboard")
                NavigationProgress.Visibility = Visibility.Visible;

            var failedView = _dashboardWebView;
            _dashboardWebView = null;
            if (failedView is not null)
            {
                DashboardHost.Children.Remove(failedView);
                failedView.Dispose();
            }

            _dashboardHasNavigated = false;
            _dashboardRootUrl = string.Empty;
            _isInitializingDashboard = false;
            await Task.Delay(350);
            await EnsureDashboardAsync();

            if (_dashboardWebView is not null)
            {
                DashboardHost.Visibility = Visibility.Visible;
                DashboardError.Visibility = Visibility.Collapsed;
            }
        }
        catch (Exception ex)
        {
            App.Log("Dashboard automatic recovery failed: " + ex);
            ShowDashboardError(new InvalidOperationException("Dashboard 自动恢复失败：" + ex.Message, ex));
        }
        finally
        {
            _dashboardRecoveryInProgress = false;
            if (_currentView == "dashboard")
                NavigationProgress.Visibility = Visibility.Collapsed;
        }
    }

'''
regex_once(
    main_window,
    r'    private async Task HandleNewWindowRequestedAsync\(CoreWebView2NewWindowRequestedEventArgs args\).*?(?=    private void UpdateAccessStatus)',
    new_window_region
)

# Flat continuous shell instead of two large outer cards.
workbench = NATIVE / 'WorkbenchEnhancer.cs'
flat_polish = r'''    private void ApplyVisualPolish()
    {
        _window.Background = new SolidColorBrush(Color.FromRgb(247, 248, 250));
        if (_window.FindName("RootGrid") is Grid root)
        {
            root.Margin = new Thickness(0);
            root.Background = new SolidColorBrush(Color.FromRgb(247, 248, 250));
            if (root.ColumnDefinitions.Count > 1)
                root.ColumnDefinitions[1].Width = new GridLength(1);

            var divider = root.Children.OfType<Border>()
                .FirstOrDefault(border => Equals(border.Tag, "shell-divider"));
            if (divider is null)
            {
                divider = new Border
                {
                    Tag = "shell-divider",
                    Background = new SolidColorBrush(Color.FromRgb(226, 229, 234)),
                    IsHitTestVisible = false
                };
                Grid.SetColumn(divider, 1);
                root.Children.Add(divider);
            }

            var content = root.Children.OfType<Border>()
                .FirstOrDefault(border => Grid.GetColumn(border) == 2);
            if (content is not null)
            {
                content.CornerRadius = new CornerRadius(0);
                content.BorderThickness = new Thickness(0);
                content.BorderBrush = Brushes.Transparent;
                content.Background = Brushes.White;
                content.Effect = null;
                content.ClipToBounds = true;
            }
        }
        if (_window.FindName("Sidebar") is Border sidebar)
        {
            sidebar.CornerRadius = new CornerRadius(0);
            sidebar.BorderThickness = new Thickness(0);
            sidebar.BorderBrush = Brushes.Transparent;
            sidebar.Background = new SolidColorBrush(Color.FromRgb(248, 249, 251));
            sidebar.Effect = null;
        }
        if (_window.FindName("TopBarRow") is RowDefinition topBarRow) topBarRow.Height = new GridLength(42);
        if (_window.FindName("TopBar") is Grid topBar)
        {
            topBar.Background = Brushes.White;
            if (!topBar.Children.OfType<Border>().Any(border => Equals(border.Tag, "polish-divider")))
            {
                var divider = new Border
                {
                    Tag = "polish-divider", Height = 1, Background = new SolidColorBrush(Color.FromRgb(229, 232, 237)),
                    VerticalAlignment = VerticalAlignment.Bottom, IsHitTestVisible = false
                };
                Grid.SetColumnSpan(divider, 3);
                topBar.Children.Add(divider);
            }
        }
        if (_window.FindName("PageTitle") is TextBlock title) title.FontSize = 14;
        if (_window.FindName("PageSubtitle") is TextBlock subtitle) subtitle.FontSize = 11;
        if (_window.FindName("UserCard") is Border userCard)
        {
            userCard.Background = Brushes.Transparent;
            userCard.BorderBrush = Brushes.Transparent;
            userCard.BorderThickness = new Thickness(0);
            userCard.CornerRadius = new CornerRadius(0);
        }
    }

'''
regex_once(workbench, r'    private void ApplyVisualPolish\(\).*?(?=    private void WireEvents\(\))', flat_polish)

# Retire the old terminal-over-environment path while preserving bottom-drawer reliability.
hotfix = NATIVE / 'V068HotfixEnhancer.cs'
text = read(hotfix)
text = text.replace('    private readonly AppSettings _settings;\n', '')
text = text.replace('    private readonly Grid _developmentStage = new();\n', '')
text = text.replace('    private bool _preferBottomDock;\n', '')
text = text.replace('        _settings = pipeline.Settings;\n', '')
write(hotfix, text)

replace_once(
    hotfix,
'''            _developmentStage.HorizontalAlignment = HorizontalAlignment.Stretch;
            _developmentStage.VerticalAlignment = VerticalAlignment.Stretch;
            _development.HorizontalAlignment = HorizontalAlignment.Stretch;
            _development.VerticalAlignment = VerticalAlignment.Stretch;
            _developmentStage.Children.Add(_development);
            development.Children.Add(_developmentStage);''',
'''            _development.HorizontalAlignment = HorizontalAlignment.Stretch;
            _development.VerticalAlignment = VerticalAlignment.Stretch;
            _development.Visibility = Visibility.Visible;
            development.Children.Add(_development);'''
)

replace_once(
    hotfix,
'''        _terminal.DockBottomRequested += (_, _) =>
        {
            _preferBottomDock = true;
            DockTerminalBottom(show: _terminal.HasSessions);
        };
        _terminal.EmbedDevelopmentRequested += async (_, _) =>
        {
            _preferBottomDock = false;
            if (_window.FindName("DevelopmentNav") is RadioButton developmentNav)
            {
                if (developmentNav.IsChecked != true)
                    developmentNav.IsChecked = true;
                else
                    await EmbedTerminalInDevelopmentAsync(openDefaultSession: true);
            }
        };''',
'''        _terminal.DockBottomRequested += (_, _) => DockTerminalBottom(show: _terminal.HasSessions);
        _terminal.EmbedDevelopmentRequested += (_, _) =>
        {
            if (_window.FindName("DevelopmentNav") is RadioButton developmentNav
                && developmentNav.IsChecked != true)
                developmentNav.IsChecked = true;
            DockTerminalBottom(show: true);
        };'''
)

replace_once(
    hotfix,
'''    private async Task Development_CheckedAsync()
    {
        if (_preferBottomDock)
        {
            DockTerminalBottom(show: _terminal.HasSessions);
            return;
        }
        await EmbedTerminalInDevelopmentAsync(openDefaultSession: true);
    }
''',
'''    private async Task Development_CheckedAsync()
    {
        DockTerminalBottom(show: _terminal.HasSessions);
        _development.Visibility = Visibility.Visible;
        await _development.EnsureLoadedAsync();
    }
'''
)

regex_once(
    hotfix,
    r'    private async Task EmbedTerminalInDevelopmentAsync\(bool openDefaultSession\).*?(?=    private void DockTerminalBottom)',
    ''
)

replace_once(
    hotfix,
'''    private void UpdateTopTerminalButtonVisibility()
    {
        if (_topTerminalButton is null) return;
        _topTerminalButton.Visibility = _terminal.HostMode == TerminalHostMode.Development
            ? Visibility.Collapsed
            : Visibility.Visible;
    }
''',
'''    private void UpdateTopTerminalButtonVisibility()
    {
        if (_topTerminalButton is not null)
            _topTerminalButton.Visibility = Visibility.Visible;
    }
'''
)

# Project/environment tabs explicitly load the selected module.
project_center = NATIVE / 'V070ProjectCenterEnhancer.cs'
new_tabs = r'''    private TabControl BuildTabs()
    {
        if (_development.Parent is Panel parent) parent.Children.Remove(_development);
        else if (_development.Parent is ContentControl content) content.Content = null;
        _development.Visibility = Visibility.Visible;

        var tabs = new TabControl
        {
            Background = System.Windows.Media.Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Margin = new Thickness(0)
        };
        tabs.Items.Add(new TabItem { Header = "项目", Content = _projects });
        tabs.Items.Add(new TabItem { Header = "环境", Content = _development });
        tabs.SelectionChanged += async (_, args) =>
        {
            if (ReferenceEquals(args.Source, tabs))
                await RefreshSelectedTabAsync();
        };
        tabs.SelectedIndex = 0;
        return tabs;
    }

    private async Task RefreshSelectedTabAsync()
    {
        if (_tabs.SelectedIndex == 0)
        {
            await _projects.RefreshIfNeededAsync();
            return;
        }

        _development.Visibility = Visibility.Visible;
        await _development.EnsureLoadedAsync();
    }

'''
regex_once(project_center, r'    private TabControl BuildTabs\(\).*?(?=    private void Install\(\))', new_tabs)
replace_once(
    project_center,
'''        host.Children.Clear();
        host.Margin = new Thickness(0);
        host.Children.Add(_tabs);''',
'''        host.Children.Clear();
        host.Margin = new Thickness(0);
        _development.Visibility = Visibility.Visible;
        host.Children.Add(_tabs);'''
)
replace_once(
    project_center,
'''            developmentNav.Checked += async (_, _) =>
            {
                if (_tabs.SelectedIndex == 0) await _projects.RefreshIfNeededAsync();
            };''',
'''            developmentNav.Checked += async (_, _) => await RefreshSelectedTabAsync();'''
)

# Correct custom chrome sizing and monitor WorkArea handling.
chrome = NATIVE / 'V069UiFixEnhancer.cs'
text = read(chrome)
text = text.replace('using System.Reflection;\n', 'using System.Reflection;\nusing System.Runtime.InteropServices;\n')
text = text.replace('using System.Windows.Input;\n', 'using System.Windows.Input;\nusing System.Windows.Interop;\n')
text = text.replace('    private bool _defaultCmdRecoveryAttempted;\n', '    private bool _defaultCmdRecoveryAttempted;\n    private HwndSource? _windowSource;\n    private bool _windowHookInstalled;\n')
write(chrome, text)
replace_once(
    chrome,
'''        InstallNeutralWindowChrome();
        RemoveNavigationFocusFlash();''',
'''        InstallNeutralWindowChrome();
        _window.SourceInitialized += (_, _) => InstallWindowWorkAreaHook();
        _window.Closed += (_, _) => RemoveWindowWorkAreaHook();
        InstallWindowWorkAreaHook();
        RemoveNavigationFocusFlash();'''
)
replace_once(
    chrome,
'''        RemoveNavigationFocusFlash();
        InstallReliableCmdButtons();''',
'''        InstallWindowWorkAreaHook();
        RemoveNavigationFocusFlash();
        InstallReliableCmdButtons();'''
)
replace_once(chrome, 'shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(34) });', 'shell.RowDefinitions.Add(new RowDefinition { Height = new GridLength(36) });')
replace_once(
    chrome,
'''        _window.StateChanged += (_, _) =>
        {
            maximize.Content = _window.WindowState == WindowState.Maximized ? "❐" : "□";
            original.Margin = _window.WindowState == WindowState.Maximized ? new Thickness(0) : new Thickness(8);
        };

        _window.Content = null;''',
'''        _window.StateChanged += (_, _) =>
        {
            maximize.Content = _window.WindowState == WindowState.Maximized ? "❐" : "□";
        };

        original.Margin = new Thickness(0);
        _window.Content = null;'''
)
replace_once(chrome, '            Height = 33,', '            Height = 35,')

work_area_code = r'''    private void InstallWindowWorkAreaHook()
    {
        if (_windowHookInstalled)
            return;

        var handle = new WindowInteropHelper(_window).Handle;
        if (handle == IntPtr.Zero)
            return;

        _windowSource = HwndSource.FromHwnd(handle);
        if (_windowSource is null)
            return;

        _windowSource.AddHook(WindowMessageHook);
        _windowHookInstalled = true;
    }

    private void RemoveWindowWorkAreaHook()
    {
        if (!_windowHookInstalled || _windowSource is null)
            return;
        _windowSource.RemoveHook(WindowMessageHook);
        _windowSource = null;
        _windowHookInstalled = false;
    }

    private IntPtr WindowMessageHook(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WM_GETMINMAXINFO = 0x0024;
        if (message != WM_GETMINMAXINFO)
            return IntPtr.Zero;

        var monitor = MonitorFromWindow(hwnd, 0x00000002);
        if (monitor == IntPtr.Zero)
            return IntPtr.Zero;

        var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(monitor, ref monitorInfo))
            return IntPtr.Zero;

        var info = Marshal.PtrToStructure<MinMaxInfo>(lParam);
        var work = monitorInfo.WorkArea;
        var bounds = monitorInfo.MonitorArea;
        info.MaxPosition.X = work.Left - bounds.Left;
        info.MaxPosition.Y = work.Top - bounds.Top;
        info.MaxSize.X = work.Right - work.Left;
        info.MaxSize.Y = work.Bottom - work.Top;
        info.MaxTrackSize = info.MaxSize;
        Marshal.StructureToPtr(info, lParam, false);
        handled = true;
        return IntPtr.Zero;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public NativePoint Reserved;
        public NativePoint MaxSize;
        public NativePoint MaxPosition;
        public NativePoint MinTrackSize;
        public NativePoint MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect MonitorArea;
        public NativeRect WorkArea;
        public uint Flags;
    }

'''
text = read(chrome)
anchor = '    private static Button CreateCaptionButton(string glyph, bool close)\n'
if text.count(anchor) != 1:
    raise RuntimeError('V069UiFixEnhancer.cs: caption-button anchor not unique')
write(chrome, text.replace(anchor, work_area_code + anchor, 1))

# Later title-bar polish must use the same dimensions.
experience = NATIVE / 'V0612ExperienceEnhancer.cs'
replace_once(experience, '        shell.RowDefinitions[0].Height = new GridLength(32);', '        shell.RowDefinitions[0].Height = new GridLength(36);')
replace_once(experience, '            actions.Height = 32;', '            actions.Height = 36;')
replace_once(experience, '        button.Width = 44;\n        button.Height = 31;', '        button.Width = 46;\n        button.Height = 35;')

# Smoke coverage for navigation policy and version.
smoke = SMOKE / 'Program.cs'
replace_once(
    smoke,
    'Check(WorkbenchVersion.Current == "0.6.6", "assembly version matches Version.props");',
    'Check(WorkbenchVersion.Current == "0.8.1", "assembly version matches Version.props");'
)
replace_once(
    smoke,
'''Check(WorkbenchVersion.Current == "0.8.1", "assembly version matches Version.props");

var firstStart''',
'''Check(WorkbenchVersion.Current == "0.8.1", "assembly version matches Version.props");
Check(DashboardNavigationPolicy.Classify("https://660415.xyz/#reading", "https://660415.xyz") == DashboardNavigationTarget.MainDashboard,
    "dashboard same-origin route stays internal");
Check(DashboardNavigationPolicy.Classify("https://660415.xyz/cdn-cgi/access/login", "https://660415.xyz") == DashboardNavigationTarget.AuthenticationPopup,
    "Cloudflare Access route stays in authentication popup");
Check(DashboardNavigationPolicy.Classify("https://github.com/login/oauth/authorize", "https://660415.xyz") == DashboardNavigationTarget.AuthenticationPopup,
    "GitHub login stays in authentication popup");
Check(DashboardNavigationPolicy.Classify("https://aistudio.google.com/prompts/new_chat", "https://660415.xyz") == DashboardNavigationTarget.ExternalBrowser,
    "cross-origin application opens externally");
Check(DashboardNavigationPolicy.Classify("not-a-url", "https://660415.xyz") == DashboardNavigationTarget.ExternalBrowser,
    "invalid new-window target is rejected from internal WebView");

var firstStart'''
)

# Persist long-term CI checks for the repaired boundaries.
ci = Path('.github/workflows/p102-atlasdesk-ci.yml')
ci_anchor = '''          $security = Get-Content "$root/personal-workbench-native/SecurityService.cs" -Raw
          foreach ($required in @('Argon2id','AesGcm','HMACSHA1','MasterPasswordMinimumLength = 20','PinEnabled')) {
            if ($security -notmatch [regex]::Escape($required)) { throw "Missing security boundary: $required" }
          }

'''
ci_extra = ci_anchor + '''          $policy = Get-Content "$root/personal-workbench-native/DashboardNavigationPolicy.cs" -Raw
          foreach ($required in @('MainDashboard','AuthenticationPopup','ExternalBrowser','SameOrigin')) {
            if ($policy -notmatch [regex]::Escape($required)) { throw "Missing Dashboard routing policy: $required" }
          }

          $mainWindow = Get-Content "$root/personal-workbench-native/MainWindow.xaml.cs" -Raw
          foreach ($required in @('RecoverDashboardAsync','OpenExternalUri','DashboardNavigationPolicy.Classify')) {
            if ($mainWindow -notmatch [regex]::Escape($required)) { throw "Missing Dashboard recovery behavior: $required" }
          }

          $hotfix = Get-Content "$root/personal-workbench-native/V068HotfixEnhancer.cs" -Raw
          if ($hotfix -match 'SetHostMode\(TerminalHostMode\.Development\)' -or
              $hotfix -match '_development\.Visibility\s*=\s*Visibility\.Collapsed') {
            throw 'Legacy terminal-over-environment path remains.'
          }

          $chrome = Get-Content "$root/personal-workbench-native/V069UiFixEnhancer.cs" -Raw
          if ($chrome -notmatch 'WM_GETMINMAXINFO' -or $chrome -notmatch 'MonitorFromWindow') {
            throw 'Monitor WorkArea handling is incomplete.'
          }

          $shell = Get-Content "$root/personal-workbench-native/WorkbenchEnhancer.cs" -Raw
          if ($shell -notmatch 'shell-divider' -or $shell -notmatch 'content\.Effect = null') {
            throw 'Continuous flat shell policy is incomplete.'
          }

'''
replace_once(ci, ci_anchor, ci_extra)

# Final static assertions before the Windows build.
assert '0.8.1' in read(NATIVE / 'Version.props')
assert 'SetHostMode(TerminalHostMode.Development)' not in read(hotfix)
assert '_development.Visibility = Visibility.Collapsed' not in read(hotfix)
assert 'WM_GETMINMAXINFO' in read(chrome)
assert 'DashboardNavigationPolicy.Classify' in read(main_window)
assert 'shell-divider' in read(workbench)
print('AtlasDesk v0.8.1 patch applied successfully.')
