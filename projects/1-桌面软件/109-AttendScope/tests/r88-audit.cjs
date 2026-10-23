'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={revision:'R88',checks:[],geometry:[]};
 const check=(v,label)=>{assert(v,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  for(const width of [1280,1366,1600,1920]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>render());
   const geometry=await page.evaluate(()=>{
    const metrics=[...document.querySelectorAll('.r71-scope-metrics strong')].map(n=>{const r=n.getBoundingClientRect();return {y:r.top+r.height/2,width:r.width,container:n.parentElement.clientWidth}}),
     chart=echarts.getInstanceByDom(document.getElementById('scopeDailyChart')),series=chart.getOption().series[0];
    return {width:innerWidth,metrics,columns:getComputedStyle(document.querySelector('.r71-scope-metrics')).gridTemplateColumns.split(' ').length,
     trend:{size:series.symbolSize,fill:series.itemStyle.color,border:series.itemStyle.borderWidth,gradient:series.areaStyle.color.colorStops},
     bars:[...document.querySelectorAll('.r68-rank-track')].map(n=>n.getBoundingClientRect().height),sidebarCard:!!document.querySelector('.sidebar .p109-temp-summary'),
     overflow:document.documentElement.scrollWidth>innerWidth+1};
   });
   report.geometry.push(geometry);
   check(geometry.columns===4&&geometry.metrics.length===4&&Math.max(...geometry.metrics.map(n=>n.y))-Math.min(...geometry.metrics.map(n=>n.y))<1.5&&geometry.metrics.every(n=>n.width<=n.container+1)&&!geometry.overflow,'four overview totals share one row without overflow: '+JSON.stringify(geometry));
   check(geometry.trend.size>=8&&geometry.trend.fill==='#fff'&&geometry.trend.border>=2&&geometry.trend.gradient.length===2&&geometry.trend.gradient[1].color.endsWith(',0)')&&geometry.bars.every(h=>h>=10),'larger hollow trend markers, vertical shading and thicker ranking bars: '+width);
   check(!geometry.sidebarCard,'no bottom-left temporary card: '+width);
  }
  await page.setViewportSize({width:1280,height:900});
  for(const font of ['Arial Black','Microsoft YaHei','monospace']){
   const style=await page.addStyleTag({content:'.r71-scope-metrics{font-family:"'+font+'"!important}'});
   await page.locator('.r71-scope-metrics strong').last().evaluate(n=>n.textContent='100.0%');
   const metrics=await page.evaluate(()=>[...document.querySelectorAll('.r71-scope-metrics strong')].map(n=>{const r=n.getBoundingClientRect();return {y:r.top+r.height/2,width:r.width,container:n.parentElement.clientWidth}}));
   check(metrics.every(n=>n.width<=n.container+1)&&Math.max(...metrics.map(n=>n.y))-Math.min(...metrics.map(n=>n.y))<1.5,'widest percentage fits with fallback font: '+font+' '+JSON.stringify(metrics));
   await style.evaluate(n=>n.remove());
  }
  await page.setViewportSize({width:1600,height:900});await page.evaluate(()=>render());await page.screenshot({path:path.join(out,'r88-overview.png')});
  const logic=await page.evaluate(()=>{
   const e={id:personIdentity('验收甲'),name:'验收甲',department:'验收组'},date='2026-10-08';window.__r88Employee=e;
   window.__r88Seed=(events)=>{
    YEAR=2026;MONTH=10;EMPLOYEES=[{...e}];state.records=events.map(([time,direction],i)=>({recordId:'r88:'+i,employeeId:e.id,name:e.name,time,direction,datetime:date+' '+time}));
    state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];state.manualTempOutings=[];state.manualOvertime=[];state.tempOutingReview={};state.overtimeReview={};
    state.monthStores=new Map();state.revisions=[];state.revisionSeq=0;state.imports=[];state.projectDir=null;state.projectProfile=null;state.isDemo=false;
    state.groups={[e.id]:'验收组'};state.groupCatalog=['验收组'];state.fixedPeople=[e.id];state.calendarOverrides={};state.manualStatuses={};Object.assign(RULES,P109_DEFAULT_RULES);
    reanalyze();return state.analysis.get(e.id+'|8');
   };
   const checks={};let a=__r88Seed([['08:25','进'],['11:38','出'],['13:25','进'],['17:10','出']]);
   checks.shortEarlyNotDouble=a.attendanceFlags.some(f=>f.kind==='early')&&!a.temporaryOutings.length;
   a=__r88Seed([['08:25','进'],['11:28','出'],['13:25','进'],['17:10','出']]);
   checks.equalBoundaryRetained=a.temporaryOutings.length===1&&a.temporaryOutings[0].minutes===12;
   a=__r88Seed([['08:25','进'],['11:33','出'],['13:25','进'],['17:10','出']]);RULES.tempOutingMinutes=5;RULES.tempOutingGraceMinutes=1;reanalyze();
   checks.configuredBoundary=state.analysis.get(e.id+'|8').temporaryOutings.length===1;
   RULES.tempOutingGraceMinutes=3;reanalyze();checks.configuredGraceExcludes=!state.analysis.get(e.id+'|8').temporaryOutings.length;
   a=__r88Seed([['08:25','进'],['10:00','出'],['10:03','进'],['17:10','出']]);checks.midShiftPreserved=a.temporaryOutings.length===1&&a.temporaryOutings[0].minutes===3;
   a=__r88Seed([['11:38','出'],['13:25','进'],['17:10','出']]);checks.uncertainNotSuppressed=a.temporaryOutings.length===1&&!a.attendanceFlags.some(f=>f.kind==='early');
   __r88Seed([['08:25','进'],['11:38','出'],['13:25','进'],['17:10','出']]);
   state.manualTempOutings=[{id:'manual-temp:explicit',employeeId:e.id,date,start:'11:38',end:'13:25'}];reanalyze();
   checks.explicitManualRespected=activeTemporaryOutings(state.analysis.get(e.id+'|8')).length===1;
   const old={schemaVersion:3,employees:[e],records:[],manualTempOutings:[{id:'manual-temp:old',employeeId:e.id,date,start:'10:00',end:'10:20'}],
    manualOvertime:[{id:'manual-overtime:old',employeeId:e.id,date,start:'18:00',end:'19:00'}],
    tempOutingReview:{'manual-temp:old':'exclude','temp:auto':'exclude'},overtimeReview:{'manual-overtime:old':false,'auto:kept':false},
    revisions:[{segmentId:'manual-temp:old'},{segmentId:'manual-overtime:old'},{segmentId:'temp:auto'}]};
   const before=JSON.stringify(old),restored=normalizeSavedMonth(old);
   checks.oldManualExclusionsPruned=restored.manualTempOutings.length===0&&restored.manualOvertime.length===0&&restored.revisions.length===1&&!restored.saved;
   checks.autoExclusionsRetained=restored.tempOutingReview['temp:auto']==='exclude'&&restored.overtimeReview['auto:kept']===false&&JSON.stringify(old)===before;
   __r88Seed([['08:25','进'],['10:00','出'],['10:20','进'],['17:10','出']]);
   state.workspaceMode='person';state.selection={type:'cell',employeeId:e.id,day:8};state.chartDay=8;state.chartTab='timeline';state.filter='main';state.timelineRange=null;render();return checks;
  });
  for(const [key,value] of Object.entries(logic))check(value,'eligibility and old-state cleanup: '+key);
  await page.waitForFunction(()=>document.querySelectorAll('[data-interval-add]').length===2);
  for(const width of [1280,1366,1600]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>render());await page.waitForFunction(()=>document.querySelectorAll('[data-interval-add]').length===2);
   const geometry=await page.evaluate(()=>{
    const el=document.getElementById('attendanceTimelineChart'),labels=[...el.querySelectorAll('svg text')].filter(n=>['出差','请假','外出','加班'].includes(n.textContent)).map(n=>({text:n.textContent,r:n.getBoundingClientRect().toJSON()})),
     plus=[...document.querySelectorAll('[data-interval-add]')].map(n=>{const r=n.getBoundingClientRect(),label=labels.find(x=>x.text===(n.dataset.intervalAdd==='outing'?'外出':'加班'));return {leftOfLabel:r.right<=label.r.left-4,centerError:Math.abs(r.top+r.height/2-label.r.top-label.r.height/2)}}),
     controls=[...document.querySelectorAll('.p109-temp-actions,.overtime-review-actions')].map(n=>{const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return Math.abs(r.top+r.height/2-p.top-Number(n.dataset.anchorY))}),
     icons=[...document.querySelectorAll('.p109-temp-actions button,.overtime-review-btn,.p109-interval-add')].map(n=>{const a=n.getBoundingClientRect(),s=n.querySelector('svg').getBoundingClientRect();return Math.max(Math.abs(a.left+a.width/2-s.left-s.width/2),Math.abs(a.top+a.height/2-s.top-s.height/2))});
    return {width:innerWidth,labels,plus,controls,icons};
   });
   report.geometry.push(geometry);
   check(geometry.labels.length===4&&Math.max(...geometry.labels.map(n=>n.r.right))-Math.min(...geometry.labels.map(n=>n.r.right))<1.5&&geometry.plus.every(n=>n.leftOfLabel&&n.centerError<1.5),'track names align right and plus sits centered on their left: '+width);
   check(geometry.controls.every(n=>n<1.5)&&geometry.icons.every(n=>n<.8),'review toolbars and SVG symbols are centered: '+width);
  }
  const before=await page.locator('.insight-behavior-row.outing span').boundingBox();await page.evaluate(()=>{state.filter='outing';render()});
  const after=await page.locator('.insight-behavior-row.outing span').boundingBox();check(Math.abs(before.x-after.x)<.5&&Math.abs(before.y-after.y)<.5,'selected outing highlights without moving the label');
  await page.evaluate(()=>{state.filter='main';render()});
  for(const [kind,start,end] of [['outing','15:00','15:20'],['overtime','18:00','18:30']]){
   await page.locator('[data-interval-add="'+kind+'"]').focus();await page.locator('[data-interval-add="'+kind+'"]').click();
   await page.locator('#p109IntervalStart').fill(start);await page.locator('#p109IntervalEnd').fill(end);await page.locator('.p109-interval-dialog [type=submit]').click();
  }
  await page.evaluate(async()=>{
   state.projectDir=p109MemoryRoot('验收项目');await freezeSnapshot();const snapshots=await existingDir(await monthDirectory(),'snapshots'),entries=await p109Entries(snapshots);
   window.__r88Frozen=await p109File(await existingDir(snapshots,entries[0].name),'snapshot.json');window.__r88FrozenBytes=await(await __r88Frozen.getFile()).text();
  });
  const ids=await page.evaluate(()=>({temp:state.manualTempOutings[0].id,overtime:state.manualOvertime[0].id}));
  const temp=page.locator('.p109-temp-actions').filter({has:page.locator('button[title^="删除补录"]')});
  await temp.locator('.green').focus();await temp.locator('.green').click();await temp.locator('.exclude').focus();await temp.locator('.exclude').click();
  check(await page.evaluate(id=>!state.manualTempOutings.length&&!JSON.stringify(workingPayload()).includes(id),ids.temp),'manual outing x removes fact, decisions and working history without ghost bands');
  const overtime=page.locator('.overtime-review-actions[data-origin="manual"]');await overtime.locator('button').focus();await overtime.locator('button').click();
  check(await page.evaluate(id=>!state.manualOvertime.length&&!JSON.stringify(workingPayload()).includes(id),ids.overtime),'manual overtime x removes its fact and leaves no faded or empty toolbar');
  check(await page.evaluate(async()=>__r88FrozenBytes===await(await __r88Frozen.getFile()).text()),'manual deletion leaves previously frozen files byte-identical');
  const automatic=page.locator('.p109-temp-actions');await automatic.locator('.exclude').focus();await automatic.locator('.exclude').click();
  check(await page.evaluate(()=>state.analysis.get(EMPLOYEES[0].id+'|8').temporaryOutings[0].status==='exclude'&&p109TempSummary([...state.analysis.values()]).count===0&&state.records.length===4),'automatic outing exclusion retains evidence and removes only its statistics');
  await page.screenshot({path:path.join(out,'r88-timeline-clean-removal.png')});
  check(await page.evaluate(async()=>{
   state.projectDir=null;const files=await p109PortableCollect(await p109PortableFromSession()),{zip}=await p109ZipBuild(files);
   return await p109OpenPortableFile(new File([zip],'r88-deletions.zip'))&&!state.manualTempOutings.length&&!state.manualOvertime.length&&Object.values(state.tempOutingReview).includes('exclude');
  }),'complete ZIP reopens clean manual deletion and retained automatic evidence');
  check(await page.evaluate(()=>{
   const e=EMPLOYEES[0],id='manual-overtime:crossmonth';YEAR=2026;MONTH=10;state.monthStores=new Map();state.records=[];state.manualOvertime=[{id,employeeId:e.id,date:'2026-10-31',start:'23:00',end:'02:00'}];state.overtimeReview={};state.tempOutingReview={};state.manualTempOutings=[];state.saved=true;state.fixedPeople=[e.id];rememberMonth();switchMonth(2026,11,true);
   const visible=state.analysis.get(e.id+'|1').autoOvertime.segments.some(s=>s.id===id);setAutoOvertimeDecision(id,false);
   return visible&&state.monthStores.get('2026-10').manualOvertime.length===0&&!state.monthStores.get('2026-10').saved&&!state.analysis.get(e.id+'|1').autoOvertime.segments.some(s=>s.id===id);
  }),'deleting a next-month slice removes the owning month manual session and marks it dirty');
  check(!errors.length&&!remote.length,'no runtime exceptions or remote requests');
  fs.writeFileSync(path.join(out,'r88-audit.json'),JSON.stringify(report,null,2));console.log('P109_R88_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(e){
  fs.writeFileSync(path.join(out,'r88-failure.json'),JSON.stringify({error:e.message,report},null,2));
  await page.screenshot({path:path.join(out,'r88-failure.png')});throw e;
 }finally{await context.close()}
};
