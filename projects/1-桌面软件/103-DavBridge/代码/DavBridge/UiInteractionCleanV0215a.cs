using System.Reflection;

namespace DavBridge;

internal sealed partial class UiInteractionCleanV0215 : IDisposable
{
    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly UiStartupBehaviorV0214 _startup;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 180 };
    private bool _disposed;

    private UiInteractionCleanV0215(MainForm form, UiDashboardV027 dashboard, AppHost host)
    {
        _form = form;
        _dashboard = dashboard;
        _host = host;
        _startup = UiStartupBehaviorV0214.Attach(form, dashboard);
        InstallCalibration();
        ApplyLayout();
        _timer.Tick += (_, _) => PolishOpenForms();
        _timer.Start();
    }

    public static UiInteractionCleanV0215 Attach(MainForm form, UiDashboardV027 dashboard, AppHost host) => new(form, dashboard, host);

    private T? Field<T>(string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_dashboard) as T; }
        catch { return null; }
    }

    private void ApplyLayout()
    {
        if (Field<TransportActionButtonV027>("_primary") is { } primary && primary.Parent is TableLayoutPanel bottom)
        {
            primary.Width = 112;
            primary.Height = 40;
            primary.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
            bottom.Margin = new Padding(0, 26, 0, 6);
            bottom.MinimumSize = new Size(0, 54);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        _startup.Dispose();
    }
}
