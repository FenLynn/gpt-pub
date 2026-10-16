/* P109 end-to-end browser smoke. Tests file:// (offline) and deployed HTTPS. */
'use strict';
const fs=require('fs');
const path=require('path');
const {pathToFileURL}=require('url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');

const root=path.resolve(__dirname,'..');
const artifacts=path.join(process.cwd(),'p109-smoke-artifacts');
fs.mkdirSync(artifacts,{recursive:true});
const mode=process.env.P109_URL?'pages':'offline';
const url=process.env.P109_URL||pathToFileURL(path.join(root,'index.html')).href;
const errors=[];
const requests=[];

async function inspect(browser){
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  const page=await context.newPage();
  page.on('pageerror',err=>errors.push('PAGEERROR '+err.stack));
  page.on('console',msg=>{if(msg.type()==='error')errors.push('CONSOLE '+msg.text())});
  page.on('request',req=>{if(/^https?:/.test(req.url()))requests.push(req.url())});
  page.on('requestfailed',req=>errors.push('REQUEST FAILED '+req.url()+' '+req.failure()?.errorText));

  const response=await page.goto(url,{waitUntil:'load',timeout:45000});
  await page.waitForSelector('#matrix button[data-cell]',{timeout:20000});
  const shell=await page.evaluate(()=>{
    const rect=selector=>{const x=document.querySelector(selector);if(!x)return null;const r=x.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};
    const color=selector=>{const x=document.querySelector(selector);return x?getComputedStyle(x).backgroundColor:null};
    const statuses=[...state.analysis.values()];
    const overtime=statuses.find(a=>a.status==='非工作日出勤');
    const overtimeSelector=overtime?`[data-cell="${overtime.employee.id}|${overtime.day}"]`:null;
    return {
      topbar:rect('.topbar'),month:rect('#monthMenuButton'),matrix:rect('.matrix'),
      matrixWrap:rect('.matrix-wrap'),analysis:rect('.analysis-panel'),
      personHeader:rect('.m-name'),cell:rect('.m-cell button'),
      monthInSidebar:!!document.querySelector('.sidebar #monthMenuButton'),
      middleHeading:!!document.querySelector('.matrix-zone .section-head'),
      normal:color('.s-normal'),suspect:color('.s-suspect'),problem:color('.s-problem'),
      overtime:overtimeSelector?color(overtimeSelector):null,
      nameLetters:document.querySelector('.m-name .name-letters')?.children.length
    };
  });
  console.log('P109_UI_GEOMETRY '+JSON.stringify(shell));
  if(shell.topbar.height>46)throw Error('Top toolbar is too tall '+shell.topbar.height);
  if(!shell.monthInSidebar||shell.middleHeading)throw Error('Month selector / matrix heading placement regressed');
  if(Math.abs(shell.personHeader.width-58)>1)throw Error('Four-character name column width regressed '+shell.personHeader.width);
  if(shell.cell.width!==15||Math.abs(shell.matrix.width-554)>1)throw Error('Matrix no longer fixed compact width');
  if(Math.abs(shell.matrixWrap.y-shell.analysis.y)>3)throw Error('Matrix and analysis panel not top-aligned');
  if(!shell.overtime||shell.overtime===shell.normal)throw Error('Overtime not assigned distinct light blue');
  if(shell.nameLetters!==4)throw Error('Name not split into four glyphs for justified spacing');
  await page.locator('#monthMenuButton').click();
  if(!await page.locator('#monthPopover').evaluate(el=>el.classList.contains('open')))throw Error('Month selector does not open');
  await page.locator('.month-choice.active').click();
  if(await page.locator('#monthPopover').evaluate(el=>el.classList.contains('open')))throw Error('Month selector does not close');
  await page.screenshot({path:path.join(artifacts,mode+'-matrix.png'),fullPage:false});
  const chosen=await page.evaluate(()=>{
    const item=[...state.analysis.values()].find(x=>x.punches.length>=4&&x.firstIn&&x.lastOut&&isWorkday(x.day));
    return item?{id:item.employee.id,day:item.day,count:item.punches.length,status:item.status}:null;
  });
  if(!chosen)throw Error('No employee-day with 4 punch records available');

  const cell=`[data-cell="${chosen.id}|${chosen.day}"]`;
  await page.locator(cell).click();
  await page.waitForSelector('#attendanceTimelineChart svg',{timeout:12000});
  await page.waitForTimeout(900);

  const snapshot=await page.evaluate(()=>{
    const element=document.getElementById('attendanceTimelineChart');
    const inst=window.echarts?.getInstanceByDom(element);
    const svg=element?.querySelector('svg');
    const svgArrowPaths=[...(svg?.querySelectorAll('path[stroke]')||[])].filter(p=>['#147fc0','#3698c9','#e29355','#cf6c37'].includes(p.getAttribute('stroke'))&&/^M[0-9.-]+ [0-9.-]+L/.test(p.getAttribute('d')||''));
    const shapes=inst?.getZr()?.storage?.getDisplayList()||[];
    const display=shapes.map(el=>el.type);
    const arrowShafts=shapes.filter(el=>el.type==='line'&&(el.style?.lineWidth||0)>=4.5&&Math.abs((el.shape?.y2||0)-(el.shape?.y1||0))>=35);
    return {
      title:document.getElementById('analysisTitle')?.textContent,
      echartsVersion:window.echarts?.version,
      dimensions:element?{width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}:null,
      chartMounted:!!inst,
      customSeries:inst?.getOption()?.series?.filter(s=>s.type==='custom').length||0,
      dataZoom:inst?.getOption()?.dataZoom?.map(x=>x.type)||[],
      svgChars:svg?.outerHTML?.length||0,
      displayTypes:display.reduce((r,t)=>(r[t]=(r[t]||0)+1,r),{}),
      arrowShafts:arrowShafts.length,
      svgArrowPaths:svgArrowPaths.length,
      clippedArrowPaths:svgArrowPaths.filter(p=>p.hasAttribute('filter')).length,
      shaftCoordinates:arrowShafts.map(s=>({x:s.shape.x1,y1:s.shape.y1,y2:s.shape.y2,color:s.style.stroke})),
      range:state.timelineRange,
      cellSize:document.querySelector('.m-cell button')?.getBoundingClientRect().width,
      nameWidth:document.querySelector('.m-name')?.getBoundingClientRect().width,
      matrixWidth:document.querySelector('.matrix')?.getBoundingClientRect().width
    };
  });
  await page.screenshot({path:path.join(artifacts,mode+'-timeline.png'),fullPage:false});
  fs.writeFileSync(path.join(artifacts,mode+'-timeline.svg'),await page.locator('#attendanceTimelineChart svg').evaluate(node=>node.outerHTML),'utf8');
  console.log('P109_TIMELINE_SNAPSHOT '+JSON.stringify({chosen,...snapshot}));
  if(!snapshot.chartMounted)throw Error('Timeline chart instance not mounted');
  if(snapshot.customSeries<2)throw Error('Expected axis arrow AND punch arrow custom series');
  if(!snapshot.dataZoom.includes('slider'))throw Error('Slider dataZoom missing');
  if(snapshot.svgChars<2500)throw Error('Chart SVG empty or too small: '+snapshot.svgChars);
  if(!snapshot.displayTypes.polygon)throw Error('No arrowhead polygons rendered');
  if(snapshot.arrowShafts<chosen.count)throw Error('Some punch arrows are truncated or missing: '+snapshot.arrowShafts+' of '+chosen.count);
  if(snapshot.svgArrowPaths<chosen.count)throw Error('Some punch arrow shafts are absent from the actual SVG DOM');
  if(snapshot.clippedArrowPaths>0)throw Error('Chrome-visible SVG arrow shafts carry broken filter: '+snapshot.clippedArrowPaths);
  if(snapshot.cellSize>15.2)throw Error('Matrix cells too large '+snapshot.cellSize);
  if(snapshot.nameWidth>59)throw Error('Matrix names too wide '+snapshot.nameWidth);
  if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));

  await page.evaluate(()=>{
    const el=document.getElementById('attendanceTimelineChart');
    const chart=echarts.getInstanceByDom(el);
    chart.dispatchAction({type:'dataZoom',dataZoomId:'slider',startValue:490,endValue:740});
  });
  await page.waitForFunction(()=>state.timelineRange&&Math.abs(state.timelineRange.start-490)<8&&Math.abs(state.timelineRange.end-740)<8,undefined,{timeout:8000});
  const range=await page.evaluate(()=>({...state.timelineRange}));
  console.log('P109_ZOOM_OK '+JSON.stringify(range));

  await page.locator('.m-date[data-date="9"]').click();
  await page.waitForSelector('#attendanceDayChart svg',{timeout:12000});
  await page.waitForTimeout(350);
  console.log('P109_DAY_CHART_OK '+await page.locator('#attendanceDayChart svg').count());
  await page.screenshot({path:path.join(artifacts,mode+'-day.png'),fullPage:false});

  await page.locator('button[data-analysis-tab="stats"]').click();
  await page.waitForSelector('#statsChartMain svg',{timeout:12000});
  console.log('P109_STATS_CHART_OK '+await page.locator('#statsChartMain svg').count());

  await page.locator('button[data-analysis-tab="overview"]').click();
  await page.waitForSelector('.overview-rows');
  if(mode==='offline'&&requests.some(x=>/^https?:/.test(x)))throw Error('Offline file page made HTTP(S) requests '+JSON.stringify(requests));
  if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors));
  console.log('P109_BROWSER_SMOKE_PASS '+JSON.stringify({mode,url,chosen,requests:requests.length}));
  await context.close();
}

(async()=>{
  const bin=process.env.CHROME_BIN;
  const browser=await chromium.launch({headless:true,...(bin?{executablePath:bin}:{channel:'chrome'})});
  try{await inspect(browser)}
  catch(e){console.error('P109_BROWSER_SMOKE_FAIL',e.stack||String(e));console.error('BROWSER_ERRORS',JSON.stringify(errors));process.exitCode=1}
  finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
