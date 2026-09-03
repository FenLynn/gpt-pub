using System.Drawing.Imaging;

namespace DavBridge;

/// <summary>
/// Renders meter text as a cropped glyph sprite. The final vertical position is based on
/// visible glyph pixels rather than the font line box/baseline, so Latin digits and CJK
/// text share the same visual-centering rule.
/// </summary>
internal static class MeterTextSpriteV039
{
    private const int MaxCacheEntries = 96;
    private static readonly object CacheGate = new();
    private static readonly Dictionary<SpriteKey, Bitmap> Cache = new();
    private static readonly Queue<SpriteKey> CacheOrder = new();

    internal static Bitmap? Get(string text, int maxWidth, int maxHeight, float targetPixels, Color color)
    {
        if (string.IsNullOrWhiteSpace(text) || maxWidth <= 0 || maxHeight <= 0) return null;
        var key = new SpriteKey(text, maxWidth, maxHeight, (int)Math.Round(targetPixels * 10F), color.ToArgb());
        lock (CacheGate)
        {
            if (Cache.TryGetValue(key, out var cached)) return cached;
            var rendered = Render(text, maxWidth, maxHeight, targetPixels, color);
            if (rendered is null) return null;
            Cache[key] = rendered;
            CacheOrder.Enqueue(key);
            while (Cache.Count > MaxCacheEntries && CacheOrder.Count > 0)
            {
                var oldest = CacheOrder.Dequeue();
                if (!Cache.Remove(oldest, out var bitmap)) continue;
                bitmap.Dispose();
            }
            return rendered;
        }
    }

    private static Bitmap? Render(string text, int maxWidth, int maxHeight, float targetPixels, Color color)
    {
        var startPixels = Math.Clamp(targetPixels, 6F, Math.Max(6F, maxHeight));
        for (var pixels = startPixels; pixels >= 5F; pixels -= 0.5F)
        {
            using var font = new Font("Segoe UI Semibold", pixels, FontStyle.Regular, GraphicsUnit.Pixel);
            var rawHeight = Math.Max(48, maxHeight * 4);
            using var raw = new Bitmap(Math.Max(1, maxWidth), rawHeight, PixelFormat.Format32bppArgb);
            raw.SetResolution(96F, 96F);
            using (var graphics = Graphics.FromImage(raw))
            {
                graphics.Clear(Color.White);
                var flags = TextFormatFlags.SingleLine |
                            TextFormatFlags.EndEllipsis |
                            TextFormatFlags.NoPadding |
                            TextFormatFlags.NoPrefix |
                            TextFormatFlags.VerticalCenter |
                            TextFormatFlags.Left;
                TextRenderer.DrawText(
                    graphics,
                    text,
                    font,
                    new Rectangle(0, 0, raw.Width, raw.Height),
                    Color.Black,
                    Color.White,
                    flags);
            }

            var ink = FindInk(raw);
            if (ink.IsEmpty) continue;
            if (ink.Width > maxWidth || ink.Height > maxHeight) continue;
            return CropAsAlpha(raw, ink, color);
        }

        return null;
    }

    private static Rectangle FindInk(Bitmap bitmap)
    {
        var minX = bitmap.Width;
        var minY = bitmap.Height;
        var maxX = -1;
        var maxY = -1;
        for (var y = 0; y < bitmap.Height; y++)
        {
            for (var x = 0; x < bitmap.Width; x++)
            {
                var pixel = bitmap.GetPixel(x, y);
                var luminance = (pixel.R + pixel.G + pixel.B) / 3;
                if (luminance >= 248) continue;
                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }

        return maxX < minX || maxY < minY
            ? Rectangle.Empty
            : Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1);
    }

    private static Bitmap CropAsAlpha(Bitmap raw, Rectangle ink, Color color)
    {
        var sprite = new Bitmap(ink.Width, ink.Height, PixelFormat.Format32bppPArgb);
        for (var y = 0; y < ink.Height; y++)
        {
            for (var x = 0; x < ink.Width; x++)
            {
                var source = raw.GetPixel(ink.X + x, ink.Y + y);
                var luminance = (source.R + source.G + source.B) / 3;
                var alpha = Math.Clamp(255 - luminance, 0, 255);
                if (alpha < 8)
                {
                    sprite.SetPixel(x, y, Color.Transparent);
                    continue;
                }
                sprite.SetPixel(x, y, Color.FromArgb(alpha, color.R, color.G, color.B));
            }
        }
        return sprite;
    }

    private readonly record struct SpriteKey(string Text, int Width, int Height, int TargetTenths, int Argb);
}