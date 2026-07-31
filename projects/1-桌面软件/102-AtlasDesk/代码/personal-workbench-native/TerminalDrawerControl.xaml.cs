using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace PersonalWorkbench;

public partial class TerminalDrawerControl : UserControl, IAsyncDisposable
{
    private readonly AppSettings _settings;
    private readonly Dictionary<TabItem, TerminalTabState> _tabs = new();
    private CoreWebView2Environment? _environment;
    private string _assetRoot = string.Empty;
    private int _sequence;

    public event EventHandler? CollapseRequested;

    public TerminalDrawerControl() : this(AppSettings.Load()) { }

    public TerminalDrawerControl(AppSettings settings)
    {
        _settings = settings;
        InitializeComponent();
        UpdateSummary();
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

    public async Task OpenShellAsync(string shell, PythonEnvironmentInfo? environment = null, string? title = null)
        => await OpenAsync(TerminalLaunchSpec.Create(_settings, shell, environment, title));

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
                    if (state.Session is not null && root.TryGetProperty("data", out var input))
                        await state.Session.WriteAsync(input.GetString() ?? string.Empty);
                    break;
                case "resize":
                    if (state.Session is not null)
                    {
                        var resizeCols = root.TryGetProperty("cols", out var c) ? c.GetInt32() : 100;
                        var resizeRows = root.TryGetProperty("rows", out var r) ? r.GetInt32() : 28;
                        state.Session.Resize(resizeCols, resizeRows);
                    }
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

    private async Task StartSessionAsync(TerminalTabState state, int columns, int rows)
    {
        if (state.Session is not null || state.Closing) return;
        try
        {
            state.Session = ConPtySession.Start(state.Spec, columns, rows);
            state.Session.OutputReceived += (_, text) => Dispatcher.BeginInvoke(() => Post(state, new { type = "output", data = text }));
            state.Session.Exited += (_, code) => Dispatcher.BeginInvoke(() =>
            {
                Post(state, new { type = "output", data = $"\r\n\u001b[90m[进程已退出，代码 {code}]\u001b[0m\r\n" });
                state.Exited = true;
                state.Tab.Header = BuildHeader(state.Spec.Title + " · 已退出");
                UpdateSelectedDetails();
            });
            Post(state, new { type = "settings", fontSize = _settings.TerminalFontSize, scrollback = _settings.TerminalScrollback });
            if (!string.IsNullOrWhiteSpace(state.Spec.InitialInput))
            {
                await Task.Delay(90);
                await state.Session.WriteAsync(state.Spec.InitialInput);
            }
            Post(state, new { type = "focus" });
            UpdateSelectedDetails();
        }
        catch (Exception ex)
        {
            App.Log("ConPTY session start failed: " + ex);
            state.ErrorMessage = ex.Message;
            Post(state, new { type = "output", data = "\r\n\u001b[31m内置终端启动失败：" + Sanitize(ex.Message) + "\u001b[0m\r\n" });
            UpdateSelectedDetails();
        }
    }

    private void SetFrontendFailure(TerminalTabState state, string message)
    {
        if (state.Closing || !_tabs.ContainsKey(state.Tab)) return;
        state.ErrorMessage = string.IsNullOrWhiteSpace(message) ? "未知错误" : message.Trim();
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
            Foreground = new SolidColorBrush(Color.FromRgb(166, 184, 207)),
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
            Foreground = new SolidColorBrush(Color.FromRgb(255, 135, 147)),
            FontSize = 15,
            FontWeight = FontWeights.SemiBold,
            TextAlignment = TextAlignment.Center
        });
        stack.Children.Add(new TextBlock
        {
            Text = state.ErrorMessage,
            Foreground = new SolidColorBrush(Color.FromRgb(139, 157, 181)),
            FontSize = 11.2,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 8, 0, 0)
        });
        var retry = new Button
        {
            Content = "重试",
            Style = Application.Current.TryFindResource("TerminalHeaderButton") as Style,
            Width = 78,
            Margin = new Thickness(0, 14, 0, 0),
            HorizontalAlignment = HorizontalAlignment.Center
        };
        retry.Click += async (_, _) =>
        {
            TerminalTabs.SelectedItem = state.Tab;
            await CloseSelectedAsync();
            await OpenAsync(state.Spec);
        };
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
                    Foreground = new SolidColorBrush(Color.FromRgb(116, 137, 163)),
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
    }

    private void UpdateSelectedDetails()
    {
        if (TerminalTabs.SelectedItem is not TabItem tab || !_tabs.TryGetValue(tab, out var state))
        {
            SelectedTitleText.Text = "尚未选择会话";
            SelectedModeText.Text = string.Empty;
            SelectedPathText.Text = string.Empty;
            SelectedProcessText.Text = string.Empty;
            return;
        }

        SelectedTitleText.Text = state.Spec.Title;
        SelectedModeText.Text = Path.GetFileNameWithoutExtension(state.Spec.Executable)
                                + (state.FloatingWindow is null ? " · 底部停靠" : " · 独立窗口");
        SelectedPathText.Text = state.Spec.WorkingDirectory;
        SelectedProcessText.Text = state.ErrorMessage.Length > 0
            ? "启动失败 · " + state.ErrorMessage
            : state.Session is null
                ? "正在初始化终端"
                : state.Exited ? "进程已退出" : $"PID {state.Session.ProcessId}";
    }

    private async void NewPowerShell_Click(object sender, RoutedEventArgs e) => await OpenShellAsync("powershell");
    private async void NewCmd_Click(object sender, RoutedEventArgs e) => await OpenShellAsync("cmd");

    private void Clear_Click(object sender, RoutedEventArgs e)
    {
        if (TerminalTabs.SelectedItem is TabItem tab && _tabs.TryGetValue(tab, out var state))
            Post(state, new { type = "clear" });
    }

    private void PopOut_Click(object sender, RoutedEventArgs e) => PopOutSelected();
    private async void CloseTab_Click(object sender, RoutedEventArgs e) => await CloseSelectedAsync();
    private void Collapse_Click(object sender, RoutedEventArgs e) => CollapseRequested?.Invoke(this, EventArgs.Empty);

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
        public ConPtySession? Session { get; set; }
        public TerminalFloatingWindow? FloatingWindow { get; set; }
        public bool FrontendReady { get; set; }
        public string ErrorMessage { get; set; } = string.Empty;
        public bool Exited { get; set; }
        public bool Closing { get; set; }
    }
}
