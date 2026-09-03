namespace DavBridge;
internal sealed partial class UiMessageBarV0216
{
    public enum MessageLevel { Normal, Success, Warning, Error }
    private sealed partial class MessageSurface : Control
    {
        private readonly System.Windows.Forms.Timer _scrollTimer = new() { Interval = 33 };
        private string _message = "DavBridge 已就绪。";
        private int _scrollOffset;
        private int _holdTicks = 34;
        private int _endHoldTicks;

        public string Message
        {
            get => _message;
            set
            {
                var next = string.IsNullOrWhiteSpace(value) ? "DavBridge 已就绪。" : value;
                if (string.Equals(_message, next, StringComparison.Ordinal)) return;
                _message = next;
                ResetScroll();
                Invalidate();
            }
        }

        public MessageLevel Level { get; set; }

        public MessageSurface()
        {
            BackColor = Color.FromArgb(249, 251, 253);
            Font = new Font("Microsoft YaHei UI", 8.5F);
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
            _scrollTimer.Tick += (_, _) => AdvanceScroll();
            _scrollTimer.Start();
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            ResetScroll();
        }

        private void ResetScroll()
        {
            _scrollOffset = 0;
            _holdTicks = 34;
            _endHoldTicks = 0;
        }

        private void AdvanceScroll()
        {
            if (IsDisposed || Width <= 60 || string.IsNullOrWhiteSpace(_message)) return;
            var available = Math.Max(20, Width - 48);
            var flags = TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
            var textWidth = TextRenderer.MeasureText(_message, Font, new Size(int.MaxValue, Math.Max(1, Height)), flags).Width;
            var maxOffset = Math.Max(0, textWidth - available);
            if (maxOffset <= 0)
            {
                if (_scrollOffset != 0) { _scrollOffset = 0; Invalidate(); }
                return;
            }

            if (_holdTicks > 0)
            {
                _holdTicks--;
                return;
            }

            if (_scrollOffset < maxOffset)
            {
                _scrollOffset = Math.Min(maxOffset, _scrollOffset + 2);
                Invalidate();
                return;
            }

            if (_endHoldTicks < 30)
            {
                _endHoldTicks++;
                return;
            }

            ResetScroll();
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(BackColor);
            using var border = new Pen(Color.FromArgb(224, 229, 234));
            e.Graphics.DrawLine(border, 0, 0, Width, 0);
            var accent = Accent(Level);
            const float speakerSize = 14f;
            DrawSpeaker(e.Graphics, new RectangleF(14, (Height - speakerSize) / 2f, speakerSize, speakerSize), accent);

            var textArea = new Rectangle(36, 0, Math.Max(20, Width - 48), Height);
            var flags = TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPadding;
            var textWidth = TextRenderer.MeasureText(_message, Font, new Size(int.MaxValue, Math.Max(1, Height)), TextFormatFlags.SingleLine | TextFormatFlags.NoPadding).Width;
            var state = e.Graphics.Save();
            e.Graphics.SetClip(textArea);
            TextRenderer.DrawText(
                e.Graphics,
                _message,
                Font,
                new Rectangle(textArea.Left - _scrollOffset, 0, Math.Max(textArea.Width, textWidth + 8), Height),
                Color.FromArgb(72, 82, 91),
                flags);
            e.Graphics.Restore(state);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _scrollTimer.Stop();
                _scrollTimer.Dispose();
            }
            base.Dispose(disposing);
        }

        private static Color Accent(MessageLevel level) => level switch
        {
            MessageLevel.Success => Color.FromArgb(38, 145, 87),
            MessageLevel.Warning => Color.FromArgb(194, 139, 34),
            MessageLevel.Error => Color.FromArgb(183, 66, 66),
            _ => Color.FromArgb(79, 116, 148)
        };
    }
}
