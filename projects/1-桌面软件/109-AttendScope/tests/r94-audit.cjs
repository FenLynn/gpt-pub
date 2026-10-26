'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={checks:[],cases:{},geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const demo=await page.evaluate(()=>{const a=(id,day)=>state.analysis.get(id+'|'+day);return {
   green:a('E044',19).temporaryOutings.length===2&&a('E044',19).temporaryOutings.every(r=>r.status==='green'&&r.minutes===10),
   red:a('E044',20).temporaryOutings.length===2&&a('E044',20).temporaryOutings.every(r=>r.status==='red'&&r.minutes===15),
   inside:!a('E044',21).temporaryOutings.length,tripNight:activeAutoOvertimeSegments(a('E043',22)).reduce((n,r)=>n+r.minutes,0)===180}});
  for(const [label,ok] of Object.entries(demo))check(ok,'actual demo case: '+label);
  const cases=await page.evaluate(()=>{
   p109BlankWork();YEAR=2026;MONTH=10;EMPLOYEES=[{id:'r94',name:'边界核查'}];state.groups={r94:'核查组'};
   const result={},approx=(a,b)=>Math.abs(a-b)<1e-6,base=[['08:30','进'],['11:40','出'],['13:30','进'],['17:10','出']],date='2026-10-08';
   const seed=(events=base,leaves=[],trips=[],regs=[],manual=[])=>{
    Object.assign(RULES,P109_DEFAULT_RULES);Object.assign(state,{records:events.map(([time,direction],i)=>({recordId:'r94:'+i,employeeId:'r94',name:'边界核查',datetime:date+' '+time,time,direction})),
     leaves:leaves.map(([start,end],i)=>({id:'r94-leave:'+i,employeeId:'r94',date,start,end})),trips:trips.map(([startDate,endDate],i)=>({id:'r94-trip:'+i,employeeId:'r94',startDate,endDate})),
     overtimeEntries:regs.map(([start,end],i)=>({id:'r94-reg:'+i,employeeId:'r94',date,start,end})),manualOvertime:manual.map(([start,end],i)=>({id:'manual-overtime:r94:'+i,employeeId:'r94',date,start,end})),
     outings:[],monthStores:new Map(),calendarOverrides:{},manualTempOutings:[],tempOutingReview:{},overtimeReview:{},attendanceReview:{},snapshotContext:false});reanalyze();return state.analysis.get('r94|8');
   },gap=(from,to)=>[base[0],[from,'出'],[to,'进'],...base.slice(1)],hours=()=>asStatValue(asStatLedger(),'overtime','hours',EMPLOYEES,[8])*60;
   let a=seed(gap('10:10','10:50'),[['10:00','11:00']]);result.insideLeaveIgnored=!a.temporaryOutings.length&&!a.attendanceFlags.length;
   a=seed(gap('10:00','11:00'),[['10:00','11:00']]);result.exactLeaveBoundsIgnored=!a.temporaryOutings.length;
   a=seed(gap('09:50','11:10'),[['10:00','11:00']]);result.twoUncoveredTenMinuteEdges=a.temporaryOutings.length===2&&a.temporaryOutings.every(r=>r.minutes===10&&r.status==='green')&&a.temporaryOutings.map(r=>r.from).join(',')==='590,660';
   a=seed(gap('09:45','11:15'),[['10:00','11:00']]);result.twoUncoveredFifteenMinuteEdges=a.temporaryOutings.length===2&&a.temporaryOutings.every(r=>r.minutes===15&&r.status==='red');
   const [first,second]=a.temporaryOutings;result.independentIds=first.id!==second.id;p109SetTempDecision(first.id,'exclude');a=state.analysis.get('r94|8');result.edgeExclusionIndependent=activeTemporaryOutings(a).length===1&&a.temporaryOutings.find(r=>r.id===second.id).status==='red';
   a=seed(gap('09:48','11:12:01'),[['10:00','11:00']]);result.secondLevelTolerance=a.temporaryOutings[0].status==='green'&&a.temporaryOutings[1].status==='red';
   RULES.tempOutingMinutes=20;RULES.tempOutingGraceMinutes=0;reanalyze();result.uncoveredEdgesUseAdjustableThreshold=state.analysis.get('r94|8').temporaryOutings.every(r=>r.status==='green');
   a=seed(gap('09:50','11:10'),[['10:00','10:30'],['10:20','11:00']]);result.overlappingLeaveUnion=a.temporaryOutings.length===2&&a.temporaryOutings.reduce((n,r)=>n+r.minutes,0)===20;
   a=seed(gap('09:50','11:10'),[['10:00','10:20'],['10:40','11:00']]);result.disjointLeaveHasThreeGaps=a.temporaryOutings.length===3&&a.temporaryOutings.map(r=>r.minutes).join(',')==='10,20,10';
   a=seed([base[0],['09:50','出'],['10:30','未标注'],['11:10','进'],...base.slice(1)],[['10:00','11:00']]);result.coveredUnknownDoesNotHideEdges=a.temporaryOutings.length===2&&a.temporaryOutings.every(r=>r.minutes===10);
   a=seed(base,[['10:00','11:00']]);state.manualTempOutings=[{id:'manual-temp:r94',employeeId:'r94',date,start:'09:50',end:'11:10',part:'am'}];reanalyze();a=state.analysis.get('r94|8');const manualPart=a.temporaryOutings[0];p109SetTempDecision(manualPart.id,'exclude');result.clippedManualDeletionRemovesFact=!state.manualTempOutings.length&&!state.analysis.get('r94|8').temporaryOutings.length;
   a=seed([base[0],['11:20','出'],['13:50','进'],base[3]],[['11:30','13:40']]);result.crossLunchTwoUncoveredEdges=a.temporaryOutings.length===2&&a.temporaryOutings.every(r=>r.minutes===10&&r.status==='green');
   a=seed([['09:10','进'],...base.slice(1)],[['08:30','09:00']]);result.leadingLateReturn=a.temporaryOutings.length===1&&a.temporaryOutings[0].from===540&&a.temporaryOutings[0].minutes===10;
   a=seed([...base.slice(0,3),['15:50','出']],[['16:00','17:10']]);result.trailingEarlyDeparture=a.temporaryOutings.length===1&&a.temporaryOutings[0].from===950&&a.temporaryOutings[0].minutes===10;
   a=seed([['08:50','进'],...base.slice(1)],[['08:30','09:00']]);result.earlyReturnInsideLeave=!a.temporaryOutings.length&&!a.attendanceFlags.length;
   a=seed([...base.slice(0,3),['16:20','出']],[['16:00','17:10']]);result.lateDepartureInsideLeave=!a.temporaryOutings.length&&!a.attendanceFlags.length;
   a=seed(gap('09:45','11:15'),[],[[date,date]]);result.allDayTripNoTemporary=!a.temporaryOutings.length&&!a.attendanceFlags.length&&attendanceJudgment(a)==='normal';
   a=seed([['10:00','未标注']],[],[[date,date]]);result.coveredUncertainCardsNotAnAbsence=attendanceJudgment(a)==='normal'&&a.punches.length===1;
   a=seed([['19:00','进'],['22:00','出']],[],[[date,date]]);result.tripEveningStillCounts=approx(hours(),180);
   a=seed([base[0],['10:00','未标注'],...base.slice(1),['19:00','进'],['22:00','出']],[],[[date,date]]);result.coveredWorkUnknownDoesNotEraseNight=approx(hours(),180);
   a=seed([...base,['19:00','进'],['20:00','未标注'],['22:00','出']],[],[[date,date]]);result.unknownOutsideWorkStillBlocksInventedNight=hours()===0;
   a=seed(base,[],[],[['10:00','11:00']]);result.registeredWorkNotOvertime=hours()===0&&a.overtime.length===1&&a.countedOvertime.length===0&&a.overtimeConflictMinutes===60;
   a=seed(base,[],[],[],[['10:00','11:00']]);result.manualWorkNotOvertime=hours()===0&&state.manualOvertime.length===1&&a.overtimeConflictMinutes===60;
   a=seed(base,[],[],[['08:00','14:00']]);result.registrationOnlyOutsideShifts=approx(hours(),140)&&a.countedOvertime.length===2;
   a=seed(base,[],[],[['16:00','09:00']]);const nightLedger=asStatLedger();result.registeredCrossnightClipsEachWorkday=approx(asStatValue(nightLedger,'overtime','hours',EMPLOYEES,[8])*60,410)&&approx(asStatValue(nightLedger,'overtime','hours',EMPLOYEES,[9])*60,510);
   a=seed([],[],[],[['10:00','11:00']]);state.calendarOverrides[date]='rest';reanalyze();result.restDayUsesCalendar=hours()===60;
   a=seed(base,[['10:00','11:00'],['10:30','11:30']]);result.leaveSummaryUsesUnion=behaviorMinutes(a,'leave')===90&&asStatValue(asStatLedger(),'leave','hours',EMPLOYEES,[8])*60===90;
   a=seed(base,[],[],[['18:00','18:30']],[['18:00','18:40']]);result.fullyNestedUnionForty=approx(hours(),40);
   a=seed(base,[],[],[['18:00','18:30']],[['18:20','19:00']]);result.offsetUnionSixty=approx(hours(),60)&&asStatValue(asStatLedger(),'overtime','independentCount',EMPLOYEES,[8])===1;
   a=seed([...base,['18:00','进'],['19:00','出']],[],[],[['18:10','18:40']],[['18:20','18:50']]);result.threeSourcesUnionSixty=approx(hours(),60)&&approx(behaviorMinutes(a,'overtime'),60);
   result.timelineSharesUnion=analysisUnionMinutes(r23BehaviorSegments(a,'overtime').filter(r=>r.accepted!==false).map(r=>[r.from,r.to]))===60;
   a=seed(base,[['10:00','11:00']],[[date,date]],[['19:00','22:00']]);result.reportDoesNotEraseEveningRegistration=hours()===180;
   a=seed(base,[],[],[['10:00','11:00']]);RULES.businessRuleVersion=1;reanalyze();result.historicalRegistrationUnchanged=hours()===60;
   const old={schemaVersion:5,year:2026,month:10,records:[],rules:{...P109_DEFAULT_RULES,businessRuleVersion:undefined},calendarOverrides:p109CalendarMonthValues(2026,10,{},false)};
   const live=normalizeSavedMonth(old),frozen=normalizeSavedMonth(old,true);result.migration=live.rules.businessRuleVersion===2&&!live.saved&&live.schemaVersion===7&&frozen.rules.businessRuleVersion===1;
   result.invalidPolicyRejected=normalizeSavedMonth({...old,rules:{...P109_DEFAULT_RULES,businessRuleVersion:3}})===null;
   seed(gap('09:45','11:15'),[['10:00','11:00']],[],[['16:30','18:00']],[['18:00','18:30']]);
   Object.assign(state,{workspaceMode:'person',selection:{type:'cell',employeeId:'r94',day:8},chartDay:8,chartTab:'timeline',timelineRange:null});render();
   return result;
  });report.cases=cases;for(const [label,ok] of Object.entries(cases))check(ok,'priority and union: '+label);
  await page.waitForSelector('#attendanceTimelineChart svg');
  const tools=page.locator('.p109-timeline-tools');await page.locator('.inspector-insight').hover();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.p109-timeline-tools')).opacity==='0');check(true,'tools hide outside timeline');
  await page.locator('#attendanceTimelineChart').hover({position:{x:100,y:110}});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.p109-timeline-tools')).opacity==='1');check(true,'timeline hover reveals only its toolbar');
  await page.locator('#p109TimelineZoomIn').click();check(await page.evaluate(()=>state.timelineRange.end-state.timelineRange.start===360),'hover toolbar zoom changes real range');
  await page.locator('#p109TimelineReset').click();check(await page.evaluate(()=>state.timelineRange.start===480&&state.timelineRange.end===1200),'hover reset restores initial range');
  await page.locator('.inspector-insight').hover();await page.locator('#p109TimelineZoomOut').focus();await page.keyboard.press('Tab');await page.waitForFunction(()=>{const node=document.querySelector('.p109-timeline-tools');return node.contains(document.activeElement)&&getComputedStyle(node).opacity==='1'});check(await tools.evaluate(n=>getComputedStyle(n).opacity==='1'),'keyboard focus reveals toolbar');await page.keyboard.press('Enter');
  const raw=await page.evaluate(()=>JSON.stringify({records:state.records,leaves:state.leaves,registered:state.overtimeEntries,manual:state.manualOvertime}));
  await page.locator('.insight-behavior-row.overtime').hover();check(await page.locator('.p109-overtime-conflict').count()===1,'conflicting imported or manual work hours have a visible hint');
  await page.locator('#attendanceTimelineChart').hover({position:{x:20,y:250}});await page.screenshot({path:path.join(out,'r94-leave-boundaries.png')});
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1600,height:900},{width:1920,height:1080}]){
   await page.setViewportSize(size);await page.evaluate(()=>render());await page.waitForSelector('#attendanceTimelineChart svg');
   const g=await page.evaluate(()=>{const box=document.querySelector('.inspector-insight'),b=box.getBoundingClientRect(),content=document.querySelector('.p109-day-inspector'),metrics=[...document.querySelectorAll('.r74-overview-metrics .insight-row')].map(n=>n.getBoundingClientRect()),business=[...document.querySelectorAll('.r74-behavior-list .insight-behavior-row')].map(n=>n.getBoundingClientRect());return {width:innerWidth,scroll:box.scrollHeight,client:box.clientHeight,fit:box.scrollHeight<=box.clientHeight+1&&box.scrollWidth<=box.clientWidth+1&&content.getBoundingClientRect().bottom<=b.bottom+1,metrics:metrics.every(r=>Math.abs(r.top-metrics[0].top)<1),business:Math.abs(business[0].top-business[1].top)<1&&business[2].top>business[0].bottom}});report.geometry.push(g);check(g.fit&&g.metrics&&g.business,'readable inspector fits with four metrics and two business columns '+size.width);
  }
  await page.screenshot({path:path.join(out,'r94-inspector.png')});
  check(await page.evaluate(before=>JSON.stringify({records:state.records,leaves:state.leaves,registered:state.overtimeEntries,manual:state.manualOvertime})===before,raw),'all UI operations preserve original sources');
  const manualBefore=await page.evaluate(()=>state.manualOvertime.length);
  await page.evaluate(()=>p109OpenIntervalEditor('overtime','r94','2026-10-08'));
  await page.locator('#p109IntervalStart').fill('10:00');await page.locator('#p109IntervalEnd').fill('11:00');await page.locator('#p109IntervalOverlay button[type="submit"]').click();
  check((await page.locator('#p109IntervalError').innerText()).includes('全部处于工作日班次内')&&await page.evaluate(n=>state.manualOvertime.length===n,manualBefore),'actual editor rejects a wholly scheduled work interval without mutation');
  await page.locator('#p109IntervalStart').fill('08:00');await page.locator('#p109IntervalEnd').fill('09:00');await page.locator('#p109IntervalOverlay button[type="submit"]').click();
  check(await page.locator('#p109IntervalOverlay').count()===0&&await page.evaluate(()=>{const a=state.analysis.get('r94|8'),last=state.manualOvertime.at(-1);return last.start==='08:00'&&last.end==='09:00'&&activeAutoOvertimeSegments(a).some(r=>r.from===480&&r.to===510)&&behaviorMinutes(a,'overtime')===110}),'actual partial work addition retains input and counts only its thirty-minute off-shift part');
  check(!errors.length&&!remote.length,'no script errors or runtime remote requests');report.errors=errors;report.remote=remote;
  fs.writeFileSync(path.join(out,'r94-audit.json'),JSON.stringify(report,null,2));console.log('P109_R94_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(error){fs.writeFileSync(path.join(out,'r94-failure.json'),JSON.stringify({error:error.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r94-failure.png')});throw error}finally{await context.close()}
};
