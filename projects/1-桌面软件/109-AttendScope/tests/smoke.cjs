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
 page.on('pageerror',e=>errors.push('page: '+(e.stack||e.message)));
 page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text())});
 page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
 page.on('dialog',d=>d.type()==='prompt'?d.accept('科研创新组'):d.accept());
 await page.goto(url,{waitUntil:'load',timeout:60000});
 await check(page,()=>typeof legacyMountAttendanceTimeline==='undefined'&&typeof analysisTimelineHtml==='undefined'&&
  typeof timelineMiniMapHtml==='undefined'&&typeof mountAttendanceTimeline==='function',
  'R38 retired chart renderers remain active');
 await check(page,()=>{
  const nav=document.querySelector('.workspace-navigation'),bar=document.querySelector('.topbar');
  const side=document.querySelector('.sidebar'),cal=document.querySelector('.side-calendar'),name=document.querySelector('.m-name .name-letters');
  return nav.parentElement===bar&&document.querySelectorAll('.workspace-navigation').length===1&&
    !!side.querySelector('#statusFilter')&&!!side.querySelector('#workspaceScopeGroup')&&!!side.querySelector('#workspacePerson')&&
    !document.querySelector('.scope-group-links')&&!document.querySelector('.scope-stat-row')&&
    cal.getBoundingClientRect().bottom<=innerHeight+2&&cal.getBoundingClientRect().top>side.getBoundingClientRect().top+100&&
    name.textContent===EMPLOYEES[0].name&&!name.querySelector('span')&&
    document.querySelector('.matrix-wrap').getBoundingClientRect().top<210;
 },'R39 system header, left filters, fixed calendar or compact matrix failed');
 await check(page,()=>{
  const controls=document.querySelector('.top-global-actions').getBoundingClientRect();
  const nav=document.querySelector('.workspace-navigation').getBoundingClientRect();
  const wrap=document.querySelector('.matrix-wrap').getBoundingClientRect();
  const matrix=document.querySelector('.matrix').getBoundingClientRect();
  const scope=document.querySelector('#scopeInsights').getBoundingClientRect();
  const name=document.querySelector('.m-name .name-letters');
  return controls.left>=nav.right&&scope.left>=wrap.right&&
   matrix.width>wrap.width*.94&&matrix.width<=wrap.width&&
   getComputedStyle(name).textAlignLast==='justify'&&name.getBoundingClientRect().width>=48;
 },'R41 right-aligned global actions, no dead columns, or four-char name justification');
 await page.locator('#statusFilterButton').click();
 await check(page,()=>{
  const menu=document.querySelector('#statusFilterMenu').getBoundingClientRect();
  const trigger=document.querySelector('#statusFilterButton').getBoundingClientRect();
  return document.querySelector('#statusFilterMenu').classList.contains('open')&&menu.bottom<trigger.top&&menu.top>=0;
 },'R41 status menu should open upward fully visible');
 await check(page,()=>{
  const list=document.getElementById('statusFilterMenu'),buttons=[...list.querySelectorAll('button')];
  const bounds=list.getBoundingClientRect(),sidebar=document.querySelector('.sidebar').getBoundingClientRect();
  const cols=getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean);
  return cols.length===2&&getComputedStyle(list).overflowY==='visible'&&
    list.scrollHeight<=list.clientHeight+1&&bounds.left>=sidebar.left&&bounds.right<=sidebar.right&&
    bounds.top>=0&&buttons.length===8&&
    buttons.every(b=>getComputedStyle(b).whiteSpace==='nowrap'&&b.scrollHeight<=b.clientHeight+1);
 },'R44 two-column status picker must fit without scrollbars');
 await page.locator('#statusFilterButton').click();
 // Explicit Personal tab starts on day one; matrix cell drilldowns retain the clicked day.
 await page.locator('[data-workspace="person"]').click();
 await page.waitForSelector('#attendanceTimelineChart svg',{timeout:15000});
 await check(page,()=>state.workspaceMode==='person'&&state.chartTab==='timeline'&&
   state.chartDay===1&&state.selection.day===1&&state.selection.type==='cell'&&
   !!document.querySelector('.cal-day[data-day="1"].selected')&&
   !!document.querySelector('.person-day[data-person-day="1"].selected')&&
   !document.querySelector('.person-strip-label')&&!document.querySelector('.plot-heading')&&
   !document.querySelector('.workspace-mode-person .inspector-plot')?.textContent.includes('常规每日分布'),
 'R43 personal navigation must open first-day timeline without redundant titles');
 await page.screenshot({path:path.join(out,'r43-person-first-day.png')});
 const secondPerson=await page.locator('#workspacePerson option').nth(1).getAttribute('value');
 await page.locator('#workspacePerson').selectOption(secondPerson);
 await check(page,(personId)=>state.workspaceMode==='person'&&state.chartTab==='timeline'&&
    state.chartDay===1&&state.selection.type==='cell'&&state.selection.day===1&&
    state.selection.employeeId===personId&&!!document.querySelector('#attendanceTimelineChart svg'),
    secondPerson,'R43 choosing a new person must begin on first-day timeline');
 await page.locator('[data-workspace="all"]').click();
 await check(page,()=>{
  const wrap=document.querySelector('.matrix-wrap'),grid=document.querySelector('.matrix'),
    edge=grid.querySelector('.m-cell[data-day="31"]').getBoundingClientRect(),
    corner=document.querySelector('.m-corner');
  return wrap.scrollWidth<=wrap.clientWidth+1&&
    getComputedStyle(wrap).overflowX==='hidden'&&
    wrap.getBoundingClientRect().right-edge.right>=8&&wrap.getBoundingClientRect().right-edge.right<40&&
    getComputedStyle(corner).justifyContent==='center';
 },'R42 all-staff month grid must not scroll horizontally');
 await page.screenshot({path:path.join(out,'r41-all.png')});
 await page.screenshot({path:path.join(out,'r37-all.png')});
 // R40: left navigation is two simple inline selectors; selecting a name highlights the row.
 await page.locator('#workspacePerson').selectOption('E001');
 await check(page,()=>state.workspaceMode==='all'&&state.selection.type==='person'&&state.selection.employeeId==='E001'&&
   !document.querySelector('.matrix-selection-frame.focus-row')?.classList.contains('inactive'),
   'R40 person selector must only highlight monthly row');
 await page.locator('#workspacePerson').selectOption('');
 await check(page,()=>document.querySelectorAll('.m-name[data-emp]').length===EMPLOYEES.length,
   'R40 returning to all employees failed');
 await page.setViewportSize({width:1600,height:900});
 await check(page,()=>{
   const cal=document.querySelector('.side-calendar').getBoundingClientRect();
   const frame=document.querySelector('.matrix-wrap').getBoundingClientRect();
   const m=document.querySelector('.matrix').getBoundingClientRect();
   return cal.bottom<=innerHeight+2&&m.width>=frame.width*.94&&m.width<=frame.width+6&&
    document.documentElement.scrollWidth<=innerWidth+3;
 },'R39 1600px responsive calendar/matrix regression');
 await page.screenshot({path:path.join(out,'r39-all-1600.png')});
 await page.setViewportSize({width:1920,height:1080});
 await check(page,()=>state.workspaceMode==='all'&&document.querySelectorAll('[data-workspace]').length===4&&
   !!document.querySelector('#scopeInsights .scope-insight-numbers')&&!!document.querySelector('.matrix-wrap'),'R37 full-staff entry not mounted');
 await page.waitForSelector('#scopeDailyChart svg',{timeout:15000});
 await check(page,()=>{
   const day=Array.from({length:monthDays()},(_,i)=>i+1).filter(isWorkday);
   const work=workAnalyses().filter(a=>day.includes(a.day));
   const n=work.filter(a=>attendanceJudgment(a)==='anomaly').length;
   return +document.querySelectorAll('#scopeInsights .scope-insight-numbers strong')[2].textContent===n&&
      !!document.querySelector('#scopeCompareChart svg');
 },'R40 all-staff scoped analytics failed');
 await page.locator('#workspaceScopeGroup').selectOption({index:1});
 await check(page,()=>state.workspaceMode==='group'&&!!document.querySelector('#workspaceGroup'),'R39 left group filter did not drill down');
 await check(page,()=>!!document.querySelector('#workspaceGroup option[value=""]')&&!!document.querySelector('#scopeStatusChart svg'),
  'R41 group all-option or status composition chart missing');
 await page.screenshot({path:path.join(out,'r41-group.png')});
 await page.screenshot({path:path.join(out,'r37-group.png')});
 await check(page,()=>{
   const members=EMPLOYEES.filter(e=>groupOf(e)===state.selectedGroup).length;
   return state.workspaceMode==='group'&&members>0&&document.querySelectorAll('.m-name[data-emp]').length===members&&
      !!document.getElementById('workspaceGroup');
 },'R37 group roster does not constrain matrix');
 await page.waitForSelector('#scopeDailyChart svg',{timeout:15000});
 await check(page,()=>{
   const work=workAnalyses().filter(a=>isWorkday(a.day)&&groupOf(a.employee)===state.selectedGroup);
   const x=work.filter(a=>attendanceJudgment(a)==='absent').length;
   return Number(document.querySelectorAll('#scopeInsights .scope-insight-numbers strong')[3].textContent)===x;
 },'R40 group charts must use group-only data');
 await check(page,()=>{
  const row=document.querySelector('.matrix .m-name[data-emp]');
  const edge=document.querySelector('.matrix .m-cell[data-day="31"]');
  const frame=document.querySelector('.matrix-wrap');
  const last=edge?.getBoundingClientRect().right-frame?.getBoundingClientRect().right;
  const grid=document.querySelector('.matrix'),scroller=document.querySelector('.matrix-wrap');
   return row&&Number.isFinite(last)&&last<=-8&&last>-23&&
    scroller.scrollWidth<=scroller.clientWidth+1&&
    scroller.scrollHeight<=scroller.clientHeight+2&&
    grid.getBoundingClientRect().bottom<=scroller.getBoundingClientRect().bottom+2;
 },'R41 31st matrix column should be flush with its frame');
 await page.locator('#workspaceGroup').selectOption('');
 await check(page,()=>state.workspaceMode==='all'&&!!document.querySelector('#workspaceScopeGroup'),
  'R41 group all-option must return to full-staff analysis');
 await page.locator('#workspaceScopeGroup').selectOption({index:1});
 await page.locator('.m-name[data-emp]').first().click();
 await check(page,()=>state.workspaceMode==='group'&&state.selection.type==='person'&&
  !document.querySelector('.matrix-selection-frame.focus-row')?.classList.contains('inactive'),
  'R40 row name should not navigate out of group matrix');
 await page.locator('.m-cell button[data-cell]').first().click();
 await page.waitForSelector('#attendanceTimelineChart svg',{timeout:20000});
 await page.screenshot({path:path.join(out,'r37-person.png')});
 await check(page,()=>state.workspaceMode==='person'&&state.chartTab==='timeline'&&state.selection.type==='cell'&&!!document.getElementById('workspacePerson'),
   'R37 group-to-person drilldown failed');
 await check(page,()=>{
  const nodes=[...document.querySelectorAll('.person-day')];
  const work=nodes.find(b=>b.dataset.personDay==='9');
  const rest=nodes.find(b=>b.dataset.personDay==='11');
  const holiday=nodes.find(b=>b.dataset.personDay==='3');
  return nodes.length===monthDays()&&work?.classList.contains('work')&&
   rest?.classList.contains('rest')&&holiday?.classList.contains('holiday')&&
   !!document.getElementById('personalDayPrev')&&!!document.getElementById('personalDayNext');
 },'R40 month strip work/rest/holiday styling or navigation missing');
 await page.locator('[data-person-day="9"]').click();
 await check(page,()=>state.chartDay===9&&state.selection.day===9&&
   document.querySelector('.cal-day[data-day="9"]').classList.contains('selected')&&
   document.querySelector('.person-day[data-person-day="9"]').classList.contains('selected'),
 'R40 strip/calendar/timeline 9th day not synchronized');
 await page.locator('#personalDayNext').click();
 await check(page,()=>state.chartDay===10&&state.selection.day===10&&
   document.querySelector('.cal-day[data-day="10"]').classList.contains('selected'),'R40 next-day switch failed');
 await page.locator('.side-calendar .cal-day[data-day="11"]').click();
 await check(page,()=>state.chartDay===11&&state.selection.day===11&&
   document.querySelector('.person-day[data-person-day="11"]').classList.contains('selected'),
 'R40 left calendar must update personal month strip');
 await page.locator('#timelineDayPicker').selectOption('12');
 await check(page,()=>state.chartDay===12&&state.selection.day===12&&
  document.querySelector('.cal-day[data-day="12"]').classList.contains('selected'),
 'R40 date dropdown must share date navigator');
 // Simulated manual correction: narrow strip inherits the final status color,
 // with the violet check inside the date tile, independent of the active view.
 await page.evaluate(()=>{
  const emp=state.selection.employeeId,day=9,a=state.analysis.get(emp+'|'+day);
  state.__r40Restore={key:emp+'|'+day,old:state.manualStatuses[emp+'|'+day],mode:state.judgmentMode};
  state.manualStatuses[emp+'|'+day]=attendanceJudgmentSystem(a)==='absent'?'normal':'absent';
  render();
 });
 await check(page,()=>{
  const mark=document.querySelector('.person-day[data-person-day="9"]'),a=state.analysis.get(state.selection.employeeId+'|9');
  const tone=manualStatusFor(a);
  return !!mark.querySelector('.person-day-check')&&
    !!mark.querySelector('.person-day-status.'+tone)&&getComputedStyle(mark.querySelector('.person-day-check')).right==='1px';
 },'R40 manual override status strip check or color mismatch');
 await check(page,()=>{
  const tb=document.querySelector('.person-toolbar').getBoundingClientRect();
  const strip=document.querySelector('.person-strip').getBoundingClientRect();
  const prev=document.querySelector('#personalDayPrev').getBoundingClientRect();
  const insight=document.querySelector('.workspace-mode-person .inspector-insight').getBoundingClientRect();
  const panel=document.querySelector('.workspace-mode-person .inspector-top').getBoundingClientRect();
  return tb.height<85&&Math.abs(strip.top-tb.top)<25&&prev.right<=tb.right+1&&
   insight.width>=310&&insight.width<=panel.width*.5&&
   getComputedStyle(document.querySelector('.workspace-mode-person .analysis-head')).display==='none'&&
   !document.querySelector('#personalViewSelect')&&
   getComputedStyle(document.querySelector('.workspace-mode-person .status-control-row>span')).fontSize==='13px';
 },'R41 personal date controls must align with title and insight width must grow');
 await check(page,()=>{
  const body=document.querySelector('.workspace-mode-person .analysis-body').getBoundingClientRect();
  const top=document.querySelector('.workspace-mode-person .inspector-top').getBoundingClientRect();
  const raw=document.querySelector('.workspace-mode-person .inspector-bottom').getBoundingClientRect();
  const initial=document.querySelector('.workspace-mode-person .initial-judgment');
  const buttons=[...document.querySelectorAll('.workspace-mode-person .manual-status-buttons button')];
  const evidence=document.querySelector('.workspace-mode-person #rawPane');
  const edges=getComputedStyle(evidence);
  const frozen=document.querySelector('.workspace-mode-person .raw-table .tabulator-cell.tabulator-frozen');
  return top.height>body.height*.50&&top.height<body.height*.66&&raw.height>=160&&
    edges.borderLeftStyle==='solid'&&edges.borderRightStyle==='solid'&&
    parseFloat(edges.borderLeftWidth)===1&&parseFloat(edges.borderRightWidth)===1&&
    (!frozen||(getComputedStyle(frozen).borderRightColor==='rgb(229, 235, 240)'&&
       getComputedStyle(frozen).boxShadow==='none'))&&
    getComputedStyle(initial).fontSize==='14px'&&buttons.every(b=>b.textContent.trim().length>0);
 },'R42 six-lane and raw table height or clean judgment buttons failed');
 await page.screenshot({path:path.join(out,'r42-person.png')});
 await page.screenshot({path:path.join(out,'r41-person.png')});
 await page.screenshot({path:path.join(out,'r40-person-month-strip.png')});
 await page.setViewportSize({width:1366,height:768});
 await check(page,()=>{
  const days=document.querySelectorAll('.person-day'),bounds=document.querySelector('.person-days').getBoundingClientRect(),
   cal=document.querySelector('.side-calendar').getBoundingClientRect();
  return days.length===monthDays()&&Math.abs(days[0].getBoundingClientRect().top-days[days.length-1].getBoundingClientRect().top)<1&&
    bounds.right<=innerWidth+2&&cal.bottom<=innerHeight+2;
 },'R40 1366px personal month strip must remain one row and calendar visible');
 await page.screenshot({path:path.join(out,'r40-person-1366.png')});
 await page.setViewportSize({width:1920,height:1080});
 await page.evaluate(()=>{
  const prior=state.__r40Restore;
  if(prior.old==null)delete state.manualStatuses[prior.key];else state.manualStatuses[prior.key]=prior.old;
  state.judgmentMode=prior.mode;delete state.__r40Restore;render();
 });
 // The personal statistics tab is functional, not a decorative navigation label.
 await page.evaluate(()=>{state.chartTab='stats';renderAnalysisPanel()});
 await page.waitForSelector('#statsChartMain svg',{timeout:15000});
 await page.waitForSelector('#statsChartSecondary svg',{timeout:15000});
 await check(page,()=>{
  const charts=['statsChartMain','statsChartSecondary'].map(id=>echarts.getInstanceByDom(document.getElementById(id)));
  const full=Array.from({length:monthDays()},(_,i)=>state.analysis.get(state.selection.employeeId+'|'+(i+1))).filter(a=>isWorkday(a.day));
  const figure=charts[0]?.getOption();
  const value=Number([...document.querySelectorAll('.inspector-insight .insight-row')]
    .find(x=>x.querySelector('span')?.textContent==='有效天数')?.querySelector('strong')?.textContent);
  return state.chartTab==='stats'&&charts.every(x=>x&&!x.isDisposed()&&x.getOption().series.length>0)&&
    figure.xAxis[0].data.length===full.length&&figure.series[0].data.length===full.length&&value===full.length;
 },'R41 personal statistics must represent the entire employee month, not selected day');
 await page.screenshot({path:path.join(out,'r41-person-stats.png')});
 await page.evaluate(()=>{state.chartTab='timeline';renderAnalysisPanel()});
 await page.waitForSelector('#attendanceTimelineChart svg',{timeout:15000});
 await check(page,()=>!document.querySelector('#personalViewSelect')&&
  getComputedStyle(document.querySelector('.chart-mode-tabs')).display==='none',
  'R42 duplicate personal analysis selector must be absent');
 await page.locator('[data-workspace="data"]').click();
 try{await page.waitForSelector('#rawDataTable .tabulator-row',{timeout:10000})}
 catch(e){
   const debug=await page.evaluate(()=>({
     mode:state.workspaceMode,section:state.dataSection,tab:state.rawDataTab,
     rawLength:state.records.length,hasTable:!!document.getElementById('rawDataTable'),
     tableMarkup:document.getElementById('rawDataTable')?.outerHTML.slice(0,550),
     tabulatorCount:rawTabulator?.getDataCount(),visibleRows:document.querySelectorAll('#rawDataTable .tabulator-row').length,
     panel:document.querySelector('.data-management')?.getBoundingClientRect().toJSON(),
     tableRect:document.getElementById('rawDataTable')?.getBoundingClientRect().toJSON()
   }));
   console.error('R40_DATA_DEBUG',JSON.stringify(debug),'PAGE_ERRORS',JSON.stringify(errors));throw e;
 }
 await check(page,()=>{
  const col=rawTabulator?.getColumnDefinitions()[0];
  const cell=document.querySelector('#rawDataTable .tabulator-cell');
  const h=document.querySelector('#rawDataTable .tabulator-col-title');
  return col?.hozAlign==='center'&&col?.headerHozAlign==='center'&&
    getComputedStyle(cell).textAlign==='center'&&getComputedStyle(h).textAlign==='center';
 },'R41 raw table headers and values should be centered');
 await page.screenshot({path:path.join(out,'r37-data.png')});
 await check(page,()=>getComputedStyle(document.querySelector('.workspace-mode-data .analysis-head')).display==='none',
 'R39 duplicate data heading');
 await page.locator('.workspace-mode-data .cal-day[data-day="9"]').click();
 await page.waitForFunction(()=>state.workspaceMode==='data'&&state.selection.type==='date'&&state.selection.day===9&&
  !!rawTabulator&&rawTabulator.getDataCount()<state.records.length,null,{timeout:12000});
 await check(page,()=>state.workspaceMode==='data'&&state.selection.type==='date'&&state.selection.day===9&&
   rawTabulator.getData().every(r=>(r.datetime||'').slice(0,10)==='2026-10-09')&&
   rawTabulator.getDataCount()<state.records.length,
 'R39 data-management calendar must filter source records');
 await page.locator('.workspace-mode-data #clearSelection').click();
 await page.waitForFunction(()=>state.workspaceMode==='data'&&state.selection.type==='overall'&&
  !!rawTabulator&&rawTabulator.getDataCount()===state.records.length,null,{timeout:12000});
 await check(page,()=>state.workspaceMode==='data'&&state.selection.type==='overall'&&
   rawTabulator.getDataCount()===state.records.length,
 'R39 clearing date must preserve current workspace');
 await check(page,()=>state.workspaceMode==='data'&&!!document.querySelector('.side-calendar')&&
   rawTabulator?.getDataCount()===state.records.length,'R37 data page evidence browser missing');
 await page.locator('[data-data-section="roster"]').click();
 await check(page,()=>document.querySelectorAll('.data-roster-row').length===EMPLOYEES.length,
  'R37 data management missing real roster');
 await page.screenshot({path:path.join(out,'r37-roster.png')});
 await page.locator('[data-data-section="rules"]').click();
 await check(page,()=>document.querySelectorAll('.data-rules-grid>div').length===6&&!!document.getElementById('dataEditRules'),
  'R37 data management missing rules');
 await page.locator('[data-data-section="imports"]').click();
 await check(page,()=>!!document.querySelector('.data-import-history'),'R37 imports not available');
 await page.locator('[data-data-section="records"]').click();
 await page.waitForSelector('#rawDataTable .tabulator-row',{timeout:15000});
 // R37: all-staff layout remains usable at 1366x768 without horizontal page clipping.
 await page.setViewportSize({width:1366,height:768});
 await page.locator('[data-workspace="all"]').click();
 await check(page,()=>{
   const matrix=document.querySelector('.matrix-wrap').getBoundingClientRect();
   return matrix.right<=innerWidth+2&&document.documentElement.scrollWidth<=innerWidth+3&&
    !!document.querySelector('#scopeInsights .scope-insight-numbers');
 },'R37 1366px all-staff viewport overflow');
 await check(page,()=>{
   const cal=document.querySelector('.side-calendar').getBoundingClientRect(),
   matrix=document.querySelector('.matrix').getBoundingClientRect(),
   wrap=document.querySelector('.matrix-wrap').getBoundingClientRect();
   return cal.bottom<=innerHeight+2&&matrix.width>wrap.width*.94&&matrix.width<=wrap.width+6;
 },'R39 1366 calendar visibility or horizontal matrix use');
 await page.screenshot({path:path.join(out,'r37-all-1366.png')});
 await page.setViewportSize({width:1920,height:1080});
 // R49: workday lunch anomalies and candidate overtime are conservative,
 // derived-only measurements. Synthetic data never enters the saved working set.
 await check(page,()=>{
  const previous={
   records:state.records,leaves:state.leaves,trips:state.trips,outings:state.outings,
   overtimeEntries:state.overtimeEntries,threshold:RULES.overtimeMinMinutes
  };
  const emp=EMPLOYEES[0],day=8,date=isoDate(day),restDay=11;
  const make=(d,sequence)=>sequence.map(([time,direction],i)=>({
   employeeId:emp.id,datetime:isoDate(d)+' '+time,time,direction,recordId:'r49:'+i
  }));
  const dayResult=(d,sequence,registered=[],leaves=[])=>{
   state.records=make(d,sequence);state.overtimeEntries=registered;state.leaves=leaves;
   return analyzeDay(emp,d);
  };
  const split=[['08:25','进'],['12:04','出'],['13:56','进'],['17:35','出']];
  const fail=(caseName,detail)=>{throw Error('R49_CASE '+caseName+' '+JSON.stringify(detail))};
  try{
   state.trips=[];state.outings=[];RULES.overtimeMinMinutes=30;
   const ordinary=dayResult(day,split);
   if(ordinary.severity!=='normal'||ordinary.workMinutes!==420||
     ordinary.autoOvertime.minutes!==0||ordinary.lunchEvidence!=='有午休进出')return fail('ordinary',{severity:ordinary.severity,work:ordinary.workMinutes,auto:ordinary.autoOvertime,lunch:ordinary.lunchEvidence,issues:ordinary.issues});
   const continuous=dayResult(day,[['08:25','进'],['19:00','出']]);
   if(continuous.workMinutes!==420||continuous.autoOvertime.minutes!==90||
     continuous.lunchEvidence!=='未分段（工时按班次扣午休）')return fail('continuous',{work:continuous.workMinutes,auto:continuous.autoOvertime,lunch:continuous.lunchEvidence});
   const lateLunch=dayResult(day,[['08:25','进'],['12:00','出'],['14:17','进'],['17:35','出']]);
   if(lateLunch.severity!=='suspect'||!lateLunch.issues.some(x=>x.includes('午休返岗'))||
     lateLunch.issues.some(x=>x==='迟到'||x==='早退'))return fail('lateLunch',{severity:lateLunch.severity,issues:lateLunch.issues});
   const missingPm=dayResult(day,[['08:25','进'],['12:00','出'],['14:00','进']]);
   if(missingPm.severity!=='suspect'||missingPm.issues.includes('早退')||
     missingPm.autoOvertime.minutes!==0)return fail('missingPm',{severity:missingPm.severity,issues:missingPm.issues,auto:missingPm.autoOvertime});
   const noonOnly=dayResult(day,[['08:25','进'],['12:00','出']]);
   if(noonOnly.severity!=='suspect'||noonOnly.issues.includes('早退'))return fail('noonOnly',{severity:noonOnly.severity,issues:noonOnly.issues});
   const afterHours=dayResult(day,[['08:25','进'],['12:04','出'],['13:56','进'],['19:00','出']]);
   if(afterHours.autoOvertime.minutes!==90||afterHours.workMinutes!==420)return fail('afterHours',{auto:afterHours.autoOvertime,work:afterHours.workMinutes});
   const originalAnalysis=state.analysis;
   try{
    state.analysis=new Map([[emp.id+'|'+day,afterHours]]);
    const ledger=asStatLedger(),get=(metric)=>asStatValue(ledger,'overtime',metric,[emp],[day]);
    if(get('candidateHours')!==1.5||get('candidateDays')!==1||
       get('candidatePeople')!==1||get('hours')!==0||get('count')!==0)
      return fail('statistics',{hours:get('candidateHours'),days:get('candidateDays'),people:get('candidatePeople'),registeredHours:get('hours')});
    if(!timelineFullInsightHtml(afterHours).includes('加班候选')||
       !timelineBehaviorSummaryRow(afterHours,'overtime').includes('推算待核'))
      return fail('visualSummary','not labeled as candidate');
    if(workingPayload().rules.overtimeMinMinutes!==30||
       !settingsContent('rules').includes('r14OvertimeMin'))
      return fail('settings','threshold missing from persisted rules or settings');
   }finally{state.analysis=originalAnalysis}
   const recorded=dayResult(day,[['08:25','进'],['19:00','出']],
     [{id:'registered',employeeId:emp.id,date,start:'18:00',end:'19:00'}]);
   if(recorded.autoOvertime.minutes!==30||!recorded.autoOvertime.reason.includes('扣除'))
     return fail('registeredPartialOverlap',recorded.autoOvertime);
   const fullRegistered=dayResult(day,[['08:25','进'],['19:00','出']],
     [{id:'full',employeeId:emp.id,date,start:'17:30',end:'19:00'}]);
   if(fullRegistered.autoOvertime.minutes!==0||!fullRegistered.autoOvertime.reason.includes('已登记'))
     return fail('registeredFullOverlap',fullRegistered.autoOvertime);
   const duplicateRegistered=dayResult(day,[['08:25','进'],['19:00','出']],[
     {id:'overlap1',employeeId:emp.id,date,start:'17:30',end:'18:45'},
     {id:'overlap2',employeeId:emp.id,date,start:'18:30',end:'19:00'}]);
   if(duplicateRegistered.autoOvertime.minutes!==0)
     return fail('registeredUnionNoDoubleSubtraction',duplicateRegistered.autoOvertime);
   const boundedRegistered=dayResult(day,[['08:25','进'],['19:00','出']],
     [{id:'middle',employeeId:emp.id,date,start:'18:00',end:'18:20'}]);
   if(boundedRegistered.autoOvertime.minutes!==70)
     return fail('registeredMiddleGap',boundedRegistered.autoOvertime);
   const threshold=dayResult(day,[['08:25','进'],['17:52','出']]);
   if(threshold.autoOvertime.minutes!==0||threshold.autoOvertime.rawMinutes!==22)return fail('threshold',threshold.autoOvertime);
   RULES.overtimeMinMinutes=15;
   const lowered=dayResult(day,[['08:25','进'],['17:52','出']]);
   if(lowered.autoOvertime.minutes!==22)return fail('lowered',lowered.autoOvertime);
   RULES.overtimeMinMinutes=30;
   const rest=dayResult(restDay,[['09:00','进'],['15:00','出']]);
   if(rest.autoOvertime.minutes!==240||rest.workMinutes!==240)return fail('rest',{auto:rest.autoOvertime,work:rest.workMinutes,dayType:dayType(restDay)});
   const restIncomplete=dayResult(restDay,[['09:00','进']]);
   if(restIncomplete.autoOvertime.minutes!==0||restIncomplete.severity!=='suspect')return fail('restIncomplete',{severity:restIncomplete.severity,auto:restIncomplete.autoOvertime});
   const excused=dayResult(day,[['08:25','进'],['12:00','出'],['14:25','进'],['17:35','出']],[],
     [{employeeId:emp.id,date,start:'14:00',end:'14:25'}]);
   if(excused.issues.some(x=>x.includes('午休返岗')))return fail('excused',excused.issues);
   return true;
  }finally{
   Object.assign(state,{
    records:previous.records,leaves:previous.leaves,trips:previous.trips,
    outings:previous.outings,overtimeEntries:previous.overtimeEntries
   });
   RULES.overtimeMinMinutes=previous.threshold;
  }
 },'R49 lunch clock-gap evidence, threshold, registered-event exclusion and inferred overtime failed');
 // R50: the two-layer sidebar, browser-like workspace history and redundant
 // statistical normalizations are visible and functionally connected.
 await check(page,()=>{
   const buttons=[...document.querySelectorAll('.side-primary-nav .side-views button')];
   const label=document.querySelector('.side-refinements-title');
   return buttons.length===2&&buttons[0].textContent.includes('01')&&
     buttons[1].textContent.includes('02')&&label?.textContent==='辅助筛选'&&
     !!document.getElementById('asNavBack')&&!!document.getElementById('asNavForward');
 },'R50 primary/subordinate sidebar hierarchy or history controls missing');
 await check(page,()=>{
   const initial=asNavSnapshot(),next=initial.workspaceMode==='person'?'all':'person';
   navigateWorkspace(next);
   if(asNavHistory.back.length===0||document.getElementById('asNavBack').disabled)return false;
   asNavGo('back');
   const back=asNavSnapshot();
   if(back.workspaceMode!==initial.workspaceMode||back.analyticsPage!==initial.analyticsPage||
     JSON.stringify(back.selection)!==JSON.stringify(initial.selection))return false;
   if(document.getElementById('asNavForward').disabled)return false;
   asNavGo('forward');
   if(state.workspaceMode!==next)return false;
   asNavGo('back');
   return state.workspaceMode===initial.workspaceMode;
 },'R50 backward/forward workspace and selection history failed');
 await check(page,()=>{
   const original={workspaceMode:state.workspaceMode,statsConfig:state.statsConfig,
     selection:state.selection};
   try{
    state.workspaceMode='person';state.selection={type:'cell',employeeId:EMPLOYEES[0].id,day:1};
    state.statsConfig={family:'overtime',metric:'candidatePeople',compare:'days',
      aggregate:'perPerson',chart:'bar',limit:10,sort:'desc'};
    const person=asStatPrefs();
    if(person.metric==='candidatePeople'||person.aggregate==='perPerson')return false;
    state.workspaceMode='all';state.statsConfig={...state.statsConfig,family:'leave',
      metric:'people',compare:'people',aggregate:'perPerson'};
    const ranked=asStatPrefs();
    if(ranked.metric==='people'||ranked.aggregate==='perPerson')return false;
    const ledger=new Map();
    const data=asStatRows();
    if(data.rankRows.some(row=>row.raw<=0))return false;
    return true;
   }finally{
    state.workspaceMode=original.workspaceMode;
    state.selection=original.selection;state.statsConfig=original.statsConfig;
   }
 },'R50 redundant zero/one metrics, duplicate per-person normalization or zero rankings');
 await check(page,()=>{
   const old=asNavSnapshot();
   state.analyticsPage='stats';render();
   const label=document.querySelector('.as-stats-filters label');
   const select=label?.querySelector('select');
   const aligned=!!select&&Math.abs(select.getBoundingClientRect().top-
     label.getBoundingClientRect().top)<16&&
     getComputedStyle(label).gridTemplateColumns.split(' ').length>=2;
   asNavGo('back');
   return aligned&&state.analyticsPage===old.analyticsPage;
 },'R50 statistics labels are not horizontally aligned with selects');
 // R51: selected primary view highlights text only; index is not a nested tile.
 await check(page,()=>{
  const active=document.querySelector('.side-primary-nav .side-views button.active');
  const index=active?.querySelector('.side-view-index');
  const refinements=document.querySelector('.side-refinements');
  const views=document.querySelector('.side-primary-nav');
  const style=active&&getComputedStyle(active),num=index&&getComputedStyle(index);
  return !!style&&!!num&&style.backgroundColor==='rgba(0, 0, 0, 0)'&&
   parseFloat(style.borderTopWidth)===0&&num.backgroundColor==='rgba(0, 0, 0, 0)'&&
   refinements.getBoundingClientRect().left>views.getBoundingClientRect().left+12;
 },'R51 active sidebar view must be a text highlight, not enclosing boxes');
 await check(page,()=>{
  const a=document.getElementById('asNavBack'),b=document.getElementById('asNavForward');
  return a.querySelector('svg path')&&b.querySelector('svg path')&&
    getComputedStyle(a).borderWidth==='0px'&&
    getComputedStyle(a.closest('.top-history')).backgroundColor==='rgba(0, 0, 0, 0)';
 },'R51 unobtrusive icon navigation must not render boxed arrows');
 // Popup open/close must not move the top-level controls or create document overflow.
 const headerBefore=await page.evaluate(()=>{
  const nav=document.querySelector('.workspace-navigation').getBoundingClientRect();
  const month=document.getElementById('monthMenuButton').getBoundingClientRect();
  return {navX:nav.x,monthX:month.x,top:month.top};
 });
 await page.locator('#importBtn').click();
 await check(page,()=>getComputedStyle(document.getElementById('importPopover')).position==='absolute'&&
   document.getElementById('importPopover').classList.contains('open'),
   'R51 import menu must be an overlay');
 await page.locator('#monthMenuButton').click();
 await check(page,()=>getComputedStyle(document.getElementById('monthPopover')).position==='absolute'&&
   document.getElementById('monthPopover').classList.contains('open'),
   'R51 month dropdown must be an overlay');
 await page.locator('#monthMenuButton').click();
 await page.locator('#statusFilterButton').click();
 await check(page,()=>getComputedStyle(document.getElementById('statusFilterMenu')).position==='absolute'&&
   document.getElementById('statusFilterMenu').classList.contains('open'),
   'R51 sidebar dropdown must float over calendar');
 await page.locator('#statusFilterButton').click();
 await check(page,expected=>{
  const nav=document.querySelector('.workspace-navigation').getBoundingClientRect();
  const month=document.getElementById('monthMenuButton').getBoundingClientRect();
  return Math.abs(nav.x-expected.navX)<1&&Math.abs(month.x-expected.monthX)<1&&
   Math.abs(month.top-expected.top)<1&&
   document.documentElement.scrollWidth<=innerWidth+3;
 },headerBefore,'R51 popup toggles displaced the top bar or introduced sideways overflow');
 await check(page,()=>{
  const colors=asSoftBarGradient(true).colorStops;
  return colors.length===3&&colors.every(x=>x.color.startsWith('rgba('))&&
   getComputedStyle(document.documentElement).scrollbarGutter==='stable';
 },'R51 translucent non-blue bars and stable viewport gutter missing');
 // R45: test the shared ledger before rendering charts. Every imported event is
 // represented once, including multi-day trips that span several person-days.
 await check(page,()=>{
  const ledger=asStatLedger(),people=EMPLOYEES,days=Array.from({length:monthDays()},(_,i)=>i+1);
  const counts=k=>asStatValue(ledger,k,'count',people,days);
  const eligible=state.records.filter(r=>r.datetime.startsWith(monthISO()+'-')&&people.some(e=>e.id===r.employeeId)).length;
  const distinctPunchPeople=new Set(state.records.filter(r=>r.datetime.startsWith(monthISO()+'-')).map(r=>r.employeeId)).size;
  return counts('punch')===eligible&&asStatValue(ledger,'punch','people',people,days)===distinctPunchPeople&&counts('leave')===state.leaves.length&&
    counts('trip')===state.trips.length&&counts('outing')===state.outings.length&&
    counts('overtime')===state.overtimeEntries.length&&
    asStatValue(ledger,'trip','days',people,days)>=counts('trip')&&
    asStatValue(ledger,'trip','estimatedHours',people,days)>0;
 },'R45 event ledger counts, trip days or time units inconsistent');
 // R45 iteration 3: independently inject overlapping mock events; original working
 // rows are restored in a finally block and are never written to raw/snapshot.
 await check(page,()=>{
  const prior={leaves:state.leaves,trips:state.trips,outings:state.outings,overtimeEntries:state.overtimeEntries};
  const id=EMPLOYEES[0].id,who=[EMPLOYEES[0]],day=9,all=Array.from({length:monthDays()},(_,i)=>i+1);
  try{
   state.leaves=[
    {id:'R45-L1',employeeId:id,date:isoDate(day),start:'08:30',end:'10:30'},
    {id:'R45-L2',employeeId:id,date:isoDate(day),start:'09:00',end:'11:00'}];
   state.trips=[
    {id:'R45-T1',employeeId:id,startDate:isoDate(9),endDate:isoDate(10)},
    {id:'R45-T2',employeeId:id,startDate:isoDate(10),endDate:isoDate(12)}];
   state.outings=[
    {id:'R45-O1',employeeId:id,startDate:isoDate(day),endDate:isoDate(day),start:'13:00',end:'14:00'},
    {id:'R45-O2',employeeId:id,startDate:isoDate(day),endDate:isoDate(day),start:'13:30',end:'14:30'}];
   state.overtimeEntries=[
    {id:'R45-OT1',employeeId:id,date:isoDate(day),start:'18:00',end:'19:00'},
    {id:'R45-OT2',employeeId:id,date:isoDate(day),start:'18:30',end:'19:30'}];
   const fact=asStatLedger(),get=(k,m,days=[day])=>asStatValue(fact,k,m,who,days);
   return Math.abs(get('leave','hours')-2.5)<1e-8&&get('leave','count')===2&&
     Math.abs(get('outing','hours')-1.5)<1e-8&&get('outing','count')===2&&
     Math.abs(get('overtime','hours')-1.5)<1e-8&&get('overtime','count')===2&&
     get('trip','days',all)===4&&get('trip','count',all)===2&&
     get('trip','people',[10])===1&&get('trip','people',[11])===1&&
     get('trip','people',[12])===1&&get('trip','people',[13])===0&&
     get('trip','people',all)===1&&
     get('leave','people',[day])===1&&get('outing','people',[day])===1&&
     get('overtime','people',[day])===1&&
     Math.abs(get('trip','estimatedHours',all)-asStatWorkMinutes()*3/60)<1e-8;
  }finally{Object.assign(state,prior)}
 },'R45 overlap union or multi-day trip counting inconsistent');
 await check(page,()=>{
  const item=[...state.analysis.values()].find(a=>isWorkday(a.day)&&attendanceJudgmentSystem(a)==='normal');
  if(!item)return false;
  const id=item.employee.id,day=item.day,person=[item.employee],key=id+'|'+day;
  const previous=state.manualStatuses[key],mode=state.judgmentMode;
  try{
   state.judgmentMode='initial';
   const prior=asStatValue(asStatLedger(),'status','normal',person,[day]);
   state.manualStatuses[key]='absent';state.judgmentMode='manual';
   const manual=asStatLedger();
   return prior===1&&asStatValue(manual,'status','normal',person,[day])===0&&
     asStatValue(manual,'status','absent',person,[day])===1;
  }finally{
   if(previous==null)delete state.manualStatuses[key];else state.manualStatuses[key]=previous;
   state.judgmentMode=mode;
  }
 },'R45 initial/manual status facts must share one verdict source');
 await page.locator('.workspace-mode-all [data-as-view="stats"]').click();
 await page.waitForSelector('#asStatChart svg',{timeout:20000});
 await check(page,()=>state.analyticsPage==='stats'&&state.workspaceMode==='all'&&
   document.querySelector('.as-stats')&&document.querySelectorAll('.side-views button').length===2&&
   !!echarts.getInstanceByDom(document.getElementById('asStatChart'))&&
   !document.querySelector('.stats-active .workbench')?.getBoundingClientRect().height,
  'R45 all-staff statistics view missing or old matrix not hidden');
 await check(page,()=>{
  const chart=document.querySelector('.as-stats-chart').getBoundingClientRect();
  const rank=document.querySelector('.as-stats-rank').getBoundingClientRect();
  return chart.width>400&&rank.width>=270&&rank.left>chart.left&&
    document.documentElement.scrollWidth<=innerWidth+3;
 },'R45 1920 analytics layout overflow');
 // Empty categories must be visibly empty instead of manufacturing 0-value ranks.
 await check(page,()=>{
  const prev=state.outings,cfg={...state.statsConfig};
  try{
   state.outings=[];state.statsConfig.family='outing';state.statsConfig.metric='hours';
   state.statsConfig.compare='days';renderStatisticsWorkspace();
   return asStatRows().rankRows.length===0&&
    !!document.querySelector('.as-stats-empty')&&
    document.querySelector('.as-stats-chart').classList.contains('is-empty')&&
    document.querySelectorAll('.as-stats-rank-row').length===0;
  }finally{
   state.outings=prev;state.statsConfig=cfg;renderStatisticsWorkspace();
  }
 },'R45 empty dataset must have an honest no-record state');
 await check(page,()=>document.querySelector('[data-as-chart="bar"]').getAttribute('aria-pressed')==='true',
 'R47 chart toggle must communicate selected mode');
 await page.locator('#asStatFamily').focus();
 await page.locator('#asStatFamily').selectOption('trip');
 await check(page,()=>document.activeElement?.id==='asStatFamily'&&
  !!document.querySelector('#asStatChart svg'),'R47 changing a metric must retain focus and chart');
 await page.locator('#asStatFamily').selectOption('leave');
 await page.locator('.as-stats-rank-row').first().hover();
 await check(page,()=>document.querySelector('.as-stats-rank-row.is-linked')!==null,
 'R47 rank hover must connect to plotted comparison');
 await page.locator('#asStatsExport').hover();
 await check(page,()=>document.querySelector('.as-stats-rank-row.is-linked')===null,
 'R47 rank highlight must clear on pointer exit');
 await page.screenshot({path:path.join(out,'r45-all-stats-1920.png')});
 await page.locator('#asStatFamily').selectOption('overtime');
 await page.locator('#asStatMetric').selectOption('hours');
 await page.locator('#asStatCompare').selectOption('groups');
 await page.locator('#asStatAggregate').selectOption('perPerson');
 await check(page,()=>{
  const data=asStatRows(),all=Array.from({length:monthDays()},(_,i)=>i+1),
    full=asStatValue(data.ledger,'overtime','hours',EMPLOYEES,all);
  const grouped=data.rows.reduce((sum,r)=>sum+r.raw,0);
  return data.compare==='groups'&&Math.abs(full-grouped)<1e-6&&
    data.rows.every(r=>Math.abs(r.value-(r.peopleCount?r.raw/r.peopleCount:0))<1e-8);
 },'R45 per-capita group ranking must reconcile with the whole workforce');
 await page.locator('[data-as-chart="line"]').click();
 await check(page,()=>state.statsConfig.chart==='line'&&
  echarts.getInstanceByDom(document.getElementById('asStatChart')).getOption().series[0].type==='line',
 'R45 chart-type switch failed');
 await page.locator('#asStatCompare').selectOption('days');
 await page.locator('#asStatLimit').selectOption('5');
 await check(page,()=>{
  const d=asStatRows(),ranking=d.rankRows,shown=document.querySelectorAll('.as-stats-rank-row').length;
  return d.rows.length===monthDays()&&d.visible.length===monthDays()&&
   ranking.length<=5&&shown===ranking.length&&
   ranking.every(r=>r.value>0)&&ranking.every((r,i)=>!i||r.value<=ranking[i-1].value);
 },'R45 date chart must remain chronological while its ranking is positive-only and sorted');
 await page.locator('#asStatCompare').selectOption('groups');
 await page.locator('[data-as-chart="bar"]').click();
 const exported=page.waitForEvent('download');
 await page.locator('#asStatsExport').click();
 const csv=await exported;
 if(!csv.suggestedFilename().includes('overtime'))throw Error('R45 statistics export filename incorrect');
 await page.setViewportSize({width:1366,height:768});
 await check(page,()=>{
  const region=document.querySelector('.as-stats'),buttons=document.querySelector('.as-stats-rank-table');
  const filters=[...document.querySelectorAll('.as-stats-filters label')];
  const top=filters[0].getBoundingClientRect().top;
  const line=filters.every(e=>Math.abs(e.getBoundingClientRect().top-top)<2&&
    e.getBoundingClientRect().width>=155);
  const visible=filters.every(e=>{
    const select=e.querySelector('select'),rect=select.getBoundingClientRect();
    return rect.right<=region.getBoundingClientRect().right&&rect.left>=region.getBoundingClientRect().left;
  });
  const widths=Object.fromEntries(['Family','Metric','Compare','Aggregate','Limit'].map(k=>
    [k,document.getElementById('asStat'+k)?.getBoundingClientRect().width||0]));
  const compact=widths.Family<=130&&widths.Metric<=225&&widths.Compare<=150&&
    widths.Aggregate<=165&&widths.Limit<=110;
  return region.getBoundingClientRect().right<=innerWidth+1&&buttons.getBoundingClientRect().width>=250&&
    line&&visible&&compact&&document.documentElement.scrollWidth<=innerWidth+3;
 },'R48 1366: five filters must fit one row without clipping or horizontal page scroll');
 await page.waitForTimeout(380); // screenshot after the deliberate short ECharts transition, never a correctness check
 await page.screenshot({path:path.join(out,'r48-all-stats-1366.png')});
 await page.screenshot({path:path.join(out,'r45-all-stats-1366.png')});
 await page.setViewportSize({width:1600,height:900});
 await check(page,()=>{
  const controls=[...document.querySelectorAll('.as-stats-filters label')];
  const y=controls[0].getBoundingClientRect().top;
  return controls.length===5&&controls.every(x=>Math.abs(x.getBoundingClientRect().top-y)<2);
 },'R48 1600 one-row filter regression');
 await page.waitForTimeout(350);
 await page.screenshot({path:path.join(out,'r48-all-stats-1600.png')});
 await page.screenshot({path:path.join(out,'r45-all-stats-1600.png')});
 await page.setViewportSize({width:1920,height:1080});
 // Ranked groups open that group's analytics without losing the shared metric.
 await page.locator('.as-stats-rank-row').first().click();
 await page.waitForSelector('#asStatChart svg',{timeout:15000});
 await check(page,()=>state.workspaceMode==='group'&&state.analyticsPage==='stats'&&
  state.statsConfig.compare==='people'&&asStatRows().people.every(e=>groupOf(e)===state.selectedGroup),
  'R45 group comparison drilldown did not scope to group');
 await page.locator('#asStatCompare').selectOption('groups');
 await check(page,()=>{
  const data=asStatRows(),all=Array.from({length:monthDays()},(_,i)=>i+1);
  const total=asStatValue(data.ledger,state.statsConfig.family,state.statsConfig.metric,EMPLOYEES,all);
  return data.people.length===EMPLOYEES.length&&data.rows.length===workspaceGroups().length&&
    Math.abs(data.rows.reduce((x,r)=>x+r.raw,0)-total)<1e-8;
 },'R45 cross-group mode must include all groups, not only the selected team');
 await page.locator('#asStatCompare').selectOption('people');
 await check(page,()=>asStatRows().people.every(e=>groupOf(e)===state.selectedGroup),
  'R45 back to group-member comparison must restore group scope');
 await page.screenshot({path:path.join(out,'r45-group-stats.png')});
 await page.locator('.as-stats-rank-row').first().click();
 await page.waitForSelector('#asStatChart svg',{timeout:15000});
 await check(page,()=>state.workspaceMode==='person'&&state.analyticsPage==='stats'&&
  state.statsConfig.compare==='days'&&state.statsConfig.chart==='line'&&
  state.statsConfig.aggregate==='total'&&asStatRows().people.length===1,
  'R45 group member drilldown not scoped to individual');
 await page.screenshot({path:path.join(out,'r45-person-stats.png')});
 const rankedDay=Number(await page.locator('.as-stats-rank-row').first().getAttribute('data-as-rank'));
 if(!rankedDay)throw Error('R45 expected a real, nonzero daily metric in the selected demo employee');
 await page.locator('.as-stats-rank-row').first().click();
 await page.waitForSelector('#attendanceTimelineChart svg',{timeout:16000});
 await check(page,day=>state.workspaceMode==='person'&&state.analyticsPage==='main'&&
  state.chartDay===day&&state.selection.day===day&&
  document.querySelector('.cal-day[data-day="'+day+'"].selected')!==null,
 rankedDay,'R45 ranked nonzero day must open the matching timeline and calendar');
 // Legacy matrix/time-axis QA below starts from the normal All view.
 await page.locator('[data-workspace="all"]').click();
 await check(page,()=>state.workspaceMode==='all'&&state.analyticsPage==='main'&&
  asStatCSVCell('=HYPERLINK("x")').startsWith('"\'='),'R45 matrix reset or CSV formula escaping failed');
 // R36: malformed timestamps must be rejected, and final export cannot depend
 // on whether the operator is currently viewing the initial or manual layer.
 await check(page,()=>{
   if(strictISODate('2026-02-30')||strictISODate('2026-10-32'))return false;
   if(strictDateTime('2026-10-09 08:30:00junk'))return false;
   try{importClock('08:30garbage','08:00');return false}catch(e){}
   const a=[...state.analysis.values()].find(x=>isWorkday(x.day)&&attendanceJudgmentSystem(x)==='normal');
   const key=a.employee.id+'|'+a.day;
   const prev=state.manualStatuses[key],mode=state.judgmentMode;
   state.manualStatuses[key]='absent';state.judgmentMode='initial';
   const row=traditionalRows().find(x=>x.姓名===a.employee.name&&x.日期===a.date);
   if(prev==null)delete state.manualStatuses[key];else state.manualStatuses[key]=prev;
   state.judgmentMode=mode;
   return row.系统判定==='正常'&&row.最终判定==='缺勤';
 },'R36 date validation or export verdict not independent of display mode');
 // Preserve the R29-R34 visual/behavior regression suite in a private compatibility mode.
 await page.evaluate(()=>{state.workspaceMode='classic';state.selection={type:'overall'};state.chartTab='overview';render()});
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
    Math.abs(layout.sidebar-212)>1||Math.abs(layout.frame-893)>2||layout.ratio<3.4||layout.ratio>7.5||
    layout.visibleRaw!==layout.recordCount)throw Error('Desktop layout/data regression');
 await check(page,()=>!!document.getElementById('statusFilter')&&!!document.getElementById('statusFilterButton')&&document.querySelectorAll('[data-filter-value]').length===8&&!!document.getElementById('settingsBtn')&&
    !document.querySelector('.raw-page-controls')&&
    document.querySelectorAll('.calendar-key span').length===3,'R13 controls not mounted');
 await check(page,()=>document.querySelector('.save-state.saved b')?.textContent==='✓'&&!document.querySelector('.save-state i'),'Save state should be semantic, not an unexplained dot');
 await check(page,()=>{
   const head=document.querySelector('.analysis-head').getBoundingClientRect();
   const insight=document.querySelector('.inspector-insight').getBoundingClientRect();
   return head.height<=35&&insight.width>=148&&insight.width<=160;
 },'Right title or R25 compact insight geometry regressed');
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
 await check(page,()=>{
   const statuses=Object.values(ATTEND_STATUS_COLORS).filter(x=>x!==ATTEND_STATUS_COLORS.rest);
   const behaviors=Object.values(ATTEND_BEHAVIOR_COLORS),events=Object.values(ATTEND_EVENT_COLORS);
   return categoryColor('anomaly')==='#e6c36f'&&categoryColor('absent')==='#e58f90'&&categoryColor('normal')==='#78caa0'&&
     ATTEND_BEHAVIOR_COLORS.leave==='#8a6fd1'&&ATTEND_BEHAVIOR_COLORS.outing==='#3c9dc4'&&
     ATTEND_EVENT_COLORS.in==='#1f5a9f'&&ATTEND_EVENT_COLORS.out==='#8a5b3d'&&
     new Set([...statuses,...behaviors,...events]).size===statuses.length+behaviors.length+events.length;
 },'Judgment, behavior and punch palettes must stay visually unique');
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
  return c.borderLeftWidth==='0px'&&c.transform==='none'&&
   c.backgroundColor.includes('130, 87, 217')&&getComputedStyle(name.querySelector('.name-letters')).transform!=='none'&&
   parseInt(getComputedStyle(name.querySelector('.name-letters span')).fontWeight)<600;
 },'Name anchor should use violet tint without a second border');
 await page.locator('.m-date[data-date="10"]').click();
 await check(page,()=>state.selection.type==='date'&&state.selection.day===10&&
   !document.querySelector('.matrix-selection-frame.focus-col').classList.contains('inactive'),
   'Clicking top date must select all employees');
 await check(page,()=>{
   const date=document.querySelector('.m-date.selected'),c=getComputedStyle(date),b=getComputedStyle(date.querySelector('b'));
   return c.borderTopWidth==='0px'&&c.transform==='none'&&c.backgroundColor.includes('130, 87, 217')&&b.transform!=='none'&&b.borderTopWidth==='0px';
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
 await check(page,()=>{
   const matrix=document.getElementById('matrix');
   const unrelated=document.querySelector('.m-cell:not(.row-focus):not(.col-focus)');
   const cross=document.querySelector('.m-cell.row-focus:not(.cell-focus)');
   const focus=document.querySelector('.m-cell.cell-focus');
   return matrix.classList.contains('focus-cell')&&
     parseFloat(getComputedStyle(unrelated).opacity)<.35&&
     parseFloat(getComputedStyle(cross).opacity)>.5&&
     parseFloat(getComputedStyle(focus).opacity)>.95;
 },'Matrix focus should dim unrelated cells and preserve the selected cross');
 await page.screenshot({path:path.join(out,'r29-primary-timeline.png')});
 await check(page,()=>{
  const data=r14TrackData(plotAnalysis(analysisContext())),tr=data.tracks.map(x=>x.key);
  const bars=document.querySelectorAll('.r15-punch-stack').length;
  return JSON.stringify(tr)===JSON.stringify(['in','out','trip','leave','outing','overtime'])&&
    data.events.every(e=>e.value[1]===(e.direction==='进'?0:1))&&
    bars>0&&!!document.getElementById('r15PunchPreview')&&!document.querySelector('.r15-punch-dot');
 },'R24 six-lane timeline order or punch overview incorrect');
 await check(page,()=>{
   const dup=[...state.analysis.values()].find(a=>a.punches.some(p=>p.scenario==='rapid-swipes'));
   if(!dup)return false;
   const range={start:520,end:600};
   const coarse=r14TrackData(dup,range,240).events,fine=r14TrackData(dup,range,1600).events;
   return coarse.length>0&&fine.length>coarse.length&&
     fine.every(g=>g.records.every(p=>minutes(p.time)>=range.start&&minutes(p.time)<=range.end));
 },'Repeated punches are not clustered in the event model');

 await check(page,()=>{
  const ctx=analysisContext(),a=plotAnalysis(ctx),data=r14TrackData(a);
  const frames=document.querySelectorAll('.matrix-selection-frame:not(.inactive)');
  const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));
  const opt=chart.getOption(),zoom=opt.dataZoom;
  const ticks=document.querySelectorAll('.r23-mini-ticks span'),preview=document.getElementById('r15PunchPreview');
  const bar=preview?.querySelector('.r15-punch-stack i');
  const slider=zoom.find(z=>z.type==='slider'),keys=data.tracks.map(t=>t.key);
  const labels=[...document.querySelectorAll('#attendanceTimelineChart svg text')].filter(x=>['出差','请假','外出','加班'].includes(x.textContent.trim()));
  const expected={出差:ATTEND_BEHAVIOR_COLORS.trip,请假:ATTEND_BEHAVIOR_COLORS.leave,外出:ATTEND_BEHAVIOR_COLORS.outing,加班:ATTEND_BEHAVIOR_COLORS.overtime};
  const rgb=v=>{const m=/^#([0-9a-f]{6})$/i.exec(v);if(!m)return v;const n=parseInt(m[1],16);return 'rgb('+(n>>16)+', '+((n>>8)&255)+', '+(n&255)+')'};
  return frames.length===2&&[...frames].every(x=>x.classList.contains('soft'))&&
    JSON.stringify(keys)===JSON.stringify(['in','out','trip','leave','outing','overtime'])&&data.workWindows.length===2&&
    zoom.filter(z=>z.type==='slider').length===1&&slider.height===34&&slider.handleSize==='100%'&&
    ticks.length===5&&opt.grid[0].left===12&&opt.grid[0].right===12&&slider.left===12&&slider.right===12&&
    opt.grid[0].bottom>=104&&opt.yAxis[0].type==='category'&&
    !!document.querySelector('.analysis-head-tools #timelineDayPicker')&&
    document.querySelectorAll('.analysis-head-tools .timeline-top-legend span').length>=4&&
    getComputedStyle(preview,'::before').display==='none'&&bar&&
    preview.dataset.geometryReady==='true'&&
    (()=>{
      const svg=document.querySelector('#attendanceTimelineChart svg');
      const target=[...svg.querySelectorAll('path,rect')].filter(n=>(n.getAttribute('fill')||'').toLowerCase()==='#edf0f2')
        .map(n=>n.getBoundingClientRect()).filter(r=>r.width>200&&r.height>=25&&r.height<=45)
        .sort((a,b)=>b.width-a.width)[0],frame=preview.getBoundingClientRect();
      return target&&Math.abs(frame.top-target.top)<1&&Math.abs(frame.left-target.left)<1&&
        Math.abs(frame.width-target.width)<1&&Math.abs(frame.height-target.height)<1;
    })()&&
    [...preview.querySelectorAll('.r15-punch-stack')].every(n=>{
      const r=n.getBoundingClientRect(),outer=preview.getBoundingClientRect();
      return r.top>=outer.top&&r.bottom<=outer.bottom&&r.left>=outer.left-.5&&r.right<=outer.right+.5;
    })&&
    bar.getBoundingClientRect().top>=preview.getBoundingClientRect().top&&
    bar.getBoundingClientRect().bottom<=preview.getBoundingClientRect().bottom&&
    labels.length===4&&labels.every(x=>{
      const fs=parseFloat(getComputedStyle(x).fontSize),right=document.getElementById('attendanceTimelineChart').getBoundingClientRect().right;
      return fs>=13&&fs<=15.5&&Math.abs(x.getBoundingClientRect().right-(right-20))<24&&
        getComputedStyle(x).fill===rgb(expected[x.textContent.trim()]);
    });
 },'R29 restored timeline geometry, fixed behavior labels or clipped navigator failed');

 const tracks=await page.evaluate(()=>{
  const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));
  const opts=chart.getOption();
  const data=r14TrackData(state.analysis.get('E001|9'));
  return {ids:opts.series.map(s=>s.id), zoom:opts.dataZoom.map(z=>z.type),
   rails:data.tracks.map(t=>t.key),rects:data.bars.length,arrows:data.events.length,windows:data.workWindows.length,
   oldMini:!!document.getElementById('timelineMini'),settings:r14Prefs().timelineTracks};
 });
 console.log('R14_TIMELINE '+JSON.stringify(tracks));
 if(tracks.oldMini||tracks.zoom.filter(z=>z==='slider').length!==1||!tracks.ids.includes('bands')||
    JSON.stringify(tracks.rails)!==JSON.stringify(['in','out','trip','leave','outing','overtime'])||
    tracks.windows!==2||!tracks.ids.includes('schedule')||!tracks.ids.includes('event-baseline')||
    !tracks.ids.includes('behavior-rails')||!tracks.ids.includes('behavior-labels')||
    !tracks.ids.includes('work-boundaries')||tracks.arrows<2)
    throw Error('R29 restored six-lane timeline failed');
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
   const group=document.querySelector('.manual-status-buttons');
   const radios=[...group.querySelectorAll('[data-manual-status]')];
   const active=radios.find(x=>x.dataset.manualStatus==='absent');
   const inactive=radios.filter(x=>x!==active);
   const initial=document.querySelector('.initial-judgment');
   const checkMark=cell.querySelector('.manual-check'),box=checkMark?.getBoundingClientRect(),parent=cell.getBoundingClientRect();
   return state.manualStatuses[key]==='absent'&&state.judgmentMode==='manual'&&cell.classList.contains('s-absent')&&!!checkMark&&
     !document.querySelector('[data-judgment-mode="manual"]').disabled&&
     getComputedStyle(group).display==='grid'&&radios.length===3&&
     radios.filter(x=>x.getAttribute('aria-checked')==='true').length===1&&
     active?.classList.contains('active')&&active.textContent.trim()==='缺勤'&&
     inactive.every(x=>x.textContent.trim()==='')&&initial?.textContent.trim().length>0&&
     initial?.hasAttribute('data-manual-clear')&&getComputedStyle(active).color==='rgb(255, 255, 255)'&&
     box.left>=parent.left&&box.top>=parent.top&&box.right<=parent.right+.5&&box.bottom<=parent.bottom+.5;
 },manualTarget,'R27 status blocks or contained matrix check failed');
 await page.screenshot({path:path.join(out,'r29-manual-segment.png')});
 await page.locator('.initial-judgment').click();
 await check(page,({id,day})=>{
   const key=id+'|'+day;
   return !state.manualStatuses[key]&&document.querySelector('.status-control-row.initial-row>span')?.textContent==='初始'&&
     document.querySelectorAll('.status-control-row.manual-row [data-manual-status]').length===3;
 },manualTarget,'Initial status button must restore the selected day');
 await page.locator('[data-manual-status="absent"]').click();
 await page.locator('[data-judgment-mode="initial"]').click();
 await check(page,({id,day})=>{
   const cell=document.querySelector('.m-cell[data-emp="'+id+'"][data-day="'+day+'"] button');
   return state.judgmentMode==='initial'&&!cell.classList.contains('s-absent')&&!cell.querySelector('.manual-check');
 },manualTarget,'Initial judgment view must hide manual matrix markers');
 await page.locator('[data-judgment-mode="manual"]').click();
 await check(page,()=>state.judgmentMode==='manual','Manual layer cannot be restored');
 await check(page,({id,day})=>{
   const item=state.analysis.get(id+'|'+day),initial=attendanceJudgmentSystem(item);
   const locked=document.querySelector('[data-manual-status="'+initial+'"]');
   return !!locked&&locked.disabled&&locked.classList.contains('initial-disabled')&&
     parseFloat(getComputedStyle(locked).opacity)<.2;
 },manualTarget,'Manual selector must disable and fade the initial status');

 // Six lanes never change; the right rail always shows the selected person's complete day.
 await page.locator('.m-cell[data-emp="E011"][data-day="23"] button').click();
 await page.waitForSelector('#attendanceTimelineChart svg');
 await check(page,()=>{
   const m=r14TrackData(state.analysis.get('E011|23')),keys=m.tracks.map(t=>t.key);
   return JSON.stringify(keys)===JSON.stringify(['in','out','trip','leave','outing','overtime'])&&
     m.workWindows.length===2&&['trip','leave','outing','overtime'].every(k=>m.bars.some(x=>x.track===k));
 },'R24 six fixed lanes or business intervals missing');
 await page.screenshot({path:path.join(out,'r24-regular-timeline.png')});
 await page.locator('#statusFilter').selectOption('leave');
 await page.locator('.m-cell[data-emp="E011"][data-day="23"] button').click();
 await page.waitForSelector('#attendanceTimelineChart svg');
 await check(page,()=>{
   const keys=r14TrackData(state.analysis.get('E011|23')).tracks.map(t=>t.key),insight=document.querySelector('.inspector-insight');
   return JSON.stringify(keys)===JSON.stringify(['in','out','trip','leave','outing','overtime'])&&
     insight.querySelectorAll('[data-insight-tab]').length===2&&
     document.querySelector('[data-insight-pane="summary"]')?.classList.contains('active')&&
     ['首进','末出','在岗'].every(k=>[...insight.querySelectorAll('[data-insight-pane="summary"] .insight-row span')].some(x=>x.textContent===k));
 },'Behavior filter must keep complete personal summary and compact insight tabs');
 await page.locator('[data-insight-tab="behavior"]').click();
 await check(page,()=>{
   const pane=document.querySelector('[data-insight-pane="behavior"]'),rows=[...pane.querySelectorAll('.insight-behavior-row')];
   return pane.classList.contains('active')&&rows.length===4&&
     ['出差','请假','外出','加班'].every(k=>rows.some(r=>r.textContent.includes(k)))&&
     rows.find(r=>r.classList.contains('leave'))?.classList.contains('active');
 },'Behavior insight tab did not expose all four intervals');
 await page.screenshot({path:path.join(out,'r29-leave-timeline.png')});
 await page.locator('#statusFilter').selectOption('main');

 // A stress day should merge close punches at wide range and split them naturally as the time window narrows.
 const stress=await page.evaluate(()=>{
   const a=[...state.analysis.values()].find(x=>x.punches.some(p=>p.scenario==='rapid-swipes'));
   return {id:a.employee.id,day:a.day};
 });
 await page.locator('.m-cell[data-emp="'+stress.id+'"][data-day="'+stress.day+'"] button').click();
 await page.waitForSelector('#attendanceTimelineChart svg');
 await check(page,({id,day})=>{
   const a=state.analysis.get(id+'|'+day);
   const range={start:520,end:600},wide=r19PunchClusters(a,range,240,0);
   const narrow=r19PunchClusters(a,range,1600,0);
   return wide.some(x=>x.count>1)&&narrow.length>wide.length;
 },stress,'Rapid punches do not merge at overview scale and split at narrow scale');
 await check(page,({id,day})=>{
   const a=state.analysis.get(id+'|'+day),r={start:520,end:560},events=r19PunchClusters(a,r,800);
   return events.every(g=>g.records.every(p=>{
     const t=minutes(p.time);return t>=r.start&&t<=r.end;
   })&&g.value[0]>=r.start&&g.value[0]<=r.end);
 },stress,'R31 visible-range clustering includes offscreen records');
 await page.screenshot({path:path.join(out,'r20-clustered-punches.png')});
 await page.evaluate(()=>{
   const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));
   chart.dispatchAction({type:'dataZoom',dataZoomId:'slider',startValue:520,endValue:600});
 });
 await page.waitForTimeout(220);
 await check(page,()=>state.timelineRange?.start>=519&&state.timelineRange?.end<=601,
   'R34 zoomed cluster range is not linked to the timeline');
 await page.screenshot({path:path.join(out,'r34-zoomed-cluster.png')});

 // Return to the manually edited cell before linked-raw verification.
 await page.locator('.m-cell[data-emp="'+manualTarget.id+'"][data-day="'+manualTarget.day+'"] button').click();
 await page.waitForSelector('#attendanceTimelineChart svg');
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
 // R33: exported verdicts and a real-name file import are consistent and month-safe.
 await check(page,()=>{
   const a=[...state.analysis.values()].find(x=>isWorkday(x.day)&&attendanceJudgmentSystem(x)==='normal');
   const key=a.employee.id+'|'+a.day;state.manualStatuses[key]='absent';state.judgmentMode='manual';
   const row=traditionalRows().find(r=>r.姓名===a.employee.name&&r.日期===a.date);
   delete state.manualStatuses[key];state.judgmentMode='initial';
   return row.系统判定==='正常'&&row.人工判定==='缺勤'&&row.最终判定==='缺勤'&&row.人工处理==='是'&&
    row.班内工时分钟===Math.round(a.workMinutes||0)&&
    row.加班候选分钟===Math.round(a.autoOvertime?.minutes||0)&&
    row.加班候选说明===(a.autoOvertime?.reason||'')&&
    row.午休证据===a.lunchEvidence;
 },'R33 export lost final manual judgment');
 const imported=await page.evaluate(async()=>{
   const csv='姓名,打卡时间,进出\n测试甲,2026-10-09 08:24:11,进\n测试甲,2026-10-09 17:44:05,出';
   await importAttendance(new File([csv],'测试导入.csv',{type:'text/csv'}));
   const id=EMPLOYEES[0]?.id;
   const valid=EMPLOYEES.length===1&&EMPLOYEES[0].name==='测试甲'&&
     state.records.length===2&&state.records[0].row===2&&state.records[1].row===3&&
     state.records.every(x=>x.importId===state.imports[0].id)&&state.analysis.size===monthDays();
   if(!valid)return {valid:false};
   const leave='姓名,日期,开始时间,结束时间,类型\n测试甲,2026-10-09,08:30,12:00,事假';
    await importLeaves(new File([leave],'请假样例.csv',{type:'text/csv'}));
    const trip='姓名,开始日期,结束日期,类型,地点\n测试甲,2026-10-10,2026-10-11,出差,测试地点';
    await importTrips(new File([trip],'出差样例.csv',{type:'text/csv'}));
    const outing='姓名,开始日期,结束日期,开始时间,结束时间,类型\n测试甲,2026-10-09,2026-10-09,10:00,11:00,业务外出';
    await importOutings(new File([outing],'外出样例.csv',{type:'text/csv'}));
    const overtime='姓名,日期,开始时间,结束时间,类型\n测试甲,2026-10-09,18:00,19:00,登记加班';
    await importOvertime(new File([overtime],'加班样例.csv',{type:'text/csv'}));
    const related=state.leaves.length===1&&state.trips.length===1&&
      state.outings.length===1&&state.overtimeEntries.length===1&&
      state.leaves[0].employeeId===id&&state.trips[0].employeeId===id&&
      state.outings[0].employeeId===id&&state.overtimeEntries[0].employeeId===id&&
      state.imports.length===5;
    const saved=workingPayload();
   switchMonth(2026,11);switchMonth(2026,10);
   const restored=EMPLOYEES.length===1&&EMPLOYEES[0].id===id&&
     state.records.length===2&&state.analysis.size===monthDays()&&
     saved.employees.length===1&&state.leaves.length===1&&state.trips.length===1&&
     state.outings.length===1&&state.overtimeEntries.length===1&&related;
   state.calendarOverrides['2026-10-09']='holiday';
   const calendar=dayType(9)==='holiday';delete state.calendarOverrides['2026-10-09'];
   return {valid,restored,calendar};
 });
 if(!imported.valid||!imported.restored||!imported.calendar)throw Error('R33/R50 roster/5-type import/month/calendar failed '+JSON.stringify(imported));
 await check(page,()=>{
   const before=EMPLOYEES;
   try{
    EMPLOYEES=[{id:'E991',name:'同名员工',department:'测试'},
      {id:'E992',name:'同名员工',department:'测试'}];
    try{importRosterPlan(['同名员工'],'leave');return false}
    catch(e){if(!e.message.includes('同名'))return false}
    try{validateImportIdentityRows([{姓名:'乙',工号:'01'},{姓名:'乙',工号:'02'}]);return false}
    catch(e){return e.message.includes('同名异工号')}
   }finally{EMPLOYEES=before}
 },'R50 ambiguous employee identity silently merged');
 // R35: actual large XLSX bytes must round-trip, not just return matching preview fields.
 await check(page,async()=>{
   const rows=Array.from({length:6000},(_,i)=>({姓名:'测试'+i,打卡时间:'2026-10-09 08:31:04',进出:'进',备注:'测试数据'+i}));
   const file=XLSX.writeXlsx(rows,'批量导出'),raw=await file.arrayBuffer();
   if(raw.byteLength<200000)return false;
   const parsed=await XLSX.readTable(new File([file],'batch.xlsx'));
   return parsed.rows.length===rows.length&&parsed.rows[5999].姓名==='测试5999'&&parsed.rows[5999].进出==='进';
 },'R35 large XLSX round-trip failed');
 await check(page,()=>{
   const a=[...state.analysis.values()].find(x=>x.leaves?.length||x.trips?.length);
   const row=traditionalRows().find(r=>r.姓名===a.employee.name&&r.日期===a.date);
   return !!row&&row.业务标记.length>0;
 },'R35 export lost behavior tags');

 if(!process.env.P109_URL&&remote.length)throw Error('Network requests from offline app '+JSON.stringify(remote));
 if(errors.length)throw Error('Browser errors '+JSON.stringify(errors));
 console.log('P109_BROWSER_SMOKE_PASS '+JSON.stringify({r:'R34',remote:remote.length,errors:errors.length,layout}));
 await context.close();
}
run().catch(e=>{console.error('P109_BROWSER_SMOKE_FAIL',e.stack||e);process.exitCode=1})
 .finally(async()=>{if(browser)await browser.close()});
