function excelSerialToDateTime(n){if(typeof n!=='number')return String(n??'');const ms=(n-25569)*86400000;const d=new Date(ms);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`}
function aliases(obj,names){for(const n of names)if(Object.prototype.hasOwnProperty.call(obj,n)&&obj[n]!==''&&obj[n]!=null)return obj[n];return ''}
// Imported people are identified by an editable month-scoped roster, never by
// public demo names. Parse and validate before changing any live data.
function sourceRow(r,i){return Number(r.__rowNumber)||i+2}
function validClock(t){return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(t))}
function importClock(v,fallback){
  if(typeof v==='number'&&v>=0&&v<1){const m=Math.round(v*1440);return pad(Math.floor(m/60)%24)+':'+pad(m%60)}
  if(v==null||String(v).trim()==='')return fallback;
  const raw=String(v).trim();
  if(!validClock(raw))throw new Error('导入文件包含无效时间：'+raw.slice(0,40));
  return raw.slice(0,5);
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
 const byName=new Map(people.map(e=>[e.name,e]));
 for(const name of unique)if(!byName.has(name)){
  const e={id:personIdentity(name),name,department:'未分类'};
  people.push(e);byName.set(name,e);
 }
 return {people,byName,resetDemo};
}
function applyImportRoster(plan,meta){
  if(!plan.resetDemo)r62MigrateActive();
  if(plan.resetDemo){
    state.records=[];state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];
    state.manualStatuses={};state.judgmentMode='initial';state.revisions=[];state.revisionSeq=0;
    state.imports=[meta];
    const pinGroups=state.projectProfile?.groups||state.groups;
    state.groups=Object.fromEntries(plan.people.filter(e=>(state.fixedPeople||[]).includes(e.id))
      .map(e=>[e.id,pinGroups[e.id]||'未分组']));
    state.groupCatalog=[...(state.projectProfile?.groupCatalog||[])];
  }
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
async function importAttendance(file,prepared=null){
  const t=prepared||await XLSX.readTable(file),parsed=[];
  validateImportIdentityRows(t.rows);
  t.rows.forEach((r,i)=>{
    const name=normalizedPerson(aliases(r,['姓名','人员','员工姓名','name']));
    const datetime=importedDate(aliases(r,['打卡时间','时间','datetime','DateTime']));
    const direction=String(aliases(r,['进出','方向','状态','direction'])).trim();
    if(!name||!/^(进|出)$/.test(direction)||!strictDateTime(datetime))return;
    // Include exactly one adjoining day on each side: a 20:00→02:00
    // session can straddle month-end without losing its exit punch.
    const {first,last}=attendanceNeighborDates(),stamp=
      attendanceUtcMinute(datetime.slice(0,10),datetime.slice(11));
    if(stamp<first-1440||stamp>=last+1440)return;
    parsed.push({name,datetime,time:datetime.slice(11,19),direction,row:sourceRow(r,i)});
  });
  if(!parsed.length)throw new Error('未识别到本月有效考勤记录，请确认姓名、打卡时间与进出列');
  const plan=importRosterPlan(parsed.map(r=>r.name),'attendance');
  if(!plan.resetDemo&&!state.isDemo&&state.records.length&&!window.confirm('本月已有考勤记录，新文件将替换当前考勤工作数据（历史 raw 文件不会删除）。是否继续？'))throw new Error('已取消考勤覆盖');
  const importId='I'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const out=parsed.map(r=>{
    const employee=plan.byName.get(r.name);
    return {recordId:'import:'+importId+':'+r.row,importId,employeeId:employee.id,name:r.name,
      datetime:r.datetime,time:r.time,direction:r.direction,source:file.name,sheet:t.sheet,row:r.row,scenario:'import'};
  });
  const meta=await persistImportedFile(file,'attendance',out.length,importId);
  applyImportRoster(plan,meta);acceptImportedRows('attendance',out,plan,t.rows.length-out.length);
}
async function importLeaves(file,prepared=null){
  const t=prepared||await XLSX.readTable(file),parsed=[];
  validateImportIdentityRows(t.rows);
  t.rows.forEach((r,i)=>{
    const name=normalizedPerson(aliases(r,['姓名','人员','员工姓名']));
    const date=r62Date(aliases(r,['日期','请假日期','date']));
    if(!name||!strictISODate(date)||!date.startsWith(monthISO()+'-'))return;
    parsed.push({name,date,row:sourceRow(r,i),start:importClock(aliases(r,['开始时间','开始','start']),RULES.amStart),
      end:importClock(aliases(r,['结束时间','结束','end']),RULES.pmEnd),
      type:String(aliases(r,['类型','假别','type'])||'请假'),note:String(aliases(r,['备注','说明','note'])||'')});
  });
  if(!parsed.length)throw new Error('未识别到本月有效请假记录');
  const plan=importRosterPlan(parsed.map(r=>r.name),'leave');
  if(!plan.resetDemo&&state.leaves.length&&!window.confirm('本月已有请假记录，新文件将替换当前请假工作数据。是否继续？'))throw new Error('已取消请假覆盖');
  const importId='I'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const out=parsed.map(r=>({id:'LI-'+importId+'-'+r.row,importId,employeeId:plan.byName.get(r.name).id,
    ...r,source:file.name,sheet:t.sheet}));
  const meta=await persistImportedFile(file,'leave',out.length,importId);
  applyImportRoster(plan,meta);acceptImportedRows('leave',out,plan,t.rows.length-out.length);
}
async function importTrips(file,prepared=null){
  const t=prepared||await XLSX.readTable(file),parsed=[];
  validateImportIdentityRows(t.rows);
  t.rows.forEach((r,i)=>{
    const name=normalizedPerson(aliases(r,['姓名','人员','员工姓名']));
    const startDate=r62Date(aliases(r,['开始日期','起始日期','startDate']));
    const endDate=r62Date(aliases(r,['结束日期','截止日期','endDate'])||startDate);
    if(!name||!strictISODate(startDate)||!strictISODate(endDate)
      ||startDate>endDate||startDate>monthISO()+'-'+pad(monthDays())||endDate<monthISO()+'-01')return;
    parsed.push({name,startDate,endDate,row:sourceRow(r,i),type:String(aliases(r,['类型','事项','type'])||'出差'),
      place:String(aliases(r,['地点','目的地','place'])||''),note:String(aliases(r,['备注','说明','note'])||'')});
  });
  if(!parsed.length)throw new Error('未识别到本月有效出差记录');
  const plan=importRosterPlan(parsed.map(r=>r.name),'trip');
  if(!plan.resetDemo&&state.trips.length&&!window.confirm('本月已有出差记录，新文件将替换当前出差工作数据。是否继续？'))throw new Error('已取消出差覆盖');
  const importId='I'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
  const out=parsed.map(r=>({id:'TI-'+importId+'-'+r.row,importId,employeeId:plan.byName.get(r.name).id,
    ...r,source:file.name,sheet:t.sheet}));
  const meta=await persistImportedFile(file,'trip',out.length,importId);
  applyImportRoster(plan,meta);acceptImportedRows('trip',out,plan,t.rows.length-out.length);
}
/* R50: user-provided outing and overtime records are separate from inferred candidates.
 * Multi-day outings use the same daily clock window; cross-midnight shifts need
 * an approved shift policy and are explicitly rejected rather than guessed. */
async function importOutings(file,prepared=null){
 const t=prepared||await XLSX.readTable(file),parsed=[];
 validateImportIdentityRows(t.rows);
 t.rows.forEach((r,i)=>{
  const name=normalizedPerson(aliases(r,['姓名','人员','员工姓名','name']));
  const startDate=r62Date(aliases(r,['开始日期','日期','startDate','date']));
  const endDate=r62Date(aliases(r,['结束日期','endDate'])||startDate);
  if(!name||!strictISODate(startDate)||!strictISODate(endDate)||
     startDate>endDate||startDate>monthISO()+'-'+pad(monthDays())||endDate<monthISO()+'-01')return;
  const start=importClock(aliases(r,['开始时间','开始','start']),'');
  const end=importClock(aliases(r,['结束时间','结束','end']),'');
  if(!start||!end)return;
  if(minutes(end)<=minutes(start))throw new Error('外出起止时间须在同一日内且结束晚于开始；跨日请拆分并人工核查');
  parsed.push({name,startDate,endDate,start,end,row:sourceRow(r,i),
   type:String(aliases(r,['类型','事项','type'])||'外出'),
   note:String(aliases(r,['备注','说明','note'])||''),
   place:String(aliases(r,['地点','目的地','place'])||'')});
 });
 if(!parsed.length)throw new Error('未识别到本月有效外出记录');
 const plan=importRosterPlan(parsed.map(r=>r.name),'outing');
 if(!plan.resetDemo&&state.outings.length&&
    !window.confirm('本月已有外出记录，新文件将替换当前外出工作数据。是否继续？'))
  throw new Error('已取消外出覆盖');
 const importId='I'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
 const out=parsed.map(r=>({id:'OI-'+importId+'-'+r.row,importId,employeeId:plan.byName.get(r.name).id,
  ...r,source:file.name,sheet:t.sheet}));
 const meta=await persistImportedFile(file,'outing',out.length,importId);
 applyImportRoster(plan,meta);acceptImportedRows('outing',out,plan,t.rows.length-out.length);
}
async function importOvertime(file,prepared=null){
 const t=prepared||await XLSX.readTable(file),parsed=[];
 validateImportIdentityRows(t.rows);
 t.rows.forEach((r,i)=>{
  const name=normalizedPerson(aliases(r,['姓名','人员','员工姓名','name']));
  const date=r62Date(aliases(r,['日期','加班日期','date']));
  if(!name||!strictISODate(date)||!date.startsWith(monthISO()+'-'))return;
  const start=importClock(aliases(r,['开始时间','开始','start']),'');
  const end=importClock(aliases(r,['结束时间','结束','end']),'');
  if(!start||!end)return;
  if(minutes(end)===minutes(start))throw new Error('登记加班起止时间相同，请明确记录有效区间；跨午夜请填写次日结束时刻');
  parsed.push({name,date,start,end,row:sourceRow(r,i),
   type:String(aliases(r,['类型','事项','type'])||'登记加班'),
   note:String(aliases(r,['备注','说明','note'])||'')});
 });
 if(!parsed.length)throw new Error('未识别到本月有效登记加班记录');
 const plan=importRosterPlan(parsed.map(r=>r.name),'overtime');
 if(!plan.resetDemo&&state.overtimeEntries.length&&
    !window.confirm('本月已有登记加班，新文件将替换当前加班工作数据。是否继续？'))
  throw new Error('已取消加班覆盖');
 const importId='I'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
 const out=parsed.map(r=>({id:'OTI-'+importId+'-'+r.row,importId,employeeId:plan.byName.get(r.name).id,
  ...r,source:file.name,sheet:t.sheet}));
 const meta=await persistImportedFile(file,'overtime',out.length,importId);
 applyImportRoster(plan,meta);acceptImportedRows('overtime',out,plan,t.rows.length-out.length);
}
function leaveFor(empId,date){return state.leaves.filter(x=>x.employeeId===empId&&x.date===date)}
function tripFor(empId,date){return state.trips.filter(x=>x.employeeId===empId&&date>=x.startDate&&date<=x.endDate)}
function intervalOverlap(a1,a2,b1,b2){return Math.max(0,Math.min(a2,b2)-Math.max(a1,b1))}
/* R15: judgments and behaviors are independent dimensions. Purple is selection only. */
const ATTEND_STATUS_COLORS=Object.freeze({normal:'#78caa0',anomaly:'#e6c36f',absent:'#e58f90',rest:'#eef2f6'});
const ATTEND_BEHAVIOR_COLORS=Object.freeze({trip:'#6b7fd7',leave:'#8a6fd1',outing:'#3c9dc4',overtime:'#c876a0'});
const ATTEND_EVENT_COLORS=Object.freeze({in:'#1f5a9f',out:'#8a5b3d'});
function manualStatusKey(aOrId,day){
  return typeof aOrId==='string'?aOrId+'|'+day:aOrId.employee.id+'|'+aOrId.day;
}
function manualStatusFor(a){return state.manualStatuses?.[manualStatusKey(a)]||null}
function hasManualStatuses(){return !!state.manualStatuses&&Object.keys(state.manualStatuses).length>0}
function attendanceJudgmentSystem(a){
  if(!isWorkday(a.day))return 'rest';
  if(a.severity==='excused')return 'normal';
  if(a.status==='缺勤')return 'absent';
  if(a.severity==='problem'||a.severity==='suspect')return 'anomaly';
  if(a.severity==='normal')return 'normal';
  return 'rest';
}
function attendanceJudgment(a,mode='final'){
  const initial=attendanceJudgmentSystem(a);
  // The initial system verdict is a comparison view only. Every canonical
  // output/aggregate reads the operator's final verdict first, without
  // modifying the source punches or the original automated diagnosis.
  return mode==='initial'?initial:(manualStatusFor(a)||initial);
}
function attendanceBehaviors(a){
  const results=[];
  if(a.trips?.length)results.push('trip');
  if(a.leaves?.length)results.push('leave');
  if(a.outings?.length||state.outings?.some(x=>x.employeeId===a.employee.id&&a.date>=x.startDate&&a.date<=x.endDate))results.push('outing');
  if(a.overtime?.length||activeAutoOvertimeSegments(a).length||
    (!isWorkday(a.day)&&a.punches.length)||state.overtimeEntries?.some(x=>x.employeeId===a.employee.id&&x.date===a.date))
   results.push('overtime');
  return results;
}
function attendanceCategory(a){return attendanceJudgment(a)}
function matrixCategory(a,filter=state.filter){
  return ['trip','leave','outing','overtime'].includes(filter)&&attendanceBehaviors(a).includes(filter)?filter:
   attendanceJudgment(a,state.judgmentMode==='initial'?'initial':'final');
}
function categoryColor(category){return ATTEND_STATUS_COLORS[category]||ATTEND_BEHAVIOR_COLORS[category]||ATTEND_STATUS_COLORS.rest}
function outingFor(empId,date){return (state.outings||[]).filter(x=>x.employeeId===empId&&date>=x.startDate&&date<=x.endDate)}
function overtimeFor(empId,date){return attendanceDailyRegistered(empId,date)}
function behaviorMinutes(a,kind){
  const intervals=kind==='leave'?a.leaves:kind==='outing'?a.outings:kind==='overtime'?a.overtime:[];
  if(kind==='trip')return a.trips.length?Math.max(0,minutes(RULES.amEnd)-minutes(RULES.amStart))+Math.max(0,minutes(RULES.pmEnd)-minutes(RULES.pmStart)):0;
  return intervals.reduce((sum,x)=>sum+Math.max(0,minutes(x.end||'00:00')-minutes(x.start||'00:00')),0);
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
   x.datetime&&['进','出'].includes(x.direction))
  .sort((a,b)=>a.datetime.localeCompare(b.datetime)||
    (a.direction==='进'?-1:1));
 const visits=[];let pending=null;
 for(const row of rows){
  const stamp=attendanceUtcMinute(row.datetime.slice(0,10),row.time||row.datetime.slice(11));
  if(row.direction==='进'){
   if(!pending)pending={row,stamp};
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
 const custom=state.calendarOverrides?.[date];
 if(['holiday','rest'].includes(custom))return false;
 if(['work','adjust','adjusted-work'].includes(custom))return true;
 const day=new Date(date+'T00:00:00Z').getUTCDay();
 return day!==0&&day!==6;
}
function attendanceVisitEligibleMinutes(visit){
 let total=0;
 for(let cursor=Math.floor(visit.from/1440)*1440;cursor<visit.to;cursor+=1440){
  const date=attendanceDateFromMinute(cursor),a=Math.max(visit.from,cursor),
   z=Math.min(visit.to,cursor+1440),start=visit.from<cursor||!attendanceDateIsWork(date)?
    cursor:cursor+minutes(RULES.pmEnd);
  // Noon overtime needs a completed morning departure, not an uninterrupted full day.
  if(attendanceDateIsWork(date)&&visit.from<cursor+minutes(RULES.amEnd)&&
     visit.to<=cursor+minutes(RULES.pmStart))
   total+=Math.max(0,Math.min(z,cursor+minutes(RULES.pmStart))-
       Math.max(a,cursor+minutes(RULES.amEnd)));
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
 const minMinutes=Number.isFinite(+RULES.overtimeMinMinutes)?Math.max(20,+RULES.overtimeMinMinutes):20;
 if(pairingUncertain)return {minutes:0,rawMinutes:0,threshold:minMinutes,
  reason:'打卡进出配对待核',segments:[]};
 const windows=isWorkday(day)?[[minutes(RULES.amEnd),minutes(RULES.pmStart)],[minutes(RULES.pmEnd),1440]]:
   [[0,1440]];
 const eligible=[];
 for(const [enter,exit] of pairs){
  const a=minutes(enter.time),b=minutes(exit.time);
  const activeWindows=enter.sessionCarry?[[0,1440]]:windows;
  for(const [start,end] of activeWindows){
   // A continuous visit extending into the afternoon is not a lunch OT session.
   if(isWorkday(day)&&start===minutes(RULES.amEnd)&&
      (a>=minutes(RULES.amEnd)||b>minutes(RULES.pmStart)))continue;
   const from=Math.max(a,start),to=Math.min(b,end);
   if(to>from)eligible.push([from,to,enter.sessionId||null,
     enter.sessionEligibleMinutes||0,enter.sessionFrom,enter.sessionTo]);
  }
 }
 // Preserve original visit identities across midnight and across dates.
 // A session may touch several date slices; its threshold is checked ONCE
 // against the entire continuous overtime-eligible period.
 const valid=eligible.map(([from,to,id,qualifying,sessionFrom,sessionTo])=>({
  from,to,id,qualifying,sessionFrom,sessionTo}));
 const registeredIntervals=analysisUnionSegments(registered.map(r=>[
  minutes(r.start||''),minutes(r.end||'')]));
 // Decide the 5-minute threshold on the continuous in→out evidence first.
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
  // A 4-minute leftover from a 15-minute session is eligible; a separate
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
 const before=found.accepted!==false,next=!!accepted;
 if(before===next)return true;
 if(!state.overtimeReview)state.overtimeReview={};
 for(const store of state.monthStores.values()){
  if(!store.overtimeReview)store.overtimeReview={};
  if(next)delete store.overtimeReview[segmentId];
  else store.overtimeReview[segmentId]=false;
 }
 if(next)delete state.overtimeReview[segmentId];
 else state.overtimeReview[segmentId]=false;
 state.revisions.push({id:'R'+(++state.revisionSeq),key:found.employeeId+'|'+found.date,
  action:'auto-overtime-inclusion',segmentId,from:before,to:next,
  time:new Date().toISOString(),note:'自动推算加班统计纳入选择（非审批）'});
 state.saved=false;rememberMonth();reanalyze();render();
 return true;
}
function analyzeDay(emp,d){
 const date=isoDate(d),punches=(r63AnalysisIndex?.daily.get(emp.id+'|'+date)||state.records.filter(r=>r.employeeId===emp.id&&r.datetime.slice(0,10)===date))
   .sort((a,b)=>a.datetime.localeCompare(b.datetime));
 const completePairs=attendanceDailyVisits(emp.id,date);
 const leaves=leaveFor(emp.id,date),trips=tripFor(emp.id,date),outings=outingFor(emp.id,date),
   overtime=overtimeFor(emp.id,date),typ=dayType(d);
 let severity='normal',status='正常',issues=[],pairs=completePairs,pending=null,pairingUncertain=false;
 const suspect=message=>{
  if(!issues.includes(message))issues.push(message);
  if(severity!=='problem')severity='suspect';
 };
 const wholeVisits=attendanceVisitEvents(emp.id);
 for(let i=0;i<punches.length;i++){
  const p=punches[i],prev=punches[i-1];
  if(prev&&prev.direction===p.direction){
   const diff=Math.abs(minutes(p.time)-minutes(prev.time));
   suspect(diff<=RULES.dupSeconds/60?'疑似重复'+p.direction:
    '连续'+p.direction+(p.direction==='进'?'（无离开记录，按连续在岗计算）':''));
   if(p.direction==='出')pairingUncertain=true;
  }
  const stamp=attendanceUtcMinute(date,p.time);
  const matched=wholeVisits.some(v=>p.direction==='进'?
    stamp>=v.from&&stamp<v.to:
    stamp===v.to&&(v.exit.recordId===p.recordId||
      (!p.recordId&&v.exit.datetime===p.datetime)));
  if(matched)continue;
  if(p.direction==='进'){suspect('存在未闭合进入记录');pending=p}
  else suspect('缺少对应进入记录');
  pairingUncertain=true;
 }
 const covers=(rows,start,end)=>rows.some(x=>minutes(x.start||'00:00')<=minutes(start)&&minutes(x.end||'24:00')>=minutes(end));
 const overlapEnough=(rows,start,end,need=180)=>rows.some(x=>
   intervalOverlap(minutes(x.start||'00:00'),minutes(x.end||'24:00'),minutes(start),minutes(end))>=need);
 const fullExcused=trips.length>0||covers(leaves,RULES.amStart,RULES.pmEnd)||covers(outings,RULES.amStart,RULES.pmEnd);
 const morningLeave=trips.length>0||overlapEnough(leaves,RULES.amStart,RULES.amEnd)||overlapEnough(outings,RULES.amStart,RULES.amEnd);
 const afternoonLeave=trips.length>0||overlapEnough(leaves,RULES.pmStart,RULES.pmEnd)||overlapEnough(outings,RULES.pmStart,RULES.pmEnd);
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
 const autoOvertime=estimateOvertimeCandidate(pairs,d,overtime,pairingUncertain);
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
  const id=seg.sessionId||'auto:'+emp.id+':'+date+':'+Math.round(seg.sessionFrom*60)+'-'+
   Math.round(seg.sessionTo*60)+':'+evidenceSuffix;
  return {...seg,id,employeeId:emp.id,date,origin:'auto',
   accepted:state.overtimeReview?.[id]!==false&&
    ![...state.monthStores.values()].some(store=>store.overtimeReview?.[id]===false)};
 });
 if(!state.records.length&&!state.leaves.length&&!state.trips.length&&!state.outings?.length&&!state.overtimeEntries?.length){
  status='未导入';severity='rest';return pack();
 }
 if(!isWorkday(d)){
  if(punches.length||overtime.length){status='非工作日有出勤记录';severity=pairingUncertain?'suspect':'normal'}
  else{status=typ==='holiday'?'节假日':'休息';severity='rest'}
  return pack();
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
   if(morningEvidence&&firstMinute>minutes(RULES.amStart)+morningGrace){
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
   if(afternoonEvidence&&!pending&&lastMinute<minutes(RULES.pmEnd)-afternoonEndGrace){
    severity='problem';issues.push('早退');status=status==='迟到'?'迟到/早退':'早退';
    attendanceFlags.push({kind:'early',label:'早退',time:lastOut.time});
   }else if(!afternoonEvidence||pending){
    suspect('下午进出记录不完整（待核）');
   }
  }
  const morningExit=!morningLeave?earlyDeparture(RULES.amStart,RULES.amEnd,morningEndGrace):null;
  if(morningExit){
   if(!pairingUncertain){
    if(!issues.includes('上午早退'))issues.push('上午早退');
    attendanceFlags.push({kind:'early',label:'上午早退',time:morningExit.time});
    severity='problem';status=status.includes('迟到')?'迟到/早退':'早退';
   }else suspect('午休提前离岗（待核）');
  }
  if(morningPair&&lunchReturn&&!afternoonLeave){
   const returnMinute=minutes(lunchReturn[0].time);
   const covered=[...leaves,...outings].some(row=>
     minutes(row.start||'00:00')<=lunchEnd+afternoonGrace&&
     minutes(row.end||'00:00')>=returnMinute-afternoonGrace);
   if(returnMinute>lunchEnd+afternoonGrace&&!covered&&!trips.length){
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
 function pack(){return {employee:emp,date,day:d,dayType:typ,punches,pairs,leaves,trips,outings,overtime,
  severity,status,issues,firstIn:firstIn?.time||'',lastOut:lastOut?.time||'',presence,workMinutes,
  lunchEvidence,autoOvertime,attendanceFlags,marker:''}}
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
function workAnalyses(){return [...state.analysis.values()].filter(x=>isWorkday(x.day))}
