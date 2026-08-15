using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using LocalSub.Core;

namespace LocalSub.UI;

public sealed class SubtitleOverlayForm : Form
{
    readonly WebView2 _web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
    public SubtitleOverlayForm()
    {
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
        BackColor = Color.Black; TransparencyKey = Color.Black; Width = 900; Height = 160; Controls.Add(_web);
        Load += async (_, _) => { await _web.EnsureCoreWebView2Async(); _web.NavigateToString(File.ReadAllText(Path.Combine(PortablePaths.AssetsDir, "subtitle.html"))); };
    }

    public async Task SetTextAsync(string current, string previous = "", IEnumerable<string>? keywords = null)
    {
        if (_web.CoreWebView2 == null) return;
        var payload = JsonSerializer.Serialize(new { current, previous, keywords = keywords?.ToArray() ?? [] });
        await _web.CoreWebView2.ExecuteScriptAsync($"window.LocalSub.setSubtitle({payload});");
    }

    protected override bool ShowWithoutActivation => true;
}
