using System.Drawing.Imaging;
using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.3.11 quota-meter readability repair.
///
/// v0.3.10 correctly stopped the quota meter from expanding to roughly 50px, but forcing the
/// meter itself down to the shell's old 16px row also shrank the native meter text to an
/// unreadable size. The shell still reserves a 22px value row even though UiOverviewMeterTextV037
/// hides that label and paints the value inside the meter.
///
/// Reuse that already-reserved vertical space instead of changing the outer overview geometry:
/// heading 22px + hidden value spacer 11px + quota meter 27px = the same 60px internal total.
/// The 27px meter is the size already exercised by the Windows visual fixture and gives the
/// glyph sprite enough vertical room for normal readable text while keeping it centered.
/// </summary>
internal sealed class UiQuotaMeterBoundsV0310 : IDisposable
{
    private const int LogicalHiddenValueHeight = 11;
    private const int LogicalQuotaMeterHeight = 27;

    private readonly MeterV030 _upload;
    private readonly MeterV030 _download;
    private readonly TableLayoutPanel _uploadTable;
    private readonly TableLayoutPanel _downloadTable;

    private UiQuotaMeterBoundsV0310(UiShellV032 shell)
    {
        _upload = Field<MeterV030>(shell, "_uploadMeter");
        _download = Field<MeterV030>(shell, "_downloadMeter");
        _uploadTable = Rebalance(_upload, "upload");
        _downloadTable = Rebalance(_download, "download");
    }

    internal static UiQuotaMeterBoundsV0310 Attach(UiShellV032 shell) => new(shell);

    private static T Field<T>(UiShellV032 shell, string name) where T : class
    {
        var value = typeof(UiShellV032).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(shell);
        return value as T ?? throw new InvalidOperationException($"quota meter bounds could not resolve UiShellV032.{name}");
    }

    private static TableLayoutPanel Rebalance(MeterV030 meter, string name)
    {
        if (meter.Parent is not TableLayoutPanel table)
            throw new InvalidOperationException($"quota meter readability expected {name} meter inside a TableLayoutPanel");

        var position = table.GetCellPosition(meter);
        if (position.Row != 2 || table.RowStyles.Count < 3)
            throw new InvalidOperationException($"quota meter readability found unexpected {name} row geometry");

        table.RowStyles[1].SizeType = SizeType.Absolute;
        table.RowStyles[1].Height = LogicalHiddenValueHeight;
        table.RowStyles[2].SizeType = SizeType.Absolute;
        table.RowStyles[2].Height = LogicalQuotaMeterHeight;

        meter.Dock = DockStyle.Fill;
        meter.Margin = new Padding(meter.Margin.Left, 0, meter.Margin.Right, 0);
        meter.Invalidate();
        table.PerformLayout();
        return table;
    }

    internal void Validate(string scenario)
    {
        var scale = scenario.EndsWith("-125", StringComparison.OrdinalIgnoreCase)
            ? 1.25
            : scenario.EndsWith("-150", StringComparison.OrdinalIgnoreCase)
                ? 1.50
                : 1.00;

        ValidateOne(_upload, _uploadTable, "upload", "946.6 MB / 1.00 GB", scenario, scale);
        ValidateOne(_download, _downloadTable, "download", "2.09 GB / 3.00 GB", scenario, scale);
    }

    private static void ValidateOne(
        MeterV030 meter,
        TableLayoutPanel table,
        string name,
        string sampleText,
        string scenario,
        double scale)
    {
        if (meter.Dock != DockStyle.Fill)
            throw new InvalidOperationException($"UI quota-meter self-test failed [{scenario}]: {name} meter is not Dock=Fill");

        var expected = (int)Math.Round(LogicalQuotaMeterHeight * scale);
        if (Math.Abs(meter.Height - expected) > 2)
            throw new InvalidOperationException(
                $"UI quota-meter self-test failed [{scenario}]: {name} meter height {meter.Height}px, expected about {expected}px from the 27px logical quota row");

        var rowHeights = table.GetRowHeights();
        if (rowHeights.Length < 3 || Math.Abs(rowHeights[2] - expected) > 2)
            throw new InvalidOperationException(
                $"UI quota-meter self-test failed [{scenario}]: {name} table meter row is {string.Join(',', rowHeights)} instead of about {expected}px");

        ValidateReadableGlyphs(meter, sampleText, name, scenario, scale);
    }

    private static void ValidateReadableGlyphs(MeterV030 meter, string sampleText, string name, string scenario, double scale)
    {
        var oldProvider = meter.DisplayTextProvider;
        var oldFraction = meter.Fraction;
        var oldPulse = meter.Pulse;
        try
        {
            meter.DisplayTextProvider = () => sampleText;
            meter.Fraction = 0;
            meter.Pulse = false;
            using var bitmap = new Bitmap(Math.Max(1, meter.Width), Math.Max(1, meter.Height), PixelFormat.Format32bppArgb);
            meter.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
            var ink = FindDarkInk(bitmap);
            if (ink.IsEmpty)
                throw new InvalidOperationException($"UI quota-meter self-test failed [{scenario}]: {name} sample text did not render");

            var minimumReadableInk = Math.Max(8, (int)Math.Round(8 * scale));
            if (ink.Height < minimumReadableInk)
                throw new InvalidOperationException(
                    $"UI quota-meter self-test failed [{scenario}]: {name} visible glyph height {ink.Height}px is below readable minimum {minimumReadableInk}px");

            if (ink.Top < 1 || ink.Bottom >= bitmap.Height - 1)
                throw new InvalidOperationException(
                    $"UI quota-meter self-test failed [{scenario}]: {name} glyph touches meter edge ({ink.Top}..{ink.Bottom} of {bitmap.Height})");

            var inkCenter = (ink.Top + ink.Bottom - 1) / 2d;
            var meterCenter = (bitmap.Height - 1) / 2d;
            if (Math.Abs(inkCenter - meterCenter) > 1.5)
                throw new InvalidOperationException(
                    $"UI quota-meter self-test failed [{scenario}]: {name} glyph center {inkCenter:0.0} differs from meter center {meterCenter:0.0}");
        }
        finally
        {
            meter.DisplayTextProvider = oldProvider;
            meter.Fraction = oldFraction;
            meter.Pulse = oldPulse;
            meter.Invalidate();
        }
    }

    private static Rectangle FindDarkInk(Bitmap bitmap)
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
                if (pixel.R >= 170 || pixel.G >= 170 || pixel.B >= 170) continue;
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

    public void Dispose()
    {
        // Presentation lifetime is owned by the shell/form. No runtime state is persisted here.
    }
}
