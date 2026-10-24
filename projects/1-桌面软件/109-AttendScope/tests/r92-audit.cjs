'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={checks:[],cases:{},geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 const select=async(id,day)=>{await page.evaluate(({id,day})=>{Object.assign(state,{workspaceMode:'person',selection:{type:'cell',employeeId:id,day},chartDay:day,chartTab:'timeline',timelineRange:null,filter:'main'});render()},{id,day});await page.waitForSelector('#attendanceTimelineChart svg')};
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const cases=await page.evaluate(()=>{
   const get=(id,day)=>state.analysis.get(id+'|'+day),temp=(id,day)=>get(id,day).temporaryOutings,
    overtime=(id,days)=>days.reduce((n,day)=>n+activeAutoOvertimeSegments(get(id,day)).reduce((sum,s)=>sum+s.minutes,0),0);
   window.__r92Facts=JSON.stringify({records:state.records,leaves:state.leaves,trips:state.trips,outings:state.outings,overtime:state.overtimeEntries});
   const answer={group:EMPLOYEES.filter(e=>groupOf(e)==='极端测试组').length===10,
    earlySeconds:get('E046',8).attendanceFlags.some(f=>f.kind==='early')&&temp('E046',8).length===0,
    excusedSeconds:!get('E046',9).attendanceFlags.length&&temp('E046',9).length===0&&attendanceJudgment(get('E046',9))==='normal',
    exactEarlyLimit:temp('E046',12).length===1&&temp('E046',12)[0].minutes===12,
    belowEarlyLimit:temp('E046',13).length===0,
    limit12:temp('E044',8).length===1&&temp('E044',8)[0].status==='green',
    limit12plusSecond:temp('E044',9).length===1&&temp('E044',9)[0].status==='red',
    limit12minusSecond:temp('E044',12).length===1&&temp('E044',12)[0].status==='green',
    overtime20:overtime('E043',[8])===0,
    overtimeBelow20:overtime('E043',[9])===0,
    overtimeBelowNewMinimum:overtime('E043',[12])===0,
    overnight:Math.abs(overtime('E041',[8,9])-315)<1e-8,
    registeredNight:Math.abs(asStatValue(asStatLedger(),'overtime','hours',EMPLOYEES.filter(e=>e.id==='E042'),[12,13])*60-280)<1e-7,
    midnight20:Math.abs(overtime('E049',[8,9])-20)<1e-6,
    midnightBelow20:Math.abs(overtime('E049',[19,20])-(20-1/60))<1e-6,
    burstFinalNormal:!get('E045',8).attendanceFlags.some(f=>f.kind==='early')&&get('E045',8).lastOut==='17:10:00'&&get('E045',8).punches.some(p=>p.time==='11:40:30')&&temp('E045',8).length===3,
    burstSeconds:Math.abs(temp('E045',8).reduce((n,t)=>n+t.minutes,0)*60-40)<1e-7,
    splitReports:temp('E047',9).length===2&&temp('E047',9)[0].status==='green'&&temp('E047',9)[1].status==='red',
    outingCoversGap:temp('E044',13)[0]?.businessCovered&&temp('E044',13)[0]?.status==='green',
    outingCoversEarly:!get('E046',14).attendanceFlags.some(f=>f.kind==='early')&&temp('E046',14)[0]?.businessCovered,
    tripCoversBoth:!get('E047',12).attendanceFlags.length&&temp('E047',12).length===0,
    unknownNoBridge:!temp('E048',12).some(t=>t.sourceFrom===600&&t.sourceTo===620),
    missingNight:overtime('E048',[8,9])===0,
    dense:temp('E050',8).length===60&&Math.abs(temp('E050',8).reduce((n,t)=>n+t.minutes,0)-10)<1e-7,
    beforeEightAfterTwenty:p109InitialTimelineRange(get('E050',9)).start===360&&p109InitialTimelineRange(get('E050',9)).end===1430};
   const fake=events=>({employee:{id:'range'},day:1,punches:events.map(time=>({time})),pairs:[],overtime:[],autoOvertime:{segments:[]}});
   answer.rangeInside=JSON.stringify(p109InitialTimelineRange(fake(['08:00','20:00'])))===JSON.stringify({key:'range|1',start:480,end:1200});
   answer.rangeOneSide=p109InitialTimelineRange(fake(['07:59:59','17:00'])).end===1200&&Math.abs(p109InitialTimelineRange(fake(['07:59:59','17:00'])).start-(450-1/60))<1e-7;
   answer.rangeEmpty=p109InitialTimelineRange(fake([])).start===480&&p109InitialTimelineRange(fake([])).end===1200;
   answer.rangeNight=p109InitialTimelineRange(get('E041',8)).end===1440&&p109InitialTimelineRange(get('E041',9)).start===0;
   return answer;
  });report.cases=cases;for(const [key,value] of Object.entries(cases))check(value,'deterministic extreme evidence: '+key);
  const priority=await page.evaluate(()=>{
   const originals={records:state.records,outings:state.outings,trips:state.trips,leaves:state.leaves,review:state.tempOutingReview},id='E044',day=14,date=isoDate(day),result={};
   const get=()=>state.analysis.get(id+'|'+day),run=(events,reports)=>{
    state.records=[...originals.records.filter(r=>r.employeeId!==id||!r.datetime.startsWith(date)),...events.map(([time,direction],i)=>({employeeId:id,name:'Priority case',datetime:date+' '+time,time,direction,recordId:'priority:'+i}))];
    state.trips=originals.trips.filter(r=>r.employeeId!==id);state.leaves=originals.leaves.filter(r=>r.employeeId!==id);
    state.outings=[...originals.outings.filter(r=>r.employeeId!==id),...reports.map(([start,end],i)=>({id:'priority-report:'+i,employeeId:id,startDate:date,endDate:date,start,end}))];
    state.tempOutingReview={};reanalyze();return get();
   };
   try{
    const mid=[['08:20','进'],['10:00','出'],['10:30','进'],['11:40:30','出'],['13:25','进'],['17:10','出']],early=[['08:20','进'],['11:20','出'],['13:50','进'],['17:10','出']];
    let a=run(mid,[['10:00','10:15'],['10:15','10:30']]);result.unionCovers=a.temporaryOutings[0]?.businessCovered&&a.temporaryOutings[0].status==='green';
    const key=a.temporaryOutings[0].id;state.tempOutingReview[key]='red';reanalyze();a=get();result.reportOverridesStaleRed=a.temporaryOutings[0].status==='green'&&!a.temporaryOutings[0].manualDecision&&state.tempOutingReview[key]==='red';
    result.rejectRed=p109SetTempDecision(key,'red')===false&&get().temporaryOutings[0].status==='green';
    a=run(mid,[['10:00','10:10']]);result.partialGapRed=a.temporaryOutings[0].status==='red'&&!a.temporaryOutings[0].businessCovered;
    a=run(mid,[['10:10','10:40']]);result.shiftedSameDurationGreen=a.temporaryOutings[0].status==='green'&&!a.temporaryOutings[0].businessCovered;
    a=run(early,[['11:20','13:50']]);result.reportCoversBothEdges=!a.attendanceFlags.length&&a.temporaryOutings.length===2&&a.temporaryOutings.every(t=>t.businessCovered);
    a=run(early,[['11:25','11:40']]);result.partialEarlyStillFlagged=a.attendanceFlags.some(f=>f.label==='上午早退')&&a.temporaryOutings[0].status==='red';
    a=run(early,[['08:30','11:30']]);result.longReportCannotHideUncoveredTail=a.attendanceFlags.some(f=>f.label==='上午早退');
    a=run([['09:10','进'],['11:40:30','出'],['13:25','进'],['16:50','出']],[['08:30','09:10'],['16:50','17:10']]);result.lateAndEarlyFullyCovered=!a.attendanceFlags.length;
   }finally{state.records=originals.records;state.outings=originals.outings;state.trips=originals.trips;state.leaves=originals.leaves;state.tempOutingReview=originals.review;reanalyze();render()}
   return result;
  });report.priority=priority;for(const [key,value] of Object.entries(priority))check(value,'registered business has priority: '+key);
  await select('E044',13);check(await page.locator('.p109-temp-actions button.red').isDisabled(),'covered interval exposes a disabled red action with a reporting explanation');await page.locator('.toast').evaluateAll(nodes=>nodes.forEach(n=>n.remove()));await page.screenshot({path:path.join(out,'r92-reported-priority.png'),animations:'disabled'});
  await page.evaluate(()=>{state.workspaceMode='group';state.selectedGroup='极端测试组';state.selection={type:'overall'};state.filter='main';render()});await page.screenshot({path:path.join(out,'r92-extreme-group.png')});
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1600,height:900},{width:1920,height:1080}]){
   await page.setViewportSize(size);
   for(const [id,day] of [['E046',9],['E045',8],['E042',13],['E050',8]]){
    await select(id,day);await page.evaluate(()=>{const a=state.analysis.get(state.selection.employeeId+'|'+state.chartDay);if(a?.punches[0])showRecord(a.punches[0].recordId)});
    const g=await page.evaluate(()=>{
     const box=document.querySelector('.inspector-insight'),r=box.getBoundingClientRect(),content=document.querySelector('.p109-day-inspector'),metrics=[...box.querySelectorAll('.r74-overview-metrics .insight-row')].map(n=>n.getBoundingClientRect()),blocks=[...content.children].map(n=>n.getBoundingClientRect());
     return {width:innerWidth,height:innerHeight,scroll:box.scrollHeight,client:box.clientHeight,contentBottom:content.getBoundingClientRect().bottom,panelBottom:r.bottom,
      fit:box.scrollHeight<=box.clientHeight+1&&box.scrollWidth<=box.clientWidth+1&&blocks.every(b=>b.bottom<=r.bottom-2),
      metrics:metrics.length===4&&Math.max(...metrics.map(m=>m.y))-Math.min(...metrics.map(m=>m.y))<1.5,
      modules:blocks.length===5&&!box.querySelector('.r74-insight-head'),overflow:document.documentElement.scrollHeight>innerHeight+1};
    });report.geometry.push({id,day,...g});check(g.fit&&g.metrics&&g.modules&&!g.overflow,'five content blocks fit without scrolling '+id+'/'+size.width+' '+JSON.stringify(g));
   }
  }
  await page.setViewportSize({width:1600,height:900});await select('E046',9);await page.evaluate(()=>showRecord(state.analysis.get('E046|9').punches[1].recordId));await page.screenshot({path:path.join(out,'r92-short-departure.png'),animations:'disabled'});
  await select('E045',8);await page.screenshot({path:path.join(out,'r92-lunch-burst.png')});
  await select('E050',8);await page.locator('[data-temp-details]').click();check(await page.locator('#p109TempDetailsDialog .p109-temp-details>div').count()===60,'all sixty intervals remain available in separate details dialog');
  await page.keyboard.press('Escape');check(await page.locator('#p109TempDetailsDialog').count()===0&&await page.locator('[data-temp-details]').evaluate(n=>n===document.activeElement),'details closes and restores focus without altering inspector');
  await select('E050',9);
  const source=await page.evaluate(()=>({records:JSON.stringify(state.records),range:{...state.timelineRange}}));
  await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')).dispatchAction({type:'dataZoom',startValue:600,endValue:900}));
  await page.waitForFunction(()=>state.timelineRange.start===600&&state.timelineRange.end===900);await page.locator('#attendanceTimelineChart').hover({position:{x:40,y:80}});await page.locator('#p109TimelineReset').click();
  check(await page.evaluate(()=>state.timelineRange.start===360&&state.timelineRange.end===1430),'reset button restores this day expanded initial range');
  check(await page.evaluate(before=>JSON.stringify(state.records)===before,source.records),'reset cannot modify raw punch records');
  await select('E045',8);await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')).dispatchAction({type:'dataZoom',startValue:660,endValue:720}));await page.locator('#p109TimelineReset').focus();await page.keyboard.press('Enter');
  check(await page.evaluate(()=>state.timelineRange.start===480&&state.timelineRange.end===1200),'keyboard reset returns an ordinary day to 08:00–20:00');
  await select('E041',8);await page.screenshot({path:path.join(out,'r92-overnight.png')});
  check(await page.evaluate(()=>__r92Facts===JSON.stringify({records:state.records,leaves:state.leaves,trips:state.trips,outings:state.outings,overtime:state.overtimeEntries})),'all UI operations leave original demo evidence unchanged');
  check(!errors.length&&!remote.length,'no script errors or runtime network requests');report.errors=errors;report.remote=remote;
  fs.writeFileSync(path.join(out,'r92-audit.json'),JSON.stringify(report,null,2));console.log('P109_R92_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(error){fs.writeFileSync(path.join(out,'r92-failure.json'),JSON.stringify({error:error.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r92-failure.png')});throw error}finally{await context.close()}
};
