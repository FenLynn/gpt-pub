using System.Reflection;
using DavBridge.Core;

namespace DavBridge;

internal sealed partial class UiMessageBarV0216 : IDisposable
{
    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 500 };
    private readonly MessageSurface _surface = new() { Dock = DockStyle.Bottom, Height = 32 };
    private EngineProgress? _lastProgress;
    private bool _disposed;

    private UiMessageBarV0216(MainForm form, UiDashboardV027 dashboard, AppHost host)
    {
        _form = form;
        _dashboard = dashboard;
        _host = host;
        if (Field<TableLayoutPanel>("_shell") is { } shell)
            shell.Padding = new Padding(shell.Padding.Left, shell.Padding.Top, shell.Padding.Right, 32);
        if (Field<Panel>("_dashboard") is { } root)
        {
            root.Controls.Add(_surface);
            _surface.BringToFront();
        }
        _host.ProgressChanged += OnProgress;
        _timer.Tick += (_, _) => RefreshUi();
        _timer.Start();
        RefreshUi();
    }

    public static UiMessageBarV0216 Attach(MainForm form, UiDashboardV027 dashboard, AppHost host) => new(form, dashboard, host);

    private T? Field<T>(string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_dashboard) as T; }
        catch { return null; }
    }

    private void OnProgress(object? sender, EngineProgress progress) => _lastProgress = progress;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _host.ProgressChanged -= OnProgress;
        _timer.Stop();
        _timer.Dispose();
        _surface.Dispose();
    }
}
