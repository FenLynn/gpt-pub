/* AttendScope R13 acceptance: pure file:// Chromium, no remote dependencies. */
'use strict';
const path=require('path'),fs=require('fs'),{pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(process.cwd(),'p109-smoke-artifacts');
fs.mkdirSync(out,{recursive:true});
const url=process.env.P109_URL||pathToFileURL(path.join(root,'index.html')).href;
let browser,errors=[],remote=[];
async function check(page,expression,description){
  const result=await page.evaluate(expression);
  if(!result)throw Error(description);
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
 await page.waitForSelector('#overviewTrendChart svg',{timeout:20000});
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
    Math.abs(layout.sidebar-212)>1||Math.abs(layout.frame-893)>2||layout.ratio<2.7||layout.ratio>3.3||
    layout.visibleRaw!==layout.recordCount)throw Error('Desktop layout/data regression');
 await check(page,()=>!!document.getElementById('statusFilter')&&!!document.getElementById('settingsBtn')&&
    !document.querySelector('.raw-page-controls')&&
    document.querySelectorAll('.calendar-key span').length===3,'R13 controls not mounted');
 const countBefore=await page.evaluate(()=>document.querySelectorAll('.m-cell button.filtered-out').length);
 if(countBefore<25)throw Error('Default main status filter not active');
 await page.locator('#statusFilter').selectOption('trip');
 await check(page,()=>state.filter==='trip'&&document.querySelectorAll('.m-cell button:not(.filtered-out).s-trip').length>0,'Trip filter missing');
 await page.locator('#statusFilter').selectOption('all');
 await check(page,()=>document.querySelectorAll('.m-cell button.filtered-out').length===0,'All should show all cells');
 await page.locator('#statusFilter').selectOption('main');
 // Row focus is a single violet outline, no colored row fill.
 await page.locator('.m-name[data-emp="E001"]').click();
 await check(page,()=>{
  const frame=document.querySelector('.matrix-selection-frame.focus-row');
  return state.selection.type==='person'&&frame!==null&&
    !document.querySelector('.m-cell.row-focus').style.background&&
    getComputedStyle(frame).borderTopColor.includes('139, 90, 226')&&
    !!document.querySelector('.matrix-selection-frame.focus-col.inactive');
 },'Continuous violet row frame');
 await page.screenshot({path:path.join(out,'r14-iteration-row.png')});
 // Calendar keeps person context regardless of chart tab.
 await page.locator('.cal-day[data-day="9"]').click();
 await page.waitForSelector('#attendanceTimelineChart svg');
 await check(page,()=>state.selection.type==='cell'&&state.selection.employeeId==='E001'&&state.selection.day===9&&
   document.querySelector('.m-cell.cell-focus .selected')&&
   getComputedStyle(document.querySelector('.m-cell.cell-focus .selected')).boxShadow.includes('135, 89, 219'),
 'Person/calendar cell focus not lifted');
 await page.screenshot({path:path.join(out,'r14-iteration-timeline.png')});
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
 // Full settings center and five configurable columns.
 await page.locator('#settingsBtn').click();
 await page.waitForSelector('.r14-settings-nav button');
 await page.screenshot({path:path.join(out,'r14-iteration-settings.png')});
 await check(page,()=>document.querySelectorAll('[data-settings-section]').length===7,'Settings missing categories');
 await page.locator('[data-settings-section="matrix"]').click();
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
 console.log('P109_BROWSER_SMOKE_PASS '+JSON.stringify({r:'R14',remote:remote.length,errors:errors.length,layout}));
 await context.close();
}
run().catch(e=>{console.error('P109_BROWSER_SMOKE_FAIL',e.stack||e);process.exitCode=1})
 .finally(async()=>{if(browser)await browser.close()});
