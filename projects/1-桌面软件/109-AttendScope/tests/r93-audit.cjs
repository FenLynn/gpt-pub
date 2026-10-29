'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={checks:[],cases:{}};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const cases=await page.evaluate(()=>{
   const saved={records:state.records,leaves:state.leaves,trips:state.trips,outings:state.outings,overtimeEntries:state.overtimeEntries,monthStores:state.monthStores,
    manualOvertime:state.manualOvertime,overtimeReview:state.overtimeReview,rules:{...RULES},year:YEAR,month:MONTH,snapshotContext:state.snapshotContext,overtimeRuleContexts:state.overtimeRuleContexts,revisions:state.revisions,revisionSeq:state.revisionSeq,saved:state.saved},e=EMPLOYEES[0],result={},approx=(a,b)=>Math.abs(a-b)<1e-6;
   const seed=(events,registrations=[],rules={})=>{
    Object.assign(RULES,P109_DEFAULT_RULES,rules);state.records=events.map(([date,time,direction],i)=>({recordId:'r93:'+i,employeeId:e.id,name:e.name,datetime:date+' '+time,time,direction}));
    state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=registrations;state.manualOvertime=[];state.overtimeReview={};state.monthStores=new Map();YEAR=2026;MONTH=10;reanalyze();
   };
   const at=(clock,out='17:10:00')=>{
    const events=[['2026-10-08',clock,'进']];
    if(minutes(clock)<minutes('11:40')&&minutes(out)>=minutes('13:30'))events.push(['2026-10-08','11:40:00','出'],['2026-10-08','13:30:00','进']);
    events.push(['2026-10-08',out,'出']);return events;
   },value=day=>activeAutoOvertimeSegments(state.analysis.get(e.id+'|'+day)).reduce((n,s)=>n+s.minutes,0),
    pair=(a,b)=>at(a,b),sum=days=>days.reduce((n,d)=>n+value(d),0);
   try{
    result.defaults=RULES.overtimeAfterMinutes===20&&RULES.overtimeBeforeMinutes===5&&RULES.overtimeMinMinutes===5;
    for(const [clock,expected,key] of [['12:00:00',0,'noonBuffer'],['12:04:59',0,'noonBelowMinimum'],['12:05:00',5,'noonExactMinimum'],['12:10:00',10,'noonTen'],['17:30:00',0,'eveningBuffer'],['17:34:59',0,'eveningBelowMinimum'],['17:35:00',5,'eveningExactMinimum'],['17:36:00',6,'eveningSix']]){
     seed(pair('08:30:00',clock));result[key]=approx(value(8),expected);
    }
    for(const [clock,expected,key] of [['08:24:00',6,'earlySix'],['08:25:00',5,'earlyFive'],['08:25:01',0,'earlyBelowBySecond'],['08:26:00',0,'earlyFour']]){
     seed(pair(clock));result[key]=approx(value(8),expected);
    }
    seed(pair('13:24:00'));result.afternoonEarly=approx(value(8),6);
    seed([['2026-10-08','08:30:00','进'],['2026-10-08','17:10:00','出']]);result.continuousLunchCounted=approx(value(8),90);
    seed(pair('12:10:00','12:20:00'));result.separateLunch=approx(value(8),10);
    seed([['2026-10-08','18:18:00','进'],['2026-10-08','18:27:00','出'],['2026-10-08','18:35:00','进'],['2026-10-08','19:16:00','出']]);result.separateNineAndFortyOne=approx(value(8),50)&&state.analysis.get(e.id+'|8').autoOvertime.segments.length===2;
    seed([['2026-10-08','18:00:00','进'],['2026-10-08','18:04:00','出'],['2026-10-08','18:10:00','进'],['2026-10-08','18:14:00','出']]);result.doNotPoolIndependentShort=value(8)===0;
    seed(pair('08:26:00','12:04:00'),[],{overtimeBeforeMinutes:3});result.workSeparatesShortParts=value(8)===0;
    seed([['2026-10-08','23:50:00','进'],['2026-10-09','00:10:00','出']]);result.midnightTwenty=approx(value(8),10)&&approx(value(9),10)&&approx(sum([8,9]),20);
    let a=state.analysis.get(e.id+'|8'),b=state.analysis.get(e.id+'|9');result.sharedReview=a.autoOvertime.segments[0].id===b.autoOvertime.segments[0].id;
    const key=a.autoOvertime.segments[0].id;setAutoOvertimeDecision(key,false);result.excludeAcrossMidnight=sum([8,9])===0;setAutoOvertimeDecision(key,true);result.restoreAcrossMidnight=approx(sum([8,9]),20);
    seed([['2026-10-08','23:58:00','进'],['2026-10-09','00:03:00','出']]);result.midnightFive=approx(value(8),2)&&approx(value(9),3);
    seed([['2026-10-08','23:58:00','进'],['2026-10-09','00:02:59','出']]);result.midnightBelowBySecond=sum([8,9])===0;
    seed([['2026-10-08','23:55:00','进'],['2026-10-09','00:15:00','出']],[],{pmEnd:'23:50'});result.bufferContinuesAcrossMidnight=approx(value(8),0)&&approx(value(9),5);
    seed([['2026-10-09','23:55:00','进'],['2026-10-10','00:15:00','出']],[],{pmEnd:'23:50'});result.bufferDoesNotDisappearOnRestDay=approx(value(9),0)&&approx(value(10),5);
    seed([['2026-10-31','23:58:00','进'],['2026-11-01','00:03:00','出']]);const october=value(31),octoberRows=state.records.filter(r=>r.datetime.startsWith('2026-10'));
    state.records=state.records.filter(r=>r.datetime.startsWith('2026-11'));state.monthStores=new Map([['2026-10',{records:octoberRows,rules:{...P109_DEFAULT_RULES}}]]);YEAR=2026;MONTH=11;RULES.overtimeMinMinutes=10;reanalyze();
    result.crossMonthOriginPolicy=approx(october,2)&&approx(value(1),3);
    state.monthStores.get('2026-10').rules={...P109_DEFAULT_RULES,overtimeRuleVersion:1,overtimeMinMinutes:20};reanalyze();result.legacyOriginNotReinterpreted=value(1)===0;
    state.monthStores.get('2026-10').rules={...P109_DEFAULT_RULES};Object.assign(RULES,{overtimeRuleVersion:1,overtimeMinMinutes:20});reanalyze();result.modernOriginInHistoricalMonth=approx(value(1),3);Object.assign(RULES,P109_DEFAULT_RULES,{overtimeMinMinutes:10});
    const frozenRules=p109OvertimeSnapshotRules();state.snapshotContext=true;state.overtimeRuleContexts=frozenRules;state.monthStores.get('2026-10').rules.overtimeMinMinutes=30;reanalyze();
    result.frozenPolicyContext=approx(value(1),3)&&normalizeSavedMonth(workingPayload()).overtimeRuleContexts['2026-10'].overtimeMinMinutes===5;state.snapshotContext=false;state.overtimeRuleContexts={};
    seed(pair('08:20:00'),[],{overtimeBeforeMinutes:10});result.adjustBefore=approx(value(8),10);seed(pair('08:21:00'),[],{overtimeBeforeMinutes:10});result.adjustBeforeGate=value(8)===0;
    seed(pair('08:30:00','17:36:00'),[],{overtimeAfterMinutes:30});result.adjustAfter=value(8)===0;seed(pair('08:30:00','17:46:00'),[],{overtimeAfterMinutes:30});result.adjustAfterSix=approx(value(8),6);
    seed(pair('08:24:00'),[],{overtimeMinMinutes:7});result.adjustMinimum=value(8)===0;
    seed(pair('08:27:00','08:29:00'),[],{overtimeMinMinutes:1});result.beforeGateStillAppliesToShortIndependentVisit=value(8)===0;
    seed(pair('08:24:00','08:29:00'),[],{overtimeMinMinutes:1});result.qualifyingIndependentEarlyVisit=approx(value(8),5);
    seed(pair('08:30:00','17:15:00'),[],{overtimeAfterMinutes:0});result.zeroBuffer=approx(value(8),5);
    seed([['2026-10-11','11:58:00','进'],['2026-10-11','12:03:00','出']]);result.restDayNoBuffer=approx(value(11),5);
    seed(pair('08:30:00','17:36:00'),[{id:'registration',employeeId:e.id,date:'2026-10-08',start:'17:33',end:'17:36'}]);result.registrationDoesNotReapplyMinimum=approx(value(8),3)&&approx(asStatValue(asStatLedger(),'overtime','hours',[e],[8])*60,6);
    seed([['2026-10-08','18:00:00','进'],['2026-10-08','18:03:00','未标注'],['2026-10-08','18:20:00','出']]);result.unknownDoesNotInvent=value(8)===0;
    const legacy={schemaVersion:4,year:2026,month:10,employees:[e],records:[],rules:{...P109_DEFAULT_RULES,overtimeRuleVersion:undefined,overtimeAfterMinutes:undefined,overtimeBeforeMinutes:undefined,overtimeMinMinutes:30},calendarOverrides:p109CalendarMonthValues(2026,10,{},false)};
    const upgraded=normalizeSavedMonth(legacy),historical=normalizeSavedMonth(legacy,true);
    result.migration=upgraded.schemaVersion===P109_DATA_SCHEMA&&upgraded.rules.overtimeRuleVersion===2&&upgraded.rules.overtimeAfterMinutes===30&&upgraded.rules.overtimeBeforeMinutes===5&&upgraded.rules.overtimeMinMinutes===5&&!upgraded.saved;
    result.historicalKeepsPolicy=historical.rules.overtimeRuleVersion===1&&historical.rules.overtimeMinMinutes===30;
    seed(pair('08:30:00','17:36:00'),[],{overtimeRuleVersion:1,overtimeMinMinutes:20});result.legacyFormulaStillAvailable=approx(value(8),26);
    seed([['2026-10-08','08:30:00','进'],['2026-10-08','17:10:00','出']],[],{overtimeRuleVersion:1,overtimeMinMinutes:20});result.legacyContinuousLunchUnchanged=value(8)===0;
    result.invalidNewRules=normalizeSavedMonth({...legacy,rules:{...P109_DEFAULT_RULES,overtimeAfterMinutes:-1}})===null&&normalizeSavedMonth({...legacy,rules:{...P109_DEFAULT_RULES,overtimeMinMinutes:0}})===null;
    result.schemaProtection=normalizeSavedMonth({...legacy,schemaVersion:P109_DATA_SCHEMA+1})===null;
    return result;
   }finally{YEAR=saved.year;MONTH=saved.month;Object.assign(state,{records:saved.records,leaves:saved.leaves,trips:saved.trips,outings:saved.outings,overtimeEntries:saved.overtimeEntries,monthStores:saved.monthStores,manualOvertime:saved.manualOvertime,overtimeReview:saved.overtimeReview,snapshotContext:saved.snapshotContext,overtimeRuleContexts:saved.overtimeRuleContexts,revisions:saved.revisions,revisionSeq:saved.revisionSeq,saved:saved.saved});Object.assign(RULES,saved.rules);reanalyze();render()}
  });report.cases=cases;for(const [name,value] of Object.entries(cases))check(value,'buffered overtime: '+name);
  await page.evaluate(()=>{Object.assign(state,{workspaceMode:'person',selection:{type:'cell',employeeId:'E050',day:8},chartDay:8,chartTab:'timeline',timelineRange:null,filter:'main'});render()});await page.waitForSelector('#attendanceTimelineChart svg');
  const raw=await page.evaluate(()=>JSON.stringify(state.records));
  await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')).dispatchAction({type:'dataZoom',startValue:540,endValue:541}));
  await page.waitForFunction(()=>state.timelineRange.end-state.timelineRange.start<1.01);
  const zoom=await page.evaluate(()=>{const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')),events=r19PunchClusters(state.analysis.get('E050|8'),state.timelineRange,chart.getWidth());return {span:state.timelineRange.end-state.timelineRange.start,counts:events.map(e=>e.count),labels:[...document.querySelectorAll('#attendanceTimelineChart svg text')].map(n=>n.textContent).filter(t=>/^09:00:\d\d$/.test(t))}});
  check(zoom.span<1.01&&zoom.counts.length>=6&&zoom.counts.every(n=>n===1),'one-minute zoom separates each ten-second punch');
  check(new Set(zoom.labels).size>=3,'zoomed time axis exposes distinct second-level labels');report.zoom=zoom;
  await page.screenshot({path:path.join(out,'r93-seconds-zoom.png')});
  await page.locator('#attendanceTimelineChart').hover({position:{x:40,y:80}});await page.locator('#p109TimelineZoomIn').click();await page.locator('#attendanceTimelineChart').hover({position:{x:40,y:80}});await page.locator('#p109TimelineZoomIn').click();await page.locator('#attendanceTimelineChart').hover({position:{x:40,y:80}});await page.locator('#p109TimelineZoomIn').click();
  check(await page.evaluate(()=>Math.abs(state.timelineRange.end-state.timelineRange.start-1/6)<1e-5),'zoom button reaches ten-second span');
  await page.locator('#p109TimelineZoomOut').focus();await page.keyboard.press('Enter');check(await page.evaluate(()=>Math.abs(state.timelineRange.end-state.timelineRange.start-1/3)<1e-5),'keyboard zoom out doubles the span');
  await page.locator('#attendanceTimelineChart').hover({position:{x:40,y:80}});await page.locator('#p109TimelineReset').click();check(await page.evaluate(()=>state.timelineRange.start===480&&state.timelineRange.end===1200),'reset restores the ordinary initial range');
  check(await page.evaluate(before=>JSON.stringify(state.records)===before,raw),'zoom operations preserve all raw evidence');
  await page.locator('#settingsBtn').click();await page.locator('[data-settings-section="rules"]').click();
  check(await page.locator('#r93OvertimeAfter').inputValue()==='20'&&await page.locator('#r93OvertimeBefore').inputValue()==='5'&&await page.locator('#r14OvertimeMin').inputValue()==='5','settings exposes the three correct defaults');
  await page.locator('#r14OvertimeMin').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'r93-overtime-settings.png')});await page.locator('#r93OvertimeAfter').fill('10');await page.locator('#r93OvertimeBefore').fill('8');await page.locator('#r14OvertimeMin').fill('3');await page.locator('#settingsApply').click();
  check(await page.evaluate(()=>RULES.overtimeAfterMinutes===10&&RULES.overtimeBeforeMinutes===8&&RULES.overtimeMinMinutes===3&&!state.saved&&workingPayload().rules.overtimeRuleVersion===2),'applying settings persists all three monthly parameters and marks work dirty');
  await page.evaluate(()=>{Object.assign(RULES,P109_DEFAULT_RULES);reanalyze();Object.assign(state,{selection:{type:'cell',employeeId:'E043',day:19},chartDay:19,chartTab:'timeline',timelineRange:null});render()});await page.waitForSelector('#attendanceTimelineChart svg');
  await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')).dispatchAction({type:'dataZoom',startValue:1070,endValue:1170}));
  check(await page.evaluate(()=>{const a=state.analysis.get('E043|19'),bars=r14TrackData(a).bars.filter(b=>b.track==='overtime'&&b.origin==='auto');return bars.length===2&&bars.some(b=>b.value[0]===1098&&b.value[1]===1107)&&bars.some(b=>b.value[0]===1115&&b.value[1]===1156)}),'both nine-minute and forty-one-minute automatic bands appear in the real timeline');
  await page.locator('.toast').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));await page.screenshot({path:path.join(out,'r93-evening-counted.png')});
  await page.evaluate(()=>{Object.assign(state,{selection:{type:'cell',employeeId:'E049',day:9},chartDay:9,chartTab:'timeline',timelineRange:null});render()});await page.waitForSelector('#attendanceTimelineChart svg');await page.screenshot({path:path.join(out,'r93-midnight-counted.png')});
  check(!errors.length&&!remote.length,'no browser errors or runtime network requests');report.errors=errors;report.remote=remote;
  fs.writeFileSync(path.join(out,'r93-audit.json'),JSON.stringify(report,null,2));console.log('P109_R93_AUDIT_PASS '+JSON.stringify({checks:report.checks.length}));
 }catch(error){fs.writeFileSync(path.join(out,'r93-failure.json'),JSON.stringify({error:error.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r93-failure.png')});throw error}finally{await context.close()}
};
