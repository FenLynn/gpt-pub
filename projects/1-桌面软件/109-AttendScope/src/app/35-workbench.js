/* P109 right-hand analysis: context -> chart tab -> linked metrics -> immutable raw evidence. */
let rawTabulator=null,rawDialog=null,rawDialogOrigin=null,rawMove=null;
const CHART_TABS=[['overview','总览'],['timeline','时间轴'],['stats','统计'],['issues','异常']];
function safeTableText(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function insightMetric(label,value,tone=''){
  return '<div class="insight-row"><span>'+label+'</span><strong class="'+tone+'">'+safeTableText(value)+'</strong></div>';
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
  if(tab==='stats')return '统计分布';
  if(tab==='issues')return '异常分析';
  if(tab==='timeline')return ctx.type==='overall'?'打卡时间轴':ctx.type==='date'?'全员打卡时间分布':'进出打卡时间轴';
  return ctx.type==='person'||ctx.type==='cell'?'每日确认在岗':ctx.type==='date'?'当日状态分布':'每日异常趋势';
}
function attendPlotHtml(ctx){
  const tab=state.chartTab||'overview',day=plotAnalysis(ctx);
  const switcher=tab==='timeline'&&day?'<select id="timelineDayPicker" aria-label="时间轴日期">'+
    Array.from({length:monthDays()},(_,i)=>'<option value="'+(i+1)+'" '+(day.day===i+1?'selected':'')+'>'+pad(i+1)+' 日</option>').join('')+'</select>':'';
  const legend=tab==='timeline'&&day
    ?'<div class="timeline-top-legend"><span class="event-in">● 进</span><span class="event-out">● 出</span><span class="event-duplicated">✧ 重复事件</span><span class="event-window" id="timelineWindowLabel">'+minuteText(timelineRange(day).start)+'–'+minuteText(timelineRange(day).end)+'</span></div>':'';
  const top='<div class="chart-mode-tabs">'+CHART_TABS.map(([id,label])=>
    '<button data-chart-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+label+'</button>').join('')+'</div>'+
    '<div class="plot-heading"><strong>'+plotTitle(ctx)+'</strong>'+switcher+'</div>'+legend;
  if(tab==='issues')return top+'<div id="issueChart" class="plot-chart"></div>';
  if(tab==='stats')return top+'<div class="plot-chart plot-stats"><div id="statsChartMain" class="echarts-stat-chart"></div><div id="statsChartSecondary" class="echarts-stat-chart"></div></div>';
  if(tab==='timeline'){
    if(day){
      const range=timelineRange(day);
      return top+'<div class="plot-axis"><div id="attendanceTimelineChart" class="echarts-timeline-chart" role="img" aria-label="多轨考勤时间轴"></div><div class="r14-day-edges"><span>0:00</span><span>24:00</span></div></div>';
    }
    if(ctx.type==='date')return top+'<div class="plot-day-scroller"><div id="attendanceDayChart" class="echarts-date-chart" style="height:'+Math.max(550,ctx.items.length*17)+'px"></div></div>';
    return top+'<div class="plot-empty">选择人员或日期，查看时间轴</div>';
  }
  return top+'<div id="overviewTrendChart" class="overview-trend-chart plot-chart"></div>';
}
function attendInsightHtml(ctx){
  const tab=state.chartTab||'overview',item=plotAnalysis(ctx),st=statsFor(ctx.items);
  let out='<div class="insight-heading">'+({overview:'总览数据',timeline:'时间轴数据',stats:'统计数据',issues:'异常数据'}[tab])+'</div>';
  if(tab==='timeline'&&item){
    const tone=item.severity==='problem'?'problem':item.severity==='suspect'?'suspect':'normal';
    out+='<div class="insight-state '+tone+'">'+safeTableText(item.status)+'</div>';
    out+=insightMetric('首进',item.firstIn?.slice(0,5)||'—','tone-in')+
      insightMetric('末出',item.lastOut?.slice(0,5)||'—','tone-out')+
      insightMetric('在岗',fmtMinutes(item.presence))+insightMetric('记录',item.punches.length+' 条')+
      insightMetric('有效区间',item.pairs.length+' 段')+
      (item.leaves.length?insightMetric('请假',item.leaves.length+' 条'):'')+
      (item.trips.length?insightMetric('出差',item.trips.length+' 条'):'');
    if(item.issues.length)out+='<p class="insight-issue">'+safeTableText(item.issues.join('、'))+'</p>';
    if(ctx.employee)out+='<div class="insight-actions"><button data-revise="resolved">已核实</button><button data-revise="note">加说明</button><button data-revise="clear" class="danger">清除修订</button></div>';
    return out+'<div id="timelineEvidence" class="insight-evidence"></div>';
  }
  if(tab==='issues'){
    out+=insightMetric('明确异常',st.problems,'tone-problem')+insightMetric('待核实',st.suspects,'tone-warn')+
      insightMetric('总计',st.problems+st.suspects+' 项');
    const critical=ctx.items.filter(a=>a.severity==='problem'||a.severity==='suspect').slice(0,3);
    out+='<div class="insight-issue-list">'+critical.map(a=>'<button data-analysis-cell="'+a.employee.id+'|'+a.day+'">'+pad(a.day)+'日 '+safeTableText(a.employee.name)+' · '+safeTableText(a.status)+'</button>').join('')+'</div>';
    return out;
  }
  if(tab==='stats'){
    const focus=ctx.items.filter(a=>isWorkday(a.day)),pres=focus.filter(a=>a.presence>0);
    out+=insightMetric('有效天数',focus.length)+insightMetric('正常',st.normal,'tone-ok')+
      insightMetric('待核实',st.suspects,'tone-warn')+insightMetric('异常',st.problems,'tone-problem');
    return out+insightMetric('平均在岗',fmtMinutes(pres.length?pres.reduce((n,a)=>n+a.presence,0)/pres.length:0));
  }
  const pres=ctx.items.filter(a=>isWorkday(a.day)&&a.presence>0);
  if(ctx.type==='person'||ctx.type==='cell'){
    const items=ctx.type==='cell'?Array.from({length:monthDays()},(_,i)=>state.analysis.get(ctx.employee.id+'|'+(i+1))):ctx.items;
    const sum=statsFor(items);
    out+=insightMetric('工作日',items.filter(a=>isWorkday(a.day)).length)+insightMetric('正常',sum.normal,'tone-ok')+
      insightMetric('异常',sum.problems,'tone-problem')+insightMetric('待核实',sum.suspects,'tone-warn');
    return out;
  }
  return out+insightMetric('人员',EMPLOYEES.length+' 人')+insightMetric('正常',st.normal,'tone-ok')+
    insightMetric('异常',st.problems,'tone-problem')+insightMetric('待核实',st.suspects,'tone-warn')+
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
    '<button class="raw-float-btn" id="rawFloat" title="弹出可拖动、可缩放表格" aria-label="弹出原始表格">⛶</button></div>'+
    '<div id="rawDataTable" class="raw-table" aria-label="原始表格"></div></section>';
}
function mountPlotTabs(ctx){
  document.querySelectorAll('[data-chart-tab]').forEach(button=>button.onclick=()=>{
    state.chartTab=button.dataset.chartTab;state.rawPage=1;
    if(state.chartTab==='timeline'&&ctx.employee&&!state.chartDay)state.chartDay=nearestRecordedDay(ctx.employee.id);
    renderAnalysisPanel();
  });
  const picker=document.getElementById('timelineDayPicker');
  if(picker)picker.onchange=()=>{
    state.chartDay=Number(picker.value);
    if(ctx.type==='cell')state.selection.day=state.chartDay;
    state.timelineRange=null;state.rawPage=1;
    renderAnalysisPanel();renderMatrix();renderCalendar();
  };
}
function disposeRawTable(){
  if(rawDialog)closeRawPopout();
  if(rawTabulator){try{rawTabulator.destroy()}catch(e){console.warn('Tabulator destroy:',e)}rawTabulator=null}
}
function mountRawTable(ctx){
  mountPlotTabs(ctx);
  document.querySelectorAll('[data-raw-tab]').forEach(btn=>btn.onclick=()=>{state.rawDataTab=btn.dataset.rawTab;state.rawPage=1;renderRawTable(ctx)});
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
    return {title,field,minWidth,formatter:'plaintext',headerSort:true,tooltip:true,
      visible:opt.visible!==false,width:opt.width&&opt.width>=48?Math.min(500,opt.width):undefined,
      widthGrow:Math.max(1,Math.round(width/65))};
  };
  const withName=ctx.type!=='person'&&ctx.type!=='cell';
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
  rawTabulator.on('tableBuilt',()=>{rawTabulator.redraw(true)});
  rawTabulator.on('rowClick',(event,row)=>{
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
      names.push(pad(d));bad.push(a.severity==='problem'?1:0);sus.push(a.severity==='suspect'?1:0);
    }
  }else{
    for(let d=1;d<=monthDays();d++){
      if(!isWorkday(d))continue;
      const set=EMPLOYEES.map(e=>state.analysis.get(e.id+'|'+d));
      names.push(pad(d));bad.push(set.filter(a=>a.severity==='problem').length);sus.push(set.filter(a=>a.severity==='suspect').length);
    }
  }
  chart.setOption({
    grid:{left:32,right:12,top:14,bottom:30},
    tooltip:{trigger:'axis'},legend:{show:false},
    xAxis:{type:'category',data:names,axisLabel:{fontSize:11,interval:2,color:'#71899b'},axisTick:{show:false}},
    yAxis:{type:'value',minInterval:1,axisLabel:{color:'#71899b'},splitLine:{lineStyle:{type:'dashed',color:'#e7eef4'}}},
    series:[{type:'bar',name:'明确异常',stack:'a',data:bad,barMaxWidth:16,itemStyle:{color:'#e69b96',borderRadius:[3,3,0,0]}},
      {type:'bar',name:'待核实',stack:'a',data:sus,barMaxWidth:16,itemStyle:{color:'#e9cb7f',borderRadius:[3,3,0,0]}}]
  });
  chart.on('click',p=>{const d=Number(names[p.dataIndex]);if(ctx.employee)selectCell(ctx.employee.id,d);else selectDate(d)});
}

function timelineMiniMapHtml(a,range){
  const counts=new Array(72).fill(0);
  for(const p of a.punches){const i=Math.min(71,Math.floor(minutes(p.time)/20));counts[i]++}
  const max=Math.max(1,...counts);
  const bars=counts.map((n,i)=>n?'<rect x="'+(i*10+2)+'" y="'+(25-n/max*22)+'" width="5" height="'+(n/max*22)+'" rx="1"/>':'').join('');
  const left=(range.start/1440*100).toFixed(3)+'%',width=((range.end-range.start)/1440*100).toFixed(3)+'%';
  return '<div class="timeline-mini"><span>0:00</span><div class="mini-frame" id="timelineMini">'+
    '<svg viewBox="0 0 720 28" preserveAspectRatio="none" aria-hidden="true">'+bars+'</svg>'+
    '<div class="mini-selection" id="miniSelection" style="left:'+left+';width:'+width+'"></div></div><span>24:00</span></div>';
}
