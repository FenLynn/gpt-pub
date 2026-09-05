namespace DavBridge;

internal static class UiGeometryV0217
{
    public const int SectionLabelWidth = 104;
    public const int QuotaBarHeight = 24;
    public const int QuotaActionWidth = 72;
    public const int PrimaryButtonWidth = 136;
    public const int PrimaryButtonHeight = 40;
    public const int MessageBarHeight = 32;

    public static readonly Color DividerColor = Color.FromArgb(229, 233, 237);

    public static ContentAlignment MiddleVertical(ContentAlignment alignment) => alignment switch
    {
        ContentAlignment.TopLeft or ContentAlignment.MiddleLeft or ContentAlignment.BottomLeft => ContentAlignment.MiddleLeft,
        ContentAlignment.TopRight or ContentAlignment.MiddleRight or ContentAlignment.BottomRight => ContentAlignment.MiddleRight,
        _ => ContentAlignment.MiddleCenter
    };
}
