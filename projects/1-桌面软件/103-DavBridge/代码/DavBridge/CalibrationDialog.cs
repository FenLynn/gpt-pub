using DavBridge.Core;

namespace DavBridge;

internal sealed class CalibrationDialog : Form
{
    private readonly NumericUpDown _upload = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 1000, Increment = 1 };
    private readonly NumericUpDown _download = new() { DecimalPlaces = 1, Minimum = 0, Maximum = 3000, Increment = 1 };
    private readonly DateTimePicker _reset = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "yyyy-MM-dd", Width = 190 };

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
        Width = 520;
        Height = 340;
        MinimumSize = new Size(520, 340);
        MaximumSize = new Size(520, 340);
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        Font = new Font("Segoe UI", 10F);
        BackColor = Color.FromArgb(248, 251, 254);
        Icon = AppBranding.CreateIcon();

        foreach (var control in new NumericUpDown[] { _upload, _download })
        {
            control.BorderStyle = BorderStyle.None;
            control.BackColor = Color.FromArgb(243, 248, 251);
            control.ForeColor = Color.FromArgb(31, 47, 67);
            control.Width = 190;
            control.Font = new Font("Segoe UI", 10F);
        }
        _reset.CalendarForeColor = Color.FromArgb(31, 47, 67);
        _reset.CalendarMonthBackground = Color.FromArgb(248, 251, 254);
        _reset.Font = new Font("Segoe UI", 10F);

        _upload.Value = Math.Clamp((decimal)config.CalibrationUploadUsedBytes / 1_000_000m, _upload.Minimum, _upload.Maximum);
        _download.Value = Math.Clamp((decimal)config.CalibrationDownloadUsedBytes / 1_000_000m, _download.Minimum, _download.Maximum);
        _reset.Value = config.NextResetAt == default
            ? DateTime.Now.AddMonths(1).Date
            : ResetSchedulePolicy.NormalizeResetDate(config.NextResetAt).LocalDateTime.Date;

        var shell = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 4,
            Padding = new Padding(28, 24, 28, 20),
            BackColor = BackColor
        };
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        shell.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));

        var title = new Label
        {
            Text = "本周期流量校准",
            AutoSize = true,
            Font = new Font("Segoe UI Semibold", 16F),
            ForeColor = Color.FromArgb(24, 39, 58),
            Margin = new Padding(0, 0, 0, 4)
        };
        var subtitle = new Label
        {
            Text = "按坚果云账户页当前显示值录入。DavBridge 会以这组数据作为本周期安全额度基线。",
            AutoSize = true,
            MaximumSize = new Size(440, 0),
            Font = new Font("Segoe UI", 9.5F),
            ForeColor = Color.FromArgb(105, 123, 140),
            Margin = new Padding(0, 0, 0, 14)
        };
        shell.Controls.Add(title, 0, 0);
        shell.Controls.Add(subtitle, 0, 1);

        var fields = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            ColumnCount = 2,
            BackColor = BackColor,
            Margin = Padding.Empty
        };
        fields.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 185));
        fields.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        AddField(fields, "官方上传已用 MB", _upload);
        AddField(fields, "官方下载已用 MB", _download);
        AddField(fields, "下次流量重置日期", _reset);

        var note = new Label
        {
            Text = "重置日当地时间 09:00 后才开始真实上传探测，不会仅凭日期猜测额度已经刷新。",
            AutoSize = true,
            MaximumSize = new Size(420, 0),
            ForeColor = Color.FromArgb(117, 135, 151),
            Font = new Font("Segoe UI", 9F),
            Margin = new Padding(0, 10, 0, 0)
        };
        fields.Controls.Add(note, 0, fields.RowCount++);
        fields.SetColumnSpan(note, 2);
        shell.Controls.Add(fields, 0, 2);

        var footer = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            BackColor = BackColor,
            Padding = new Padding(0, 6, 0, 0)
        };
        var save = ActionButton("校准", true);
        var cancel = ActionButton("取消", false);
        save.DialogResult = DialogResult.OK;
        cancel.DialogResult = DialogResult.Cancel;
        footer.Controls.Add(save);
        footer.Controls.Add(cancel);
        shell.Controls.Add(footer, 0, 3);

        Controls.Add(shell);
        AcceptButton = save;
        CancelButton = cancel;
    }

    private static Button ActionButton(string text, bool primary)
    {
        var button = new Button
        {
            Text = text,
            Width = 88,
            Height = 32,
            FlatStyle = FlatStyle.Flat,
            BackColor = primary ? Color.FromArgb(225, 241, 252) : Color.FromArgb(245, 250, 253),
            ForeColor = primary ? Color.FromArgb(24, 118, 185) : Color.FromArgb(67, 87, 105),
            Font = new Font("Segoe UI Semibold", 9.5F),
            Margin = new Padding(8, 0, 0, 0),
            TabStop = true
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = primary ? Color.FromArgb(214, 235, 249) : Color.FromArgb(234, 243, 248);
        return button;
    }

    private static void AddField(TableLayoutPanel panel, string label, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
        panel.Controls.Add(new Label
        {
            Text = label,
            AutoSize = false,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            ForeColor = Color.FromArgb(75, 94, 112),
            Font = new Font("Segoe UI", 9.5F),
            Margin = Padding.Empty
        }, 0, row);

        var surface = new CalibrationFieldPanel
        {
            Width = 210,
            Height = 32,
            MinimumSize = new Size(210, 32),
            MaximumSize = new Size(210, 32),
            Margin = new Padding(0, 5, 0, 5)
        };
        control.Dock = DockStyle.Fill;
        control.Margin = Padding.Empty;
        surface.Controls.Add(control);
        panel.Controls.Add(surface, 1, row);
    }

    private sealed class CalibrationFieldPanel : Panel
    {
        public CalibrationFieldPanel()
        {
            BackColor = Color.FromArgb(243, 248, 251);
            Padding = new Padding(9, 5, 7, 4);
            DoubleBuffered = true;
            ResizeRedraw = true;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using var path = RoundedRect(rect, 10);
            using var fill = new SolidBrush(Color.FromArgb(243, 248, 251));
            using var border = new Pen(Color.FromArgb(221, 232, 239), 1F);
            e.Graphics.FillPath(fill, path);
            e.Graphics.DrawPath(border, path);
            base.OnPaint(e);
        }

        private static System.Drawing.Drawing2D.GraphicsPath RoundedRect(Rectangle rect, int radius)
        {
            var path = new System.Drawing.Drawing2D.GraphicsPath();
            var diameter = radius * 2;
            var arc = new Rectangle(rect.X, rect.Y, diameter, diameter);
            path.AddArc(arc, 180, 90);
            arc.X = rect.Right - diameter;
            path.AddArc(arc, 270, 90);
            arc.Y = rect.Bottom - diameter;
            path.AddArc(arc, 0, 90);
            arc.X = rect.Left;
            path.AddArc(arc, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
