'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),errors=[],remote=[],report={checks:[],geometry:[]};
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};let accept=true;
 page.on('dialog',d=>accept?d.accept():d.dismiss());page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 const confirmed=async()=>{await page.locator('#p109CalendarConfirm').click();await page.waitForFunction(()=>!p109CalendarUI.saving)};
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  await page.evaluate(()=>{p109BlankWork();p109OpenCalendar()});
  const initial=await page.evaluate(()=>({month:monthKey(),stores:state.monthStores.size,records:JSON.stringify(state.records)}));
  await confirmed();check(await page.evaluate(()=>state.saved&&!state.projectDir&&!state.revisions.length),'confirming current calendar in empty Work creates no unsaved business edits');
  await page.locator('#p109CalendarYearNext').click();await page.locator('#p109CalendarYearNext').click();await page.locator('#p109CalendarMonth').selectOption('2');
  check(await page.locator('[data-calendar-date]').count()===29&&await page.locator('#p109CalendarYear').innerText()==='2028 年','year arrows and month dropdown handle leap February');
  await page.locator('[data-calendar-date="2028-02-01"]').click();await page.locator('[data-calendar-date="2028-02-02"]').click();await page.locator('[data-calendar-set="rest"]').click();
  check(await page.evaluate(()=>p109CalendarUI.dirty&&!p109FixedCalendar.months['2028-02']),'batch edits remain a draft before confirmation');
  check(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});p109BeforeUnload(e);return e.defaultPrevented}),'unconfirmed independent calendar has close protection');
  accept=false;await page.locator('#p109CalendarYearPrev').click();check(await page.locator('#p109CalendarYear').innerText()==='2028 年','cancel year navigation preserves unsaved draft');accept=true;
  await confirmed();
  check(await page.evaluate(()=>!state.projectDir&&!p109CalendarUI.dirty&&p109FixedCalendar.months['2028-02']['2028-02-01']==='rest'),'calendar confirms without any project');
  check(await page.evaluate(initial=>monthKey()===initial.month&&state.monthStores.size===initial.stores&&JSON.stringify(state.records)===initial.records,initial),'future calendar creates no business month or records');
  await page.screenshot({path:path.join(out,'r91-calendar.png')});
  // Force the independent IndexedDB path, leaving an older localStorage value.
  await page.evaluate(()=>{window.__r91Set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===P109_CALENDAR_KEY)throw Error('fixture');return __r91Set.call(this,k,v)}});
  await page.locator('#p109CalendarMonth').selectOption('3');await page.locator('[data-calendar-date="2028-03-01"]').click();await page.locator('[data-calendar-set="rest"]').click();await confirmed();
  check(await page.evaluate(()=>p109FixedCalendar.months['2028-03']['2028-03-01']==='rest'&&!JSON.parse(localStorage.getItem(P109_CALENDAR_KEY)).months['2028-03']),'IndexedDB saves when localStorage writes fail');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>p109FixedCalendar.months['2028-02']['2028-02-01']==='rest'&&p109FixedCalendar.months['2028-03']['2028-03-01']==='rest'),'reopening chooses newer IndexedDB over stale localStorage');
  if(await page.locator('#r80Demo').isVisible())await page.locator('#r80Demo').click();
  await page.evaluate(()=>{p109CalendarSelect('2028-02');p109OpenCalendar()});
  await page.locator('#p109CalendarWeekdays').click();check(await page.evaluate(()=>p109CalendarUI.draft['2028-02-01']==='work'&&p109CalendarUI.dirty),'weekday reset ignores previously fixed holidays');
  await page.evaluate(()=>{window.__r91Db=p109CalendarDb;p109CalendarDb=async()=>{throw Error('fixture')}});await confirmed();
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem(P109_CALENDAR_KEY)).months['2028-02']['2028-02-01']==='work'),'localStorage saves when IndexedDB fails');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>p109FixedCalendar.months['2028-02']['2028-02-01']==='work'),'newer localStorage survives stale IndexedDB on reopen');
  if(await page.locator('#r80Demo').isVisible())await page.locator('#r80Demo').click();
  await page.evaluate(()=>{p109CalendarSelect('2028-03');p109OpenCalendar()});
  const downloadPromise=page.waitForEvent('download');await page.locator('#p109CalendarExport').click();const download=await downloadPromise,exported=fs.readFileSync(await download.path(),'utf8'),book=JSON.parse(exported);
  check(book.schemaVersion===1&&Object.keys(book.months).length===3,'export contains all saved independent months');
  const beforeBook=await page.evaluate(()=>JSON.stringify(p109FixedCalendar));
  for(const bad of [{...book,schemaVersion:2},{...book,months:{'2028-02':{'2028-02-31':'work'}}},{...book,months:{'2028-03':{...book.months['2028-03'],'2028-03-01':'holiday'}}}]){
   check(!await page.evaluate(async value=>p109ImportCalendar(new File([JSON.stringify(value)],'invalid.json')),bad),'malformed calendar is rejected');
   check(await page.evaluate(()=>JSON.stringify(p109FixedCalendar))===beforeBook,'invalid import is atomic');
  }
  accept=false;check(!await page.evaluate(async value=>p109ImportCalendar(new File([value],'calendar.json')),exported),'calendar import supports cancellation');accept=true;
  // Import into a different browser context, as when moving the program directory.
  const other=await browser.newContext(),otherPage=await other.newPage();otherPage.on('dialog',d=>d.accept());
  try{await otherPage.goto(pathToFileURL(path.join(root,'index.html')).href);await otherPage.evaluate(()=>p109RecentReady);await otherPage.locator('#r80Demo').click();await otherPage.evaluate(()=>p109OpenCalendar());
   await otherPage.locator('#p109CalendarFile').setInputFiles({name:'calendar.json',mimeType:'application/json',buffer:Buffer.from(exported)});await otherPage.waitForFunction(()=>!p109CalendarUI.saving&&!!p109FixedCalendar.months['2028-03']);
   check(await otherPage.evaluate(()=>p109FixedCalendar.months['2028-03']['2028-03-01']==='rest'&&!state.projectDir),'real file input restores calendar into another browser profile without project');
  }finally{await other.close()}
  await page.evaluate(()=>{window.__r91Db=p109CalendarDb;window.__r91Set=Storage.prototype.setItem;p109CalendarDb=async()=>{throw Error('fixture')};Storage.prototype.setItem=function(k,v){if(k===P109_CALENDAR_KEY)throw Error('fixture');return __r91Set.call(this,k,v)}});
  await page.locator('[data-calendar-date="2028-03-02"]').click();await page.locator('[data-calendar-set="rest"]').click();
  const fallbackPromise=page.waitForEvent('download');await confirmed();const fallback=await fallbackPromise,fallbackBook=JSON.parse(fs.readFileSync(await fallback.path(),'utf8'));
  check(fallbackBook.months['2028-03']['2028-03-02']==='rest'&&await page.evaluate(()=>p109CalendarType('2028-03-02')==='rest'&&p109CalendarUI.dirty&&p109CalendarUI.status.includes('无法持久保存')),'both storage failures still apply calendar in memory, download backup and retain unsaved status');
  const fallbackImportPromise=page.waitForEvent('download');check(await page.evaluate(async value=>p109ImportCalendar(new File([value],'calendar.json')),exported),'calendar file can still load and work when all browser storage is blocked');await fallbackImportPromise;
  await page.evaluate(()=>{p109CalendarDb=__r91Db;Storage.prototype.setItem=__r91Set;p109CalendarUI.dirty=false;
   switchMonth(2028,3,true);window.__r91Payload=workingPayload();window.__r91Default=dayType(1);
  });
  check(await page.evaluate(()=>__r91Default==='rest'&&Object.keys(__r91Payload.calendarOverrides).length===31),'new business month uses fixed calendar and payload captures every date');
  check(await page.evaluate(()=>{state.snapshotContext=true;state.calendarOverrides={};return dayType(1)==='work'&&workingPayload().calendarOverrides['2028-03-01']==='work'}),'legacy snapshot with sparse calendar uses its original weekday baseline');
  await page.evaluate(()=>{p109CalendarSelect('2028-03');state.saved=true;window.__r91Before=JSON.stringify(state.calendarOverrides)});await confirmed();
  check(await page.evaluate(()=>state.saved&&JSON.stringify(state.calendarOverrides)===__r91Before&&dayType(1)==='work'),'confirming default calendar leaves active snapshot facts unchanged');
  await page.evaluate(()=>{state.snapshotContext=false;state.activeBranch={id:'branch-fixture',month:'2028-03'};p109CalendarSelect('2028-03');state.saved=true});await confirmed();
  check(await page.evaluate(()=>state.saved&&dayType(1)==='work'),'revision branch also retains its original calendar');
  check(await page.evaluate(async()=>{
   state.activeBranch=null;state.snapshotContext=false;state.calendarOverrides={};state.projectDir=p109MemoryRoot('日历核查项目');
   p109FixedCalendar.months['2028-04']=p109CalendarMonthValues(2028,4,{},false);p109FixedCalendar.months['2028-04']['2028-04-03']='rest';
   await freezeSnapshot();const snapshots=await existingDir(await monthDirectory(),'snapshots'),entries=await p109Entries(snapshots),file=await p109File(await existingDir(snapshots,entries[0].name),'snapshot.json'),bytes=await(await file.getFile()).text(),snapshot=JSON.parse(bytes);
   p109FixedCalendar.months['2028-04']['2028-04-03']='work';state.calendarOverrides=snapshot.working.calendarOverrides;state.snapshotContext=true;
   return !attendanceDateIsWork('2028-04-03')&&snapshot.config.calendarOverrides['2028-04-03']==='rest'&&bytes===await(await file.getFile()).text()&&workingPayload().calendarOverrides['2028-04-03']==='rest';
  }),'real freeze captures adjacent calendars and stays byte-identical after defaults change');
  await page.evaluate(()=>{
   YEAR=2026;MONTH=10;EMPLOYEES=[{id:'r91-person',name:'核查人员'}];Object.assign(RULES,P109_DEFAULT_RULES);
   Object.assign(state,{isDemo:false,projectDir:null,activeBranch:null,snapshotContext:false,records:[['09:01','进'],['10:00','出'],['10:20','进'],['17:00','出'],['18:00','进'],['19:00','出']].map(([time,direction],i)=>({recordId:'r91-'+i,employeeId:'r91-person',name:'核查人员',datetime:'2026-10-08 '+time,time,direction})),leaves:[],trips:[],outings:[],overtimeEntries:[],manualTempOutings:[],manualOvertime:[],manualStatuses:{},attendanceReview:{},tempOutingReview:{},overtimeReview:{},calendarOverrides:{},groups:{'r91-person':'核查组'},selection:{type:'cell',employeeId:'r91-person',day:8},workspaceMode:'person',chartDay:8,chartTab:'timeline',timelineRange:null});reanalyze();render();
  });
  await page.waitForSelector('[data-attendance-id]');
  const tag=page.locator('[data-attendance-id]').first();await tag.hover();
  check(await page.evaluate(()=>{const a=document.querySelector('[data-attendance-id] button').getBoundingClientRect(),b=document.getElementById('r73FloatingTip').getBoundingClientRect();return a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom}),'late tooltip does not overlap outside review button');
  await page.screenshot({path:path.join(out,'r91-tooltip.png')});await tag.locator('button').hover();
  check(await page.evaluate(()=>!document.getElementById('r73FloatingTip').classList.contains('is-visible')),'tooltip hides while pointer uses x');
  await tag.locator('button').click();await page.locator('[data-attendance-id].is-excluded').focus();await page.locator('[data-attendance-id].is-excluded button').click();
  check(await page.evaluate(()=>!Object.values(state.attendanceReview).some(v=>v===false)),'x and restore still update actual attendance review');
  for(const width of [1280,1366,1440,1600,1920]){
   await page.setViewportSize({width,height:width===1280?720:900});await page.evaluate(()=>render());await page.waitForSelector('.p109-temp-actions');
   const g=await page.evaluate(()=>{
    const cols=[...document.querySelectorAll('.p109-metric-column')].map(n=>n.getBoundingClientRect()),inspector=document.querySelector('.inspector-insight'),chart=document.getElementById('attendanceTimelineChart').getBoundingClientRect();
    return {width:innerWidth,gap:cols[1].left-cols[0].right,size:[inspector.scrollHeight,inspector.clientHeight,inspector.scrollWidth,inspector.clientWidth],details:[...inspector.querySelectorAll('.r74-unified-insight,.r74-insight-section,.p109-temp-summary,.p109-temp-details')].map(n=>({cls:n.className,rect:n.getBoundingClientRect().toJSON(),css:[getComputedStyle(n).padding,getComputedStyle(n).margin,getComputedStyle(n).height,getComputedStyle(n).minHeight]})),fit:inspector.scrollHeight<=inspector.clientHeight+1&&inspector.scrollWidth<=inspector.clientWidth+1,
     actions:[...document.querySelectorAll('.p109-temp-actions,.overtime-review-actions')].map(n=>{const b=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return {placement:n.dataset.placement,outside:n.dataset.placement==='right'?b.left>=p.left+Number(n.dataset.bandRight)+5:b.bottom<=p.top+Number(n.dataset.bandTop)-5,fit:b.left>=chart.left&&b.right<=chart.right+1}})};
   });report.geometry.push(g);
   check(g.gap>=23&&g.fit,'inspector has separated columns without overflow '+width+' '+JSON.stringify(g));
   check(g.actions.length>=2&&g.actions.every(x=>x.outside&&x.fit),'interval controls sit outside bands and within chart '+width);
  }
  await page.setViewportSize({width:1600,height:900});await page.evaluate(()=>render());
  // Move from real chart evidence across the small gap into the external toolbar.
  for(const [minute,lane,selector] of [[610,4,'.p109-temp-actions[data-temp-id*="r91-1"] .red'],[1110,5,'.overtime-review-actions button[aria-pressed="false"]']]){
   await page.waitForFunction(()=>!!echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'))&&document.querySelector('.p109-temp-actions'));
   const point=await page.evaluate(({minute,lane})=>{const el=document.getElementById('attendanceTimelineChart'),c=echarts.getInstanceByDom(el),p=c.convertToPixel({xAxisIndex:0,yAxisIndex:0},[minute,lane]),r=el.getBoundingClientRect();return {x:r.left+p[0],y:r.top+p[1]-(lane===4?7:0)}},{minute,lane});
   await page.mouse.move(point.x,point.y);await page.waitForFunction(selector=>+getComputedStyle(document.querySelector(selector).parentElement).opacity>.95,selector);
   const b=await page.locator(selector).boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});
   await page.screenshot({path:path.join(out,lane===4?'r91-outing-actions.png':'r91-overtime-actions.png')});
   await page.locator(selector).click();check(true,'real pointer reaches external action '+lane);
  }
  check(await page.evaluate(()=>Object.values(state.tempOutingReview).includes('red')&&Object.values(state.overtimeReview).includes(false)),'external actions update outing and overtime decisions');
  await page.evaluate(()=>{state.timelineRange={key:'r91-person|8',start:590,end:620};render()});await page.waitForSelector('.p109-temp-actions[data-placement="above"]');
  check(await page.locator('.p109-temp-actions').evaluate(n=>n.offsetTop+n.offsetHeight<=Number(n.dataset.bandTop)-5&&n.offsetLeft+n.offsetWidth<=n.parentElement.clientWidth-64),'zoom edge falls above band without covering it or track labels');
  await page.locator('.p109-temp-actions .green').focus();
  await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')).setOption({animation:false}));
  check(await page.locator('.p109-temp-actions .green').evaluate(n=>n===document.activeElement),'keyboard focus survives chart redraw at zoom edge');
  await page.waitForFunction(()=>+getComputedStyle(document.querySelector('.p109-temp-actions')).opacity>.95);await page.screenshot({path:path.join(out,'r91-edge-actions.png')});
  await page.locator('.p109-temp-actions .green').focus();await page.locator('.p109-temp-actions .green').click();
  await page.evaluate(()=>{state.timelineRange=null;render()});await page.screenshot({path:path.join(out,'r91-person.png')});
  check(!errors.length&&!remote.length,'no script errors or runtime network requests');report.errors=errors;
  fs.writeFileSync(path.join(out,'r91-audit.json'),JSON.stringify(report,null,2));console.log('P109_R91_AUDIT_PASS '+JSON.stringify({checks:report.checks.length,geometry:report.geometry.length}));
 }catch(error){fs.writeFileSync(path.join(out,'r91-failure.json'),JSON.stringify({error:error.stack,report,errors},null,2));await page.screenshot({path:path.join(out,'r91-failure.png')});throw error}finally{await context.close()}
};
