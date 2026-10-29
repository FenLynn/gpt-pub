'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  await page.evaluate(()=>{
   p109BlankWork();YEAR=2026;MONTH=10;
   const person={id:personIdentity('班末压力核查'),name:'班末压力核查'},date='2026-10-08';EMPLOYEES=[person];
   let seed=0x7109ad;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n},clock=s=>[Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(n=>String(n).padStart(2,'0')).join(':');
   const run=(events,part='pm',opts={})=>{
    Object.assign(RULES,P109_DEFAULT_RULES,opts.rules||{});state.records=events.map(([s,d],i)=>({recordId:'burst:'+i,employeeId:person.id,name:person.name,datetime:date+' '+clock(s),time:clock(s),direction:d}));
    Object.assign(state,{leaves:[],trips:[],outings:[],overtimeEntries:[],manualOvertime:[],manualTempOutings:[],manualStatuses:{},attendanceReview:{},overtimeReview:{},tempOutingReview:{},monthStores:new Map(),calendarOverrides:{[date]:'work'},snapshotContext:false,activeBranch:null,imports:[],revisions:[],revisionSeq:0});
    if(opts.trip)state.trips=[{id:'t',employeeId:person.id,startDate:date,endDate:date}];
    if(opts.report)state.outings=[{id:'o',employeeId:person.id,startDate:date,endDate:date,start:clock(opts.report[0]),end:clock(opts.report[1])}];
    if(opts.leave)state.leaves=[{id:'l',employeeId:person.id,date,start:clock(opts.leave[0]),end:clock(opts.leave[1])}];
    const original=JSON.stringify(state.records),a=analyzeDay(person,8),early=a.attendanceFlags.filter(f=>f.kind==='early'&&(part==='am'?f.label==='上午早退':f.label==='早退'));
    return {early:early.map(f=>({label:f.label,time:f.time})),status:a.status,severity:a.severity,issues:a.issues,rawUnchanged:original===JSON.stringify(state.records),pairs:a.pairs.map(([x,y])=>[x.time,y.time]),total:events.length};
   };
   const end=part=>part==='am'?42000:61800,full=(part,events)=>part==='am'?[[30600,'进'],...events,[48600,'进'],[61800,'出']]:[[30600,'进'],[42000,'出'],[48600,'进'],...events];
   const assess=(label,part,events,expected,opts={})=>{
    const actual=run(events,part,opts),strictPass=actual.early.length===expected,
     pass=!!((strictPass||opts.allowSuspect&&actual.severity==='suspect')&&actual.rawUnchanged&&actual.total<=50);
    return {label,part,expected,pass,strictPass,actual,events:events.map(([s,d])=>[clock(s),d])};
   };window.boundary={rand,clock,run,end,full,assess,person};
  });
  const targeted=await page.evaluate(()=>{
   const {end,full,assess}=boundary,list=[];
   for(const part of ['am','pm']){const e=end(part),add=(label,rows,want,opts)=>list.push(assess(label,part,full(part,rows),want,opts));
    add('short exit entry final',[[e-120,'出'],[e+120,'进'],[e+180,'出']],0);
    add('duplicate exit boundary',[[e-120,'出'],[e+30,'出']],0);
    add('exact 12 min return',[[e-120,'出'],[e+600,'进'],[e+601,'出']],0);
    add('12 min plus 1 second return',[[e-120,'出'],[e+601,'进'],[e+602,'出']],1);
    add('exact 12 min repeated exit',[[e-120,'出'],[e+600,'出']],0);
    add('12 min plus 1 second repeated exit',[[e-120,'出'],[e+601,'出']],1,{allowSuspect:true});
    add('short clock no eventual return',[[e-120,'出']],1);
    add('no chained duplicate extension',[[e-1800,'出'],[e-1200,'出'],[e-600,'出'],[e,'出']],1,{allowSuspect:true});
    add('same-second out in with proper terminal exit',[[e-1200,'出'],[e-1200,'进'],[e,'出']],0);
    add('same-second in out with proper terminal exit',[[e-1200,'进'],[e-1200,'出'],[e,'出']],0);
    // Regressions for the remote-orphan failures captured in the R108 audit.
    add('true early and unrelated night exit',[[e-1200,'出'],[82800,'出']],1);
    add('true early and unrelated night entry',[[e-1200,'出'],[79200,'进']],1);
    add('unknown is not a valid terminal clock',[[e-120,'出'],[e+30,'未标注']],1,{allowSuspect:true});
    add('all-day trip overrides absence',[[e-1200,'出']],0,{trip:true});
    add('approved outing covers departure',[[e-1200,'出']],0,{report:[e-1200,e]});
    add('approved leave covers departure',[[e-1200,'出']],0,{leave:[e-1200,e]});
    add('custom 6 min exact',[[e-120,'出'],[e+240,'进'],[e+241,'出']],0,{rules:{tempOutingMinutes:5,tempOutingGraceMinutes:1}});
    add('custom 6 min exceeded',[[e-120,'出'],[e+241,'进'],[e+242,'出']],1,{rules:{tempOutingMinutes:5,tempOutingGraceMinutes:1}});
   }return list;
  });
  const groups={};
  for(let batch=0;batch<12;batch++){
   const summary=await page.evaluate(batch=>{
    const {rand,end,full,assess}=boundary,summary={};
    const record=r=>{const g=summary[r.label]??={cases:0,failed:0,rawMutations:0,maxPunches:0,byShift:{am:0,pm:0},withheldAsSuspect:0,examples:[]};g.cases++;g.byShift[r.part]++;if(!r.strictPass&&r.actual.severity==='suspect')g.withheldAsSuspect++;g.maxPunches=Math.max(g.maxPunches,r.actual.total);if(!r.actual.rawUnchanged)g.rawMutations++;if(!r.pass){g.failed++;if(g.examples.length<3)g.examples.push(r)}};
    for(let i=0;i<500;i++){
     const part=(Math.floor(i/6)+batch)%2?'am':'pm',e=end(part),category=(i+batch)%6;
     if(category===0){
      const n=2+rand(46),last=e+rand(120),first=last-720+rand(60),times=new Set([first,last]);while(times.size<n)times.add(first+rand(last-first+1));
      record(assess('all directions in one protected window',part,full(part,[...times].sort((a,b)=>a-b).map((s,j,all)=>[s,j===all.length-1?'出':rand(2)?'进':'出'])),0));
     }else if(category===1){
      const n=3+2*rand(23),times=new Set([e-1800,e]);while(times.size<n)times.add(e-1800+rand(1801));
      record(assess('many local returns before proper terminal',part,full(part,[...times].sort((a,b)=>a-b).map((s,j,all)=>[s,j===all.length-1?'出':j%2?'进':'出'])),0));
     }else if(category===2){
      const left=e-1-rand(600),duration=720+[-1,0,1][rand(3)],right=left+duration;
      record(assess('return threshold second sweep',part,full(part,[[left,'出'],[right,'进'],[right+1,'出']]),duration<=720?0:1));
     }else if(category===3){
      const left=e-1-rand(600),last=left+720+[-1,0,1][rand(3)],n=2+rand(46),times=new Set([left,last]);while(times.size<n)times.add(left+rand(last-left+1));
      // Any qualifying terminal exit protects the original departure; later
      // duplicate exits cannot revoke that evidence or extend the window.
      const protectedExit=[...times].some(s=>s>=e&&s-left<=720);
      record(assess('repeated exit no chained extension',part,full(part,[...times].sort((a,b)=>a-b).map(s=>[s,'出'])),protectedExit?0:1,{allowSuspect:!protectedExit}));
     }else if(category===4){
      const left=e-1-rand(1800);record(assess('true early without return',part,full(part,[[left,'出']]),1));
     }else{
      const n=2+rand(22),times=new Set([e-1800,e-780,e]);while(times.size<n+1)times.add(e-1800+rand(1801));
      const rows=[];for(const s of [...times].sort((a,b)=>a-b)){if(s===e){rows.push([s,'出']);break}rows.push([s,'出'],[s,'进'])}
      record(assess('same-second returns and proper terminal',part,full(part,rows),0));
     }
    }return summary;
   },batch);
   for(const [key,g] of Object.entries(summary)){const total=groups[key]??={cases:0,failed:0,rawMutations:0,maxPunches:0,byShift:{am:0,pm:0},withheldAsSuspect:0,examples:[]};for(const field of ['cases','failed','rawMutations','withheldAsSuspect'])total[field]+=g[field];for(const part of ['am','pm'])total.byShift[part]+=g.byShift[part];total.maxPunches=Math.max(total.maxPunches,g.maxPunches);total.examples.push(...g.examples);total.examples=total.examples.slice(0,3)}
  }
  const sweeps=await page.evaluate(()=>{
   const {end,full,assess}=boundary,result={cases:0,failed:0,examples:[],byShift:{am:0,pm:0}};
   for(const part of ['am','pm'])for(const [limit,grace] of [[10,2],[5,1],[0,0],[20,5]])for(let gap=1;gap<=1801;gap++){
    const e=end(part),left=e-1,r=assess('configured return boundary sweep',part,full(part,[[left,'出'],[left+gap,'进'],[left+gap+1,'出']]),left+gap<=e||gap<=60*(limit+grace)?0:1,{rules:{tempOutingMinutes:limit,tempOutingGraceMinutes:grace}});
    result.cases++;result.byShift[part]++;if(!r.pass){result.failed++;if(result.examples.length<6)result.examples.push(r)}
   }return result;
  });
  const indexed=await page.evaluate(()=>{
   const {end,full,run,person}=boundary;
   return ['am','pm'].every(part=>[0,30,600,601].every(delta=>{
    const e=end(part),rows=full(part,[[e-120,'出'],[e+delta,'进'],[e+delta+1,'出']]),direct=run(rows,part),before=JSON.stringify(state.records);reanalyze();
    const a=state.analysis.get(person.id+'|8'),flags=a.attendanceFlags.filter(f=>f.kind==='early'&&(part==='am'?f.label==='上午早退':f.label==='早退')).map(f=>({label:f.label,time:f.time}));
    return JSON.stringify(flags)===JSON.stringify(direct.early)&&JSON.stringify(state.records)===before;
   }));
  });
  const knownCases=targeted.filter(r=>r.label.includes('unrelated night')),
   report={version:await page.evaluate(()=>P109_APP_REVISION),targeted,groups,sweeps,indexed,knownFailures:knownCases.filter(r=>!r.pass),errors};
  fs.writeFileSync(path.join(out,'shift-end-stress.json'),JSON.stringify(report,null,2));
  assert(targeted.every(r=>r.pass),'targeted shift-end contract including remote-orphan regressions');assert(Object.values(groups).every(g=>g.failed===0&&g.rawMutations===0&&g.maxPunches<=50),'random shift-end contract');
  assert(sweeps.failed===0,'second-resolution configurable boundary');assert(indexed,'full reanalysis agrees with direct day analysis');assert(!errors.length,'runtime errors');
  console.log('P109_SHIFT_END_STRESS_PASS '+JSON.stringify({random:6000,seconds:sweeps.cases,targeted:targeted.length,maxPunches:Math.max(...Object.values(groups).map(g=>g.maxPunches)),knownDiagnosticFailures:report.knownFailures.length}));
  if(report.knownFailures.length)console.log('P109_SHIFT_END_KNOWN_ISSUES '+JSON.stringify(report.knownFailures.map(r=>({case:r.label,shift:r.part,expectedEarly:r.expected,actualEarly:r.actual.early.length,severity:r.actual.severity}))));
 }finally{await context.close()}
};
