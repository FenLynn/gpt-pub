/* R45: one auditable attendance statistics ledger for every analysis scope.
 * No remote services, no duplicate interpretation of employee-day verdicts. */
const AS_STAT_FAMILIES=[
 ['leave','请假',[['hours','记载请假工时','小时'],['count','请假记录数','条'],['people','涉及人数','人']]],
 ['trip','出差',[['days','出差日数','人日'],['estimatedHours','折算出差工时','小时'],['count','出差记录数','次'],['people','涉及人数','人']]],
 ['outing','外出',[['hours','记载外出时长','小时'],['count','外出记录数','次'],['people','涉及人数','人']]],
 ['overtime','加班',[['hours','记载加班时长','小时'],['count','加班记录数','次'],['people','涉及人数','人']]],
 ['punch','打卡',[['count','打卡记录数','次'],['people','打卡人数','人']]],
 ['status','考勤状态',[['normal','正常工作人日','人日'],['anomaly','异常工作人日','人日'],['absent','缺勤工作人日','人日'],['issue','异常及缺勤人日','人日'],['late','迟到人日','人日'],['early','早退人日','人日']]]
];
function asStatFamily(k){return AS_STAT_FAMILIES.find(f=>f[0]===k)||AS_STAT_FAMILIES[0]}
function asStatDefaultCompare(mode){return mode==='person'?'days':mode==='group'?'people':'groups'}
function asStatPrefs(){
 if(!state.statsConfig)state.statsConfig={family:'leave',metric:'hours',compare:null,aggregate:'total',chart:'bar',limit:10,sort:'desc'};
 const cfg=state.statsConfig,f=asStatFamily(cfg.family);
 if(!f[2].some(m=>m[0]===cfg.metric))cfg.metric=f[2][0][0];
 if(!['groups','people','days'].includes(cfg.compare))cfg.compare=asStatDefaultCompare(state.workspaceMode);
 if(state.workspaceMode==='person')cfg.compare='days';
 if(!['total','perPerson','per100'].includes(cfg.aggregate))cfg.aggregate='total';
 if(cfg.metric==='people')cfg.aggregate='total';
 return cfg;
}
function asStatMetric(){const c=asStatPrefs();return asStatFamily(c.family)[2].find(m=>m[0]===c.metric)}
function asStatSelectedPeople(){
 const m=state.workspaceMode;
 if(m==='person')return EMPLOYEES.filter(e=>e.id===(state.selection.employeeId||EMPLOYEES[0]?.id));
 if(m==='group')return EMPLOYEES.filter(e=>groupOf(e)===state.selectedGroup);
 return EMPLOYEES;
}
function asStatWorkMinutes(){return Math.max(0,minutes(RULES.amEnd)-minutes(RULES.amStart))+
 Math.max(0,minutes(RULES.pmEnd)-minutes(RULES.pmStart))}
function asStatIntervalHours(start,end,workOnly){
 if(!start||!end)return 0;
 const a=minutes(start),b=minutes(end);
 if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return 0;
 if(!workOnly)return (b-a)/60;
 return (intervalOverlap(a,b,minutes(RULES.amStart),minutes(RULES.amEnd))+
  intervalOverlap(a,b,minutes(RULES.pmStart),minutes(RULES.pmEnd)))/60;
}
function asStatLedger(){
 const cells=new Map(),dayCount=monthDays();
 const coveredIntervals=new Map(),tripPersonDays=new Set();
 const putInterval=(kind,id,day,start,end,workOnly)=>{
  if(!id||!Number.isInteger(day)||day<1||day>dayCount||!start||!end)return;
  const a=minutes(start),b=minutes(end);
  if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return;
  const key=kind+'|'+id+'|'+day,list=coveredIntervals.get(key)||[];
  const slots=workOnly?[[minutes(RULES.amStart),minutes(RULES.amEnd)],
    [minutes(RULES.pmStart),minutes(RULES.pmEnd)]]:[[a,b]];
  for(const [begin,finish] of slots){
   const x=Math.max(a,begin),y=Math.min(b,finish);
   if(y>x)list.push([x,y]);
  }
  coveredIntervals.set(key,list);
 };
 const add=(kind,metric,id,day,value)=>{
  if(!id||!Number.isInteger(day)||day<1||day>dayCount||!Number.isFinite(value)||!value)return;
  const key=kind+'|'+metric+'|'+id+'|'+day;
  cells.set(key,(cells.get(key)||0)+value);
 };
 const monthStart=isoDate(1),monthEnd=isoDate(dayCount);
 const apply=(list,kind,fn)=>{
  const seen=new Set();
  (list||[]).forEach((item,index)=>{
   const id=item.employeeId;
   if(!id)return;
   const identity=id+'|'+(item.id||item.importId+'|'+item.row+'|'+index);
   if(seen.has(identity))return;seen.add(identity);
   fn(item,id);
  });
 };
 apply(state.leaves,'leave',(r,id)=>{
  const d=Number(String(r.date||'').slice(8,10));
  if(!String(r.date||'').startsWith(monthISO()+'-'))return;
  add('leave','count',id,d,1);
  putInterval('leave',id,d,r.start,r.end,true);
 });
 apply(state.trips,'trip',(r,id)=>{
  const from=String(r.startDate||''),to=String(r.endDate||'');
  if(!from||!to||from>monthEnd||to<monthStart)return;
  let first=null;
  for(let d=1;d<=dayCount;d++){
   const date=isoDate(d);if(date<from||date>to)continue;
   if(first==null)first=d;
   const key=id+'|'+d;
   if(!tripPersonDays.has(key)){
    tripPersonDays.add(key);
    add('trip','days',id,d,1);
    if(isWorkday(d))add('trip','estimatedHours',id,d,asStatWorkMinutes()/60);
   }
  }
  if(first!=null)add('trip','count',id,first,1);
 });
 apply(state.outings,'outing',(r,id)=>{
  const from=String(r.startDate||r.date||''),to=String(r.endDate||r.date||'');
  if(!from||!to||from>monthEnd||to<monthStart)return;
  let first=null;
  for(let d=1;d<=dayCount;d++){
   const date=isoDate(d);if(date<from||date>to)continue;
   if(first==null)first=d;
   putInterval('outing',id,d,r.start,r.end,false);
  }
  if(first!=null)add('outing','count',id,first,1);
 });
 apply(state.overtimeEntries,'overtime',(r,id)=>{
  if(!String(r.date||'').startsWith(monthISO()+'-'))return;
  const d=Number(String(r.date).slice(8,10));
  add('overtime','count',id,d,1);
  putInterval('overtime',id,d,r.start,r.end,false);
 });
 // Time intervals from multiple records can overlap. Union them per person/day,
 // rather than double-counting the same minute in requested duration metrics.
 for(const [key,intervals] of coveredIntervals){
  const [kind,id,d]=key.split('|');
  intervals.sort((a,b)=>a[0]-b[0]);
  let total=0,begin=null,end=null;
  for(const [a,b] of intervals){
   if(begin===null){begin=a;end=b;continue}
   if(a<=end)end=Math.max(end,b);
   else{total+=end-begin;begin=a;end=b}
  }
  if(begin!==null)total+=end-begin;
  add(kind,'hours',id,Number(d),total/60);
 }
 apply(state.records,'punch',(r,id)=>{
  const date=String(r.datetime||'').slice(0,10);
  if(!date.startsWith(monthISO()+'-'))return;
  add('punch','count',id,Number(date.slice(8,10)),1);
 });
 for(const a of state.analysis.values()){
  if(!isWorkday(a.day))continue;
  const id=a.employee.id,k=attendanceJudgment(a);
  if(['normal','anomaly','absent'].includes(k))add('status',k,id,a.day,1);
  if(k==='anomaly'||k==='absent')add('status','issue',id,a.day,1);
  if(a.issues?.some(s=>String(s).includes('迟到')))add('status','late',id,a.day,1);
  if(a.issues?.some(s=>String(s).includes('早退')))add('status','early',id,a.day,1);
 }
 return cells;
}
function asStatValue(ledger,family,metric,persons,days){
 const ids=new Set(persons.map(e=>e.id));
 const dateSet=new Set(days);
 if(metric==='people'){
  const seen=new Set();
  for(const [key,value] of ledger){
   if(value<=0)continue;
   const [k,m,id,day]=key.split('|');
   if(k===family&&m==='count'&&ids.has(id)&&dateSet.has(Number(day)))seen.add(id);
  }
  return seen.size;
 }
 let value=0;
 for(const [key,n] of ledger){
  const [k,m,id,day]=key.split('|');
  if(k===family&&m===metric&&ids.has(id)&&dateSet.has(Number(day)))value+=n;
 }
 return value;
}
function asStatNumber(n){return Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2,minimumFractionDigits:0})}
function asStatRows(){
 const c=asStatPrefs(),people=asStatSelectedPeople(),all=Array.from({length:monthDays()},(_,i)=>i+1);
 const days=all,ledger=asStatLedger(),groups=workspaceGroups();
 let compare=c.compare;
 if(state.workspaceMode==='person')compare='days';
 const entries=compare==='groups'?groups.map(name=>({label:name,key:name,type:'group',people:EMPLOYEES.filter(e=>groupOf(e)===name),days})):
  compare==='people'?people.map(e=>({label:people.filter(x=>x.name===e.name).length>1?e.name+' · '+e.id:e.name,key:e.id,type:'person',people:[e],days})):
   days.map(d=>({label:pad(d)+' 日',key:String(d),type:'day',people,days:[d]}));
 const counted=entries.map(e=>{
  const raw=asStatValue(ledger,c.family,c.metric,e.people,e.days);
  const scheduled=e.days.filter(isWorkday).length*e.people.length;
  const denominator=c.aggregate==='perPerson'?e.people.length:c.aggregate==='per100'?scheduled/100:1;
  const value=denominator?raw/denominator:0;
  return {...e,raw,value,peopleCount:e.people.length,scheduled};
 });
 if(compare==='days')counted.sort((a,b)=>+a.key-+b.key);
 else counted.sort((a,b)=>c.sort==='asc'?a.value-b.value||a.label.localeCompare(b.label,'zh-CN'):
  b.value-a.value||a.label.localeCompare(b.label,'zh-CN'));
 const chartRows=compare==='days'?counted:counted.slice(0,c.limit==='all'?counted.length:Number(c.limit)||10);
 const rankPool=compare==='days'?counted.filter(r=>r.value>0).sort((a,b)=>
   c.sort==='asc'?a.value-b.value||a.key-b.key:b.value-a.value||a.key-b.key):counted;
 const rankRows=rankPool.slice(0,c.limit==='all'?rankPool.length:Number(c.limit)||10);
 const grand=asStatValue(ledger,c.family,c.metric,people,days);
 const scheduled=days.filter(isWorkday).length*people.length;
 const unit=asStatMetric()[2],effectiveUnit=c.aggregate==='perPerson'?unit+'/人':c.aggregate==='per100'?unit+'/百人日':unit;
 const total= c.aggregate==='perPerson'?(people.length?grand/people.length:0):
  c.aggregate==='per100'?(scheduled?grand/scheduled*100:0):grand;
 return {people,ledger,rows:counted,visible:chartRows,rankRows,compare,grand,total,effectiveUnit,scheduled,unit};
}
function asStatOptions(items,selected){return items.map(([key,label])=>
 '<option value="'+key+'" '+(selected===key?'selected':'')+'>'+escapeNameChar(label)+'</option>').join('')}
function statisticsWorkspaceHtml(){
 const c=asStatPrefs(),f=asStatFamily(c.family),met=asStatMetric(),mode=state.workspaceMode;
 const comparisons=mode==='person'?[['days','每日趋势']]:
  mode==='group'?[['people','组内人员'],['days','每日趋势'],['groups','各组对比']]:
  [['groups','各组对比'],['people','全员排名'],['days','每日趋势']];
 const selected=asStatRows(),personLabel=mode==='person'?(selected.people[0]?.name||'员工'):
  mode==='group'?(state.selectedGroup||'组别'):'全体员工';
 const warning=c.family==='trip'?'出差日数按自然日去重；工时按设定工作时段折算，不代表实际出差时长':
  c.family==='leave'?'请假按记录逐条计数，时长扣午休并合并重叠区间；记录数不等于申请次数':
  c.family==='outing'?'外出时长来自记录区间并去除重叠时段；跨日记录按每日时段折算':
  c.family==='overtime'?'仅统计有来源的加班记录，重叠时段不重复计时；未导入不代表没有加班':
  c.family==='punch'?'每条原始打卡计一次，重复打卡仍按实际记录计入':
  '工作日的考勤状态与当前初始／人工判定视图保持一致';
 const unavailable=(c.family==='outing'&&!state.outings?.length)||(c.family==='overtime'&&!state.overtimeEntries?.length);
 return '<section class="as-stats" aria-label="考勤统计工作台">'+
  '<header class="as-stats-heading"><div><h2>'+escapeNameChar(personLabel)+' · 统计分析</h2>'+
  '<span>'+escapeNameChar(periodText())+' · '+selected.people.length+' 人</span></div>'+
  '<button id="asStatsExport" type="button" class="as-stats-export" title="导出当前指标的明细 CSV">导出数据 ↗</button></header>'+
  '<div class="as-stats-filters" aria-label="统计图表筛选">'+
   '<label>业务<select id="asStatFamily">'+asStatOptions(AS_STAT_FAMILIES.map(f=>[f[0],f[1]]),c.family)+'</select></label>'+
   '<label>指标<select id="asStatMetric">'+asStatOptions(f[2].map(m=>[m[0],m[1]]),c.metric)+'</select></label>'+
   '<label>对比对象<select id="asStatCompare">'+asStatOptions(comparisons,c.compare)+'</select></label>'+
   '<label>统计方式<select id="asStatAggregate">'+asStatOptions([['total','总量'],['perPerson','人均'],['per100','每百应出勤人日']],c.aggregate)+'</select></label>'+
   '<label>排序范围<select id="asStatLimit">'+asStatOptions([['5','前 5'],['10','前 10'],['all','全部']],String(c.limit))+'</select></label>'+
  '</div>'+
  '<div class="as-stats-inline">'+
   '<div><span>当前指标</span><strong>'+escapeNameChar(met[1])+'</strong></div>'+
   '<div><span>'+ (c.aggregate==='total'?'范围总量':c.aggregate==='perPerson'?'人均':'每百人日')+'</span>'+
   '<strong>'+asStatNumber(selected.total)+' <small>'+escapeNameChar(selected.effectiveUnit)+'</small></strong></div>'+
   '<div><span>员工</span><strong>'+selected.people.length+' <small>人</small></strong></div>'+
   '<div><span>应出勤</span><strong>'+selected.scheduled+' <small>人日</small></strong></div></div>'+
  '<div class="as-stats-visual"><div class="as-stats-chart"><div class="as-stats-chart-header">'+
   '<h3>'+escapeNameChar(met[1])+' · '+escapeNameChar(comparisons.find(x=>x[0]===c.compare)?.[1]||'统计')+'</h3>'+
   '<div class="as-stats-chart-switch"><button type="button" data-as-chart="bar" class="'+(c.chart==='bar'?'active':'')+'">柱状</button>'+
   '<button type="button" data-as-chart="line" class="'+(c.chart==='line'?'active':'')+'">折线</button></div></div>'+
   '<div id="asStatChart" class="as-stats-chart-canvas" aria-label="交互式统计图表"></div></div>'+
   '<div class="as-stats-rank"><div class="as-stats-rank-head"><h3>排行榜 · 明细</h3>'+
    '<button id="asStatSort" type="button" title="调整排名方向">'+(c.sort==='desc'?'降序 ↓':'升序 ↑')+'</button></div>'+
   '<div class="as-stats-rank-table" id="asStatRankTable">'+
   (selected.rankRows.length?selected.rankRows.map((r,i)=>'<button class="as-stats-rank-row" data-as-rank="'+escapeNameChar(r.key)+'" type="button" title="查看'+escapeNameChar(r.label)+'">'+
     '<span class="as-rank-index">'+String(i+1).padStart(2,'0')+'</span>'+
     '<span class="as-rank-name">'+escapeNameChar(r.label)+'</span>'+
     '<strong>'+asStatNumber(r.value)+'</strong><span class="as-rank-unit">'+escapeNameChar(selected.effectiveUnit)+'</span>'+
     '<span class="as-rank-chevron">›</span></button>').join(''):'<p class="as-stats-empty">本月暂无该指标的记录</p>')+'</div></div></div>'+
  '<div class="as-stats-foot"><span>'+escapeNameChar(warning)+'</span>'+
  (unavailable?'<strong>当前未导入此类记录</strong>':'')+
  '<span>点击图表或排行可进入对应组别、人员或日期</span></div></section>';
}
function asStatDrill(key){
 const data=asStatRows(),row=data.rows.find(r=>r.key===key);
 if(!row)return;
 if(row.type==='group'){
  state.workspaceMode='group';state.selectedGroup=row.key;
  state.selection={type:'overall'};state.analyticsPage='stats';state.statsConfig.compare='people';render();return;
 }
 if(row.type==='person'){
  state.workspaceMode='person';state.selection={type:'cell',employeeId:row.key,day:1};
  state.chartDay=1;state.chartTab='timeline';state.analyticsPage='stats';state.statsConfig.compare='days';
  state.statsConfig.chart='line';state.statsConfig.aggregate='total';render();return;
 }
 if(row.type==='day'){
  if(state.workspaceMode==='person')changePersonalDay(Number(key));
  else{state.analyticsPage='main';state.selection={type:'date',day:Number(key)};render()}
 }
}
function asStatExport(){
 const data=asStatRows(),c=asStatPrefs(),metric=asStatMetric(),header=['对象','指标','统计方式','数值','单位','员工数','应出勤人日'];
 const escape=s=>'"'+String(s).replace(/"/g,'""')+'"';
 const csv=[header,...data.rows.map(r=>[r.label,metric[1],c.aggregate,r.value,data.effectiveUnit,r.peopleCount,r.scheduled])].
  map(row=>row.map(escape).join(',')).join('\r\n');
 downloadBlob(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),monthKey()+'_统计_'+c.family+'_'+c.metric+'.csv');
 toast('已导出当前指标统计明细');
}
function renderStatisticsWorkspace(){
 const node=document.getElementById('statisticsWorkspace');
 if(!node||state.analyticsPage!=='stats'||state.workspaceMode==='data'||state.workspaceMode==='classic')return;
 if(typeof disposeAttendCharts==='function')disposeAttendCharts();
 const c=asStatPrefs();
 node.innerHTML=statisticsWorkspaceHtml();
 node.querySelector('#asStatFamily').onchange=e=>{
  c.family=e.target.value;c.metric=asStatFamily(c.family)[2][0][0];
  if(c.aggregate==='per100'&&c.metric==='people')c.aggregate='total';
  renderStatisticsWorkspace();
 };
 node.querySelector('#asStatMetric').onchange=e=>{c.metric=e.target.value;if(c.metric==='people')c.aggregate='total';renderStatisticsWorkspace()};
 node.querySelector('#asStatCompare').onchange=e=>{
  c.compare=e.target.value;
  if(c.compare==='days')c.chart='line';else c.chart='bar';
  renderStatisticsWorkspace();
 };
 node.querySelector('#asStatAggregate').onchange=e=>{c.aggregate=e.target.value;renderStatisticsWorkspace()};
 node.querySelector('#asStatLimit').onchange=e=>{c.limit=e.target.value;renderStatisticsWorkspace()};
 node.querySelector('#asStatSort').onclick=()=>{c.sort=c.sort==='desc'?'asc':'desc';renderStatisticsWorkspace()};
 node.querySelectorAll('[data-as-chart]').forEach(b=>b.onclick=()=>{c.chart=b.dataset.asChart;renderStatisticsWorkspace()});
 node.querySelectorAll('[data-as-rank]').forEach(b=>b.onclick=()=>asStatDrill(b.dataset.asRank));
 node.querySelector('#asStatsExport').onclick=asStatExport;
 const data=asStatRows(),chart=initAttendChart(document.getElementById('asStatChart'));
 if(!chart)return;
 const isDay=data.compare==='days',line=c.chart==='line';
 // ECharts' category Y axis grows upward: reverse the bar data so the largest
 // ranked item is at the top, just as it is in the ranking table.
 const rows=!isDay&&!line?data.visible.slice().reverse():data.visible;
 const cat=rows.map(x=>x.label),values=rows.map(x=>Number(x.value.toFixed(3)));
 chart.setOption({animation:state.prefs?.motion!==false,animationDuration:290,
  grid:isDay||line?{top:23,bottom:40,left:52,right:21}:{top:14,bottom:30,left:92,right:42,containLabel:false},
  tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>{
   const point=p[0],row=rows[point.dataIndex];
   return escapeNameChar(row.label)+'<br><b>'+asStatNumber(row.value)+' '+escapeNameChar(data.effectiveUnit)+'</b>'+
    '<br>范围 '+row.peopleCount+' 人 · '+row.scheduled+' 应出勤人日';
  }},
  xAxis:!isDay&&!line?{type:'value',axisLabel:{fontSize:12,color:'#73899c'},splitLine:{lineStyle:{color:'#eaf0f3'}},axisLine:{show:false}}:
   {type:'category',data:cat,axisLabel:{fontSize:12,color:'#668196',interval:isDay?Math.max(0,Math.floor(cat.length/12)):0},
    axisTick:{show:false},axisLine:{lineStyle:{color:'#d9e4eb'}}},
  yAxis:!isDay&&!line?{type:'category',data:cat,axisLabel:{fontSize:13,color:'#466477',width:79,overflow:'truncate'},
    axisLine:{show:false},axisTick:{show:false}}:
   {type:'value',min:0,axisLabel:{fontSize:12,color:'#73899c'},splitLine:{lineStyle:{color:'#eaf0f3'}},axisLine:{show:false}},
  series:[{type:line?'line':'bar',data:values,barMaxWidth:22,smooth:false,symbolSize:7,
   itemStyle:{color:'#5799c7',borderRadius:line?0:[0,4,4,0]},lineStyle:{width:2.5,color:'#5799c7'},
   areaStyle:line?{color:'rgba(91,158,202,.07)'}:undefined,
   showBackground:!line&&!isDay,backgroundStyle:{color:'#f0f5f8'}}]});
 chart.on('click',e=>{const row=rows[e.dataIndex];if(row)asStatDrill(row.key)});
}
