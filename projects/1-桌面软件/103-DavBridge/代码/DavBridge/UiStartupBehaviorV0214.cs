using System.Reflection;

namespace DavBridge;

internal sealed class UiStartupBehaviorV0214 : IDisposable
{
    private readonly MainForm _form;
    private readonly AppHost _host;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 160 };
    private readonly DateTime _createdAt = DateTime.UtcNow;
    private bool _handled;
    private bool _disposed;

    private UiStartupBehaviorV0214(MainForm form, UiDashboardV027 dashboard)
    {
        _form = form;
        _host = typeof(UiDashboardV027).GetField("_host", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(dashboard) as AppHost
            ?? throw new InvalidOperationException("DavBridge UI host unavailable.");
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
    }

    public static UiStartupBehaviorV0214 Attach(MainForm form, UiDashboardV027 dashboard) => new(form, dashboard);

    private void Tick()
    {
        if (_handled || _disposed || _form.IsDisposed) return;
        var background = typeof(MainForm).GetField("_launchInBackground", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_form) is bool value && value;
        if (background)
        {
            _handled = true;
            return;
        }

        if (_host.IsConfigured)
        {
            if (!_form.Visible || !_form.ShowInTaskbar)
            {
                _form.ShowInTaskbar = true;
                _form.Show();
                _form.WindowState = FormWindowState.Normal;
                _form.Activate();
            }
            _handled = true;
            return;
        }

        if (DateTime.UtcNow - _createdAt > TimeSpan.FromSeconds(4) && _form.Visible)
            _handled = true;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
    }
}
