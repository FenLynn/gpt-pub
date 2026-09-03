using System.Runtime.InteropServices;
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
    private const int VkLButton = 0x01;
    private const int VkRButton = 0x02;
    private const int VkMButton = 0x04;
    private const int VkXButton1 = 0x05;
    private const int VkXButton2 = 0x06;
    private const uint GaRoot = 2;

    private readonly DispatcherTimer _inputWatchdog;
    private IntPtr _hostHandle;
    private IntPtr _dashboardHandle;
    private bool _observedDetached;
    private bool _mouseWasDown;
    private int _focusRecoveryAttempts;

    public DashboardProcessSurface()
    {
        Focusable = true;
        SizeChanged += (_, _) => ResizeDashboardWindow();
        GotKeyboardFocus += (_, _) => _ = ActivateDashboardInput();
        PreviewMouseDown += (_, _) => QueueDashboardInputActivation();

        _inputWatchdog = new DispatcherTimer(DispatcherPriority.Input)
        {
            Interval = TimeSpan.FromMilliseconds(25)
        };
        _inputWatchdog.Tick += InputWatchdog_Tick;
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

        _observedDetached = false;
        _focusRecoveryAttempts = 8;
        QueueDashboardInputActivation();
    }

    public void DetachDashboardWindow()
    {
        _dashboardHandle = IntPtr.Zero;
        _observedDetached = false;
        _mouseWasDown = false;
        _focusRecoveryAttempts = 0;
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
            || !IsWindow(_dashboardHandle)
            || GetParent(_dashboardHandle) != _hostHandle)
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

        _inputWatchdog.Start();
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
            QueueDashboardInputActivation();
        }

        return base.WndProc(hwnd, msg, wParam, lParam, ref handled);
    }

    protected override void DestroyWindowCore(HandleRef hwnd)
    {
        _inputWatchdog.Stop();
        _dashboardHandle = IntPtr.Zero;
        _observedDetached = false;
        _mouseWasDown = false;
        _focusRecoveryAttempts = 0;
        if (hwnd.Handle != IntPtr.Zero)
            _ = DestroyWindow(hwnd.Handle);
        _hostHandle = IntPtr.Zero;
    }

    private void InputWatchdog_Tick(object? sender, EventArgs e)
    {
        if (_hostHandle == IntPtr.Zero
            || _dashboardHandle == IntPtr.Zero
            || !IsWindow(_dashboardHandle))
        {
            _mouseWasDown = false;
            return;
        }

        var parent = GetParent(_dashboardHandle);
        if (parent != _hostHandle)
        {
            _observedDetached = true;
            _mouseWasDown = false;
            _focusRecoveryAttempts = 0;
            return;
        }

        if (_observedDetached)
        {
            _observedDetached = false;
            _focusRecoveryAttempts = 12;
            ResizeDashboardWindow();
        }

        if (_focusRecoveryAttempts > 0)
        {
            _focusRecoveryAttempts--;
            QueueDashboardInputActivation();
        }

        var mouseDown = IsAnyMouseButtonDown();
        if (mouseDown && !_mouseWasDown && IsCursorInsideHost())
            QueueDashboardInputActivation();
        _mouseWasDown = mouseDown;
    }

    private void QueueDashboardInputActivation()
    {
        Dispatcher.BeginInvoke(
            DispatcherPriority.Input,
            new Action(() => _ = ActivateDashboardInput()));
    }

    private bool IsCursorInsideHost()
    {
        if (_hostHandle == IntPtr.Zero
            || !GetCursorPos(out var point)
            || !GetWindowRect(_hostHandle, out var rect))
        {
            return false;
        }

        return point.X >= rect.Left
               && point.X < rect.Right
               && point.Y >= rect.Top
               && point.Y < rect.Bottom;
    }

    private static bool IsAnyMouseButtonDown()
        => IsKeyDown(VkLButton)
           || IsKeyDown(VkRButton)
           || IsKeyDown(VkMButton)
           || IsKeyDown(VkXButton1)
           || IsKeyDown(VkXButton2);

    private static bool IsKeyDown(int key)
        => (GetAsyncKeyState(key) & 0x8000) != 0;

    private void ResizeDashboardWindow()
    {
        if (_dashboardHandle == IntPtr.Zero
            || !IsWindow(_dashboardHandle)
            || GetParent(_dashboardHandle) != _hostHandle)
        {
            return;
        }

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

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
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

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hwnd);

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

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out NativePoint point);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hwnd, out NativeRect rect);
}
