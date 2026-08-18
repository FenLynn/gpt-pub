using System.Runtime.CompilerServices;
using LocalSub.Models;

namespace LocalSub.UI;

public sealed class TrayController : IDisposable
{
    static readonly ConditionalWeakTable<Form, TrayController> Controllers = new();
    readonly Form _form;
    readonly NotifyIcon _icon;
    bool _explicitExit;

    TrayController(Form form)
    {
        _form = form;
        var menu = new ContextMenuStrip();
        var show = new ToolStripMenuItem("显示 LocalSub");
        var exit = new ToolStripMenuItem("退出");
        menu.Items.Add(show);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exit);

        _icon = new NotifyIcon
        {
            Text = "LocalSub 本地字幕",
            Icon = SystemIcons.Application,
            ContextMenuStrip = menu,
            Visible = false
        };
        show.Click += (_, _) => Restore();
        exit.Click += (_, _) =>
        {
            _explicitExit = true;
            _form.Close();
        };
        _icon.DoubleClick += (_, _) => Restore();
        _form.Resize += Form_Resize;
        _form.FormClosing += Form_FormClosing;
        _form.FormClosed += (_, _) => Dispose();
    }

    public static void Attach(Form form)
    {
        if (!Controllers.TryGetValue(form, out _)) Controllers.Add(form, new TrayController(form));
    }

    void Form_Resize(object? sender, EventArgs e)
    {
        if (_form.WindowState != FormWindowState.Minimized) return;
        if (!AppSettings.Load().MinimizeToTray) return;
        _icon.Visible = true;
        _form.BeginInvoke(() => _form.Hide());
    }

    void Form_FormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_explicitExit || e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing) return;
        if (!AppSettings.Load().MinimizeToTray) return;
        e.Cancel = true;
        _icon.Visible = true;
        _form.Hide();
        _icon.ShowBalloonTip(1200, "LocalSub", "LocalSub 已在后台运行，双击托盘图标可恢复窗口。", ToolTipIcon.Info);
    }

    void Restore()
    {
        if (_form.IsDisposed) return;
        _form.Show();
        if (_form.WindowState == FormWindowState.Minimized) _form.WindowState = FormWindowState.Normal;
        _form.Activate();
        if (!AppSettings.Load().MinimizeToTray) _icon.Visible = false;
    }

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
    }
}
