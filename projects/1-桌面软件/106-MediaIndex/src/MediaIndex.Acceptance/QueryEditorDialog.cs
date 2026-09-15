namespace MediaIndex.Acceptance;

internal sealed class QueryEditorDialog : Form
{
    private readonly ComboBox _relationCombo;
    private readonly NumericUpDown _startSeconds;
    private readonly Label _startLabel;
    private readonly CheckBox _knowStart;

    public QueryEditorDialog(AcceptanceQuery query)
    {
        Text = "设置标准答案";
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        ClientSize = new Size(430, query.Kind == QueryMediaKind.Video ? 220 : 165);
        BackColor = Color.FromArgb(248, 250, 253);
        Font = new Font("Microsoft YaHei UI", 10F);

        var title = new Label
        {
            AutoSize = false,
            Text = Path.GetFileName(query.QueryPath),
            Font = new Font(Font.FontFamily, 11F, FontStyle.Bold),
            Location = new Point(24, 18),
            Size = new Size(380, 28),
            ForeColor = Color.FromArgb(31, 42, 58)
        };
        Controls.Add(title);

        var relationLabel = new Label
        {
            Text = "关系",
            Location = new Point(24, 62),
            Size = new Size(90, 26),
            ForeColor = Color.FromArgb(82, 94, 112)
        };
        Controls.Add(relationLabel);

        _relationCombo = new ComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            Location = new Point(122, 58),
            Size = new Size(270, 30)
        };

        if (query.Kind == QueryMediaKind.Image)
        {
            _relationCombo.Items.AddRange(
            [
                "Same source",
                "Recompressed",
                "Crop",
                "Screenshot",
                "Watermark",
                "Other derived"
            ]);
        }
        else
        {
            _relationCombo.Items.AddRange(
            [
                "Same video",
                "Partial clip",
                "Derived video",
                "Speed change",
                "Vertical crop",
                "Other derived"
            ]);
        }

        var current = string.IsNullOrWhiteSpace(query.Relation)
            ? _relationCombo.Items[0]?.ToString()
            : query.Relation;

        var currentIndex = _relationCombo.Items.IndexOf(current);
        _relationCombo.SelectedIndex = currentIndex >= 0 ? currentIndex : 0;
        Controls.Add(_relationCombo);

        _startLabel = new Label
        {
            Text = "源起始秒",
            Location = new Point(24, 105),
            Size = new Size(90, 26),
            ForeColor = Color.FromArgb(82, 94, 112),
            Visible = query.Kind == QueryMediaKind.Video
        };
        Controls.Add(_startLabel);

        _startSeconds = new NumericUpDown
        {
            Location = new Point(122, 101),
            Size = new Size(120, 30),
            DecimalPlaces = 2,
            Minimum = 0,
            Maximum = 1_000_000,
            Increment = 0.5M,
            Visible = query.Kind == QueryMediaKind.Video,
            Enabled = query.ExpectedStartSeconds.HasValue,
            Value = query.ExpectedStartSeconds.HasValue
                ? Math.Min(1_000_000M, (decimal)query.ExpectedStartSeconds.Value)
                : 0M
        };
        Controls.Add(_startSeconds);

        _knowStart = new CheckBox
        {
            Text = "我知道",
            AutoSize = true,
            Location = new Point(254, 104),
            Visible = query.Kind == QueryMediaKind.Video,
            Checked = query.ExpectedStartSeconds.HasValue
        };
        _knowStart.CheckedChanged += (_, _) =>
        {
            _startSeconds.Enabled = _knowStart.Checked;
        };
        Controls.Add(_knowStart);

        var cancel = new Button
        {
            Text = "取消",
            DialogResult = DialogResult.Cancel,
            Location = new Point(222, ClientSize.Height - 48),
            Size = new Size(80, 32)
        };
        Controls.Add(cancel);

        var ok = new Button
        {
            Text = "确定",
            DialogResult = DialogResult.OK,
            Location = new Point(312, ClientSize.Height - 48),
            Size = new Size(80, 32),
            BackColor = Color.FromArgb(61, 120, 220),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        ok.FlatAppearance.BorderSize = 0;
        Controls.Add(ok);

        AcceptButton = ok;
        CancelButton = cancel;
    }

    public string Relation => _relationCombo.SelectedItem?.ToString() ?? string.Empty;

    public double? ExpectedStartSeconds =>
        _startSeconds.Visible && _knowStart.Checked
            ? (double)_startSeconds.Value
            : null;
}
