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

    internal static (int X, int Y, int Width, int Height) CalculateMaximizedBounds(
        int monitorLeft,
        int monitorTop,
        int workLeft,
        int workTop,
        int workRight,
        int workBottom)
        => (
            workLeft - monitorLeft,
            workTop - monitorTop,
            workRight - workLeft,
            workBottom - workTop);

    private static IntPtr WindowProc(
        IntPtr hwnd,
        int message,
        IntPtr wParam,
        IntPtr lParam,
        ref bool handled)
    {
        if (message != WmGetMinMaxInfo || lParam == IntPtr.Zero)
            return IntPtr.Zero;

        handled = TryApplyMonitorWorkArea(hwnd, lParam);
        return IntPtr.Zero;
    }

    private static bool TryApplyMonitorWorkArea(IntPtr hwnd, IntPtr lParam)
    {
        var monitor = MonitorFromWindow(hwnd, MonitorDefaultToNearest);
        if (monitor == IntPtr.Zero)
            return false;

        var monitorInfo = new MonitorInfo
        {
            Size = Marshal.SizeOf<MonitorInfo>()
        };

        if (!GetMonitorInfo(monitor, ref monitorInfo))
            return false;

        var work = monitorInfo.WorkArea;
        var monitorBounds = monitorInfo.MonitorArea;
        var bounds = CalculateMaximizedBounds(
            monitorBounds.Left,
            monitorBounds.Top,
            work.Left,
            work.Top,
            work.Right,
            work.Bottom);
        var minMax = Marshal.PtrToStructure<MinMaxInfo>(lParam);

        minMax.MaxPosition.X = bounds.X;
        minMax.MaxPosition.Y = bounds.Y;
        minMax.MaxSize.X = bounds.Width;
        minMax.MaxSize.Y = bounds.Height;
        minMax.MaxTrackSize.X = bounds.Width;
        minMax.MaxTrackSize.Y = bounds.Height;

        Marshal.StructureToPtr(minMax, lParam, false);
        return true;
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
