using System.Reflection;

namespace DavBridge;

internal static class AppBranding
{
    public static Icon CreateIcon()
    {
        try
        {
            var icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (icon is not null)
                return (Icon)icon.Clone();
        }
        catch
        {
        }

        return (Icon)SystemIcons.Application.Clone();
    }

    public static void Apply(MainForm form)
    {
        try
        {
            var icon = CreateIcon();
            form.Icon = icon;

            var trayField = typeof(MainForm).GetField("_trayIcon", BindingFlags.Instance | BindingFlags.NonPublic);
            if (trayField?.GetValue(form) is NotifyIcon tray)
                tray.Icon = (Icon)icon.Clone();
        }
        catch
        {
            // Branding must never interfere with application startup or migration behavior.
        }
    }
}
