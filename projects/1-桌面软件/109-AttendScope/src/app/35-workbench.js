/* P109: source-of-truth workbench. Raw files and their normalized records remain read-only. */
let rawTabulator=null;
function safeTableText(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function attendPlotHtml(ctx){
  if(ctx.type==='cell'){
    const r=timelineRange(ctx.analysis);
    return '<div class="plot-heading"><strong>进出时间轴</strong><b id="timelineWindowLabel">'+minuteText(r.start)+'–'+minuteText(r.end)+'</b></div>'+
      '<div class="plot-axis"><div id="attendanceTimelineChart" class="echarts-timeline-chart" role="img" aria-label="进出打卡时间轴"></div></div>'+
      '<div class="plot-legend"><span><i class="in"></i>进入</span><span><i class="out"></i>离开</span></div>';
  }
  if(ctx.type==='date'){
    return '<div class="plot-heading"><strong>'+pad(ctx.day)+' 日 · 全员打卡</strong></div>'+
      '<div class="plot-day-scroller"><div id="attendanceDayChart" class="echarts-date-chart" style="height:'+Math.max(550,ctx.items.length*17)+'px"></div></div>';
  }
  return '<div class="plot-heading"><strong>'+(ctx.type==='person'?'每日确认在岗':'每日异常趋势')+'</strong></div>'+
    '<div id="overviewTrendChart" class="overview-trend-chart"></div>';
}
function insightMetric(label,value,tone=''){
  return '<div class="insight-row"><span>'+label+'</span><strong class="'+tone+'">'+safeTableText(value)+'</strong></div>';
}
function attendInsightHtml(ctx){
  if(ctx.type==='cell'){
    const a=ctx.analysis,severity=a.severity==='problem'?'problem':a.severity==='suspect'?'suspect':'normal';
    return '<div class="insight-heading">当天数据</div><span class="insight-state '+severity+'">'+safeTableText(a.status)+'</span>'+
      '<div class="insight-metrics">'+insightMetric('首进',a.firstIn?.slice(0,5)||'—','tone-in')+
      insightMetric('末出',a.lastOut?.slice(0,5)||'—','tone-out')+
      insightMetric('在岗',fmtMinutes(a.presence))+insightMetric('打卡',a.punches.length+' 条')+'</div>'+
      (a.issues.length?'<p class="insight-issue">'+safeTableText(a.issues.join('、'))+'</p>':'')+
      '<div class="insight-actions"><button data-revise="resolved">已核实</button><button data-revise="note">加说明</button><button data-revise="clear" class="danger">清除修订</button></div>'+
      '<div id="timelineEvidence" class="insight-evidence"></div>';
  }
  const items=ctx.items,st=statsFor(items),pres=items.filter(a=>a.presence>0);
  let rows='';
  if(ctx.type==='person')rows=insightMetric('工作日',items.filter(a=>isWorkday(a.day)).length)+insightMetric('异常',st.problems,'tone-problem')+
    insightMetric('待核实',st.suspects,'tone-warn')+insightMetric('日均在岗',fmtMinutes(pres.length?pres.reduce((v,a)=>v+a.presence,0)/pres.length:0));
  else rows=insightMetric('人员',ctx.type==='date'?items.length:EMPLOYEES.length)+insightMetric('明确异常',st.problems,'tone-problem')+
    insightMetric('待核实',st.suspects,'tone-warn')+insightMetric('正常',st.normal,'tone-ok');
  const critical=items.find(a=>a.severity==='problem'||a.severity==='suspect');
  return '<div class="insight-heading">数据概览</div><div class="insight-metrics">'+rows+'</div>'+
    (critical?'<button class="insight-next" data-analysis-cell="'+critical.employee.id+'|'+critical.day+'">查看首个异常 ›</button>':'');
}
function rawForContext(ctx){
  const kind=state.rawDataTab||'attendance';
  const pool=kind==='leave'?state.leaves:kind==='trip'?state.trips:state.records;
  const date=(ctx.type==='cell'||ctx.type==='date')?isoDate(ctx.day):null;
  return pool.filter(r=>{
    if((ctx.type==='person'||ctx.type==='cell')&&r.employeeId!==ctx.employee.id)return false;
    if(!date)return true;
    if(kind==='trip')return date>=r.startDate&&date<=r.endDate;
    return (kind==='leave'?r.date:r.datetime?.slice(0,10))===date;
  });
}
function attendWorkbenchHtml(ctx){
  const selected=state.rawDataTab||'attendance';
  return '<div class="inspector-top"><section class="inspector-plot">'+attendPlotHtml(ctx)+'</section>'+
    '<aside class="inspector-insight">'+attendInsightHtml(ctx)+'</aside></div>'+
    '<section class="inspector-bottom" aria-label="原始表格"><div class="raw-toolbar"><strong>原始数据</strong><div class="raw-tabs">'+
    [['attendance','考勤打卡'],['leave','请假'],['trip','出差']].map(([v,n])=>'<button data-raw-tab="'+v+'" class="'+(selected===v?'active':'')+'">'+n+'</button>').join('')+
    '</div><span class="raw-count" id="rawRowCount"></span></div>'+
    '<div id="rawDataTable" class="raw-table" aria-label="原始记录表格"></div></section>';
}
function disposeRawTable(){
  if(!rawTabulator)return;
  try{rawTabulator.destroy()}catch(e){console.warn('Tabulator destroy:',e)}
  rawTabulator=null;
}
function mountRawTable(ctx){
  document.querySelectorAll('[data-raw-tab]').forEach(btn=>btn.onclick=()=>{state.rawDataTab=btn.dataset.rawTab;renderRawTable(ctx)});
  renderRawTable(ctx);
}
function renderRawTable(ctx){
  disposeRawTable();
  const tab=state.rawDataTab||'attendance',data=rawForContext(ctx);
  const count=document.getElementById('rawRowCount');
  if(count)count.textContent=data.length+' 条';
  document.querySelectorAll('[data-raw-tab]').forEach(b=>b.classList.toggle('active',b.dataset.rawTab===tab));
  const el=document.getElementById('rawDataTable');
  if(!el)return;
  if(!window.Tabulator){el.textContent='本地表格库未加载';throw Error('Offline Tabulator missing')}
  const col=(title,field,width)=>({title,field,width,formatter:'plaintext',headerSort:true,hozAlign:'left'});
  const columns=tab==='leave'?
    [col('姓名','name',85),col('日期','date',105),col('开始','start',75),col('结束','end',75),col('类型','type',95),col('说明','note',170),col('原始文件','source',195),col('行号','row',65)]:
    tab==='trip'?
    [col('姓名','name',85),col('开始日期','startDate',115),col('结束日期','endDate',115),col('类型','type',100),col('地点','place',90),col('备注','note',160),col('原始文件','source',180),col('行号','row',65)]:
    [col('姓名','name',85),col('打卡时间','datetime',160),col('进出','direction',65),col('来源文件','source',210),col('工作表','sheet',70),col('行号','row',70),col('记录 ID','recordId',220)];
  rawTabulator=new Tabulator(el,{
    data:data.map((r,i)=>({...r,__id:i+1})),index:'__id',layout:'fitColumns',height:'100%',
    placeholder:'当前范围没有'+({attendance:'打卡',leave:'请假',trip:'出差'}[tab]||'')+'记录',
    pagination:true,paginationMode:'local',paginationSize:12,paginationSizeSelector:[12,25,50,100],
    initialSort:tab==='attendance'?[{column:'datetime',dir:'asc'}]:[],columns,
  });
  rawTabulator.on('rowClick',(event,row)=>{
    if(tab!=='attendance')return;
    const record=row.getData(),day=Number(record.datetime.slice(8,10));
    if(ctx.type==='cell'&&ctx.employee.id===record.employeeId&&ctx.day===day){
      showRecord(record.recordId);return;
    }
    selectCell(record.employeeId,day);
    requestAnimationFrame(()=>requestAnimationFrame(()=>showRecord(record.recordId)));
  });
}
