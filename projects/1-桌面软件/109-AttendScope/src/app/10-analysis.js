function excelSerialToDateTime(n){if(typeof n!=='number')return String(n??'');const ms=(n-25569)*86400000;const d=new Date(ms);return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`}
function aliases(obj,names){for(const n of names)if(Object.prototype.hasOwnProperty.call(obj,n)&&obj[n]!==''&&obj[n]!=null)return obj[n];return ''}
async function importAttendance(file){const t=await XLSX.readTable(file);const rows=t.rows;const out=[];let rowNo=2;
  for(const r of rows){const name=String(aliases(r,['姓名','人员','员工姓名','name'])).trim();let dt=aliases(r,['打卡时间','时间','datetime','DateTime']);const dir=String(aliases(r,['进出','方向','状态','direction'])).trim();if(typeof dt==='number')dt=excelSerialToDateTime(dt);dt=String(dt).replace('T',' ');const emp=EMPLOYEES.find(e=>e.name===name);if(!emp||!/^(进|出)$/.test(dir)||!(dt.startsWith(monthISO()+'-')&&Number(dt.slice(8,10))>=1&&Number(dt.slice(8,10))<=monthDays())){rowNo++;continue}const time=dt.slice(11,19)||'00:00:00';out.push({recordId:`import:${Date.now()}:${rowNo}`,employeeId:emp.id,name,datetime:dt,time,direction:dir,source:file.name,sheet:t.sheet,row:rowNo,scenario:'import'});rowNo++}
  if(!out.length)throw new Error('未识别到有效考勤记录，请确认列名包含“姓名 / 打卡时间 / 进出”。'); state.records=out;await persistImportedFile(file,'attendance',out.length);state.saved=false;reanalyze();render();toast(`已导入 ${out.length} 条考勤记录`)}
async function importLeaves(file){const t=await XLSX.readTable(file);const out=[];let rowNo=2;for(const r of t.rows){const name=String(aliases(r,['姓名','人员','员工姓名'])).trim();const emp=EMPLOYEES.find(e=>e.name===name);let date=String(aliases(r,['日期','请假日期','date'])).slice(0,10);if(typeof aliases(r,['日期','请假日期','date'])==='number')date=excelSerialToDateTime(aliases(r,['日期','请假日期','date'])).slice(0,10);if(!emp||!date||!date.startsWith(monthISO()))continue;out.push({id:`LI-${Date.now()}-${rowNo}`,employeeId:emp.id,name,date,start:String(aliases(r,['开始时间','开始','start'])||'08:30').slice(0,5),end:String(aliases(r,['结束时间','结束','end'])||'17:30').slice(0,5),type:String(aliases(r,['类型','假别','type'])||'请假'),note:String(aliases(r,['备注','说明','note'])||''),source:file.name,row:rowNo});rowNo++}if(!out.length)throw new Error('未识别到有效请假记录。');state.leaves=out;await persistImportedFile(file,'leave',out.length);state.saved=false;reanalyze();render();toast(`已导入 ${out.length} 条请假记录`)}
async function importTrips(file){const t=await XLSX.readTable(file);const out=[];let rowNo=2;for(const r of t.rows){const name=String(aliases(r,['姓名','人员','员工姓名'])).trim(),emp=EMPLOYEES.find(e=>e.name===name);let sd=aliases(r,['开始日期','起始日期','startDate']),ed=aliases(r,['结束日期','截止日期','endDate']);if(typeof sd==='number')sd=excelSerialToDateTime(sd).slice(0,10);if(typeof ed==='number')ed=excelSerialToDateTime(ed).slice(0,10);sd=String(sd).slice(0,10);ed=String(ed||sd).slice(0,10);if(!emp||!sd||sd>monthISO()+'-'+pad(monthDays())||ed<monthISO()+'-01')continue;out.push({id:`TI-${Date.now()}-${rowNo}`,employeeId:emp.id,name,startDate:sd,endDate:ed,type:String(aliases(r,['类型','事项','type'])||'出差'),place:String(aliases(r,['地点','目的地','place'])||''),note:String(aliases(r,['备注','说明','note'])||''),source:file.name,row:rowNo});rowNo++}if(!out.length)throw new Error('未识别到有效出差记录。');state.trips=out;await persistImportedFile(file,'trip',out.length);state.saved=false;reanalyze();render();toast(`已导入 ${out.length} 条出差记录`)}
function leaveFor(empId,date){return state.leaves.filter(x=>x.employeeId===empId&&x.date===date)}
function tripFor(empId,date){return state.trips.filter(x=>x.employeeId===empId&&date>=x.startDate&&date<=x.endDate)}
function intervalOverlap(a1,a2,b1,b2){return Math.max(0,Math.min(a2,b2)-Math.max(a1,b1))}
/* R15: judgments and behaviors are independent dimensions. Purple is selection only. */
const ATTEND_STATUS_COLORS=Object.freeze({normal:'#78caa0',anomaly:'#e6c36f',absent:'#e58f90',rest:'#eef2f6'});
const ATTEND_BEHAVIOR_COLORS=Object.freeze({trip:'#4c8ed9',leave:'#e9954f',outing:'#36afa8',overtime:'#c96e9e'});
const ATTEND_EVENT_COLORS=Object.freeze({in:'#45a7df',out:'#efa05e'});
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
function attendanceJudgment(a,mode=state.judgmentMode||'initial'){
  const initial=attendanceJudgmentSystem(a);
  return mode==='manual'?(manualStatusFor(a)||initial):initial;
}
function attendanceBehaviors(a){
  const results=[];
  if(a.trips?.length)results.push('trip');
  if(a.leaves?.length)results.push('leave');
  if(a.outings?.length||state.outings?.some(x=>x.employeeId===a.employee.id&&a.date>=x.startDate&&a.date<=x.endDate))results.push('outing');
  if(a.overtime?.length||(!isWorkday(a.day)&&a.punches.length)||state.overtimeEntries?.some(x=>x.employeeId===a.employee.id&&x.date===a.date))results.push('overtime');
  return results;
}
function attendanceCategory(a){return attendanceJudgment(a)}
function matrixCategory(a,filter=state.filter){
  return ['trip','leave','outing','overtime'].includes(filter)&&attendanceBehaviors(a).includes(filter)?filter:attendanceJudgment(a);
}
function categoryColor(category){return ATTEND_STATUS_COLORS[category]||ATTEND_BEHAVIOR_COLORS[category]||ATTEND_STATUS_COLORS.rest}
function outingFor(empId,date){return (state.outings||[]).filter(x=>x.employeeId===empId&&date>=x.startDate&&date<=x.endDate)}
function overtimeFor(empId,date){return (state.overtimeEntries||[]).filter(x=>x.employeeId===empId&&x.date===date)}
function behaviorMinutes(a,kind){
  const intervals=kind==='leave'?a.leaves:kind==='outing'?a.outings:kind==='overtime'?a.overtime:[];
  if(kind==='trip')return a.trips.length?Math.max(0,minutes(RULES.amEnd)-minutes(RULES.amStart))+Math.max(0,minutes(RULES.pmEnd)-minutes(RULES.pmStart)):0;
  return intervals.reduce((sum,x)=>sum+Math.max(0,minutes(x.end||'00:00')-minutes(x.start||'00:00')),0);
}
function analyzeDay(emp,d){
  const date=isoDate(d),punches=state.records.filter(r=>r.employeeId===emp.id&&r.datetime.slice(0,10)===date).sort((a,b)=>a.datetime.localeCompare(b.datetime));
  const leaves=leaveFor(emp.id,date),trips=tripFor(emp.id,date),outings=outingFor(emp.id,date),overtime=overtimeFor(emp.id,date),typ=dayType(d);
  let severity='normal',status='正常',issues=[],pairs=[],pending=null;
  for(let i=0;i<punches.length;i++){
    const p=punches[i],prev=punches[i-1];
    if(prev&&prev.direction===p.direction){
      const diff=Math.abs(minutes(p.time)-minutes(prev.time));
      issues.push(diff<=RULES.dupSeconds/60?'疑似重复'+p.direction:'连续'+p.direction);severity='suspect'
    }
    if(p.direction==='进'){if(pending)severity='suspect';pending=p}
    else if(p.direction==='出'){if(pending){pairs.push([pending,p]);pending=null}else severity='suspect'}
  }
  if(pending){issues.push('存在未闭合进入记录');severity='suspect'}
  const covers=(rows,start,end)=>rows.some(x=>minutes(x.start||'00:00')<=minutes(start)&&minutes(x.end||'24:00')>=minutes(end));
  const overlapEnough=(rows,start,end,need=180)=>rows.some(x=>intervalOverlap(minutes(x.start||'00:00'),minutes(x.end||'24:00'),minutes(start),minutes(end))>=need);
  const fullExcused=trips.length>0||covers(leaves,RULES.amStart,RULES.pmEnd)||covers(outings,RULES.amStart,RULES.pmEnd);
  const morningLeave=trips.length>0||overlapEnough(leaves,RULES.amStart,RULES.amEnd)||overlapEnough(outings,RULES.amStart,RULES.amEnd);
  const afternoonLeave=trips.length>0||overlapEnough(leaves,RULES.pmStart,RULES.pmEnd)||overlapEnough(outings,RULES.pmStart,RULES.pmEnd);
  let presence=pairs.reduce((sum,[x,y])=>sum+Math.max(0,minutes(y.time)-minutes(x.time)),0);
  const firstIn=punches.find(p=>p.direction==='进'),lastOut=[...punches].reverse().find(p=>p.direction==='出');
  if(!state.records.length&&!state.leaves.length&&!state.trips.length&&!state.outings?.length&&!state.overtimeEntries?.length){status='未导入';severity='rest';return pack()}
  if(!isWorkday(d)){
    if(punches.length||overtime.length){status='非工作日加班';severity='normal'}
    else{status=typ==='holiday'?'节假日':'休息';severity='rest'}
    return pack()
  }
  if(!punches.length){
    if(fullExcused){status=trips.length?'出差':leaves.length?'请假':'外出';severity='excused'}
    else{status='缺勤';severity='problem';issues.push('工作日无打卡')}
  }else{
    if(firstIn&&!morningLeave&&minutes(firstIn.time)>minutes(RULES.amStart)+RULES.grace){severity='problem';issues.push('迟到');status='迟到'}
    if(lastOut&&!afternoonLeave&&minutes(lastOut.time)<minutes(RULES.pmEnd)-RULES.grace){severity='problem';issues.push('早退');status=status==='迟到'?'迟到/早退':'早退'}
    if((!firstIn||!lastOut)&&severity!=='problem'){severity='suspect';status='记录不完整'}
    if(severity==='suspect'&&status==='正常')status='疑似打卡异常';
    if((leaves.length||trips.length||outings.length)&&severity==='normal')status=trips.length?'出差覆盖':leaves.length?'请假覆盖':'外出覆盖';
  }
  function pack(){return {employee:emp,date,day:d,dayType:typ,punches,pairs,leaves,trips,outings,overtime,severity,status,issues,firstIn:firstIn?.time||'',lastOut:lastOut?.time||'',presence,marker:''}}
  return pack();
}
function reanalyze(){state.analysis=new Map();for(const e of EMPLOYEES)for(let d=1;d<=monthDays();d++)state.analysis.set(`${e.id}|${d}`,analyzeDay(e,d))}
function statsFor(items){const total=items.length,problems=items.filter(x=>x.severity==='problem').length,suspects=items.filter(x=>x.severity==='suspect').length,normal=items.filter(x=>x.severity==='normal').length,rest=items.filter(x=>x.severity==='rest').length,excused=items.filter(x=>x.severity==='excused').length;return {total,problems,suspects,normal,rest,excused}}
function workAnalyses(){return [...state.analysis.values()].filter(x=>isWorkday(x.day))}
