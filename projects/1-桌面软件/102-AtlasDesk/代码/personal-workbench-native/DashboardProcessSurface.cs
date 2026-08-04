using System.Runtime.InteropServices;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;

namespace PersonalWorkbench;

/// <summary>
/// Owns a lightweight native child HWND inside WPF and reparents the isolated
/// Dashboard process window into it. The browser and its native control remain
/// outside the AtlasDesk process even though the user sees one integrated page.
/// </summary>
public sealed class DashboardProcessSurface : HwndHost
{
    private const int GwlStyle = -16;
    private const long WsChild = 0x40000000L;
    private const long WsVisible = 0x10000000L;
    private const long WsPopup = unchecked((long)0x80000000);
    private const long WsCaption = 0x00C00000L;
    private const long WsThickFrame = 0x00040000L;
    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpNoActivate = 0x0010;
    private const uint SwpFrameChanged = 0x0020;
    private const int SwShow = 5;
    private const int WmSetFocus = 0x0007;
    private const int WmParentNotify = 0x0210;
    private const int WmLButtonDown = 0x0201;
    private const int WmRButtonDown = 0x0204;
    private const int WmMButtonDown = 0x0207;
    private const int WmXButtonDown = 0x020B;
    private const uint GaRoot = 2;

    private IntPtr _hostHandle;
    private IntPtr _dashboardHandle;

    public DashboardProcessSurface()
    {
        Focusable = true;
        SizeChanged += (_, _) => ResizeDashboardWindow();
        GotKeyboardFocus += (_, _) => _ = ActivateDashboardInput();
        PreviewMouseDown += (_, _) => _ = ActivateDashboardInput();
    }

    public IntPtr HostHandle => _hostHandle;
    public IntPtr DashboardHandle => _dashboardHandle;

    public void AttachDashboardWindow(IntPtr dashboardHandle)
    {
        if (_hostHandle == IntPtr.Zero)
            throw new InvalidOperationException("Dashboard native host has not been created yet.");
        if (dashboardHandle == IntPtr.Zero || !IsWindow(dashboardHandle))
            throw new InvalidOperationException("Dashboard process did not provide a valid window handle.");

        _dashboardHandle = dashboardHandle;
        _ = SetParent(dashboardHandle, _hostHandle);

        var style = GetWindowStyle(dashboardHandle);
        style &= ~(WsPopup | WsCaption | WsThickFrame);
        style |= WsChild | WsVisible;
        SetWindowStyle(dashboardHandle, style);

        _ = SetWindowPos(
            dashboardHandle,
            IntPtr.Zero,
            0,
            0,
            Math.Max(1, (int)Math.Round(ActualWidth)),
            Math.Max(1, (int)Math.Round(ActualHeight)),
            SwpNoZOrder | SwpNoActivate | SwpFrameChanged);
        _ = ShowWindow(dashboardHandle, SwShow);
        ResizeDashboardWindow();

        Dispatcher.BeginInvoke(
            DispatcherPriority.Input,
            new Action(() => _ = ActivateDashboardInput()));
    }

    public void DetachDashboardWindow()
    {
        _dashboardHandle = IntPtr.Zero;
    }

    /// <summary>
    /// SetParent does not merge the WPF and DashboardHost input queues. Temporarily
    /// attach both UI threads while transferring focus, then detach immediately.
    /// This keeps process isolation while allowing WebView2 text fields to receive
    /// real keyboard input.
    /// </summary>
    public bool ActivateDashboardInput()
    {
        if (_hostHandle == IntPtr.Zero
            || _dashboardHandle == IntPtr.Zero
            || !IsWindow(_dashboardHandle))
        {
            return false;
        }

        var currentThread = GetCurrentThreadId();
        var dashboardThread = GetWindowThreadProcessId(_dashboardHandle, out _);
        var attached = false;
        try
        {
            if (dashboardThread != 0 && dashboardThread != currentThread)
                attached = AttachThreadInput(currentThread, dashboardThread, true);

            var root = GetAncestor(_hostHandle, GaRoot);
            if (root != IntPtr.Zero)
            {
                _ = SetForegroundWindow(root);
                _ = SetActiveWindow(root);
            }

            _ = SetFocus(_dashboardHandle);
            var focused = GetFocus();
            return focused == _dashboardHandle
                   || (focused != IntPtr.Zero && IsChild(_dashboardHandle, focused));
        }
        finally
        {
            if (attached)
                _ = AttachThreadInput(currentThread, dashboardThread, false);
        }
    }

    protected override bool TabInto(TraversalRequest request)
        => ActivateDashboardInput();

    protected override HandleRef BuildWindowCore(HandleRef hwndParent)
    {
        _hostHandle = CreateWindowEx(
            0,
            "static",
            string.Empty,
            (uint)(WsChild | WsVisible),
            0,
            0,
            1,
            1,
            hwndParent.Handle,
            IntPtr.Zero,
            IntPtr.Zero,
            IntPtr.Zero);

        if (_hostHandle == IntPtr.Zero)
            throw new InvalidOperationException("Unable to create the isolated Dashboard native host window.");

        return new HandleRef(this, _hostHandle);
    }

    protected override IntPtr WndProc(
        IntPtr hwnd,
        int msg,
        IntPtr wParam,
        IntPtr lParam,
        ref bool handled)
    {
        if (msg == WmSetFocus
            || (msg == WmParentNotify && IsMouseButtonMessage(LowWord(wParam))))
        {
            Dispatcher.BeginInvoke(
                DispatcherPriority.Input,
                new Action(() => _ = ActivateDashboardInput()));
        }

        return base.WndProc(hwnd, msg, wParam, lParam, ref handled);
    }

    protected override void DestroyWindowCore(HandleRef hwnd)
    {
        _dashboardHandle = IntPtr.Zero;
        if (hwnd.Handle != IntPtr.Zero)
            _ = DestroyWindow(hwnd.Handle);
        _hostHandle = IntPtr.Zero;
    }

    private void ResizeDashboardWindow()
    {
        if (_dashboardHandle == IntPtr.Zero || !IsWindow(_dashboardHandle))
            return;

        _ = MoveWindow(
            _dashboardHandle,
            0,
            0,
            Math.Max(1, (int)Math.Round(ActualWidth)),
            Math.Max(1, (int)Math.Round(ActualHeight)),
            true);
    }

    private static int LowWord(IntPtr value)
        => unchecked((short)(long)value) & 0xFFFF;

    private static bool IsMouseButtonMessage(int message)
        => message is WmLButtonDown or WmRButtonDown or WmMButtonDown or WmXButtonDown;

    private static long GetWindowStyle(IntPtr hwnd)
        => IntPtr.Size == 8
            ? GetWindowLongPtr(hwnd, GwlStyle).ToInt64()
            : GetWindowLong(hwnd, GwlStyle);

    private static void SetWindowStyle(IntPtr hwnd, long style)
    {
        if (IntPtr.Size == 8)
            _ = SetWindowLongPtr(hwnd, GwlStyle, new IntPtr(style));
        else
            _ = SetWindowLong(hwnd, GwlStyle, unchecked((int)style));
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(
        uint extendedStyle,
        string className,
        string windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        IntPtr parent,
        IntPtr menu,
        IntPtr instance,
        IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr child, IntPtr newParent);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hwnd, int index);

    [DllImport("user32.dll", EntryPoint = "SetWindowLong", SetLastError = true)]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int newValue);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hwnd, int index, IntPtr newValue);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveWindow(
        IntPtr hwnd,
        int x,
        int y,
        int width,
        int height,
        [MarshalAs(UnmanagedType.Bool)] bool repaint);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPos(
        IntPtr hwnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsChild(IntPtr parent, IntPtr child);

    [DllImport("user32.dll")]
    private static extern IntPtr SetFocus(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetFocus();

    [DllImport("user32.dll")]
    private static extern IntPtr SetActiveWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
}
