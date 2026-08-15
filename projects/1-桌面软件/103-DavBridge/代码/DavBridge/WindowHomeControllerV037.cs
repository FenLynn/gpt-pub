using System.Reflection;

namespace DavBridge;

internal interface IHomeWindowControllerV037
{
    void ShowHomeAndRestore();
}

/// <summary>
/// Keeps foreground user actions distinct from Windows background autostart.
/// Manual EXE launch, second-instance activation and tray reopening all restore the main window
/// and return the v0.3 shell to the Overview page. The --background autostart path may still
/// start hidden in the tray.
/// </summary>
internal sealed class WindowHomeControllerV037 : IDisposable, IHomeWindowControllerV037
{
    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly UiShellV032 _shell;
    private readonly bool _launchInBackground;
    private readonly MethodInfo _applyPage;
    private readonly FieldInfo _pageField;
    private readonly object? _previousTag;
    private bool _seenVisible;
    private bool _startupHideOverrideConsumed;
    private bool _disposed;

    private WindowHomeControllerV037(MainForm form, AppHost host, UiShellV032 shell, bool launchInBackground)
    {
        _form = form;
        _host = host;
        _shell = shell;
        _launchInBackground = launchInBackground;
        _applyPage = typeof(UiShellV032).GetMethod("ApplyPage", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("v0.3.7 could not resolve UiShellV032.ApplyPage");
        _pageField = typeof(UiShellV032).GetField("_page", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException("v0.3.7 could not resolve UiShellV032._page");
        _previousTag = form.Tag;
        form.Tag = this;
        form.VisibleChanged += OnVisibleChanged;
    }

    public static WindowHomeControllerV037 Attach(MainForm form, AppHost host, UiShellV032 shell, bool launchInBackground) =>
        new(form, host, shell, launchInBackground);

    private void OnVisibleChanged(object? sender, EventArgs e)
    {
        if (_disposed || _form.IsDisposed) return;

        if (_form.Visible)
        {
            _seenVisible = true;
            ShowOverviewOnly();
            return;
        }

        // Auto-start already uses --background. A normal user double-click should therefore
        // never disappear into the tray only because StartMinimized is enabled in persisted config.
        if (!_launchInBackground && !_startupHideOverrideConsumed && _seenVisible && _host.Config.StartMinimized)
        {
            _startupHideOverrideConsumed = true;
            try { _form.BeginInvoke(new Action(ShowHomeAndRestore)); } catch { }
        }
    }

    public void ShowHomeAndRestore()
    {
        if (_disposed || _form.IsDisposed) return;
        ShowOverviewOnly();
        if (_form.WindowState == FormWindowState.Minimized)
            _form.WindowState = FormWindowState.Normal;
        if (!_form.Visible)
            _form.Show();
        _form.ShowInTaskbar = true;
        _form.BringToFront();
        _form.Activate();
    }

    private void ShowOverviewOnly()
    {
        _applyPage.Invoke(_shell, new object?[] { UiPageV032.Overview, null });
    }

    internal void Validate(string scenario)
    {
        ShowOverviewOnly();
        if (_pageField.GetValue(_shell) is not UiPageV032 page || page != UiPageV032.Overview)
            throw new InvalidOperationException($"UI home self-test failed [{scenario}]: shell did not return to Overview");
        if (!ReferenceEquals(_form.Tag, this))
            throw new InvalidOperationException($"UI home self-test failed [{scenario}]: single-instance home controller not attached");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _form.VisibleChanged -= OnVisibleChanged;
        if (ReferenceEquals(_form.Tag, this))
            _form.Tag = _previousTag;
    }
}
