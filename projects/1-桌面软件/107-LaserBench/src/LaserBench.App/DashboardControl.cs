namespace LaserBench;

internal sealed class DashboardControl : UserControl
{
    private readonly IInstrumentProvider _provider;
    private readonly AppConfig _config;
    private readonly Dictionary<ModuleKind, ModuleViewBase> _views = new();
    private readonly Dictionary<ModuleKind, FloatingModuleForm> _floating = new();
    private readonly System.Windows.Forms.Timer _refreshTimer = new() { Interval = 100 };

    public event Action<ModuleKind>? OpenModuleRequested;

    public DashboardControl(IInstrumentProvider provider, AppConfig config)
    {
        _provider = provider;
        _config = config;
        BackColor = UiTheme.Back;
        Margin = Padding.Empty;
        Padding = Padding.Empty;
        DoubleBuffered = true;
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);

        foreach (var kind in Enum.GetValues<ModuleKind>())
        {
            var view = CreateView(kind);
            view.OpenRequested += module => OpenModuleRequested?.Invoke(module);
            view.FloatRequested += (module, point) => FloatModule(module, point);
            _views[kind] = view;
            Controls.Add(view);
        }

        _refreshTimer.Tick += (_, _) =>
        {
            foreach (var view in _views.Values) view.Invalidate();
            Invalidate();
        };
        _refreshTimer.Start();
    }

    public ModuleViewBase CreateView(ModuleKind kind) => kind switch
    {
        ModuleKind.Power => new PowerModuleView(_provider, _config),
        ModuleKind.Spectrum => new SpectrumModuleView(_provider, _config),
        ModuleKind.Beam => new BeamModuleView(_provider, _config),
        _ => new ScopeModuleView(_provider, _config)
    };

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        LayoutEmbeddedViews();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.Clear(UiTheme.Back);
        var midX = Width / 2;
        var midY = Height / 2;
        using var separator = new Pen(UiTheme.Divider, 1f) { DashStyle = System.Drawing.Drawing2D.DashStyle.Dash };
        e.Graphics.DrawLine(separator, midX, 4, midX, Height - 4);
        e.Graphics.DrawLine(separator, 4, midY, Width - 4, midY);

        foreach (var kind in _floating.Keys.ToArray())
        {
            var rect = GetSlot(kind);
            using var fill = new SolidBrush(Color.FromArgb(70, UiTheme.Surface));
            e.Graphics.FillRectangle(fill, rect);
            GlyphPainter.Draw(
                e.Graphics,
                GlyphPainter.ForModule(kind),
                new Rectangle(rect.Left + rect.Width / 2 - 12, rect.Top + rect.Height / 2 - 12, 24, 24),
                Color.FromArgb(82, UiTheme.Muted),
                1.45f);
        }
    }

    private void LayoutEmbeddedViews()
    {
        foreach (var pair in _views)
        {
            if (pair.Value.Parent != this) continue;
            pair.Value.Bounds = GetSlot(pair.Key);
            pair.Value.BringToFront();
        }
    }

    private Rectangle GetSlot(ModuleKind kind)
    {
        var midX = Width / 2;
        var midY = Height / 2;
        return kind switch
        {
            ModuleKind.Power => Rectangle.FromLTRB(0, 0, Math.Max(0, midX - 1), Math.Max(0, midY - 1)),
            ModuleKind.Spectrum => Rectangle.FromLTRB(Math.Min(Width, midX + 1), 0, Width, Math.Max(0, midY - 1)),
            ModuleKind.Beam => Rectangle.FromLTRB(0, Math.Min(Height, midY + 1), Math.Max(0, midX - 1), Height),
            _ => Rectangle.FromLTRB(Math.Min(Width, midX + 1), Math.Min(Height, midY + 1), Width, Height)
        };
    }

    private void FloatModule(ModuleKind kind, Point screenPoint)
    {
        if (_floating.TryGetValue(kind, out var existing))
        {
            existing.Activate();
            return;
        }

        var view = _views[kind];
        Controls.Remove(view);
        var form = new FloatingModuleForm(kind, view, FindForm());
        _floating[kind] = form;
        form.AttachRequested += () => Reattach(kind, form, view);
        form.FormClosed += (_, _) =>
        {
            if (_floating.ContainsKey(kind)) Reattach(kind, form, view, closeForm: false);
        };
        form.StartPosition = FormStartPosition.Manual;
        form.Location = new Point(Math.Max(0, screenPoint.X - 35), Math.Max(0, screenPoint.Y - 20));
        form.Size = new Size(Math.Max(700, Width / 2), Math.Max(460, Height / 2));
        form.Show(FindForm());
        Invalidate();
    }

    private void Reattach(ModuleKind kind, FloatingModuleForm form, ModuleViewBase view, bool closeForm = true)
    {
        if (!_floating.Remove(kind)) return;
        if (view.Parent == form) form.Controls.Remove(view);
        view.Dock = DockStyle.None;
        Controls.Add(view);
        LayoutEmbeddedViews();
        if (closeForm && !form.IsDisposed) form.CloseAfterAttach();
        Invalidate();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _refreshTimer.Stop();
            _refreshTimer.Dispose();
            foreach (var form in _floating.Values.ToArray())
            {
                try { form.Close(); }
                catch { }
            }
        }
        base.Dispose(disposing);
    }
}

internal sealed class FloatingModuleForm : Form
{
    private const int WM_EXITSIZEMOVE = 0x0232;
    private readonly Form? _mainForm;
    private bool _closeAfterAttach;
    public event Action? AttachRequested;

    public FloatingModuleForm(ModuleKind kind, ModuleViewBase view, Form? mainForm)
    {
        _mainForm = mainForm;
        Text = $"LaserBench · {ModuleName(kind)}";
        BackColor = UiTheme.Back;
        FormBorderStyle = FormBorderStyle.Sizable;
        ShowInTaskbar = true;
        Controls.Add(view);
        view.Dock = DockStyle.Fill;
    }

    private static string ModuleName(ModuleKind kind) => kind switch
    {
        ModuleKind.Power => "功率",
        ModuleKind.Spectrum => "光谱",
        ModuleKind.Beam => "光束质量",
        _ => "示波器"
    };

    public void CloseAfterAttach()
    {
        _closeAfterAttach = true;
        Close();
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg != WM_EXITSIZEMOVE || _closeAfterAttach || _mainForm is null || !_mainForm.Visible) return;
        if (_mainForm.Bounds.Contains(Cursor.Position)) AttachRequested?.Invoke();
    }
}
