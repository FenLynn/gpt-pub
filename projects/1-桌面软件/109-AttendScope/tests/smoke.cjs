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
 if(errors.length)throw Error('R62 initial script exception: '+errors.join(' | '));
 if(!await page.locator('.m-name .name-letters').count())throw Error('R62 missing matrix: '+(await page.locator('#app').innerHTML()).slice(0,1900)+' | '+errors.join(' | '));
 // R62 core acceptance: visible first row without importing it, hand-picked
 // fields, custom exact/contains gate keywords, XLSX serials, stable names,
 // and actual offline two-page PDF bytes.
 await check(page,async()=>{
  const file=new File(['姓名,日期,时间,进出\n李  四,2026/10/20,08:30,进1\n李  四,2026/10/20,19:00,出2\n'],
    'import.csv',{type:'text/csv'});
  const grid=await XLSX.readGrid(file);
  const options=r62InferColumns({...grid,kind:'attendance'},true);
  const oldProfile=state.importProfile;
  const rule=[
   {text:'进1',direction:'进',match:'exact'},
   {text:'出2',direction:'出',match:'exact'},
   {text:'闸机进通道',direction:'进',match:'contains'}
  ];
  if(r62MatchDirection('进1',rule)!=='进'||r62MatchDirection('我的闸机进通道X',rule)!=='进'||
    r62MatchDirection('进123',rule)!=='')throw Error('R62 keyword matching failed');
  r62ImportDraft={file,grid,kind:'attendance',mapping:options,skip:0,header:true,
   encoding:'auto',rules:rule,validated:null};
  const parsed=r62BuildCanonical();
  if(parsed.rows.length!==2||parsed.rows[0].__rowNumber!==2||
     parsed.rows[0]['姓名']!=='李 四'||parsed.rows[0]['打卡时间']!=='2026-10-20 08:30:00'||
     parsed.rows[1]['进出']!=='出')throw Error('R62 canonical columns failed');
  if(!r62PreviewHtml().includes('1 · 表头')||!r62PreviewHtml().includes('<th>2</th>'))throw Error('R62 visible but skipped header failed');
  const copy={employees:[{id:'E001',name:'李 四',department:'组1'}],
   groups:{E001:'科研组'},manualStatuses:{'E001|12':'normal'},
   records:[{recordId:'old',employeeId:'E001',name:'李 四'}],
   overtimeReview:{'auto-visit:E001:source':false}};
  r62MigratePayload(copy);
  if(copy.employees[0].id!==personIdentity('李 四')||
    copy.records[0].employeeId!==copy.employees[0].id||
    copy.manualStatuses[personIdentity('李 四')+'|12']!=='normal')throw Error('R62 name-key migration failed');
  const excelNumber=(Date.UTC(2026,9,20)-Date.UTC(1899,11,30))/86400000;
  const workbook=XLSX.writeXlsx([{姓名:'李四',日期:excelNumber}]);
  const xlsx=await XLSX.readGrid(new File([workbook],'serial.xlsx'));
  if(!xlsx.rows.length||r62Date(xlsx.rows[1].cells[1])!=='2026-10-20')throw Error('R62 XLSX serial date failed');
  state.importProfile=oldProfile;r62ImportDraft=null;
  const matrix=await captureCurrentImage('matrix');
  if(!matrix.data.startsWith('data:image/png;base64,'))throw Error('R62 matrix PNG canvas failed');
  const first=matrix,second=matrix;
  const pdf=await capturePdf([first,second]);
  const bytes=new Uint8Array(await pdf.arrayBuffer());
  const text=new TextDecoder('latin1').decode(bytes);
  return text.startsWith('%PDF-1.4')&&text.includes('/Count 2')&&
    (text.match(/\/Type \/Page \/Parent/g)||[]).length===2&&
    text.includes('/MediaBox [0 0 842 595]')&&pdf.size>4000;
 },'R62 CSV/XLSX preview, manual rules, normalized names, screenshot and offline PDF regressions');
 // R63: real browser flow for a newly created month and actual CSV/XLSX UI.
 await page.evaluate(()=>switchMonth(2026,12,true));
 await page.locator('#attendanceInput').setInputFiles({name:'新月份.csv',mimeType:'text/csv',
  buffer:Buffer.from('姓名,日期,时间,进出\n新员工甲,2026-12-08,08:25,进\n新员工甲,2026-12-08,11:45,出\n新员工甲,2026-12-08,13:25,进\n新员工甲,2026-12-08,17:25,出')});
 await page.waitForSelector('.r62-overlay',{timeout:30000});
 await check(page,()=>r62ImportDraft.rules.length===2&&!document.querySelector('#r63DirectionDetails').open&&
  !document.querySelector('#r63ImportBusy')&&r62PreviewHtml().includes('新员工甲'),
  'R63 compact preview and minimal default rules');
 await page.screenshot({path:path.join(out,'r63-fresh-month-import.png')});
 await page.locator('#r62Validate').click();
 await check(page,()=>r62ImportDraft.validated?.rows.length===4,'R63 December CSV canonical rows');
 await page.locator('#r62Commit').click();
 await page.waitForFunction(()=>state.imports.length===1&&state.records.length===4,{timeout:60000});
 await check(page,()=>MONTH===12&&EMPLOYEES.length===1&&EMPLOYEES[0].name==='新员工甲'&&
  state.analysis.get(EMPLOYEES[0].id+'|8').punches.length===4,'R63 real December import');
 await page.evaluate(()=>switchMonth(2027,1,true));
 await page.evaluate(async()=>{const b=XLSX.writeXlsx([
  {姓名:'新员工乙',打卡时间:'2027-01-06 08:29:00',进出:'进'},
  {姓名:'新员工乙',打卡时间:'2027-01-06 17:25:00',进出:'出'}]);
  await r62OpenImport(new File([b],'新月份.xlsx'),'attendance');
 });
 await page.waitForSelector('.r62-overlay');
 await page.locator('#r62Validate').click();
 await check(page,()=>r62ImportDraft.validated?.rows.length===2,'R63 XLSX preview');
 await page.locator('#r62Commit').click();
 await page.waitForFunction(()=>state.records.length===2&&state.imports.length===1,{timeout:60000});
 await check(page,()=>YEAR===2027&&MONTH===1&&EMPLOYEES.some(e=>e.name==='新员工乙')&&state.records.every(r=>r.name==='新员工乙'),'R63 real January XLSX import');
 await page.evaluate(()=>switchMonth(2026,10));
 await check(page,()=>EMPLOYEES.length===50&&state.records.length>3500,'R63 restored October baseline');
 await page.locator('#printReport').click();
 await page.waitForSelector('#r63PdfClose');
 await check(page,()=>document.querySelector('#r63PdfExport').disabled,'R63 no synthetic PDF pages');
 await page.locator('#r63PdfClose').click();
 await page.evaluate(async()=>{state.captureItems=[await captureCurrentImage('matrix'),await captureCurrentImage('timeline')]});
 await page.locator('#printReport').click();
 await page.waitForSelector('#r63PdfPicker input');
 await check(page,()=>document.querySelectorAll('#r63PdfPicker input:checked').length===2,'R63 cached thumbnails default checked');
 await page.screenshot({path:path.join(out,'r63-pdf-picker.png')});
 await page.locator('#r63PdfPicker input').first().uncheck();
 await check(page,async()=>{
  const box=document.getElementById('r63PdfPicker'),
   selected=[...box.querySelectorAll('input:checked')].map(x=>box._captures[+x.dataset.captureIndex]);
  if(selected.length!==1||!r63ReportData('timeline').lines.some(x=>x[0]==='在岗'))return false;
  const pdf=new TextDecoder('latin1').decode(await (await capturePdf(selected)).arrayBuffer());
  return pdf.includes('/Count 1')&&document.getElementById('r63PdfCount').textContent.includes('1 张');
 },'R63 selected one image generates exactly one PDF page and context data exists');
 await page.locator('#r63PdfClose').click();
 // Export the matrix in its native workspace; do not perturb navigation state
 // before the long-standing personal chart interaction regression.
 const r63Matrix=await page.evaluate(async()=>(await captureCurrentImage('matrix')).data);
 fs.writeFileSync(path.join(out,'r63-export-matrix.png'),Buffer.from(r63Matrix.split(',')[1],'base64'));
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
 const r63Timeline=await page.evaluate(async()=>(await captureCurrentImage('timeline')).data);
 fs.writeFileSync(path.join(out,'r63-export-timeline.png'),Buffer.from(r63Timeline.split(',')[1],'base64'));
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
 await check(page,()=>state.workspaceMode==='all'&&document.querySelectorAll('[data-workspace]').length===5&&
   !!document.querySelector('#scopeInsights .r68-scope-kpis')&&!!document.querySelector('.matrix-wrap'),'R37 full-staff entry not mounted');
 await page.waitForSelector('#scopeDailyChart svg',{timeout:15000});
 await check(page,()=>{
   const day=Array.from({length:monthDays()},(_,i)=>i+1).filter(isWorkday);
   const work=workAnalyses().filter(a=>day.includes(a.day));
   const n=work.filter(a=>attendanceJudgment(a)==='anomaly').length;
   return +document.querySelectorAll('#scopeInsights .r68-scope-kpis strong')[1].textContent===n&&
      !!document.querySelector('.r68-scope-rank .r68-rank-row');
 },'R40 all-staff scoped analytics failed');
 await page.locator('#workspaceScopeGroup').selectOption({index:1});
 await check(page,()=>state.workspaceMode==='group'&&!!document.querySelector('#workspaceGroup'),'R39 left group filter did not drill down');
 await check(page,()=>!!document.querySelector('#workspaceGroup option[value=""]')&&!!document.querySelector('.r68-stacked-track'),
  'R41 group all-option or status composition chart missing');
 await check(page,()=>{
   const metrics=[...document.querySelectorAll('#scopeInsights .r70-metric-list .r68-kpi')];
   const rank=document.querySelector('#scopeInsights .r68-rank-name');
   return metrics.length===4&&metrics.every(el=>{
    const style=getComputedStyle(el);
    return style.borderTopWidth==='0px'&&style.backgroundColor==='rgba(0, 0, 0, 0)';
   })&&rank&&parseFloat(getComputedStyle(rank).fontSize)>=13;
  },'R70 group stats must use unboxed and legible rows');
 await page.screenshot({path:path.join(out,'r70-group-flat.png')});
 // R71 viewport contracts: NO inspector scrollbar, clipping or repeated headcount.
 for(const [width,height] of [[1366,768],[1600,900],[1920,1080]]){
  await page.setViewportSize({width,height});
  for(const view of ['all','group']){
   await page.locator('[data-workspace="'+view+'"]').click();
   await page.waitForSelector('#scopeDailyChart svg',{timeout:15000});
   await check(page,()=>{
    const panel=document.querySelector('#scopeInsights');
    const chart=document.querySelector('#scopeDailyChart svg');
    const rows=[...panel.querySelectorAll('.r68-scope-rank .r68-rank-row')];
    const counter=panel.querySelector('.r71-headcount');
    if(!counter||!chart||!rows.length)return false;
    const panelRect=panel.getBoundingClientRect(),last=rows.at(-1).getBoundingClientRect();
    const graph=chart.getBoundingClientRect();
    return ['hidden','clip'].includes(getComputedStyle(panel).overflowY)&&
     panel.scrollHeight<=panel.clientHeight+2&&
     last.bottom<=panelRect.bottom+1&&graph.bottom<=panelRect.bottom+1&&
     document.querySelectorAll('.r71-headcount').length===1&&
     document.querySelectorAll('.workspace-hint').length===0&&
     counter.textContent.trim()===(scopeVisibleEmployees().length+' 人')&&
     !panel.querySelector('.r68-scope-note')&&
     parseFloat(getComputedStyle(rows[0].querySelector('.r68-rank-name')).fontSize)>=13&&
     document.documentElement.scrollWidth<=innerWidth+3;
   },'R71 all/group inspector must fit the whole viewport with one headcount and no internal scroll');
  }
 }
 await page.setViewportSize({width:1920,height:1080});
 await page.locator('[data-workspace="group"]').click();
 await page.waitForSelector('#scopeDailyChart svg',{timeout:15000});
 await page.screenshot({path:path.join(out,'r71-group-no-scroll.png')});

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
   return Number(document.querySelectorAll('#scopeInsights .r68-scope-kpis strong')[2].textContent)===x;
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
 await page.locator('[data-data-section="overview"]').click();
 await page.waitForSelector('#r69ProjectPane .r69-section-title',{timeout:15000});
 await check(page,()=>{
   const pane=document.querySelector('#r69ProjectPane');
   const strip=pane.querySelector('.r70-project-facts,.r70-project-intro');
   if(!state.projectDir&&(pane.querySelector('#r68MonthsCard')||pane.querySelector('#r68HealthCard')))return false;
   return !!strip&&![...pane.querySelectorAll('.r68-overview-cards > div')].some(el=>{
    const s=getComputedStyle(el);return s.borderStyle!=='none'||s.backgroundColor==='rgb(255, 255, 255)';
   })&&!document.querySelector('#r68DataRail .r68-rail-metrics');
  },'R70 project overview must not contain isolated numerical tiles');
 await page.screenshot({path:path.join(out,'r70-data-overview.png')});
 // R71 data management uses one work area across all ten categories.
 for(const tab of ['overview','months','health','storage','roster','rules','templates','records','imports','freezes']){
  await page.locator('[data-data-section="'+tab+'"]').click();
  if(['overview','months','health','storage'].includes(tab))
   await page.waitForSelector('#r69ProjectPane .r71-section-title',{timeout:16000});
  await check(page,expected=>{
   const area=document.getElementById('analysisBody');
   const toolbar=document.querySelector('.workspace-toolbar');
   const tip=area.querySelector('.r71-help');
   const empty=area.querySelector('.r71-setup');
   if(empty){const a=empty.getBoundingClientRect(),b=area.getBoundingClientRect();
    if(Math.abs((a.left+a.right)/2-(b.left+b.right)/2)>35)return false;}
   return state.dataSection===expected&&!!area.querySelector('.r71-data-shell')&&
    !area.querySelector('#r68DataRail')&&!!tip&&tip.dataset.r73Tip?.length>6&&!tip.hasAttribute('title')&&
    !area.querySelector('.r68-cardhead p')&&
    !document.querySelector('.r71-data-toolbar')&&(!toolbar||!toolbar.textContent.includes('名册、规则与原始记录'))&&
    document.documentElement.scrollWidth<=innerWidth+3&&
    (expected==='storage'||!area.querySelector('.r71-tree-section'));
  },tab,'R71 data sections must be single-column, without persistent help text or duplicate tree');
  if(tab==='overview')await page.screenshot({path:path.join(out,'r71-data-overview.png')});
  if(tab==='storage')await page.screenshot({path:path.join(out,'r71-data-storage.png')});
 }
 await page.locator('[data-data-section="overview"]').click();
 await page.waitForSelector('#r69ProjectPane .r71-section-title',{timeout:16000});

 await page.locator('[data-data-section="roster"]').click();
 await check(page,()=>document.querySelectorAll('.r73-month-pane .r73-person-row').length===EMPLOYEES.length,
  'R37 data management missing real roster');
 await page.screenshot({path:path.join(out,'r37-roster.png')});
 await check(page,()=>{
  const head=document.querySelector('.r74-roster-header');
  const title=head?.querySelector('.r71-content-head')?.getBoundingClientRect();
  const controls=head?.querySelector('.r73-roster-top')?.getBoundingClientRect();
  return !!title&&!!controls&&
   Math.abs((title.top+title.bottom)/2-(controls.top+controls.bottom)/2)<8&&
   !document.querySelector('.workspace-toolbar.r71-data-toolbar')&&
   document.documentElement.scrollWidth<=innerWidth+3;
 },'R74 title, search and group editor share one row');
 await page.screenshot({path:path.join(out,'r74-roster-one-row.png')});
 await page.locator('[data-data-section="rules"]').click();
 await check(page,()=>document.querySelectorAll('.r68-rule-grid>div').length===8&&
   document.querySelector('.r68-rule-grid')?.textContent.includes('上午打卡容差')&&
   document.querySelector('.r68-rule-grid')?.textContent.includes('下午打卡容差')&&
   !!document.getElementById('r68EditRules'),
  'R37 data management missing rules');
 await page.locator('[data-data-section="imports"]').click();
 await check(page,()=>!!document.querySelector('.r68-history')||!!document.querySelector('.r68-empty'),'R37 imports not available');
 await page.locator('[data-data-section="records"]').click();
 await page.waitForSelector('#rawDataTable .tabulator-row',{timeout:15000});
 // R37: all-staff layout remains usable at 1366x768 without horizontal page clipping.
 await page.setViewportSize({width:1366,height:768});
 await page.locator('[data-workspace="all"]').click();
 await check(page,()=>{
   const matrix=document.querySelector('.matrix-wrap').getBoundingClientRect();
   return matrix.right<=innerWidth+2&&document.documentElement.scrollWidth<=innerWidth+3&&
    !!document.querySelector('#scopeInsights .r68-scope-kpis');
 },'R37 1366px all-staff viewport overflow');
 await check(page,()=>{
   const cal=document.querySelector('.side-calendar').getBoundingClientRect(),
   matrix=document.querySelector('.matrix').getBoundingClientRect(),
   wrap=document.querySelector('.matrix-wrap').getBoundingClientRect();
   return cal.bottom<=innerHeight+2&&matrix.width>wrap.width*.94&&matrix.width<=wrap.width+6;
 },'R39 1366 calendar visibility or horizontal matrix use');
 await page.screenshot({path:path.join(out,'r37-all-1366.png')});
 await page.setViewportSize({width:1920,height:1080});
 // R61: same-baseline staff labels; nonworkday uninterrupted presence
 // never gets an imaginary lunch break. Overnight hours split at midnight
 // but remain ONE physical session, even across the month boundary.
 await check(page,()=>{
  const preserved={
   records:state.records,leaves:state.leaves,trips:state.trips,outings:state.outings,
   overtimeEntries:state.overtimeEntries,analysis:state.analysis,
   overtimeReview:{...(state.overtimeReview||{})},monthStores:state.monthStores,
   year:YEAR,month:MONTH
  };
  const e=EMPLOYEES[0];
  const make=(date,clock,direction,i)=>({
   employeeId:e.id,recordId:'r61:'+date+':'+i,
   datetime:date+' '+clock,time:clock,direction
  });
  const approx=(x,y)=>Math.abs(x-y)<1e-8;
  try{
   state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];
   state.overtimeReview={};state.monthStores=new Map();
   YEAR=2026;MONTH=10;
   const sundayDate='2026-10-11';
   state.records=[make(sundayDate,'09:00:00','进',1),
     make(sundayDate,'15:00:00','出',2)];
   const weekend=analyzeDay(e,11);
   if(!approx(weekend.autoOvertime.minutes,360)||
      weekend.autoOvertime.segments.length!==1||
      !weekend.lunchEvidence.includes('不扣午休'))return false;
   const in9=make('2026-10-09','20:00:00','进',1),
     out10=make('2026-10-10','02:00:00','出',2);
   state.records=[in9,out10];
   const before=analyzeDay(e,9),after=analyzeDay(e,10),original=JSON.stringify(state.records);
   if(!approx(before.autoOvertime.minutes,240)||!approx(after.autoOvertime.minutes,120)||
    before.autoOvertime.segments[0].id!==after.autoOvertime.segments[0].id||
    timelineRange(before).start!==0||timelineRange(before).end!==1440||
    timelineRange(after).start!==0||timelineRange(after).end!==1440)return false;
   state.analysis=new Map([[e.id+'|9',before],[e.id+'|10',after]]);
   let ledger=asStatLedger();
   const val=(m,d)=>asStatValue(ledger,'overtime',m,[e],d);
   if(!approx(val('hours',[9]),4)||!approx(val('hours',[10]),2)||
     val('count',[9,10])!==1||!approx(val('candidateHours',[9,10]),6))return false;
   // A 23:00–01:00 registration clips to 1h on each date, and its
   // overlap is subtracted from inferred time without double counting.
   state.overtimeEntries=[{id:'r61-registered',employeeId:e.id,
     date:'2026-10-09',start:'23:00',end:'01:00'}];
   const reg9=analyzeDay(e,9),reg10=analyzeDay(e,10);
   state.analysis=new Map([[e.id+'|9',reg9],[e.id+'|10',reg10]]);
   ledger=asStatLedger();
   if(!approx(val('registeredHours',[9]),1)||
      !approx(val('registeredHours',[10]),1)||
      !approx(val('candidateHours',[9]),3)||
      !approx(val('candidateHours',[10]),1)||
      !approx(val('hours',[9,10]),6)||
      val('count',[9,10])!==2)return false;
   const reviewId=reg9.autoOvertime.segments[0].id;
   state.overtimeReview[reviewId]=false;
   if(activeAutoOvertimeSegments(analyzeDay(e,9)).length||
      activeAutoOvertimeSegments(analyzeDay(e,10)).length||
      JSON.stringify(state.records)!==original)return false;
   delete state.overtimeReview[reviewId];
   // A 27-minute visit from 23:58 to 00:25 counts 2+25 minutes,
   // whereas a four-minute visit cannot be pooled across midnight.
   state.overtimeEntries=[];
   state.records=[make('2026-10-09','23:58:00','进',3),
     make('2026-10-10','00:25:00','出',4)];
   if(!approx(analyzeDay(e,9).autoOvertime.minutes,2)||
      !approx(analyzeDay(e,10).autoOvertime.minutes,25))return false;
   state.records=[make('2026-10-09','23:58:00','进',3),
     make('2026-10-10','00:02:00','出',5)];
   if(analyzeDay(e,9).autoOvertime.minutes||analyzeDay(e,10).autoOvertime.minutes)return false;
   // Month end: exit in next month's imported records or in a loaded
   // adjoining workspace must still complete exactly the same visit.
   const octIn=make('2026-10-31','20:00:00','进',6),
     novOut=make('2026-11-01','02:00:00','出',7);
   state.records=[octIn,novOut];
   if(!approx(analyzeDay(e,31).autoOvertime.minutes,240))return false;
   state.records=[octIn];
   state.monthStores.set('2026-11',{records:[novOut],overtimeEntries:[]});
   if(!approx(analyzeDay(e,31).autoOvertime.minutes,240))return false;
   state.monthStores.set('2026-10',{records:[octIn],overtimeEntries:[]});
   state.records=[novOut];YEAR=2026;MONTH=11;
   const nov=analyzeDay(e,1);
   if(!approx(nov.autoOvertime.minutes,120))return false;
   const uniform=statisticsWorkspaceHtml.toString().includes('as-stats-chart-context')&&
    !renderStatisticsWorkspace.toString().includes('staggerLabels');
   return uniform;
  }finally{
   Object.assign(state,{records:preserved.records,leaves:preserved.leaves,
    trips:preserved.trips,outings:preserved.outings,overtimeEntries:preserved.overtimeEntries,
    analysis:preserved.analysis,overtimeReview:preserved.overtimeReview,
    monthStores:preserved.monthStores});
   YEAR=preserved.year;MONTH=preserved.month;
   state.timelineRange=null;
  }
 },'R61 weekend noon, midnight 4+2, cross-month 4+2, registration union and uniform staff labels');
 // R72: a departure before 11:40 is only early when no return before the boundary.
 await check(page,()=>{
  const e=EMPLOYEES[0],day=8,date=isoDate(day);
  const originals=[state.records,state.leaves,state.trips,state.outings];
  const check=events=>{
   state.records=events.map(([time,direction],i)=>({recordId:'R72:'+i,
    employeeId:e.id,name:e.name,datetime:date+' '+time,time,direction}));
   state.leaves=[];state.trips=[];state.outings=[];reanalyze();return state.analysis.get(e.id+'|'+day)};
  try{
   const early=check([['08:25','进'],['11:30','出'],['13:25','进'],['17:10','出']]);
   if(!early.issues.includes('上午早退')||!early.attendanceFlags.some(f=>f.label==='上午早退'))return false;
   if(check([['08:25','进'],['11:30','出'],['11:36','进'],['11:46','出'],
    ['13:25','进'],['17:10','出']]).issues.includes('上午早退'))return false;
   if(!check([['08:25','进'],['11:30','出'],['11:42','进'],['12:05','出'],
    ['13:25','进'],['17:10','出']]).issues.includes('上午早退'))return false;
   if(check([['08:25','进'],['11:40','出'],['13:25','进'],['17:10','出']]).issues.includes('上午早退'))return false;
   const late=check([['08:36','进'],['11:40','出'],['13:25','进'],['17:10','出']]);
   const unclosed=check([['08:36','进']]);
   return late.attendanceFlags.some(f=>f.label==='迟到')&&
    unclosed.issues.includes('迟到')&&unclosed.attendanceFlags.some(f=>f.kind==='late')&&RULES.graceAmEnd===0;
  }finally{[state.records,state.leaves,state.trips,state.outings]=originals;reanalyze()}
 },'R72 early departure return and zero-grace proof, with anchored late flags');
 // R68: strictly more than 20 min after shift-end; never deduct grace.
 await check(page,()=>{
  if(RULES.overtimeMinMinutes!==20)return false;
  const pair=(a,b)=>[{time:a},{time:b}];
  const calc=ls=>estimateOvertimeCandidate(ls,8,[]);
  const boundary=calc([pair('17:09','17:30')]),late=calc([pair('17:09','17:35')]);
  const before=calc([pair('17:09','17:29')]);
  const morning=calc([pair('08:30','12:05')]);
  const atNoon=calc([pair('08:30','12:00')]);
  const acrossLunch=calc([pair('08:30','17:35')]);
  const separate=calc([pair('17:10','17:22'),pair('18:00','18:12')]);
  const registered=estimateOvertimeCandidate([pair('17:10','18:00')],8,[{start:'17:20',end:'17:35'}]);
  const setting=settingsContent('rules');
  const verdict=boundary.minutes===0&&before.minutes===0&&
    late.minutes===25&&late.segments.length===1&&
    morning.minutes===25&&atNoon.minutes===0&&
    acrossLunch.minutes===25&&separate.minutes===0&&
    registered.minutes===35&&registered.segments.length===2&&
    setting.includes('id="r14OvertimeMin"')&&setting.includes('min="20"');
  if(!verdict)throw Error('R68_OT_CASES '+JSON.stringify({
   min:RULES.overtimeMinMinutes,boundary:boundary.minutes,before:before.minutes,
   late:late.minutes,morning:morning.minutes,atNoon:atNoon.minutes,acrossLunch:acrossLunch.minutes,
   separate:separate.minutes,registered:registered.minutes,registeredSegments:registered.segments.length,
   settings:setting.includes('min="20"')
  }));
  return true;
 },'R68 >20min lunch/evening grace without deduction, no lunch spanning overcount');
 // R60: consecutive 'in' punches without an intervening 'out' are
 // ONE continuous attendance visit. Threshold checks the original visit,
 // while registered entries affect only accounting, not attendance identity.
 await check(page,()=>{
  const saved={records:state.records,leaves:state.leaves,trips:state.trips,
   outings:state.outings,overtimeEntries:state.overtimeEntries,
   analysis:state.analysis,review:{...(state.overtimeReview||{})},rules:{...RULES}};
  const e=EMPLOYEES[0],day=8,date=isoDate(day);
  const punch=arr=>arr.map(([clock,direction],i)=>({
   employeeId:e.id,datetime:date+' '+clock,time:clock,direction,recordId:'r60:'+i
  }));
  try{
   state.leaves=[];state.trips=[];state.outings=[];
   state.overtimeEntries=[];RULES.overtimeMinMinutes=20;
   state.records=punch([['17:05','进'],['17:18','进'],['18:27','进'],['18:35','进'],['19:16','出']]);
   const frozen=JSON.stringify(state.records);
   const continuous=analyzeDay(e,day);
   if(continuous.pairs.length!==1||!continuous.pairs[0][0].time.startsWith('17:05')||
      !continuous.pairs[0][1].time.startsWith('19:16')||continuous.autoOvertime.minutes!==126||
      continuous.autoOvertime.segments.length!==1||
      continuous.autoOvertime.reason.includes('配对待核'))return false;
   // A registration inside the same physical visit creates accounting
   // fragments but never multiple reviews/threshold sessions.
   state.overtimeEntries=[{id:'R60-reg',employeeId:e.id,date,start:'18:00',end:'18:20'}];
   const withRegistered=analyzeDay(e,day);
   if(withRegistered.autoOvertime.minutes!==106||
      withRegistered.autoOvertime.segments.length!==2||
      withRegistered.autoOvertime.segments[0].id!==withRegistered.autoOvertime.segments[1].id)return false;
   state.analysis=new Map([[e.id+'|'+day,withRegistered]]);
   const ledger=asStatLedger();
   const check=m=>asStatValue(ledger,'overtime',m,[e],[day]);
   if(Math.abs(check('hours')-126/60)>1e-8||
      Math.abs(check('candidateHours')-106/60)>1e-8||
      check('count')!==2||check('registeredCount')!==1||
      check('candidateCount')!==1||check('independentCount')!==1)return false;
   state.overtimeReview[withRegistered.autoOvertime.segments[0].id]=false;
   const excluded=analyzeDay(e,day);
   if(activeAutoOvertimeSegments(excluded).length||JSON.stringify(state.records)!==frozen)return false;
   state.analysis=new Map([[e.id+'|'+day,excluded]]);
   const after=asStatLedger();
   if(Math.abs(asStatValue(after,'overtime','hours',[e],[day])-20/60)>1e-8)return false;
   // A real 'out' in the middle does create two visits: no pooling of
   // independent four-minute sessions into a valid eight-minute one.
   const separate=estimateOvertimeCandidate([
    [{time:'17:11'},{time:'17:15'}],[{time:'18:00'},{time:'18:04'}]
   ],day,[],false);
   return separate.minutes===0&&separate.segments.length===0;
  }finally{
   Object.assign(state,{records:saved.records,leaves:saved.leaves,trips:saved.trips,
    outings:saved.outings,overtimeEntries:saved.overtimeEntries,analysis:saved.analysis,
    overtimeReview:saved.review});
   Object.assign(RULES,saved.rules);
  }
 },'R60 repeated in punches retain original session; registered overlap must not split a single review');
 // R56: new 08:30–11:40 / 13:30–17:10 shift, independent
 // 5/0/5/0-minute tolerances, derived-only overtime and source immutability.
 await check(page,()=>{
  const previous={records:state.records,leaves:state.leaves,trips:state.trips,
   outings:state.outings,overtimeEntries:state.overtimeEntries,
   analysis:state.analysis,manualStatuses:state.manualStatuses,rules:{...RULES}};
  const emp=EMPLOYEES[0],day=8,date=isoDate(day),restDay=11,
    make=(d,sequence)=>sequence.map(([time,direction],i)=>({
      employeeId:emp.id,datetime:isoDate(d)+' '+time,time,direction,recordId:'r56:'+i
    }));
  const examine=(d,sequence,registered=[],leave=[])=>{
   state.records=make(d,sequence);state.overtimeEntries=registered;state.leaves=leave;
   return analyzeDay(emp,d);
  };
  const fail=(name,data)=>{throw Error('R56_CASE '+name+' '+JSON.stringify(data))};
  try{
   state.trips=[];state.outings=[];RULES.overtimeMinMinutes=30;
   const ordinary=examine(day,[['08:25','进'],['11:45','出'],['13:25','进'],['17:15','出']]);
   if(ordinary.severity!=='normal'||ordinary.workMinutes!==410||
      ordinary.autoOvertime.minutes!==0||ordinary.lunchEvidence!=='有午休进出')
      fail('ordinary',{severity:ordinary.severity,minutes:ordinary.workMinutes,issues:ordinary.issues});
   const continuous=examine(day,[['08:25','进'],['19:00','出']]);
   if(continuous.workMinutes!==410||continuous.autoOvertime.minutes!==110)
      fail('continuous',continuous.autoOvertime);
   const lateMorning=examine(day,[['08:36','进'],['11:45','出'],['13:25','进'],['17:15','出']]);
   if(!lateMorning.issues.includes('迟到'))fail('morning late',lateMorning.issues);
   const earlyMorning=examine(day,[['08:25','进'],['11:39','出'],['13:25','进'],['17:15','出']]);
   if(!earlyMorning.issues.includes('上午早退'))fail('morning early',earlyMorning.issues);
   const lateAfternoon=examine(day,[['08:25','进'],['11:45','出'],['13:36','进'],['17:15','出']]);
   if(!lateAfternoon.issues.includes('下午迟到'))fail('afternoon late',lateAfternoon.issues);
   const earlyAfternoon=examine(day,[['08:25','进'],['11:45','出'],['13:25','进'],['17:09','出']]);
   if(!earlyAfternoon.issues.includes('早退'))fail('afternoon early',earlyAfternoon.issues);
   const incomplete=examine(day,[['08:25','进'],['11:45','出'],['13:25','进']]);
   if(incomplete.severity!=='suspect'||incomplete.autoOvertime.minutes)
      fail('incomplete',incomplete.issues);
   const afterHours=examine(day,[['08:25','进'],['11:45','出'],['13:25','进'],['19:00','出']]);
   if(afterHours.autoOvertime.minutes!==110||afterHours.workMinutes!==410)
      fail('after hours',afterHours.autoOvertime);
   state.analysis=new Map([[emp.id+'|'+day,afterHours]]);
   const value=m=>asStatValue(asStatLedger(),'overtime',m,[emp],[day]);
   if(Math.abs(value('hours')-110/60)>1e-8||
      Math.abs(value('candidateHours')-110/60)>1e-8||
      value('candidateDays')!==1||value('registeredHours')!==0)
      fail('ledger',{total:value('hours'),candidate:value('candidateHours')});
   if(!settingsContent('rules').includes('r14Rule_graceAmStart')||
      !settingsContent('rules').includes('r14Rule_gracePmEnd')||
      workingPayload().rules.gracePmStart!==5)
      fail('settings',workingPayload().rules);
   const frozen=JSON.stringify(state.records);
   const seg=afterHours.autoOvertime.segments[0];
   state.overtimeReview[seg.id]=false;
   const rejected=analyzeDay(emp,day);
   if(activeAutoOvertimeSegments(rejected).length!==0||
      JSON.stringify(state.records)!==frozen)fail('manual priority',rejected.autoOvertime);
   delete state.overtimeReview[seg.id];
   const middle=examine(day,[['08:25','进'],['19:00','出']],
    [{id:'R',employeeId:emp.id,date,start:'18:00',end:'18:20'}]);
   if(middle.autoOvertime.minutes!==90||middle.autoOvertime.segments.length!==2)
      fail('registered subtraction',middle.autoOvertime);
   const threshold=examine(day,[['08:25','进'],['17:32','出']]);
   if(threshold.autoOvertime.rawMinutes!==22||threshold.autoOvertime.minutes!==0)
      fail('threshold',threshold.autoOvertime);
   const weekend=examine(restDay,[['09:00','进'],['15:00','出']]);
   if(weekend.autoOvertime.minutes!==360||weekend.autoOvertime.segments.length!==1)
    fail('weekend uninterrupted noon overtime',weekend.autoOvertime);
   return true;
  }finally{
   Object.assign(state,{records:previous.records,leaves:previous.leaves,trips:previous.trips,
    outings:previous.outings,overtimeEntries:previous.overtimeEntries,
    analysis:previous.analysis,manualStatuses:previous.manualStatuses});
   Object.assign(RULES,previous.rules);
  }
 },'R56 separated tolerances, overtime evidence and manual exclusion source safety');
 // R52: exactly one top-level statistics route; the old left statistics
 // switchers must no longer compete with group/person selection.
 await check(page,()=>{
  const top=[...document.querySelectorAll('[data-workspace]')];
  return top.length===5&&top.some(b=>b.dataset.workspace==='stats')&&
   document.querySelectorAll('.side-views [data-as-view="stats"]').length===0&&
   !!document.querySelector('.side-refinements')&&
   !!document.getElementById('asNavBack')&&!!document.getElementById('asNavForward');
 },'R52 statistics must appear once at top, not repeated in the sidebar');
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
 },'R52 backward/forward workspace and selection history failed');
 await check(page,()=>{
  const previous={workspaceMode:state.workspaceMode,statsScope:state.statsScope,
   statsConfig:state.statsConfig,selection:state.selection};
  try{
   state.workspaceMode='stats';state.statsScope='person';
   state.statsConfig={family:'overtime',metric:'candidatePeople',compare:'days',
      aggregate:'perPerson',chart:'bar',limit:10,sort:'desc'};
   const person=asStatPrefs();
   if(person.metric==='candidatePeople'||person.aggregate==='perPerson')return false;
   state.statsScope='all';state.statsConfig={...state.statsConfig,
      family:'leave',metric:'people',compare:'people',aggregate:'perPerson',chart:'line'};
   const ranked=asStatPrefs();
   return ranked.metric!=='people'&&ranked.aggregate!=='perPerson'&&ranked.chart==='bar';
  }finally{
   state.workspaceMode=previous.workspaceMode;state.statsScope=previous.statsScope;
   state.statsConfig=previous.statsConfig;state.selection=previous.selection;
  }
 },'R52 redundant individual metrics or categorical line chart not pruned');
 await check(page,()=>{
  const refinements=document.querySelector('.side-refinements');
  const sidebar=document.querySelector('.sidebar').getBoundingClientRect(),
   lower=refinements?.getBoundingClientRect();
  return !!refinements&&!document.querySelector('.side-refinements-title')&&
   Math.abs(lower.left-sidebar.left)<24&&
   parseFloat(getComputedStyle(refinements).borderLeftWidth)===0;
 },'R69 lower-left filters stay flush without an auxiliary heading');
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
    counts('overtime')===state.overtimeEntries.length+
     [...state.analysis.values()].reduce((sum,a)=>sum+activeAutoOvertimeSegments(a).length,0)&&
    asStatValue(ledger,'trip','days',people,days)>=counts('trip')&&
    asStatValue(ledger,'trip','estimatedHours',people,days)>0;
 },'R45 event ledger counts, trip days or time units inconsistent');
 // R45 iteration 3: independently inject overlapping mock events; original working
 // rows are restored in a finally block and are never written to raw/snapshot.
 await check(page,()=>{
  const prior={leaves:state.leaves,trips:state.trips,outings:state.outings,
    overtimeEntries:state.overtimeEntries,analysis:state.analysis};
  const id=EMPLOYEES[0].id,who=[EMPLOYEES[0]],day=9,all=Array.from({length:monthDays()},(_,i)=>i+1);
  try{
   state.analysis=new Map();
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
 // R52 unified statistical workbench and visual interaction regression.
 await page.locator('[data-workspace="stats"]').click();
 await page.waitForSelector('#asStatChart svg',{timeout:20000});
 await check(page,()=>{
  const layout=document.querySelector('.workspace-mode-stats');
  const h=document.querySelector('.as-stats-heading');
  const chart=document.querySelector('.as-stats-chart').getBoundingClientRect();
  const rank=document.querySelector('.as-stats-rank').getBoundingClientRect();
  return state.workspaceMode==='stats'&&state.statsScope==='all'&&
   document.querySelector('[data-workspace="stats"].active')!==null&&
   !!document.getElementById('asStatsScope')&&
   getComputedStyle(layout.querySelector('.sidebar')).display==='flex'&&
   document.getElementById('calendar')?.children.length>0&&
   chart.width>400&&rank.width>=250&&rank.width<=324&&rank.left>chart.left&&
   !!echarts.getInstanceByDom(document.getElementById('asStatChart'))&&h.textContent.includes('考勤统计');
 },'R52 top-level statistics route, width, or chart missing');
 // An earlier saved view may be a time-series. Explicitly select a
 // categorical comparison before asserting the categorical-only chart rule.
 await page.locator('#asStatCompare').selectOption('people');
 await check(page,()=>{
  const selected=document.getElementById('asStatsScope');
  const label=document.querySelector('.as-stats-filters label');
  const line=document.querySelector('[data-as-chart="line"]');
  return selected?.value==='all'&&!!label?.querySelector('select')&&
   getComputedStyle(label).display==='flex'&&
   asStatPrefs().compare==='people'&&!!line?.disabled;
 },'R55 categorical chart must disable chronological line mode');
 // R58: each statistical family gets its own accessible gradient and hover shade.
 for(const family of ['leave','trip','outing','punch','status']){
  await page.locator('#asStatFamily').selectOption(family);
  await check(page,family=>{
   const pal=AS_STAT_PALETTES[family],
    chart=echarts.getInstanceByDom(document.getElementById('asStatChart')),
    opts=chart?.getOption(),fill=opts?.series?.[0]?.itemStyle?.color;
   return !!pal&&opts?.series?.length===1&&fill?.colorStops?.[0]?.color===pal.top&&
    fill?.colorStops?.[1]?.color===pal.bottom&&
    opts.series[0].emphasis.itemStyle.color===pal.hover&&
    opts.xAxis[0].axisLabel.rotate<=34;
  },family,'R58 statistics family color or name angle mismatched');
 }
 // R58b: normal is green, but abnormal/absent judgments must not
 // silently inherit a normal-work green fill.
 await page.locator('#asStatFamily').selectOption('status');
 for(const m of ['normal','anomaly','absent','issue','late','early']){
  await page.locator('#asStatMetric').selectOption(m);
  await check(page,m=>{
   const pal=asStatPalette('status',m);
   const opts=echarts.getInstanceByDom(document.getElementById('asStatChart')).getOption();
   return opts.series[0].itemStyle.color.colorStops[0].color===pal.top&&
     opts.series[0].emphasis.itemStyle.color===pal.hover&&
     (m==='normal'||pal.top!==AS_STAT_PALETTES.status.top);
  },m,'R58 verdict colors must communicate normal, abnormal and absent accurately');
 }
 await page.locator('#asStatFamily').selectOption('overtime');
 await page.locator('#asStatMetric').selectOption('registeredHours');
 await check(page,()=>{
  const p=asStatPalette('overtime','registeredHours'),a=asStatPalette('overtime','candidateHours');
  return p.top===OVERTIME_VISUALS.registered.top&&
   a.top===OVERTIME_VISUALS.auto.top&&p.top!==a.top;
 },'R58 overtime registration and automatic colors must differ');
 await page.locator('#asStatFamily').selectOption('punch');
 await page.locator('#asStatMetric').selectOption('count');
 await page.locator('#asStatCompare').selectOption('people');
 await page.locator('#asStatLimit').selectOption('all');
 await check(page,()=>{
  const data=asStatRows(),opts=echarts.getInstanceByDom(document.getElementById('asStatChart')).getOption();
  const plotCount=opts.series[0].data.length,barWidth=opts.series[0].barWidth;
  return data.compare==='people'&&data.visible.length===data.rows.length&&
   data.visible.length===asStatRows().people.length&&data.visible.length>12&&
   data.rankRows.length===data.rows.length&&plotCount===data.rows.length&&
   opts.series[0].type==='bar'&&opts.xAxis[0].type==='category'&&
   opts.yAxis[0].type==='value'&&opts.xAxis[0].axisLabel.interval===0&&
   opts.xAxis[0].axisLabel.rotate===34&&
   !opts.xAxis[0].axisLabel.formatter&&
   opts.xAxis[0].axisLabel.margin===11&&
   opts.grid[0].bottom===95&&barWidth>=3&&barWidth<=25&&
   document.querySelector('[data-as-chart="line"]').disabled&&
   document.querySelector('.as-stats-chart-context')?.textContent.includes('全员');
 },'R54 all people must render, not just 12; bar width adapts to density');
 // R54 hover is exclusive: leaving one ranking item clears its bar emphasis.
 await page.locator('.as-stats-rank-row').nth(0).hover();
 await check(page,()=>{
  const linked=[...document.querySelectorAll('.as-stats-rank-row.is-linked')];
  return linked.length===1&&linked[0].dataset.asRank===
   document.querySelector('.as-stats-rank-row')?.dataset.asRank;
 },'R54 first hovered rank must be the only active item');
 await page.locator('.as-stats-rank-row').nth(1).hover();
 await check(page,()=>{
  const linked=[...document.querySelectorAll('.as-stats-rank-row.is-linked')];
  return linked.length===1&&linked[0].dataset.asRank===
   document.querySelectorAll('.as-stats-rank-row')[1].dataset.asRank;
 },'R54 changing hover must clear the previously highlighted bar');
 await page.locator('.as-stats-heading h2').hover();
 await check(page,()=>document.querySelectorAll('.as-stats-rank-row.is-linked').length===0,
  'R54 pointer leave must clear the active highlight');
 const fullBarWidth=await page.evaluate(()=>echarts.getInstanceByDom(
  document.getElementById('asStatChart')).getOption().series[0].barWidth);
 await page.locator('#asStatCompare').selectOption('groups');
 await check(page,oldWidth=>{
  const chart=echarts.getInstanceByDom(document.getElementById('asStatChart'));
  const opts=chart.getOption();
  return asStatRows().visible.length===workspaceGroups().length&&
   opts.series[0].barWidth>oldWidth&&opts.series[0].barWidth<=54;
 },fullBarWidth,'R54 category-aware bar width did not grow for fewer groups');
 await page.locator('#asStatCompare').selectOption('people');
 await check(page,()=>asStatRows().visible.length===EMPLOYEES.length,
  'R54 all staff did not return when switching back to people');
 await page.screenshot({path:path.join(out,'r52-top-people-bars.png')});
 // R57: overtime is one column composed of two closely related reds.
 // A hover, whether originating from the chart or the ranking, emphasizes
 // both stacked components for exactly one person. The previous column is
 // always downplayed and tooltip anchors to the populated upper segment.
 await page.locator('#asStatFamily').selectOption('overtime');
 await page.locator('#asStatMetric').selectOption('hours');
 await page.locator('#asStatCompare').selectOption('people');
 await check(page,()=>{
  const o=echarts.getInstanceByDom(document.getElementById('asStatChart')).getOption();
  const legend=document.querySelector('.as-stats-stack-legend');
  return o.series.length===2&&o.series.every(v=>v.stack==='overtime'&&v.type==='bar')&&
   o.xAxis[0].axisLabel.rotate===34&&
   !!legend&&legend.textContent.includes('登记加班')&&legend.textContent.includes('自动加班')&&
   !document.querySelector('.timeline-auto-dock')&&
   !!OVERTIME_VISUALS.registered&&!Object.values(OVERTIME_VISUALS).some(v=>v.hatch);
 },'R60 overtime columns must be red/rose, fully emphasized, with flatter labels');
 await page.evaluate(()=>{
  const chart=echarts.getInstanceByDom(document.getElementById('asStatChart'));
  const original=chart.dispatchAction.bind(chart);
  state.__r57Actions=[];
  chart.dispatchAction=function(action,...rest){
   if(['highlight','downplay','showTip'].includes(action?.type))
    state.__r57Actions.push({...action});
   return original(action,...rest);
  };
  state.__r57DispatchRestore=()=>{chart.dispatchAction=original;};
 });
 await page.locator('.as-stats-rank-row').nth(0).hover();
 await check(page,()=>{
  const actions=state.__r57Actions||[],links=document.querySelectorAll('.as-stats-rank-row.is-linked');
  const marks=actions.filter(a=>a.type==='highlight');
  const tips=actions.filter(a=>a.type==='showTip');
  return links.length===1&&marks.length>=2&&
   marks.slice(-2).map(a=>a.seriesIndex).join(',')==='0,1'&&
   marks.slice(-2).every(a=>a.dataIndex===marks[marks.length-1].dataIndex)&&
   tips.length>0;
 },'R57 hover must highlight the full stack, not only the upper red segment');
 await page.locator('.as-stats-rank-row').nth(1).hover();
 await check(page,()=>{
  const actions=state.__r57Actions||[],down=actions.filter(a=>a.type==='downplay');
  const marks=actions.filter(a=>a.type==='highlight');
  return down.length>0&&marks.length>=4&&
   marks.slice(-2).map(a=>a.seriesIndex).join(',')==='0,1'&&
   marks[marks.length-1].dataIndex!==marks[marks.length-3].dataIndex&&
   document.querySelectorAll('.as-stats-rank-row.is-linked').length===1;
 },'R57 switching hovered person must downplay previous full stack');
 await page.locator('.as-stats-heading h2').hover();
 await check(page,()=>document.querySelectorAll('.as-stats-rank-row.is-linked').length===0,
  'R57 leaving full column must clear the only current highlight');
 await page.evaluate(()=>{state.__r57DispatchRestore?.();delete state.__r57DispatchRestore;delete state.__r57Actions});
 await page.screenshot({path:path.join(out,'r57-overtime-red-stack.png')});
 await page.locator('#asStatFamily').selectOption('punch');
 await page.locator('#asStatMetric').selectOption('count');

 const firstRank=page.locator('.as-stats-rank-row').first();
 await firstRank.click();
 await check(page,()=>{
  const row=document.querySelector('.as-stats-rank-row');
  const entry=row?.closest('.as-rank-entry');
  return row?.getAttribute('aria-expanded')==='true'&&
    !entry?.querySelector('.as-rank-detail')?.hidden&&
    !entry.querySelector('.as-rank-detail-grid')&&
    !!entry.querySelector('[data-as-drill]')&&state.workspaceMode==='stats';
 },'R52 single rank click must disclose details without navigation');
 await firstRank.click();
 await check(page,()=>document.querySelector('.as-stats-rank-row')?.getAttribute('aria-expanded')==='false'&&
  document.querySelector('.as-rank-detail')?.hidden,'R52 second click must collapse rank details');
 await page.locator('#asStatCompare').selectOption('days');
 await check(page,()=>{
  const data=asStatRows();
  const opts=echarts.getInstanceByDom(document.getElementById('asStatChart')).getOption();
  return data.compare==='days'&&data.rows.length===monthDays()&&
   opts.series[0].type==='line'&&!document.querySelector('[data-as-chart="line"]').disabled;
 },'R52 daily chronology should use a readable line trend');
 await page.locator('#asStatCompare').selectOption('groups');
 await check(page,()=>asStatRows().rows.length===workspaceGroups().length,
  'R52 whole-workforce group comparison broken');
 const exported=page.waitForEvent('download');
 await page.locator('#asStatsExport').click();
 const csv=await exported;
 if(!csv.suggestedFilename().includes('punch'))throw Error('R52 statistics CSV filename incorrect');
 await page.setViewportSize({width:1366,height:768});
 await check(page,()=>{
  const f=[...document.querySelectorAll('.as-stats-filters label')],
   side=document.getElementById('statsSidebarControls'),
   box=side?.getBoundingClientRect(),
   selects=['Family','Metric','Compare','Aggregate','Limit'].map(k=>document.getElementById('asStat'+k));
  const tops=f.map(e=>e.getBoundingClientRect().top),
   lefts=f.map(e=>e.getBoundingClientRect().left);
  const heading=document.querySelector('.as-stats-heading');
  const title=heading.querySelector('h2').getBoundingClientRect(),
   total=heading.querySelector('.as-stats-total').getBoundingClientRect();
  return f.length===5&&f.every((e,i)=>side.contains(e)&&selects[i]&&e.contains(selects[i]))&&
   tops.every((t,i)=>i===0||t>tops[i-1]+22)&&
   lefts.every(x=>Math.abs(x-lefts[0])<3)&&
   selects.every(x=>x.getBoundingClientRect().right<=box.right+2)&&
   Math.abs(title.top-total.top)<24&&
   side.contains(document.getElementById('asStatsScope'))&&
   side.contains(document.getElementById('asStatsExport'))&&
   document.getElementById('asStatsExport').tagName==='BUTTON'&&
   document.getElementById('asStatsExport').textContent.includes('导出')&&
   !document.querySelector('.as-stats-heading .as-stats-filters')&&
   document.documentElement.scrollWidth<=innerWidth+3;
 },'R69 statistics five selectors vertically aligned and export as sidebar button at 1366px');
 await page.screenshot({path:path.join(out,'r52-top-groups-1366.png')});
 await page.setViewportSize({width:1600,height:900});
 await page.screenshot({path:path.join(out,'r52-top-groups-1600.png')});
 await page.setViewportSize({width:1920,height:1080});
 // A double-click on a group row drills into that group, not a generic tab.
 const groupKey=await page.locator('.as-stats-rank-row').first().getAttribute('data-as-rank');
 await page.locator('.as-stats-rank-row').first().dblclick();
 await check(page,key=>state.workspaceMode==='stats'&&state.statsScope==='group'&&
  state.statsGroup===key&&state.statsConfig.compare==='people',groupKey,
  'R52 double-click group row must enter the selected team');
 await page.locator('.as-stats-rank-row').first().click();
 await check(page,()=>!!document.querySelector('.as-rank-breakdown-slot .as-rank-breakdown')&&
  !document.querySelector('.as-rank-entry.is-expanded .as-rank-detail')?.hidden,
  'R52 rank disclosure must contain real source-ledger breakdown');
 const personKey=await page.locator('.as-stats-rank-row').first().getAttribute('data-as-rank');
 await page.locator('.as-rank-entry.is-expanded [data-as-drill]').first().click();
 await check(page,key=>state.workspaceMode==='stats'&&state.statsScope==='person'&&
  state.statsPersonId===key&&asStatRows().people.length===1,personKey,
  'R52 explicit drill action must open the selected employee');
 await page.locator('#asNavBack').click();
 await page.locator('#asNavBack').click();
 await check(page,()=>state.workspaceMode==='stats'&&state.statsScope==='all'&&
  !!document.getElementById('asStatsScope'),'R52 back history lost all-staff statistics');
 await page.locator('#asStatsScope').selectOption('group');
 await check(page,()=>{
  const group=state.statsGroup||workspaceGroups()[0];
  return state.workspaceMode==='stats'&&state.statsScope==='group'&&
   !!document.getElementById('asStatsGroup')&&
   asStatRows().people.length>0&&asStatRows().people.every(e=>groupOf(e)===group);
 },'R52 team scope must not fall back to full-staff statistics');
 await page.screenshot({path:path.join(out,'r52-team-statistics.png')});
 const r63Stats=await page.evaluate(async()=>(await captureCurrentImage('stats')).data);
 fs.writeFileSync(path.join(out,'r63-export-stats.png'),Buffer.from(r63Stats.split(',')[1],'base64'));
 await page.locator('#asStatsScope').selectOption('person');
 await check(page,()=>state.workspaceMode==='stats'&&state.statsScope==='person'&&
  !!document.getElementById('asStatsPerson')&&asStatRows().people.length===1&&
  state.statsConfig.compare==='days','R52 personal scope not one employee/daily trend');
 await page.screenshot({path:path.join(out,'r52-person-statistics.png')});
 const rankedDay=Number(await page.locator('.as-stats-rank-row').first().getAttribute('data-as-rank'));
 if(!rankedDay)throw Error('R52 expected positive daily metric for personal demo');
 await page.locator('.as-stats-rank-row').first().dblclick();
 await page.waitForSelector('#attendanceTimelineChart svg',{timeout:16000});
 await check(page,d=>state.workspaceMode==='person'&&state.analyticsPage==='main'&&
  state.chartDay===d&&state.selection.day===d&&
  !!document.querySelector('.cal-day[data-day="'+d+'"].selected'),
  rankedDay,'R52 double-click ranked day should open matching timeline');
 // The top-level navigation history must return to the statistical context.
 await page.locator('#asNavBack').click();
 await check(page,()=>state.workspaceMode==='stats'&&state.statsScope==='person'&&
  !!document.getElementById('asStatsPerson'),'R52 back navigation lost statistical context');
 // R55: an explicitly labelled DEMO date has a genuine complete-pair
 // candidate. Check both the source evidence and the user-visible route.
 await check(page,()=>{
  const a=state.analysis.get('E001|12');
  return state.isDemo&&!!a&&a.autoOvertime?.minutes===115&&
   a.autoOvertime.segments.length===1&&
   a.autoOvertime.segments[0].from===1030&&
   a.autoOvertime.segments[0].to===1145;
 },'R56 weekday candidate must start at 17:10 and end at 19:05');
 await page.evaluate(()=>{
  state.workspaceMode='person';state.analyticsPage='main';
  state.selection={type:'cell',employeeId:'E001',day:1};
  state.chartDay=1;state.chartTab='timeline';state.timelineRange=null;
  render();
 });
 await check(page,()=>document.querySelectorAll('.person-day.has-auto-overtime').length>0&&
  !document.getElementById('autoOvertimeNext')&&
  !document.querySelector('.timeline-auto-dock')&&
  !!document.querySelector('.person-day.has-auto-overtime[data-person-day="12"]'),
  'R57 no top-right callout; keep candidate-day indicators');
 await check(page,()=>{
  const marked=document.querySelector('.person-day.has-auto-overtime[data-person-day="12"]');
  const marker=getComputedStyle(marked,'::after'),manual=marked.querySelector('.person-day-check')||
    document.querySelector('.person-day-check');
  return marker.left==='2px'&&marker.right!=='2px'&&
    (!manual||getComputedStyle(manual).right==='1px');
 },'R58 overtime dot is left and manual check is right');
 await page.locator('.person-day.has-auto-overtime[data-person-day="12"]').click();
 await check(page,()=>{
  const a=state.analysis.get('E001|'+state.chartDay),bars=r14TrackData(a).bars;
  return a?.autoOvertime.segments.length>0&&
   bars.some(b=>b.origin==='auto'&&b.segmentId===a.autoOvertime.segments[0].id);
 },'R57 tapping the marked date must reveal its actual automatic interval');
 await page.waitForSelector('#overtimeReviewLayer [data-auto-overtime-id]',{timeout:15000});
 await check(page,()=>{
   const chart=echarts.getInstanceByDom(document.getElementById('attendanceTimelineChart'));
   const series=chart.getOption().series,band=series.find(s=>s.id==='bands'),
     punch=series.find(s=>s.id==='punches');
   if(typeof band?.renderItem!=='function'||typeof punch?.renderItem!=='function')return false;
   const day=state.analysis.get('E001|12'),model=r14TrackData(day);
   const index=model.bars.findIndex(b=>b.origin==='auto');
   if(index<0||!model.events.length)return false;
   const interval=model.bars[index],rowHeight=45;
   const api={value:i=>interval.value[i],coord:point=>[point[0],point[1]*rowHeight],
     size:()=>[0,rowHeight]};
   const shape=band.renderItem({dataIndex:index},api);
   const arrow=punch.renderItem({dataIndex:0},{value:i=>model.events[0].value[i],
     coord:point=>[point[0],point[1]*rowHeight],size:()=>[0,rowHeight]});
   const line=arrow?.children?.find(el=>el.type==='line');
   return shape?.type==='rect'&&shape.shape.height>=rowHeight-1&&
    Array.isArray(shape.style?.fill?.colorStops)&&
    Math.abs(line?.shape.y2-line?.shape.y1)>=rowHeight*.80&&
    Math.abs(line?.shape.y2-line?.shape.y1)<=rowHeight;
 },'R57 automatic overtime should draw a solid gradient and punch arrows must fill the lane height');
 await page.screenshot({path:path.join(out,'r57-solid-overtime-timeline.png')});
 const r63PopulatedTimeline=await page.evaluate(async()=>{
  const e=EMPLOYEES.find(x=>x.id===state.selection.employeeId),
   d=state.chartDay||state.selection.day,
   a=e&&state.analysis.get(e.id+'|'+d);
  if(!a||a.punches.length<2)throw Error('R63 needs a non-empty real timeline fixture');
  const image=await captureCurrentImage('timeline');
  if(!image.data.startsWith('data:image/png;base64,')||image.width<1400)
   throw Error('R63 populated timeline image invalid');
  return image.data;
 });
 fs.writeFileSync(path.join(out,'r63-export-populated-timeline.png'),
  Buffer.from(r63PopulatedTimeline.split(',')[1],'base64'));
 // R53: an inferred segment has an independent, persistent inclusion toggle.
 // Use existing synthetic/demo records only; revert revisions after the test.
 const overtimePick=await page.evaluate(()=>{
  const a=[...state.analysis.values()].find(x=>x.autoOvertime?.segments?.some(s=>s.accepted!==false));
  if(!a)return null;
  const original={revisions:state.revisions.slice(),revisionSeq:state.revisionSeq,saved:state.saved};
  state.__r53Restore=original;
  state.workspaceMode='person';state.analyticsPage='main';
  state.selection={type:'cell',employeeId:a.employee.id,day:a.day};
  state.chartDay=a.day;state.chartTab='timeline';state.timelineRange=null;render();
  return {id:a.autoOvertime.segments.find(s=>s.accepted!==false).id,employee:a.employee.id,day:a.day};
 });
 if(!overtimePick)throw Error('R53 demo must contain at least one complete automatic overtime interval');
 await page.waitForSelector('#overtimeReviewLayer .overtime-review-actions',{timeout:16000});
 await check(page,info=>{
  const a=state.analysis.get(info.employee+'|'+info.day),segment=a?.autoOvertime?.segments?.find(s=>s.id===info.id);
  const controls=document.querySelectorAll('#overtimeReviewLayer .overtime-review-btn');
  const active=[...controls].some(btn=>btn.textContent==='✓'&&btn.getAttribute('aria-pressed')==='true');
  return !!segment&&segment.accepted&&active&&
   r14TrackData(a).bars.some(b=>b.origin==='auto'&&b.segmentId===info.id&&b.accepted);
 },overtimePick,'R57 solid automatic-overtime band must retain editable ✓/×');
 await page.screenshot({path:path.join(out,'r53-auto-overtime-included.png')});
 await page.evaluate(info=>{
  const a=state.analysis.get(info.employee+'|'+info.day),seg=a.autoOvertime.segments.find(s=>s.id===info.id);
  const before=asStatValue(asStatLedger(),'overtime','hours',[a.employee],[a.day]);
  state.__r53Before={hours:before,minutes:seg.minutes};
 },overtimePick);
 await page.locator('[data-auto-overtime-id="'+overtimePick.id+'"]').hover();
 await page.locator('[data-auto-overtime-id="'+overtimePick.id+'"] .overtime-review-btn').first().click();
 await page.waitForSelector('[data-auto-overtime-id="'+overtimePick.id+'"].is-excluded');
 await check(page,info=>{
  const a=state.analysis.get(info.employee+'|'+info.day),seg=a.autoOvertime.segments.find(s=>s.id===info.id);
  const after=asStatValue(asStatLedger(),'overtime','hours',[a.employee],[a.day]);
  const layer=[...document.querySelectorAll('.overtime-review-actions')].some(n=>n.classList.contains('is-excluded'));
  return seg.accepted===false&&state.overtimeReview[info.id]===false&&
   Math.abs(after-(state.__r53Before.hours-state.__r53Before.minutes/60))<1e-8&&
   workingPayload().overtimeReview[info.id]===false&&layer;
 },overtimePick,'R53 × must fade segment, persist exclusion and remove its minutes from total');
 await page.screenshot({path:path.join(out,'r53-auto-overtime-excluded.png')});
 await page.locator('[data-auto-overtime-id="'+overtimePick.id+'"]').hover();
 await page.locator('[data-auto-overtime-id="'+overtimePick.id+'"] .overtime-review-btn').nth(1).click();
 await page.waitForSelector('[data-auto-overtime-id="'+overtimePick.id+'"]:not(.is-excluded)');
 await check(page,info=>{
  const a=state.analysis.get(info.employee+'|'+info.day),seg=a.autoOvertime.segments.find(s=>s.id===info.id);
  const after=asStatValue(asStatLedger(),'overtime','hours',[a.employee],[a.day]);
  return seg.accepted===true&&state.overtimeReview[info.id]!==false&&
   Math.abs(after-state.__r53Before.hours)<1e-8;
 },overtimePick,'R53 ✓ must restore time and avoid doubling registered minutes');
 await page.evaluate(()=>{
  const old=state.__r53Restore;
  if(old){state.revisions=old.revisions;state.revisionSeq=old.revisionSeq;state.saved=old.saved}
  delete state.__r53Restore;delete state.__r53Before;
  rememberMonth();
 });
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
     !!insight.querySelector('.r74-unified-insight')&&
     insight.querySelectorAll('.r74-insight-head').length===2&&
     !insight.querySelector('[data-insight-tab]')&&
     ['首进','末出','在岗'].every(k=>[...insight.querySelectorAll('.r74-overview-metrics .insight-row span')].some(x=>x.textContent===k))&&
     insight.querySelectorAll('.r74-behavior-list .insight-behavior-row').length===4;
 },'R74 unified personal panel shows overview and behavior together');
 await check(page,()=>{
   const h=[...document.querySelectorAll('.r74-insight-head strong')];
   const rows=[...document.querySelectorAll('.r74-behavior-list .insight-behavior-row')];
   return h.length===2&&h[0].textContent==='概况'&&h[1].textContent==='行为'&&
    Math.abs(parseFloat(getComputedStyle(h[0]).fontSize)-parseFloat(getComputedStyle(h[1]).fontSize))<.5&&
    rows.length===4&&['出差','请假','外出','加班'].every(k=>rows.some(r=>r.textContent.includes(k)))&&
    rows.find(r=>r.classList.contains('leave'))?.classList.contains('active');
 },'R74 matched overview/behavior typography and filters');
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
 await page.locator('#settingAppTitle').fill('项目考勤');
 await page.locator('#settingFont').selectOption('1.08');
 await page.locator('#settingMotion').uncheck();
 await page.locator('#settingsApply').click();
 await check(page,()=>state.prefs.fontScale===1.08&&state.prefs.motion===false&&
    state.prefs.appTitle==='项目考勤'&&document.title.startsWith('项目考勤')&&workingPayload().prefs.appTitle==='项目考勤'&&
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
    const plan=importRosterPlan(['同名员工',' 同名员工 '],'leave');
    return plan.people.length===1&&plan.people[0].id===personIdentity('同名员工')&&
     plan.byName.get('同名员工')?.id===personIdentity('同名员工')&&
     validateImportIdentityRows([{姓名:'乙',工号:'01'},{姓名:'乙',工号:'02'}])===true;
   }finally{EMPLOYEES=before}
 },'R62 same normalized name is one identity regardless of gate employee numbers');
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

 // R73 dual-list: two real columns, bidirectional pinning, group editor and refined tooltip.
 {
  const roster=await browser.newPage({viewport:{width:1600,height:900}});
  roster.on('dialog',dialog=>dialog.accept());
  try{
   await roster.goto(url,{waitUntil:'load'});
   await roster.locator('[data-workspace="data"]').click();
   await roster.locator('[data-data-section="roster"]').click();
   await roster.waitForSelector('#r73MonthList .r73-person-row');
   const layout=await roster.evaluate(()=>{
    const left=document.getElementById('r73MonthList').getBoundingClientRect(),
      right=document.getElementById('r73FixedList').getBoundingClientRect();
    return {left:left.width,right:right.width,spaced:left.right<right.left,
      month:document.querySelectorAll('#r73MonthList .r73-person-row').length,
      fixed:document.querySelectorAll('#r73FixedList .r73-person-row').length,
      overflow:document.documentElement.scrollWidth-innerWidth};
   });
   if(!layout.spaced||layout.left<260||layout.right<260||layout.month!==50||
    layout.fixed!==0||layout.overflow>3)throw Error('R73 dual lists geometry '+JSON.stringify(layout));
   await roster.locator('[data-r68-person]').first().check();
   await roster.locator('[data-r68-person]').nth(1).check();
   await roster.locator('#r72FixSelected').click();
   await roster.waitForFunction(()=>document.querySelectorAll('#r73FixedList .r73-person-row').length===2);
   if(await roster.locator('#r73MonthList .r73-person-row').count()!==50)
    throw Error('R73 pin unexpectedly removed monthly staff');
   await roster.locator('[data-r73-fixed-person]').first().check();
   await roster.locator('#r72UnfixSelected').click();
   await roster.waitForFunction(()=>document.querySelectorAll('#r73FixedList .r73-person-row').length===1);
   if(await roster.locator('#r73MonthList .r73-person-row').count()!==50)
    throw Error('R73 unpin unexpectedly removed monthly staff');
   await roster.locator('#r73EditGroups').click();
   await roster.waitForSelector('.r73-modal[role="dialog"]');
   await roster.locator('#r73NewGroup').fill('R73浏览器组');
   await roster.locator('#r73GroupCreateForm button').click();
   await roster.waitForFunction(()=>[...document.querySelectorAll('.r73-editor-row input')]
    .some(input=>input.value==='R73浏览器组'));
   await roster.locator('#r73CloseGroups').click();
   if(await roster.locator('.r73-modal').count())throw Error('R73 group editor not closed');
   await roster.locator('.r73-help').first().hover();
   await roster.waitForSelector('#r73FloatingTip.is-visible');
   const tip=await roster.evaluate(()=>{
    const el=document.getElementById('r73FloatingTip'),rect=el.getBoundingClientRect();
    return {text:el.textContent,width:rect.width,top:rect.top,left:rect.left,
      bottom:rect.bottom,native:!!document.querySelector('.r73-help[title]')};
   });
   if(tip.native||tip.width<140||tip.top<0||tip.left<0||tip.bottom>900||
     (tip.top<46))
    throw Error('R73 tooltip should be custom and onscreen '+JSON.stringify(tip));
   await roster.screenshot({path:path.join(out,'r73-help-tooltip.png')});
   await roster.locator('#r68RosterSearch').click();
   await roster.screenshot({path:path.join(out,'r73-dual-roster.png')});
   await roster.setViewportSize({width:1366,height:768});
   const narrow=await roster.evaluate(()=>{
    const l=document.querySelector('.r73-month-pane').getBoundingClientRect(),
      r=document.querySelector('.r73-fixed-pane').getBoundingClientRect();
    return {left:l.width,right:r.width,rightEnd:r.right,page:document.documentElement.scrollWidth};
   });
   if(narrow.left<235||narrow.right<235||narrow.rightEnd>1367||narrow.page>1369)
    throw Error('R73 1366 desktop clipping '+JSON.stringify(narrow));
   await roster.screenshot({path:path.join(out,'r73-dual-roster-1366.png')});
   const independent=await roster.evaluate(()=>{
    // Simulate a month with only one attendee while retaining an off-month fixed person.
    const expected=r73FixedRoster().length;
    EMPLOYEES=EMPLOYEES.filter(e=>!state.fixedPeople.includes(e.id));
    reanalyze();render();return {left:EMPLOYEES.length,right:r73FixedRoster().length,expected};
   });
   if(independent.right!==1||independent.right!==independent.expected||
    await roster.locator('#r73FixedList .r73-person-row').count()!==1)
    throw Error('R73 off-month pinned staff went missing '+JSON.stringify(independent));
   await roster.locator('#r73SelectFixed').check();
   await roster.locator('#r72UnfixSelected').click();
   await roster.waitForFunction(()=>document.querySelectorAll('#r73FixedList .r73-person-row').length===0);
  }finally{await roster.close()}
 }
 // R72: roster identity editing, group creation/deletion, fixed staff only.
 await page.evaluate(async()=>{
  navigateWorkspace('data');state.dataSection='roster';render();
  if(!document.querySelector('#r73EditGroups')||!document.querySelector('#r72FixSelected'))
   throw Error('R72 roster actions not mounted');
  const previous=window.prompt,person=EMPLOYEES[0],originalId=person.id,originalName=person.name;
  try{
   window.prompt=()=> 'R72自建分组';
   await r72CreateGroup();
   if(!state.groupCatalog.includes('R72自建分组'))throw Error('R72 group creation failed');
   state.groups[originalId]='R72自建分组';
   r72MarkDirty('assign-group',{employeeId:originalId,to:'R72自建分组'});
   window.prompt=()=> 'R72更名组';
   await r72RenameGroup('R72自建分组');
   if(groupOf(EMPLOYEES.find(e=>e.id===originalId))!=='R72更名组'||
      state.groupCatalog.includes('R72自建分组'))throw Error('R72 group rename association lost');
   await r72FixedPeople([originalId],true);
   if(!state.fixedPeople.includes(originalId))throw Error('R72 fixed entry missing');
   const originalRows=state.records.filter(r=>r.employeeId===originalId).length;
   window.prompt=()=> 'R72自定义姓名';
   r72RenamePerson(originalId);
   const id=personIdentity('R72自定义姓名');
   if(!EMPLOYEES.some(e=>e.id===id)||state.fixedPeople.indexOf(id)<0||
    state.records.filter(r=>r.employeeId===id).length!==originalRows)
    throw Error('R72 canonical rename lost linked records');
   if(originalRows&&!state.records.some(r=>r.employeeId===id&&r.sourceName))
    throw Error('R72 original source name not retained');
   if(importRosterPlan([originalName],'attendance').byName.get(originalName).id!==id)
    throw Error('R72 original imported name must map to renamed canonical identity');
   await r72DeleteGroup('R72更名组');
   if(groupOf(EMPLOYEES.find(e=>e.id===id))!=='未分组'||state.groupCatalog.includes('R72更名组'))
    throw Error('R72 delete group must reassign without deleting person');
   state.isDemo=false;rememberMonth();
   switchMonth(2028,2,true);
   if(EMPLOYEES.length!==1||EMPLOYEES[0].id!==id||state.records.length!==0)
    throw Error('R72 new month should inherit ONLY fixed people, no prior raw');
   await r72FixedPeople([id],false);
   switchMonth(2026,10);
   if(state.fixedPeople.includes(id))throw Error('R72 removing a fixed person must persist across month switches');
   if(state.fixedPeople.includes(id)||!EMPLOYEES.some(e=>e.id===id))
    throw Error('R72 unfix must preserve current month');
  }finally{window.prompt=previous}
 });
 // R72 real SVG/DOM integration: prove both flags are rendered next to punches.
 {
  const flagPage=await browser.newPage({viewport:{width:1600,height:900}});
  try{
   await flagPage.goto(page.url(),{waitUntil:'load'});
   await flagPage.evaluate(()=>{
    const e=EMPLOYEES[0],date='2026-10-08';
    state.records=[['08:36','进'],['11:30','出'],['13:25','进'],['17:10','出']].map(([time,direction],i)=>
     ({recordId:'r72flag:'+i,employeeId:e.id,name:e.name,
      datetime:date+' '+time,time,direction}));
    state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];
    reanalyze();
    state.workspaceMode='person';state.selection={type:'cell',employeeId:e.id,day:8};
    state.chartTab='timeline';state.chartDay=8;render();
   });
   await flagPage.waitForFunction(()=>{
    const text=[...document.querySelectorAll('.r72-attendance-tag')].map(el=>el.textContent);
    return text.includes('迟到')&&text.includes('上午早退');
   },{timeout:15000});
   const positions=await flagPage.evaluate(()=>{
    const layer=document.getElementById('attendanceFlagsLayer'),rect=layer.getBoundingClientRect();
    return [...layer.querySelectorAll('.r74-attendance-tag')].map(tag=>{
      const r=tag.getBoundingClientRect(),axis=Number(tag.dataset.anchorX);
      return {text:tag.textContent,anchor:axis,left:r.left-rect.left,right:r.right-rect.left,
        top:r.top-rect.top};
    });
   });
   if(positions.length<2||positions.some(p=>!Number.isFinite(p.anchor)||
       Math.min(Math.abs(p.left-p.anchor),Math.abs(p.right-p.anchor))<9||p.top<0))
    throw Error('R74 labels must clear their event arrow shaft '+JSON.stringify(positions));
   const tags=await flagPage.locator('.r72-attendance-tag').count();
   if(tags<2)throw Error('R72 flags not visible in actual timeline');
   await flagPage.screenshot({path:path.join(out,'r72-timeline-late-early.png')});
  }finally{await flagPage.close()}
 }
 await require('./lifecycle-audit.cjs')({browser,out,root});
 await require('./ui-audit.cjs')({browser,out,root});
 if(!process.env.P109_URL&&remote.length)throw Error('Network requests from offline app '+JSON.stringify(remote));
 if(errors.length)throw Error('Browser errors '+JSON.stringify(errors));
 console.log('P109_BROWSER_SMOKE_PASS '+JSON.stringify({r:'R76',remote:remote.length,errors:errors.length,layout}));
 await context.close();
}
run().catch(e=>{console.error('P109_BROWSER_SMOKE_FAIL',e.stack||e);process.exitCode=1})
 .finally(async()=>{if(browser)await browser.close()});
