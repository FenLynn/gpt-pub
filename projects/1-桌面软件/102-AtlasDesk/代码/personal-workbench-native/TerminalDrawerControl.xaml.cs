using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public enum TerminalHostMode
{
    Bottom,
    Development
}

public partial class TerminalDrawerControl : UserControl, IAsyncDisposable
{
    private readonly AppSettings _settings;
    private readonly Dictionary<TabItem, TerminalTabState> _tabs = new();
    private CoreWebView2Environment? _environment;
    private string _assetRoot = string.Empty;
    private int _sequence;

    public event EventHandler? CollapseRequested;
    public event EventHandler? DockBottomRequested;
    public event EventHandler? EmbedDevelopmentRequested;
    public event EventHandler? SessionCountChanged;

    public TerminalDrawerControl() : this(AppSettings.Load()) { }

    public TerminalDrawerControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        UpdateSummary();
        UpdateSelectedDetails();
        SetHostMode(TerminalHostMode.Bottom);
    }

    public bool HasSessions => _tabs.Count > 0;
    public TerminalHostMode HostMode { get; private set; } = TerminalHostMode.Bottom;

    public void SetHostMode(TerminalHostMode mode)
    {
        HostMode = mode;
        HostActionButton.Content = mode == TerminalHostMode.Development ? "固定到底部" : "收起";
        HostActionButton.ToolTip = mode == TerminalHostMode.Development
            ? "将全部终端会话固定到工作台底部，切换页面后继续显示"
            : "收起底部终端栏，所有会话继续保留";
        HostModeButton.Content = mode == TerminalHostMode.Development ? "固定到底部" : "嵌入开发页";
        HostModeButton.ToolTip = mode == TerminalHostMode.Development
            ? "将终端固定到全局底部栏"
            : "返回开发页主区域";
        UpdateSelectedDetails();
    }

    public async Task OpenAsync(TerminalLaunchSpec spec)
    {
        var view = new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch
        };
        var tab = new TabItem
        {
            Header = BuildHeader(spec.Title),
            Content = BuildLoadingPanel(spec.Title),
            Tag = ++_sequence
        };
        var state = new TerminalTabState(tab, view, spec);
        _tabs[tab] = state;
        TerminalTabs.Items.Add(tab);
        TerminalTabs.SelectedItem = tab;
        UpdateSummary();
        UpdateSelectedDetails();

        try
        {
            await EnsureEnvironmentAsync();
            if (state.Closing || !_tabs.ContainsKey(tab)) return;

            tab.Content = view;
            await view.EnsureCoreWebView2Async(_environment);
            if (state.Closing || !_tabs.ContainsKey(tab)) return;

            view.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "terminal.local",
                _assetRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            view.CoreWebView2.WebMessageReceived += (_, args) => HandleWebMessage(state, args);
            view.CoreWebView2.ProcessFailed += (_, args) =>
            {
                App.Log("Terminal WebView process failed: " + args.ProcessFailedKind);
                SetFrontendFailure(state, "终端显示进程异常退出：" + args.ProcessFailedKind);
            };
            view.CoreWebView2.NavigationCompleted += (_, args) =>
            {
                if (!args.IsSuccess)
                    SetFrontendFailure(state, "终端界面加载失败：" + args.WebErrorStatus);
            };
            view.Source = new Uri("https://terminal.local/terminal.html");
            _ = WatchFrontendReadyAsync(state);
        }
        catch (Exception ex)
        {
            App.Log("Open integrated terminal failed: " + ex);
            SetFrontendFailure(state, ex.Message);
        }
    }

    public Task OpenShellAsync(string shell, PythonEnvironmentInfo? environment = null, string? title = null)
    {
        var spec = environment is null && string.Equals(shell, "cmd", StringComparison.OrdinalIgnoreCase)
            ? TerminalReliability.CreateCmd(_settings, title)
            : TerminalLaunchSpec.Create(_settings, shell, environment, title);
        return OpenAsync(spec);
    }

    public void ApplySettings()
    {
        foreach (var state in _tabs.Values)
            Post(state, new { type = "settings", fontSize = _settings.TerminalFontSize, scrollback = _settings.TerminalScrollback });
    }

    private async Task EnsureEnvironmentAsync()
    {
        if (_environment is not null) return;
        _assetRoot = TerminalAssetManager.EnsureExtracted();
        var profile = Path.Combine(App.AppDataDirectory, "TerminalWebView2Profile");
        Directory.CreateDirectory(profile);
        _environment = await CoreWebView2Environment.CreateAsync(null, profile, null);
    }

    private async Task WatchFrontendReadyAsync(TerminalTabState state)
    {
        await Task.Delay(TimeSpan.FromSeconds(10));
        if (state.Closing || state.FrontendReady || state.ErrorMessage.Length > 0) return;
        if (!_tabs.ContainsKey(state.Tab)) return;
        await Dispatcher.InvokeAsync(() =>
            SetFrontendFailure(state, "终端界面初始化超时。可点击重试；若仍失败，请检查 WebView2 Runtime。"));
    }

    private async void HandleWebMessage(TerminalTabState state, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            using var document = JsonDocument.Parse(args.WebMessageAsJson);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : string.Empty;
            switch (type)
            {
                case "ready":
                    state.FrontendReady = true;
                    state.ErrorMessage = string.Empty;
                    var cols = root.TryGetProperty("cols", out var colsElement) ? colsElement.GetInt32() : 100;
                    var rows = root.TryGetProperty("rows", out var rowsElement) ? rowsElement.GetInt32() : 28;
                    await StartSessionAsync(state, cols, rows);
                    break;
                case "input":
                    if (root.TryGetProperty("data", out var input))
                    {
                        var data = input.GetString() ?? string.Empty;
                        TrackInput(state, data);
                        if (state.Session is not null)
                            await state.Session.WriteAsync(data);
                    }
                    break;
                case "resize":
                    state.Columns = root.TryGetProperty("cols", out var c) ? c.GetInt32() : 100;
                    state.Rows = root.TryGetProperty("rows", out var r) ? r.GetInt32() : 28;
                    state.Session?.Resize(state.Columns, state.Rows);
                    break;
                case "copy":
                    if (root.TryGetProperty("data", out var copy))
                    {
                        var text = copy.GetString();
                        if (!string.IsNullOrEmpty(text)) Clipboard.SetText(text);
                    }
                    break;
                case "paste-request":
                    if (state.Session is not null && Clipboard.ContainsText())
                        await state.Session.WriteAsync(Clipboard.GetText());
                    break;
            }
        }
        catch (Exception ex)
        {
            App.Log("Terminal message failed: " + ex.Message);
        }
    }

    private static void TrackInput(TerminalTabState state, string data)
    {
        foreach (var character in data)
        {
            if (character is '\r' or '\n')
            {
                var command = state.InputLine.ToString().Trim();
                if (command.Equals("exit", StringComparison.OrdinalIgnoreCase)
                    || command.StartsWith("exit ", StringComparison.OrdinalIgnoreCase))
                    state.IntentionalExit = true;
                state.InputLine.Clear();
            }
            else if (character is '\b' or '\u007f')
            {
                if (state.InputLine.Length > 0)
                    state.InputLine.Length--;
            }
            else if (character == '\u0003')
            {
                state.InputLine.Clear();
            }
            else if (!char.IsControl(character) && state.InputLine.Length < 4096)
            {
                state.InputLine.Append(character);
            }
        }
    }

    private async Task StartSessionAsync(TerminalTabState state, int columns, int rows)
    {
        if (state.Session is not null || state.Closing || !_tabs.ContainsKey(state.Tab)) return;
        try
        {
            state.Exited = false;
            state.ErrorMessage = string.Empty;
            state.IntentionalExit = false;
            state.InputLine.Clear();
            state.StartedUtc = DateTime.UtcNow;
            state.Columns = Math.Clamp(columns, 20, 500);
            state.Rows = Math.Clamp(rows, 5, 300);

            // This is deliberately the same factory used by the real Windows smoke
            // suite. Direct calls to ConPtySession.Start would bypass the verified
            // native CMD bridge and recreate the clean code-0 early exit bug.
            var session = TerminalSessionFactory.Start(state.Spec, state.Columns, state.Rows);
            state.Session = session;
            session.OutputReceived += (_, text) => Dispatcher.BeginInvoke(() =>
            {
                if (ReferenceEquals(state.Session, session) && !state.Closing)
                    Post(state, new { type = "output", data = text });
            });
            session.Exited += (_, code) => Dispatcher.BeginInvoke(new Action(() =>
            {
                _ = HandleSessionExitedAsync(state, session, code);
            }));

            state.Tab.Header = BuildHeader(state.Spec.Title);
            Post(state, new { type = "settings", fontSize = _settings.TerminalFontSize, scrollback = _settings.TerminalScrollback });
            if (!string.IsNullOrWhiteSpace(state.Spec.InitialInput))
            {
                await Task.Delay(120);
                if (ReferenceEquals(state.Session, session))
                    await session.WriteAsync(state.Spec.InitialInput);
            }
            Post(state, new { type = "focus" });
            UpdateSelectedDetails();
        }
        catch (Exception ex)
        {
            App.Log("Terminal session start failed: " + ex);
            state.Session = null;
            state.Exited = true;
            state.ErrorMessage = ex.Message;
            Post(state, new { type = "output", data = "\r\n\u001b[31m内置终端启动失败：" + Sanitize(ex.Message) + "\u001b[0m\r\n" });
            state.Tab.Header = BuildHeader(state.Spec.Title + " · 启动失败");
            UpdateSelectedDetails();
        }
    }

    private async Task HandleSessionExitedAsync(TerminalTabState state, ITerminalSession session, int code)
    {
        if (state.Closing || !_tabs.ContainsKey(state.Tab) || !ReferenceEquals(state.Session, session)) return;

        state.Session = null;
        try { await session.DisposeAsync(); } catch { }

        var lifetime = DateTime.UtcNow - state.StartedUtc;
        var earlyUnexpectedExit = !state.IntentionalExit
                                  && !state.AutoRetryUsed
                                  && lifetime < TimeSpan.FromSeconds(4);
        if (earlyUnexpectedExit)
        {
            state.AutoRetryUsed = true;
            Post(state, new
            {
                type = "output",
                data = $"\r\n\u001b[33m[终端进程启动后立即退出，代码 {code}；正在使用同一原生后台重试一次…]\u001b[0m\r\n"
            });
            await Task.Delay(350);
            if (!state.Closing && _tabs.ContainsKey(state.Tab))
                await StartSessionAsync(state, state.Columns, state.Rows);
            return;
        }

        state.Exited = true;
        Post(state, new
        {
            type = "output",
            data = state.IntentionalExit
                ? $"\r\n\u001b[90m[进程已正常退出，代码 {code}]\u001b[0m\r\n"
                : $"\r\n\u001b[90m[进程已退出，代码 {code}；可在右侧重新启动]\u001b[0m\r\n"
        });
        state.Tab.Header = BuildHeader(state.Spec.Title + " · 已退出");
        UpdateSelectedDetails();
    }

    private void SetFrontendFailure(TerminalTabState state, string message)
    {
        if (state.Closing || !_tabs.ContainsKey(state.Tab)) return;
        state.ErrorMessage = string.IsNullOrWhiteSpace(message) ? "未知错误" : message.Trim();
        state.Exited = true;
        state.Tab.Content = BuildFailurePanel(state);
        state.Tab.Header = BuildHeader(state.Spec.Title + " · 启动失败");
        UpdateSelectedDetails();
    }

    private static string BuildHeader(string title) => string.IsNullOrWhiteSpace(title) ? "Terminal" : title;

    private static UIElement BuildLoadingPanel(string title)
    {
        var stack = new StackPanel
        {
            Width = 360,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        stack.Children.Add(new ProgressBar
        {
            IsIndeterminate = true,
            Height = 3,
            Width = 180,
            Foreground = new SolidColorBrush(Color.FromRgb(91, 142, 235))
        });
        stack.Children.Add(new TextBlock
        {
            Text = "正在启动 " + (string.IsNullOrWhiteSpace(title) ? "终端" : title) + "…",
            Foreground = new SolidColorBrush(Color.FromRgb(190, 207, 228)),
            FontSize = 12,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 12, 0, 0)
        });
        return new Grid
        {
            Background = new SolidColorBrush(Color.FromRgb(13, 19, 32)),
            Children = { stack }
        };
    }

    private UIElement BuildFailurePanel(TerminalTabState state)
    {
        var stack = new StackPanel
        {
            Width = 460,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };
        stack.Children.Add(new TextBlock
        {
            Text = "终端启动失败",
            Foreground = new SolidColorBrush(Color.FromRgb(255, 151, 160)),
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            TextAlignment = TextAlignment.Center
        });
        stack.Children.Add(new TextBlock
        {
            Text = state.ErrorMessage,
            Foreground = new SolidColorBrush(Color.FromRgb(163, 183, 207)),
            FontSize = 11.2,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 8, 0, 0)
        });
        var retry = new Button
        {
            Content = "重试",
            Style = TryFindResource("TerminalHeaderButton") as Style,
            Width = 78,
            Margin = new Thickness(0, 14, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Center
        };
        retry.Click += async (_, _) => await RestartStateAsync(state);
        stack.Children.Add(retry);
        return new Grid
        {
            Background = new SolidColorBrush(Color.FromRgb(13, 19, 32)),
            Children = { stack }
        };
    }

    private static string Sanitize(string value) => value.Replace("\r", " ").Replace("\n", " ");

    private static void Post(TerminalTabState state, object message)
    {
        try { state.View.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message)); } catch { }
    }

    private async Task RestartStateAsync(TerminalTabState state)
    {
        if (state.Closing || !_tabs.ContainsKey(state.Tab)) return;

        if (!state.FrontendReady || state.View.CoreWebView2 is null)
        {
            var spec = state.Spec;
            TerminalTabs.SelectedItem = state.Tab;
            await CloseSelectedAsync();
            await OpenAsync(spec);
            return;
        }

        var oldSession = state.Session;
        state.Session = null;
        if (oldSession is not null)
        {
            try { await oldSession.DisposeAsync(); } catch { }
        }
        state.AutoRetryUsed = false;
        state.IntentionalExit = false;
        state.Exited = false;
        state.ErrorMessage = string.Empty;
        state.InputLine.Clear();
        state.Tab.Header = BuildHeader(state.Spec.Title);
        Post(state, new { type = "reset" });
        await StartSessionAsync(state, state.Columns, state.Rows);
    }

    private async Task CloseSelectedAsync()
    {
        if (TerminalTabs.SelectedItem is not TabItem tab || !_tabs.Remove(tab, out var state)) return;
        state.Closing = true;
        if (state.FloatingWindow is { } floating)
        {
            floating.ReleaseContent();
            state.FloatingWindow = null;
            floating.Close();
        }
        TerminalTabs.Items.Remove(tab);
        if (state.Session is not null) await state.Session.DisposeAsync();
        state.Session = null;
        state.View.Dispose();
        UpdateSummary();
        UpdateSelectedDetails();
    }

    private void PopOutSelected()
    {
        if (TerminalTabs.SelectedItem is not TabItem tab || !_tabs.TryGetValue(tab, out var state)) return;
        if (state.ErrorMessage.Length > 0 || !state.FrontendReady) return;
        if (state.FloatingWindow is { } existing)
        {
            existing.Activate();
            return;
        }

        tab.Content = BuildFloatingPlaceholder(state.Spec.Title);
        var window = new TerminalFloatingWindow(state.Spec.Title, state.View)
        {
            Owner = Window.GetWindow(this)
        };
        state.FloatingWindow = window;
        window.DockRequested += (_, _) => DockState(state, closeWindow: true);
        window.Closed += (_, _) =>
        {
            if (!state.Closing && ReferenceEquals(state.FloatingWindow, window))
                DockState(state, closeWindow: false);
        };
        window.Show();
        UpdateSelectedDetails();
    }

    private void DockState(TerminalTabState state, bool closeWindow)
    {
        var window = state.FloatingWindow;
        if (window is null) return;
        var content = window.ReleaseContent();
        state.FloatingWindow = null;
        if (content is not null)
            state.Tab.Content = content;
        TerminalTabs.SelectedItem = state.Tab;
        if (closeWindow && window.IsVisible)
            window.Close();
        Post(state, new { type = "focus" });
        UpdateSelectedDetails();
    }

    private static UIElement BuildFloatingPlaceholder(string title)
    {
        return new Grid
        {
            Background = new SolidColorBrush(Color.FromRgb(13, 19, 32)),
            Children =
            {
                new TextBlock
                {
                    Text = string.IsNullOrWhiteSpace(title) ? "该终端已在独立窗口中运行" : title + " 已在独立窗口中运行",
                    Foreground = new SolidColorBrush(Color.FromRgb(139, 160, 185)),
                    HorizontalAlignment = HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center,
                    FontSize = 12.5
                }
            }
        };
    }

    private void UpdateSummary()
    {
        SessionSummary.Text = $"{_tabs.Count} 个会话";
        TerminalEmptyState.Visibility = _tabs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        SessionCountChanged?.Invoke(this, EventArgs.Empty);
    }

    private void UpdateSelectedDetails()
    {
        if (TerminalTabs.SelectedItem is not TabItem tab || !_tabs.TryGetValue(tab, out var state))
        {
            SelectedTitleText.Text = "尚未选择会话";
            SelectedModeText.Text = HostMode == TerminalHostMode.Development ? "开发页主区域" : "底部固定栏";
            SelectedPathText.Text = string.Empty;
            SelectedProcessText.Text = string.Empty;
            RestartButton.IsEnabled = false;
            return;
        }

        SelectedTitleText.Text = state.Spec.Title;
        SelectedModeText.Text = Path.GetFileNameWithoutExtension(state.Spec.Executable)
                                + (state.FloatingWindow is not null
                                    ? " · 独立窗口"
                                    : HostMode == TerminalHostMode.Development
                                        ? " · 开发页主区域"
                                        : " · 底部固定栏");
        SelectedPathText.Text = state.Spec.WorkingDirectory;
        SelectedProcessText.Text = state.ErrorMessage.Length > 0
            ? "启动失败 · " + state.ErrorMessage
            : state.Session is null
                ? state.Exited ? "进程已退出" : "正在初始化终端"
                : $"PID {state.Session.ProcessId}";
        RestartButton.IsEnabled = state.Exited || state.ErrorMessage.Length > 0;
    }

    private async void NewPowerShell_Click(object sender, RoutedEventArgs e) => await OpenShellAsync("powershell");
    private async void NewCmd_Click(object sender, RoutedEventArgs e) => await OpenShellAsync("cmd");

    private void Clear_Click(object sender, RoutedEventArgs e)
    {
        if (TerminalTabs.SelectedItem is TabItem tab && _tabs.TryGetValue(tab, out var state))
            Post(state, new { type = "clear" });
    }

    private async void Restart_Click(object sender, RoutedEventArgs e)
    {
        if (TerminalTabs.SelectedItem is TabItem tab && _tabs.TryGetValue(tab, out var state))
            await RestartStateAsync(state);
    }

    private void HostMode_Click(object sender, RoutedEventArgs e)
    {
        if (HostMode == TerminalHostMode.Development)
            DockBottomRequested?.Invoke(this, EventArgs.Empty);
        else
            EmbedDevelopmentRequested?.Invoke(this, EventArgs.Empty);
    }

    private void PopOut_Click(object sender, RoutedEventArgs e) => PopOutSelected();
    private async void CloseTab_Click(object sender, RoutedEventArgs e) => await CloseSelectedAsync();

    private void Collapse_Click(object sender, RoutedEventArgs e)
    {
        if (HostMode == TerminalHostMode.Development)
            DockBottomRequested?.Invoke(this, EventArgs.Empty);
        else
            CollapseRequested?.Invoke(this, EventArgs.Empty);
    }

    private void TerminalTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TerminalTabs.SelectedItem is TabItem tab && _tabs.TryGetValue(tab, out var state))
            Post(state, new { type = "focus" });
        UpdateSelectedDetails();
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var state in _tabs.Values.ToArray())
        {
            state.Closing = true;
            if (state.FloatingWindow is { } floating)
            {
                floating.ReleaseContent();
                state.FloatingWindow = null;
                floating.Close();
            }
            if (state.Session is not null) await state.Session.DisposeAsync();
            state.View.Dispose();
        }
        _tabs.Clear();
    }

    private sealed class TerminalTabState
    {
        public TerminalTabState(TabItem tab, WebView2 view, TerminalLaunchSpec spec)
        {
            Tab = tab;
            View = view;
            Spec = spec;
        }

        public TabItem Tab { get; }
        public WebView2 View { get; }
        public TerminalLaunchSpec Spec { get; }
        public ITerminalSession? Session { get; set; }
        public TerminalFloatingWindow? FloatingWindow { get; set; }
        public bool FrontendReady { get; set; }
        public string ErrorMessage { get; set; } = string.Empty;
        public bool Exited { get; set; }
        public bool Closing { get; set; }
        public bool IntentionalExit { get; set; }
        public bool AutoRetryUsed { get; set; }
        public DateTime StartedUtc { get; set; }
        public int Columns { get; set; } = 100;
        public int Rows { get; set; } = 28;
        public StringBuilder InputLine { get; } = new();
    }
}
