using System.Reflection;
using System.Text.RegularExpressions;
using DavBridge.Core;

namespace DavBridge;

/// <summary>
/// Gives the otherwise disabled WaitQuota primary action an explicit, user-controlled meaning:
/// run/stop the optional NO-WRITE existing-replica verification sweep.
/// </summary>
internal sealed class UiWaitQuotaMaintenanceActionV0222 : IDisposable
{
    private static readonly Regex ProbeProgress = new(@"(?<done>\d+)\s*/\s*(?<total>\d+)", RegexOptions.Compiled);

    private readonly MainForm _form;
    private readonly UiDashboardV027 _dashboard;
    private readonly AppHost _host;
    private readonly WaitQuotaMaintenanceHostV0222 _maintenance;
    private readonly System.Windows.Forms.Timer _timer = new() { Interval = 80 };
    private readonly TransportActionButtonV027? _primary;
    private readonly GradientMeterBar? _currentBar;
    private readonly StageTrackV026? _stageTrack;
    private PrimaryActionSurfaceV0217? _surface;
    private WebDavIoProgress? _io;
    private DateTimeOffset _ioAt = DateTimeOffset.MinValue;
    private bool _disposed;

    private UiWaitQuotaMaintenanceActionV0222(
        MainForm form,
        UiDashboardV027 dashboard,
        AppHost host,
        WaitQuotaMaintenanceHostV0222 maintenance)
    {
        _form = form;
        _dashboard = dashboard;
        _host = host;
        _maintenance = maintenance;
        _primary = Field<TransportActionButtonV027>("_primary");
        _currentBar = Field<GradientMeterBar>("_currentBar");
        _stageTrack = Field<StageTrackV026>("_stageTrack");

        if (_primary is not null)
            _primary.Click += OnPrimaryClick;
        WebDavReadClient.GlobalIoProgress += OnIoProgress;
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
        Tick();
    }

    public static UiWaitQuotaMaintenanceActionV0222 Attach(
        MainForm form,
        UiDashboardV027 dashboard,
        AppHost host,
        WaitQuotaMaintenanceHostV0222 maintenance) =>
        new(form, dashboard, host, maintenance);

    private T? Field<T>(string name) where T : class
    {
        try { return typeof(UiDashboardV027).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(_dashboard) as T; }
        catch { return null; }
    }

    private void OnPrimaryClick(object? sender, EventArgs e)
    {
        if (_disposed || _host.State.EngineState != EngineState.WaitQuota)
            return;

        if (_maintenance.IsRunning)
            _maintenance.StopManual();
        else if (_maintenance.CanStart)
            _maintenance.StartManual();

        Tick();
    }

    private void Tick()
    {
        if (_disposed || _form.IsDisposed || _primary is null)
            return;
        if (_host.State.EngineState != EngineState.WaitQuota || !_host.Config.MigrationEnabled)
            return;

        var running = _maintenance.IsRunning;
        var quota = QuotaPolicy.GetSnapshot(_host.Config, _host.State, DateTimeOffset.Now);
        if (running)
        {
            _primary.Enabled = true;
            _primary.SetAction(TransportActionKindV027.Pause, "停止校验");
        }
        else if (_maintenance.CanStart && quota.SafeDownloadRemainingBytes > 0)
        {
            _primary.Enabled = true;
            _primary.SetAction(TransportActionKindV027.Play, "校验已有副本");
        }
        else
        {
            _primary.Enabled = false;
            _primary.SetAction(TransportActionKindV027.None, "等待新周期");
        }

        _surface ??= Descendants(_form).OfType<PrimaryActionSurfaceV0217>().FirstOrDefault();
        _surface?.SyncFromSource();
        UpdateCurrent(running);
    }

    private void UpdateCurrent(bool running)
    {
        if (_currentBar is null || _stageTrack is null)
            return;

        var activity = WaitQuotaMaintenanceActivity.Current;
        if (!running)
        {
            if (activity is not null && DateTimeOffset.Now - activity.UpdatedAt < TimeSpan.FromSeconds(10))
            {
                _stageTrack.ActiveIndex = -1;
                _currentBar.Pulse = false;
                _currentBar.Fraction = 0;
                _currentBar.BarText = activity.Progress.Message.Contains("结束", StringComparison.Ordinal)
                    ? "既有副本校验已结束"
                    : "等待下一周期";
            }
            return;
        }

        if (activity is null)
        {
            _stageTrack.ActiveIndex = 0;
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            _currentBar.BarText = "准备既有副本校验";
            return;
        }

        var progress = activity.Progress;
        var message = progress.Message ?? string.Empty;
        if (string.IsNullOrWhiteSpace(progress.RelativePath))
        {
            _stageTrack.ActiveIndex = 0;
            _currentBar.Fraction = 0;
            _currentBar.Pulse = true;
            var match = ProbeProgress.Match(message);
            _currentBar.BarText = match.Success
                ? $"探测已有副本  {match.Groups["done"].Value} / {match.Groups["total"].Value}"
                : "扫描未验证附件";
            return;
        }

        var fileName = Path.GetFileName(progress.RelativePath);
        _stageTrack.ActiveIndex = message.Contains("坚果云已有副本", StringComparison.Ordinal) ? 2 : 1;
        var io = _io;
        var ioMatches = io is not null && RelativeFileMatches(io.RelativePath, progress.RelativePath);
        var hasTotal = ioMatches && io!.TotalBytes.HasValue && io.TotalBytes.Value > 0;
        if (hasTotal)
        {
            var fraction = Math.Clamp((double)io!.BytesProcessed / io.TotalBytes!.Value, 0, 1);
            _currentBar.Pulse = false;
            _currentBar.Fraction = fraction;
            _currentBar.BarText = $"{fileName}    {fraction:P0}";
        }
        else
        {
            _currentBar.Fraction = 0;
            _currentBar.Pulse = DateTimeOffset.Now - _ioAt > TimeSpan.FromMilliseconds(500);
            _currentBar.BarText = fileName;
        }
    }

    private void OnIoProgress(object? sender, WebDavIoProgress progress)
    {
        if (!MatchesConfiguredEndpoint(progress.BaseAddress))
            return;
        _io = progress;
        _ioAt = DateTimeOffset.Now;
    }

    private bool MatchesConfiguredEndpoint(string baseAddress) =>
        SameEndpoint(baseAddress, _host.Config.SourceBaseUrl) ||
        SameEndpoint(baseAddress, _host.Config.TargetBaseUrl);

    private static bool SameEndpoint(string left, string right)
    {
        if (!Uri.TryCreate(left, UriKind.Absolute, out var a) || !Uri.TryCreate(right, UriKind.Absolute, out var b))
            return false;
        return string.Equals(a.Scheme, b.Scheme, StringComparison.OrdinalIgnoreCase) &&
               string.Equals(a.Host, b.Host, StringComparison.OrdinalIgnoreCase) &&
               a.Port == b.Port &&
               a.AbsolutePath.Trim('/').Equals(b.AbsolutePath.Trim('/'), StringComparison.OrdinalIgnoreCase);
    }

    private static bool RelativeFileMatches(string ioPath, string progressPath)
    {
        var a = ioPath.Replace('\\', '/').Trim('/');
        var b = progressPath.Replace('\\', '/').Trim('/');
        return a.EndsWith("/" + b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(a, b, StringComparison.OrdinalIgnoreCase) ||
               string.Equals(Path.GetFileName(a), Path.GetFileName(b), StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<Control> Descendants(Control root)
    {
        foreach (Control child in root.Controls)
        {
            yield return child;
            foreach (var nested in Descendants(child))
                yield return nested;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _timer.Stop();
        _timer.Dispose();
        if (_primary is not null)
            _primary.Click -= OnPrimaryClick;
        WebDavReadClient.GlobalIoProgress -= OnIoProgress;
    }
}
