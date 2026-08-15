using System.Runtime.InteropServices;
using System.Text.Json;
using LocalSub.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LocalSub.UI;

public sealed class SubtitleOverlayForm : Form
{
    const int WS_EX_TRANSPARENT = 0x20;
    const int WS_EX_TOOLWINDOW = 0x80;
    const int WS_EX_NOACTIVATE = 0x08000000;

    const uint SWP_NOSIZE = 0x0001;
    const uint SWP_NOMOVE = 0x0002;
    const uint SWP_NOACTIVATE = 0x0010;
    const uint SWP_NOOWNERZORDER = 0x0200;
    static readonly IntPtr HWND_TOPMOST = new(-1);

    readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
    readonly System.Windows.Forms.Timer _clearTimer = new() { Interval = 3000 };
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
        Shown += async (_, _) =>
        {
            await EnsureInitializedAsync();
            ReassertTopmost();
        };
        _clearTimer.Tick += async (_, _) =>
        {
            _clearTimer.Stop();
            await ClearTextAsync();
        };
        FormClosed += (_, _) => _clearTimer.Dispose();
    }

    public void FollowPlayer(Rectangle playerBounds)
    {
        if (playerBounds.Width < 200 || playerBounds.Height < 120) return;
        var width = Math.Clamp(playerBounds.Width - 40, 320, 1100);
        var height = Math.Min(160, Math.Max(110, playerBounds.Height / 4));
        var left = playerBounds.Left + (playerBounds.Width - width) / 2;
        var top = playerBounds.Bottom - height - Math.Clamp(playerBounds.Height / 24, 18, 48);

        // Do not rely only on Form.TopMost. A player entering fullscreen can move itself
        // above an already-created topmost window. Reinsert the overlay at the top of the
        // topmost band on every follow tick without stealing focus.
        if (IsHandleCreated)
        {
            SetWindowPos(Handle, HWND_TOPMOST, left, top, width, height, SWP_NOACTIVATE | SWP_NOOWNERZORDER);
        }
        else
        {
            Bounds = new Rectangle(left, top, width, height);
        }
    }

    public void ReassertTopmost()
    {
        if (!IsHandleCreated || !Visible) return;
        SetWindowPos(Handle, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
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
        ReassertTopmost();

        _clearTimer.Stop();
        if (!string.IsNullOrWhiteSpace(current) || !string.IsNullOrWhiteSpace(previous))
            _clearTimer.Start();
    }

    async Task ClearTextAsync()
    {
        if (_web.CoreWebView2 == null) return;
        var payload = JsonSerializer.Serialize(new { current = "", previous = "", keywords = Array.Empty<string>() });
        await _web.CoreWebView2.ExecuteScriptAsync($"window.LocalSub.setSubtitle({payload});");
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
}
