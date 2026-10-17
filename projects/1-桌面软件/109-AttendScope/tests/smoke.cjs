/* AttendScope R13 acceptance: pure file:// Chromium, no remote dependencies. */
'use strict';
const path=require('path'),fs=require('fs'),{pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(process.cwd(),'p109-smoke-artifacts');
fs.mkdirSync(out,{recursive:true});
const url=process.env.P109_URL||pathToFileURL(path.join(root,'index.html')).href;
let browser,errors=[],remote=[];
async function check(page,expression,argOrDescription,maybeDescription){
  const hasArg=arguments.length>=4;
  const result=hasArg?await page.evaluate(expression,argOrDescription):await page.evaluate(expression);
  if(!result)throw Error(hasArg?maybeDescription:argOrDescription);
}
async function run(){
 browser=await chromium.launch({headless:true,...(process.env.CHROME_BIN?{executablePath:process.env.CHROME_BIN}:{channel:'chrome'})});
 const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push('page: '+e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
 page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 page.on('dialog',d=>d.type()==='prompt'?d.accept('科研创新组'):d.accept());
 await page.goto(url,{waitUntil:'load',timeout:60000});
 try{await page.waitForSelector('#overviewTrendChart svg',{timeout:20000})}catch(e){await page.screenshot({path:path.join(out,'r14-diagnostic.png')});console.error('R14_PAGE_ERRORS',JSON.stringify(errors));throw e}
 await page.waitForSelector('#rawDataTable .tabulator-row',{timeout:15000});
 const layout=await page.evaluate(()=>{
  const w=s=>document.querySelector(s).getBoundingClientRect().width;
  return {sidebar:w('.sidebar'),frame:w('.matrix-wrap'),main:w('.matrix'),
   ratio:w('.inspector-plot')/w('.inspector-insight'),month:monthKey(),
   tabs:document.querySelectorAll('[data-chart-tab]').length,defaultFilter:state.filter,
   recordCount:state.records.length,visibleRaw:rawTabulator.getDataCount()};
 });
 console.log('R13_LAYOUT '+JSON.stringify(layout));
 if(layout.month!=='2026-10'||layout.tabs!==4||layout.defaultFilter!=='main'||layout.recordCount<3600||
    Math.abs(layout.sidebar-212)>1||Math.abs(layout.frame-893)>2||layout.ratio<4.4||layout.ratio>7.5||
    layout.visibleRaw!==layout.recordCount)throw Error('Desktop layout/data regression');
 await check(page,()=>!!document.getElementById('statusFilter')&&!!document.getElementById('statusFilterButton')&&document.querySelectorAll('[data-filter-value]').length===8&&!!document.getElementById('settingsBtn')&&
    !document.querySelector('.raw-page-controls')&&
    document.querySelectorAll('.calendar-key span').length===3,'R13 controls not mounted');
 await check(page,()=>{
   const head=document.querySelector('.analysis-head').getBoundingClientRect();
   const insight=document.querySelector('.inspector-insight').getBoundingClientRect();
   return head.height<=35&&insight.width>=110&&insight.width<=132;
 },'Right title or compact insight geometry regressed');
 const countBefore=await page.evaluate(()=>document.querySelectorAll('.m-cell button.filtered-out').length);
 if(countBefore<25)throw Error('Default main status filter not active');
 await page.locator('#statusFilter').selectOption('trip');
 await check(page,()=>state.filter==='trip'&&document.querySelectorAll('.m-cell button:not(.filtered-out).s-trip').length>0,'Trip filter missing');
 await check(page,()=>state.rawDataTab==='trip'&&document.querySelector('.insight-heading')?.textContent.includes('出差')&&
   document.querySelector('[data-raw-tab="trip"]')?.classList.contains('active'),'Filter did not drive right-side statistics and raw category');
 await page.locator('#statusFilter').selectOption('main');
 await check(page,()=>{
   const statuses=['normal','anomaly','absent'];
   return statuses.every(kind=>[...state.analysis.values()].some(a=>attendanceJudgment(a)===kind))&&
     [...state.analysis.values()].some(a=>attendanceBehaviors(a).includes('trip')&&attendanceJudgment(a)!=='trip');
 },'Judgment and behavior are not independent');
 for(const status of ['normal','anomaly','absent']) {
   await page.locator('#statusFilter').selectOption(status);
   await check(page,()=>state.filter!=='all'&&document.querySelectorAll('.m-cell button:not(.filtered-out).s-'+state.filter).length>0,'Judgment filter failed');
 }
 await page.locator('#statusFilter').selectOption('main');
 await check(page,()=>[...document.querySelectorAll('.m-cell button:not(.filtered-out)')].every(b=>['s-normal','s-anomaly','s-absent'].some(c=>b.classList.contains(c))),'Default surface mixes behaviors');
 await check(page,()=>categoryColor('anomaly')==='#e6c36f'&&categoryColor('absent')==='#e58f90'&&
   categoryColor('normal')==='#78caa0'&&new Set(Object.values(ATTEND_BEHAVIOR_COLORS)).size===4,'Judgment or behavior palette not canonical');
 await check(page,()=>{
   const e=EMPLOYEES.find(x=>x.id==='E011');
   const all=new Set(Array.from({length:monthDays()},(_,i)=>attendanceBehaviors(state.analysis.get(e.id+'|'+(i+1)))).flat());
   return ['trip','leave','outing','overtime'].every(k=>all.has(k))&&state.outings.length>=8&&state.overtimeEntries.length>=8;
 },'Demo data does not cover all four behaviors on one employee');
 // Row focus is a single violet outline, no colored row fill.
 await page.locator('.m-name[data-emp="E001"]').click();
 await check(page,()=>{
  const frame=document.querySelector('.matrix-selection-frame.focus-row');
  return state.selection.type==='person'&&frame!==null&&
    !document.querySelector('.m-cell.row-focus').style.background&&
    getComputedStyle(frame).borderTopColor.startsWith('rgb(130, 87, 217)')&&
    !!document.querySelector('.matrix-selection-frame.focus-col.inactive');
 },'Continuous violet row frame');
 await page.screenshot({path:path.join(out,'r14-iteration-row.png')});
 await check(page,()=>{
  const name=document.querySelector('.m-name.selected'),c=getComputedStyle(name);
  return c.borderLeftWidth==='0px'&&c.transform!=='none'&&
   c.backgroundColor.includes('130, 87, 217')&&
   parseInt(getComputedStyle(name.querySelector('.name-letters span')).fontWeight)<600;
 },'Name anchor should use violet tint without a second border');
 await page.locator('.m-date[data-date="10"]').click();
 await check(page,()=>state.selection.type==='date'&&state.selection.day===10&&
   !document.querySelector('.matrix-selection-frame.focus-col').classList.contains('inactive'),
   'Clicking top date must select all employees');
 await check(page,()=>{
   const date=document.querySelector('.m-date.selected'),c=getComputedStyle(date),b=getComputedStyle(date.querySelector('b'));
   return c.borderTopWidth==='0px'&&c.transform!=='none'&&c.backgroundColor.includes('130, 87, 217')&&b.borderTopWidth==='0px';
 },'Date anchor should use violet tint without nested border');
 await page.locator('.m-name[data-emp="E001"]').click();
 await check(page,()=>state.selection.type==='person'&&state.selection.employeeId==='E001',
  'Clicking name must always select whole person month');

 // Blue hover frames preview both axes, independent of purple selection.
 await page.locator('.m-cell[data-emp="E003"][data-day="14"] button').hover();
 await check(page,()=>{
  const row=document.querySelector('.matrix-preview-frame.focus-row');
  const col=document.querySelector('.matrix-preview-frame.focus-col');
  return !row.classList.contains('inactive')&&!col.classList.contains('inactive')&&
    getComputedStyle(row).borderTopColor.includes('39, 139, 208');
 },'Blue hover crosshair not visible');
 await page.screenshot({path:path.join(out,'r14-iteration-hover.png')});
 await page.mouse.move(4,4);

 // Calendar keeps person context regardless of chart tab.
 await page.locator('.cal-day[data-day="9"]').click();
 await page.waitForSelector('#attendanceTimelineChart svg');
 await check(page,()=>state.selection.type==='cell'&&state.selection.employeeId==='E001'&&state.selection.day===9&&
   document.querySelector('.m-cell.cell-focus .selected')&&
   getComputedStyle(document.querySelector('.m-cell.cell-focus .selected')).boxShadow.includes('135, 89, 219'),
 'Person/calendar cell focus not lifted');
 await page.screenshot({path:path.join(out,'r14-iteration-timeline.png')});
 await check(page,()=>{
  const tr=r14TrackData(plotAnalysis(analysisContext())).tracks.map(x=>x.key);
  const bars=document.querySelectorAll('.r15-punch-stack').length;
  return tr[0]==='rules'&&tr[1]==='events'&&tr.indexOf('actual')>tr.indexOf('events')&&
    bars>0&&!!document.getElementById('r15PunchPreview')&&!document.querySelector('.r15-punch-dot');
 },'Music track order or punch-dot overview incorrect');
 await check(page,()=>{
   const dup=[...state.analysis.values()].find(a=>a.punches.some(p=>p.scenario==='rapid-swipes'));
   if(!dup)return false;
   const broad=r14TrackData(dup,{key:'b',start:0,end:1440},500).events.length;
   const narrow=r14TrackData(dup,{key:'n',start:520,end:600},900).events.length;
   return narrow>broad&&broad<dup.punches.length;
 },'Repeated punches are not clustered in the event model');

 await check(page,()=>{
  const ctx=analysisContext(),a=plotAnalysis(ctx),data=r14TrackData(a);
  const frames=document.querySelectorAll('.matrix-selection-frame:not(.inactive)');
  const zoom=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart')).getOption().dataZoom;
  return frames.length===2&&[...frames].every(x=>x.classList.contains('soft'))&&
    !data.tracks.some(x=>x.key==='span')&&zoom.filter(z=>z.type==='slider').length===1;
 },'Soft violet cross or compact time lanes failed');

 const tracks=await page.evaluate(()=>{
  const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));
  const opts=chart.getOption();
  const data=r14TrackData(state.analysis.get('E001|9'));
  return {ids:opts.series.map(s=>s.id), zoom:opts.dataZoom.map(z=>z.type),
   rails:data.tracks.map(t=>t.key),rects:data.bars.length,arrows:data.events.length,
   oldMini:!!document.getElementById('timelineMini'),settings:r14Prefs().timelineTracks};
 });
 console.log('R14_TIMELINE '+JSON.stringify(tracks));
 if(tracks.oldMini||tracks.zoom.filter(z=>z==='slider').length!==1||!tracks.ids.includes('bands')||
    !tracks.rails.includes('actual')||!tracks.rails.includes('rules')||
    tracks.arrows<2||tracks.rects<2)throw Error('Multiple time tracks/single overview failed');
 await page.locator('[data-chart-tab="overview"]').click();
 await page.waitForSelector('#overviewTrendChart svg');
 await check(page,()=>{
   const chart=echarts.getInstanceByDom(document.getElementById('overviewTrendChart'));
   const v=chart.getOption().series[0].data;return v.some(a=>a.itemStyle&&a.itemStyle.color);
 },'Daily points are not status-colored');
 // Other raw categories keep independent empty interfaces, without pagination.
 for(const kind of ['trip','leave','outing','overtime','attendance']){
   await page.locator('[data-raw-tab="'+kind+'"]').click();
   await page.waitForSelector('#rawDataTable.tabulator');
   await check(page,()=>!!rawTabulator&&rawTabulator.options.pagination===false&&!document.getElementById('rawPrev'),
     'Raw table still paginates');
 }
 await page.locator('.m-name[data-emp="E001"]').click();
 await page.waitForSelector('#rawDataTable.tabulator');
 await check(page,()=>rawTabulator.getColumns().some(c=>c.getField()==='name'&&c.isVisible()),
   'Employee name must remain visible in single person raw grid');
 const manualTarget=await page.evaluate(()=>{
   const a=[...state.analysis.values()].find(x=>isWorkday(x.day)&&attendanceJudgmentSystem(x)==='normal'&&x.punches.length>=2);
   return {id:a.employee.id,day:a.day};
 });
 await page.locator('.m-cell[data-emp="'+manualTarget.id+'"][data-day="'+manualTarget.day+'"] button').click();
 await page.waitForSelector('#attendanceTimelineChart svg');
 await page.locator('[data-manual-status="absent"]').click();
 await check(page,({id,day})=>{
   const key=id+'|'+day,cell=document.querySelector('.m-cell[data-emp="'+id+'"][data-day="'+day+'"] button');
   return state.manualStatuses[key]==='absent'&&state.judgmentMode==='manual'&&cell.classList.contains('s-absent')&&!!cell.querySelector('.manual-check')&&
     !document.querySelector('[data-judgment-mode="manual"]').disabled;
 },manualTarget,'Manual red override/check mark failed');
 await page.locator('[data-judgment-mode="initial"]').click();
 await check(page,({id,day})=>{
   const cell=document.querySelector('.m-cell[data-emp="'+id+'"][data-day="'+day+'"] button');
   return state.judgmentMode==='initial'&&!cell.classList.contains('s-absent')&&!!cell.querySelector('.manual-check');
 },manualTarget,'Initial/manual view switch failed');
 await page.locator('[data-judgment-mode="manual"]').click();
 await check(page,()=>state.judgmentMode==='manual','Manual layer cannot be restored');
 const firstRecord=await page.evaluate(({id,day})=>state.analysis.get(id+'|'+day).punches[0].recordId,manualTarget);
 await page.evaluate(id=>focusRawEvidence('attendance',id),firstRecord);
 await page.waitForSelector('.raw-linked-highlight',{timeout:5000});
  await page.locator('#rawFloat').click();
 await page.waitForSelector('#rawDialogOverlay .raw-dialog');
 const r0=await page.locator('.raw-dialog').boundingBox();
 await page.mouse.move(r0.x+135,r0.y+16);await page.mouse.down();
 await page.mouse.move(r0.x+181,r0.y+45,{steps:5});await page.mouse.up();
 const r1=await page.locator('.raw-dialog').boundingBox();
 if(r1.x-r0.x<25)throw Error('Resizable pop-out cannot drag');
 await page.locator('#rawClose').click();
 await check(page,()=>!rawDialog&&!!document.querySelector('.analysis-body #rawPane'),'Popout failed to dock');
 // Whole column plus top-left All.
 await page.locator('#matrixAll').click();
 await check(page,()=>state.selection.type==='overall'&&![...document.querySelectorAll('.matrix-selection-frame')].some(e=>!e.classList.contains('inactive'))&&
  !document.querySelector('.m-cell.cell-focus'),'All should clear focus');
 await page.locator('.m-date[data-date="10"]').click();
 await check(page,()=>state.selection.type==='date'&&!!document.querySelector('.matrix-selection-frame.focus-col'),'Column outline');
 await page.screenshot({path:path.join(out,'r14-iteration-column.png')});
 await page.locator('.m-cell[data-emp="E001"][data-day="3"] button').click();
 await check(page,()=>{
   const cell=document.querySelector('.m-cell.cell-focus button.selected');
   return state.selection.type==='cell'&&state.selection.day===3&&
     getComputedStyle(cell).boxShadow.includes('132, 86, 214')&&
     getComputedStyle(cell).opacity==='1';
 },'Non-working day cell must still float and glow violet');

 // Full settings center and five configurable columns.
 await page.locator('#settingsBtn').click();
 await page.waitForSelector('.r14-settings-nav button');
 await page.screenshot({path:path.join(out,'r14-iteration-settings.png')});
 await check(page,()=>document.querySelectorAll('[data-settings-section]').length===7,'Settings missing categories');
 await page.locator('[data-settings-section="matrix"]').click();
 await check(page,()=>document.getElementById('settingManualCheck')?.checked===true,'Manual check setting should default on');
 await page.locator('#settingGlow').fill('1.4');
 await page.locator('#settingRestContrast').fill('1.3');
 await page.locator('[data-settings-section="timeline"]').click();
 await page.locator('#settingTrack_leave').check();
 await page.locator('[data-settings-section="table"]').click();
 await page.locator('#settingTableKind').selectOption('attendance');
 await page.locator('[data-config-column="datetime"] input[type=number]').fill('190');
 await page.locator('[data-config-column="row"] input[type=checkbox]').uncheck();
 await page.screenshot({path:path.join(out,'r14-iteration-columns.png')});
 await page.locator('[data-settings-section="appearance"]').click();
 await page.locator('#settingFont').selectOption('1.08');
 await page.locator('#settingMotion').uncheck();
 await page.locator('#settingsApply').click();
 await check(page,()=>state.prefs.fontScale===1.08&&state.prefs.motion===false&&
    state.prefs.matrix.glow===1.4&&state.prefs.tableColumns.attendance.datetime.width===190&&
    state.prefs.tableColumns.attendance.row.visible===false&&workingPayload().prefs.matrix.glow===1.4,
  'Settings data persistence failed');
 await page.locator('#monthMenuButton').click();
 await page.locator('.month-choice[data-month="11"]').click();
 await check(page,()=>MONTH===11&&state.records.length===0&&state.analysis.size===1500,'Empty November workspace');
 await page.locator('#monthMenuButton').click();
 await page.locator('.month-choice[data-month="10"]').click();
 await check(page,()=>MONTH===10&&state.records.length>=3600,'October restoration lost data');
 for(const size of [[1600,900],[1366,768]]){
  await page.setViewportSize({width:size[0],height:size[1]});
  await page.waitForTimeout(240);
  const l=await page.evaluate(()=>({scrollX:getComputedStyle(document.querySelector('.tabulator-tableholder')).overflowX,
    sidebar:document.querySelector('.sidebar').getBoundingClientRect().width}));
  if(l.scrollX!=='hidden'||l.sidebar<195)throw Error('Small desktop table/side width '+JSON.stringify(l));
  await page.screenshot({path:path.join(out,'r13-'+size[0]+'.png')});
 }
 if(!process.env.P109_URL&&remote.length)throw Error('Network requests from offline app '+JSON.stringify(remote));
 if(errors.length)throw Error('Browser errors '+JSON.stringify(errors));
 console.log('P109_BROWSER_SMOKE_PASS '+JSON.stringify({r:'R18',remote:remote.length,errors:errors.length,layout}));
 await context.close();
}
run().catch(e=>{console.error('P109_BROWSER_SMOKE_FAIL',e.stack||e);process.exitCode=1})
 .finally(async()=>{if(browser)await browser.close()});
