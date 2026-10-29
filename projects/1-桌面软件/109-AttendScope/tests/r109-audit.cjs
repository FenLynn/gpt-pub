'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext(),page=await context.newPage(),errors=[],checks=[];
 const check=(value,name)=>{assert(value,name);checks.push(name)};page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const cases=await page.evaluate(async()=>{
   p109BlankWork();YEAR=2026;MONTH=10;const e={id:personIdentity('孤立卡回归'),name:'孤立卡回归'},date='2026-10-08';EMPLOYEES=[e];
   const result={},base=[['08:30','进'],['11:40','出'],['13:30','进'],['17:10','出']],
    am=[base[0],['11:20','出'],...base.slice(2)],pm=[...base.slice(0,3),['16:50','出']];
   const seed=(rows,rules={})=>{
    Object.assign(RULES,P109_DEFAULT_RULES,rules);Object.assign(state,{records:rows.map(([time,direction,d=date],i)=>({recordId:'r109:'+i,employeeId:e.id,name:e.name,datetime:d+' '+time,time,direction})),
     leaves:[],trips:[],outings:[],overtimeEntries:[],manualOvertime:[],manualTempOutings:[],manualStatuses:{},attendanceReview:{},overtimeReview:{},tempOutingReview:{},monthStores:new Map(),calendarOverrides:{[date]:'work'},snapshotContext:false,activeBranch:null,imports:[],revisions:[],revisionSeq:0,saved:false,isDemo:false,workspaceMode:'person',selection:{type:'cell',employeeId:e.id,day:8},chartDay:8,chartTab:'timeline'});reanalyze();
   },a=()=>state.analysis.get(e.id+'|8'),early=label=>a().attendanceFlags.filter(f=>f.kind==='early'&&f.label===label),stat=()=>asStatValue(asStatLedger(),'status','early',EMPLOYEES,[8]);
   for(const [part,rows,label] of [['am',am,'上午早退'],['pm',pm,'早退']]){
    seed(rows);const work=a().workMinutes,flag=early(label)[0].id;
    for(const direction of ['进','出','未标注']){
     seed([...rows,['22:00',direction]]);result[part+' '+direction]=early(label).length===1&&early(label)[0].id===flag&&stat()===1;
     result[part+' '+direction+' rawWork']=a().workMinutes===work&&a().issues.some(x=>x.includes('记录')||x.includes('出'));
    }
   }
   seed([...base,['22:00','进']]);result.normalDayNoFabricatedEarly=!a().attendanceFlags.some(f=>f.kind==='early')&&a().severity==='suspect';
   seed([...am,['11:30','进'],['11:40','出'],['22:00','进']]);result.returnBeforeEndProtected=!early('上午早退').length;
   seed([...base.slice(0,3),['17:08','出'],['17:12','进'],['17:13','出'],['22:00','进']]);result.shortReturnStillProtected=!early('早退').length;
   seed([...base.slice(0,3),['17:08','出'],['17:10:30','出'],['22:00','进']]);result.shortDuplicateStillProtected=!early('早退').length;
   seed([...base.slice(0,3),['17:08','出'],['17:30','进'],['17:31','出'],['22:00','进']]);result.longReturnStillEarly=early('早退').length===1;
   seed([base[0],['10:00','未标注'],['10:10','进'],['11:20','出'],...base.slice(2),['22:00','进']]);result.localMorningUncertaintyKept=!early('上午早退').length&&a().issues.includes('午休提前离岗（待核）');
   seed([...base.slice(0,3),['14:00','未标注'],['14:10','进'],['16:50','出'],['22:00','进']]);result.localPendingNotHiddenByLaterPending=!early('早退').length&&a().issues.includes('下午进出记录不完整（待核）');
   seed([...pm,['17:15','进'],['22:00','进']]);result.unclosedLateReturnStillEarly=early('早退').length===1;
   seed([base[0],['11:20','出']]);result.noAfternoonPairNoAfternoonEarly=!early('早退').length;
   seed([...am,['22:00','进']],{graceAmEnd:30});result.configuredEarlyGraceKept=!early('上午早退').length;
   seed([...pm,['22:00','进']]);state.trips=[{id:'trip',employeeId:e.id,startDate:date,endDate:date}];reanalyze();result.tripPriorityKept=!early('早退').length&&attendanceJudgment(a())==='normal';
   seed([...am,['22:00','出']]);state.outings=[{id:'report',employeeId:e.id,startDate:date,endDate:date,start:'11:20',end:'11:40'}];reanalyze();result.outingPriorityKept=!early('上午早退').length;
   seed([...pm,['22:00','进']]);state.leaves=[{id:'leave',employeeId:e.id,date,start:'16:50',end:'17:10'}];reanalyze();result.leavePriorityKept=!early('早退').length;
   const oldRules={...P109_DEFAULT_RULES};delete oldRules.earlyDepartureRuleVersion;
   const old={schemaVersion:10,year:2026,month:10,records:[],rules:oldRules,calendarOverrides:p109CalendarMonthValues(2026,10,{},false)},live=normalizeSavedMonth(old),frozen=normalizeSavedMonth(old,true);
   result.workingMigrates=live.rules.earlyDepartureRuleVersion===2&&!live.saved;
   result.frozenRuleKept=frozen.rules.earlyDepartureRuleVersion===1;
   seed([...am,['22:00','出']],frozen.rules);state.snapshotContext=true;reanalyze();result.frozenAmBehaviorKept=!early('上午早退').length;
   seed([...pm,['22:00','进']],frozen.rules);state.snapshotContext=true;reanalyze();result.frozenPmBehaviorKept=!early('早退').length;
   result.invalidRuleRejected=!p109ValidOvertimeRules({...P109_DEFAULT_RULES,earlyDepartureRuleVersion:3});
   seed([...pm,['22:00','进']]);const original=JSON.stringify(state.records),flagId=early('早退')[0].id;
   p109SetAttendanceDecision(flagId,false);result.excludeEarly=stat()===0&&early('早退')[0].accepted===false;
   p109SetAttendanceDecision(flagId,true);result.restoreEarly=stat()===1;
   setManualStatusForCurrent('normal');result.normalWaiverKept=stat()===0&&early('早退').length===1;
   setManualStatusForCurrent(null);result.restoreDayKept=stat()===1;
   state.projectDir=p109MemoryRoot('R109核查');const memory=await p109PortableFromSession(),built=await p109ZipBuild(await p109PortableCollect(memory));state.saved=true;
   await p109OpenPortableFile(new File([built.zip],'r109.zip',{type:'application/zip'}));
   result.zipRoundtrip=stat()===1&&early('早退')[0].id===flagId&&RULES.earlyDepartureRuleVersion===2&&JSON.stringify(state.records)===original;
   result.currentSchema=workingPayload().schemaVersion===P109_DATA_SCHEMA;
   return result;
  });fs.writeFileSync(path.join(out,'r109-cases.json'),JSON.stringify(cases,null,2));for(const [name,value] of Object.entries(cases))check(value,name);
  check(!errors.length,'no script errors');fs.writeFileSync(path.join(out,'r109-audit.json'),JSON.stringify({checks,cases,errors},null,2));console.log('P109_R109_AUDIT_PASS '+JSON.stringify({checks:checks.length}));
 }finally{await context.close()}
};
