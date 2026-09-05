namespace DavBridge;
internal sealed partial class UiRouteOverallV0215
{
    private void ReplaceOverall()
    {
        var bar=Field<GradientMeterBar>("_overallBar");
        if(bar==null)return;
        Clear(bar);
        SetOverallColors(bar);
    }
}
