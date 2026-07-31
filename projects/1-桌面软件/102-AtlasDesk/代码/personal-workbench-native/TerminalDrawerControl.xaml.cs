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
        UpdateSelectedDetails();
    }

    public async Task OpenAsync(TerminalLaunchSpec spec)
    {
        try
        {
            await EnsureEnvironmentAsync();
            var view = new WebView2
            {
                HorizontalAlignment = HorizontalAlignment.Stretch,
                VerticalAlignment = VerticalAlignment.Stretch
            };
            var tab = new TabItem { Header = BuildHeader(spec.Title), Content = view, Tag = ++_sequence };
            var state = new TerminalTabState(tab, view, spec);
            _tabs[tab] = state;
            TerminalTabs.Items.Add(tab);
            TerminalTabs.SelectedItem = tab;
            UpdateSummary();
            UpdateSelectedDetails();

            await view.EnsureCoreWebView2Async(_environment);
            view.CoreWebView2.SetVirtualHostNameToFolderMapping("terminal.local", _assetRoot, CoreWebView2HostResourceAccessKind.Allow);
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            view.CoreWebView2.WebMessageReceived += (_, args) => HandleWebMessage(state, args);
            view.CoreWebView2.ProcessFailed += (_, args) => App.Log("Terminal WebView process failed: " + args.ProcessFailedKind);
            view.Source = new Uri("https://terminal.local/terminal.html");
        }
        catch (Exception ex)
        {
            App.Log("Open integrated terminal failed: " + ex);
            MessageBox.Show("内置终端启动失败：\n" + ex.Message, "Personal Workbench", MessageBoxButton.OK, MessageBoxImage.Error);
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
        if (state.Session is not null) return;
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
            Post(state, new { type = "output", data = "\r\n\u001b[31m内置终端启动失败：" + ex.Message.Replace("\r", " ").Replace("\n", " ") + "\u001b[0m\r\n" });
            UpdateSelectedDetails();
        }
    }

    private static string BuildHeader(string title) => string.IsNullOrWhiteSpace(title) ? "Terminal" : title;

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

    private void UpdateSummary() => SessionSummary.Text = $"{_tabs.Count} 个会话";

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
        SelectedProcessText.Text = state.Session is null
            ? "等待终端初始化"
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
        public bool Exited { get; set; }
        public bool Closing { get; set; }
    }
}
