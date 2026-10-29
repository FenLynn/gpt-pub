'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),checks=[],errors=[],remote=[];
 const check=(ok,label)=>{assert(ok,label);checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const cases=await page.evaluate(async()=>{
   p109BlankWork();YEAR=2026;MONTH=10;const employeeId=personIdentity('边界核查');EMPLOYEES=[{id:employeeId,name:'边界核查'}];state.groups={[employeeId]:'核查组'};
   const result={},date='2026-10-08',standard=[['08:30:00','进'],['11:40:00','出'],['13:30:00','进'],['17:10:00','出']],approx=(a,b)=>Math.abs(a-b)<1e-6;
   const seed=(rows,rules={})=>{
    YEAR=2026;MONTH=10;Object.assign(RULES,P109_DEFAULT_RULES,rules);
    Object.assign(state,{records:rows.map(([d,t,direction],i)=>({recordId:'r106:'+i,employeeId,name:'边界核查',datetime:d+' '+t,time:t,direction})),
     leaves:[],trips:[],outings:[],overtimeEntries:[],manualOvertime:[],overtimeReview:{},attendanceReview:{},manualTempOutings:[],tempOutingReview:{},
     monthStores:new Map(),calendarOverrides:{},snapshotContext:false,activeBranch:null,imports:[],revisions:[],revisionSeq:0,saved:false,isDemo:false});reanalyze();
   },daily=(rows,rules={})=>seed(rows.map(([t,d])=>[date,t,d]),rules),at=d=>state.analysis.get(employeeId+'|'+d),value=d=>analysisUnionMinutes(activeAutoOvertimeSegments(at(d)).map(s=>[s.from,s.to])),early=d=>at(d).attendanceFlags.filter(f=>f.kind==='early'),
    fullWithAm=rows=>[standard[0],...rows,...standard.slice(2)],fullWithPm=rows=>[...standard.slice(0,3),...rows];
   seed([['2026-10-09','02:00:00','出']]);result.midnightTwoHours=value(9)===120&&at(9).pairs.length===0&&at(9).punches.length===1&&at(9).autoOvertime.segments.every(s=>s.inference==='midnight');
   const midnightId=at(9).autoOvertime.segments[0].id;setAutoOvertimeDecision(midnightId,false);result.midnightExclude=value(9)===0&&at(9).autoOvertime.segments.length===1;setAutoOvertimeDecision(midnightId,true);result.midnightRestore=value(9)===120;
   seed([['2026-10-09','00:04:59','出']]);result.midnightMinimumBelow=value(9)===0;
   seed([['2026-10-09','00:05:00','出']]);result.midnightMinimumExact=value(9)===5;
   seed([['2026-10-09','06:00:00','出']]);result.cutoffExact=value(9)===360;
   seed([['2026-10-09','06:00:01','出']]);result.cutoffPast=value(9)===0;
   seed([['2026-10-09','02:00:00','出']],{midnightInference:false});result.disabled=value(9)===0;
   seed([['2026-10-09','02:00:00','出']],{midnightCutoffMinutes:60});result.cutoffAdjustable=value(9)===0;
   seed([['2026-10-09','17:10:00','出']]);result.afternoonOrphanNotMidnight=value(9)===0;
   seed([['2026-10-09','01:00:00','未标注'],['2026-10-09','02:00:00','出']]);result.unknownDoesNotInventMidnight=value(9)===0;
   seed([['2026-10-09','02:00:00','出'],['2026-10-09','03:00:00','出']]);result.multipleExitsUseFirst=value(9)===120;
   seed([['2026-10-08','23:59:00','出'],['2026-10-09','00:06:00','出']]);result.shortDuplicateAcrossMidnightNoInference=value(9)===0;
   seed([['2026-10-08','23:50:00','进'],['2026-10-09','00:10:00','出'],['2026-10-09','00:11:00','出']]);result.duplicateExitKeepsCompletedSession=value(8)===10&&value(9)===10&&at(9).autoOvertime.segments.every(s=>!s.inference);
   seed([['2026-10-09','02:00:00','出'],['2026-10-09','19:00:00','进'],['2026-10-09','20:00:00','出']]);result.orphanAndEveningIndependent=value(9)===180;
   seed([['2026-10-09','19:00:00','进'],['2026-10-09','20:00:00','出'],['2026-10-09','21:00:00','进']]);result.unclosedDoesNotEraseComplete=value(9)===60;
   seed([['2026-10-09','18:00:00','进'],['2026-10-09','18:10:00','未标注'],['2026-10-09','18:20:00','出'],['2026-10-09','19:00:00','进'],['2026-10-09','20:00:00','出']]);result.unknownOnlyBreaksItsSession=value(9)===60;
   seed([['2026-10-09','02:00:00','出']]);state.overtimeEntries=[{id:'r106-reg',employeeId,date:'2026-10-09',start:'01:00',end:'03:00'}];state.manualOvertime=[{id:'manual-overtime:r106',employeeId,date:'2026-10-09',start:'02:30',end:'03:30'}];reanalyze();result.midnightAllSourcesUnion=approx(asStatValue(asStatLedger(),'overtime','hours',EMPLOYEES,[9])*60,210);
   seed([['2026-10-01','00:10:00','出']]);state.monthStores.set('2026-09',{records:[{recordId:'r106-september',employeeId,datetime:'2026-09-30 23:50:00',time:'23:50:00',direction:'进'}],rules:{...RULES}});reanalyze();result.previousMonthPreferred=value(1)===10&&at(1).autoOvertime.segments.every(s=>!s.inference);
   seed([['2026-10-08','08:30:00','进'],['2026-10-09','20:00:00','出']]);const longId=at(8).autoOvertime.segments[0].id;
   result.longSessionPending=value(8)===0&&value(9)===0&&at(8).autoOvertime.minutes===0&&at(8).autoOvertime.segments.every(s=>s.requiresConfirmation)&&at(8).issues.some(s=>s.includes('连续在岗超过'));
   const original=JSON.stringify(state.records);setAutoOvertimeDecision(longId,true);result.longSessionConfirmBothDays=value(8)===480&&value(9)===750&&state.overtimeReview[longId]===true;
   const saved=normalizeSavedMonth(workingPayload());result.confirmPersisted=saved.overtimeReview[longId]===true&&saved.rules.maxVisitHours===16;
   state.projectDir=p109MemoryRoot('R106复核');const root=await p109PortableFromSession(),files=await p109PortableCollect(root),built=await p109ZipBuild(files);state.saved=true;
   await p109OpenPortableFile(new File([built.zip],'r106-roundtrip.zip',{type:'application/zip'}));
   result.zipRoundtripConfirmation=value(8)===480&&value(9)===750&&state.overtimeReview[longId]===true&&JSON.stringify(state.records)===original;
   setAutoOvertimeDecision(longId,false);result.longSessionExcludedBothDays=value(8)===0&&value(9)===0&&at(8).autoOvertime.segments.length>0;
   seed([['2026-10-08','18:00:00','进'],['2026-10-09','02:00:00','出']],{maxVisitHours:6});result.maxVisitAdjustable=value(8)===0&&value(9)===0;
   seed([['2026-10-08','18:00:00','进'],['2026-10-09','02:00:00','出']],{maxVisitHours:8});result.exactMaxVisitCounts=value(8)===360&&value(9)===120;
   const legacyRules={...P109_DEFAULT_RULES};for(const key of ['punchRuleVersion','midnightInference','midnightCutoffMinutes','maxVisitHours'])delete legacyRules[key];
   const legacy={schemaVersion:7,year:2026,month:10,records:[],rules:legacyRules,calendarOverrides:p109CalendarMonthValues(2026,10,{},false)};
   const live=normalizeSavedMonth(legacy),frozen=normalizeSavedMonth(legacy,true);result.migration=live.rules.punchRuleVersion===2&&!live.saved&&frozen.rules.punchRuleVersion===1;
   seed([['2026-10-09','02:00:00','出']],frozen.rules);state.snapshotContext=true;reanalyze();result.frozenNoInference=value(9)===0;
   seed([['2026-10-09','02:00:00','出'],['2026-10-09','19:00:00','进'],['2026-10-09','20:00:00','出']],frozen.rules);state.snapshotContext=true;reanalyze();result.frozenWholeDayPolicyPreserved=value(9)===0;
   daily(fullWithAm([['11:39:00','出'],['11:39:10','进'],['11:39:20','出'],['11:39:30','进'],['11:40:30','出']]));result.denseMorningNoEarly=!early(8).length;
   daily(fullWithPm([['17:09:00','出'],['17:09:10','进'],['17:09:20','出'],['17:09:30','进'],['17:10:30','出']]));result.denseAfternoonNoEarly=!early(8).length;
   daily(fullWithPm([['17:08:00','出'],['17:10:30','出']]));result.repeatedExitAcrossEndProtected=!early(8).length&&at(8).punches.length===5;
   daily(fullWithAm([['11:38:00','出'],['11:40:30','出']]));result.repeatedMorningExitProtected=!early(8).length;
   daily(fullWithPm([['17:08:00','出'],['17:20:00','出']]));result.exactBoundaryWindowProtected=!early(8).length;
   daily(fullWithPm([['17:08:00','出'],['17:20:01','出']]));result.pastBoundaryWindowEarly=early(8).some(f=>f.time==='17:08:00');
   daily(fullWithPm([['17:08:00','出'],['17:20:00','出']]),{tempOutingMinutes:5,tempOutingGraceMinutes:1});result.boundaryWindowAdjustable=early(8).some(f=>f.time==='17:08:00');
   daily(fullWithPm([['17:08:00','出'],['17:09:00','未标注'],['17:10:30','出']]));result.unknownDoesNotBridgeBoundary=early(8).some(f=>f.time==='17:08:00');
   daily(fullWithPm([['16:40:00','出'],['16:50:00','出'],['17:00:00','出'],['17:10:00','出']]));result.noChainedExtension=early(8).some(f=>f.time==='16:40:00');
   daily(fullWithPm([['17:08:00','出']]));result.singleTrueEarlyPreserved=early(8).some(f=>f.time==='17:08:00');
   daily(fullWithPm([['17:08:00','出'],['17:12:00','进'],['17:13:00','出']]));result.shortReturnProtected=!early(8).length;
   daily(fullWithPm([['17:08:00','出'],['17:30:00','进'],['17:31:00','出']]));result.longReturnStillEarly=early(8).some(f=>f.time==='17:08:00');
   daily(fullWithPm([['14:00:00','出'],['14:25:00','进'],['17:10:00','出']]));result.internalOutingNotEarly=!early(8).length&&at(8).temporaryOutings.some(r=>r.status==='red');
   daily(fullWithPm([['17:08:00','出'],['17:10:30','出']]),frozen.rules);state.snapshotContext=true;reanalyze();result.frozenBoundaryPolicyPreserved=early(8).some(f=>f.time==='17:08:00');
   result.invalidRulesRejected=[{midnightCutoffMinutes:-1},{midnightCutoffMinutes:721},{midnightInference:'true'},{maxVisitHours:0},{maxVisitHours:37},{punchRuleVersion:3}].every(change=>!p109ValidOvertimeRules({...P109_DEFAULT_RULES,...change}));
   daily(standard);Object.assign(state,{workspaceMode:'person',selection:{type:'cell',employeeId,day:8},chartDay:8,chartTab:'timeline',timelineRange:null});render();
   return result;
  });for(const [name,ok] of Object.entries(cases))check(ok,'R106 '+name);
  await page.locator('#settingsBtn').click();await page.locator('[data-settings-section="rules"]').click();
  check(await page.locator('#r106MidnightInference').isChecked()&&await page.locator('#r106MidnightCutoff').inputValue()==='06:00'&&await page.locator('#r106MaxVisit').inputValue()==='16','actual settings show safe editable defaults');
  await page.locator('#r106MidnightCutoff').fill('05:30');await page.locator('#r106MaxVisit').fill('18');await page.locator('#r106MidnightInference').uncheck();await page.locator('#settingsApply').click();
  check(await page.evaluate(()=>RULES.midnightCutoffMinutes===330&&RULES.maxVisitHours===18&&RULES.midnightInference===false&&RULES.punchRuleVersion===2&&!state.saved),'actual settings apply and persist all new parameters');
  await page.evaluate(()=>{Object.assign(RULES,P109_DEFAULT_RULES);state.timelineRange=null;state.records=[{recordId:'r106:ui',employeeId:EMPLOYEES[0].id,name:'边界核查',datetime:'2026-10-08 02:00:00',time:'02:00:00',direction:'出'}];reanalyze();render()});
  await page.waitForSelector('#attendanceTimelineChart svg');
  await page.waitForFunction(()=>state.timelineRange?.start===0&&echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'))?.getOption().dataZoom[0].startValue===0);
  check(true,'rapid render after applying settings retains the latest midnight range instead of a stale chart');
  check(await page.evaluate(()=>r14TrackData(state.analysis.get(EMPLOYEES[0].id+'|8')).bars.some(b=>b.track==='overtime'&&b.title.includes('午夜推算')&&b.reason.includes('00:00'))),'timeline explicitly identifies midnight inference without synthetic raw cards');
  await page.screenshot({path:path.join(out,'r106-midnight.png')});
  await page.evaluate(()=>{
   const id=EMPLOYEES[0].id;state.timelineRange=null;state.overtimeReview={};state.monthStores=new Map();
   state.records=[['2026-10-08','18:00:00','进'],['2026-10-09','12:00:00','出']].map(([d,t,direction],i)=>({recordId:'r106:long-ui:'+i,employeeId:id,name:'边界核查',datetime:d+' '+t,time:t,direction}));reanalyze();render();
  });await page.waitForSelector('.overtime-review-actions');
  check(await page.evaluate(()=>{const a=state.analysis.get(EMPLOYEES[0].id+'|8');return a.autoOvertime.minutes===0&&r14TrackData(a).bars.some(b=>b.title.includes('超长待确认')&&!b.accepted)}),'pending long session has visible excluded evidence and zero counted minutes');
  await page.locator('.overtime-review-actions button[aria-label^="纳入 "]').first().focus();await page.keyboard.press('Enter');
  check(await page.evaluate(()=>{const id=EMPLOYEES[0].id;return state.analysis.get(id+'|8').autoOvertime.minutes===360&&state.analysis.get(id+'|9').autoOvertime.minutes===510&&Object.values(state.overtimeReview).includes(true)}),'real keyboard confirmation includes both civil-day portions');
  await page.locator('.overtime-review-actions button[aria-label^="排除 "]').first().focus();await page.keyboard.press('Enter');
  check(await page.evaluate(()=>{const id=EMPLOYEES[0].id;return !activeAutoOvertimeSegments(state.analysis.get(id+'|8')).length&&!activeAutoOvertimeSegments(state.analysis.get(id+'|9')).length}),'real exclusion restores the long-session evidence without counted minutes');
  await page.screenshot({path:path.join(out,'r106-long-session.png')});
  check(!errors.length&&!remote.length,'no script errors or runtime network requests');
  fs.writeFileSync(path.join(out,'r106-audit.json'),JSON.stringify({checks,cases,errors,remote},null,2));console.log('P109_R106_AUDIT_PASS '+JSON.stringify({checks:checks.length}));
 }catch(e){fs.writeFileSync(path.join(out,'r106-failure.json'),JSON.stringify({error:e.stack,checks,errors},null,2));await page.screenshot({path:path.join(out,'r106-failure.png')});throw e}finally{await context.close()}
};
