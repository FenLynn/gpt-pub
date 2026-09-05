using System.Drawing.Imaging;
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
        Bind("_coverageText", "_coverageMeter", ContentAlignment.MiddleCenter, 0.44F, suppressPulse: false, sampleText: "1,526 / 6,933 已核准", sampleFraction: 0.22);
        Bind("_currentText", "_currentMeter", ContentAlignment.MiddleLeft, 0.44F, suppressPulse: true, sampleText: "等待坚果云下一额度周期", sampleFraction: 0.00);
        Bind("_uploadText", "_uploadMeter", ContentAlignment.MiddleCenter, 0.48F, suppressPulse: false, sampleText: "946.6 MB / 1.00 GB", sampleFraction: 0.9466);
        Bind("_downloadText", "_downloadMeter", ContentAlignment.MiddleCenter, 0.48F, suppressPulse: false, sampleText: "2.09 GB / 3.00 GB", sampleFraction: 0.6967);
    }

    public static UiOverviewMeterTextV037 Attach(UiShellV032 shell) => new(shell);

    private void Bind(string labelField, string meterField, ContentAlignment alignment, float heightRatio, bool suppressPulse, string sampleText, double sampleFraction)
    {
        var label = Field<Label>(labelField);
        var meter = Field<MeterV030>(meterField);
        if (label.Parent is not TableLayoutPanel table || !ReferenceEquals(meter.Parent, table))
            throw new InvalidOperationException($"meter text expected {labelField} and {meterField} in the same TableLayoutPanel");

        var labelCell = table.GetCellPosition(label);
        var meterCell = table.GetCellPosition(meter);
        if (labelCell.Column != meterCell.Column || labelCell.Row < 0 || meterCell.Row != labelCell.Row + 1)
            throw new InvalidOperationException($"meter text found unexpected source layout for {labelField}/{meterField}");

        var binding = new Binding(label, meter, table, labelCell, meterCell, sampleText, sampleFraction);
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

            ValidateMeterPixels(binding.Meter, binding.SampleText, scenario);
        }

        ValidateFixedHeightQuotaMeter("upload-16", _bindings[2], 16, scenario);
        ValidateFixedHeightQuotaMeter("upload-27", _bindings[2], 27, scenario);
        ValidateFixedHeightQuotaMeter("download-16", _bindings[3], 16, scenario);
        ValidateFixedHeightQuotaMeter("download-27", _bindings[3], 27, scenario);
    }

    private static void ValidateMeterPixels(MeterV030 meter, string sampleText, string scenario)
    {
        var previousProvider = meter.DisplayTextProvider;
        var previousFraction = meter.Fraction;
        var previousPulse = meter.Pulse;
        try
        {
            meter.DisplayTextProvider = () => sampleText;
            meter.Fraction = 0;
            meter.Pulse = false;
            using var bitmap = new Bitmap(Math.Max(1, meter.Width), Math.Max(1, meter.Height));
            meter.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
            ValidateInk(bitmap, sampleText, scenario);
        }
        finally
        {
            meter.DisplayTextProvider = previousProvider;
            meter.Fraction = previousFraction;
            meter.Pulse = previousPulse;
        }
    }

    private static void ValidateFixedHeightQuotaMeter(string name, Binding source, int height, string scenario)
    {
        using var meter = CreateReferenceMeter(source, height);
        using var bitmap = new Bitmap(meter.Width, meter.Height, PixelFormat.Format32bppArgb);
        meter.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
        ValidateInk(bitmap, name, scenario);
    }

    private static void ValidateInk(Bitmap bitmap, string label, string scenario)
    {
        var ink = FindDarkInk(bitmap);
        if (ink.IsEmpty)
            throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: no rendered text pixels for {label}");
        if (ink.Top < 1 || ink.Bottom >= bitmap.Height - 1)
            throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: rendered text touches meter edge ({ink.Top}..{ink.Bottom} of {bitmap.Height}) for {label}");
        var inkCenter = (ink.Top + ink.Bottom - 1) / 2d;
        var meterCenter = (bitmap.Height - 1) / 2d;
        if (Math.Abs(inkCenter - meterCenter) > 1.0)
            throw new InvalidOperationException($"UI meter-text self-test failed [{scenario}]: visible glyph pixels are not vertically centered (ink={inkCenter:0.0}, meter={meterCenter:0.0}) for {label}");
    }

    internal void CaptureSampleSnapshot(Form form, string outputPath)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        form.PerformLayout();
        var states = _bindings.Select(binding => new SnapshotState(binding, binding.Meter.DisplayTextProvider, binding.Meter.Fraction, binding.Meter.Pulse)).ToArray();
        try
        {
            var meterWidth = Math.Max(420, _bindings.Max(binding => binding.Meter.Width));
            const int left = 24;
            const int top = 24;
            const int labelHeight = 22;
            const int gap = 18;
            var fixedCases = new (string Name, Binding Binding, int Height)[]
            {
                ("upload fixed 16px", _bindings[2], 16),
                ("upload fixed 27px", _bindings[2], 27),
                ("download fixed 16px", _bindings[3], 16),
                ("download fixed 27px", _bindings[3], 27)
            };
            var attachedHeight = _bindings.Sum(binding => labelHeight + binding.Meter.Height + gap);
            var fixedHeight = fixedCases.Sum(item => labelHeight + item.Height + gap);
            var sheetHeight = top * 2 + attachedHeight + fixedHeight;
            using var sheet = new Bitmap(meterWidth + left * 2, sheetHeight, PixelFormat.Format32bppArgb);
            using var graphics = Graphics.FromImage(sheet);
            graphics.Clear(Color.White);
            using var captionFont = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            using var captionBrush = new SolidBrush(Color.FromArgb(70, 82, 91));

            var y = top;
            for (var index = 0; index < states.Length; index++)
            {
                var state = states[index];
                var binding = state.Binding;
                binding.Meter.DisplayTextProvider = () => binding.SampleText;
                binding.Meter.Fraction = binding.SampleFraction;
                binding.Meter.Pulse = false;
                binding.Meter.Invalidate();

                var name = index switch { 0 => "coverage attached", 1 => "current attached", 2 => "upload attached", _ => "download attached" };
                DrawMeterRow(graphics, captionFont, captionBrush, name, binding.Meter, left, ref y, labelHeight, gap);
            }

            foreach (var item in fixedCases)
            {
                using var meter = CreateReferenceMeter(item.Binding, item.Height);
                DrawMeterRow(graphics, captionFont, captionBrush, item.Name, meter, left, ref y, labelHeight, gap);
            }

            sheet.Save(outputPath, ImageFormat.Png);
        }
        finally
        {
            foreach (var state in states)
            {
                state.Binding.Meter.DisplayTextProvider = state.Provider;
                state.Binding.Meter.Fraction = state.Fraction;
                state.Binding.Meter.Pulse = state.Pulse;
                state.Binding.Meter.Invalidate();
            }
        }
    }

    private static MeterV030 CreateReferenceMeter(Binding binding, int height)
    {
        var meter = new MeterV030
        {
            Width = 420,
            Height = height,
            Fraction = binding.SampleFraction,
            Pulse = false,
            DisplayTextProvider = () => binding.SampleText,
            DisplayTextAlignment = binding.Meter.DisplayTextAlignment,
            DisplayTextHeightRatio = binding.Meter.DisplayTextHeightRatio,
            DisplayTextColor = binding.Meter.DisplayTextColor,
            SuppressPulseWhenText = binding.Meter.SuppressPulseWhenText
        };
        meter.SetQuotaColors(binding.SampleFraction);
        _ = meter.Handle;
        return meter;
    }

    private static void DrawMeterRow(Graphics graphics, Font captionFont, Brush captionBrush, string name, MeterV030 meter, int left, ref int y, int labelHeight, int gap)
    {
        graphics.DrawString($"{name}   {meter.Width}×{meter.Height}px", captionFont, captionBrush, left, y);
        y += labelHeight;
        using var meterBitmap = new Bitmap(Math.Max(1, meter.Width), Math.Max(1, meter.Height), PixelFormat.Format32bppArgb);
        meter.DrawToBitmap(meterBitmap, new Rectangle(Point.Empty, meterBitmap.Size));
        graphics.DrawImageUnscaled(meterBitmap, left, y);
        y += meter.Height + gap;
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
        string SampleText,
        double SampleFraction);

    private sealed record SnapshotState(Binding Binding, Func<string>? Provider, double Fraction, bool Pulse);
}
