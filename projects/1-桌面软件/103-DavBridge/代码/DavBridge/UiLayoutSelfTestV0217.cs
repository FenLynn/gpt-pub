using System.Reflection;

namespace DavBridge;

internal static class UiLayoutSelfTestV0217
{
    public static void Validate(MainForm form, UiDashboardV027 dashboard, string scenario)
    {
        form.PerformLayout();
        Require(form.ClientSize.Width >= 640, scenario, "client width too small");
        Require(form.ClientSize.Height >= 480, scenario, "client height too small");

        var shell = Field<TableLayoutPanel>(dashboard, "_shell");
        var flow = Field<RouteFlowV026>(dashboard, "_flow");
        var overall = Field<GradientMeterBar>(dashboard, "_overallBar");
        var current = Field<GradientMeterBar>(dashboard, "_currentBar");
        var upload = Field<GradientMeterBar>(dashboard, "_uploadBar");
        var download = Field<GradientMeterBar>(dashboard, "_downloadBar");

        Require(shell is not null && shell.Width > 0 && shell.Height > 0, scenario, "shell not laid out");
        Require(flow is not null && flow.Width >= 300 && flow.Height >= 80, scenario, "route flow clipped");
        Require(overall is not null && overall.Width >= 180 && overall.Height >= 20, scenario, "overall bar clipped");
        Require(current is not null && current.Width >= 180 && current.Height >= 24, scenario, "current bar clipped");
        Require(upload is not null && upload.Width >= 90 && upload.Height >= 16, scenario, "upload bar clipped");
        Require(download is not null && download.Width >= 90 && download.Height >= 16, scenario, "download bar clipped");

        var primary = Descendants(form).OfType<PrimaryActionSurfaceV0217>().FirstOrDefault();
        Require(primary is not null && primary.Width >= UiGeometryV0217.PrimaryButtonWidth && primary.Height >= UiGeometryV0217.PrimaryButtonHeight,
            scenario, "primary action clipped");

        var tabs = Descendants(form).OfType<ActivityTabStripV0224>().FirstOrDefault();
        Require(tabs is not null && tabs.Width >= 120 && tabs.Height >= 28, scenario, "activity tabs clipped");

        if (tabs is not null)
        {
            tabs.SelectedIndex = 1;
            form.PerformLayout();

            var verificationStage = Descendants(form).OfType<VerificationStageTrackV0224>().FirstOrDefault();
            Require(verificationStage is not null &&
                    verificationStage.Width >= 180 && verificationStage.Height >= 30,
                scenario, "verification stage clipped");

            var verificationBar = Descendants(form).OfType<VerificationProgressBarV0224>().FirstOrDefault();
            Require(verificationBar is not null &&
                    verificationBar.Width >= 180 && verificationBar.Height >= 24,
                scenario, "verification bar clipped");

            var primarySurfaces = Descendants(form).OfType<PrimaryActionSurfaceV0217>().ToArray();
            Require(primarySurfaces.Length >= 2 && primarySurfaces.All(x =>
                    x.Width >= UiGeometryV0217.PrimaryButtonWidth &&
                    x.Height >= UiGeometryV0217.PrimaryButtonHeight),
                scenario, "activity primary action clipped");

            tabs.SelectedIndex = 0;
            form.PerformLayout();
        }

        var message = Descendants(form).FirstOrDefault(x => x.GetType().Name.Contains("MessageSurface", StringComparison.Ordinal));
        Require(message is not null && message.Height >= UiGeometryV0217.MessageBarHeight && message.Width >= 300,
            scenario, "message bar clipped");

        if (shell is not null)
        {
            var columns = shell.GetColumnWidths();
            Require(columns.Length == 2 && columns.All(x => x > 0), scenario, "shell columns invalid");
            Require(columns.Sum() <= shell.ClientSize.Width + 2, scenario, "shell columns overflow");
        }
    }

    public static void ValidateSettings(SettingsDialog dialog, string scenario)
    {
        dialog.PerformLayout();
        var buttons = Descendants(dialog).OfType<Button>().ToArray();
        foreach (var text in new[] { "保存", "取消" })
        {
            var button = buttons.FirstOrDefault(x => x.Text == text);
            Require(button is not null && button.Width >= 70 && button.Height >= 30, scenario, $"settings {text} button clipped");
            if (button is not null)
            {
                var required = TextRenderer.MeasureText(button.Text, button.Font).Width + 18;
                Require(button.Width >= required, scenario, $"settings {text} text clipped");
            }
        }
    }

    private static T? Field<T>(UiDashboardV027 dashboard, string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(dashboard) as T; }
        catch { return null; }
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child)) yield return nested;
        }
    }

    private static void Require(bool condition, string scenario, string message)
    {
        if (!condition) throw new InvalidOperationException($"UI layout self-test failed [{scenario}]: {message}");
    }
}
