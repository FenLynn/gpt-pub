namespace DavBridge;

internal sealed partial class UiInteractionCleanV0215
{
    private async Task CalibrateAsync()
    {
        if (_disposed || _form.IsDisposed) return;
        if (_host.Config.MigrationEnabled || _host.IsRunning)
        {
            if (MessageBox.Show(_form, "校准流量需要先安全暂停当前迁移。是否现在暂停并打开流量校准？", "校准流量", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            var pause = UiCommandBridge.InvokeTask(_form, "PauseAsync");
            if (pause is not null) await pause.ConfigureAwait(true);
            var started = DateTime.UtcNow;
            while (_host.IsRunning && DateTime.UtcNow - started < TimeSpan.FromSeconds(10)) await Task.Delay(80).ConfigureAwait(true);
            if (_host.IsRunning) { MessageBox.Show(_form, "任务仍在完成安全暂停，请稍后再校准。", "校准流量"); return; }
        }
        var task = UiCommandBridge.InvokeTask(_form, "CalibrateAsync");
        if (task is not null) await task.ConfigureAwait(true);
    }
}
