using System.Reflection;
using System.Text.Json;
using DavBridge.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DavBridge;

internal static class WebUiAssetsV040
{
    private const string Prefix = "DavBridge.WebUi.";
    internal static void ValidateEmbeddedResources()
    {
        var names = Assembly.GetExecutingAssembly().GetManifestResourceNames();
        if (!names.Contains(Prefix + "index.html", StringComparer.Ordinal)) throw new InvalidOperationException("DavBridge Web UI index.html is not embedded. Build WebUi before dotnet publish.");
        if (!names.Any(name => name.StartsWith(Prefix + "assets.", StringComparison.Ordinal))) throw new InvalidOperationException("DavBridge Web UI assets are not embedded. Build WebUi before dotnet publish.");
    }
    internal static string Extract(string localRoot)
    {
        ValidateEmbeddedResources();
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
        var root = Path.Combine(localRoot, "WebUi", version);
        Directory.CreateDirectory(root); Directory.CreateDirectory(Path.Combine(root, "assets"));
        var assembly = Assembly.GetExecutingAssembly();
        foreach (var resource in assembly.GetManifestResourceNames().Where(name => name.StartsWith(Prefix, StringComparison.Ordinal)))
        {
            string relative;
            if (resource == Prefix + "index.html") relative = "index.html";
            else if (resource.StartsWith(Prefix + "assets.", StringComparison.Ordinal)) relative = Path.Combine("assets", resource[(Prefix + "assets.").Length..]);
            else continue;
            var destination = Path.Combine(root, relative);
            using var input = assembly.GetManifestResourceStream(resource) ?? throw new InvalidOperationException($"Missing embedded UI resource: {resource}");
            using var output = new FileStream(destination, FileMode.Create, FileAccess.Write, FileShare.Read);
            input.CopyTo(output);
        }
        return root;
    }
}

internal sealed class WebUiHostV040 : IDisposable
{
    private const string Origin = "https://davbridge.local";
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static readonly HashSet<string> AllowedMethods = new(StringComparer.Ordinal) { "app.getSnapshot", "app.openSettings", "migration.pause", "migration.resume", "recycle.defer", "recycle.delete" };
    private readonly MainForm _form; private readonly AppHost _host; private readonly ReconciliationRuntimeV030 _reconciliation;
    private readonly Panel _surface = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly Label _loading = new() { Dock = DockStyle.Fill, Text = "DavBridge 正在加载界面…", TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.FromArgb(102,116,124), Font = new Font("Segoe UI",10F) };
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill, BackColor = Color.White };
    private readonly System.Windows.Forms.Timer _pushTimer = new() { Interval = 500 };
    private readonly CancellationTokenSource _cts = new();
    private EngineProgress? _lastProgress; private WebDavIoProgress? _lastIo; private bool _webReady; private bool _disposed;
    private WebUiHostV040(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation) { _form=form; _host=host; _reconciliation=reconciliation; Mount(); Wire(); _=InitializeWebViewAsync(); }
    internal static WebUiHostV040 Attach(MainForm form, AppHost host, ReconciliationRuntimeV030 reconciliation) => new(form,host,reconciliation);
    internal static void ValidateBridgeContract() { var expected=new[]{"app.getSnapshot","app.openSettings","migration.pause","migration.resume","recycle.defer","recycle.delete"}; if(!expected.All(AllowedMethods.Contains)||AllowedMethods.Count!=expected.Length) throw new InvalidOperationException("DavBridge Web UI command whitelist changed unexpectedly."); }
    private void Mount() { foreach(Control control in _form.Controls) control.Visible=false; _surface.Controls.Add(_loading); _surface.Controls.Add(_webView); _webView.Visible=false; _form.Controls.Add(_surface); _surface.BringToFront(); }
    private void Wire() { _host.ProgressChanged+=OnProgress; _host.StateChanged+=OnStateChanged; _reconciliation.Changed+=OnReconciliationChanged; WebDavReadClient.GlobalIoProgress+=OnIo; _pushTimer.Tick+=(_,_)=>PushSnapshot(); _pushTimer.Start(); }
    private async Task InitializeWebViewAsync()
    {
        try
        {
            var assetsRoot=WebUiAssetsV040.Extract(_host.Paths.LocalRoot); var userData=Path.Combine(_host.Paths.LocalRoot,"WebView2"); Directory.CreateDirectory(userData);
            var environment=await CoreWebView2Environment.CreateAsync(userDataFolder:userData); await _webView.EnsureCoreWebView2Async(environment); var core=_webView.CoreWebView2;
            core.Settings.AreDevToolsEnabled=false; core.Settings.AreDefaultContextMenusEnabled=false; core.Settings.IsStatusBarEnabled=false; core.Settings.IsZoomControlEnabled=false; core.Settings.IsWebMessageEnabled=true;
            core.SetVirtualHostNameToFolderMapping("davbridge.local",assetsRoot,CoreWebView2HostResourceAccessKind.DenyCors); core.WebMessageReceived+=OnWebMessageReceived;
            core.NavigationStarting+=(_,args)=>{ if(!args.Uri.StartsWith(Origin+"/",StringComparison.OrdinalIgnoreCase)) args.Cancel=true; }; core.NewWindowRequested+=(_,args)=>args.Handled=true; core.PermissionRequested+=(_,args)=>args.State=CoreWebView2PermissionState.Deny;
            core.NavigationCompleted+=(_,args)=>{ if(!args.IsSuccess)return; _webReady=true; _loading.Visible=false; _webView.Visible=true; _webView.BringToFront(); PushSnapshot(); }; core.Navigate(Origin+"/index.html");
        }
        catch(Exception ex){ SafeUi(()=>{ _loading.Text="DavBridge 新界面无法启动\r\n\r\n"+ex.Message+"\r\n\r\n请确认 Microsoft Edge WebView2 Runtime 已安装。"; _loading.ForeColor=Color.FromArgb(151,67,62); }); }
    }
    internal void ShowOverview(){ if(_webReady&&_webView.CoreWebView2 is not null) PostEvent("navigate","overview"); }
    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        BridgeRequest? request=null;
        try
        {
            request=JsonSerializer.Deserialize<BridgeRequest>(args.WebMessageAsJson,JsonOptions); if(request is null||string.IsNullOrWhiteSpace(request.Id)||!AllowedMethods.Contains(request.Method??string.Empty)) throw new InvalidOperationException("不允许的界面命令。");
            object? result=request.Method switch { "app.getSnapshot"=>BuildSnapshot(), "app.openSettings"=>await OpenSettingsAsync(), "migration.pause"=>await InvokeMainTaskAsync("PauseAsync","已暂停"), "migration.resume"=>await InvokeMainTaskAsync("ResumeNowAsync","已提交继续请求"), "recycle.defer"=>await DeferAsync(ReadGroupKeys(request.Params)), "recycle.delete"=>await DeleteAsync(ReadGroupKeys(request.Params)), _=>throw new InvalidOperationException("不允许的界面命令。") };
            Reply(request.Id,true,result,null);
        }
        catch(Exception ex){ Reply(request?.Id??string.Empty,false,null,ex is TargetInvocationException tie?tie.InnerException?.Message??tie.Message:ex.Message); }
    }
    private async Task<object> OpenSettingsAsync(){ await InvokeMainFormTaskAsync("EditSettingsAsync"); return new { snapshot=BuildSnapshot() }; }
    private async Task<object> InvokeMainTaskAsync(string method,string message){ await InvokeMainFormTaskAsync(method); return new { message,snapshot=BuildSnapshot() }; }
    private async Task InvokeMainFormTaskAsync(string methodName){ var method=typeof(MainForm).GetMethod(methodName,BindingFlags.Instance|BindingFlags.NonPublic)??throw new InvalidOperationException($"DavBridge native host could not resolve {methodName}."); if(method.Invoke(_form,null) is Task task) await task.ConfigureAwait(true); }
    private async Task<object> DeferAsync(IReadOnlyList<string> keys){ if(keys.Count==0) throw new InvalidOperationException("请先选择待审查附件组。"); await _reconciliation.DeferGroupsAsync(keys,_cts.Token).ConfigureAwait(true); await ContinueAfterReviewAsync().ConfigureAwait(true); return new { message=$"本周期继续保留 {keys.Count} 个附件组。",snapshot=BuildSnapshot() }; }
    private async Task<object> DeleteAsync(IReadOnlyList<string> keys)
    {
        if(keys.Count==0) throw new InvalidOperationException("请先选择待审查附件组。"); var preview=string.Join(Environment.NewLine,keys.Take(10).Select(key=>"  "+key)); if(keys.Count>10) preview+=Environment.NewLine+$"  另有 {keys.Count-10} 组";
        var confirm=MessageBox.Show(_form,$"这是 DavBridge 的最终原生删除确认。\n\n准备审查删除 {keys.Count} 个附件组：\n{preview}\n\n确认后 C# 安全链仍会重新检查 InfiniCLOUD 是否缺失、Zotero 组是否完整、坚果云目标是否仍是历史 StrongVerified 对象。任何异常都会停止删除。\n\n确认继续吗？","最终确认删除",MessageBoxButtons.YesNo,MessageBoxIcon.Warning,MessageBoxDefaultButton.Button2);
        if(confirm!=DialogResult.Yes) return new { message="已取消删除。",snapshot=BuildSnapshot() };
        var results=await _reconciliation.DeleteGroupsAsync(keys,_cts.Token).ConfigureAwait(true); var removed=results.Count(x=>x.Removed); var recovered=results.Count(x=>x.Recovered); var blocked=results.Count(x=>x.Blocked); await ContinueAfterReviewAsync().ConfigureAwait(true);
        return new { message=$"删除审查完成：已删除 {removed}，源端恢复 {recovered}，安全阻止 {blocked}。",snapshot=BuildSnapshot() };
    }
    private async Task ContinueAfterReviewAsync(){ if(_reconciliation.GetHumanActionCount()>0||!_host.Config.MigrationEnabled||_host.IsRunning)return; try{ await _host.RunOnceAsync(_cts.Token).ConfigureAwait(true); }catch{} }
    private static IReadOnlyList<string> ReadGroupKeys(JsonElement? element){ if(!element.HasValue||element.Value.ValueKind!=JsonValueKind.Object||!element.Value.TryGetProperty("groupKeys",out var keys)||keys.ValueKind!=JsonValueKind.Array)return Array.Empty<string>(); return keys.EnumerateArray().Where(i=>i.ValueKind==JsonValueKind.String).Select(i=>i.GetString()).Where(v=>!string.IsNullOrWhiteSpace(v)).Cast<string>().Distinct(StringComparer.OrdinalIgnoreCase).Take(200).ToArray(); }
    private WebSnapshot BuildSnapshot()
    {
        var cycle=_reconciliation.CurrentCycleId??string.Empty; var review=_reconciliation.GetHumanActionCount(); var priority=PriorityGroupCount(); var verified=_host.State.Files.Values.Count(r=>r.Status==TransferStatus.StrongVerified); var total=Math.Max(_reconciliation.State.LastManifestObjectCount,_host.State.Files.Count); var coverage=total<=0?0:Math.Clamp((double)verified/total,0,1); var state=!_host.Config.MigrationEnabled?EngineState.Paused:_host.State.EngineState; var quota=QuotaPolicy.GetSnapshot(_host.Config,_host.State,DateTimeOffset.Now); var current=CurrentTask(state); var auditDone=!string.IsNullOrWhiteSpace(cycle)&&string.Equals(_reconciliation.State.LastReconciledCycleId,cycle,StringComparison.OrdinalIgnoreCase);
        var phases=new[]{ new PhaseDto("audit",_reconciliation.IsAuditing?"源端对账中":auditDone?"源端对账":"等待对账",_reconciliation.IsAuditing?"active":auditDone?"done":"waiting","新 Cycle 先核对 InfiniCLOUD 当前清单与历史账本。"), new PhaseDto("repair",priority>0?$"变化修复 {priority:N0}":"变化修复",priority>0?"active":"done","确认发生内容变化的历史 StrongVerified 组优先修复。"), new PhaseDto("migration",review>0?$"待审查 {review:N0}":state==EngineState.WaitQuota?"等待周期":"普通迁移",review>0?"warning":state==EngineState.Running?"active":"waiting","新增对象与既有 backlog 同级进入普通稳定池。") };
        var(routeStatus,tone)=DescribeRoute(state,review); var(primary,primaryLabel)=DescribePrimary(state,review); var resetText=_host.Config.NextResetAt==default?"流量尚未校准":$"{ResetSchedulePolicy.NormalizeResetDate(_host.Config.NextResetAt):yyyy-MM-dd} · 09:00 后探测";
        return new WebSnapshot(Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)??"0.4.0",cycle,_host.IsConfigured,StateText(state),routeStatus,tone,phases,verified,total,coverage,total>0?$"{verified:N0} / {total:N0} 已核准":$"{verified:N0} 已核准",current.Title,current.Detail,current.Progress,new QuotaDto(quota.EstimatedUploadUsedBytes,Math.Max(1,_host.Config.UploadQuotaBytes),$"{FormatBytes(quota.EstimatedUploadUsedBytes)} / {FormatBytes(Math.Max(1,_host.Config.UploadQuotaBytes))}",quota.EstimatedDownloadUsedBytes,Math.Max(1,_host.Config.DownloadQuotaBytes),$"{FormatBytes(quota.EstimatedDownloadUsedBytes)} / {FormatBytes(Math.Max(1,_host.Config.DownloadQuotaBytes))}",resetText,quota.IsSprint),priority,NormalBacklogCount(),review,primary,primaryLabel,BuildRecycleGroups());
    }
    private (string Title,string Detail,double? Progress) CurrentTask(EngineState state){ var relative=_lastProgress?.RelativePath; if(!string.IsNullOrWhiteSpace(relative)){ double? fraction=null; if(_lastIo is not null&&PathMatches(_lastIo.RelativePath,relative)&&_lastIo.TotalBytes is >0) fraction=Math.Clamp((double)_lastIo.BytesProcessed/_lastIo.TotalBytes.Value,0,1); return(Path.GetFileName(relative),HumanizeProgress(_lastProgress?.Message),fraction); } if(_reconciliation.IsAuditing)return("源端对账","正在读取 InfiniCLOUD manifest 并核对历史 StrongVerified 账本",null); return state switch{ EngineState.WaitUser=>("等待人工审查","回收站存在需要明确决定的附件组",null),EngineState.WaitQuota=>("等待下一周期","坚果云当前安全额度不足，账本与断点已经保存",null),EngineState.WaitNetwork=>("等待网络","连接条件恢复后任务可以继续",null),EngineState.WaitRetry=>("需要处理",_lastProgress?.Message??"任务已经安全停止，请检查具体原因",null),EngineState.Complete=>("当前清单完成","当前源清单已经完成强校验",null),EngineState.Paused=>("已暂停","进度和流量账本已经保存",null),EngineState.Running=>("准备任务",_lastProgress?.Message??"正在调度下一安全任务",null),_=>("准备中","正在初始化 DavBridge",null)}; }
    private IReadOnlyList<RecycleDto> BuildRecycleGroups()=>_reconciliation.GetRecycleGroups().Select(group=>{ var records=_host.State.Files.Values.Where(r=>string.Equals(r.GroupKey,group.GroupKey,StringComparison.OrdinalIgnoreCase)).ToArray(); var size=records.Sum(r=>Math.Max(0,r.SourceSize)); var verified=records.Where(r=>r.VerifiedAt.HasValue).Select(r=>r.VerifiedAt!.Value).DefaultIfEmpty().Max(); var disposition=ReconciliationPolicy.GetDisposition(group,_reconciliation.CurrentCycleId); var(kind,state)=disposition switch{RecycleDisposition.Observing=>("observing","首次观察"),RecycleDisposition.ReviewRequired=>("review","等待人工审查"),RecycleDisposition.Blocked=>("blocked","安全阻止"),RecycleDisposition.DeferredThisCycle=>("history","本周期保留"),RecycleDisposition.Removed=>("history","已人工删除"),_=>("history","活动")}; return new RecycleDto(group.GroupKey,Path.GetFileName(group.GroupKey.TrimEnd('/','\\')),group.FirstMissingCycleId??string.Empty,string.IsNullOrWhiteSpace(group.LastDeferredCycleId)?string.Empty:$"保留 {group.LastDeferredCycleId}",FormatBytes(size),verified==default?string.Empty:verified.ToLocalTime().ToString("yyyy-MM-dd"),state,kind,group.LastIssue); }).ToArray();
    private int PriorityGroupCount()=>_host.State.Files.Values.Where(r=>r.Status==TransferStatus.SourceChanged).Select(r=>r.GroupKey).Where(k=>!string.IsNullOrWhiteSpace(k)).Distinct(StringComparer.OrdinalIgnoreCase).Count();
    private int NormalBacklogCount(){ var stateGroups=_host.State.Files.Values.GroupBy(r=>r.GroupKey,StringComparer.OrdinalIgnoreCase).Count(g=>!string.IsNullOrWhiteSpace(g.Key)&&g.Any(r=>r.Status!=TransferStatus.StrongVerified&&r.Status!=TransferStatus.SourceChanged)); return Math.Max(0,stateGroups+_reconciliation.State.LastNewGroupCount); }
    private static (string Status,string Tone) DescribeRoute(EngineState state,int review)=>review>0?("等待人工审查","warning"):state switch{EngineState.WaitQuota=>("等待下一周期","wait"),EngineState.WaitNetwork=>("等待网络","wait"),EngineState.WaitRetry=>("需要处理","warning"),EngineState.Complete=>("当前清单完成","complete"),EngineState.Running=>("普通迁移中","active"),EngineState.Paused=>("已暂停","idle"),_=>("准备中","idle")};
    private static (string Action,string Label) DescribePrimary(EngineState state,int review){ if(review>0)return("review","审查回收站"); if(state==EngineState.Complete)return("none","已完成"); if(state==EngineState.Paused)return("resume","继续"); return("pause","暂停"); }
    private static string StateText(EngineState state)=>state switch{EngineState.Running=>"运行中",EngineState.Paused=>"已暂停",EngineState.WaitNetwork=>"等待网络",EngineState.WaitQuota=>"等待额度",EngineState.WaitRetry=>"需要处理",EngineState.WaitUser=>"等待人工",EngineState.Complete=>"已完成",_=>"准备中"};
    private static string HumanizeProgress(string? message){ if(string.IsNullOrWhiteSpace(message))return"正在处理"; if(message.Contains("Downloading source",StringComparison.OrdinalIgnoreCase))return"正在读取源文件并计算 SHA-256"; if(message.Contains("Target already exists",StringComparison.OrdinalIgnoreCase))return"正在校验目标端已有副本"; if(message.Contains("Uploading target",StringComparison.OrdinalIgnoreCase))return"正在上传目标文件"; if(message.Contains("Re-downloading target",StringComparison.OrdinalIgnoreCase))return"正在重新读取目标文件并做强校验"; if(message.Contains("strongly verified",StringComparison.OrdinalIgnoreCase))return"目标文件已通过强校验"; return message; }
    private static bool EndpointMatches(string left,string right){ if(!Uri.TryCreate(left,UriKind.Absolute,out var a)||!Uri.TryCreate(right,UriKind.Absolute,out var b))return false; return string.Equals(a.Scheme,b.Scheme,StringComparison.OrdinalIgnoreCase)&&string.Equals(a.Host,b.Host,StringComparison.OrdinalIgnoreCase)&&a.Port==b.Port; }
    private static bool PathMatches(string ioPath,string relative)=>ioPath.Replace('\\','/').Trim('/').EndsWith(relative.Replace('\\','/').Trim('/'),StringComparison.OrdinalIgnoreCase);
    private static string FormatBytes(long bytes){ var value=Math.Max(0,bytes); if(value>=1_000_000_000L)return$"{value/1_000_000_000d:0.00} GB"; if(value>=1_000_000L)return$"{value/1_000_000d:0.0} MB"; if(value>=1_000L)return$"{value/1_000d:0.0} KB"; return$"{value} B"; }
    private void OnProgress(object? sender,EngineProgress progress){_lastProgress=progress;_lastIo=null;PushSnapshot();} private void OnStateChanged(object? sender,EventArgs e)=>PushSnapshot(); private void OnReconciliationChanged(object? sender,EventArgs e)=>PushSnapshot();
    private void OnIo(object? sender,WebDavIoProgress progress){ if(!EndpointMatches(progress.BaseAddress,_host.Config.SourceBaseUrl)&&!EndpointMatches(progress.BaseAddress,_host.Config.TargetBaseUrl))return; _lastIo=progress; }
    private void PushSnapshot(){ if(_disposed||!_webReady||_webView.CoreWebView2 is null)return; SafeUi(()=>PostEvent("snapshot",BuildSnapshot())); }
    private void PostEvent(string eventName,object payload){ if(_webView.CoreWebView2 is null)return; _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{@event=eventName,payload},JsonOptions)); }
    private void Reply(string id,bool ok,object? result,string? error){ if(string.IsNullOrWhiteSpace(id)||_webView.CoreWebView2 is null)return; _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new{id,ok,result,error},JsonOptions)); }
    private void SafeUi(Action action){ if(_disposed||_form.IsDisposed)return; try{if(_form.InvokeRequired)_form.BeginInvoke(action);else action();}catch{} }
    public void Dispose(){ if(_disposed)return;_disposed=true;_pushTimer.Stop();_host.ProgressChanged-=OnProgress;_host.StateChanged-=OnStateChanged;_reconciliation.Changed-=OnReconciliationChanged;WebDavReadClient.GlobalIoProgress-=OnIo;if(_webView.CoreWebView2 is not null)_webView.CoreWebView2.WebMessageReceived-=OnWebMessageReceived;_cts.Cancel();_cts.Dispose();_pushTimer.Dispose();_webView.Dispose();_surface.Dispose(); }
    private sealed record BridgeRequest(string Id,string? Method,JsonElement? Params); private sealed record PhaseDto(string Key,string Label,string State,string Hint); private sealed record QuotaDto(long UploadUsed,long UploadMax,string UploadText,long DownloadUsed,long DownloadMax,string DownloadText,string ResetText,bool IsSprint); private sealed record RecycleDto(string GroupKey,string Name,string FirstMissing,string LastDecision,string SizeText,string VerifiedText,string State,string Disposition,string? Issue); private sealed record WebSnapshot(string Version,string CycleId,bool Configured,string EngineState,string RouteStatus,string RouteTone,IReadOnlyList<PhaseDto> Phases,int Verified,int Total,double Coverage,string CoverageText,string CurrentTitle,string CurrentDetail,double? CurrentProgress,QuotaDto Quota,int PriorityCount,int NormalCount,int HumanActionCount,string PrimaryAction,string PrimaryLabel,IReadOnlyList<RecycleDto> Recycle);
}

internal sealed class WindowHomeControllerV040 : IDisposable, IHomeWindowControllerV037
{
    private readonly MainForm _form; private readonly AppHost _host; private readonly WebUiHostV040 _webUi; private readonly bool _launchInBackground; private readonly object? _previousTag; private bool _seenVisible; private bool _startupHideOverrideConsumed; private bool _disposed;
    private WindowHomeControllerV040(MainForm form,AppHost host,WebUiHostV040 webUi,bool launchInBackground){_form=form;_host=host;_webUi=webUi;_launchInBackground=launchInBackground;_previousTag=form.Tag;form.Tag=this;form.VisibleChanged+=OnVisibleChanged;}
    internal static WindowHomeControllerV040 Attach(MainForm form,AppHost host,WebUiHostV040 webUi,bool launchInBackground)=>new(form,host,webUi,launchInBackground);
    private void OnVisibleChanged(object? sender,EventArgs e){if(_disposed||_form.IsDisposed)return;if(_form.Visible){_seenVisible=true;_webUi.ShowOverview();return;}if(!_launchInBackground&&!_startupHideOverrideConsumed&&_seenVisible&&_host.Config.StartMinimized){_startupHideOverrideConsumed=true;try{_form.BeginInvoke(new Action(ShowHomeAndRestore));}catch{}}}
    public void ShowHomeAndRestore(){if(_disposed||_form.IsDisposed)return;if(_form.WindowState==FormWindowState.Minimized)_form.WindowState=FormWindowState.Normal;if(!_form.Visible)_form.Show();_form.ShowInTaskbar=true;_form.BringToFront();_form.Activate();_webUi.ShowOverview();}
    public void Dispose(){if(_disposed)return;_disposed=true;_form.VisibleChanged-=OnVisibleChanged;if(ReferenceEquals(_form.Tag,this))_form.Tag=_previousTag;}
}
