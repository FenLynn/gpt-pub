/* R45: one auditable attendance statistics ledger for every analysis scope.
 * No remote services, no duplicate interpretation of employee-day verdicts. */
const AS_STAT_PALETTES=Object.freeze({
 leave:{top:'#8064c9',bottom:'#c0afe9',hover:'#6245b1'},
 trip:{top:'#6377d1',bottom:'#aab9f1',hover:'#4159b5'},
 outing:{top:'#3594b9',bottom:'#a1d7e9',hover:'#237499'},
 overtime:{top:OVERTIME_VISUALS.registered.top,bottom:OVERTIME_VISUALS.registered.bottom,hover:'#a94451'},
 punch:{top:'#5089c8',bottom:'#a9c9ed',hover:'#316dae'},
 status:{top:'#54a78b',bottom:'#b2ddca',hover:'#348269'}
});
function asStatPalette(family,metric){
 if(family==='overtime'&&metric?.startsWith('candidate'))return {
  top:OVERTIME_VISUALS.auto.top,bottom:OVERTIME_VISUALS.auto.bottom,hover:OVERTIME_VISUALS.auto.hoverTop};
 if(family==='status'){
  // Verdict meanings must remain legible: absence and lateness are not
  // represented by the same green as normal attendance.
  const verdictColors={
   anomaly:{top:'#caa351',bottom:'#ebd8a5',hover:'#aa7d2f'},
   absent:{top:'#cb757f',bottom:'#ecc1c4',hover:'#ac4f5c'},
   issue:{top:'#bc8a65',bottom:'#e8c5a8',hover:'#996440'},
   late:{top:'#c18461',bottom:'#ebbea5',hover:'#a05d3b'},
   early:{top:'#bf8069',bottom:'#ebbfad',hover:'#9c5d45'}
  };
  return verdictColors[metric]||AS_STAT_PALETTES.status;
 }
 return AS_STAT_PALETTES[family]||AS_STAT_PALETTES.punch;
}
const AS_STAT_FAMILIES=[
 ['leave','请假',[['hours','记载请假工时','小时'],['count','请假记录数','条'],['people','涉及人数','人']]],
 ['trip','出差',[['days','出差日数','人日'],['estimatedHours','折算出差工时','小时'],['count','出差记录数','次'],['people','涉及人数','人']]],
 ['outing','外出',[['hours','记载外出时长','小时'],['count','外出记录数','次'],['people','涉及人数','人']]],
 ['overtime','加班',[['hours','加班合计时长','小时'],['registeredHours','登记加班时长','小时'],
  ['count','加班条目数','条'],['registeredCount','登记记录数','条'],
  ['candidateCount','自动连续会话数','次'],['independentCount','独立加班次数','次'],['people','涉及人数','人'],
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
 if(!state.statsConfig)state.statsConfig={family:'leave',metric:'hours',compare:null,aggregate:'total',chart:'bar',limit:'all',sort:'desc'};
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
 const registeredByDay=new Map();
 apply(attendanceAdjacentRows('overtimeEntries'),'overtime',(r,id)=>{
  const date=String(r.date||''),clockStart=minutes(r.start),clockEnd=minutes(r.end);
  if(!date||!Number.isFinite(clockStart)||!Number.isFinite(clockEnd))return;
  const start=attendanceUtcMinute(date,r.start),
   finish=attendanceUtcMinute(date,r.end)+(clockEnd<clockStart?1440:0);
  if(finish<=start||finish-start>1440)return;
  if(date.startsWith(monthISO()+'-')){
   add('overtime','count',id,Number(date.slice(8,10)),1);
   add('overtime','registeredCount',id,Number(date.slice(8,10)),1);
  }
  for(let day=1;day<=dayCount;day++){
   const dayStart=attendanceUtcMinute(isoDate(day)),dayEnd=dayStart+1440;
   if(start>=dayEnd||finish<=dayStart)continue;
   const x=Math.max(start,dayStart)-dayStart,y=Math.min(finish,dayEnd)-dayStart;
   const key=id+'|'+day,list=registeredByDay.get(key)||[];
   list.push([x,y]);registeredByDay.set(key,list);
   add('overtime','presence',id,day,1);
   putInterval('overtime',id,day,attendanceClock(x),attendanceClock(y),false);
  }
 });
 // User-included inferred intervals coexist with registered overtime. They are
 // disjoint by construction; both use the same hour/people/count ledger keys.
 for(const a of state.analysis.values()){
  const active=activeAutoOvertimeSegments(a);
  if(!active.length)continue;
  const distinctSessions=new Set();
  for(const seg of active){
   const key='overtime|'+a.employee.id+'|'+a.day;
   const intervals=coveredIntervals.get(key)||[];
   intervals.push([seg.from,seg.to]);
   coveredIntervals.set(key,intervals);
   const session=seg.id||seg.sessionFrom+'|'+seg.sessionTo;
   if(!distinctSessions.has(session)){
    distinctSessions.add(session);
    if(attendanceDateFromMinute(seg.sessionFrom??attendanceUtcMinute(a.date,attendanceClock(seg.from)))===a.date){
     add('overtime','count',a.employee.id,a.day,1);
     add('overtime','candidateCount',a.employee.id,a.day,1);
    }
   }
  }
  add('overtime','presence',a.employee.id,a.day,1);
 }
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
  if(kind==='overtime'){
   // Registered-only amount is calculated from its separate source, excluding
   // inferred segments, to keep an auditable disaggregation.
   const registered=analysisUnionMinutes(registeredByDay.get(id+'|'+d)||[]);
   add(kind,'registeredHours',id,Number(d),registered/60);
  }
 }
 apply(state.records,'punch',(r,id)=>{
  const date=String(r.datetime||'').slice(0,10);
  if(!date.startsWith(monthISO()+'-'))return;
  const day=Number(date.slice(8,10));
  add('punch','count',id,day,1);
  add('punch','presence',id,day,1);
 });
 for(const a of state.analysis.values()){
  const accepted=activeAutoOvertimeSegments(a);
  const countedMinutes=accepted.reduce((sum,seg)=>sum+seg.minutes,0);
  if(countedMinutes>0){
   add('overtime','candidateHours',a.employee.id,a.day,countedMinutes/60);
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
 // Actual overtime events are connected intervals, not source record counts.
 const physical=new Map(),seen=new Set();
 const collect=(id,from,to)=>{if(!id||!Number.isFinite(from)||!Number.isFinite(to)||to<=from)return;
  const v=physical.get(id)||[];v.push([from,to]);physical.set(id,v)};
 for(const r of attendanceAdjacentRows('overtimeEntries')){
  const start=attendanceUtcMinute(r.date,r.start),end=attendanceUtcMinute(r.date,r.end)+
   (minutes(r.end)<minutes(r.start)?1440:0),id=r.employeeId;
  const key=id+'|'+(r.id||r.importId+'|'+r.date+'|'+r.start+'|'+r.end);
  if(seen.has(key))continue;seen.add(key);collect(id,start,end);
 }
 for(const a of state.analysis.values())for(const seg of activeAutoOvertimeSegments(a)){
  const key='auto|'+seg.id;if(seen.has(key))continue;seen.add(key);
  collect(a.employee.id,seg.sessionFrom??attendanceUtcMinute(a.date,attendanceClock(seg.from)),
   seg.sessionTo??attendanceUtcMinute(a.date,attendanceClock(seg.to)));
 }
 for(const [id,list] of physical){
  list.sort((a,b)=>a[0]-b[0]);let start=null,end=null;
  const save=()=>{if(start==null)return;const date=attendanceDateFromMinute(start);
    if(date.startsWith(monthISO()+'-'))add('overtime','independentCount',id,Number(date.slice(8,10)),1)};
  for(const [from,to] of list){
   if(start===null){start=from;end=to}else if(from<=end)end=Math.max(end,to);
   else{save();start=from;end=to}
  }save();
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
 // The chart always shows every member/category. The ranking-limit selector
 // ONLY limits the right-side list, never the plot or aggregate facts.
 const chartRows=counted;
 const nonzero=counted.filter(r=>r.raw>0);
 const rankPool=compare==='days'?nonzero.sort((a,b)=>
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
function asStatRankBreakdown(row,data){
 const cfg=asStatPrefs(),family=cfg.family,metric=cfg.metric;
 // Use the same shared ledger as the plot; do not calculate new verdicts.
 if(row.type==='day'&&asStatScopeMode()==='person'){
  const a=state.analysis.get((asStatScopePerson()||'')+'|'+Number(row.key));
  if(!a)return '';
  const lines=[['首进',a.firstIn?.slice(0,5)||'—'],
   ['末出',a.lastOut?.slice(0,5)||'—'],
   ['班内工时',asStatNumber((a.workMinutes||0)/60)+' 小时']];
  if(a.lunchEvidence)lines.push(['午休证据',a.lunchEvidence]);
  return '<div class="as-rank-breakdown">'+lines.map(([k,v])=>
   '<div><span>'+escapeNameChar(k)+'</span><strong>'+escapeNameChar(v)+'</strong></div>').join('')+'</div>';
 }
 const dimensions=row.type==='group'?row.people.map(e=>({label:e.name,people:[e],days:row.days})):
  row.type==='person'?row.days.map(d=>({label:pad(d)+' 日',people:row.people,days:[d]})):
  asStatScopeMode()==='all'?workspaceGroups().map(g=>({
    label:g,people:row.people.filter(e=>groupOf(e)===g),days:row.days
  })):row.people.map(e=>({label:e.name,people:[e],days:row.days}));
 const ranked=dimensions.map(d=>({...d,value:asStatValue(data.ledger,family,metric,d.people,d.days)}))
  .filter(d=>d.value>0).sort((a,b)=>b.value-a.value).slice(0,5);
 if(!ranked.length)return '<p class="as-rank-breakdown-empty">当前范围没有可细分记录</p>';
 return '<div class="as-rank-breakdown">'+
  ranked.map(d=>'<div><span>'+escapeNameChar(d.label)+'</span><strong>'+
   asStatNumber(d.value)+' '+escapeNameChar(data.unit)+'</strong></div>').join('')+'</div>';
}
/* R69: all statistics filters belong to the sidebar, one control per row. */
function asStatSidebarFiltersHtml(){
 const c=asStatPrefs(),mode=asStatScopeMode();
 const comparisons=mode==='person'?[['days','每日趋势']]:
   mode==='group'?[['people','组内人员'],['days','每日趋势']]:
   [['groups','各组对比'],['people','全员排名'],['days','每日趋势']];
 const aggregates=[['total','总量'],['perPerson','人均'],['per100','每百应出勤人日']]
  .filter(x=>x[0]!=='perPerson'||(c.compare!=='people'&&mode!=='person'));
 return '<div class="r69-stats-section-title">图表筛选</div>'+
  '<div class="as-stats-filters r69-side-stat-filters" aria-label="统计图表筛选">'+
  '<label>业务<select id="asStatFamily">'+asStatOptions(AS_STAT_FAMILIES.map(f=>[f[0],f[1]]),c.family)+'</select></label>'+
  '<label>指标<select id="asStatMetric">'+asStatOptions(asStatVisibleMetrics(c.family,c.compare,mode).map(m=>[m[0],m[1]]),c.metric)+'</select></label>'+
  '<label>对比<select id="asStatCompare">'+asStatOptions(comparisons,c.compare)+'</select></label>'+
  '<label>统计<select id="asStatAggregate">'+asStatOptions(aggregates,c.aggregate)+'</select></label>'+
  '<label>榜单<select id="asStatLimit">'+asStatOptions([['5','前 5'],['10','前 10'],['all','全部']],String(c.limit))+'</select></label>'+
  '</div>';
}
function statisticsSidebarControlsHtml(){
 const mode=asStatScopeMode(),groups=workspaceGroups(),group=asStatScopeGroup()||groups[0]||'';
 const people=EMPLOYEES.filter(e=>groupOf(e)===group);
 const personId=asStatScopePerson()||people[0]?.id||EMPLOYEES[0]?.id||'';
 const groupControl=mode!=='all'?'<label class="stats-side-field">组别<select id="asStatsGroup">'+
   asStatOptions(groups.map(g=>[g,g]),group)+'</select></label>':'';
 const personControl=mode==='person'?'<label class="stats-side-field">人员<select id="asStatsPerson">'+
   asStatOptions(people.map(e=>[e.id,people.some(p=>p.id!==e.id&&p.name===e.name)?
     e.name+' · '+e.id:e.name]),personId)+'</select></label>':'';
 return '<div class="stats-side-heading">统计范围</div>'+
  '<label class="stats-side-field">范围<select id="asStatsScope">'+
  asStatOptions([['all','全员'],['group','组别'],['person','个人']],mode)+
  '</select></label>'+groupControl+personControl+
  asStatSidebarFiltersHtml();
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
  c.family==='overtime'?'登记加班与已勾选自动推算时段合并统计，取消勾选即排除；纳入统计不等于企业审批':
  c.family==='punch'?'每条原始打卡计一次，重复打卡仍按实际记录计入':
  '工作日的考勤状态与当前初始／人工判定视图保持一致';
 const unavailable=(c.family==='outing'&&!state.outings?.length)||
  (c.family==='overtime'?(c.metric.startsWith('candidate')?
   ![...state.analysis.values()].some(a=>activeAutoOvertimeSegments(a).length>0):
   !state.overtimeEntries?.length):false);
 const aggregates=[['total','总量'],['perPerson','人均'],['per100','每百应出勤人日']]
   .filter(x=>x[0]!=='perPerson'||(c.compare!=='people'&&mode!=='person'));
 const scopedTitle=mode==='all'?'全员（'+selected.people.length+'人）':
  mode==='group'?scopeGroup+'（'+selected.people.length+'人）':
   (selected.people[0]?.name||'个人')+
    (selected.people[0]&&EMPLOYEES.filter(e=>e.name===selected.people[0].name).length>1?
      ' · '+selected.people[0].id:'');
 const overtimeStack=c.family==='overtime'&&c.metric==='hours'&&c.chart==='bar';
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
   '<div class="as-rank-breakdown-slot">'+(expanded?asStatRankBreakdown(r,selected):'')+
   '</div><button class="as-rank-drill" type="button" data-as-drill="'+escapeNameChar(r.key)+'">进入下级分析 <span aria-hidden="true">↗</span></button></div></div>';
 }).join(''):'<p class="as-stats-empty">本月暂无该指标的记录</p>';
 return '<section class="as-stats" aria-label="考勤统计工作台">'+
  '<header class="as-stats-heading"><h2>考勤统计</h2>'+
  '<div class="as-stats-total" aria-live="polite"><span>'+
   (c.aggregate==='total'?'范围总量':c.aggregate==='perPerson'?'范围人均':'每百人日')+'</span>'+
   '<strong>'+asStatNumber(selected.total)+'<small>'+escapeNameChar(selected.effectiveUnit)+'</small></strong></div></header>'+
  '<div class="as-stats-visual"><div class="as-stats-chart"><div class="as-stats-chart-header">'+
   '<span class="as-stats-chart-metric">'+escapeNameChar(met[1])+'</span>'+
   '<h3 class="as-stats-chart-context">'+escapeNameChar(scopedTitle)+'</h3>'+
   '<div class="as-stats-chart-switch"><button type="button" data-as-chart="bar" aria-pressed="'+(c.chart==='bar')+'" class="'+(c.chart==='bar'?'active':'')+'">柱状</button>'+
   '<button type="button" data-as-chart="line" aria-pressed="'+(c.chart==='line')+'" class="'+(c.chart==='line'?'active':'')+
    '" '+(selected.compare==='days'?'':'disabled title="日期趋势才适合折线图"')+'>折线</button></div></div>'+
   (overtimeStack?'<div class="as-stats-stack-legend" aria-label="加班颜色图例">'+
    '<span><i class="legend-registered"></i>登记加班</span>'+
    '<span><i class="legend-automatic"></i>自动加班（已纳入）</span></div>':'')+
   '<div id="asStatChart" class="as-stats-chart-canvas" aria-label="交互式统计图表，包含本范围全部数据"></div>'+
   '<div class="as-stats-chart-empty">当前指标没有可绘制的记录</div></div>'+
   '<div class="as-stats-rank"><div class="as-stats-rank-head"><h3>排行榜</h3>'+
    '<button id="asStatSort" type="button" title="调整排名方向">'+(c.sort==='desc'?'降序 ↓':'升序 ↑')+'</button></div>'+
   '<div class="as-stats-rank-table" id="asStatRankTable">'+ranking+'</div></div></div></section>';
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
 return r62CsvCell(value);
}
function asStatExportRows(){
 const data=asStatRows(),c=asStatPrefs(),metric=asStatMetric();
 const scope=asStatScopeMode()==='all'?'全员':asStatScopeMode()==='group'?asStatScopeGroup():data.people[0]?.name||'个人';
 return data.rows.map(r=>({月份:monthKey(),统计范围:scope,对象:r.label,业务:asStatFamily(c.family)[1],
  指标:metric[1],统计方式:{total:'总量',perPerson:'人均',per100:'每百应出勤人日'}[c.aggregate]||c.aggregate,
  数值:r.value,单位:data.effectiveUnit,员工数:r.peopleCount,应出勤人日:r.scheduled}));
}
function asStatExport(){
 const c=asStatPrefs();return p109ExportRows(asStatExportRows(),monthKey()+'_统计_'+c.family+'_'+c.metric+'.csv');
}
function renderStatisticsWorkspace(){
 const node=document.getElementById('statisticsWorkspace');
 if(!node||state.workspaceMode!=='stats')return;
 if(typeof disposeAttendCharts==='function')disposeAttendCharts();
 const oldFocus=document.activeElement,inside=node.contains(oldFocus);
 const sidebarFocus=document.getElementById('statsSidebarControls')?.contains(oldFocus);
 const focusId=(inside||sidebarFocus)?oldFocus.id:'';
 const focusChart=inside?oldFocus.dataset?.asChart:null;
 const c=asStatPrefs();
 const aside=document.getElementById('statsSidebarControls');
 if(aside)aside.innerHTML=statisticsSidebarControlsHtml();
 node.innerHTML=statisticsWorkspaceHtml();
 const scope=document.getElementById('asStatsScope');
 if(scope)scope.onchange=e=>{
  state.statsScope=e.target.value;
  state.statsGroup=asStatScopeGroup();
  if(state.statsScope==='person')state.statsPersonId=
    EMPLOYEES.find(p=>groupOf(p)===state.statsGroup)?.id||EMPLOYEES[0]?.id||'';
  c.compare=asStatDefaultCompare(state.statsScope);
  c.chart=state.statsScope==='person'?'line':'bar';
  state.statsExpandedKey='';
  asNavTrack();renderStatisticsWorkspace();
 };
 const groupSelect=document.getElementById('asStatsGroup');
 if(groupSelect)groupSelect.onchange=e=>{
  state.statsGroup=e.target.value;
  state.statsPersonId=EMPLOYEES.find(p=>groupOf(p)===state.statsGroup)?.id||'';
  state.statsExpandedKey='';
  asNavTrack();renderStatisticsWorkspace();
 };
 const personSelect=document.getElementById('asStatsPerson');
 if(personSelect)personSelect.onchange=e=>{
  state.statsPersonId=e.target.value;state.statsExpandedKey='';
  asNavTrack();renderStatisticsWorkspace();
 };
 const exportButton=document.getElementById('asStatsExport');
 if(exportButton)exportButton.onclick=asStatExport;
 document.getElementById('asStatFamily').onchange=e=>{
  c.family=e.target.value;c.metric=asStatFamily(c.family)[2][0][0];
  if(c.metric==='people'||c.metric==='candidatePeople')c.aggregate='total';
  renderStatisticsWorkspace();
 };
 document.getElementById('asStatMetric').onchange=e=>{c.metric=e.target.value;if(c.metric==='people'||c.metric==='candidatePeople')c.aggregate='total';renderStatisticsWorkspace()};
 document.getElementById('asStatCompare').onchange=e=>{
  c.compare=e.target.value;
  c.chart=c.compare==='days'?'line':'bar';
  state.statsExpandedKey='';
  renderStatisticsWorkspace();
 };
 document.getElementById('asStatAggregate').onchange=e=>{c.aggregate=e.target.value;renderStatisticsWorkspace()};
 document.getElementById('asStatLimit').onchange=e=>{c.limit=e.target.value;renderStatisticsWorkspace()};
 node.querySelector('#asStatSort').onclick=()=>{c.sort=c.sort==='desc'?'asc':'desc';renderStatisticsWorkspace()};
 node.querySelectorAll('[data-as-chart]').forEach(b=>b.onclick=()=>{c.chart=b.dataset.asChart;renderStatisticsWorkspace()});
 const toggleRank=(key,scroll=false)=>{
  const data=asStatRows();
  let match=data.rankRows.find(r=>r.key===key);
  if(!match&&scroll&&c.limit!=='all'){
   match=data.rows.find(r=>r.key===key);
   if(match){
    c.limit='all';
    state.statsExpandedKey=match.type+'|'+match.key;
    renderStatisticsWorkspace();
    const trigger=[...document.querySelectorAll('[data-as-rank]')].find(b=>b.dataset.asRank===key);
    trigger?.scrollIntoView({block:'nearest',inline:'nearest'});
   }
   return;
  }
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
 if(typeof asNavRefreshCurrent==='function')asNavRefreshCurrent();
 const data=asStatRows(),chart=initAttendChart(document.getElementById('asStatChart'));
 node.querySelector('.as-stats-chart').classList.toggle('is-empty',!data.rows.some(r=>r.raw>0));
 if(!chart)return;
 const isDay=data.compare==='days',line=c.chart==='line';
 const rows=data.visible,cat=rows.map(x=>x.label),values=rows.map(x=>Number(x.value.toFixed(3)));
 const isOvertimeStack=c.family==='overtime'&&c.metric==='hours'&&!line;
 const numberLabels=state.prefs?.showBarValues===true;
 const denominator=r=>c.aggregate==='perPerson'?r.people.length:
    c.aggregate==='per100'?r.days.filter(isWorkday).length*r.people.length/100:1;
 const normalized=(metric,r)=>{const d=denominator(r);
   return d?asStatValue(data.ledger,'overtime',metric,r.people,r.days)/d:0};
 const registeredValues=isOvertimeStack?rows.map(r=>normalized('registeredHours',r)):[];
 const autoValues=isOvertimeStack?rows.map(r=>normalized('candidateHours',r)):[];
 const slot=(Math.max(230,chart.getWidth())-72)/Math.max(1,rows.length);
 const barWidth=Math.max(3,Math.min(54,Math.floor(slot*(rows.length<=8?.62:.70))));
 // User preference: flatter names, never near-vertical.
 const many=rows.length>=30,angle=isDay?27:many?34:rows.length>14?28:20;
 // All employee labels share one baseline; staggered newlines were misaligning names.
 const formatTop=(p,topOnly=false)=>{
   const i=p.dataIndex;
   if(isOvertimeStack){
     if(topOnly&&autoValues[i]>1e-8)return '';
     if(!topOnly&&autoValues[i]<=1e-8)return '';
   }
   return rows[i]?.value?asStatNumber(rows[i].value):'';
 };
 const labelStyle={show:numberLabels&&!line,position:'top',color:'#48617e',
  distance:3,fontSize:many?9:11,fontWeight:600};
 const ordinaryPalette=asStatPalette(c.family,c.metric);
 const ordinaryGradient=new echarts.graphic.LinearGradient(0,0,0,1,[
  {offset:0,color:ordinaryPalette.top},{offset:1,color:ordinaryPalette.bottom}]);
 const redBar=(palette)=>new echarts.graphic.LinearGradient(0,0,0,1,[
   {offset:0,color:palette.top},{offset:1,color:palette.bottom}]);
 const baseBar={barWidth,barMaxWidth:54,barMinHeight:values.some(v=>v>0)?1:0};
 const series=isOvertimeStack?[
   {...baseBar,id:'overtime-registered',name:'登记加班',type:'bar',stack:'overtime',
    data:registeredValues,itemStyle:{color:redBar(OVERTIME_VISUALS.registered)},
    emphasis:{focus:'none',itemStyle:{color:redBar({
      top:OVERTIME_VISUALS.registered.hoverTop,bottom:OVERTIME_VISUALS.registered.hoverBottom
    }),shadowBlur:8,shadowColor:'rgba(150,67,84,.17)'}},
    label:{...labelStyle,formatter:p=>formatTop(p,true)}},
   {...baseBar,id:'overtime-automatic',name:'自动加班（已纳入）',type:'bar',stack:'overtime',
    data:autoValues,itemStyle:{color:redBar(OVERTIME_VISUALS.auto)},
    emphasis:{focus:'none',itemStyle:{color:redBar({
      top:OVERTIME_VISUALS.auto.hoverTop,bottom:OVERTIME_VISUALS.auto.hoverBottom
    }),shadowBlur:8,shadowColor:'rgba(150,67,84,.17)'}},
    label:{...labelStyle,formatter:p=>formatTop(p,false)}}
 ]:[{
  ...baseBar,id:'statistics-primary',name:asStatMetric()[1]||'统计值',
  type:line?'line':'bar',data:values,smooth:false,
  showSymbol:!many||!line,symbol:'circle',symbolSize:6,
  itemStyle:{color:ordinaryGradient,opacity:1,
    borderRadius:line?0:[Math.min(5,barWidth/3),Math.min(5,barWidth/3),0,0]},
  emphasis:{focus:'none',scale:true,scaleSize:2,
    itemStyle:{color:ordinaryPalette.hover,opacity:1,shadowBlur:8,shadowColor:'rgba(72,84,125,.18)'},
    lineStyle:{width:3},symbolSize:10},
  lineStyle:{width:2.15,color:ordinaryPalette.top},
  areaStyle:line?{color:'rgba(126,170,236,.055)'}:undefined,
  label:{...labelStyle,formatter:p=>formatTop(p)}
 }];
 chart.setOption({animation:state.prefs?.motion!==false,animationDuration:220,
  grid:{top:numberLabels?45:20,bottom:many?95:isDay?76:72,left:49,right:18,containLabel:false},
  tooltip:{trigger:'item',axisPointer:{type:'none'},confine:true,
   // Tie the floating card to the top of the active bar, including hover
   // forwarded from a row in the right-hand ranking.
   position:(pt,params,dom,rect,size)=>{
     const width=size.contentSize[0],height=size.contentSize[1];
     const x=rect?rect.x+rect.width/2:pt[0],y=rect?rect.y:pt[1];
     return [Math.max(8,Math.min(size.viewSize[0]-width-8,x-width/2)),
       Math.max(8,Math.min(size.viewSize[1]-height-8,y-height-11))];
   },
   formatter:p=>{
    const row=rows[p.dataIndex];if(!row)return '';
    const name=escapeNameChar(row.label),unit=escapeNameChar(data.effectiveUnit);
    return '<b>'+name+'</b><br>总计 '+asStatNumber(row.value)+' '+unit+
      (isOvertimeStack?'<br>登记 '+asStatNumber(registeredValues[p.dataIndex])+
        ' '+unit+'<br>自动 '+asStatNumber(autoValues[p.dataIndex])+' '+unit:'');
   }},
  xAxis:{type:'category',data:cat,boundaryGap:!line,
   axisLabel:{fontSize:many?12:13,color:'#687f9d',interval:0,rotate:angle,
    hideOverlap:false,align:'right',margin:11,lineHeight:17},
   axisTick:{show:false},axisLine:{lineStyle:{color:'#dfe5ee'}}},
  yAxis:{type:'value',min:0,axisLabel:{fontSize:11,color:'#8895a9'},
   splitLine:{lineStyle:{color:'rgba(100,123,158,.11)'}},axisLine:{show:false}},
  series
 });
 // Exactly one live hover target at a time. Never accumulate ECharts
 // programmatic highlight states when moving between bars or ranking rows.
 const ranking=[...node.querySelectorAll('[data-as-rank]')];
 let hoveredKey=null;
 const clearHover=()=>{
  if(hoveredKey===null)return;
  hoveredKey=null;
  ranking.forEach(b=>b.classList.remove('is-linked'));
  chart.dispatchAction({type:'downplay'});
  chart.dispatchAction({type:'hideTip'});
 };
 const hoverOne=key=>{
  if(key===hoveredKey)return;
  clearHover();
  const idx=rows.findIndex(r=>r.key===key);
  if(idx<0)return;
  hoveredKey=key;
  ranking.forEach(b=>b.classList.toggle('is-linked',b.dataset.asRank===key));
  if(isOvertimeStack){
   // Whole stacked column is one hovered datum. Preserve the distinct red
   // fills but brighten *both* components; never leave another column lit.
   chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:idx});
   chart.dispatchAction({type:'highlight',seriesIndex:1,dataIndex:idx});
  }else chart.dispatchAction({type:'highlight',seriesIndex:0,dataIndex:idx});
  const anchor=isOvertimeStack&&autoValues[idx]>1e-8?1:0;
  chart.dispatchAction({type:'showTip',seriesIndex:anchor,dataIndex:idx});
 };
 ranking.forEach(b=>{
  b.addEventListener('pointerenter',()=>hoverOne(b.dataset.asRank));
  b.addEventListener('pointerleave',clearHover);
  b.addEventListener('focus',()=>hoverOne(b.dataset.asRank));
  b.addEventListener('blur',clearHover);
 });
 chart.on('mouseover',e=>{const item=rows[e.dataIndex];if(item)hoverOne(item.key)});
 chart.on('mouseout',clearHover);
 chart.on('globalout',clearHover);
 chart.getZr().on('globalout',clearHover);
 chart.getDom().addEventListener('pointerleave',clearHover);
 chart.on('click',e=>{const row=rows[e.dataIndex];clearHover();if(row)toggleRank(row.key,true)});
 chart.on('dblclick',e=>{const row=rows[e.dataIndex];if(row)asStatDrill(row.key)});
 // Changes reconstruct the controls; keep their keyboard focus in place.
 const next=focusId?document.getElementById(focusId):
  focusChart?node.querySelector('[data-as-chart="'+focusChart+'"]'):null;
 if(next&&(node.contains(next)||aside?.contains(next)))next.focus({preventScroll:true});
}
