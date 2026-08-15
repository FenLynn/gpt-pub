using System.Reflection;

namespace DavBridge;

/// <summary>
/// Overview meter-text binding. The page geometry stays on the v0.3.4/v0.3.2 shell baseline.
/// Existing value labels remain in their original TableLayoutPanel cells but are hidden;
/// MeterV030 paints their current text itself. No control is reparented, no RowStyle is changed,
/// and no replacement/overlay meter exists.
/// </summary>
internal sealed class UiOverviewMeterTextV037 : IDisposable
{
    private readonly UiShellV032 _shell;
    private readonly List<Binding> _bindings = new();
    private bool _disposed;

    private UiOverviewMeterTextV037(UiShellV032 shell)
    {
        _shell = shell;
        Bind("_coverageText", "_coverageMeter", ContentAlignment.MiddleCenter, 0.44F, suppressPulse: false, sampleText: "1,526 / 6,933 已核准");
        Bind("_currentText", "_currentMeter", ContentAlignment.MiddleLeft, 0.44F, suppressPulse: true, sampleText: "等待坚果云下一额度周期");
        Bind("_uploadText", "_uploadMeter", ContentAlignment.MiddleCenter, 0.48F, suppressPulse: false, sampleText: "946.6 MB / 1.00 GB");
        Bind("_downloadText", "_downloadMeter", ContentAlignment.MiddleCenter, 0.48F, suppressPulse: false, sampleText: "2.09 GB / 3.00 GB");
    }

    public static UiOverviewMeterTextV037 Attach(UiShellV032 shell) => new(shell);

    private void Bind(string labelField, string meterField, ContentAlignment alignment, float heightRatio, bool suppressPulse, string sampleText)
    {
        var label = Field<Label>(labelField);
        var meter = Field<MeterV030>(meterField);
        if (label.Parent is not TableLayoutPanel table || !ReferenceEquals(meter.Parent, table))
            throw new InvalidOperationException($"meter text expected {labelField} and {meterField} in the same TableLayoutPanel");

        var labelCell = table.GetCellPosition(label);
        var meterCell = table.GetCellPosition(meter);
        if (labelCell.Column != meterCell.Column || labelCell.Row < 0 || meterCell.Row != labelCell.Row + 1)
            throw new InvalidOperationException($"meter text found unexpected source layout for {labelField}/{meterField}");

        var binding = new Binding(label, meter, table, labelCell, meterCell, sampleText);
        _bindings.Add(binding);

        label.Visible = false;
        meter.DisplayTextProvider = () => label.Text;
        meter.DisplayTextAlignment = alignment;
        meter.DisplayTextHeightRatio = heightRatio;
        meter.DisplayTextColor = Color.FromArgb(42, 54, 62);
        meter.SuppressPulseWhenText = suppressPulse;
        meter.Invalidate();
    }

    private T Field<T>(string name) where T : class
    {
        var value = typeof(UiShellV032).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_shell);
        return value as T ?? throw new InvalidOperationException($"meter text could not resolve UiShellV032.{name}");
    }

    internal void ValidateLayout(string scenario)
    {
        if (_bindings.Count != 4)
            throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: expected four bindings, got {_bindings.Count}");

        foreach (var binding in _bindings)
        {
            if (!ReferenceEquals(binding.Label.Parent, binding.Table) || !ReferenceEquals(binding.Meter.Parent, binding.Table))
                throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: control parent changed");
            if (binding.Table.GetCellPosition(binding.Label) != binding.LabelCell || binding.Table.GetCellPosition(binding.Meter) != binding.MeterCell)
                throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: table cell changed");
            if (binding.Meter.Controls.Count != 0)
                throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: meter unexpectedly owns child controls");
            if (binding.Meter.DisplayTextProvider is null)
                throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: native text provider missing");
            if (binding.Meter.Width < 100 || binding.Meter.Height < 12)
                throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: meter clipped ({binding.Meter.Width}x{binding.Meter.Height})");

            var previousProvider = binding.Meter.DisplayTextProvider;
            var previousFraction = binding.Meter.Fraction;
            var previousPulse = binding.Meter.Pulse;
            try
            {
                binding.Meter.DisplayTextProvider = () => binding.SampleText;
                binding.Meter.Fraction = 0;
                binding.Meter.Pulse = false;
                using var bitmap = new Bitmap(Math.Max(1, binding.Meter.Width), Math.Max(1, binding.Meter.Height));
                binding.Meter.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                var ink = FindDarkInk(bitmap);
                if (ink.IsEmpty)
                    throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: no rendered text pixels for {binding.SampleText}");
                if (ink.Top < 1 || ink.Bottom >= bitmap.Height - 1)
                    throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: rendered text touches meter edge ({ink.Top}..{ink.Bottom} of {bitmap.Height})");
                var inkCenter = (ink.Top + ink.Bottom) / 2d;
                var meterCenter = (bitmap.Height - 1) / 2d;
                if (Math.Abs(inkCenter - meterCenter) > 2.0)
                    throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: rendered text is not vertically centered (ink={inkCenter:0.0}, meter={meterCenter:0.0})");
            }
            finally
            {
                binding.Meter.DisplayTextProvider = previousProvider;
                binding.Meter.Fraction = previousFraction;
                binding.Meter.Pulse = previousPulse;
            }
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
        if (_disposed) return;
        _disposed = true;
        foreach (var binding in _bindings)
        {
            binding.Meter.DisplayTextProvider = null;
            binding.Meter.SuppressPulseWhenText = false;
        }
    }

    private sealed record Binding(
        Label Label,
        MeterV030 Meter,
        TableLayoutPanel Table,
        TableLayoutPanelCellPosition LabelCell,
        TableLayoutPanelCellPosition MeterCell,
        string SampleText);
}
