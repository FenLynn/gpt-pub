namespace DavBridge;
internal sealed partial class UiMessageBarV0216
{
    public enum MessageLevel { Normal, Success, Warning, Error }
    private sealed partial class MessageSurface : Control
    {
        public string Message { get; set; } = "DavBridge 已就绪。";
        public MessageLevel Level { get; set; }
        public MessageSurface()
        {
            BackColor = Color.FromArgb(249, 251, 253);
            Font = new Font("Microsoft YaHei UI", 8.5F);
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer, true);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(BackColor);
            using var border = new Pen(Color.FromArgb(224, 229, 234));
            e.Graphics.DrawLine(border, 0, 0, Width, 0);
            var accent = Accent(Level);
            const float speakerSize = 14f;
            DrawSpeaker(e.Graphics, new RectangleF(14, (Height - speakerSize) / 2f, speakerSize, speakerSize), accent);
            TextRenderer.DrawText(e.Graphics, Message, Font,
                new Rectangle(36, 0, Math.Max(20, Width - 48), Height),
                Color.FromArgb(72, 82, 91),
                TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPadding);
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
