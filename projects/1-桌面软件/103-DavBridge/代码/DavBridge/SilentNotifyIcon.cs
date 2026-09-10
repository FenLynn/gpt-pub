namespace DavBridge;

/// <summary>
/// Keeps the Windows tray icon and its menu behavior while deliberately
/// suppressing all desktop balloon notifications. DavBridge surfaces state
/// inside its own UI instead of pushing system notifications.
/// </summary>
internal sealed class NotifyIcon : IDisposable
{
    private readonly System.Windows.Forms.NotifyIcon _inner = new();

    public string Text
    {
        get => _inner.Text;
        set => _inner.Text = value;
    }

    public System.Drawing.Icon? Icon
    {
        get => _inner.Icon;
        set => _inner.Icon = value;
    }

    public System.Windows.Forms.ContextMenuStrip? ContextMenuStrip
    {
        get => _inner.ContextMenuStrip;
        set => _inner.ContextMenuStrip = value;
    }

    public bool Visible
    {
        get => _inner.Visible;
        set => _inner.Visible = value;
    }

    // Kept for source compatibility with the existing host. Values are
    // intentionally discarded because desktop balloon notifications are off.
    public string BalloonTipTitle
    {
        get => string.Empty;
        set { }
    }

    public string BalloonTipText
    {
        get => string.Empty;
        set { }
    }

    public event EventHandler? DoubleClick
    {
        add => _inner.DoubleClick += value;
        remove => _inner.DoubleClick -= value;
    }

    public void ShowBalloonTip(int timeout)
    {
        // Intentionally disabled. Keep tray functionality without desktop push notifications.
    }

    public void Dispose() => _inner.Dispose();
}
