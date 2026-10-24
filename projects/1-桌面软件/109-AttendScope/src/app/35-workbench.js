/* P109 right-hand analysis: filter-aware charting, compact insight and linked raw evidence. */
let rawTabulator=null,rawDialog=null,rawDialogOrigin=null,rawMove=null,pendingRawHighlight=null;
const CHART_TABS=[['overview','总览'],['timeline','时间轴'],['stats','统计'],['issues','异常']];
const FILTER_LABELS={main:'常规',normal:'正常',anomaly:'异常',absent:'缺勤',lateEarly:'迟到早退',trip:'出差',leave:'请假',outing:'外出',overtime:'加班',tempOuting:'临时外出'};
const JUDGMENT_LABELS={normal:'正常',anomaly:'异常',absent:'缺勤',rest:'休息'};
function safeTableText(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function insightMetric(label,value,tone=''){return '<div class="insight-row"><span>'+label+'</span><strong class="'+tone+'">'+safeTableText(value)+'</strong></div>'}
function currentFilterLabel(){return FILTER_LABELS[state.filter]||'常规'}
function behaviorFilterActive(){return ['trip','leave','outing','overtime','tempOuting'].includes(state.filter)}
function analysisViewItems(ctx){
  const items=ctx.items||[],filter=state.filter||'main';
  if(filter==='main')return items.filter(a=>['normal','anomaly','absent'].includes(attendanceJudgment(a)));
  if(['normal','anomaly','absent'].includes(filter))return items.filter(a=>attendanceJudgment(a)===filter);
  if(filter==='lateEarly')return items.filter(attendanceHasLateEarly);
  if(['trip','leave','outing','overtime','tempOuting'].includes(filter))return items.filter(a=>attendanceBehaviors(a).includes(filter));
  return items;
}
function plotAnalysis(ctx){
  if(ctx.type==='cell')return ctx.analysis;
  if(ctx.type==='person'){
    const d=Math.min(monthDays(),Math.max(1,state.chartDay||nearestRecordedDay(ctx.employee.id)));
    return state.analysis.get(ctx.employee.id+'|'+d);
  }
  return null;
}
function plotTitle(ctx){
  const tab=state.chartTab||'overview';
  if(tab==='stats')return currentFilterLabel()+'统计';
  if(tab==='issues')return currentFilterLabel()+'异常';
  if(tab==='timeline')return '时间轴';
  return currentFilterLabel()+(ctx.type==='person'||ctx.type==='cell'?'每日分布':ctx.type==='date'?'当日分布':'趋势');
}
function p109TimelineZoomHtml(){return '<button type="button" class="p109-timeline-zoom zoom-in" id="p109TimelineZoomIn" aria-label="放大时间轴" title="放大时间轴，可至10秒跨度">+</button><button type="button" class="p109-timeline-zoom zoom-out" id="p109TimelineZoomOut" aria-label="缩小时间轴" title="缩小时间轴">−</button>'}
function manualJudgmentHtml(item,explanation=''){
  const initial=attendanceJudgmentSystem(item),manual=manualStatusFor(item),effective=attendanceJudgmentSystem({...item,initialSeverity:item.severity,initialStatus:item.status});
  return '<section class="insight-card status-card">'+
    '<div class="status-control-row initial-row"><span>初始</span>'+
      '<button type="button" class="initial-judgment '+initial+'" data-manual-clear title="'+safeTableText('恢复初始判断'+(explanation?'；'+explanation:''))+'">'+JUDGMENT_LABELS[initial]+'</button>'+
    '</div>'+
    '<div class="status-control-row manual-row"><span>人工</span>'+
      '<div class="manual-status-buttons" role="radiogroup" aria-label="人工判定">'+
        [['normal','正常'],['anomaly','异常'],['absent','缺勤']].map(([x,t])=>{
          const locked=x===effective&&!manual;
          const label=state.workspaceMode==='classic'?(manual===x?t:''):t;
          return '<button type="button" role="radio" aria-label="'+t+'" aria-checked="'+(manual===x?'true':'false')+'" data-manual-status="'+x+'" class="'+(manual===x?'active ':'')+(locked?'initial-disabled ':'')+x+'" '+(locked?'disabled aria-disabled="true"':'')+' title="'+(locked?'与当前自动判断相同，无需人工修改':'人工改为'+t)+'">'+label+'</button>';
        }).join('')+
      '</div>'+
    '</div>'+
  '</section>';
}
function setManualStatusForCurrent(status){
  const sel=state.selection;
  const employeeId=sel.type==='cell'||sel.type==='person'?sel.employeeId:null;
  const day=sel.type==='cell'?sel.day:sel.type==='person'?(state.chartDay||nearestRecordedDay(sel.employeeId)):null;
  if(!employeeId||!day)return;
  const key=employeeId+'|'+day,item=state.analysis.get(key);state.manualStatuses??={};
  if(status&&item&&!manualStatusFor(item)&&status===attendanceJudgmentSystem({...item,initialSeverity:item.severity,initialStatus:item.status}))return;
  const before=manualStatusFor(item),system=attendanceJudgmentSystem(item);
  const restoreFlags=!status&&(item.attendanceFlags||[]).some(flag=>!flag.accepted);
  if(before===status&&!restoreFlags)return;
  if(restoreFlags)for(const flag of item.attendanceFlags||[])delete state.attendanceReview[flag.id];
  if(status)state.manualStatuses[key]=status;else delete state.manualStatuses[key];
  state.revisions.push({id:'R'+(++state.revisionSeq),key,action:'manual-status',
    from:before||system,to:status||system,time:new Date().toISOString(),note:'人工判定变更'});
  if(status)state.judgmentMode='manual';else if(!hasManualStatuses())state.judgmentMode='initial';
  state.saved=false;rememberMonth();reanalyze();render();
}
function employeeAutoOvertimeDays(employeeId){
 return Array.from({length:monthDays()},(_,i)=>state.analysis.get(employeeId+'|'+(i+1)))
  .filter(a=>a?.autoOvertime?.segments?.length).map(a=>a.day);
}
function timelineLegendHtml(item){
  const judgment=attendanceJudgment(item);
  return '<div class="timeline-top-legend">'+
    (isWorkday(item.day)?'<span class="legend-schedule"><i></i>工作时段</span>':'')+
    '<span class="legend-event in"><i></i>进</span><span class="legend-event out"><i></i>出</span>'+
    '<span class="legend-band judgment '+judgment+'"><i></i>'+JUDGMENT_LABELS[judgment]+'</span>'+
  '</div>';
}
function timelineHeaderToolsHtml(ctx){
  if((state.chartTab||'overview')!=='timeline')return '';
  const day=plotAnalysis(ctx);if(!day)return '';
  // R41 personal date navigation lives alongside the full-month strip in the only title row.
  if(state.workspaceMode==='person')return '<div class="analysis-head-timeline-tools">'+timelineLegendHtml(day)+'</div>';
  const switcher='<button id="personalDayPrev" type="button" aria-label="上一天" '+(day.day<=1?'disabled':'')+'>‹</button><select id="timelineDayPicker" aria-label="时间轴日期">'+
    Array.from({length:monthDays()},(_,i)=>'<option value="'+(i+1)+'" '+(day.day===i+1?'selected':'')+'>'+pad(i+1)+' 日</option>').join('')+
  '</select><button id="personalDayNext" type="button" aria-label="下一天" '+(day.day>=monthDays()?'disabled':'')+'>›</button>';
  return '<div class="analysis-head-timeline-tools">'+timelineLegendHtml(day)+switcher+'</div>';
}
function attendPlotHtml(ctx){
  const tab=state.chartTab||'overview',day=plotAnalysis(ctx);
  const heading=state.workspaceMode==='person'||(tab==='timeline'&&day)?'':'<div class="plot-heading"><strong>'+plotTitle(ctx)+'</strong></div>';
  const top='<div class="chart-mode-tabs">'+CHART_TABS.map(([id,label])=>
    '<button data-chart-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+label+'</button>').join('')+'</div>'+heading;
  if(tab==='issues')return top+'<div id="issueChart" class="plot-chart"></div>';
  if(tab==='stats')return top+'<div class="plot-chart plot-stats"><div id="statsChartMain" class="echarts-stat-chart"></div><div id="statsChartSecondary" class="echarts-stat-chart"></div></div>';
  if(tab==='timeline'){
    if(day)return top+
      '<div class="plot-axis music-track-panel">'+p109TimelineZoomHtml()+'<button type="button" id="p109TimelineReset" aria-label="重置时间轴范围" title="恢复当日初始时间范围"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7a6.3 6.3 0 1 1-.2 5M4 3v4h4"/></svg></button><div id="attendanceTimelineChart" class="echarts-timeline-chart" role="img" aria-label="多轨考勤时间轴"></div><div id="attendanceFlagsLayer" class="r72-attendance-flags" aria-label="迟到与早退标记"></div><div id="overtimeReviewLayer" class="overtime-review-layer" aria-label="自动与补录加班计入选择"></div><div id="temporaryReviewLayer" class="p109-temporary-layer" aria-label="临时外出改判与区间补录"></div>'+r15PunchPreview(day)+'</div>';
    if(ctx.type==='date')return top+'<div class="plot-day-scroller"><div id="attendanceDayChart" class="echarts-date-chart" style="height:'+Math.max(550,ctx.items.length*17)+'px"></div></div>';
    return top+'<div class="plot-empty">选择人员或日期，查看时间轴</div>';
  }
  return top+'<div id="overviewTrendChart" class="overview-trend-chart plot-chart"></div>';
}
function timelineBehaviorRows(item,key){
  return ({trip:item.trips||[],leave:item.leaves||[],outing:item.outings||[],overtime:item.overtime||[]})[key]||[];
}
function timelineBehaviorClock(row,key,edge){
  const fallback=key==='overtime'
    ?(edge==='start'?'17:30':'20:00')
    :(edge==='start'?RULES.amStart:RULES.pmEnd);
  return row?.[edge]||fallback;
}
function timelineBehaviorInsight(item,key){
  const rows=timelineBehaviorRows(item,key),label=FILTER_LABELS[key]||'行为';
  if(!rows.length)return '<section class="insight-card metric-card"><div class="insight-card-head"><span>当日'+label+'</span><b>0 项</b></div><p class="insight-empty">暂无记录</p></section>';
  const starts=rows.map(r=>timelineBehaviorClock(r,key,'start')).sort((a,b)=>minutes(a)-minutes(b));
  const ends=rows.map(r=>timelineBehaviorClock(r,key,'end')).sort((a,b)=>minutes(a)-minutes(b));
  let out='<section class="insight-card metric-card"><div class="insight-card-head"><span>当日'+label+'</span><b>'+rows.length+' 项</b></div><div class="insight-metric-list">'+
    insightMetric('时长',fmtMinutes(behaviorMinutes(item,key)))+
    insightMetric('开始',starts[0]||'—')+
    insightMetric('结束',ends[ends.length-1]||'—');
  const first=rows[0],detail=key==='trip'?(first.place||first.type):first.type;
  if(detail)out+=insightMetric(key==='trip'&&first.place?'地点':'类型',detail);
  return out+'</div></section>';
}
function timelineBehaviorSummaryRow(item,key){
  const rows=timelineBehaviorRows(item,key),active=state.filter===key;
  const recorded=rows.length?(rows.length+'项 · '+fmtMinutes(behaviorMinutes(item,key))):'—';
  const included=activeAutoOvertimeSegments(item);
 const acceptedMinutes=included.reduce((sum,seg)=>sum+seg.minutes,0);
 const excluded=(item.autoOvertime?.segments?.length||0)-included.length,
  total=analysisUnionMinutes([...rows.map(r=>[minutes(r.start),minutes(r.end)]),...included.map(r=>[r.from,r.to])]),
  value=key==='overtime'?fmtMinutes(total):recorded,
  tip=key==='overtime'?'登记 '+recorded+'；推算/补录纳入 '+fmtMinutes(acceptedMinutes)+'；排除 '+excluded+' 段。纳入统计不代表审批。':FILTER_LABELS[key]+'：'+recorded;
  return '<div tabindex="0" data-r73-tip="'+safeTableText(tip)+'" class="insight-behavior-row '+key+(active?' active':'')+'"><span><i></i>'+FILTER_LABELS[key]+'</span><strong>'+value+'</strong></div>';
}
function timelineFullInsightHtml(item){
 const metrics=insightMetric('首进',item.firstIn?.slice(0,5)||'—','tone-in')+
  insightMetric('末出',item.lastOut?.slice(0,5)||'—','tone-out')+
  insightMetric('在岗',fmtMinutes(item.presence))+insightMetric('班内工时',fmtMinutes(item.workMinutes??0));
 const explanation=['初始判定：'+JUDGMENT_LABELS[attendanceJudgmentSystem(item)],
  ...item.issues,item.lunchEvidence,item.autoOvertime?.reason].filter(Boolean).join('；'),
  behaviors=['trip','leave','outing','overtime'];
 return '<div class="r74-unified-insight p109-day-inspector">'+
  '<section class="p109-inspector-block p109-day-status" aria-label="初始与人工判定">'+manualJudgmentHtml(item,explanation)+'</section>'+
  '<section class="p109-inspector-block r74-overview-metrics" aria-label="首进末出与工时">'+metrics+'</section>'+
  '<section class="p109-inspector-block r74-behaviors" aria-label="业务时间统计"><div class="r74-behavior-list">'+behaviors.map(key=>timelineBehaviorSummaryRow(item,key)).join('')+'</div></section>'+
  '<section class="p109-inspector-block" aria-label="临时外出统计">'+p109TempDayHtml(item)+'</section>'+
  '<section class="p109-inspector-block p109-day-evidence" aria-label="打卡证据"><div id="timelineEvidence" class="insight-evidence"><span class="p109-evidence-placeholder">'+item.punches.length+' 条打卡 · 点击箭头或原始记录查看来源</span></div></section>'+
 '</div>';
}
function personalLateEarlySummaryHtml(employeeId){
 const days=Array.from({length:monthDays()},(_,i)=>state.analysis.get(employeeId+'|'+(i+1))).filter(Boolean);
 const flagged=days.filter(attendanceHasLateEarly);
 const late=days.reduce((n,a)=>n+activeAttendanceFlags(a).filter(f=>f.kind==='late').length,0);
 const early=days.reduce((n,a)=>n+activeAttendanceFlags(a).filter(f=>f.kind==='early').length,0);
 return '<section class="r77-anomaly-summary" aria-label="系统识别的迟到早退">'+
  '<header><strong>迟到早退</strong><small>已纳入 · 排除保留底稿</small></header>'+
  '<div class="r77-anomaly-totals"><span>迟到 <b>'+late+' 次</b></span><span>早退 <b>'+early+
  ' 次</b></span><span>涉及 <b>'+flagged.length+' 天</b></span></div>'+
  '<div class="r77-anomaly-days">'+(flagged.length?flagged.map(a=>
   '<button type="button" data-person-anomaly-day="'+a.day+'" title="'+safeTableText(activeAttendanceFlags(a).map(f=>f.label+' '+f.time).join('、'))+
   (manualStatusFor(a)?' · 人工已调整判定':'')+'" aria-label="'+pad(a.day)+'日异常，查看时间轴">'+pad(a.day)+'日</button>'
  ).join(''):'<span>本月无明确迟到早退记录</span>')+'</div></section>';
}
function attendInsightHtml(ctx){
  const tab=state.chartTab||'overview',item=plotAnalysis(ctx);
  // Personal statistics and issues summarize this employee's month, not the selected day.
  const monthly=state.workspaceMode==='person'&&ctx.employee&&tab!=='timeline';
  const monthlyItems=monthly?Array.from({length:monthDays()},(_,i)=>state.analysis.get(ctx.employee.id+'|'+(i+1))):null;
  const view=monthly?analysisViewItems({items:monthlyItems}):analysisViewItems(ctx);
  const eligible=(monthly?monthlyItems:ctx.items||[]).filter(a=>isWorkday(a.day)&&attendanceJudgment(a)!=='rest');
  const tabLabel=({overview:'总览',timeline:'时间轴',stats:'统计',issues:'异常'}[tab]);
  if(tab==='timeline'&&item){
    return timelineFullInsightHtml(item);
  }
  const heading=currentFilterLabel();
  let out='<div class="insight-heading"><strong>'+heading+'</strong><span>'+tabLabel+'</span></div>';
  if(state.filter==='tempOuting')return out+p109TempSummaryHtml(view);
  if(state.filter!=='main'){
    const people=new Set(view.map(a=>a.employee.id)).size,days=new Set(view.map(a=>a.date)).size;
    if(behaviorFilterActive()){
      const mins=view.reduce((sum,a)=>sum+behaviorMinutes(a,state.filter),0);
      out+=insightMetric('记录日',view.length+' 日')+insightMetric('人员',people+' 人')+
        insightMetric('日期',days+' 天')+insightMetric('区间',fmtMinutes(mins));
    }else{
      const numerator=view.filter(a=>isWorkday(a.day)&&attendanceJudgment(a)!=='rest').length;
      out+=insightMetric('记录日',view.length+' 日')+insightMetric('人员',people+' 人')+
        insightMetric('占工作日',eligible.length?Math.round(numerator/eligible.length*100)+'%':'0%');
    }
    if(tab==='overview')return out+(state.workspaceMode==='person'&&ctx.employee?personalLateEarlySummaryHtml(ctx.employee.id):'');
  }
  if(tab==='issues'){
    const anomalies=view.filter(a=>attendanceJudgment(a)==='anomaly').length;
    const absences=view.filter(a=>attendanceJudgment(a)==='absent').length;
    out+=insightMetric('异常',anomalies,'tone-warn')+insightMetric('缺勤',absences,'tone-problem')+
      insightMetric('合计',anomalies+absences+' 项');
    const critical=view.filter(a=>['anomaly','absent'].includes(attendanceJudgment(a))).slice(0,3);
    out+='<div class="insight-issue-list">'+critical.map(a=>'<button data-analysis-cell="'+a.employee.id+'|'+a.day+'">'+pad(a.day)+'日 '+safeTableText(a.employee.name)+'</button>').join('')+'</div>';
    return out;
  }
  if(tab==='stats'){
    const focus=view.filter(a=>isWorkday(a.day)),pres=focus.filter(a=>a.presence>0);
    out+=insightMetric('有效天数',focus.length)+
      insightMetric('正常',focus.filter(a=>attendanceJudgment(a)==='normal').length,'tone-ok')+
      insightMetric('异常',focus.filter(a=>attendanceJudgment(a)==='anomaly').length,'tone-warn')+
      insightMetric('缺勤',focus.filter(a=>attendanceJudgment(a)==='absent').length,'tone-problem');
    return out+insightMetric('平均在岗',fmtMinutes(pres.length?pres.reduce((n,a)=>n+a.presence,0)/pres.length:0));
  }
  const pres=view.filter(a=>isWorkday(a.day)&&a.presence>0);
  if(ctx.type==='person'||ctx.type==='cell'){
    const items=ctx.type==='cell'?Array.from({length:monthDays()},(_,i)=>state.analysis.get(ctx.employee.id+'|'+(i+1))):view;
    out+=insightMetric('工作日',items.filter(a=>isWorkday(a.day)).length)+
      insightMetric('正常',items.filter(a=>attendanceJudgment(a)==='normal').length,'tone-ok')+
      insightMetric('异常',items.filter(a=>attendanceJudgment(a)==='anomaly').length,'tone-warn')+
      insightMetric('缺勤',items.filter(a=>attendanceJudgment(a)==='absent').length,'tone-problem');
    return out+(state.workspaceMode==='person'?personalLateEarlySummaryHtml(ctx.employee.id):'');
  }
  return out+insightMetric('人员',new Set(view.map(a=>a.employee.id)).size+' 人')+
    insightMetric('正常',view.filter(a=>attendanceJudgment(a)==='normal').length,'tone-ok')+
    insightMetric('异常',view.filter(a=>attendanceJudgment(a)==='anomaly').length,'tone-warn')+
    insightMetric('缺勤',view.filter(a=>attendanceJudgment(a)==='absent').length,'tone-problem')+
    insightMetric('平均在岗',fmtMinutes(pres.length?pres.reduce((n,a)=>n+a.presence,0)/pres.length:0));
}
function rawForContext(ctx){
  const tab=state.rawDataTab||'attendance',pool=({attendance:state.records,leave:state.leaves,trip:state.trips,outing:state.outings||[],overtime:state.overtimeEntries||[]})[tab]||[];
  const day=(ctx.type==='cell'||ctx.type==='date')?ctx.day:
    ctx.type==='person'&&state.chartTab==='timeline'?plotAnalysis(ctx)?.day:null;
  const date=day?isoDate(day):null;
  return pool.filter(r=>{
    if((ctx.type==='person'||ctx.type==='cell')&&r.employeeId!==ctx.employee.id)return false;
    if(!date)return true;
    return tab==='trip'||tab==='outing'?date>=r.startDate&&date<=r.endDate:(tab==='leave'||tab==='overtime'?r.date:r.datetime?.slice(0,10))===date;
  });
}
function attendWorkbenchHtml(ctx){
  const tab=state.rawDataTab||'attendance';
  return '<div class="inspector-top"><section class="inspector-plot">'+attendPlotHtml(ctx)+'</section>'+
    '<aside class="inspector-insight">'+attendInsightHtml(ctx)+'</aside></div>'+
    '<section class="inspector-bottom" id="rawPane" aria-label="原始记录"><div class="raw-toolbar"><strong>原始数据</strong>'+
    '<div class="raw-tabs">'+[['attendance','考勤'],['trip','出差'],['leave','请假'],['outing','外出'],['overtime','加班']].map(([id,name])=>
      '<button data-raw-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+name+'</button>').join('')+'</div>'+
    '<span class="raw-count" id="rawRowCount"></span>'+ 
    '<button class="raw-float-btn" id="rawFloat" title="弹出可拖动、可缩放表格" aria-label="弹出原始表格"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg></button></div>'+
    '<div id="rawDataTable" class="raw-table" aria-label="原始表格"></div></section>';
}
function mountPlotTabs(ctx){
  document.querySelectorAll('[data-person-anomaly-day]').forEach(b=>b.onclick=()=>changePersonalDay(b.dataset.personAnomalyDay));
  document.querySelectorAll('[data-chart-tab]').forEach(button=>button.onclick=()=>{
    state.chartTab=button.dataset.chartTab;state.rawPage=1;
    if(state.chartTab==='timeline'&&ctx.employee&&!state.chartDay)state.chartDay=nearestRecordedDay(ctx.employee.id);
    renderAnalysisPanel();
  });
  const picker=document.getElementById('timelineDayPicker');
  if(picker)picker.onchange=()=>{
    if(state.workspaceMode==='person'){changePersonalDay(picker.value);return}
    state.chartDay=Number(picker.value);
    if(ctx.type==='cell')state.selection.day=state.chartDay;
    state.timelineRange=null;state.rawPage=1;
    renderAnalysisPanel();renderMatrix();renderCalendar();
  };
  const prev=document.getElementById('personalDayPrev'),next=document.getElementById('personalDayNext');
  if(prev)prev.onclick=()=>changePersonalDay((state.chartDay||1)-1);
  if(next)next.onclick=()=>changePersonalDay((state.chartDay||1)+1);
}
function disposeRawTable(){
  if(rawDialog)closeRawPopout();
  if(rawTabulator){try{rawTabulator.destroy()}catch(e){console.warn('Tabulator destroy:',e)}rawTabulator=null}
}
function rawEvidenceKey(kind,r){return kind==='attendance'?r.recordId:r.id}
function clearRawLinkedHighlight(){document.querySelectorAll('.raw-linked-highlight').forEach(el=>el.classList.remove('raw-linked-highlight'))}
function applyPendingRawHighlight(){
  if(!pendingRawHighlight||!rawTabulator)return;
  const {kind,keys}=pendingRawHighlight;
  const rows=rawTabulator.getRows().filter(r=>keys.has(rawEvidenceKey(kind,r.getData())));
  if(!rows.length)return;
  clearRawLinkedHighlight();
  rows.forEach(r=>r.getElement().classList.add('raw-linked-highlight'));
  try{rawTabulator.scrollToRow(rows[0],'center',false)}catch(_){}
  pendingRawHighlight=null;
}
function focusRawEvidence(kind,key){
  if(!key)return;
  pendingRawHighlight={kind,keys:new Set(Array.isArray(key)?key:[key])};
  state.rawDataTab=kind;
  renderRawTable(analysisContext());
}
function evidenceForAnalysis(a){
  if(!a)return null;
  const filter=state.filter;
  if(filter==='trip'&&a.trips?.[0])return {kind:'trip',keys:[a.trips[0].id]};
  if(filter==='leave'&&a.leaves?.[0])return {kind:'leave',keys:[a.leaves[0].id]};
  if(filter==='outing'&&a.outings?.[0])return {kind:'outing',keys:[a.outings[0].id]};
  if(filter==='overtime'&&a.overtime?.[0])return {kind:'overtime',keys:[a.overtime[0].id]};
  if(a.punches?.length)return {kind:'attendance',keys:a.punches.map(p=>p.recordId)};
  for(const [kind,rows] of [['trip',a.trips],['leave',a.leaves],['outing',a.outings],['overtime',a.overtime]]){
    if(rows?.[0])return {kind,keys:[rows[0].id]};
  }
  return null;
}
function focusAnalysisEvidence(a){
  const target=evidenceForAnalysis(a);if(target)focusRawEvidence(target.kind,target.keys);
}
function selectCellAndFocusEvidence(employeeId,day){
  const a=state.analysis.get(employeeId+'|'+day);
  selectCell(employeeId,day);
  requestAnimationFrame(()=>focusAnalysisEvidence(a));
}
function mountRawTable(ctx){
  mountPlotTabs(ctx);
  document.querySelectorAll('[data-raw-tab]').forEach(btn=>btn.onclick=()=>{
   state.rawDataTab=btn.dataset.rawTab;state.rawPage=1;
   asNavTrack();asNavUpdateButtons();renderRawTable(ctx);
  });
  document.getElementById('rawFloat').onclick=toggleRawPopout;
  renderRawTable(ctx);
}
function renderRawTable(ctx){
  if(rawDialog)closeRawPopout();
  if(rawTabulator){rawTabulator.destroy();rawTabulator=null}
  const kind=state.rawDataTab||'attendance',data=rawForContext(ctx);
  document.querySelectorAll('[data-raw-tab]').forEach(b=>b.classList.toggle('active',b.dataset.rawTab===kind));
  const count=document.getElementById('rawRowCount');
  if(count)count.textContent=data.length+' 条';
  const node=document.getElementById('rawDataTable');
  if(!node)return;
  const p=typeof r14Prefs==='function'?r14Prefs():state.prefs||{};
  const prefs=p.tableColumns?.[kind]||{};
  const col=(title,field,width,minWidth=43)=>{
    const opt=prefs[field]||{};
    return {title,field,minWidth,formatter:field==='source'?cell=>{
       const row=cell.getRow().getData(),refs=row.sources||[row];
       if(!refs.some(x=>x.importId))return escapeNameText(cell.getValue()||'');
       return '<button type="button" class="r80-file-link" data-p109-source="'+escapeNameText(refs.find(x=>x.importId).importId)+'">'+escapeNameText(cell.getValue()||'原件')+'</button>'+
        (refs.length>1?'<button type="button" class="r80-cell-sources" data-p109-sources="'+encodeURIComponent(JSON.stringify([kind,rawEvidenceKey(kind,row)]))+'">'+refs.length+' 个来源</button>':'');
      }:'plaintext',headerSort:true,tooltip:true,
      hozAlign:'center',headerHozAlign:'center',
      visible:field==='name'||opt.visible!==false,frozen:field==='name',width:opt.width&&opt.width>=48?Math.min(500,opt.width):undefined,
      widthGrow:Math.max(1,Math.round(width/65))};
  };
  const withName=true; // The employee column stays visible in every context.
  const columns=(kind==='outing'||kind==='overtime')?[
    ...(withName?[col('姓名','name',74,55)]:[]),
    ...(kind==='outing'?[col('开始','startDate',104),col('结束','endDate',104)]:[col('日期','date',110)]),
    col('开始','start',70),col('结束','end',70),col('事项','type',95),
    col('说明','note',155),col('来源','source',150)
  ]:kind==='leave'?[
    ...(withName?[col('姓名','name',70,54)]:[]),col('日期','date',105,83),col('开始','start',64),
    col('结束','end',64),col('类型','type',80),col('备注','note',110),col('文件','source',130),col('行号','row',54)]:
    kind==='trip'?[
      ...(withName?[col('姓名','name',70,54)]:[]),col('开始','startDate',94),col('结束','endDate',94),col('类型','type',84),
      col('地点','place',70),col('备注','note',110),col('文件','source',126),col('行号','row',54)]:
      [...(withName?[col('姓名','name',68,54)]:[]),col('时间','datetime',151,133),col('进出','direction',48),
        col('文件','source',150,95),col('行','row',49)];
  rawTabulator=new Tabulator(node,{
    data:data.map((r,i)=>({...r,__id:i+1})),index:'__id',height:'100%',layout:'fitColumns',
    responsiveLayout:'hide',placeholder:'该范围暂无'+({attendance:'考勤',trip:'出差',leave:'请假',outing:'外出',overtime:'加班'}[kind]||'')+'记录（接口已预留）',
    pagination:false,
    columns,initialSort:kind==='attendance'?[{column:'datetime',dir:'asc'}]:[]
  });
  const instance=rawTabulator;
  instance.on('tableBuilt',()=>{
    // tableBuilt may resolve after this view has been replaced or destroyed.
    // Only the owning, connected instance may measure/redraw its DOM.
    requestAnimationFrame(()=>{
      if(rawTabulator!==instance||!node.isConnected||!instance.element)return;
      instance.redraw(true);
      applyPendingRawHighlight();
    });
  });
  rawTabulator.on('rowClick',(event,row)=>{
    if(event.target.closest?.('[data-p109-source],[data-p109-sources]'))return;
    if(kind!=='attendance')return;
    const record=row.getData(),day=Number(record.datetime.slice(8,10));
    if(ctx.type==='cell'&&ctx.employee.id===record.employeeId&&ctx.day===day){
      showRecord(record.recordId);return;
    }
    selectCell(record.employeeId,day);
    requestAnimationFrame(()=>requestAnimationFrame(()=>showRecord(record.recordId)));
  });
}
function toggleRawPopout(){if(rawDialog)closeRawPopout();else openRawPopout()}
function openRawPopout(){
  const pane=document.getElementById('rawPane');if(!pane||rawDialog)return;
  const parent=pane.parentNode;rawDialogOrigin={parent,next:pane.nextSibling};
  const overlay=document.createElement('div');overlay.className='raw-dialog-overlay';overlay.id='rawDialogOverlay';
  const popup=document.createElement('div');popup.className='raw-dialog';
  popup.style.left='12vw';popup.style.top='9vh';popup.style.width='76vw';popup.style.height='75vh';
  const header=document.createElement('div');header.className='raw-dialog-title';
  header.innerHTML='<strong>原始记录 · 扩展表格</strong><span>拖动标题栏移动，拖动右下角调整大小</span><button id="rawClose" title="收回">×</button>';
  popup.appendChild(header);popup.appendChild(pane);overlay.appendChild(popup);
  document.body.appendChild(overlay);rawDialog={overlay,popup,pane};
  const button=document.getElementById('rawClose');button.onclick=closeRawPopout;
  overlay.addEventListener('pointerdown',e=>{if(e.target===overlay)closeRawPopout()});
  header.onpointerdown=e=>{
    if(e.target.closest('button'))return;
    const x=e.clientX,y=e.clientY,rect=popup.getBoundingClientRect();
    rawMove={id:e.pointerId,x,y,left:rect.left,top:rect.top};
    header.setPointerCapture(e.pointerId);
  };
  header.onpointermove=e=>{
    if(!rawMove||rawMove.id!==e.pointerId)return;
    popup.style.left=Math.max(0,rawMove.left+e.clientX-rawMove.x)+'px';
    popup.style.top=Math.max(0,rawMove.top+e.clientY-rawMove.y)+'px';
  };
  header.onpointerup=header.onpointercancel=e=>{rawMove=null;try{header.releasePointerCapture(e.pointerId)}catch(_){}};
  rawTabulator?.redraw(true);
}
function closeRawPopout(){
  if(!rawDialog)return;
  const {overlay,pane}=rawDialog,origin=rawDialogOrigin;
  if(origin?.parent){origin.parent.insertBefore(pane,origin.next||null)}
  overlay.remove();rawDialog=null;rawDialogOrigin=null;rawMove=null;
  rawTabulator?.redraw(true);
}
function mountIssueChart(ctx){
  const el=document.getElementById('issueChart');if(!el||!window.echarts)return;
  const chart=initAttendChart(el);if(!chart)return;
  const names=[],bad=[],sus=[];
  if(ctx.type==='person'||ctx.type==='cell'){
    const id=ctx.employee.id;
    for(let d=1;d<=monthDays();d++){
      const a=state.analysis.get(id+'|'+d);if(!isWorkday(d))continue;
      names.push(pad(d));bad.push(attendanceJudgment(a)==='absent'?1:0);sus.push(attendanceJudgment(a)==='anomaly'?1:0);
    }
  }else{
    for(let d=1;d<=monthDays();d++){
      if(!isWorkday(d))continue;
      const set=EMPLOYEES.map(e=>state.analysis.get(e.id+'|'+d));
      names.push(pad(d));bad.push(set.filter(a=>attendanceJudgment(a)==='absent').length);sus.push(set.filter(a=>attendanceJudgment(a)==='anomaly').length);
    }
  }
  chart.setOption({
    grid:{left:32,right:12,top:14,bottom:30},
    tooltip:{trigger:'axis'},legend:{show:false},
    xAxis:{type:'category',data:names,axisLabel:{fontSize:11,interval:2,color:'#71899b'},axisTick:{show:false}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#71899b'},splitLine:{lineStyle:{type:'dashed',color:'#e7eef4'}}},
    series:[{type:'bar',name:'缺勤',stack:'a',data:bad,barMaxWidth:16,itemStyle:{color:ATTEND_STATUS_COLORS.absent,borderRadius:[3,3,0,0]}},
      {type:'bar',name:'异常',stack:'a',data:sus,barMaxWidth:16,itemStyle:{color:ATTEND_STATUS_COLORS.anomaly,borderRadius:[3,3,0,0]}}]
  });
  chart.on('click',p=>{const d=Number(names[p.dataIndex]);if(ctx.employee)selectCellAndFocusEvidence(ctx.employee.id,d);else selectDate(d,true)});
}

/* Navigator has a single active implementation: r15PunchPreview. */
function r15PunchPreview(a){
  const bins=new Map();
  for(const p of (a.punches||[])){
    const minute=Math.floor(minutes(p.time)),bucket=Math.floor(minute/3)*3;
    if(!bins.has(bucket))bins.set(bucket,{minute:bucket,sum:0,in:0,out:0,unknown:0});
    const bin=bins.get(bucket);bin[p.direction==='进'?'in':p.direction==='出'?'out':'unknown']++;bin.sum+=minutes(p.time);
  }
  const bars=[...bins.values()].map(g=>{
    const total=g.in+g.out+g.unknown,center=g.sum/total,left=(center/1440*100).toFixed(5),width=Math.min(9,2+total*1.35);
    const range=state.timelineRange,inside=range&&center>=range.start&&center<=range.end;
    return '<span class="r15-punch-stack '+(inside?'inside':'outside')+'" data-nav-minute="'+center+'" style="left:clamp('+(width/2)+'px,'+left+'%,calc(100% - '+(width/2)+'px));width:'+width+'px" title="进 '+g.in+' / 出 '+g.out+'">'+
      (g.in?'<i class="in"></i>':'')+
      (g.out?'<i class="out"></i>':'')+(g.unknown?'<i class="unknown"></i>':'')+
    '</span>';
  }).join('');
  const ticks=['0:00','6:00','12:00','18:00','24:00'].map(t=>'<span>'+t+'</span>').join('');
  return '<div class="r15-punch-preview" id="r15PunchPreview" aria-hidden="true">'+bars+'</div>'+
    '<div class="r23-mini-ticks" aria-hidden="true">'+ticks+'</div>';
}
