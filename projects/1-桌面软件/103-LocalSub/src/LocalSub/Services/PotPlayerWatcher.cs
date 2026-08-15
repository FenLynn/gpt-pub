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
            var pid = (uint)process.Id;
            IntPtr best = IntPtr.Zero;
            Rectangle bestRect = Rectangle.Empty;
            long bestArea = 0;
            bool anyMinimized = false;

            EnumWindows((hwnd, _) =>
            {
                if (!IsWindow(hwnd) || !IsWindowVisible(hwnd)) return true;
                GetWindowThreadProcessId(hwnd, out var windowPid);
                if (windowPid != pid) return true;

                if (IsIconic(hwnd))
                {
                    anyMinimized = true;
                    return true;
                }

                if (!GetWindowRect(hwnd, out var rect)) return true;
                var width = rect.Right - rect.Left;
                var height = rect.Bottom - rect.Top;
                if (width < 160 || height < 90) return true;
                var area = (long)width * height;
                if (area <= bestArea) return true;

                bestArea = area;
                best = hwnd;
                bestRect = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
                return true;
            }, IntPtr.Zero);

            if (best != IntPtr.Zero)
            {
                bounds = bestRect;
                minimized = false;
                return true;
            }

            minimized = anyMinimized;
            return anyMinimized;
        }
        catch { return false; }
    }

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
}
