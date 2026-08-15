using System.Text.Json;
using LocalSub.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LocalSub.UI;

public sealed class SubtitleOverlayForm : Form
{
    readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
    Task? _initializeTask;

    public SubtitleOverlayForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.Black;
        TransparencyKey = Color.Black;
        Width = 900;
        Height = 160;
        Controls.Add(_web);
        Shown += async (_, _) => await EnsureInitializedAsync();
    }

    async Task EnsureInitializedAsync()
    {
        _initializeTask ??= InitializeWebViewAsync();
        await _initializeTask;
    }

    async Task InitializeWebViewAsync()
    {
        var userData = Path.Combine(PortablePaths.BaseDir, "WebView2");
        Directory.CreateDirectory(userData);
        var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
        await _web.EnsureCoreWebView2Async(environment);

        var htmlPath = Path.Combine(PortablePaths.AssetsDir, "subtitle.html");
        if (!File.Exists(htmlPath)) throw new FileNotFoundException("字幕 HTML 模板不存在。", htmlPath);

        var loaded = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            _web.NavigationCompleted -= Handler;
            if (e.IsSuccess) loaded.TrySetResult(true);
            else loaded.TrySetException(new InvalidOperationException($"字幕 HTML 加载失败：{e.WebErrorStatus}"));
        }

        _web.NavigationCompleted += Handler;
        _web.NavigateToString(await File.ReadAllTextAsync(htmlPath));
        await loaded.Task;
    }

    public async Task SetTextAsync(string current, string previous = "", IEnumerable<string>? keywords = null)
    {
        await EnsureInitializedAsync();
        var payload = JsonSerializer.Serialize(new { current, previous, keywords = keywords?.ToArray() ?? [] });
        await _web.CoreWebView2.ExecuteScriptAsync($"window.LocalSub.setSubtitle({payload});");
    }

    protected override bool ShowWithoutActivation => true;
}
