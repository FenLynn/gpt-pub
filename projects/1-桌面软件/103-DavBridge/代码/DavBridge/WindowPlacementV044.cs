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
            var bounds = new Rectangle(state.X, state.Y, state.Width, state.Height);
            var visible = Screen.AllScreens.Any(screen =>
            {
                var intersection = Rectangle.Intersect(screen.WorkingArea, bounds);
                return intersection.Width >= 160 && intersection.Height >= 120;
            });
            if (!visible) return;
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
