using System.Reflection;

namespace DavBridge;

/// <summary>
/// v0.3.5 overview-only density adjustment.
/// Reuses the existing value labels as children of the existing MeterV030 controls.
/// No replacement/overlay meter is created and no migration/reconciliation state is owned here.
/// </summary>
internal sealed class UiOverviewInlineTextV035 : IDisposable
{
    private readonly UiShellV032 _shell;
    private readonly List<Binding> _bindings = new();
    private bool _disposed;

    private UiOverviewInlineTextV035(UiShellV032 shell)
    {
        _shell = shell;

        // Keep the v0.3.4 shell structure. Only the local two rows that previously held
        // value + meter are rebalanced, with the original label moved inside the original meter.
        Bind("_coverageText", "_coverageMeter", ContentAlignment.MiddleCenter, spacerHeight: 20, meterHeight: 36);
        Bind("_currentText", "_currentMeter", ContentAlignment.MiddleLeft, spacerHeight: 20, meterHeight: 36);
        Bind("_uploadText", "_uploadMeter", ContentAlignment.MiddleCenter, spacerHeight: 14, meterHeight: 24);
        Bind("_downloadText", "_downloadMeter", ContentAlignment.MiddleCenter, spacerHeight: 14, meterHeight: 24);
    }

    public static UiOverviewInlineTextV035 Attach(UiShellV032 shell) => new(shell);

    private void Bind(string labelField, string meterField, ContentAlignment alignment, int spacerHeight, int meterHeight)
    {
        var label = Field<Label>(labelField);
        var meter = Field<MeterV030>(meterField);

        if (label.Parent is not TableLayoutPanel table || !ReferenceEquals(meter.Parent, table))
            throw new InvalidOperationException($"v0.3.5 inline text expected {labelField} and {meterField} in the same TableLayoutPanel");

        var labelCell = table.GetCellPosition(label);
        var meterCell = table.GetCellPosition(meter);
        if (labelCell.Column != meterCell.Column || labelCell.Row < 0 || meterCell.Row != labelCell.Row + 1)
            throw new InvalidOperationException($"v0.3.5 inline text found an unexpected layout for {labelField}/{meterField}");
        if (labelCell.Row >= table.RowStyles.Count || meterCell.Row >= table.RowStyles.Count)
            throw new InvalidOperationException($"v0.3.5 inline text row styles missing for {labelField}/{meterField}");
        if (table.RowStyles[labelCell.Row].SizeType != SizeType.Absolute || table.RowStyles[meterCell.Row].SizeType != SizeType.Absolute)
            throw new InvalidOperationException($"v0.3.5 inline text requires fixed local rows for {labelField}/{meterField}");

        var oldTotal = table.RowStyles[labelCell.Row].Height + table.RowStyles[meterCell.Row].Height;
        if (Math.Abs(oldTotal - (spacerHeight + meterHeight)) > 0.5F)
            throw new InvalidOperationException($"v0.3.5 inline text refuses to alter changed row geometry for {labelField}/{meterField}: {oldTotal:0.#}");

        table.SuspendLayout();
        try
        {
            table.Controls.Remove(label);
            table.RowStyles[labelCell.Row] = new RowStyle(SizeType.Absolute, spacerHeight);
            table.RowStyles[meterCell.Row] = new RowStyle(SizeType.Absolute, meterHeight);

            label.AutoSize = false;
            label.Dock = DockStyle.Fill;
            label.Margin = Padding.Empty;
            label.Padding = alignment == ContentAlignment.MiddleLeft ? new Padding(9, 0, 9, 0) : new Padding(6, 0, 6, 0);
            label.TextAlign = alignment;
            label.AutoEllipsis = true;
            label.BackColor = Color.Transparent;
            label.ForeColor = Color.FromArgb(44, 58, 67);
            label.Font = new Font("Segoe UI Semibold", 8.5F);

            meter.Controls.Add(label);
            label.BringToFront();
        }
        finally
        {
            table.ResumeLayout(performLayout: true);
        }

        _bindings.Add(new Binding(label, meter, table, labelCell.Row, meterCell.Row));
    }

    private T Field<T>(string name) where T : class
    {
        var value = typeof(UiShellV032).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_shell);
        return value as T ?? throw new InvalidOperationException($"v0.3.5 inline text could not resolve UiShellV032.{name}");
    }

    internal void ValidateLayout(string scenario)
    {
        if (_bindings.Count != 4)
            throw new InvalidOperationException($"UI inline-text self-test failed [{scenario}]: expected four overview bindings, got {_bindings.Count}");

        foreach (var binding in _bindings)
        {
            if (!ReferenceEquals(binding.Label.Parent, binding.Meter))
                throw new InvalidOperationException($"UI inline-text self-test failed [{scenario}]: value label escaped its meter");
            if (binding.Table.RowStyles[binding.LabelRow].SizeType != SizeType.Absolute ||
                binding.Table.RowStyles[binding.MeterRow].SizeType != SizeType.Absolute)
                throw new InvalidOperationException($"UI inline-text self-test failed [{scenario}]: local rows stopped being fixed");

            var spacerHeight = binding.Table.RowStyles[binding.LabelRow].Height;
            var meterHeight = binding.Table.RowStyles[binding.MeterRow].Height;
            if (spacerHeight <= 0 || meterHeight <= 0 || meterHeight <= spacerHeight)
                throw new InvalidOperationException($"UI inline-text self-test failed [{scenario}]: local row balance invalid ({spacerHeight:0.#}/{meterHeight:0.#})");
            if (binding.Meter.Width < 100 || binding.Meter.Height < 20)
                throw new InvalidOperationException($"UI inline-text self-test failed [{scenario}]: meter clipped ({binding.Meter.Width}x{binding.Meter.Height})");
            if (binding.Label.IsDisposed)
                throw new InvalidOperationException($"UI inline-text self-test failed [{scenario}]: embedded value label disposed");

            binding.Meter.PerformLayout();
            if (binding.Label.Width <= 0 || binding.Label.Height <= 0 ||
                binding.Label.Left < 0 || binding.Label.Top < 0 ||
                binding.Label.Right > binding.Meter.ClientSize.Width + 1 ||
                binding.Label.Bottom > binding.Meter.ClientSize.Height + 1)
                throw new InvalidOperationException($"UI inline-text self-test failed [{scenario}]: embedded label clipped");

            using var bitmap = new Bitmap(Math.Max(1, binding.Meter.Width), Math.Max(1, binding.Meter.Height));
            binding.Meter.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        // Labels intentionally remain children of their meters until UiShellV032 is disposed.
        // This avoids a second re-layout on application shutdown.
    }

    private sealed record Binding(
        Label Label,
        MeterV030 Meter,
        TableLayoutPanel Table,
        int LabelRow,
        int MeterRow);
}
