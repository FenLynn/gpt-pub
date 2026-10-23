'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={revision:'R89',checks:[],geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Demo').isVisible(),'normal mode entry opens directly without activation');await page.locator('#r80Demo').click();
  for(const width of [1280,1366,1440,1600,1920])for(const mode of ['all','group']){
   await page.setViewportSize({width,height:width===1366?768:900});await page.evaluate(mode=>navigateWorkspace(mode),mode);
   const geometry=await page.evaluate(()=>{
    const a=document.querySelector('.workspace-toolbar strong').getBoundingClientRect(),b=document.querySelector('.r71-insights-heading h3').getBoundingClientRect(),
     buttons=['importBtn','exportMenuButton','projectMenuButton','saveBtn'].map(id=>({id,r:document.getElementById(id).getBoundingClientRect().toJSON()})),
     matrix=document.querySelector('.matrix-wrap');return {mode:state.workspaceMode,width:innerWidth,headingError:Math.abs(a.y-b.y),buttons,overflow:document.documentElement.scrollWidth>innerWidth+1,
      rankHeight:document.querySelector('.r71-insights-rank').getBoundingClientRect().height,matrix:matrix.getBoundingClientRect().bottom<=innerHeight+1};
   });report.geometry.push(geometry);
   check(geometry.headingError<1.5&&!geometry.overflow&&geometry.matrix&&geometry.rankHeight>150,'aligned titles and usable overview at '+mode+'/'+width+': '+JSON.stringify(geometry));
   check(geometry.buttons.every((b,i,all)=>i===0||b.r.left>=all[i-1].r.right-1)&&geometry.buttons[3].r.width<60&&geometry.buttons[3].r.height<=30,'Import Export Project Save order and compact save: '+mode+'/'+width);
  }
  await page.setViewportSize({width:1600,height:900});await page.evaluate(()=>navigateWorkspace('all'));await page.screenshot({path:path.join(out,'r89-overview.png')});
  const facts=await page.evaluate(()=>{
   const e={id:personIdentity('核查甲'),name:'核查甲',department:'核查组'},date='2026-10-08';window.__r89Employee=e;
   window.__r89Seed=events=>{
    YEAR=2026;MONTH=10;EMPLOYEES=[{...e}];Object.assign(RULES,P109_DEFAULT_RULES);
    Object.assign(state,{records:events.map(([time,direction],i)=>({recordId:'r89:'+i,employeeId:e.id,name:e.name,time,direction,datetime:date+' '+time})),
     leaves:[],trips:[],outings:[],overtimeEntries:[],manualTempOutings:[],manualOvertime:[],attendanceReview:{},tempOutingReview:{},overtimeReview:{},manualStatuses:{},
     revisions:[],revisionSeq:0,imports:[],monthStores:new Map(),projectDir:null,projectProfile:null,isDemo:false,calendarOverrides:{},groups:{[e.id]:'核查组'},groupCatalog:['核查组'],fixedPeople:[e.id]});
    reanalyze();return state.analysis.get(e.id+'|8');
   };
   window.__r89Show=()=>{Object.assign(state,{workspaceMode:'person',selection:{type:'cell',employeeId:e.id,day:8},chartDay:8,chartTab:'timeline',timelineRange:null,filter:'main'});render()};
   const result={};let a=__r89Seed([['08:45','进'],['11:40','出'],['13:40','进'],['17:00','出']]);
   const before=JSON.stringify(state.records),work=a.workMinutes,late=a.attendanceFlags.find(f=>f.label==='迟到');
   p109SetAttendanceDecision(late.id,false);a=state.analysis.get(e.id+'|8');
   result.independentFlags=late&&a.attendanceFlags.length===3&&activeAttendanceFlags(a).length===2&&attendanceJudgment(a)==='anomaly';
   result.ledgerUsesFlags=asStatValue(asStatLedger(),'status','late',[e],[8])===1;
   for(const flag of [...a.attendanceFlags])p109SetAttendanceDecision(flag.id,false);a=state.analysis.get(e.id+'|8');
   result.excludeAll=attendanceJudgment(a)==='normal'&&attendanceJudgmentSystem(a)==='anomaly'&&!attendanceHasLateEarly(a)&&asStatValue(asStatLedger(),'status','late',[e],[8])===0&&asStatValue(asStatLedger(),'status','early',[e],[8])===0;
   result.sourceUnchanged=JSON.stringify(state.records)===before&&a.workMinutes===work&&traditionalRows().find(r=>r.日期===date).迟到早退排除次数===3;
   state.manualStatuses[e.id+'|8']='anomaly';result.dayOverrideWins=attendanceJudgment(a)==='anomaly';delete state.manualStatuses[e.id+'|8'];
   __r89Show();setManualStatusForCurrent('absent');setManualStatusForCurrent('normal');
   result.returnToNormal=attendanceJudgment(state.analysis.get(e.id+'|8'))==='normal'&&Object.values(state.attendanceReview).filter(v=>v===false).length===3;
   delete state.manualStatuses[e.id+'|8'];
   __r89Show();result.grayDot=document.querySelector('[data-person-day="8"]').classList.contains('has-excluded-attendance');
   p109SetAttendanceDecision(late.id,true);result.restore=activeAttendanceFlags(state.analysis.get(e.id+'|8')).length===1;
   a=__r89Seed([['08:45','进'],['09:00','进'],['17:10','出']]);p109SetAttendanceDecision(a.attendanceFlags[0].id,false);
   result.otherIssueStays=attendanceJudgment(state.analysis.get(e.id+'|8'))==='anomaly';
   a=__r89Seed([['08:45','进'],['17:10','出']]);p109SetAttendanceDecision(a.attendanceFlags[0].id,false);__r89Show();setManualStatusForCurrent(null);
   result.initialRestoresFlags=activeAttendanceFlags(state.analysis.get(e.id+'|8')).length===1;
   a=__r89Seed([['08:25','进'],['11:30','出'],['13:45','进'],['17:10','出']]);const parts=a.temporaryOutings;
   result.split=parts.length===2&&parts[0].minutes===10&&parts[1].minutes===15&&parts[0].status==='green'&&parts[1].status==='red'&&p109TempSummary([a]).minutes===25;
   state.tempOutingReview[parts[0].parentId]='red';reanalyze();p109SetTempDecision(parts[0].id,'green');a=state.analysis.get(e.id+'|8');
   result.oldChoiceInherited=a.temporaryOutings[0].status==='green'&&a.temporaryOutings[1].status==='red';
   p109SetTempDecision(parts[0].id,'exclude');a=state.analysis.get(e.id+'|8');result.splitExclusion=p109TempSummary([a]).count===1&&p109TempSummary([a]).minutes===15&&a.temporaryOutings[0].status==='exclude';
   state.outings=[{id:'r',employeeId:e.id,startDate:date,endDate:date,start:'13:35',end:'13:50'}];state.tempOutingReview={};reanalyze();a=state.analysis.get(e.id+'|8');
   result.reportScoped=a.temporaryOutings[1].status==='green';
   const original={schemaVersion:3,year:2026,month:10,records:[],employees:[e],calendarOverrides:{'2026-10-01':'holiday','2026-10-10':'adjusted-work'},
    manualTempOutings:[{id:'legacy',employeeId:e.id,date,start:'11:30',end:'13:45'}],tempOutingReview:{legacy:'red'},revisions:[{id:'R1',segmentId:'legacy'}]};
   const originalBytes=JSON.stringify(original),old=normalizeSavedMonth(original);
   result.legacyMigration=old.manualTempOutings.length===2&&old.tempOutingReview['legacy:am']==='red'&&old.tempOutingReview['legacy:pm']==='red'&&old.calendarOverrides['2026-10-01']==='rest'&&old.calendarOverrides['2026-10-10']==='work'&&JSON.stringify(original)===originalBytes;
   result.rejectBad=normalizeSavedMonth({schemaVersion:4,records:[],attendanceReview:{bad:'false'}})===null;
   __r89Seed([['08:45','进'],['17:00','出']]);__r89Show();result.twoCalendarTypes=dayType(1)==='work'&&dayType(10)==='rest'&&new Set(Array.from({length:31},(_,i)=>dayType(i+1))).size===2;
   return result;
  });for(const [name,value] of Object.entries(facts))check(value,'facts and compatibility: '+name);
  await page.waitForSelector('[data-attendance-id]');await page.locator('[data-attendance-id]').first().hover();await page.locator('[data-attendance-id] button').first().click();
  check(await page.locator('[data-attendance-id].is-excluded').count()===1,'actual attendance x leaves a gray recoverable tag');
  await page.locator('[data-attendance-id].is-excluded').hover();await page.locator('[data-attendance-id].is-excluded button').click();
  check(await page.locator('[data-attendance-id].is-excluded').count()===0,'actual gray tag check restores inclusion');
  const dot=await page.locator('[data-person-day="8"]').evaluate(n=>getComputedStyle(n,'::before').backgroundColor);check(dot==='rgb(66, 137, 197)','date marker is blue and separate from pink overtime');
  await page.evaluate(()=>p109OpenIntervalEditor('outing',__r89Employee.id,'2026-10-08'));
  await page.locator('#p109IntervalStart').fill('11:30');await page.locator('#p109IntervalEnd').fill('13:45');await page.locator('.p109-interval-dialog [type=submit]').click();
  const manual=await page.evaluate(()=>state.manualTempOutings.map(r=>r.id));check(manual.length===2,'manual noon interval is stored as independently editable halves');
  await page.evaluate(async()=>{state.projectDir=p109MemoryRoot('核查项目');await freezeSnapshot();const snapshots=await existingDir(await monthDirectory(),'snapshots'),entries=await p109Entries(snapshots);window.__r89Frozen=await p109File(await existingDir(snapshots,entries[0].name),'snapshot.json');window.__r89FrozenBytes=await(await __r89Frozen.getFile()).text()});
  const selected=page.locator('.p109-temp-actions[data-temp-id="'+manual[0]+'"]');await selected.locator('.red').focus();await selected.locator('.red').click();await selected.locator('.exclude').focus();await selected.locator('.exclude').click();
  check(await page.evaluate(id=>state.manualTempOutings.length===1&&!JSON.stringify(workingPayload()).includes(id),manual[0]),'deleting one manual half leaves its sibling and removes only its own working trace');
  check(await page.evaluate(async()=>__r89FrozenBytes===await(await __r89Frozen.getFile()).text()),'old frozen file is byte-identical after review and deletion');
  await page.locator('[data-attendance-id]').first().hover();await page.locator('[data-attendance-id] button').first().click();
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1600,height:900}]){
   await page.setViewportSize(size);await page.evaluate(()=>render());
   const compact=await page.evaluate(()=>{const n=document.querySelector('.inspector-insight');return {client:n.clientHeight,scroll:n.scrollHeight,text:n.innerText}});
   check(compact.scroll<=compact.client+1&&!compact.text.includes('待核')&&!compact.text.includes('班次内 ·')&&!compact.text.includes('加班判断：'),'compact inspector fits common viewport: '+JSON.stringify(size)+' '+JSON.stringify(compact));
  }
  await page.screenshot({path:path.join(out,'r89-person-review.png')});
  const zip=await page.evaluate(async()=>{state.projectDir=null;const files=await p109PortableCollect(await p109PortableFromSession()),result=await p109ZipBuild(files);return [...new Uint8Array(await result.zip.arrayBuffer())]});
  await page.reload();await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  check(await page.evaluate(async bytes=>p109OpenPortableFile(new File([Uint8Array.from(bytes)],'review.zip')),zip),'complete project ZIP reopens after page reload');
  check(await page.evaluate(()=>state.manualTempOutings.length===1&&Object.values(state.attendanceReview).filter(v=>v===false).length===1&&state.analysis.get(EMPLOYEES[0].id+'|8').attendanceFlags.some(f=>!f.accepted)),'reload retains independent manual half and attendance exclusions');
  await page.evaluate(()=>{navigateWorkspace('data');state.dataSection='rules';render()});await page.locator('[data-calendar-editor]').click();
  await page.locator('[data-calendar-date="2026-10-08"]').click();await page.keyboard.press('Escape');check(await page.evaluate(()=>dayType(8)==='work'),'canceling the calendar leaves the month unchanged');
  await page.locator('[data-calendar-editor]').click();await page.locator('[data-calendar-date="2026-10-08"]').click();await page.locator('[data-calendar-date="2026-10-10"]').click();await page.locator('#p109CalendarApply').click();
  check(await page.evaluate(()=>dayType(8)==='rest'&&dayType(10)==='work'&&!state.saved&&state.analysis.get(EMPLOYEES[0].id+'|8').temporaryOutings.length===0),'applying the month calendar changes eligibility and marks work unsaved');
  check(await page.evaluate(()=>{switchMonth(2026,11,true);const answer=dayType(1)==='rest'&&dayType(2)==='work'&&!attendanceDateIsWork('2026-10-08');switchMonth(2026,10);return answer&&dayType(8)==='rest'&&dayType(10)==='work'}),'new month defaults to weekdays and adjacent overtime reads the owning month calendar');
  await page.locator('[data-calendar-editor]').click();await page.screenshot({path:path.join(out,'r89-calendar.png')});await page.keyboard.press('Escape');
  check(!errors.length&&!remote.length,'no script exceptions or remote requests');
  fs.writeFileSync(path.join(out,'r89-audit.json'),JSON.stringify(report,null,2));console.log('P109_R89_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(error){fs.writeFileSync(path.join(out,'r89-failure.json'),JSON.stringify({error:error.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r89-failure.png')});throw error}finally{await context.close()}
};
