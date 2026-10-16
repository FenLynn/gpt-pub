/* P109 R12 offline Chromium QA: month/group, sticky matrix, chart tabs, raw popout. */
'use strict';
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),art=path.join(process.cwd(),'p109-smoke-artifacts');
fs.mkdirSync(art,{recursive:true});
const url=process.env.P109_URL||pathToFileURL(path.join(root,'index.html')).href,errors=[],requests=[];
async function assert(page,expr,label){
  const v=await page.evaluate(expr);
  if(!v)throw Error(label);
}
async function test(browser){
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
  page.on('dialog',d=>d.type()==='prompt'?d.accept('专项研发组'):d.accept());
  await page.goto(url,{waitUntil:'load',timeout:45000});
  await page.waitForSelector('#overviewTrendChart svg',{timeout:16000});
  await page.waitForSelector('#rawDataTable .tabulator-row',{timeout:16000});
  const metrics=await page.evaluate(()=>{
    const width=s=>document.querySelector(s)?.getBoundingClientRect().width;
    const mid=s=>document.querySelector(s)?.getBoundingClientRect();
    return {year:YEAR,month:MONTH,sidebar:width('.sidebar'),matrix:width('.matrix'),frame:width('.matrix-wrap'),
      topRatio:width('.inspector-plot')/width('.inspector-insight'),leftMonth:!!document.querySelector('.sidebar #monthMenuButton'),
      topMonth:!!document.querySelector('.topbar #monthMenuButton'),tabs:document.querySelectorAll('[data-chart-tab]').length,
      records:rawTabulator?.getDataCount(),rawCount:state.records.length,footer:!!document.querySelector('.matrix-footer'),
      title:document.getElementById('analysisTitle')?.textContent};
  });
  console.log('P109_NEW_GEOMETRY '+JSON.stringify(metrics));
  if(metrics.year!==2026||metrics.month!==10||!metrics.topMonth||metrics.leftMonth||metrics.footer||metrics.tabs!==4)throw Error('Month/nav split missing');
  if(Math.abs(metrics.sidebar-212)>1||Math.abs(metrics.matrix-856.5)>2||Math.abs(metrics.frame-873)>2)throw Error('Matrix widths regressed');
  if(metrics.topRatio<2.7||metrics.topRatio>3.3||metrics.records!==metrics.rawCount)throw Error('3:1 chart/raw layout regressed');
  await page.screenshot({path:path.join(art,'r12-overview.png')});
  await page.locator('.m-name[data-emp="E001"]').click();
  await page.waitForSelector('#overviewTrendChart svg');
  await assert(page,()=>state.selection.type==='person'&&state.chartTab==='overview'&&document.getElementById('analysisTitle').textContent.includes('组'),'Person defaults to monthly overview');
  await page.locator('[data-chart-tab="timeline"]').click();
  await page.waitForSelector('#attendanceTimelineChart svg',{timeout:15000});
  await assert(page,()=>{
    const id=state.selection.employeeId,d=state.chartDay;
    return state.chartTab==='timeline'&&d===nearestRecordedDay(id)&&rawTabulator.getDataCount()===state.records.filter(x=>x.employeeId===id&&x.datetime.startsWith(isoDate(d))).length;
  },'Person timeline default/latest day raw table mismatch');
  await page.locator('.cal-day[data-day="9"]').click();
  await page.waitForSelector('#attendanceTimelineChart svg');
  await assert(page,()=>state.selection.type==='cell'&&state.selection.employeeId==='E001'&&state.selection.day===9&&state.chartTab==='timeline','Calendar day lost person context');
  await page.locator('[data-chart-tab="stats"]').click();
  await page.waitForSelector('#statsChartMain svg',{timeout:15000});
  await assert(page,()=>document.getElementById('analysisTitle').textContent.includes('2026-10-09')&&!!document.getElementById('statsChartSecondary'),'Stats context title/second plot');
  await page.locator('[data-chart-tab="issues"]').click();
  await page.waitForSelector('#issueChart svg',{timeout:15000});
  await page.locator('[data-chart-tab="timeline"]').click();
  await page.waitForSelector('#attendanceTimelineChart svg');
  await page.locator('#rawFloat').click();
  await page.waitForSelector('#rawDialogOverlay .raw-dialog');
  const rect0=await page.locator('.raw-dialog').boundingBox();
  await page.mouse.move(rect0.x+130,rect0.y+18);await page.mouse.down();
  await page.mouse.move(rect0.x+188,rect0.y+49,{steps:5});await page.mouse.up();
  const rect1=await page.locator('.raw-dialog').boundingBox();
  if(rect1.x-rect0.x<35||rect1.y-rect0.y<15)throw Error('Popout not draggable');
  await page.locator('#rawClose').click();
  await assert(page,()=>!document.getElementById('rawDialogOverlay')&&!!document.querySelector('.analysis-body #rawPane')&&!!rawTabulator,'Popout cannot dock back');
  await page.screenshot({path:path.join(art,'r12-cell.png')});
  await page.locator('#clearSelection').click();
  await page.locator('.m-date[data-date="9"]').click();
  await assert(page,()=>state.selection.type==='date'&&document.getElementById('analysisTitle').textContent.includes('2026-10-09'),'Date header');
  const frame=await page.locator('.matrix-wrap');
  await frame.evaluate(el=>{el.scrollTop=240;el.scrollLeft=120});
  await page.waitForTimeout(180);
  const stick=await page.evaluate(()=>{
    const wrap=document.querySelector('.matrix-wrap').getBoundingClientRect();
    const date=document.querySelector('.m-date').getBoundingClientRect();
    const name=document.querySelector('.m-name').getBoundingClientRect();
    const corner=document.querySelector('.m-corner').getBoundingClientRect();
    return {top:wrap.top,dateY:date.y,nameX:name.x,wrapX:wrap.x,cornerX:corner.x,cornerY:corner.y};
  });
  console.log('P109_STICKY_AXES '+JSON.stringify(stick));
  if(Math.abs(stick.dateY-stick.top)>3||Math.abs(stick.nameX-stick.wrapX)>3||Math.abs(stick.cornerY-stick.top)>3)throw Error('Sticky header/name failure');
  await frame.evaluate(el=>{el.scrollTop=0;el.scrollLeft=0});
  // Group is independent of department, can be edited while keeping person context.
  await page.locator('.m-name[data-emp="E001"]').click();
  await page.locator('[data-edit-group="E001"]').click();
  await assert(page,()=>state.groups.E001!==EMPLOYEES[0].department+'组','Group manual assignment did not persist');
  await page.locator('#monthMenuButton').click();
  await page.locator('.month-choice[data-month="11"]').click();
  await assert(page,()=>YEAR===2026&&MONTH===11&&state.records.length===0&&state.analysis.size===1500&&state.monthStores.has('2026-10'),'New month should be empty and independent');
  await assert(page,()=>workingPayload().records.length===0&&workingPayload().groups.E001===state.groups.E001&&projectPayload().months.includes('2026-11'),'Month-scoped working/group metadata missing');
  await page.locator('#monthMenuButton').click();
  await page.locator('.month-choice[data-month="10"]').click();
  await assert(page,()=>YEAR===2026&&MONTH===10&&state.records.length===3600&&state.groups.E001!==EMPLOYEES[0].department+'组','Switching month lost records or group');
  for(const dims of [[1600,900],[1366,768]]){
    await page.setViewportSize({width:dims[0],height:dims[1]});await page.waitForTimeout(280);
    const r=await page.evaluate(()=>({
      sidebar:document.querySelector('.sidebar').getBoundingClientRect().width,
      head:document.querySelector('.topbar').getBoundingClientRect().height,
      tab:!!document.querySelector('.raw-page-controls'),
      overflowX:getComputedStyle(document.querySelector('.tabulator-tableholder')).overflowX
    }));
    if(r.head>49||!r.tab||r.overflowX!=='hidden')throw Error('Narrow desktop control overflow '+JSON.stringify({dims,r}));
    await page.screenshot({path:path.join(art,'r12-'+dims[0]+'.png')});
  }
  if(!process.env.P109_URL&&requests.length)throw Error('Offline runtime network requests '+JSON.stringify(requests));
  if(errors.length)throw Error('Console/page errors '+JSON.stringify(errors));
  console.log('P109_BROWSER_SMOKE_PASS '+JSON.stringify({month:'2026-10',requests:requests.length,errors:errors.length,metrics}));
  await context.close();
}
(async()=>{
 const bin=process.env.CHROME_BIN;
 const browser=await chromium.launch({headless:true,...(bin?{executablePath:bin}:{channel:'chrome'})});
 try{await test(browser)}catch(e){console.error('P109_BROWSER_SMOKE_FAIL',e.stack||e);console.error('P109_ERRORS',JSON.stringify(errors));process.exitCode=1}
 finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
