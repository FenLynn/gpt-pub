using System.Text.Json;

namespace DavBridge;

internal static class WindowPlacementV044
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DavBridge",
        "window.json");

    public static void Restore(Form form)
    {
        try
        {
            if (!File.Exists(FilePath)) return;
            var state = JsonSerializer.Deserialize<PlacementState>(File.ReadAllText(FilePath));
            if (state is null || state.Width < form.MinimumSize.Width || state.Height < form.MinimumSize.Height) return;

            var width = state.Width;
            var height = state.Height;
            var x = state.X;
            var y = state.Y;
            var migrateLegacyDefault = !state.Maximized && state.Width == 1100 && state.Height == 620;
            if (migrateLegacyDefault)
            {
                height = 825;
                y -= (825 - 620) / 2;
            }

            var requested = new Rectangle(x, y, width, height);
            var screen = Screen.AllScreens
                .OrderByDescending(candidate => Rectangle.Intersect(candidate.WorkingArea, requested).Width * Rectangle.Intersect(candidate.WorkingArea, requested).Height)
                .FirstOrDefault();
            if (screen is null) return;

            var working = screen.WorkingArea;
            width = Math.Min(width, working.Width);
            height = Math.Min(height, working.Height);
            x = Math.Clamp(x, working.Left, Math.Max(working.Left, working.Right - width));
            y = Math.Clamp(y, working.Top, Math.Max(working.Top, working.Bottom - height));
            var bounds = new Rectangle(x, y, width, height);
            var intersection = Rectangle.Intersect(working, bounds);
            if (intersection.Width < 160 || intersection.Height < 120) return;

            form.StartPosition = FormStartPosition.Manual;
            form.Bounds = bounds;
            if (state.Maximized) form.WindowState = FormWindowState.Maximized;
        }
        catch { }
    }

    public static void Save(Form form)
    {
        try
        {
            var bounds = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
            if (bounds.Width < form.MinimumSize.Width || bounds.Height < form.MinimumSize.Height) return;
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            var state = new PlacementState(bounds.X, bounds.Y, bounds.Width, bounds.Height, form.WindowState == FormWindowState.Maximized);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(state, JsonOptions));
        }
        catch { }
    }

    private sealed record PlacementState(int X, int Y, int Width, int Height, bool Maximized);
}
