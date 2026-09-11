namespace DavBridge;

internal sealed record UiNoticeV044(string Title, string Message, string Tone);

internal static class UiFeedbackBusV044
{
    public static event EventHandler<UiNoticeV044>? Published;

    public static void Publish(string title, string message, string tone = "info")
    {
        var safeTone = tone is "success" or "warning" ? tone : "info";
        Published?.Invoke(null, new UiNoticeV044(title, message, safeTone));
    }
}
