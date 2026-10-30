'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const report=await page.evaluate(async()=>{
   p109BlankWork();YEAR=2026;MONTH=10;const e={id:personIdentity('边界修复核查'),name:'边界修复核查'},date='2026-10-08',base=[['08:30:00','进'],['11:40:00','出'],['13:30:00','进'],['17:10:00','出']];EMPLOYEES=[e];
   const checks={},near=(a,b)=>Math.abs(a-b)<1e-7,make=(events)=>events.map(([time,direction,id],i)=>({employeeId:e.id,name:e.name,recordId:id||'r112:'+i,datetime:(time.length>10?time:date+' '+time),time:time.slice(-8),direction})),
    run=(events,options={})=>{
     Object.assign(RULES,P109_DEFAULT_RULES,options.rules||{});Object.assign(state,{records:make(events),leaves:(options.leaves||[]).map(([start,end],i)=>({id:'leave:'+i,employeeId:e.id,date,start,end})),
      trips:options.trip?[{id:'trip',employeeId:e.id,startDate:date,endDate:date}]:[],outings:(options.outings||[]).map(([start,end],i)=>({id:'outing:'+i,employeeId:e.id,startDate:date,endDate:date,start,end})),overtimeEntries:[],manualTempOutings:[],manualOvertime:[],attendanceReview:{},tempOutingReview:{},overtimeReview:{},manualStatuses:{},monthStores:new Map(),calendarOverrides:{[date]:'work'},snapshotContext:false,activeBranch:null,imports:[],revisions:[],revisionSeq:0,prefs:{},saved:false});reanalyze();return state.analysis.get(e.id+'|8');
    },summary=a=>({pairs:a.pairs.map(([x,y])=>[x.time,y.time]),minutes:a.workMinutes,flags:a.attendanceFlags.map(f=>f.label+'@'+f.time),temp:a.temporaryOutings.map(r=>[r.from,r.to,r.minutes,r.status]),overtime:a.autoOvertime.minutes,issues:[...a.issues].sort()});
   const conflicts=[['10:00:00','进','same-in'],['10:00:00','出','same-out'],['10:00:00','未标注','same-unknown']],permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
   const variants=permutations.map(order=>summary(run([base[0],...order.map(i=>conflicts[i]),...base.slice(1)])));
   checks.conflictOrderIndependent=variants.every(v=>JSON.stringify(v)===JSON.stringify(variants[0]));
   let a=run([base[0],...conflicts.slice(0,2),...base.slice(1)]);checks.conflictWarned=a.issues.some(s=>s.includes('同一时刻'));
   checks.conflictCannotBridge=!a.pairs.some(([x,y])=>minutes(x.time)<600&&minutes(y.time)>600)&&!a.temporaryOutings.some(r=>r.from===600);
   checks.conflictingRawKept=JSON.stringify(state.records)===JSON.stringify(make([base[0],...conflicts.slice(0,2),...base.slice(1)]))&&a.punches.length===6;
   const lateSweep=[];
   for(let minute=930;minute<1030;minute++){
    a=run([...base.slice(0,2),[attendanceClock(minute+1/60),'进'],base[3]]);lateSweep.push(a.attendanceFlags.some(f=>f.label==='下午迟到'));
   }
   checks.lateBeyondTwoHours=lateSweep.every(Boolean)&&lateSweep.length===100;
   a=run([['15:45:00','进'],base[3]]);checks.afternoonOnlyStillLate=a.attendanceFlags.some(f=>f.label==='下午迟到');
   a=run([...base.slice(0,2),['15:45:00','进'],base[3],['23:00:00','出']]);checks.nightOrphanDoesNotEraseLate=a.attendanceFlags.some(f=>f.label==='下午迟到');
   a=run([...base.slice(0,2),['14:00:00','未标注'],['15:45:00','进'],base[3]]);checks.uncertainReturnNotInvented=!a.attendanceFlags.some(f=>f.label==='下午迟到')&&a.severity==='suspect';
   a=run([...base.slice(0,2),['15:45:00','进'],base[3]],{leaves:[['13:30','15:35']]});checks.leaveLateIsTemporaryOnly=!a.attendanceFlags.some(f=>f.label==='下午迟到')&&a.temporaryOutings.some(r=>near(r.minutes,10)&&r.status==='green');
   a=run([...base.slice(0,2),['15:45:00','进'],base[3]],{outings:[['13:30','15:45']]});checks.reportCoversLate=!a.attendanceFlags.some(f=>f.label==='下午迟到');
   a=run([...base.slice(0,2),['15:45:00','进'],base[3]],{trip:true});checks.tripPriority=a.attendanceFlags.length===0&&a.temporaryOutings.length===0;
   a=run([base[0],['10:00:00','出'],['10:20:00','出'],['10:25:00','进'],...base.slice(1)]);
   checks.repeatedExitKeepsFullGap=a.temporaryOutings.some(r=>r.from===600&&r.to===625&&r.minutes===25&&r.status==='red');
   checks.presenceAndOutingAgree=near(a.workMinutes,385)&&near(behaviorMinutes(a,'tempOuting'),25);
   checks.repeatedExitStillWarned=a.issues.some(s=>s.includes('连续出'))&&a.punches.length===7;
   a=run([base[0],['10:00:00','出'],['10:05:00','出'],['10:20:00','进'],['10:25:00','进'],...base.slice(1)]);checks.noReuse=activeTemporaryOutings(a).length===1&&near(activeTemporaryOutings(a)[0].minutes,20);
   a=run([base[0],['10:00:00','出'],['10:10:00','未标注'],['10:20:00','出'],['10:25:00','进'],...base.slice(1)]);checks.unknownCutsExitChain=!a.temporaryOutings.some(r=>r.sourceFrom===600);
   a=run([['2026-10-08 02:00:00','出']]);const midnight=a.autoOvertime.minutes;
   checks.isolatedMidnightBaseline=near(midnight,120);
   for(const direction of ['进','未标注']){
    a=run([['2026-10-01 12:00:00',direction],['2026-10-08 02:00:00','出']]);checks['staleMidnight'+direction]=near(a.autoOvertime.minutes,midnight);
    a=run([['2026-10-07 23:00:00',direction],['2026-10-08 02:00:00','出']]);checks['recentMidnight'+direction]=direction==='进'?near(a.autoOvertime.minutes,120):a.autoOvertime.minutes===0;
   }
   a=run([['2026-10-07 23:50:00','出'],['2026-10-08 00:01:00','出']]);checks.midnightRepeatBlocked=a.autoOvertime.minutes===0;
   a=run([['2026-10-07 23:50:00','进'],['2026-10-08 00:10:00','出']]);checks.realOvernightNotDoubled=near(a.autoOvertime.minutes,10)&&a.autoOvertime.segments.every(s=>!s.inference);
   a=run([['2026-10-06 13:59:59','未标注'],['2026-10-08 02:00:00','出']]);checks.beyond36HoursIgnored=near(a.autoOvertime.minutes,120);
   a=run([['2026-10-06 14:00:00','未标注'],['2026-10-08 02:00:00','出']]);checks.within36HoursStillBlocks=a.autoOvertime.minutes===0;
   a=run([['2026-10-08 02:00:00','出']],{rules:{midnightInference:false}});checks.inferenceSwitchRespected=a.autoOvertime.minutes===0;
   let randomSeed=112,rng=limit=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed%limit},permuted=0,exitChains=0;
   for(let sample=0;sample<200;sample++){
    const at=550+rng(100),time=attendanceClock(at),events=[...base.map(([t,d],i)=>[t,d,'base:'+i]),[time,'出','conflict:out'],[time,sample%2?'未标注':'进','conflict:other'],['19:00:00','进','night:in'],['20:00:00','出','night:out']],
     expected=JSON.stringify(summary(run(events)));
    for(let n=0;n<3;n++){
     const shuffled=events.map(r=>[...r]);for(let i=shuffled.length-1;i>0;i--){const j=rng(i+1);[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]]}
     if(JSON.stringify(summary(run(shuffled)))===expected)permuted++;
    }
    const left=570+rng(60),back=left+13+rng(30),count=1+rng(40),outs=Array.from({length:count},(_,i)=>[attendanceClock(left+(back-left)*i/count),'出','repeat:'+i]);
    a=run([base[0],...outs,[attendanceClock(back),'进'],...base.slice(1)]);
    if(a.punches.length<=50&&activeTemporaryOutings(a).length===1&&near(activeTemporaryOutings(a)[0].minutes,back-left)&&activeTemporaryOutings(a)[0].status==='red')exitChains++;
   }
   checks.randomOrderInvariant=permuted===600;checks.randomRepeatedExitChains=exitChains===200;
   const legacy={...P109_DEFAULT_RULES};delete legacy.punchEvidenceRuleVersion;
   const payload={schemaVersion:13,year:2026,month:10,records:[],rules:legacy,calendarOverrides:state.calendarOverrides},live=normalizeSavedMonth(payload),frozen=normalizeSavedMonth(payload,true);
   checks.migration=live.rules.punchEvidenceRuleVersion===2&&!live.saved&&frozen.rules.punchEvidenceRuleVersion===1;
   checks.invalidVersionRejected=!p109ValidOvertimeRules({...P109_DEFAULT_RULES,punchEvidenceRuleVersion:3});
   a=run([base[0],['10:00:00','出'],['10:20:00','出'],['10:25:00','进'],...base.slice(1)],{rules:{punchEvidenceRuleVersion:1}});checks.legacyGapUnchanged=a.temporaryOutings.some(r=>r.from===620&&r.minutes===5);
   a=run([...base.slice(0,2),['15:45:00','进'],base[3]],{rules:{punchEvidenceRuleVersion:1}});checks.legacyLateUnchanged=!a.attendanceFlags.some(f=>f.label==='下午迟到');
   a=run([['2026-10-01 12:00:00','未标注'],['2026-10-08 02:00:00','出']],{rules:{punchEvidenceRuleVersion:1}});checks.legacyMidnightUnchanged=a.autoOvertime.minutes===0;
   a=run([base[0],['10:00:00','出'],['10:20:00','出'],['10:25:00','进'],...base.slice(1)],{rules:{punchEvidenceRuleVersion:1}});
   const legacyTemp=a.temporaryOutings[0];state.tempOutingReview[legacyTemp.id]='exclude';RULES.punchEvidenceRuleVersion=2;reanalyze();a=state.analysis.get(e.id+'|8');
   checks.legacyExclusionFollowsEvent=activeTemporaryOutings(a).length===0&&a.temporaryOutings[0].minutes===25;
   p109SetTempDecision(a.temporaryOutings[0].id,null);a=state.analysis.get(e.id+'|8');checks.migratedExclusionCanRestore=activeTemporaryOutings(a).length===1&&activeTemporaryOutings(a)[0].status==='red';
   a=run([base[0],['11:00:00','出'],['13:35:00','出'],['13:45:00','进'],base[3]],{rules:{punchEvidenceRuleVersion:1}});state.tempOutingReview[a.temporaryOutings[0].id]='exclude';RULES.punchEvidenceRuleVersion=2;reanalyze();a=state.analysis.get(e.id+'|8');
   checks.oldAfternoonExclusionDoesNotEraseNewMorning=a.temporaryOutings.some(r=>r.shift==='am'&&r.status==='red')&&a.temporaryOutings.some(r=>r.shift==='pm'&&r.status==='exclude');
   a=run([base[0],['10:00:00','出'],['10:20:00','出'],['10:25:00','进'],...base.slice(1)]);const original=JSON.stringify(state.records),temp=a.temporaryOutings[0];p109SetTempDecision(temp.id,'exclude');
   state.projectDir=p109MemoryRoot('边界修复核查');const memory=await p109PortableFromSession(),built=await p109ZipBuild(await p109PortableCollect(memory));state.saved=true;await p109OpenPortableFile(new File([built.zip],'r112.zip',{type:'application/zip'}));
   a=state.analysis.get(e.id+'|8');checks.zipKeepsRulesAndExclusion=RULES.punchEvidenceRuleVersion===2&&activeTemporaryOutings(a).length===0;checks.zipPreservesRaw=JSON.stringify(state.records)===original;
   return {checks,variants,lateCases:lateSweep.length,randomOrderCases:permuted,randomExitCases:exitChains};
  });fs.writeFileSync(path.join(out,'r112-audit.json'),JSON.stringify({...report,errors},null,2));
  const failed=Object.entries(report.checks).filter(([,v])=>!v).map(([k])=>k);assert(!failed.length,'R112: '+failed.join(', '));
  await page.evaluate(()=>{const e=EMPLOYEES[0],a=state.analysis.get(e.id+'|8');state.workspaceMode='person';state.selection={type:'cell',employeeId:e.id,day:8};state.chartDay=8;state.chartTab='timeline';state.timelineRange=null;p109SetTempDecision(a.temporaryOutings[0].id,null);render()});
  await page.waitForSelector('#attendanceTimelineChart svg');await page.screenshot({path:path.join(out,'r112-repeat-gap.png')});
  assert(!errors.length,errors.join(' | '));console.log('P109_R112_AUDIT_PASS '+JSON.stringify({checks:Object.keys(report.checks).length,lateCases:report.lateCases,randomOrderCases:report.randomOrderCases,randomExitCases:report.randomExitCases}));
 }finally{await context.close()}
};
