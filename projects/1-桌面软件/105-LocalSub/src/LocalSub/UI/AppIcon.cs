namespace LocalSub.UI;

internal static class AppIcon
{
    internal static Icon Create()
    {
        try
        {
            var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (icon != null) return icon;
        }
        catch { }

        return (Icon)SystemIcons.Application.Clone();
    }
}
