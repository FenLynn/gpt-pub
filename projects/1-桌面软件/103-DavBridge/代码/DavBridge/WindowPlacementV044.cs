using System.Text.Json;

namespace DavBridge;

internal static class WindowPlacementV044
{
    private const int CurrentSchemaVersion = 2;
    private const int DefaultWidth = 1100;
    private const int DefaultHeight = 825;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };
    private static string FilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DavBridge",
        "window.json");

    public static void ApplyDefaultFourThree(Form form)
    {
        form.Size = new Size(DefaultWidth, DefaultHeight);
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
                ? LegacyFourThreeBounds(requested, screen.WorkingArea, form.MinimumSize)
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

    internal static WindowPlacementSelfTestV048 ValidateFourThreeForSelfTest(Form form)
    {
        ApplyDefaultFourThree(form);
        var defaultWidth = form.Width;
        var defaultHeight = form.Height;
        var targetRatioOk =
            DefaultWidth == 1100 &&
            DefaultHeight == 825 &&
            Math.Abs((double)DefaultWidth / DefaultHeight - 4d / 3d) < 0.0001;
        var actualRatio = defaultHeight <= 0 ? 0 : (double)defaultWidth / defaultHeight;
        var defaultRatioOk =
            targetRatioOk &&
            defaultWidth <= DefaultWidth &&
            defaultHeight <= DefaultHeight &&
            defaultWidth >= form.MinimumSize.Width &&
            defaultHeight >= form.MinimumSize.Height &&
            Math.Abs(actualRatio - 4d / 3d) <= 0.02;

        var legacy = new Rectangle(120, 90, 1100, 620);
        var working = new Rectangle(0, 0, 1920, 1040);
        var migrated = LegacyFourThreeBounds(legacy, working, form.MinimumSize);
        var migratedRatioOk =
            migrated.Width == 1100 &&
            migrated.Height == 825 &&
            Math.Abs((double)migrated.Width / migrated.Height - 4d / 3d) < 0.0001;

        var customLegacy = new Rectangle(200, 120, 1000, 610);
        var customMigrated = LegacyFourThreeBounds(customLegacy, working, form.MinimumSize);
        var customRatioOk =
            customMigrated.Width == 1000 &&
            customMigrated.Height == 750 &&
            Math.Abs((double)customMigrated.Width / customMigrated.Height - 4d / 3d) < 0.0001;

        return new WindowPlacementSelfTestV048(
            defaultRatioOk && migratedRatioOk && customRatioOk,
            defaultWidth,
            defaultHeight,
            migrated.Width,
            migrated.Height,
            customMigrated.Width,
            customMigrated.Height,
            form.MinimumSize.Width,
            form.MinimumSize.Height);
    }

    private static Rectangle LegacyFourThreeBounds(Rectangle saved, Rectangle working, Size minimum)
    {
        var targetWidth = Math.Max(minimum.Width, saved.Width);
        var targetHeight = (int)Math.Round(targetWidth * 3d / 4d);

        if (targetWidth > working.Width || targetHeight > working.Height)
        {
            var scale = Math.Min(
                (double)working.Width / targetWidth,
                (double)working.Height / targetHeight);
            targetWidth = Math.Max(minimum.Width, (int)Math.Floor(targetWidth * scale));
            targetHeight = (int)Math.Round(targetWidth * 3d / 4d);
        }

        if (targetHeight < minimum.Height)
        {
            targetHeight = minimum.Height;
            targetWidth = Math.Max(minimum.Width, (int)Math.Round(targetHeight * 4d / 3d));
        }

        if (targetWidth > working.Width || targetHeight > working.Height)
            return ClampToWorkingArea(saved, working);

        var centerX = saved.Left + saved.Width / 2;
        var centerY = saved.Top + saved.Height / 2;
        var x = centerX - targetWidth / 2;
        var y = centerY - targetHeight / 2;
        return ClampToWorkingArea(new Rectangle(x, y, targetWidth, targetHeight), working);
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


internal sealed record WindowPlacementSelfTestV048(
    bool Ok,
    int DefaultWidth,
    int DefaultHeight,
    int LegacyWidth,
    int LegacyHeight,
    int CustomWidth,
    int CustomHeight,
    int MinimumWidth,
    int MinimumHeight);
