using System.Diagnostics;
using LocalSub.Core;

namespace LocalSub.UI;

/// <summary>
/// Lightweight WinForms message-loop watchdog. It does not prevent stalls; it records
/// delayed UI ticks after the message loop becomes responsive again so remaining
/// blocking paths can be diagnosed from real machines without intrusive tracing.
/// </summary>
public sealed class UiResponsivenessMonitor : IDisposable
{
    const int TickMs = 250;
    const int StallThresholdMs = 1500;
    readonly Form _root;
    readonly System.Windows.Forms.Timer _timer = new() { Interval = TickMs };
    readonly Stopwatch _clock = Stopwatch.StartNew();
    long _lastTickMs;
    bool _started;

    UiResponsivenessMonitor(Form root)
    {
        _root = root;
        _timer.Tick += OnTick;
        _root.Shown += OnShown;
        _root.FormClosed += OnClosed;
    }

    public static UiResponsivenessMonitor Attach(Form root) => new(root);

    void OnShown(object? sender, EventArgs e)
    {
        _lastTickMs = _clock.ElapsedMilliseconds;
        _started = true;
        _timer.Start();
    }

    void OnTick(object? sender, EventArgs e)
    {
        if (!_started) return;
        var now = _clock.ElapsedMilliseconds;
        var gap = now - _lastTickMs;
        _lastTickMs = now;
        if (gap < StallThresholdMs) return;

        var tab = "unknown";
        try
        {
            tab = FindControls<TabControl>(_root).FirstOrDefault()?.SelectedTab?.Text ?? "unknown";
        }
        catch { }

        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}] UI_STALL gap={gap}ms tab={tab} visible={_root.Visible} minimized={_root.WindowState == FormWindowState.Minimized}";
        _ = Task.Run(() => Append(line));
    }

    static void Append(string line)
    {
        try
        {
            Directory.CreateDirectory(PortablePaths.LogsDir);
            File.AppendAllText(Path.Combine(PortablePaths.LogsDir, "responsiveness.log"), line + Environment.NewLine);
        }
        catch { }
    }

    static IEnumerable<T> FindControls<T>(Control root) where T : Control
    {
        foreach (Control child in root.Controls)
        {
            if (child is T t) yield return t;
            foreach (var nested in FindControls<T>(child)) yield return nested;
        }
    }

    void OnClosed(object? sender, FormClosedEventArgs e) => Dispose();

    public void Dispose()
    {
        _started = false;
        _timer.Stop();
        _timer.Tick -= OnTick;
        _root.Shown -= OnShown;
        _root.FormClosed -= OnClosed;
        _timer.Dispose();
    }
}
