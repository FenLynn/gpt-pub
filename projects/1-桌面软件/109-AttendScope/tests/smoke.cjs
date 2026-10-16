/* Offline browser acceptance: 20% widths, glow selection, plot+raw Tabulator. */
'use strict';
const fs=require('fs'),path=require('path'),{pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),artifacts=path.join(process.cwd(),'p109-smoke-artifacts');
fs.mkdirSync(artifacts,{recursive:true});
const mode=process.env.P109_URL?'pages':'offline';
const url=process.env.P109_URL||pathToFileURL(path.join(root,'index.html')).href;
const errors=[],requests=[];
const eq=(a,b,tol=1)=>Math.abs(a-b)<=tol;
async function run(browser){
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const page=await context.newPage();
  page.on('pageerror',e=>errors.push('PAGEERROR '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE '+m.text())});
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
  page.on('requestfailed',r=>errors.push('REQUEST FAILED '+r.url()));
  await page.goto(url,{waitUntil:'load',timeout:45000});
  await page.waitForSelector('#matrix [data-cell]',{timeout:20000});
  await page.waitForSelector('#overviewTrendChart svg',{timeout:18000});
  await page.waitForSelector('#rawDataTable .tabulator-row',{timeout:18000});
  const shell=await page.evaluate(()=>{
    const w=s=>document.querySelector(s)?.getBoundingClientRect().width||0;
    const b=s=>document.querySelector(s)?.getBoundingClientRect();
    return {
      sidebar:w('.sidebar'),matrix:w('.matrix'),frame:w('.matrix-wrap'),
      leftPlot:w('.inspector-plot'),rightData:w('.inspector-insight'),top:b('.inspector-top'),bottom:b('.inspector-bottom'),
      plotSvg:!!document.querySelector('#overviewTrendChart svg'),lib:typeof Tabulator,
      raw:rawTabulator?.getDataCount(),all:state.records.length,
      dateFont:parseFloat(getComputedStyle(document.querySelector('.m-date b')).fontSize),
      footer:document.querySelector('.matrix-footer'),count:document.querySelector('#rawRowCount')?.textContent,
      holiday: getComputedStyle(document.querySelector('.m-cell.day-holiday')).backgroundColor,
      work: getComputedStyle(document.querySelector('.m-cell.day-work')).backgroundColor
    };
  });
  console.log('P109_WORKBENCH_GEOMETRY '+JSON.stringify(shell));
  if(!eq(shell.sidebar,212)||!eq(shell.matrix,866.5)||!eq(shell.frame,883))throw Error('20% widths missing');
  if(!eq(shell.raw,shell.all)||shell.lib!=='function')throw Error('Actual raw table not mounted');
  if(shell.footer||!shell.top||!shell.bottom)throw Error('Missing top/bottom split or footer remains');
  if(shell.leftPlot/shell.rightData<2.2||shell.leftPlot/shell.rightData>3.6)throw Error('Upper 3:1 ratio regressed');
  if(shell.holiday===shell.work)throw Error('Holiday shading indistinguishable');
  if(shell.dateFont<11)throw Error('Date headers unreadable');
  await page.screenshot({path:path.join(artifacts,mode+'-overview.png'),fullPage:false});
  // Select entire employee row and confirm 31 luminous cells.
  await page.locator('.m-name[data-emp="E001"]').click();
  await page.waitForSelector('#overviewTrendChart svg');
  const row=await page.evaluate(()=>({
    state:state.selection.type, lit:document.querySelectorAll('.m-cell.row-focus').length,
    header:document.querySelector('.m-name.selected')?.dataset.emp,
    raw:rawTabulator?.getDataCount(),
    expected:state.records.filter(r=>r.employeeId==='E001').length
  }));
  if(row.state!=='person'||row.lit!==31||row.header!=='E001'||row.raw!==row.expected)throw Error('Row highlight/raw filter broken '+JSON.stringify(row));
  await page.screenshot({path:path.join(artifacts,mode+'-row-glow.png'),fullPage:false});
  // Select entire day column; all 50 staff rows must glow.
  await page.locator('.m-date[data-date="9"]').click();
  await page.waitForSelector('#attendanceDayChart svg');
  const col=await page.evaluate(()=>({
    state:state.selection.type,lit:document.querySelectorAll('.m-cell.col-focus').length,
    raw:rawTabulator?.getDataCount(),
    expected:state.records.filter(r=>r.datetime.startsWith('2026-10-09')).length
  }));
  if(col.state!=='date'||col.lit!==50||col.raw!==col.expected)throw Error('Column selection/raw filter broken '+JSON.stringify(col));
  await page.screenshot({path:path.join(artifacts,mode+'-column-glow.png'),fullPage:false});
  // A person-day cell must light both axes and the intersection, without changing severity color.
  const chosen=await page.evaluate(()=>{
    const a=[...state.analysis.values()].find(x=>x.punches.length>=4&&x.firstIn&&x.lastOut&&isWorkday(x.day));
    return a?{id:a.employee.id,day:a.day,count:a.punches.length}:null;
  });
  if(!chosen)throw Error('No example punch group');
  const selector='[data-cell="'+chosen.id+'|'+chosen.day+'"]';
  await page.locator(selector).click();
  await page.waitForSelector('#attendanceTimelineChart svg',{timeout:15000});
  await page.waitForSelector('#rawDataTable .tabulator-row',{timeout:15000});
  const cell=await page.evaluate(()=>{
    const c=document.querySelector('.m-cell.cell-focus');
    const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));
    const list=chart?.getZr().storage.getDisplayList()||[];
    const shafts=list.filter(x=>x.type==='line'&&(x.style?.lineWidth||0)>=4.5&&Math.abs((x.shape?.y2||0)-(x.shape?.y1||0))>=35);
    return {
      state:state.selection.type, row:document.querySelectorAll('.m-cell.row-focus').length,
      col:document.querySelectorAll('.m-cell.col-focus').length,cell:document.querySelectorAll('.m-cell.cell-focus').length,
      glow:getComputedStyle(c).boxShadow,raw:rawTabulator?.getDataCount(),
      punches:state.analysis.get(state.selection.employeeId+'|'+state.selection.day).punches.length,
      svg:document.querySelector('#attendanceTimelineChart svg')?.outerHTML.length,
      zoom:chart?.getOption().dataZoom.map(z=>z.type),shafts:shafts.length,
      directions:shafts.every(s=>(['#208ece','#126fba'].includes(String(s.style.stroke).toLowerCase())?s.shape.y2<s.shape.y1:
        ['#d98950','#ca6f39'].includes(String(s.style.stroke).toLowerCase())?s.shape.y2>s.shape.y1:true))
    };
  });
  console.log('P109_CELL_GLOW '+JSON.stringify({chosen,...cell}));
  if(cell.state!=='cell'||cell.row!==31||cell.col!==50||cell.cell!==1)throw Error('Cell cross glow broken');
  if(!cell.glow.includes('rgba')||cell.raw!==cell.punches)throw Error('Cell focus styling/data broken');
  if(cell.svg<2500||!cell.zoom?.includes('slider')||cell.shafts<chosen.count||!cell.directions)throw Error('Chart arrows or zoom broken');
  await page.screenshot({path:path.join(artifacts,mode+'-cell-glow.png'),fullPage:false});
  await page.locator('#rawDataTable .tabulator-row').first().click();
  await page.waitForSelector('#timelineEvidence .evidence-main',{timeout:8000});
  const first=await page.evaluate(()=>rawTabulator.getData('active').length);
  if(first!==chosen.count)throw Error('Record drilldown filtered rows inaccurate');
  await page.locator('[data-raw-tab="leave"]').click();
  await page.waitForFunction(()=>state.rawDataTab==='leave'&&!!document.querySelector('#rawDataTable.tabulator')&&!!document.querySelector('#rawDataTable .tabulator-col'));
  const leave=await page.evaluate(()=>({n:rawTabulator?.getDataCount(),expect:rawForContext(analysisContext()).length,columns:rawTabulator?.getColumns().map(c=>c.getField())}));
  if(leave.n!==leave.expect||!leave.columns?.includes('date'))throw Error('Leave raw table failed '+JSON.stringify(leave));
  await page.locator('[data-raw-tab="trip"]').click();
  await page.waitForFunction(()=>state.rawDataTab==='trip'&&!!document.querySelector('#rawDataTable.tabulator')&&!!document.querySelector('#rawDataTable .tabulator-col'));
  const trip=await page.evaluate(()=>({n:rawTabulator?.getDataCount(),expect:rawForContext(analysisContext()).length,columns:rawTabulator?.getColumns().map(c=>c.getField())}));
  if(trip.n!==trip.expect||!trip.columns?.includes('startDate'))throw Error('Trip raw table failed '+JSON.stringify(trip));
  await page.locator('[data-raw-tab="attendance"]').click();
  await page.waitForSelector('#rawDataTable .tabulator-row');
  await page.evaluate(()=>{
    const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));
    chart.dispatchAction({type:'dataZoom',dataZoomId:'slider',startValue:490,endValue:740});
  });
  await page.waitForFunction(()=>state.timelineRange&&Math.abs(state.timelineRange.start-490)<8&&Math.abs(state.timelineRange.end-740)<8,undefined,{timeout:8000});
  for(const dim of [{width:1600,height:900},{width:1366,height:768}]){
    await page.setViewportSize(dim);
    await page.waitForTimeout(350);
    const geo=await page.evaluate(()=>{
      const b=s=>{const x=document.querySelector(s).getBoundingClientRect();return {x:x.x,y:x.y,w:x.width,right:x.right}};
      return {sidebar:b('.sidebar'),matrix:b('.matrix-wrap'),plot:b('.inspector-plot'),insight:b('.inspector-insight'),bottom:b('.inspector-bottom'),scroller:document.querySelector('.workspace').scrollWidth,client:document.querySelector('.workspace').clientWidth};
    });
    const frame=dim.width<=1450?851:883,side=dim.width<=1450?202:212;
    if(!eq(geo.matrix.w,frame)||!eq(geo.sidebar.w,side))throw Error('Responsive widths wrong '+JSON.stringify({dim,geo}));
    if(geo.plot.right>geo.insight.x+2||geo.plot.x>=geo.insight.x)throw Error('Top areas overlap');
    if(geo.bottom.y<=geo.plot.y)throw Error('Raw pane no longer below plot');
    if(geo.scroller<=geo.client&&dim.width===1366)throw Error('Narrow viewport overflow must scroll, not crush panels');
    await page.screenshot({path:path.join(artifacts,mode+'-'+dim.width+'-layout.png'),fullPage:false});
  }
  if(mode==='offline'&&requests.length)throw Error('Offline page requested HTTP: '+JSON.stringify(requests));
  if(errors.length)throw Error('Browser errors '+JSON.stringify(errors));
  console.log('P109_BROWSER_SMOKE_PASS '+JSON.stringify({mode,sha:'P109_20pct_tabulator',punches:chosen.count,errors:errors.length,requests:requests.length}));
  await context.close();
}
(async()=>{
 const bin=process.env.CHROME_BIN;
 const browser=await chromium.launch({headless:true,...(bin?{executablePath:bin}:{channel:'chrome'})});
 try{await run(browser)}catch(e){console.error('P109_BROWSER_SMOKE_FAIL',e.stack||String(e));console.error(JSON.stringify(errors));process.exitCode=1}
 finally{await browser.close()}
})().catch(e=>{console.error(e.stack||String(e));process.exitCode=1});
