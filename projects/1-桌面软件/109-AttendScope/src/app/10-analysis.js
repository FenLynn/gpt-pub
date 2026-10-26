function excelSerialToDateTime(n){if(typeof n!=='number')return String(n??'');const ms=Math.round((n-25569)*86400)*1000;const d=new Date(ms);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`}
function aliases(obj,names){for(const n of names)if(Object.prototype.hasOwnProperty.call(obj,n)&&obj[n]!==''&&obj[n]!=null)return obj[n];return ''}
// Imported people are identified by an editable month-scoped roster, never by
// public demo names. Parse and validate before changing any live data.
function sourceRow(r,i){return Number(r.__rowNumber)||i+2}
function validClock(t){return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(t))}
function importClock(v,fallback){
  if(typeof v==='number'&&v>=0&&v<1)return r62Time(v);
  if(v==null||String(v).trim()==='')return fallback;
  const raw=String(v).trim();
  if(!validClock(raw))throw new Error('导入文件包含无效时间：'+raw.slice(0,40));
  return raw.length>=8?raw.slice(0,8):raw.slice(0,5);
}
function importedDate(v){
  return (typeof v==='number'?excelSerialToDateTime(v):String(v??'')).replace('T',' ').trim();
}
function strictISODate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split('-').map(Number);
  const date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()+1===m&&date.getUTCDate()===d;
}
function strictDateTime(value){
  const parts=/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2})?)$/.exec(value);
  return !!parts&&strictISODate(parts[1])&&validClock(parts[2]);
}
// A name-only file cannot distinguish two people with the same name.
function validateImportIdentityRows(rows){return true /* normalized name is the only identity */}
function importRosterPlan(names,kind){
 const unique=[...new Set(names.map(normalizedPerson).filter(Boolean))];
 const aliases={...(state.projectProfile?.nameAliases||{}),...(state.nameAliases||{})};
 const canonical=original=>{
  let name=normalizedPerson(original);
  const visited=new Set();
  while(aliases[name]&&!visited.has(name)){
   visited.add(name);name=normalizedPerson(aliases[name]);
  }
  return name;
 };
 if(!unique.length)throw new Error('导入文件没有有效姓名');
 const existing=new Map();
 for(const e of EMPLOYEES){const name=normalizedPerson(e.name);
  if(name&&!existing.has(name))existing.set(name,{...e,id:personIdentity(name),name});
 }
 const resetDemo=state.isDemo&&(kind==='attendance'||unique.some(n=>!existing.has(n)));
 if(resetDemo&&!window.confirm('导入会替换当前演示人员和演示数据，是否继续？'))
  throw new Error('用户取消了演示数据替换');
 const pinned=resetDemo?(state.projectProfile?.pinRoster?state.projectProfile.employees||[]:
   EMPLOYEES.filter(e=>(state.fixedPeople||[]).includes(e.id))):[];
 const people=resetDemo?pinned.map(e=>({...e,id:personIdentity(e.name),name:normalizedPerson(e.name)})):[...existing.values()];
 const byCanonical=new Map(people.map(e=>[e.name,e])),byName=new Map();
 for(const original of unique){
  const name=canonical(original);
  if(!byCanonical.has(name)){
   const e={id:personIdentity(name),name,department:'未分类'};
   people.push(e);byCanonical.set(name,e);
  }
  byName.set(original,byCanonical.get(name));
 }
 return {people,byName,resetDemo};
}
function applyImportRoster(plan,meta){
  if(!plan.resetDemo)r62MigrateActive();
  if(plan.resetDemo){
    const before=new Map(EMPLOYEES.map(e=>[e.id,personIdentity(e.name)]));
    state.fixedPeople=(state.fixedPeople||[]).map(id=>before.get(id)||id);
    state.records=[];state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];
    state.manualStatuses={};state.overtimeReview={};state.attendanceReview={};state.tempOutingReview={};state.manualTempOutings=[];state.manualOvertime=[];state.judgmentMode='initial';state.revisions=[];state.revisionSeq=0;
    state.imports=[meta];
    const pinGroups=state.projectProfile?.groups||state.groups;
    state.groups=Object.fromEntries(plan.people.filter(e=>(state.fixedPeople||[]).includes(e.id))
      .map(e=>[e.id,pinGroups[e.id]||'未分组']));
    state.groupCatalog=[...(state.projectProfile?.groupCatalog||[])];
  }
  if(!plan.resetDemo)state.imports=[...state.imports,meta];
  EMPLOYEES=plan.people;
  // Real imported employees are ungrouped unless explicitly assigned.
  for(const e of EMPLOYEES)if(!state.groups[e.id])state.groups[e.id]='未分组';
  state.isDemo=!!state.isDemo&&!plan.resetDemo;
}
function acceptImportedRows(kind,rows,plan,skipped=0){
  if(kind==='attendance')state.records=rows;
  else if(kind==='leave')state.leaves=rows;
  else if(kind==='trip')state.trips=rows;
  else if(kind==='outing')state.outings=rows;
  else if(kind==='overtime')state.overtimeEntries=rows;
  state.saved=false;rememberMonth();reanalyze();render();
  toast('已导入 '+rows.length+' 条'+({attendance:'考勤',leave:'请假',trip:'出差',outing:'外出',overtime:'加班'}[kind])+'记录；员工 '+EMPLOYEES.length+' 人'+(skipped?'；跳过无效行 '+skipped+' 条':''));
}
// Preview and commit use the same business parser and explicit target month.
function p109ImportPeriod(key=monthKey()){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key))throw Error('请选择有效的导入月份');
 const [year,month]=key.split('-').map(Number);
 return {key,year,month,first:Date.UTC(year,month-1,1)/60000,
  last:Date.UTC(year,month,1)/60000,end:key+'-'+pad(new Date(year,month,0).getDate())};
}
function p109ParseBusinessRow(kind,r,i,period=p109ImportPeriod()){
 if(r.__date1904){r={...r};for(const key of ['开始日期','起始日期','结束日期','截止日期','日期','请假日期','加班日期','startDate','endDate','date','开始日期时间','结束日期时间','startDatetime','endDatetime','打卡时间','datetime','DateTime'])
  if(typeof r[key]==='number'&&r[key]>=1)r[key]+=1462;delete r.__date1904}
 const sourceSheet=String(r.__sheet||''),name=normalizedPerson(aliases(r,['姓名','人员','员工姓名','name']));
 if(!name)throw Error('姓名为空');
 const row=sourceRow(r,i),type=String(aliases(r,['类型','假别','事项','type'])||
  ({leave:'请假',trip:'出差',outing:'外出',overtime:'登记加班'}[kind])||''),
  note=String(aliases(r,['备注','说明','note'])||'');
 if(kind==='attendance'){
  const datetime=importedDate(aliases(r,['打卡时间','时间','datetime','DateTime'])),
   direction=String(aliases(r,['进出','方向','状态','direction'])).trim();
  if(!strictDateTime(datetime))throw Error('日期时间格式错误');
  if(direction&&!['进','出','未标注'].includes(direction))throw Error('进出方向无法识别');
  const stamp=attendanceUtcMinute(datetime.slice(0,10),datetime.slice(11));
  if(stamp<period.first-1440||stamp>=period.last+1440)
   throw Error('日期不属于 '+period.key+'（仅允许前后各一天的跨月配对记录）');
  return {name,datetime,time:datetime.slice(11,19),direction:direction||'未标注',row,sheet:sourceSheet};
 }
 if(kind==='trip'){
  const startDate=r62Date(aliases(r,['开始日期','起始日期','日期','startDate','date'])),
   endDate=r62Date(aliases(r,['结束日期','截止日期','endDate'])||startDate);
  if(!strictISODate(startDate)||!strictISODate(endDate))throw Error('起止日期格式错误');
  if(startDate>endDate)throw Error('结束日期早于开始日期');
  if(startDate>period.end||endDate<period.key+'-01')throw Error('日期范围与 '+period.key+' 无交集');
  const base={name,startDate,endDate,row,type,note,sheet:sourceSheet,place:String(aliases(r,['地点','目的地','place'])||'')};
  return base;
 }
 const startCombined=aliases(r,['开始日期时间','startDatetime']),endCombined=aliases(r,['结束日期时间','endDatetime']),
  startValue=aliases(r,['开始日期','起始日期','日期','请假日期','加班日期','startDate','date']),
  endValue=aliases(r,['结束日期','截止日期','endDate']),
  startDate=r62Date(startCombined||startValue),endDate=r62Date(endCombined||endValue||startDate);
 if(!startDate||!endDate)throw Error('起止日期无效或顺序不明确，请使用 YYYY-MM-DD');
 const clock=(value,fallback,ending)=>{
  if(value==null||String(value).trim()==='')return fallback;
  const parsed=r62Time(value,ending);if(!parsed)throw Error('起止时间格式错误');return parsed;
 };
 const start=clock(startCombined||aliases(r,['开始时间','开始','start']),kind==='leave'?RULES.amStart:'',false),
  end=clock(endCombined||aliases(r,['结束时间','结束','end']),kind==='leave'?RULES.pmEnd:'',true);
 if(!start||!end)throw Error('请选择开始和结束时间列');
 let from=attendanceUtcMinute(startDate,start),to=attendanceUtcMinute(endDate,end);
 // Preserve old single-date overtime templates; explicit end dates never roll over silently.
 if(kind==='overtime'&&!endCombined&&!endValue&&minutes(end)<minutes(start))to+=1440;
 if(to<=from)throw Error('结束日期时间必须晚于开始日期时间');
 if(to-from>366*1440)throw Error('单条时间范围超过 366 天，请拆分后导入');
 if(from>=period.last||to<=period.first)throw Error('日期范围与 '+period.key+' 无交集');
 return {name,row,type,note,sheet:sourceSheet,place:String(aliases(r,['地点','目的地','place'])||''),
  rangeStart:startDate+' '+start,rangeEnd:attendanceDateFromMinute(to)+' '+attendanceClock(to%1440),
  date:startDate,start,end,importIntervalVersion:1};
}
function p109ImportDayRows(kind,row,period){
 if(!row.importIntervalVersion)return [row];
 const from=attendanceUtcMinute(row.rangeStart.slice(0,10),row.rangeStart.slice(11)),
  to=attendanceUtcMinute(row.rangeEnd.slice(0,10),row.rangeEnd.slice(11)),parts=[];
 for(let day=Math.max(Math.floor(from/1440)*1440,period.first);day<Math.min(to,period.last);day+=1440){
  const date=attendanceDateFromMinute(day),start=attendanceClock(Math.max(from,day)-day),
   end=attendanceClock(Math.min(to,day+1440)-day);
  parts.push({...row,date,start,end,...(kind==='outing'?{startDate:date,endDate:date}:{})});
 }
 return parts;
}
function p109ParseImportTable(kind,table,period=p109ImportPeriod()){
 const rows=[],failed=[];
 table.rows.forEach((r,i)=>{try{rows.push(...p109ImportDayRows(kind,p109ParseBusinessRow(kind,table.date1904?{...r,__date1904:true}:r,i,period),period))}
  catch(e){failed.push({row:sourceRow(r,i),reason:e.message})}});
 return {rows,failed};
}
// Preserve multiplicity within a source file. Only overlaps with earlier files
// are folded; all contributing source rows remain traceable in `sources`.
function p109ImportSignature(kind,row){
 const keys={attendance:['employeeId','datetime','direction'],leave:['employeeId','date','start','end','type','note'],
  trip:['employeeId','startDate','endDate','type','place','note'],
  outing:['employeeId','startDate','endDate','start','end','type','place','note'],
  overtime:['employeeId','date','start','end','type','note']}[kind];
 return JSON.stringify(keys.map(key=>{
  const value=row[key]??'';
  if(['start','end'].includes(key))return validClock(value)?minutes(value):value;
  return key==='datetime'&&String(value).length===16?value+':00':value;
 }));
}
function p109SourceReference(row){
 return Object.fromEntries(['importId','source','sheet','row','recordId','id','sourceName'].filter(k=>row[k]!=null).map(k=>[k,row[k]]));
}
function p109MergeImportRows(kind,previous,incoming){
 const rows=previous.map(r=>({...r})),slots=new Map();let added=0,merged=0;
 rows.forEach((r,i)=>{const key=p109ImportSignature(kind,r);if(!slots.has(key))slots.set(key,[]);slots.get(key).push(i)});
 for(const row of incoming){
  const indices=slots.get(p109ImportSignature(kind,row));
  if(indices?.length){
   const index=indices.shift(),old=rows[index];
   rows[index]={...old,sources:[...(old.sources||[p109SourceReference(old)]),p109SourceReference(row)]};merged++;
  }else{rows.push(row);added++}
 }
 return {rows,added,merged};
}
async function p109ImportBusiness(kind,file,prepared=null){
 const table=prepared||await P109_TABLES.readTable(file),result=p109ParseImportTable(kind,table);
 if(!result.rows.length)throw Error('没有可导入 '+monthKey()+' 的记录'+
  (result.failed[0]?'：'+result.failed[0].reason:''));
 const parsed=result.rows,plan=importRosterPlan(parsed.map(r=>r.name),kind),
  field={attendance:'records',leave:'leaves',trip:'trips',outing:'outings',overtime:'overtimeEntries'}[kind],
  mode=prepared?.importMode==='replace'?'replace':'merge';
 if(mode==='replace'&&!plan.resetDemo&&state[field].length&&!window.confirm('替换本月此类工作数据？其他类型与历史原件均保留。'))
  throw new DOMException('已取消替换','AbortError');
 const importId='I'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),
  prefix={leave:'LI',trip:'TI',outing:'OI',overtime:'OTI'}[kind];
 const out=parsed.map((r,index)=>{
  const employee=plan.byName.get(r.name),identity=kind==='attendance'?
   {recordId:'import:'+importId+':'+index+':'+r.row,scenario:'import'}:{id:prefix+'-'+importId+'-'+index+'-'+r.row+(r.importIntervalVersion?'-'+r.date:'')};
  return {...r,...identity,importId,employeeId:employee.id,name:employee.name,
   sourceName:r.name,source:file.name,sheet:r.sheet||table.sheet};
 });
 const translation=new Map(EMPLOYEES.map(e=>[e.id,personIdentity(e.name)])),
  previous=state[field].map(r=>({...r,employeeId:translation.get(r.employeeId)||r.employeeId}));
 const combined=mode==='merge'&&!plan.resetDemo?p109MergeImportRows(kind,previous,out):{rows:out,added:out.length,merged:0};
 // Persist an immutable copy before changing the roster or live dataset.
 const meta={...await persistImportedFile(file,kind,out.length,importId),mode,addedCount:combined.added,mergedCount:combined.merged};
 applyImportRoster(plan,meta);if(!state.isDemo)p109WriteMode('work');acceptImportedRows(kind,combined.rows,plan,result.failed.length);
 if(typeof p109SourceCache!=='undefined')p109SourceCache.set(importId,file);
 toast('已'+(mode==='replace'?'替换':'合并')+'：新增 '+combined.added+' 条'+(combined.merged?'，重合 '+combined.merged+' 条（保留来源）':''));
 return {count:out.length,added:combined.added,merged:combined.merged,skipped:result.failed.length};
}
async function importAttendance(file,prepared=null){return p109ImportBusiness('attendance',file,prepared)}
async function importLeaves(file,prepared=null){return p109ImportBusiness('leave',file,prepared)}
async function importTrips(file,prepared=null){return p109ImportBusiness('trip',file,prepared)}
async function importOutings(file,prepared=null){return p109ImportBusiness('outing',file,prepared)}
async function importOvertime(file,prepared=null){return p109ImportBusiness('overtime',file,prepared)}
function leaveFor(empId,date){return state.leaves.filter(x=>x.employeeId===empId&&x.date===date)}
function tripFor(empId,date){return state.trips.filter(x=>x.employeeId===empId&&date>=x.startDate&&date<=x.endDate)}
function intervalOverlap(a1,a2,b1,b2){return Math.max(0,Math.min(a2,b2)-Math.max(a1,b1))}
/* R15: judgments and behaviors are independent dimensions. Purple is selection only. */
const ATTEND_STATUS_COLORS=Object.freeze({normal:'#78caa0',anomaly:'#e6c36f',absent:'#e58f90',rest:'#eef2f6'});
const ATTEND_BEHAVIOR_COLORS=Object.freeze({trip:'#6b7fd7',leave:'#8a6fd1',outing:'#3c9dc4',overtime:'#c876a0',lateEarly:'#4289c5'});
const ATTEND_EVENT_COLORS=Object.freeze({in:'#1f5a9f',out:'#8a5b3d'});
function manualStatusKey(aOrId,day){
  return typeof aOrId==='string'?aOrId+'|'+day:aOrId.employee.id+'|'+aOrId.day;
}
function manualStatusFor(a){return state.manualStatuses?.[manualStatusKey(a)]||null}
function hasManualStatuses(){return Object.keys(state.manualStatuses||{}).length>0||Object.values(state.attendanceReview||{}).some(value=>value===false)}
function attendanceJudgmentSystem(a){
  if(!isWorkday(a.day))return 'rest';
  const severity=a.initialSeverity??a.severity,status=a.initialStatus??a.status;
  if(severity==='excused')return 'normal';
  if(status==='缺勤')return 'absent';
  if(severity==='problem'||severity==='suspect')return 'anomaly';
  if(severity==='normal')return 'normal';
  return 'rest';
}
function attendanceJudgment(a,mode='final'){
  const initial=attendanceJudgmentSystem(a);
  // The initial system verdict is a comparison view only. Every canonical
  // output/aggregate reads the operator's final verdict first, without
  // modifying the source punches or the original automated diagnosis.
  const effective=attendanceJudgmentSystem({...a,initialSeverity:a.severity,initialStatus:a.status});
  return mode==='initial'?initial:(manualStatusFor(a)||effective);
}
function attendanceBehaviors(a){
  const results=[];
  if(a.trips?.length)results.push('trip');
  if(a.leaves?.length)results.push('leave');
  if(a.outings?.length||state.outings?.some(x=>x.employeeId===a.employee.id&&a.date>=x.startDate&&a.date<=x.endDate))results.push('outing');
  if(activeTemporaryOutings(a).length)results.push('tempOuting');
  if(p109RegisteredOvertime(a).length||activeAutoOvertimeSegments(a).length||
    (!isWorkday(a.day)&&a.punches.length)||(!p109BusinessPriority()&&state.overtimeEntries?.some(x=>x.employeeId===a.employee.id&&x.date===a.date)))
   results.push('overtime');
  return results;
}
function activeAttendanceFlags(a){return (a?.attendanceFlags||[]).filter(flag=>flag.accepted!==false)}
function attendanceHasLateEarly(a){return activeAttendanceFlags(a).some(flag=>flag.kind==='late'||flag.kind==='early')}
function attendanceCategory(a){return attendanceJudgment(a)}
function matrixCategory(a,filter=state.filter){
  if(filter==='lateEarly'&&attendanceHasLateEarly(a))return 'lateEarly';
  return ['trip','leave','outing','overtime','tempOuting'].includes(filter)&&attendanceBehaviors(a).includes(filter)?
   (filter==='tempOuting'?(activeTemporaryOutings(a).some(r=>r.status==='red')?'tempOutingRed':'tempOutingGreen'):filter):
   attendanceJudgment(a,state.judgmentMode==='initial'?'initial':'final');
}
function categoryColor(category){return ({tempOutingRed:'#dc8388',tempOutingGreen:'#78caa0'})[category]||ATTEND_STATUS_COLORS[category]||ATTEND_BEHAVIOR_COLORS[category]||ATTEND_STATUS_COLORS.rest}
function outingFor(empId,date){return (state.outings||[]).filter(x=>x.employeeId===empId&&date>=x.startDate&&date<=x.endDate)}
function overtimeFor(empId,date){return attendanceDailyRegistered(empId,date)}
function behaviorMinutes(a,kind){
  if(kind==='tempOuting')return activeTemporaryOutings(a).reduce((sum,r)=>sum+r.minutes,0);
  if(kind==='overtime'&&p109BusinessPriority())return analysisUnionMinutes([...p109RegisteredOvertime(a).map(r=>[minutes(r.start),minutes(r.end)]),...activeAutoOvertimeSegments(a).map(r=>[r.from,r.to])]);
  const intervals=kind==='leave'?a.leaves:kind==='outing'?a.outings:kind==='overtime'?a.overtime:[];
  if(kind==='trip')return a.trips.length?Math.max(0,minutes(RULES.amEnd)-minutes(RULES.amStart))+Math.max(0,minutes(RULES.pmEnd)-minutes(RULES.pmStart)):0;
  if(!p109BusinessPriority())return intervals.reduce((sum,x)=>sum+Math.max(0,minutes(x.end||'00:00')-minutes(x.start||'00:00')),0);
  const parts=intervals.map(x=>[minutes(x.start||'00:00'),minutes(x.end||'00:00')]);
  return analysisUnionMinutes(kind==='leave'?parts.flatMap(([a,b])=>[[minutes(RULES.amStart),minutes(RULES.amEnd)],[minutes(RULES.pmStart),minutes(RULES.pmEnd)]].map(([x,y])=>[Math.max(a,x),Math.min(b,y)]).filter(([x,y])=>y>x)):parts);
}
/* R49: lunch gaps and inferred overtime are evidence, not approval decisions.
 * Never synthesize raw overtime rows or modify imported punches. */
function analysisPairMinutes(pairs,start,end){
 return pairs.reduce((total,[enter,exit])=>total+
   intervalOverlap(minutes(enter.time),minutes(exit.time),minutes(start),minutes(end)),0);
}
// Civil-day boundaries use UTC arithmetic only for local calendar dates.
// No timezone conversion is applied to imported clock readings.
function attendanceUtcMinute(date,clock='00:00'){
 const stamp=Date.parse(date+'T00:00:00Z');
 return stamp/60000+minutes(clock);
}
function attendanceDateFromMinute(value){
 return new Date(Math.floor(value/1440)*86400000).toISOString().slice(0,10);
}
function attendanceClock(value){
 const total=Math.round(value*60),m=Math.floor(total/60),seconds=total%60;
 return pad(Math.floor(m/60))+':'+pad(m%60)+':'+pad(seconds);
}
function attendanceNeighborDates(){
 const first=Date.UTC(YEAR,MONTH-1,1)/60000,
  last=Date.UTC(YEAR,MONTH,1)/60000;
 return {first,last,previous:attendanceDateFromMinute(first-1),
  next:attendanceDateFromMinute(last)};
}
let r63AnalysisIndex=null;
function attendanceAdjacentRows(field='records'){
 if(r63AnalysisIndex?.adjacent.has(field))return r63AnalysisIndex.adjacent.get(field);
 const {first,last}=attendanceNeighborDates();
 const previous=attendanceDateFromMinute(first-1).slice(0,7),
   next=attendanceDateFromMinute(last).slice(0,7);
 const stores=[state.monthStores?.get(previous),state.monthStores?.get(next)];
 const combined=[...(state[field]||[]),...stores.flatMap(s=>s?.[field]||[])];
 const found=new Map();
 for(let i=0;i<combined.length;i++){
  const record=combined[i],date=String(record.datetime||record.date||'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
  const minute=attendanceUtcMinute(date);
  if(minute<first-1440||minute>last+1440)continue;
  const id=(record.recordId||record.id||record.importId||'')+'|'+date+'|'+
   (record.datetime||'')+'|'+(record.direction||'')+'|'+
   (record.employeeId||'')+'|'+(record.row||'');
  if(!found.has(id))found.set(id,record);
 }
 const unique=[...found.values()];
 if(r63AnalysisIndex)r63AnalysisIndex.adjacent.set(field,unique);
 return unique;
}
function attendanceVisitEvents(employeeId){
 if(r63AnalysisIndex?.visits.has(employeeId))return r63AnalysisIndex.visits.get(employeeId);
 const rows=attendanceAdjacentRows('records').filter(x=>x.employeeId===employeeId&&
   x.datetime)
  .sort((a,b)=>a.datetime.localeCompare(b.datetime)||
    (a.direction==='进'?-1:1));
 const visits=[];let pending=null;
 for(const row of rows){
  const stamp=attendanceUtcMinute(row.datetime.slice(0,10),row.time||row.datetime.slice(11));
  // An unknown event can be an exit or entry. Do not bridge a visit across it.
  if(!['进','出'].includes(row.direction)){pending=null;continue}
  if(row.direction==='进'){
   if(!pending||(row.datetime.slice(0,10)!==pending.row.datetime.slice(0,10)&&
      (stamp-pending.stamp)*60>RULES.dupSeconds))pending={row,stamp};
   continue;
  }
  if(!pending)continue;
  if(stamp>pending.stamp&&stamp-pending.stamp<=36*60){
   const first=pending.row;
   visits.push({from:pending.stamp,to:stamp,enter:first,exit:row,
    id:'auto-visit:'+employeeId+':'+(first.recordId||first.datetime)+'-'+
      (row.recordId||row.datetime)});
  }
  pending=null;
 }
 if(r63AnalysisIndex)r63AnalysisIndex.visits.set(employeeId,visits);
 return visits;
}
function attendanceDateIsWork(date){
 if(date.slice(0,7)===monthISO())return isWorkday(Number(date.slice(8,10)));
 if(state.snapshotContext||state.activeBranch)return p109CalendarType(date,state.calendarOverrides,false)==='work';
 const other=state.monthStores.get(date.slice(0,7));
 const context=other||state;
 return p109CalendarType(date,other?.calendarOverrides||state.calendarOverrides,!context.snapshotContext&&!context.activeBranch)==='work';
}
function attendanceVisitEligibleMinutes(visit,rules=RULES){
 let total=0;
 for(let cursor=Math.floor(visit.from/1440)*1440;cursor<visit.to;cursor+=1440){
  const date=attendanceDateFromMinute(cursor),a=Math.max(visit.from,cursor),
   z=Math.min(visit.to,cursor+1440),start=visit.from<cursor||!attendanceDateIsWork(date)?
    cursor:cursor+minutes(rules.pmEnd);
  // Historical policy: noon overtime needs a completed morning departure.
  if(attendanceDateIsWork(date)&&visit.from<cursor+minutes(rules.amEnd)&&
     visit.to<=cursor+minutes(rules.pmStart))
   total+=Math.max(0,Math.min(z,cursor+minutes(rules.pmStart))-
       Math.max(a,cursor+minutes(rules.amEnd)));
  total+=Math.max(0,z-Math.max(a,start));
 }
 return total;
}
function attendanceDailyVisits(employeeId,date){
 const day=attendanceUtcMinute(date);
 return attendanceVisitEvents(employeeId).filter(v=>v.to>day&&v.from<day+1440)
  .map(v=>{
   const start=Math.max(v.from,day),end=Math.min(v.to,day+1440);
   const first={...v.enter,time:attendanceClock(start-day),sessionId:v.id,
    sessionFrom:v.from,sessionTo:v.to,sessionEligibleMinutes:attendanceVisitEligibleMinutes(v),
    sessionCarry:v.from<day};
   const last={...v.exit,time:attendanceClock(end-day),sessionId:v.id,
    sessionFrom:v.from,sessionTo:v.to};
   return [first,last];
  });
}
function attendanceDailyRegistered(employeeId,date){
 const start=attendanceUtcMinute(date),end=start+1440;
 const found=[];
 for(const r of attendanceAdjacentRows('overtimeEntries')){
  if(r.employeeId!==employeeId||!r.date)continue;
  const from=attendanceUtcMinute(r.date,r.start),endMinute=attendanceUtcMinute(r.date,r.end)+
    (minutes(r.end)<minutes(r.start)?1440:0);
  if(!Number.isFinite(from)||!Number.isFinite(endMinute)||endMinute<=from||
    endMinute-from>1440||endMinute<=start||from>=end)continue;
  const x=Math.max(from,start),y=Math.min(endMinute,end);
  found.push({...r,start:attendanceClock(x-start),end:attendanceClock(y-start),
   originalDate:r.date,originalStart:r.start,originalEnd:r.end});
 }
 return found;
}
// Minutes are a union of intervals, not a sum of overlapping registrations.
function analysisUnionMinutes(intervals){
 const sorted=intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a)
  .sort((a,b)=>a[0]-b[0]);
 let total=0,start=null,end=null;
 for(const [a,b] of sorted){
  if(start===null){start=a;end=b}
  else if(a<=end)end=Math.max(end,b);
  else{total+=end-start;start=a;end=b}
 }
 return start===null?0:total+end-start;
}
function analysisUnionSegments(intervals){
 const sorted=intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a)
  .sort((a,b)=>a[0]-b[0]),merged=[];
 for(const [a,b] of sorted){
  const last=merged[merged.length-1];
  if(last&&a<=last[1])last[1]=Math.max(last[1],b);
  else merged.push([a,b]);
 }
 return merged;
}
function estimateOvertimeCandidate(pairs,day,registered,pairingUncertain=false){
 return p109BufferedOvertimeCandidate(pairs,day,registered,pairingUncertain);
}
function p109LegacyOvertimeCandidate(pairs,day,registered,pairingUncertain=false,rules=RULES){
 const minMinutes=Number.isFinite(+rules.overtimeMinMinutes)?Math.max(20,+rules.overtimeMinMinutes):20;
 if(pairingUncertain)return {minutes:0,rawMinutes:0,threshold:minMinutes,
  reason:'打卡进出配对待核',segments:[]};
 const windows=isWorkday(day)?[[minutes(rules.amEnd),minutes(rules.pmStart)],[minutes(rules.pmEnd),1440]]:
   [[0,1440]];
 const eligible=[];
 for(const [enter,exit] of pairs){
  const a=minutes(enter.time),b=minutes(exit.time);
  const activeWindows=enter.sessionCarry?[[0,1440]]:windows;
  for(const [start,end] of activeWindows){
   // Historical policy excludes an uninterrupted visit extending into the afternoon.
   if(isWorkday(day)&&start===minutes(rules.amEnd)&&
      (a>=minutes(rules.amEnd)||b>minutes(rules.pmStart)))continue;
   const from=Math.max(a,start),to=Math.min(b,end);
   if(to>from)eligible.push([from,to,enter.sessionId||null,
     Number.isFinite(enter.sessionFrom)&&Number.isFinite(enter.sessionTo)?attendanceVisitEligibleMinutes({from:enter.sessionFrom,to:enter.sessionTo},rules):enter.sessionEligibleMinutes||0,enter.sessionFrom,enter.sessionTo]);
  }
 }
 // Preserve original visit identities across midnight and across dates.
 // A session may touch several date slices; its threshold is checked ONCE
 // against the entire continuous overtime-eligible period.
 const valid=eligible.map(([from,to,id,qualifying,sessionFrom,sessionTo])=>({
  from,to,id,qualifying,sessionFrom,sessionTo}));
 const registeredIntervals=analysisUnionSegments(registered.map(r=>[
  minutes(r.start||''),minutes(r.end||'')]));
 // Decide the configured threshold on the continuous in→out evidence first.
 // Registered overtime is an accounting overlay, not an 'out' punch and must
 // NOT break one session into several independent threshold candidates.
 const residual=[],raw=[];
 for(const item of valid){
  const begin=item.from,end=item.to;
  let cursor=begin,fragments=[];
  for(const [regStart,regEnd] of registeredIntervals){
   if(regEnd<=cursor||regStart>=end)continue;
   if(regStart>cursor)fragments.push([cursor,Math.min(regStart,end)]);
   cursor=Math.max(cursor,Math.min(end,regEnd));
   if(cursor>=end)break;
  }
  if(cursor<end)fragments.push([cursor,end]);
  const all=analysisUnionSegments(fragments);
  raw.push(...all);
  // Fragments keep the identity of their continuous punch-backed session.
  // A 4-minute leftover from a 30-minute session is eligible; a separate
  // 4-minute punch session is not. Both are still non-overlapping with raw
  // registered entries in the statistics ledger.
  if((item.qualifying||end-begin)>minMinutes+1e-8){
   for(const [from,to] of all)residual.push({from,to,minutes:to-from,
      sessionFrom:item.sessionFrom??begin,sessionTo:item.sessionTo??end,
      sessionId:item.id});
  }
 }
 const rawMinutes=analysisUnionMinutes(raw),
   countedMinutes=residual.reduce((sum,s)=>sum+s.minutes,0);
 const reason=countedMinutes>0?'依据完整进出打卡按连续在岗区间计算；与登记加班重叠时段只在统计中扣除':
  registeredIntervals.length?'已由登记加班覆盖，或完整在岗区间不足阈值':
  '无完整进出区间，或每段连续在岗时间均不足阈值';
 return {minutes:countedMinutes,rawMinutes,threshold:minMinutes,reason,
  segments:residual};
}
// A checkmark is an inclusion decision for calculated time, not formal approval.
function activeAutoOvertimeSegments(a){
 return (a.autoOvertime?.segments||[]).filter(s=>s.accepted!==false);
}
function setAutoOvertimeDecision(segmentId,accepted){
 const found=[...state.analysis.values()].flatMap(a=>a.autoOvertime?.segments||[])
  .find(s=>s.id===segmentId);
 if(!found)return false;
 if(found.origin==='manual'&&accepted===false)return p109DeleteManualInterval('overtime',segmentId);
 const before=found.accepted!==false,next=!!accepted;
 if(before===next)return true;
 if(!state.overtimeReview)state.overtimeReview={};
 for(const [key,store] of state.monthStores){
  if(!store.overtimeReview)store.overtimeReview={};
  if(next)delete store.overtimeReview[segmentId];
  else store.overtimeReview[segmentId]=false;
  if(Number.isFinite(found.sessionFrom)&&Number.isFinite(found.sessionTo)){
   const [y,m]=key.split('-').map(Number);
   if(found.sessionFrom<Date.UTC(y,m,1)/60000&&found.sessionTo>Date.UTC(y,m-1,1)/60000)store.saved=false;
  }
 }
 if(next)delete state.overtimeReview[segmentId];
 else state.overtimeReview[segmentId]=false;
 state.revisions.push({id:'R'+(++state.revisionSeq),key:found.employeeId+'|'+found.date,
  action:'auto-overtime-inclusion',segmentId,from:before,to:next,
  time:new Date().toISOString(),note:'推算/补录加班统计纳入选择（非审批）'});
 state.saved=false;rememberMonth();reanalyze();render();
 return true;
}
function analyzeDay(emp,d){
 const date=isoDate(d),punches=(r63AnalysisIndex?.daily.get(emp.id+'|'+date)||state.records.filter(r=>r.employeeId===emp.id&&r.datetime.slice(0,10)===date))
   .sort((a,b)=>a.datetime.localeCompare(b.datetime));
 const completePairs=attendanceDailyVisits(emp.id,date);
 const leaves=leaveFor(emp.id,date),trips=tripFor(emp.id,date),outings=outingFor(emp.id,date),
   overtime=overtimeFor(emp.id,date),countedOvertime=p109OvertimeDaySources(overtime,date),typ=dayType(d);
 let severity='normal',status='正常',issues=[],pairs=completePairs,pending=null,pairingUncertain=false;
 const suspect=message=>{
  if(!issues.includes(message))issues.push(message);
  if(severity!=='problem')severity='suspect';
 };
 const wholeVisits=attendanceVisitEvents(emp.id);
 const priority=p109PriorityAbsences(emp.id,date),coveredWorkPunch=time=>p109BusinessPriority()&&
  [[minutes(RULES.amStart),minutes(RULES.amEnd)],[minutes(RULES.pmStart),minutes(RULES.pmEnd)]].some(([a,b])=>time>=a&&time<=b)&&
  priority.some(([a,b])=>time>=a&&time<=b);
 for(let i=0;i<punches.length;i++){
  const p=punches[i],prev=punches[i-1],covered=coveredWorkPunch(minutes(p.time)),
   note=message=>{if(covered){if(!issues.includes(message+'（报备覆盖）'))issues.push(message+'（报备覆盖）')}else suspect(message)};
  if(!['进','出'].includes(p.direction)){note('未提供进出方向（待核）');if(!covered)pairingUncertain=true;continue}
  if(prev&&prev.direction===p.direction){
   const diff=Math.abs(minutes(p.time)-minutes(prev.time));
   note(diff<=RULES.dupSeconds/60?'疑似重复'+p.direction:
    '连续'+p.direction+(p.direction==='进'?'（无离开记录，按连续在岗计算）':''));
   if(p.direction==='出'&&!covered)pairingUncertain=true;
  }
  const stamp=attendanceUtcMinute(date,p.time);
  const matched=wholeVisits.some(v=>p.direction==='进'?
    stamp>=v.from&&stamp<v.to:
    stamp===v.to&&(v.exit.recordId===p.recordId||
      (!p.recordId&&v.exit.datetime===p.datetime)));
  if(matched)continue;
  if(p.direction==='进'){note('存在未闭合进入记录');if(!covered)pending=p}
  else note('缺少对应进入记录');
  if(!covered)pairingUncertain=true;
 }
 const business=analysisUnionSegments([...leaves,...outings,...trips].map(x=>[minutes(x.start||'00:00'),minutes(x.end||'24:00')]));
 const businessCovers=(start,end)=>{const a=typeof start==='number'?start:minutes(start),b=typeof end==='number'?end:minutes(end);return b<=a||business.some(([x,y])=>x<=a+1e-8&&y>=b-1e-8)};
 const morningLeave=businessCovers(RULES.amStart,RULES.amEnd),afternoonLeave=businessCovers(RULES.pmStart,RULES.pmEnd),fullExcused=morningLeave&&afternoonLeave;
 const lunchStart=minutes(RULES.amEnd),lunchEnd=minutes(RULES.pmStart);
 const attendanceFlags=[];
 // A shift-end exit is proven early only if no subsequent check-in
 // on or before the boundary could establish a continued on-duty interval.
 const earlyDeparture=(start,end,grace)=>{
  const limit=minutes(end)-Math.max(0,Number(grace)||0);
  const possibilities=pairs.filter(([x,y])=>minutes(x.time)<limit&&
   minutes(y.time)>=minutes(start)&&minutes(y.time)<limit);
  if(!possibilities.length)return null;
  const last=possibilities.reduce((a,b)=>minutes(a[1].time)>minutes(b[1].time)?a:b);
  if(punches.some(r=>r.direction==='进'&&minutes(r.time)>minutes(last[1].time)&&
    minutes(r.time)<=limit))return null;
  return last[1];
 };
 const workMinutes=analysisPairMinutes(pairs,RULES.amStart,RULES.amEnd)+
  analysisPairMinutes(pairs,RULES.pmStart,RULES.pmEnd);
 const presence=pairs.reduce((sum,[x,y])=>sum+Math.max(0,minutes(y.time)-minutes(x.time)),0);
 const firstIn=punches.find(p=>p.direction==='进');
 const lastOut=[...punches].reverse().find(p=>p.direction==='出');
 const morningPair=pairs.find(([x,y])=>minutes(x.time)<lunchStart&&
   minutes(y.time)>=lunchStart-90&&minutes(y.time)<=lunchEnd);
 const lunchReturn=pairs.find(([x,y])=>minutes(x.time)>=lunchStart-10&&
   minutes(x.time)<=lunchEnd+120&&minutes(y.time)>lunchEnd);
 const crossesLunch=pairs.some(([x,y])=>minutes(x.time)<lunchStart&&minutes(y.time)>lunchEnd);
 const lunchEvidence=crossesLunch?(isWorkday(d)?'未分段（班内工时按班次扣午休）':'连续在岗跨中午（不扣午休）'):
  morningPair&&lunchReturn?'有午休进出':'未明确';
 const autoOvertime=p109CompleteOvertime(estimateOvertimeCandidate(pairs,d,countedOvertime,pairingUncertain),emp.id,date,countedOvertime);
 const inputOvertime=[...overtime.map(r=>[minutes(r.start),minutes(r.end)]),...p109ManualOvertimeFor(emp.id,date).map(r=>[r.from,r.to])],
  overtimeConflictMinutes=analysisUnionMinutes(inputOvertime)-analysisUnionMinutes(inputOvertime.flatMap(([a,b])=>p109CountedOvertimeParts(date,a,b)));
 // A recalculated interval must not inherit a past exclusion from a DIFFERENT
 // imported evidence set even if its visible clock boundaries are identical.
 const sourceEvidence=[
  ...punches.map(p=>[p.recordId||'',p.importId||'',p.datetime||p.time||'',p.direction||''].join('/')),
  ...overtime.map(p=>[p.id||'',p.start||'',p.end||''].join('/'))
 ].join('|');
 let sourceHash=2166136261;
 for(let i=0;i<sourceEvidence.length;i++)
  sourceHash=Math.imul(sourceHash^sourceEvidence.charCodeAt(i),16777619)>>>0;
 const evidenceSuffix=sourceHash.toString(36);
 autoOvertime.segments=autoOvertime.segments.map(seg=>{
  // Shared ID links residual fragments to ONE uninterrupted in→out session.
  // One ×/✓ decision covers all of its parts, not only a fragment.
  const id=seg.id||seg.sessionId||'auto:'+emp.id+':'+date+':'+Math.round(seg.sessionFrom*60)+'-'+
   Math.round(seg.sessionTo*60)+':'+evidenceSuffix;
  return {...seg,id,employeeId:emp.id,date,origin:seg.origin||'auto',
   accepted:state.overtimeReview?.[id]!==false&&
    ![...state.monthStores.values()].some(store=>store.overtimeReview?.[id]===false)};
 });
 if(!state.records.length&&!state.leaves.length&&!state.trips.length&&!state.outings?.length&&!state.overtimeEntries?.length&&!state.manualOvertime?.length&&!state.manualTempOutings?.length){
  status='未导入';severity='rest';return pack();
 }
 if(!isWorkday(d)){
  if(punches.length||overtime.length){status='非工作日有出勤记录';severity=pairingUncertain?'suspect':'normal'}
  else{status='休息';severity='rest'}
  return pack();
 }
 if(fullExcused&&p109BusinessPriority()){
  severity='excused';status=trips.length?'出差':leaves.length?'请假':'外出';return pack();
 }
 if(!punches.length&&!pairs.length){
  if(fullExcused){status=trips.length?'出差':leaves.length?'请假':'外出';severity='excused'}
  else{status='缺勤';severity='problem';issues.push('工作日无打卡')}
 }else{
  const morningGrace=Number(RULES.graceAmStart??RULES.grace??5)||0,
    morningEndGrace=Number(RULES.graceAmEnd??0)||0,
    afternoonGrace=Number(RULES.gracePmStart??RULES.grace??5)||0,
    afternoonEndGrace=Number(RULES.gracePmEnd??0)||0,
    firstMinute=firstIn?minutes(firstIn.time):null;
  const morningEvidence=pairs.some(([x,y])=>minutes(x.time)<=lunchStart&&minutes(y.time)>minutes(RULES.amStart));
  const afternoonEvidence=pairs.some(([x,y])=>minutes(y.time)>lunchEnd&&minutes(x.time)<minutes(RULES.pmEnd));
  if(firstIn&&!morningLeave){
   if(firstMinute>minutes(RULES.amStart)+morningGrace&&firstMinute<lunchStart&&!businessCovers(RULES.amStart,firstMinute)){
    severity='problem';issues.push('迟到');status='迟到';
    attendanceFlags.push({kind:'late',label:'迟到',time:firstIn.time});
   }else if(!morningEvidence&&firstMinute>lunchStart){
    suspect('上午缺少完整出勤证据（待核）');
   }
  }
  if(lastOut&&!afternoonLeave){
   const lastMinute=minutes(lastOut.time);
   // Without any complete afternoon exit, a lunchtime "出" cannot
   // establish a definite early departure.
   if(afternoonEvidence&&!pending&&lastMinute<minutes(RULES.pmEnd)-afternoonEndGrace&&!businessCovers(lastMinute,RULES.pmEnd)){
    severity='problem';issues.push('早退');status=status==='迟到'?'迟到/早退':'早退';
    attendanceFlags.push({kind:'early',label:'早退',time:lastOut.time});
   }else if(!afternoonEvidence||pending){
    suspect('下午进出记录不完整（待核）');
   }
  }
  const morningExit=!morningLeave?earlyDeparture(RULES.amStart,RULES.amEnd,morningEndGrace):null;
  if(morningExit&&!businessCovers(minutes(morningExit.time),lunchStart)){
   if(!pairingUncertain){
    if(!issues.includes('上午早退'))issues.push('上午早退');
    attendanceFlags.push({kind:'early',label:'上午早退',time:morningExit.time});
    severity='problem';status=status.includes('迟到')?'迟到/早退':'早退';
   }else suspect('午休提前离岗（待核）');
  }
  if(morningPair&&lunchReturn&&!afternoonLeave){
   const returnMinute=minutes(lunchReturn[0].time);
   const covered=businessCovers(lunchEnd,returnMinute);
   if(returnMinute>lunchEnd+afternoonGrace&&!covered){
    // Completed afternoon evidence permits a definite late check; missing
    // afternoon punches remain an uncertainty, never a fabricated absence.
    if(afternoonEvidence&&!pairingUncertain){
     issues.push('下午迟到');severity='problem';
     attendanceFlags.push({kind:'late',label:'下午迟到',time:lunchReturn[0].time});
     status=status==='迟到'?'上午/下午迟到':status==='早退'?'迟到/早退':'下午迟到';
    }else suspect('午休返岗偏晚（待核）');
   }
  }
  if((!firstIn||!lastOut)&&!completePairs.length&&severity!=='problem')
   suspect('打卡记录不完整（待核）');
  if(severity==='suspect'&&status==='正常')status='疑似打卡异常';
  if((leaves.length||trips.length||outings.length)&&severity==='normal')
   status=trips.length?'出差覆盖':leaves.length?'请假覆盖':'外出覆盖';
 }
 function pack(){
  const initialSeverity=severity,initialStatus=status,initialIssues=[...issues];
  for(const flag of attendanceFlags){
   const punch=punches.find(p=>p.time===flag.time&&p.direction===(flag.kind==='late'?'进':'出'));
   const evidence=[punch?.recordId||'',punch?.importId||'',punch?.datetime||flag.time,punch?.direction||''].join('/');
   flag.id='attendance:'+emp.id+':'+date+':'+flag.kind+':'+flag.label+':'+evidence;
   Object.assign(flag,{employeeId:emp.id,date,accepted:state.attendanceReview?.[flag.id]!==false});
  }
  if(attendanceFlags.some(flag=>!flag.accepted)){
   const active=activeAttendanceFlags({attendanceFlags});
   issues=issues.filter(message=>!attendanceFlags.some(flag=>!flag.accepted&&flag.label===message));
   if(active.length){severity='problem';status=active.map(flag=>flag.label).join('/')}
   else if(issues.length){severity='suspect';status='疑似打卡异常'}
   else{severity='normal';status=trips.length?'出差覆盖':leaves.length?'请假覆盖':outings.length?'外出覆盖':'正常'}
  }
  const temporaryOutings=p109TemporaryOutings(emp,date,punches,pairs);
  return {initialSeverity,initialStatus,initialIssues,employee:emp,date,day:d,dayType:typ,punches,pairs,leaves,trips,outings,overtime,countedOvertime,overtimeConflictMinutes,
  severity,status,issues,firstIn:firstIn?.time||'',lastOut:lastOut?.time||'',presence,workMinutes,
  lunchEvidence,autoOvertime,temporaryOutings,attendanceFlags,marker:''}}
 return pack();
}
function reanalyze(){
 const index={adjacent:new Map(),visits:new Map(),daily:new Map()};
 for(const row of state.records){
  const date=String(row.datetime||'').slice(0,10),key=row.employeeId+'|'+date;
  if(!index.daily.has(key))index.daily.set(key,[]);
  index.daily.get(key).push(row);
 }
 r63AnalysisIndex=index;
 try{
  state.analysis=new Map();
  for(const e of EMPLOYEES)for(let d=1;d<=monthDays();d++)
   state.analysis.set(e.id+'|'+d,analyzeDay(e,d));
 }finally{r63AnalysisIndex=null}
}
function statsFor(items){const total=items.length,problems=items.filter(x=>x.severity==='problem').length,suspects=items.filter(x=>x.severity==='suspect').length,normal=items.filter(x=>x.severity==='normal').length,rest=items.filter(x=>x.severity==='rest').length,excused=items.filter(x=>x.severity==='excused').length;return {total,problems,suspects,normal,rest,excused}}
function workAnalyses(){return [...state.analysis.values()].filter(x=>isWorkday(x.day)&&!p109Ignored(x.employee.id))}
