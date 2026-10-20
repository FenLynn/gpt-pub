/* R45: one auditable attendance statistics ledger for every analysis scope.
 * No remote services, no duplicate interpretation of employee-day verdicts. */
const AS_STAT_FAMILIES=[
 ['leave','请假',[['hours','记载请假工时','小时'],['count','请假记录数','条'],['people','涉及人数','人']]],
 ['trip','出差',[['days','出差日数','人日'],['estimatedHours','折算出差工时','小时'],['count','出差记录数','次'],['people','涉及人数','人']]],
 ['outing','外出',[['hours','记载外出时长','小时'],['count','外出记录数','次'],['people','涉及人数','人']]],
 ['overtime','加班',[['hours','记载加班时长','小时'],['count','加班记录数','次'],['people','涉及人数','人'],
  ['candidateHours','自动推算候选工时','小时'],['candidateDays','加班候选人日','人日'],['candidatePeople','加班候选人数','人']]],
 ['punch','打卡',[['count','打卡记录数','次'],['people','打卡人数','人']]],
 ['status','考勤状态',[['normal','正常工作人日','人日'],['anomaly','异常工作人日','人日'],['absent','缺勤工作人日','人日'],['issue','异常及缺勤人日','人日'],['late','迟到人日','人日'],['early','早退人日','人日']]]
];
function asStatFamily(k){return AS_STAT_FAMILIES.find(f=>f[0]===k)||AS_STAT_FAMILIES[0]}
function asStatScopeMode(){return state.workspaceMode==='stats'?(state.statsScope||'all'):state.workspaceMode}
function asStatScopeGroup(){
 return state.workspaceMode==='stats'?(state.statsGroup||workspaceGroups()[0]||''):state.selectedGroup;
}
function asStatScopePerson(){
 return state.workspaceMode==='stats'?(state.statsPersonId||
  EMPLOYEES.find(e=>groupOf(e)===asStatScopeGroup())?.id||EMPLOYEES[0]?.id):
  state.selection.employeeId;
}
function asStatDefaultCompare(mode){return mode==='person'?'days':mode==='group'?'people':'groups'}
function asStatVisibleMetrics(family,compare,mode){
 // Distinct-person indicators against single people are just 0/1 and add
 // no information. Keep person counts for cross-group/monthly trends instead.
 return asStatFamily(family)[2].filter(m=>
  !( ['people','candidatePeople'].includes(m[0])&&(mode==='person'||compare==='people')));
}
function asStatPrefs(){
 if(!state.statsConfig)state.statsConfig={family:'leave',metric:'hours',compare:null,aggregate:'total',chart:'bar',limit:10,sort:'desc'};
 const cfg=state.statsConfig;
 const mode=asStatScopeMode();
 if(!['groups','people','days'].includes(cfg.compare))cfg.compare=asStatDefaultCompare(mode);
 if(mode==='person')cfg.compare='days';
 if(mode==='group'&&cfg.compare==='groups')cfg.compare='people';
 // Rankings are categorical comparisons: a 50-name connected line is misleading.
 if(cfg.compare!=='days')cfg.chart='bar';
 const metrics=asStatVisibleMetrics(cfg.family,cfg.compare,mode);
 if(!metrics.some(m=>m[0]===cfg.metric))cfg.metric=metrics[0][0];
 if(!['total','perPerson','per100'].includes(cfg.aggregate))cfg.aggregate='total';
 // An individual's per-person value equals the total; don't offer a
 // mathematically identical normalization beside the raw value.
 if(cfg.compare==='people'||mode==='person'){
  if(cfg.aggregate==='perPerson')cfg.aggregate='total';
 }
 if(['people','candidatePeople'].includes(cfg.metric))cfg.aggregate='total';
 return cfg;
}
function asStatMetric(){const c=asStatPrefs();return asStatFamily(c.family)[2].find(m=>m[0]===c.metric)}
function asStatSelectedPeople(){
 const m=asStatScopeMode();
 if(m==='person')return EMPLOYEES.filter(e=>e.id===(asStatScopePerson()||EMPLOYEES[0]?.id));
 if(m==='group')return EMPLOYEES.filter(e=>groupOf(e)===asStatScopeGroup());
 return EMPLOYEES;
}
function asStatWorkMinutes(){return Math.max(0,minutes(RULES.amEnd)-minutes(RULES.amStart))+
 Math.max(0,minutes(RULES.pmEnd)-minutes(RULES.pmStart))}
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
  add('leave','presence',id,d,1);
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
    add('trip','presence',id,d,1);
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
   add('outing','presence',id,d,1);
   putInterval('outing',id,d,r.start,r.end,false);
  }
  if(first!=null)add('outing','count',id,first,1);
 });
 apply(state.overtimeEntries,'overtime',(r,id)=>{
  if(!String(r.date||'').startsWith(monthISO()+'-'))return;
  const d=Number(String(r.date).slice(8,10));
  add('overtime','count',id,d,1);
  add('overtime','presence',id,d,1);
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
  const day=Number(date.slice(8,10));
  add('punch','count',id,day,1);
  add('punch','presence',id,day,1);
 });
 for(const a of state.analysis.values()){
  if(a.autoOvertime?.minutes>0){
   add('overtime','candidateHours',a.employee.id,a.day,a.autoOvertime.minutes/60);
   add('overtime','candidateDays',a.employee.id,a.day,1);
   add('overtime','candidatePresence',a.employee.id,a.day,1);
  }
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
 if(metric==='people'||metric==='candidatePeople'){
  // Count distinct employee IDs in the selected date window, not only the
  // first calendar day where a multi-day event happened to be recorded.
  const seen=new Set();
  for(const [key,value] of ledger){
   if(value<=0)continue;
   const [k,m,id,day]=key.split('|');
   if(k===family&&m===(metric==='candidatePeople'?'candidatePresence':'presence')&&
      ids.has(id)&&dateSet.has(Number(day)))seen.add(id);
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
 if(asStatScopeMode()==='person')compare='days';
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
 // Full rankings stay accessible in the list and exported CSV; only the plot
 // caps categorical names to 12 visible marks to avoid an unreadable 50-row grid.
 const chartRows=compare==='days'?counted:counted.slice(0,
   c.limit==='all'?Math.min(counted.length,12):Number(c.limit)||10);
 const nonzero=counted.filter(r=>r.raw>0);
 const rankPool=compare==='days'?nonzero.sort((a,b)=>
   c.sort==='asc'?a.value-b.value||a.key-b.key:b.value-a.value||a.key-b.key):nonzero;
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
function asStatRankBreakdown(row,data){
 const cfg=asStatPrefs(),family=cfg.family,metric=cfg.metric;
 // Use the same shared ledger as the plot; do not calculate new verdicts.
 if(row.type==='day'&&asStatScopeMode()==='person'){
  const a=state.analysis.get((asStatScopePerson()||'')+'|'+Number(row.key));
  if(!a)return '';
  return '<div class="as-rank-breakdown"><span>当日打卡证据</span><p>首进 '+escapeNameChar(a.firstIn?.slice(0,5)||'—')+
   ' · 末出 '+escapeNameChar(a.lastOut?.slice(0,5)||'—')+
   ' · 班内工时 '+asStatNumber((a.workMinutes||0)/60)+' 小时</p>'+
   (a.lunchEvidence?'<p>'+escapeNameChar(a.lunchEvidence)+'</p>':'')+'</div>';
 }
 const dimensions=row.type==='group'?row.people.map(e=>({label:e.name,people:[e],days:row.days})):
  row.type==='person'?row.days.map(d=>({label:pad(d)+' 日',people:row.people,days:[d]})):
  asStatScopeMode()==='all'?workspaceGroups().map(g=>({
    label:g,people:row.people.filter(e=>groupOf(e)===g),days:row.days
  })):row.people.map(e=>({label:e.name,people:[e],days:row.days}));
 const ranked=dimensions.map(d=>({...d,value:asStatValue(data.ledger,family,metric,d.people,d.days)}))
  .filter(d=>d.value>0).sort((a,b)=>b.value-a.value).slice(0,5);
 if(!ranked.length)return '<p class="as-rank-breakdown-empty">当前范围没有可细分记录</p>';
 return '<div class="as-rank-breakdown"><span>主要贡献明细（原始量）</span>'+
  ranked.map(d=>'<div><span>'+escapeNameChar(d.label)+'</span><strong>'+
   asStatNumber(d.value)+' '+escapeNameChar(data.unit)+'</strong></div>').join('')+'</div>';
}
function statisticsWorkspaceHtml(){
 const c=asStatPrefs(),met=asStatMetric(),mode=asStatScopeMode();
 const groups=workspaceGroups(),scopeGroup=asStatScopeGroup()||groups[0]||'';
 const scopePeople=EMPLOYEES.filter(e=>groupOf(e)===scopeGroup);
 const chosenPerson=asStatScopePerson()||scopePeople[0]?.id||EMPLOYEES[0]?.id||'';
 const comparisons=mode==='person'?[['days','每日趋势']]:
  mode==='group'?[['people','组内人员'],['days','每日趋势']]:
   [['groups','各组对比'],['people','全员排名'],['days','每日趋势']];
 const selected=asStatRows(),scopedLabel=mode==='person'?(selected.people[0]?.name||'个人'):
  mode==='group'?scopeGroup:'全体员工';
 const warning=c.family==='trip'?'出差日数按自然日去重；工时按设定工作时段折算，不代表实际出差时长':
  c.family==='leave'?'请假按记录逐条计数，时长扣午休并合并重叠区间；记录数不等于申请次数':
  c.family==='outing'?'外出时长来自记录区间并去除重叠时段；跨日记录按每日时段折算':
  c.family==='overtime'?'登记加班与自动推算候选严格分开；候选只来自完整进出记录，不等于审批加班':
  c.family==='punch'?'每条原始打卡计一次，重复打卡仍按实际记录计入':
  '工作日的考勤状态与当前初始／人工判定视图保持一致';
 const unavailable=(c.family==='outing'&&!state.outings?.length)||
  (c.family==='overtime'?(c.metric.startsWith('candidate')?
   ![...state.analysis.values()].some(a=>a.autoOvertime?.minutes>0):
   !state.overtimeEntries?.length):false);
 const aggregates=[['total','总量'],['perPerson','人均'],['per100','每百应出勤人日']]
   .filter(x=>x[0]!=='perPerson'||(c.compare!=='people'&&mode!=='person'));
 const selectionGroup=(mode==='group'||mode==='person')?
  '<label>组别<select id="asStatsGroup">'+asStatOptions(groups.map(g=>[g,g]),scopeGroup)+'</select></label>':'';
 const selectionPerson=mode==='person'?
  '<label>人员<select id="asStatsPerson">'+asStatOptions(scopePeople.map(e=>[e.id,e.name]),chosenPerson)+'</select></label>':'';
 const chartHint=selected.compare!=='days'&&selected.rows.length>selected.visible.length?
  '图表显示前 '+selected.visible.length+' 项，右侧榜单可查看'+(c.limit==='all'?'全部':'更多')+'记录':'';
 const chartTitle=met[1]+' · '+(comparisons.find(x=>x[0]===c.compare)?.[1]||'统计');
 const ranking=selected.rankRows.length?selected.rankRows.map((r,i)=>{
  const detailId='asRankDetail'+i,expanded=state.statsExpandedKey===r.type+'|'+r.key;
  return '<div class="as-rank-entry"><button class="as-stats-rank-row'+(expanded?' is-expanded':'')+
   '" data-as-rank="'+escapeNameChar(r.key)+'" type="button" aria-expanded="'+expanded+
   '" aria-controls="'+detailId+'" title="单击展开详情，双击进入分析">'+
   '<span class="as-rank-index">'+String(i+1).padStart(2,'0')+'</span>'+
   '<span class="as-rank-name">'+escapeNameChar(r.label)+'</span>'+
   '<strong>'+asStatNumber(r.value)+'</strong><span class="as-rank-unit">'+escapeNameChar(selected.effectiveUnit)+'</span>'+
   '<span class="as-rank-chevron" aria-hidden="true">⌄</span></button>'+
   '<div class="as-rank-detail" id="'+detailId+'" '+(expanded?'':'hidden')+'>'+
   '<div class="as-rank-detail-grid">'+
   '<span>统计对象<strong>'+escapeNameChar(r.label)+'</strong></span>'+
   '<span>涉及人员<strong>'+r.peopleCount+' 人</strong></span>'+
   '<span>应出勤<strong>'+r.scheduled+' 人日</strong></span>'+
   (c.aggregate!=='total'?'<span>原始总量<strong>'+asStatNumber(r.raw)+' '+escapeNameChar(selected.unit)+'</strong></span>':'')+
   '</div><div class="as-rank-breakdown-slot">'+(expanded?asStatRankBreakdown(r,selected):'')+
   '</div><button class="as-rank-drill" type="button" data-as-drill="'+escapeNameChar(r.key)+'">进入下级分析 <span aria-hidden="true">↗</span></button></div></div>';
 }).join(''):'<p class="as-stats-empty">本月暂无该指标的记录</p>';
 return '<section class="as-stats" aria-label="考勤统计工作台">'+
  '<header class="as-stats-heading"><div><h2>考勤统计</h2><span>'+
  escapeNameChar(periodText())+' · '+escapeNameChar(scopedLabel)+' · '+selected.people.length+' 人</span></div>'+
  '<div class="as-stats-heading-actions"><div class="as-stats-scope" aria-label="统计范围">'+
  '<label>范围<select id="asStatsScope">'+asStatOptions([['all','全员'],['group','组别'],['person','个人']],mode)+'</select></label>'+
  selectionGroup+selectionPerson+'</div>'+
  '<button id="asStatsExport" type="button" class="as-stats-export" title="导出当前指标的明细 CSV">导出数据 ↗</button></div></header>'+
  '<div class="as-stats-filters" aria-label="统计图表筛选">'+
   '<label>业务<select id="asStatFamily">'+asStatOptions(AS_STAT_FAMILIES.map(f=>[f[0],f[1]]),c.family)+'</select></label>'+
   '<label>指标<select id="asStatMetric">'+asStatOptions(asStatVisibleMetrics(c.family,c.compare,mode).map(m=>[m[0],m[1]]),c.metric)+'</select></label>'+
   '<label>对比对象<select id="asStatCompare">'+asStatOptions(comparisons,c.compare)+'</select></label>'+
   '<label>统计方式<select id="asStatAggregate">'+asStatOptions(aggregates,c.aggregate)+'</select></label>'+
   '<label>排序范围<select id="asStatLimit">'+asStatOptions([['5','前 5'],['10','前 10'],['all','全部']],String(c.limit))+'</select></label>'+
  '</div>'+
  '<div class="as-stats-inline" aria-live="polite">'+
   '<div><span>'+(c.aggregate==='total'?'范围总量':c.aggregate==='perPerson'?'人均':'每百人日')+'</span>'+
   '<strong>'+asStatNumber(selected.total)+' <small>'+escapeNameChar(selected.effectiveUnit)+'</small></strong></div>'+
   '<div><span>员工</span><strong>'+selected.people.length+' <small>人</small></strong></div>'+
   '<div><span>应出勤</span><strong>'+selected.scheduled+' <small>人日</small></strong></div></div>'+
  '<div class="as-stats-visual"><div class="as-stats-chart"><div class="as-stats-chart-header">'+
   '<h3>'+escapeNameChar(chartTitle)+'</h3>'+
   '<div class="as-stats-chart-switch"><button type="button" data-as-chart="bar" aria-pressed="'+(c.chart==='bar')+'" class="'+(c.chart==='bar'?'active':'')+'">柱状</button>'+
   '<button type="button" data-as-chart="line" aria-pressed="'+(c.chart==='line')+'" class="'+(c.chart==='line'?'active':'')+
   '" '+(selected.compare==='days'?'':'disabled title="日期趋势才适合折线图"')+'>折线</button></div></div>'+
   '<div id="asStatChart" class="as-stats-chart-canvas" aria-label="交互式统计图表"></div>'+
   (chartHint?'<p class="as-stats-chart-hint">'+escapeNameChar(chartHint)+'</p>':'')+
   '<div class="as-stats-chart-empty">当前指标没有可绘制的记录</div></div>'+
   '<div class="as-stats-rank"><div class="as-stats-rank-head"><h3>排行榜 · 点击展开</h3>'+
    '<button id="asStatSort" type="button" title="调整排名方向">'+(c.sort==='desc'?'降序 ↓':'升序 ↑')+'</button></div>'+
   '<div class="as-stats-rank-table" id="asStatRankTable">'+ranking+'</div></div></div>'+
  '<div class="as-stats-foot"><span>'+escapeNameChar(warning)+'</span>'+
  (unavailable?'<strong>当前未导入此类记录</strong>':'')+
  '<span>单击排行展开详情，双击或使用“进入下级分析”导航；图表按相同方式操作</span></div></section>';
}
function asStatDrill(key){
 const row=asStatRows().rows.find(r=>r.key===key);
 if(!row)return;
 state.statsExpandedKey='';
 if(row.type==='group'){
  state.statsScope='group';state.statsGroup=row.key;
  state.statsPersonId=EMPLOYEES.find(e=>groupOf(e)===row.key)?.id||'';
  state.statsConfig.compare='people';state.statsConfig.chart='bar';
  render();return;
 }
 if(row.type==='person'){
  state.statsScope='person';state.statsPersonId=row.key;
  state.statsGroup=groupOf(EMPLOYEES.find(e=>e.id===row.key));
  state.statsConfig.compare='days';state.statsConfig.chart='line';
  state.statsConfig.aggregate='total';render();return;
 }
 if(row.type==='day'){
  // Capture the source scope before changing workspaces. Otherwise the helper
  // would read a different (or unset) ID after switching to personal analysis.
  const day=Number(key),scope=asStatScopeMode(),
    sourcePerson=asStatScopePerson(),sourceGroup=asStatScopeGroup();
  if(scope==='person'){
   state.workspaceMode='person';state.analyticsPage='main';
   state.selection={type:'cell',employeeId:sourcePerson,day};
   state.chartDay=day;state.chartTab='timeline';
   state.timelineRange=null;state.rawPage=1;
  }else{
   state.workspaceMode=scope==='group'?'group':'all';
   if(scope==='group')state.selectedGroup=sourceGroup;
   state.analyticsPage='main';state.selection={type:'date',day};
   state.chartDay=day;state.chartTab='overview';
  }
  render();
 }
}
function asStatCSVCell(value){
 let str=String(value);
 if(/^[\s]*[=+\-@]/.test(str))str="'"+str;
 return '"'+str.replace(/"/g,'""')+'"';
}
function asStatExport(){
 const data=asStatRows(),c=asStatPrefs(),metric=asStatMetric(),header=['对象','指标','统计方式','数值','单位','员工数','应出勤人日'];
 const csv=[header,...data.rows.map(r=>[r.label,metric[1],c.aggregate,r.value,data.effectiveUnit,r.peopleCount,r.scheduled])].
  map(row=>row.map(asStatCSVCell).join(',')).join('\r\n');
 downloadBlob(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),monthKey()+'_统计_'+c.family+'_'+c.metric+'.csv');
 toast('已导出当前指标统计明细');
}
function renderStatisticsWorkspace(){
 const node=document.getElementById('statisticsWorkspace');
 if(!node||state.workspaceMode!=='stats')return;
 if(typeof disposeAttendCharts==='function')disposeAttendCharts();
 const oldFocus=document.activeElement,inside=node.contains(oldFocus);
 const focusId=inside?oldFocus.id:'';
 const focusChart=inside?oldFocus.dataset?.asChart:null;
 const c=asStatPrefs();
 node.innerHTML=statisticsWorkspaceHtml();
 node.querySelector('#asStatsScope').onchange=e=>{
  state.statsScope=e.target.value;
  state.statsGroup=asStatScopeGroup();
  if(state.statsScope==='person')state.statsPersonId=
    EMPLOYEES.find(p=>groupOf(p)===state.statsGroup)?.id||EMPLOYEES[0]?.id||'';
  c.compare=asStatDefaultCompare(state.statsScope);
  c.chart=state.statsScope==='person'?'line':'bar';
  state.statsExpandedKey='';
  // Only the statistical workbench needs redrawing; keep header, scroll and
  // keyboard focus stable, while recording scope changes in view history.
  asNavTrack();renderStatisticsWorkspace();
 };
 const groupSelect=node.querySelector('#asStatsGroup');
 if(groupSelect)groupSelect.onchange=e=>{
  state.statsGroup=e.target.value;
  state.statsPersonId=EMPLOYEES.find(p=>groupOf(p)===state.statsGroup)?.id||'';
  state.statsExpandedKey='';
  asNavTrack();renderStatisticsWorkspace();
 };
 const personSelect=node.querySelector('#asStatsPerson');
 if(personSelect)personSelect.onchange=e=>{
  state.statsPersonId=e.target.value;state.statsExpandedKey='';
  asNavTrack();renderStatisticsWorkspace();
 };
 node.querySelector('#asStatFamily').onchange=e=>{
  c.family=e.target.value;c.metric=asStatFamily(c.family)[2][0][0];
  if(c.metric==='people'||c.metric==='candidatePeople')c.aggregate='total';
  renderStatisticsWorkspace();
 };
 node.querySelector('#asStatMetric').onchange=e=>{c.metric=e.target.value;if(c.metric==='people'||c.metric==='candidatePeople')c.aggregate='total';renderStatisticsWorkspace()};
 node.querySelector('#asStatCompare').onchange=e=>{
  c.compare=e.target.value;
  c.chart=c.compare==='days'?'line':'bar';
  state.statsExpandedKey='';
  renderStatisticsWorkspace();
 };
 node.querySelector('#asStatAggregate').onchange=e=>{c.aggregate=e.target.value;renderStatisticsWorkspace()};
 node.querySelector('#asStatLimit').onchange=e=>{c.limit=e.target.value;renderStatisticsWorkspace()};
 node.querySelector('#asStatSort').onclick=()=>{c.sort=c.sort==='desc'?'asc':'desc';renderStatisticsWorkspace()};
 node.querySelectorAll('[data-as-chart]').forEach(b=>b.onclick=()=>{c.chart=b.dataset.asChart;renderStatisticsWorkspace()});
 const toggleRank=(key,scroll=false)=>{
  const match=asStatRows().rankRows.find(r=>r.key===key);
  if(!match)return;
  const token=match.type+'|'+match.key;
  state.statsExpandedKey=state.statsExpandedKey===token?'':token;
  node.querySelectorAll('.as-rank-entry').forEach(entry=>{
   const trigger=entry.querySelector('[data-as-rank]'),detail=entry.querySelector('.as-rank-detail');
   const expanded=!!trigger&&trigger.dataset.asRank===key&&state.statsExpandedKey===token;
   trigger?.setAttribute('aria-expanded',String(expanded));
   trigger?.classList.toggle('is-expanded',expanded);
   if(detail)detail.hidden=!expanded;
   entry.classList.toggle('is-expanded',expanded);
   if(expanded){
    const slot=entry.querySelector('.as-rank-breakdown-slot');
    if(slot)slot.innerHTML=asStatRankBreakdown(match,asStatRows());
   }
  });
  if(scroll&&state.statsExpandedKey){
   const target=[...node.querySelectorAll('[data-as-rank]')].find(b=>b.dataset.asRank===key);
   target?.scrollIntoView({block:'nearest',inline:'nearest'});
  }
  if(typeof asNavRefreshCurrent==='function')asNavRefreshCurrent();
 };
 node.querySelectorAll('[data-as-rank]').forEach(b=>{
  b.onclick=()=>toggleRank(b.dataset.asRank);
  b.ondblclick=()=>asStatDrill(b.dataset.asRank);
 });
 node.querySelectorAll('[data-as-drill]').forEach(b=>b.onclick=()=>asStatDrill(b.dataset.asDrill));
 node.querySelector('#asStatsExport').onclick=asStatExport;
 if(typeof asNavRefreshCurrent==='function')asNavRefreshCurrent();
 const data=asStatRows(),chart=initAttendChart(document.getElementById('asStatChart'));
 node.querySelector('.as-stats-chart').classList.toggle('is-empty',!data.rows.some(r=>r.raw>0));
 if(!chart)return;
 const isDay=data.compare==='days',line=c.chart==='line';
 // ECharts' category Y axis grows upward: reverse the bar data so the largest
 // ranked item is at the top, just as it is in the ranking table.
 const rows=!isDay&&!line?data.visible.slice().reverse():data.visible;
 const cat=rows.map(x=>x.label),values=rows.map(x=>Number(x.value.toFixed(3)));
 const gradient=line?'#648d7e':asSoftBarGradient(!isDay);
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
  series:[{type:line?'line':'bar',data:values,barMaxWidth:16,smooth:false,symbolSize:6,
   itemStyle:{color:gradient,opacity:line?1:.9,borderRadius:line?0:!isDay?[0,7,7,0]:[7,7,0,0]},
   lineStyle:{width:2.2,color:'#648d7e'},
   areaStyle:line?{color:'rgba(103,153,129,.06)'}:undefined,
   showBackground:!line&&!isDay,backgroundStyle:{color:'rgba(107,149,130,.055)'}}]});
 // Rank cells and chart marks refer to the same comparison entity.
 const ranking=[...node.querySelectorAll('[data-as-rank]')];
 const emphasize=(key,show)=>{
  ranking.forEach(b=>b.classList.toggle('is-linked',show&&b.dataset.asRank===key));
  const idx=rows.findIndex(r=>r.key===key);
  if(idx<0)return;
  chart.dispatchAction({type:show?'highlight':'downplay',seriesIndex:0,dataIndex:idx});
  if(show)chart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:idx});
  else chart.dispatchAction({type:'hideTip'});
 };
 ranking.forEach(b=>{
  b.addEventListener('mouseenter',()=>emphasize(b.dataset.asRank,true));
  b.addEventListener('mouseleave',()=>emphasize(b.dataset.asRank,false));
  b.addEventListener('focus',()=>emphasize(b.dataset.asRank,true));
  b.addEventListener('blur',()=>emphasize(b.dataset.asRank,false));
 });
 chart.on('mouseover',e=>{const item=rows[e.dataIndex];if(item)emphasize(item.key,true)});
 chart.on('globalout',()=>ranking.forEach(b=>b.classList.remove('is-linked')));
 chart.on('click',e=>{const row=rows[e.dataIndex];if(row)toggleRank(row.key,true)});
 chart.on('dblclick',e=>{const row=rows[e.dataIndex];if(row)asStatDrill(row.key)});
 // Changes reconstruct the controls; keep their keyboard focus in place.
 const next=focusId?document.getElementById(focusId):
  focusChart?node.querySelector('[data-as-chart="'+focusChart+'"]'):null;
 if(next&&node.contains(next))next.focus({preventScroll:true});
}
