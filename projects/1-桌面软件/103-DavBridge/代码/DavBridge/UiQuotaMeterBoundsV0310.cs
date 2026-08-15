using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.3.10 quota-meter bounds repair.
///
/// UiShellV032 intentionally gives the quota meter row 16 logical pixels, but a Dock=Fill
/// Meter can absorb unused TableLayoutPanel height and become much taller than that row.
/// Its text is then centered inside the oversized control while the outer overview row clips
/// the lower portion, which makes the quota text appear to sit on or below the visible bar.
///
/// Keep the existing row geometry unchanged. Only make the two quota Meter controls obey the
/// 16-pixel logical height that BuildQuotaCell already declares. Dock=Top preserves horizontal
/// fill while allowing WinForms/DPI scaling to scale the 16 logical pixels normally.
/// </summary>
internal sealed class UiQuotaMeterBoundsV0310 : IDisposable
{
    private const int LogicalQuotaMeterHeight = 16;

    private readonly MeterV030 _upload;
    private readonly MeterV030 _download;

    private UiQuotaMeterBoundsV0310(UiShellV032 shell)
    {
        _upload = Field<MeterV030>(shell, "_uploadMeter");
        _download = Field<MeterV030>(shell, "_downloadMeter");
        Constrain(_upload);
        Constrain(_download);
    }

    internal static UiQuotaMeterBoundsV0310 Attach(UiShellV032 shell) => new(shell);

    private static T Field<T>(UiShellV032 shell, string name) where T : class
    {
        var value = typeof(UiShellV032).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(shell);
        return value as T ?? throw new InvalidOperationException($"quota meter bounds could not resolve UiShellV032.{name}");
    }

    private static void Constrain(MeterV030 meter)
    {
        meter.Dock = DockStyle.Top;
        meter.Height = LogicalQuotaMeterHeight;
        meter.Invalidate();
    }

    internal void Validate(string scenario)
    {
        ValidateOne(_upload, "upload", scenario);
        ValidateOne(_download, "download", scenario);
    }

    private static void ValidateOne(MeterV030 meter, string name, string scenario)
    {
        if (meter.Dock != DockStyle.Top)
            throw new InvalidOperationException($"UI quota-meter self-test failed [{scenario}]: {name} meter is not Dock=Top");

        var scale = scenario.EndsWith("-125", StringComparison.OrdinalIgnoreCase)
            ? 1.25
            : scenario.EndsWith("-150", StringComparison.OrdinalIgnoreCase)
                ? 1.50
                : 1.00;
        var expected = (int)Math.Round(LogicalQuotaMeterHeight * scale);
        if (Math.Abs(meter.Height - expected) > 2)
            throw new InvalidOperationException(
                $"UI quota-meter self-test failed [{scenario}]: {name} meter height {meter.Height}px, expected about {expected}px from the 16px logical quota row");
    }

    public void Dispose()
    {
        // Presentation lifetime is owned by the shell/form. No runtime state is persisted here.
    }
}
