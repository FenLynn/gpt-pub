'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[],checks=[];
 const check=(ok,label)=>{assert(ok,label);checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const result=await page.evaluate(async()=>{
   p109BlankWork();YEAR=2026;MONTH=10;
   const person={id:personIdentity('最终统计核查'),name:'最终统计核查'},date='2026-10-08';EMPLOYEES=[person];
   const cases={},near=(a,b)=>Math.abs(a-b)<1e-7,events=[['08:40','进'],['10:00','出'],['10:20','进'],['11:40','出'],['13:30','进'],['16:50','出'],['19:00','进'],['20:00','出']];
   const seed=(reports=[],registered=[])=>{
    Object.assign(RULES,P109_DEFAULT_RULES,{outingStatisticsRuleVersion:1});Object.assign(state,{records:events.map(([time,direction],i)=>({recordId:'r108:'+i,employeeId:person.id,name:person.name,datetime:date+' '+time,time,direction})),
     leaves:[],trips:[],outings:reports.map(([start,end],i)=>({id:'report:'+i,employeeId:person.id,startDate:date,endDate:date,start,end})),
     overtimeEntries:registered.map(([start,end],i)=>({id:'registered:'+i,employeeId:person.id,date,start,end})),manualOvertime:[],manualTempOutings:[],manualStatuses:{},attendanceReview:{},overtimeReview:{},tempOutingReview:{},monthStores:new Map(),calendarOverrides:{[date]:'work'},snapshotContext:false,activeBranch:null,
     revisions:[],revisionSeq:0,imports:[],saved:false,isDemo:false,workspaceMode:'person',selection:{type:'cell',employeeId:person.id,day:8},chartDay:8,chartTab:'timeline',timelineRange:null});reanalyze();
   },a=()=>state.analysis.get(person.id+'|8'),v=(family,metric)=>asStatValue(asStatLedger(),family,metric,EMPLOYEES,[8]),csv=()=>traditionalRows().find(r=>r.日期===date);
   seed();cases.initialLateEarly=v('status','late')===1&&v('status','early')===1;
   const raw=JSON.stringify(state.records),flags=JSON.stringify(a().attendanceFlags),originalMinutes=behaviorMinutes(a(),'outing');
   setManualStatusForCurrent('normal');
   cases.manualNormalVerdict=attendanceJudgment(a())==='normal'&&v('status','normal')===1&&v('status','anomaly')===0;
   cases.manualNormalExemptsFlags=v('status','late')===0&&v('status','early')===0&&!attendanceHasLateEarly(a());
   cases.manualNormalKeepsRed=v('tempOuting','redCount')===2&&v('tempOuting','count')===2&&near(behaviorMinutes(a(),'outing'),originalMinutes);
   cases.manualNormalKeepsOvertime=near(v('overtime','hours')*60,60);
   cases.rawDiagnosticsKept=JSON.stringify(a().attendanceFlags)===flags&&activeAttendanceFlags(a()).length===2&&JSON.stringify(state.records)===raw;
   cases.csvFinalCounts=csv().最终判定==='正常'&&csv().迟到纳入次数===0&&csv().早退纳入次数===0&&csv().人工正常豁免次数===2&&csv().临时外出红色次数===2;
   cases.personalSummaryExempt=!personalLateEarlySummaryHtml(person.id).includes('data-person-anomaly-day');
   cases.matrixFilterExempt=matrixCategory(a(),'lateEarly')!=='lateEarly'&&matrixCategory(a(),'tempOuting')==='tempOutingRed';
   cases.normalDoesNotChangeRaw=JSON.stringify(state.records)===raw;
   p109SetTempDecision(a().temporaryOutings.find(r=>r.from===600).id,'green');
   cases.greenSeparately=v('tempOuting','redCount')===1&&v('tempOuting','greenCount')===1&&v('tempOuting','count')===2;
   p109SetTempDecision(a().temporaryOutings.find(r=>r.from===600).id,'exclude');
   cases.excludeSeparately=v('tempOuting','count')===1&&v('tempOuting','redCount')===1&&near(v('outing','hours')*60,20);
   setManualStatusForCurrent(null);cases.restoreDayRestoresFlags=v('status','late')===1&&v('status','early')===1&&v('tempOuting','count')===1;
   seed();const late=a().attendanceFlags.find(f=>f.kind==='late');p109SetAttendanceDecision(late.id,false);
   cases.singleFlagExclusion=v('status','late')===0&&v('status','early')===1&&csv().迟到早退排除次数===1;
   p109SetAttendanceDecision(late.id,true);cases.singleFlagRestores=v('status','late')===1;
   seed([['09:55','10:25'],['09:58','10:22']]);
   const actual=a().temporaryOutings.find(r=>r.from===600);
   cases.reportDeterminesGreen=actual.status==='green';
   cases.reportNotAdded=near(v('outing','hours')*60,40)&&v('outing','count')===2;
   cases.sameIntervalsAcrossViews=near(v('outing','hours'),v('tempOuting','hours'))&&v('outing','count')===v('tempOuting','count');
   cases.personalUsesActual=timelineBehaviorRows(a(),'outing').length===2&&timelineBehaviorSummaryRow(a(),'outing').includes('0h 40m');
   p109SetTempDecision(actual.id,'exclude');
   cases.reportCannotResurrectExcluded=near(v('outing','hours')*60,20)&&v('outing','count')===1&&timelineBehaviorRows(a(),'outing').length===1;
   p109SetTempDecision(actual.id,null);cases.restoreActualOnly=near(v('outing','hours')*60,40)&&v('tempOuting','greenCount')===1;
   seed([['09:55','10:25']]);state.records=state.records.filter(r=>!['10:00','10:20'].includes(r.time));state.records.find(r=>r.time==='16:50').datetime=date+' 17:10';state.records.find(r=>r.time==='16:50').time='17:10';reanalyze();
   cases.reportOnlyHasNoActual=v('outing','count')===0&&v('outing','hours')===0&&!attendanceBehaviors(a()).includes('outing');
   seed([], [['19:15','19:45']]);
   cases.overtimeUnion=near(v('overtime','hours')*60,60);
   setAutoOvertimeDecision(a().autoOvertime.segments[0].id,false);
   cases.overtimeExclusionKeepsExplicitRecord=near(v('overtime','hours')*60,30)&&v('overtime','candidateHours')===0;
   seed();setAutoOvertimeDecision(a().autoOvertime.segments[0].id,false);
   cases.overtimeExclusionClearsEffective=near(v('overtime','hours'),0)&&csv().加班自动纳入分钟===0&&csv().加班自动排除分钟===60;
   seed();state.manualTempOutings=[{id:'manual:r108',employeeId:person.id,date,start:'10:10',end:'10:30'}];reanalyze();
   cases.overlapActualUnion=near(v('outing','hours')*60,50)&&near(behaviorMinutes(a(),'tempOuting'),50)&&near(p109TempSummary([a()]).minutes,50);
   const oldRules={...P109_DEFAULT_RULES};delete oldRules.statisticsRuleVersion;
   const old={schemaVersion:9,year:2026,month:10,records:[],rules:oldRules,calendarOverrides:p109CalendarMonthValues(2026,10,{},false)},live=normalizeSavedMonth(old),frozen=normalizeSavedMonth(old,true);
   cases.workingMigrates=live.rules.statisticsRuleVersion===2&&!live.saved;
   cases.frozenKeepsLegacy=frozen.rules.statisticsRuleVersion===1;
   cases.invalidRuleRejected=!p109ValidOvertimeRules({...P109_DEFAULT_RULES,statisticsRuleVersion:3});
   seed([['09:55','10:25']]);RULES.statisticsRuleVersion=1;state.manualStatuses[person.id+'|8']='normal';
   cases.legacyCountsUnchanged=near(v('outing','hours')*60,30)&&v('status','late')===1&&v('status','early')===1&&asStatFamily('outing')[1].includes('历史');
   seed([['09:55','10:25']]);setManualStatusForCurrent('normal');p109SetTempDecision(a().temporaryOutings.find(r=>r.from===600).id,'exclude');setAutoOvertimeDecision(a().autoOvertime.segments[0].id,false);
   state.projectDir=p109MemoryRoot('R108核查');const memory=await p109PortableFromSession(),built=await p109ZipBuild(await p109PortableCollect(memory));state.saved=true;
   await p109OpenPortableFile(new File([built.zip],'r108.zip',{type:'application/zip'}));
   cases.roundtripVerdict=v('status','late')===0&&v('status','early')===0&&attendanceJudgment(a())==='normal';
   cases.roundtripRed=v('tempOuting','redCount')===1&&v('outing','count')===1;
   cases.roundtripExclusions=near(v('overtime','hours'),0)&&near(v('outing','hours')*60,20)&&RULES.statisticsRuleVersion===2;
   cases.roundtripRaw=JSON.stringify(state.records)===raw&&state.outings.length===1;
   state.selection={type:'cell',employeeId:person.id,day:8};state.workspaceMode='person';state.chartDay=8;state.chartTab='timeline';render();
   return cases;
  });fs.writeFileSync(path.join(out,'r108-cases.json'),JSON.stringify(result,null,2));for(const [label,ok] of Object.entries(result))check(ok,label);
  await page.waitForFunction(()=>document.querySelectorAll('.r72-attendance-tag').length===2);
  check(await page.locator('.r72-attendance-tag.is-excluded').count()===2,'manual-normal flag drafts appear gray');
  check(await page.locator('.r72-attendance-tag').evaluateAll(tags=>tags.every(t=>t.dataset.r73Tip.includes('人工正常'))),'flag tooltip explains day-level waiver');
  await page.screenshot({path:path.join(out,'r108-final-statistics.png')});
  check(!errors.length,'no script errors');fs.writeFileSync(path.join(out,'r108-audit.json'),JSON.stringify({checks,result,errors},null,2));
  console.log('P109_R108_AUDIT_PASS '+JSON.stringify({checks:checks.length}));
 }finally{await context.close()}
};
