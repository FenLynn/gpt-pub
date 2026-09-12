using System.Text.Json;

namespace DavBridge;

internal static class WindowPlacementV044
{
    private const int CurrentSchemaVersion = 2;
    private const int DefaultOuterWidth = 1100;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DavBridge",
        "window.json");

    public static void ApplyDefaultFourThree(Form form)
    {
        form.Width = DefaultOuterWidth;
        form.Height = FourThreeOuterHeight(form, DefaultOuterWidth);
    }

    public static void Restore(Form form)
    {
        try
        {
            if (!File.Exists(FilePath)) return;
            var state = JsonSerializer.Deserialize<PlacementState>(File.ReadAllText(FilePath), JsonOptions);
            if (state is null || state.Width < form.MinimumSize.Width || state.Height < form.MinimumSize.Height) return;

            var requested = new Rectangle(state.X, state.Y, state.Width, state.Height);
            var screen = BestScreen(requested);
            if (screen is null) return;

            var migrated = state.SchemaVersion < CurrentSchemaVersion && !state.Maximized;
            var target = migrated
                ? LegacyFourThreeBounds(form, requested, screen.WorkingArea)
                : ClampToWorkingArea(requested, screen.WorkingArea);

            if (target.Width < form.MinimumSize.Width || target.Height < form.MinimumSize.Height) return;
            var intersection = Rectangle.Intersect(screen.WorkingArea, target);
            if (intersection.Width < 160 || intersection.Height < 120) return;

            form.StartPosition = FormStartPosition.Manual;
            form.Bounds = target;
            if (state.Maximized) form.WindowState = FormWindowState.Maximized;

            if (state.SchemaVersion < CurrentSchemaVersion)
            {
                var persisted = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
                WriteState(new PlacementState
                {
                    SchemaVersion = CurrentSchemaVersion,
                    X = persisted.X,
                    Y = persisted.Y,
                    Width = persisted.Width,
                    Height = persisted.Height,
                    Maximized = state.Maximized
                });
            }
        }
        catch { }
    }

    public static void Save(Form form)
    {
        try
        {
            var bounds = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
            if (bounds.Width < form.MinimumSize.Width || bounds.Height < form.MinimumSize.Height) return;
            WriteState(new PlacementState
            {
                SchemaVersion = CurrentSchemaVersion,
                X = bounds.X,
                Y = bounds.Y,
                Width = bounds.Width,
                Height = bounds.Height,
                Maximized = form.WindowState == FormWindowState.Maximized
            });
        }
        catch { }
    }

    internal static bool ValidateFourThreeForSelfTest(Form form)
    {
        var original = form.Bounds;
        try
        {
            ApplyDefaultFourThree(form);
            var ratio = form.ClientSize.Height <= 0 ? 0 : (double)form.ClientSize.Width / form.ClientSize.Height;
            if (Math.Abs(ratio - 4d / 3d) > 0.015) return false;

            var legacy = new Rectangle(120, 90, 1100, 620);
            var working = new Rectangle(0, 0, 1920, 1040);
            var migrated = LegacyFourThreeBounds(form, legacy, working);
            var nonClientWidth = Math.Max(0, form.Width - form.ClientSize.Width);
            var nonClientHeight = Math.Max(0, form.Height - form.ClientSize.Height);
            var clientWidth = Math.Max(1, migrated.Width - nonClientWidth);
            var clientHeight = Math.Max(1, migrated.Height - nonClientHeight);
            var migratedRatio = (double)clientWidth / clientHeight;
            return migrated.Width == legacy.Width &&
                   migrated.Height > legacy.Height &&
                   Math.Abs(migratedRatio - 4d / 3d) <= 0.015;
        }
        finally
        {
            form.Bounds = original;
        }
    }

    private static Rectangle LegacyFourThreeBounds(Form form, Rectangle saved, Rectangle working)
    {
        var targetWidth = Math.Max(form.MinimumSize.Width, saved.Width);
        var targetHeight = FourThreeOuterHeight(form, targetWidth);

        if (targetWidth > working.Width || targetHeight > working.Height)
        {
            var nonClientWidth = Math.Max(0, form.Width - form.ClientSize.Width);
            var nonClientHeight = Math.Max(0, form.Height - form.ClientSize.Height);
            var maxClientWidth = Math.Max(1, working.Width - nonClientWidth);
            var maxClientHeight = Math.Max(1, working.Height - nonClientHeight);
            var clientWidth = Math.Min(maxClientWidth, (int)Math.Floor(maxClientHeight * 4d / 3d));
            targetWidth = Math.Max(form.MinimumSize.Width, clientWidth + nonClientWidth);
            targetHeight = FourThreeOuterHeight(form, targetWidth);
            if (targetHeight > working.Height)
                targetHeight = working.Height;
        }

        var centerX = saved.Left + saved.Width / 2;
        var centerY = saved.Top + saved.Height / 2;
        var x = centerX - targetWidth / 2;
        var y = centerY - targetHeight / 2;
        return ClampToWorkingArea(new Rectangle(x, y, targetWidth, targetHeight), working);
    }

    private static int FourThreeOuterHeight(Form form, int outerWidth)
    {
        var nonClientWidth = Math.Max(0, form.Width - form.ClientSize.Width);
        var nonClientHeight = Math.Max(0, form.Height - form.ClientSize.Height);
        var clientWidth = Math.Max(1, outerWidth - nonClientWidth);
        var clientHeight = (int)Math.Round(clientWidth * 3d / 4d);
        return Math.Max(form.MinimumSize.Height, clientHeight + nonClientHeight);
    }

    private static Screen? BestScreen(Rectangle requested) =>
        Screen.AllScreens
            .OrderByDescending(candidate =>
            {
                var intersection = Rectangle.Intersect(candidate.WorkingArea, requested);
                return intersection.Width * intersection.Height;
            })
            .FirstOrDefault();

    private static Rectangle ClampToWorkingArea(Rectangle requested, Rectangle working)
    {
        var width = Math.Min(requested.Width, working.Width);
        var height = Math.Min(requested.Height, working.Height);
        var x = Math.Clamp(requested.X, working.Left, Math.Max(working.Left, working.Right - width));
        var y = Math.Clamp(requested.Y, working.Top, Math.Max(working.Top, working.Bottom - height));
        return new Rectangle(x, y, width, height);
    }

    private static void WriteState(PlacementState state)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(state, JsonOptions));
    }

    private sealed class PlacementState
    {
        public int SchemaVersion { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public bool Maximized { get; set; }
    }
}
