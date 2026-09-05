using System.Reflection;
using DavBridge.Core;

namespace DavBridge;
internal sealed class UiResetCountdownV0216 : IDisposable
{
    private readonly AppHost _host;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    private readonly Label _label;
    private bool _disposed;

    private UiResetCountdownV0216(UiDashboardV027 dashboard, AppHost host)
    {
        _host = host;
        var field = typeof(UiDashboardV027).GetField("_resetValue", BindingFlags.Instance | BindingFlags.NonPublic);
        var old = field?.GetValue(dashboard) as Label;
        if (old?.Parent is not TableLayoutPanel parent)
            throw new InvalidOperationException("Reset label host not found.");
        var pos = parent.GetPositionFromControl(old);
        parent.Controls.Remove(old);
        _label = new Label
        {
            AutoSize = true,
            ForeColor = Color.Gray,
            Anchor = AnchorStyles.Right,
            Margin = new Padding(0,6,0,0)
        };
        parent.Controls.Add(_label,pos.Column,pos.Row);
        parent.SetColumnSpan(_label,2);
        Refresh();
        _timer.Tick += (_,_) => Refresh();
        _timer.Start();
    }

    public static UiResetCountdownV0216 Attach(UiDashboardV027 dashboard, AppHost host) => new(dashboard,host);

    private void Refresh()
    {
        if (_host.Config.NextResetAt == default) { _label.Text = "流量尚未校准"; return; }
        var reset = ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt);
        var days = (reset.Date - DateTimeOffset.Now.Date).Days;
        var countdown = days <= 0 ? "今天 09:00 后探测" : days == 1 ? "还剩 1 天" : $"还剩 {days} 天";
        _label.Text = $"{reset:yyyy-MM-dd} 重置 · {countdown} · 09:00 后自动探测";
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        _label.Dispose();
    }
}
