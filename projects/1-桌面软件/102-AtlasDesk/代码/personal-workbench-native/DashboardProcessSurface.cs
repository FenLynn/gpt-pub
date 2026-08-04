using System.Runtime.InteropServices;
using System.Windows.Interop;

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

    private IntPtr _hostHandle;
    private IntPtr _dashboardHandle;

    public DashboardProcessSurface()
    {
        Focusable = true;
        SizeChanged += (_, _) => ResizeDashboardWindow();
        GotKeyboardFocus += (_, _) =>
        {
            if (_dashboardHandle != IntPtr.Zero && IsWindow(_dashboardHandle))
                _ = SetFocus(_dashboardHandle);
        };
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
    }

    public void DetachDashboardWindow()
    {
        _dashboardHandle = IntPtr.Zero;
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

        return new HandleRef(this, _hostHandle);
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
    private static extern IntPtr SetFocus(IntPtr hwnd);
}
