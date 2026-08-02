using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace PersonalWorkbench;

internal static class WindowWorkAreaGuard
{
    private const int WmGetMinMaxInfo = 0x0024;
    private const uint MonitorDefaultToNearest = 0x00000002;

    public static void Attach(Window window)
    {
        ArgumentNullException.ThrowIfNull(window);

        var handle = new WindowInteropHelper(window).Handle;
        if (handle == IntPtr.Zero)
            return;

        if (HwndSource.FromHwnd(handle) is not HwndSource source)
            return;

        source.AddHook(WindowProc);
        window.Closed += (_, _) => source.RemoveHook(WindowProc);
    }

    private static IntPtr WindowProc(
        IntPtr hwnd,
        int message,
        IntPtr wParam,
        IntPtr lParam,
        ref bool handled)
    {
        if (message != WmGetMinMaxInfo || lParam == IntPtr.Zero)
            return IntPtr.Zero;

        ApplyMonitorWorkArea(hwnd, lParam);
        handled = true;
        return IntPtr.Zero;
    }

    private static void ApplyMonitorWorkArea(IntPtr hwnd, IntPtr lParam)
    {
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero)
            return;

        var monitorInfo = new MonitorInfo
        {
            Size = Marshal.SizeOf<MonitorInfo>()
        };

        if (!GetMonitorInfo(monitor, ref monitorInfo))
            return;

        var work = monitorInfo.WorkArea;
        var bounds = monitorInfo.MonitorArea;
        var minMax = Marshal.PtrToStructure<MinMaxInfo>(lParam);

        minMax.MaxPosition.X = work.Left - bounds.Left;
        minMax.MaxPosition.Y = work.Top - bounds.Top;
        minMax.MaxSize.X = work.Right - work.Left;
        minMax.MaxSize.Y = work.Bottom - work.Top;
        minMax.MaxTrackSize.X = minMax.MaxSize.X;
        minMax.MaxTrackSize.Y = minMax.MaxSize.Y;

        Marshal.StructureToPtr(minMax, lParam, false);
    }

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo monitorInfo);

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinMaxInfo
    {
        public Point Reserved;
        public Point MaxSize;
        public Point MaxPosition;
        public Point MinTrackSize;
        public Point MaxTrackSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public Rect MonitorArea;
        public Rect WorkArea;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
