using DavBridge.Core;

namespace DavBridge;

internal sealed class CalibrationDialog : Form
{
    private readonly NumericUpDown _upload = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 1000, Increment = 1 };
    private readonly NumericUpDown _download = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 3000, Increment = 1 };
    private readonly DateTimePicker _reset = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "yyyy-MM-dd", Width = 180 };

    public long UploadUsedBytes => (long)(_upload.Value * 1_000_000m);
    public long DownloadUsedBytes => (long)(_download.Value * 1_000_000m);
    public DateTimeOffset NextResetAt
    {
        get
        {
            var localDate = DateTime.SpecifyKind(_reset.Value.Date, DateTimeKind.Local);
            return new DateTimeOffset(localDate);
        }
    }

    public CalibrationDialog(DavBridgeConfig config)
    {
        Text = "校准坚果云流量";
        Width = 430;
        Height = 250;
        StartPosition = FormStartPosition.CenterParent;
        Font = new Font("Segoe UI", 9F);

        _upload.Value = Math.Clamp((decimal)config.CalibrationUploadUsedBytes / 1_000_000m, _upload.Minimum, _upload.Maximum);
        _download.Value = Math.Clamp((decimal)config.CalibrationDownloadUsedBytes / 1_000_000m, _download.Minimum, _download.Maximum);
        _reset.Value = config.NextResetAt == default
            ? DateTime.Now.AddMonths(1).Date
            : ResetSchedulePolicy.NormalizeResetDate(config.NextResetAt).LocalDateTime.Date;

        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(18) };
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddField(panel, "官方上传已用 MB", _upload);
        AddField(panel, "官方下载已用 MB", _download);
        AddField(panel, "下次流量重置日期", _reset);

        var note = new Label
        {
            Text = "坚果云账户页只提供重置日期。DavBridge 不自行猜测具体时刻，重置日当地时间 09:00 后才开始真实上传探测。",
            AutoSize = true,
            MaximumSize = new Size(220, 0),
            ForeColor = Color.DimGray,
            Margin = new Padding(0, 8, 0, 8)
        };
        panel.Controls.Add(note, 1, panel.RowCount++);

        var save = new Button { Text = "校准", DialogResult = DialogResult.OK, AutoSize = true };
        panel.Controls.Add(save, 1, panel.RowCount++);
        Controls.Add(panel);
        AcceptButton = save;
    }

    private static void AddField(TableLayoutPanel panel, string label, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 8, 7) }, 0, row);
        panel.Controls.Add(control, 1, row);
    }
}
