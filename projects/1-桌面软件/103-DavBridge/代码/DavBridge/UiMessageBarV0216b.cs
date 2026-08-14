namespace DavBridge;

internal sealed partial class UiMessageBarV0216
{
    private void RefreshUi()
    {
        if (_disposed || _form.IsDisposed) return;
        var countdown = ResetCountdown();
        var state = _host.State.EngineState;
        var text = BuildMessage(countdown);
        var level = LevelFor(state);
        var priority = PriorityFor(state);
        var now = DateTimeOffset.Now;

        var stateChanged = _messageState != state;
        var sameMessage = string.Equals(_surface.Message, text, StringComparison.Ordinal);
        if (stateChanged || sameMessage || now >= _priorityUntil || priority >= _activePriority)
        {
            _surface.Message = text;
            _surface.Level = level;
            _messageState = state;
            _activePriority = priority;
            _priorityUntil = now + HoldFor(state);
            _surface.Invalidate();
        }

        if (Field<Label>("_resetValue") is { } reset && _host.Config.NextResetAt != default)
        {
            var shortCountdown = countdown switch
            {
                "今天 09:00 后自动探测" => "今天 09:00 后探测",
                "明天进入新周期" => "还剩 1 天",
                _ when countdown.StartsWith("距新周期还有 ", StringComparison.Ordinal) => countdown.Replace("距新周期还有 ", "还剩 "),
                _ => countdown
            };
            reset.Text = $"{_host.Config.NextResetAt:yyyy-MM-dd} 重置 · {shortCountdown} · 09:00 后探测";
        }
    }

    private static MessageLevel LevelFor(EngineState state) => state switch
    {
        EngineState.WaitQuota or EngineState.WaitNetwork => MessageLevel.Warning,
        EngineState.WaitRetry => MessageLevel.Error,
        EngineState.Complete => MessageLevel.Success,
        _ => MessageLevel.Normal
    };

    private static int PriorityFor(EngineState state) => state switch
    {
        EngineState.WaitRetry => 500,
        EngineState.WaitQuota => 400,
        EngineState.WaitNetwork => 350,
        EngineState.Paused => 250,
        EngineState.Complete => 220,
        EngineState.Running => 150,
        _ => 100
    };

    private static TimeSpan HoldFor(EngineState state) => state switch
    {
        EngineState.WaitRetry => TimeSpan.FromSeconds(8),
        EngineState.WaitQuota or EngineState.WaitNetwork => TimeSpan.FromSeconds(6),
        EngineState.Paused or EngineState.Complete => TimeSpan.FromSeconds(4),
        _ => TimeSpan.FromSeconds(2)
    };

    private string BuildMessage(string countdown)
    {
        return _host.State.EngineState switch
        {
            EngineState.WaitQuota => BuildQuotaMessage(countdown),
            EngineState.WaitNetwork => "网络暂不可用，DavBridge 将保持断点并在网络恢复后自动继续。",
            EngineState.WaitRetry => "任务需要处理，请打开“安全与维护”查看诊断信息。",
            EngineState.Complete => "当前源清单已完成，已通过强校验的记录保持不变。",
            EngineState.Running => "正在迁移。每个文件写入目标后都会回读并执行 SHA-256 强校验。",
            EngineState.Paused => "任务已暂停，迁移断点、流量账本和强校验记录均已保存。",
            _ => "DavBridge 已就绪。"
        };
    }

    private string BuildQuotaMessage(string countdown)
    {
        var message = _lastProgress?.Message ?? string.Empty;
        if (TryParseBudget(message, out var need, out var remaining))
            return $"本周期安全上传预算不足：当前组还需 {FormatMb(need)}，可用 {FormatMb(remaining)}，已等待新周期。{countdown}。";
        return $"本周期安全上传预算不足，当前组已安全保留到下一周期继续。{countdown}。";
    }

    private static bool TryParseBudget(string text, out long need, out long remaining)
    {
        need = 0;
        remaining = 0;
        const string needsToken = "needs ";
        const string remainingToken = "remaining=";
        var n = text.IndexOf(needsToken, StringComparison.OrdinalIgnoreCase);
        var r = text.IndexOf(remainingToken, StringComparison.OrdinalIgnoreCase);
        if (n < 0 || r < 0) return false;
        n += needsToken.Length;
        var nEnd = text.IndexOf(' ', n);
        if (nEnd < 0) nEnd = text.Length;
        r += remainingToken.Length;
        var rEnd = text.IndexOfAny(new[] { ' ', '.', ';' }, r);
        if (rEnd < 0) rEnd = text.Length;
        return long.TryParse(text[n..nEnd], out need) && long.TryParse(text[r..rEnd], out remaining);
    }

    private string ResetCountdown()
    {
        if (_host.Config.NextResetAt == default) return "等待下一周期";
        var days = (_host.Config.NextResetAt.Date - DateTimeOffset.Now.Date).Days;
        if (days <= 0) return "今天 09:00 后自动探测";
        if (days == 1) return "明天进入新周期";
        return $"距新周期还有 {days} 天";
    }

    private static string FormatMb(long bytes) => $"{bytes / 1_000_000d:0.00} MB";
}
