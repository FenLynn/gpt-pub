using System.Diagnostics;
using System.Reflection;

namespace LaserBench;

internal sealed class TopBarControl : UserControl
{
    private readonly AppConfig _config;
    private readonly IInstrumentProvider _provider;
    private readonly GlyphButton _capture = new(GlyphKind.Capture) { Active = true };
    private readonly TextBox _label = new() { BorderStyle = BorderStyle.FixedSingle, Font = UiTheme.Small };
    private readonly GlyphButton _clear = new(GlyphKind.Clear);
    private readonly GlyphButton _confirm = new(GlyphKind.Check) { Active = true };
    private readonly Dictionary<ModuleKind, GlyphButton> _moduleButtons = new();
    private readonly GlyphButton _camera = new(GlyphKind.Camera);
    private readonly GlyphButton _record = new(GlyphKind.Record);
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 80 };
    private float _phase;

    public event EventHandler? CaptureClicked;
    public event EventHandler? ScreenshotClicked;
    public event EventHandler? RecordClicked;
    public event Action<string>? LabelConfirmed;
    public event Action<ModuleKind, bool>? CaptureSelectionChanged;

    public TopBarControl(AppConfig config, IInstrumentProvider provider)
    {
        _config = config;
        _provider = provider;
        Height = 34;
        BackColor = Color.FromArgb(247, 250, 253);
        DoubleBuffered = true;

        Controls.Add(_capture);
        Controls.Add(_label);
        Controls.Add(_clear);
        Controls.Add(_confirm);
        Controls.Add(_camera);
        Controls.Add(_record);
        _label.Text = config.ConfirmedLabel;

        foreach (var kind in Enum.GetValues<ModuleKind>())
        {
            var button = new GlyphButton(GlyphPainter.ForModule(kind)) { Active = IsSelected(kind) };
            var capturedKind = kind;
            button.Click += (_, _) =>
            {
                var next = !IsSelected(capturedKind);
                SetSelected(capturedKind, next);
                button.Active = next;
                button.Invalidate();
                CaptureSelectionChanged?.Invoke(capturedKind, next);
            };
            _moduleButtons[kind] = button;
            Controls.Add(button);
        }

        _capture.Click += (_, _) => CaptureClicked?.Invoke(this, EventArgs.Empty);
        _camera.Click += (_, _) => ScreenshotClicked?.Invoke(this, EventArgs.Empty);
        _record.Click += (_, _) => RecordClicked?.Invoke(this, EventArgs.Empty);
        _clear.Click += (_, _) => _label.Clear();
        _confirm.Click += (_, _) => ConfirmLabel();
        _label.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { ConfirmLabel(); e.SuppressKeyPress = true; } };

        _timer.Tick += (_, _) => { _phase += 0.22f; Invalidate(); };
        _timer.Start();
    }

    public void SetCapturing(bool capturing)
    {
        _capture.Danger = capturing;
        _capture.Active = !capturing;
        _capture.Invalidate();
    }

    public void SetRecording(bool recording)
    {
        _record.Danger = recording;
        _record.Active = recording;
        _record.Invalidate();
    }

    public void RefreshAliases() => Invalidate();

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        var y = 4;
        _capture.SetBounds(5, y, 26, 26);
        _label.SetBounds(38, 6, 94, 22);
        _clear.SetBounds(134, y, 24, 26);
        _confirm.SetBounds(159, y, 24, 26);
        var x = 191;
        foreach (var kind in Enum.GetValues<ModuleKind>())
        {
            _moduleButtons[kind].SetBounds(x, y, 26, 26);
            x += 29;
        }
        _camera.SetBounds(Math.Max(x + 10, Width - 188), y, 26, 26);
        _record.SetBounds(_camera.Right + 2, y, 26, 26);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var line = new Pen(UiTheme.Divider, 1f);
        e.Graphics.DrawLine(line, 0, Height - 1, Width, Height - 1);

        var right = _camera.Left - 8;
        var devices = GetDeviceNames();
        for (var i = devices.Count - 1; i >= 0; i--)
        {
            var name = devices[i];
            var width = TextRenderer.MeasureText(name, UiTheme.Tiny).Width + 17;
            right -= width;
            var alpha = 155 + (int)(70 * (0.5 + 0.5 * Math.Sin(_phase + i * .45)));
            using var dot = new SolidBrush(Color.FromArgb(Math.Clamp(alpha, 0, 255), UiTheme.Green));
            e.Graphics.FillEllipse(dot, right + 2, 14, 6, 6);
            TextRenderer.DrawText(e.Graphics, name, UiTheme.Tiny, new Point(right + 11, 8), UiTheme.Muted, Color.Transparent);
        }

        var clock = DateTime.Now.ToString("yyyy/MM/dd  HH:mm:ss");
        var clockSize = TextRenderer.MeasureText(clock, UiTheme.Tiny);
        TextRenderer.DrawText(e.Graphics, clock, UiTheme.Tiny, new Point(Width - clockSize.Width - 5, 9), UiTheme.Ink, Color.Transparent);
        _record.Left = Width - clockSize.Width - 39;
        _camera.Left = _record.Left - 28;
    }

    private List<string> GetDeviceNames()
    {
        var list = new List<string>();
        foreach (var device in _provider.Devices)
        {
            list.Add(device.Kind switch
            {
                ModuleKind.Power when list.Count(x => x == _config.Power1Alias) == 0 => device.Alias == "power1" ? _config.Power1Alias : _config.Power2Alias,
                ModuleKind.Spectrum => _config.Osa1Alias,
                ModuleKind.Beam => _config.BeamAlias,
                ModuleKind.Scope => "scope",
                _ => device.Alias
            });
        }
        if (list.Count >= 2)
        {
            var powerIndexes = _provider.Devices.Select((d, i) => (d, i)).Where(x => x.d.Kind == ModuleKind.Power).Select(x => x.i).ToArray();
            if (powerIndexes.Length >= 2)
            {
                list[powerIndexes[0]] = _config.Power1Alias;
                list[powerIndexes[1]] = _config.Power2Alias;
            }
        }
        return list;
    }

    private void ConfirmLabel()
    {
        var label = _label.Text.Trim();
        _config.ConfirmedLabel = label;
        LabelConfirmed?.Invoke(label);
    }

    private bool IsSelected(ModuleKind kind) => kind switch
    {
        ModuleKind.Power => _config.CapturePower,
        ModuleKind.Spectrum => _config.CaptureSpectrum,
        ModuleKind.Beam => _config.CaptureBeam,
        _ => _config.CaptureScope
    };

    private void SetSelected(ModuleKind kind, bool selected)
    {
        switch (kind)
        {
            case ModuleKind.Power: _config.CapturePower = selected; break;
            case ModuleKind.Spectrum: _config.CaptureSpectrum = selected; break;
            case ModuleKind.Beam: _config.CaptureBeam = selected; break;
            case ModuleKind.Scope: _config.CaptureScope = selected; break;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { _timer.Stop(); _timer.Dispose(); }
        base.Dispose(disposing);
    }
}

internal sealed class SidebarControl : UserControl
{
    private readonly AppConfig _config;
    private readonly List<(GlyphKind Glyph, string Text, string Key)> _items = new()
    {
        (GlyphKind.Dashboard, "Dashboard", "dashboard"),
        (GlyphKind.Power, "Power", "power"),
        (GlyphKind.Spectrum, "Spectrum", "spectrum"),
        (GlyphKind.Beam, "Beam", "beam"),
        (GlyphKind.Scope, "Scope", "scope"),
        (GlyphKind.Data, "Data", "data"),
        (GlyphKind.Settings, "Settings", "settings")
    };
    private string _active = "dashboard";
    private int _hoverIndex = -1;

    public bool Expanded { get; private set; }
    public event Action<string>? NavigateRequested;
    public event Action<bool>? ExpandedChanged;

    public SidebarControl(AppConfig config)
    {
        _config = config;
        Expanded = config.SidebarExpanded;
        Width = Expanded ? 122 : 38;
        BackColor = Color.FromArgb(238, 244, 249);
        DoubleBuffered = true;
        Cursor = Cursors.Hand;
        MouseMove += (_, e) => { _hoverIndex = HitIndex(e.Y); Invalidate(); };
        MouseLeave += (_, _) => { _hoverIndex = -1; Invalidate(); };
        MouseClick += OnSidebarClick;
    }

    public void SetActive(string key)
    {
        _active = key;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(BackColor);
        using var divider = new Pen(UiTheme.Divider, 1f);
        e.Graphics.DrawLine(divider, Width - 1, 0, Width - 1, Height);

        for (var i = 0; i < _items.Count; i++)
        {
            var y = 8 + i * 38;
            var itemRect = new Rectangle(0, y, Width - 1, 34);
            if (_hoverIndex == i || _active == _items[i].Key)
            {
                using var back = new SolidBrush(Color.FromArgb(_active == _items[i].Key ? 24 : 14, UiTheme.Accent));
                e.Graphics.FillRectangle(back, itemRect);
            }
            if (_active == _items[i].Key)
            {
                using var active = new SolidBrush(UiTheme.Accent);
                e.Graphics.FillRectangle(active, 0, y + 5, 2, 24);
            }
            GlyphPainter.Draw(e.Graphics, _items[i].Glyph, new Rectangle(9, y + 7, 20, 20), _active == _items[i].Key ? UiTheme.Accent : UiTheme.Muted, 1.45f);
            if (Expanded)
                TextRenderer.DrawText(e.Graphics, _items[i].Text, UiTheme.Small, new Point(38, y + 9), UiTheme.Ink, Color.Transparent);
        }

        var bottomY = Math.Max(8 + _items.Count * 38 + 10, Height - 34);
        using (var status = new SolidBrush(UiTheme.Green)) e.Graphics.FillEllipse(status, 13, bottomY + 8, 7, 7);
        if (Expanded)
        {
            TextRenderer.DrawText(e.Graphics, "System OK", UiTheme.Tiny, new Point(28, bottomY + 3), UiTheme.Muted, Color.Transparent);
            var version = "v" + (Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.1.0");
            var s = TextRenderer.MeasureText(version, UiTheme.Tiny);
            TextRenderer.DrawText(e.Graphics, version, UiTheme.Tiny, new Point(Width - s.Width - 5, 3), UiTheme.Muted, Color.Transparent);
        }

        var expandRect = new Rectangle(Width - 22, Height - 25, 16, 16);
        using var pen = new Pen(UiTheme.Muted, 1.3f) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round };
        var midY = expandRect.Top + expandRect.Height / 2f;
        if (Expanded)
        {
            e.Graphics.DrawLine(pen, expandRect.Right - 4, expandRect.Top + 3, expandRect.Left + 4, midY);
            e.Graphics.DrawLine(pen, expandRect.Left + 4, midY, expandRect.Right - 4, expandRect.Bottom - 3);
        }
        else
        {
            e.Graphics.DrawLine(pen, expandRect.Left + 4, expandRect.Top + 3, expandRect.Right - 4, midY);
            e.Graphics.DrawLine(pen, expandRect.Right - 4, midY, expandRect.Left + 4, expandRect.Bottom - 3);
        }
    }

    private void OnSidebarClick(object? sender, MouseEventArgs e)
    {
        if (e.Y >= Height - 30)
        {
            Expanded = !Expanded;
            _config.SidebarExpanded = Expanded;
            Width = Expanded ? 122 : 38;
            ExpandedChanged?.Invoke(Expanded);
            Invalidate();
            return;
        }

        var index = HitIndex(e.Y);
        if (index < 0 || index >= _items.Count) return;
        _active = _items[index].Key;
        NavigateRequested?.Invoke(_active);
        Invalidate();
    }

    private int HitIndex(int y)
    {
        var index = (y - 8) / 38;
        if (y < 8 || index < 0 || index >= _items.Count) return -1;
        var top = 8 + index * 38;
        return y <= top + 34 ? index : -1;
    }
}

internal sealed class ModulePageControl : UserControl
{
    public ModulePageControl(ModuleKind kind, DashboardControl dashboard, AppConfig config)
    {
        BackColor = UiTheme.Back;
        var view = dashboard.CreateView(kind);
        view.Dock = DockStyle.Fill;
        var settings = new Panel { Dock = DockStyle.Right, Width = 210, BackColor = Color.FromArgb(247, 250, 253), Padding = new Padding(12) };
        var title = new Label { Dock = DockStyle.Top, Height = 28, Font = UiTheme.ValueBold, ForeColor = UiTheme.Ink, Text = kind.ToString() };
        var info = new Label
        {
            Dock = DockStyle.Top,
            Height = 130,
            Font = UiTheme.Small,
            ForeColor = UiTheme.Muted,
            Text = kind switch
            {
                ModuleKind.Power => "Trace visibility, statistics slots and acquisition window are configured here. Dashboard remains read-focused.",
                ModuleKind.Spectrum => "OSA transport, sweep policy, trace mode and linewidth metrics will live here when real hardware is connected.",
                ModuleKind.Beam => "Default waist scan position, attenuation range and BeamSquared acquisition policy are configured here.",
                _ => "Choose up to two channels and configure their independent vertical scales here. Dashboard only shows time-domain and FFT."
            }
        };
        settings.Controls.Add(info);
        settings.Controls.Add(title);
        Controls.Add(view);
        Controls.Add(settings);
    }
}

internal sealed class DataPageControl : UserControl
{
    private readonly AppConfig _config;
    private readonly TextBox _folder = new() { Width = 220 };
    private readonly TextBox _label = new() { Width = 140 };
    private readonly Label _current = new() { AutoSize = true, ForeColor = UiTheme.Muted };
    private readonly DataGridView _grid = new()
    {
        Dock = DockStyle.Fill,
        ReadOnly = true,
        AllowUserToAddRows = false,
        AllowUserToDeleteRows = false,
        AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
        BackgroundColor = Color.White,
        BorderStyle = BorderStyle.None,
        RowHeadersVisible = false
    };

    public DataPageControl(AppConfig config)
    {
        _config = config;
        BackColor = UiTheme.Back;
        Padding = new Padding(12);
        _folder.Text = config.CurrentExperimentFolder;
        _label.Text = config.ConfirmedLabel;

        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 72, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Padding = new Padding(2), BackColor = UiTheme.Back };
        var useFolder = NewButton("Use folder");
        var useDate = NewButton("Default date");
        var open = NewButton("Open exp");
        var scan = NewButton("Scan label");
        top.Controls.AddRange(new Control[] { _folder, useFolder, useDate, open, _label, scan, _current });

        useFolder.Click += (_, _) =>
        {
            _config.CurrentExperimentFolder = _folder.Text.Trim();
            AppConfigStore.Save(_config);
            RefreshCurrent();
            Scan();
        };
        useDate.Click += (_, _) =>
        {
            _config.CurrentExperimentFolder = string.Empty;
            _folder.Clear();
            AppConfigStore.Save(_config);
            RefreshCurrent();
            Scan();
        };
        open.Click += (_, _) => Process.Start(new ProcessStartInfo(AppPaths.ResolveExperimentDirectory(_config)) { UseShellExecute = true });
        scan.Click += (_, _) => Scan();

        _grid.Columns.Add("time", "Time");
        _grid.Columns.Add("source", "Source / version");
        _grid.Columns.Add("file", "File");
        Controls.Add(_grid);
        Controls.Add(top);
        RefreshCurrent();
        Scan();
    }

    private static Button NewButton(string text) => new()
    {
        Text = text,
        AutoSize = true,
        FlatStyle = FlatStyle.Flat,
        BackColor = Color.White,
        ForeColor = UiTheme.Ink,
        Margin = new Padding(4, 0, 4, 0)
    };

    private void RefreshCurrent()
    {
        _current.Text = "  " + AppPaths.ResolveExperimentDirectory(_config);
    }

    private void Scan()
    {
        _grid.Rows.Clear();
        var directory = AppPaths.ResolveExperimentDirectory(_config);
        var label = SafeFile.SanitizeToken(_label.Text.Trim());
        if (!Directory.Exists(directory)) return;

        foreach (var file in Directory.GetFiles(directory).OrderByDescending(File.GetLastWriteTime))
        {
            var name = Path.GetFileNameWithoutExtension(file);
            if (!string.IsNullOrWhiteSpace(label) && !name.Contains("_" + label, StringComparison.OrdinalIgnoreCase)) continue;
            var time = name.Length >= 6 && name.Take(6).All(char.IsDigit) ? name[..6] : File.GetLastWriteTime(file).ToString("HHmmss");
            var rest = name.Length > 7 ? name[7..] : name;
            var version = rest.EndsWith("_1", StringComparison.OrdinalIgnoreCase) || rest.Contains("_2", StringComparison.OrdinalIgnoreCase) ? "versioned" : "base";
            _grid.Rows.Add(time, $"{rest}  · {version}", Path.GetFileName(file));
        }
    }
}

internal sealed class SettingsPageControl : UserControl
{
    private readonly AppConfig _config;
    public event EventHandler? AliasesChanged;

    public SettingsPageControl(AppConfig config)
    {
        _config = config;
        BackColor = UiTheme.Back;
        Padding = new Padding(18);
        AutoScroll = true;

        var table = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 3, RowCount = 1, BackColor = UiTheme.Back };
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 260));
        table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        AddRow(table, "Portable root", AppPaths.Root, AppPaths.IsWritable() ? "Writable" : "Read-only");
        AddRow(table, ".NET runtime", Environment.Version.ToString(), "Available");
        AddRow(table, "Mode", "Simulator", "No hardware required in v0.1.0");
        AddAliasRow(table, "Power 1 alias", _config.Power1Alias, v => _config.Power1Alias = v);
        AddAliasRow(table, "Power 2 alias", _config.Power2Alias, v => _config.Power2Alias = v);
        AddAliasRow(table, "Math 1 alias", _config.Math1Alias, v => _config.Math1Alias = v);
        AddAliasRow(table, "OSA 1 alias", _config.Osa1Alias, v => _config.Osa1Alias = v);
        AddAliasRow(table, "Beam alias", _config.BeamAlias, v => _config.BeamAlias = v);
        AddAliasRow(table, "Scope CH1 alias", _config.Scope1Alias, v => _config.Scope1Alias = v);
        AddAliasRow(table, "Scope CH2 alias", _config.Scope2Alias, v => _config.Scope2Alias = v);

        var auto = new CheckBox { Text = "Capture screenshot automatically after each Test", Checked = _config.AutoScreenshot, AutoSize = true, ForeColor = UiTheme.Ink, Margin = new Padding(3, 10, 3, 10) };
        auto.CheckedChanged += (_, _) => { _config.AutoScreenshot = auto.Checked; AppConfigStore.Save(_config); };
        table.Controls.Add(auto, 1, table.RowCount);
        table.SetColumnSpan(auto, 2);
        table.RowCount++;

        var offline = new Button { Text = "Open offline dependency guide", AutoSize = true, FlatStyle = FlatStyle.Flat };
        offline.Click += (_, _) =>
        {
            var guide = Path.Combine(AppPaths.Root, "OFFLINE-DEPENDENCIES.txt");
            if (File.Exists(guide)) Process.Start(new ProcessStartInfo(guide) { UseShellExecute = true });
        };
        table.Controls.Add(offline, 1, table.RowCount);
        table.SetColumnSpan(offline, 2);
        table.RowCount++;

        Controls.Add(table);
    }

    private void AddRow(TableLayoutPanel table, string name, string value, string status)
    {
        var row = table.RowCount++;
        table.Controls.Add(new Label { Text = name, AutoSize = true, ForeColor = UiTheme.Muted, Margin = new Padding(3, 8, 3, 8) }, 0, row);
        table.Controls.Add(new Label { Text = value, AutoSize = true, ForeColor = UiTheme.Ink, Margin = new Padding(3, 8, 3, 8) }, 1, row);
        table.Controls.Add(new Label { Text = status, AutoSize = true, ForeColor = status.Contains("Read") ? UiTheme.Red : UiTheme.Green, Margin = new Padding(3, 8, 3, 8) }, 2, row);
    }

    private void AddAliasRow(TableLayoutPanel table, string name, string value, Action<string> setter)
    {
        var row = table.RowCount++;
        var box = new TextBox { Text = value, Width = 180 };
        box.Validated += (_, _) =>
        {
            var safe = string.IsNullOrWhiteSpace(box.Text) ? value : box.Text.Trim();
            setter(safe);
            AppConfigStore.Save(_config);
            AliasesChanged?.Invoke(this, EventArgs.Empty);
        };
        table.Controls.Add(new Label { Text = name, AutoSize = true, ForeColor = UiTheme.Muted, Margin = new Padding(3, 8, 3, 8) }, 0, row);
        table.Controls.Add(box, 1, row);
        table.SetColumnSpan(box, 2);
    }
}
