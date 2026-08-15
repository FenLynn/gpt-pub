using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LocalSub.Services;

public static class PotPlayerWatcher
{
    static readonly string[] Names = ["PotPlayerMini64", "PotPlayerMini", "PotPlayer"];

    public static Process? FindRunning()
    {
        foreach (var name in Names)
        {
            try
            {
                var p = Process.GetProcessesByName(name)
                    .Where(x => !x.HasExited)
                    .OrderByDescending(x => SafeStartTime(x))
                    .FirstOrDefault();
                if (p != null) return p;
            }
            catch { }
        }
        return null;
    }

    static DateTime SafeStartTime(Process p)
    {
        try { return p.StartTime; } catch { return DateTime.MinValue; }
    }

    public static bool TryGetWindowState(Process process, out Rectangle bounds, out bool minimized)
    {
        bounds = Rectangle.Empty;
        minimized = false;
        try
        {
            if (process.HasExited) return false;
            process.Refresh();
            var hwnd = process.MainWindowHandle;
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd) || !IsWindowVisible(hwnd)) return false;
            minimized = IsIconic(hwnd);
            if (!GetWindowRect(hwnd, out var rect)) return false;
            if (rect.Right <= rect.Left || rect.Bottom <= rect.Top) return false;
            bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
            return true;
        }
        catch { return false; }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
}
