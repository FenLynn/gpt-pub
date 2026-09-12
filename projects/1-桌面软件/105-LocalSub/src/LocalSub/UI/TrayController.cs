using System.Runtime.CompilerServices;
using LocalSub.Models;

namespace LocalSub.UI;

public sealed class TrayController : IDisposable
{
    static readonly ConditionalWeakTable<Form, TrayController> Controllers = new();
    readonly Form _form;
    readonly NotifyIcon _icon;
    readonly ToolStripMenuItem _toggleLive;
    readonly ToolStripMenuItem _status;
    bool _explicitExit;

    TrayController(Form form)
    {
        _form = form;
        var menu = new ContextMenuStrip();
        var show = new ToolStripMenuItem("显示 LocalSub");
        _toggleLive = new ToolStripMenuItem("开始实时字幕");
        _status = new ToolStripMenuItem("状态：待命") { Enabled = false };
        var exit = new ToolStripMenuItem("退出");
        menu.Items.Add(show);
        menu.Items.Add(_toggleLive);
        menu.Items.Add(_status);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exit);

        _icon = new NotifyIcon
        {
            Text = "LocalSub 本地字幕",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = true
        };

        show.Click += (_, _) => Restore();
        _toggleLive.Click += async (_, _) => await ToggleLiveAsync();
        exit.Click += (_, _) =>
        {
            _explicitExit = true;
            _form.Close();
        };
        _icon.DoubleClick += (_, _) => Restore();
        _form.Resize += Form_Resize;
        _form.FormClosing += Form_FormClosing;
        _form.FormClosed += (_, _) => Dispose();

        if (_form is WebShellForm shell)
        {
            shell.TrayStateChanged += RefreshState;
            RefreshState();
        }
        else
        {
            _toggleLive.Visible = false;
            _status.Visible = false;
        }
    }

    public static TrayController Attach(Form form)
    {
        if (Controllers.TryGetValue(form, out var existing)) return existing;
        var created = new TrayController(form);
        Controllers.Add(form, created);
        return created;
    }

    public void EnterBackground(bool showBalloon = false)
    {
        if (_form.IsDisposed) return;
        _icon.Visible = true;
        _form.Hide();
        if (showBalloon)
            _icon.ShowBalloonTip(1200, "LocalSub", "LocalSub 已在后台运行，双击托盘图标可恢复窗口。", ToolTipIcon.Info);
    }

    async Task ToggleLiveAsync()
    {
        if (_form is not WebShellForm shell) return;
        try
        {
            await shell.ToggleLiveFromTrayAsync();
            RefreshState();
        }
        catch (Exception ex)
        {
            _icon.Visible = true;
            _icon.ShowBalloonTip(1800, "LocalSub", ex.Message, ToolTipIcon.Warning);
        }
    }

    void RefreshState()
    {
        if (_form is not WebShellForm shell) return;
        _toggleLive.Text = shell.IsLiveRunning ? "停止实时字幕" : "开始实时字幕";
        _status.Text = "状态：" + shell.TrayStatusText;
        _icon.Text = shell.IsLiveRunning ? "LocalSub 实时字幕运行中" : "LocalSub 本地字幕";
    }

    void Form_Resize(object? sender, EventArgs e)
    {
        if (_form.WindowState != FormWindowState.Minimized) return;
        if (!AppSettings.Load().MinimizeToTray) return;
        EnterBackground();
    }

    void Form_FormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_explicitExit || e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing) return;
        if (!AppSettings.Load().MinimizeToTray) return;
        e.Cancel = true;
        EnterBackground(showBalloon: true);
    }

    void Restore()
    {
        if (_form.IsDisposed) return;
        _form.Show();
        if (_form.WindowState == FormWindowState.Minimized) _form.WindowState = FormWindowState.Normal;
        _form.Activate();
        _icon.Visible = true;
    }

    public void Dispose()
    {
        if (_form is WebShellForm shell)
            shell.TrayStateChanged -= RefreshState;
        _icon.Visible = false;
        _icon.Dispose();
    }
}
