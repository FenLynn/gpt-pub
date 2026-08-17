using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LocalSub.Services;

public static class PotPlayerWatcher
{
    static readonly string[] Names = ["PotPlayerMini64", "PotPlayerMini", "PotPlayer"];
    static readonly object CacheGate = new();
    const int ProcessRescanMs = 1800;
    const int WindowRescanMs = 900;

    static int _cachedPid;
    static long _lastProcessScanTick;
    static uint _cachedWindowPid;
    static IntPtr _cachedWindow;
    static long _lastWindowScanTick;

    public static Process? FindRunning()
    {
        var now = Environment.TickCount64;
        lock (CacheGate)
        {
            if (_cachedPid > 0 && now - _lastProcessScanTick < ProcessRescanMs)
            {
                var cached = TryOpenProcess(_cachedPid);
                if (cached != null) return cached;
                _cachedPid = 0;
            }
        }

        Process? found = null;
        foreach (var name in Names)
        {
            try
            {
                var candidates = Process.GetProcessesByName(name);
                try
                {
                    found = candidates
                        .Where(x => !x.HasExited)
                        .OrderByDescending(x => SafeStartTime(x))
                        .FirstOrDefault();
                    if (found != null)
                    {
                        foreach (var p in candidates)
                            if (!ReferenceEquals(p, found)) p.Dispose();
                        break;
                    }
                }
                finally
                {
                    if (found == null)
                        foreach (var p in candidates) p.Dispose();
                }
            }
            catch { }
        }

        lock (CacheGate)
        {
            _cachedPid = found?.Id ?? 0;
            _lastProcessScanTick = now;
            if (_cachedPid == 0)
            {
                _cachedWindowPid = 0;
                _cachedWindow = IntPtr.Zero;
            }
        }
        return found;
    }

    static Process? TryOpenProcess(int pid)
    {
        try
        {
            var p = Process.GetProcessById(pid);
            if (p.HasExited)
            {
                p.Dispose();
                return null;
            }
            return p;
        }
        catch { return null; }
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
            var now = Environment.TickCount64;

            IntPtr cached;
            long lastScan;
            lock (CacheGate)
            {
                cached = _cachedWindowPid == pid ? _cachedWindow : IntPtr.Zero;
                lastScan = _lastWindowScanTick;
            }

            if (cached != IntPtr.Zero && now - lastScan < WindowRescanMs && TryReadWindow(cached, pid, out bounds, out minimized))
                return true;

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

            lock (CacheGate)
            {
                _cachedWindowPid = pid;
                _cachedWindow = best;
                _lastWindowScanTick = now;
            }

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

    static bool TryReadWindow(IntPtr hwnd, uint pid, out Rectangle bounds, out bool minimized)
    {
        bounds = Rectangle.Empty;
        minimized = false;
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd)) return false;
        GetWindowThreadProcessId(hwnd, out var windowPid);
        if (windowPid != pid) return false;
        minimized = IsIconic(hwnd);
        if (minimized) return true;
        if (!GetWindowRect(hwnd, out var rect)) return false;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        if (width < 160 || height < 90) return false;
        bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
        return true;
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
