'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext(),page=await context.newPage(),errors=[],checks=[],check=(ok,label)=>{assert(ok,label);checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const result=await page.evaluate(async()=>{
   p109BlankWork();YEAR=2026;MONTH=10;const employee={id:personIdentity('请假返岗核查'),name:'请假返岗核查'},date='2026-10-08';EMPLOYEES=[employee];
   const cases={},am=clock=>[[clock,'进'],['11:40','出'],['13:30','进'],['17:10','出']],pm=clock=>[['08:30','进'],['11:40','出'],[clock,'进'],['17:10','出']];
   const seed=(events,leaves,rules={})=>{
    Object.assign(RULES,P109_DEFAULT_RULES,rules);Object.assign(state,{records:events.map(([time,direction],i)=>({recordId:'r107:'+i,employeeId:employee.id,name:employee.name,datetime:date+' '+time,time,direction})),
     leaves:leaves.map(([start,end],i)=>({id:'r107-leave:'+i,employeeId:employee.id,date,start,end})),trips:[],outings:[],overtimeEntries:[],manualOvertime:[],manualTempOutings:[],manualStatuses:{},overtimeReview:{},attendanceReview:{},tempOutingReview:{},monthStores:new Map(),calendarOverrides:{[date]:'work'},snapshotContext:false,activeBranch:null,imports:[],revisions:[],revisionSeq:0,saved:false,isDemo:false});reanalyze();return state.analysis.get(employee.id+'|8');
   },good=(a,duration,status)=>a.attendanceFlags.every(f=>f.kind!=='late')&&a.temporaryOutings.length===1&&Math.abs(a.temporaryOutings[0].minutes-duration)<1e-6&&a.temporaryOutings[0].status===status;
   for(const [clock,value,color] of [['09:10',10,'green'],['09:12',12,'green'],['09:12:01',12+1/60,'red'],['09:25',25,'red']])cases['morning '+clock]=good(seed(am(clock),[['08:30','09:00']]),value,color);
   for(const [clock,value,color] of [['14:10',10,'green'],['14:12',12,'green'],['14:12:01',12+1/60,'red'],['14:30',30,'red']])cases['afternoon '+clock]=good(seed(pm(clock),[['13:30','14:00']]),value,color);
   let a=seed(am('09:00'),[['08:30','09:00']]);cases.exactReturn=!a.attendanceFlags.length&&!a.temporaryOutings.length;
   a=seed(am('08:50'),[['08:30','09:00']]);cases.earlyReturn=!a.attendanceFlags.length&&!a.temporaryOutings.length;
   cases.customLow=good(seed(am('09:10'),[['08:30','09:00']],{tempOutingMinutes:8,tempOutingGraceMinutes:1}),10,'red');
   cases.customHigh=good(seed(am('09:24'),[['08:30','09:00']],{tempOutingMinutes:20,tempOutingGraceMinutes:5}),24,'green');
   cases.overlappingLeave=good(seed(am('09:10'),[['08:30','08:50'],['08:45','09:00']]),10,'green');
   a=seed(am('09:10'),[]);cases.ordinaryMorningLate=a.attendanceFlags.some(f=>f.label==='迟到');
   a=seed(pm('14:10'),[]);cases.ordinaryAfternoonLate=a.attendanceFlags.some(f=>f.label==='下午迟到');
   a=seed(am('09:40'),[['09:00','09:30']]);cases.unexcusedBeforeLeaveStillLate=a.attendanceFlags.some(f=>f.label==='迟到');
   a=seed(am('09:10'),[['10:00','11:00']]);cases.unrelatedLeaveStillLate=a.attendanceFlags.some(f=>f.label==='迟到');
   const oldRules={...P109_DEFAULT_RULES};delete oldRules.leaveReturnRuleVersion;
   const old={schemaVersion:8,year:2026,month:10,records:[],rules:oldRules,calendarOverrides:p109CalendarMonthValues(2026,10,{},false)},live=normalizeSavedMonth(old),frozen=normalizeSavedMonth(old,true);
   cases.migration=live.rules.leaveReturnRuleVersion===2&&!live.saved&&frozen.rules.leaveReturnRuleVersion===1;
   a=seed(am('09:10'),[['08:30','09:00']],frozen.rules);state.snapshotContext=true;reanalyze();a=state.analysis.get(employee.id+'|8');cases.frozenKeepsOriginal=a.attendanceFlags.some(f=>f.kind==='late');
   cases.invalidRuleRejected=!p109ValidOvertimeRules({...P109_DEFAULT_RULES,leaveReturnRuleVersion:3});
   a=seed(am('09:10'),[['08:30','09:00']]);cases.statisticsNoLate=asStatValue(asStatLedger(),'status','late',EMPLOYEES,[8])===0;
   const id=a.temporaryOutings[0].id,raw=JSON.stringify(state.records);p109SetTempDecision(id,'exclude');cases.excludeOnlyTemporary=activeTemporaryOutings(state.analysis.get(employee.id+'|8')).length===0&&activeAttendanceFlags(state.analysis.get(employee.id+'|8')).length===0;
   p109SetTempDecision(id,'green');cases.restoreTemporary=good(state.analysis.get(employee.id+'|8'),10,'green')&&JSON.stringify(state.records)===raw;
   state.projectDir=p109MemoryRoot('R107核查');const root=await p109PortableFromSession(),built=await p109ZipBuild(await p109PortableCollect(root));state.saved=true;
   await p109OpenPortableFile(new File([built.zip],'r107.zip',{type:'application/zip'}));
   cases.roundtrip=good(state.analysis.get(employee.id+'|8'),10,'green')&&RULES.leaveReturnRuleVersion===2&&JSON.stringify(state.records)===raw;
   return cases;
  });for(const [name,ok] of Object.entries(result))check(ok,name);
  check(!errors.length,'no script errors');fs.writeFileSync(path.join(out,'r107-audit.json'),JSON.stringify({checks,result,errors},null,2));console.log('P109_R107_AUDIT_PASS '+JSON.stringify({checks:checks.length}));
 }finally{await context.close()}
};
