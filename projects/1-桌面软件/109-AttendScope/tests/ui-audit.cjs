/* R77 cross-workspace UI audit. Uses the actual offline app, not DOM mocks. */
'use strict';
const fs=require('fs'),path=require('path');
const {pathToFileURL}=require('url');

module.exports=async function runUiAudit({browser,out,root}){
 const page=await browser.newPage({viewport:{width:1600,height:900},acceptDownloads:true});
 // Baseline audits explicitly select Demo; R80 separately tests the first-use entry.
 await page.addInitScript(()=>{if(!localStorage.getItem('p109-session-mode'))localStorage.setItem('p109-session-mode','demo')});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const url=pathToFileURL(path.join(root,'index.html')).href;
 const check=(ok,label,details='')=>{if(!ok)throw Error('R77 UI audit: '+label+(details?' · '+JSON.stringify(details):''))};
 try{
  await page.goto(url,{waitUntil:'load',timeout:60000});
  await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  await page.waitForSelector('.topbar .workspace-navigation [data-workspace="all"]',{timeout:20000});
  check(await page.locator('.m-name .name-letters').count()>0,'initial demo matrix is not rendered');

  // Test header and overall page geometry at normal desktop/laptop widths.
  const geometry=[];
  for(const width of [1920,1600,1440,1366,1280]){
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(60);
   const g=await page.evaluate(()=> {
    const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
    const brand=rect('.brand'),nav=rect('.workspace-navigation'),actions=rect('.top-global-actions'),bar=rect('.topbar');
    return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
     brand,nav,actions,bar,headerOrder:!!brand&&!!nav&&!!actions&&brand.right<=nav.left+5&&nav.right<=actions.left+5,
     duplicateIds:[...document.querySelectorAll('[id]')].map(x=>x.id).filter((id,i,a)=>a.indexOf(id)!==i).filter((v,i,a)=>a.indexOf(v)===i)};
   });
   geometry.push(g);
   check(g.documentWidth<=width+2&&g.bodyWidth<=width+2,'unexpected page-level horizontal overflow',g);
   check(g.headerOrder,'topbar groups overlap or reorder',g);
   check(g.duplicateIds.length===0,'duplicate DOM IDs on initial workspace',g.duplicateIds);
  }
  await page.setViewportSize({width:1600,height:900});
  await page.screenshot({path:path.join(out,'r77-ui-overview.png')});

  // Navigate using the real five primary navigation buttons.
  const views=[
   ['all','.scope-insights'],
   ['group','.scope-insights'],
   ['person','.r77-anomaly-summary'],
   ['stats','#statisticsWorkspace'],
   ['data','[data-data-section]']
  ];
  for(const [mode,required] of views){
   await page.locator('[data-workspace="'+mode+'"]').click();
   await page.waitForFunction(m=>document.querySelector('.layout')?.classList.contains('workspace-mode-'+m),mode,{timeout:15000});
   await page.waitForTimeout(90);
   const ok=await page.evaluate(({mode,required})=>{
    const nav=document.querySelector('[data-workspace="'+mode+'"]');
    return !!document.querySelector(required)&&nav?.getAttribute('aria-current')==='page'&&nav.classList.contains('active');
   },{mode,required});
   check(ok,'workspace navigation did not activate '+mode);
   const duplicates=await page.evaluate(()=>[...document.querySelectorAll('[id]')].map(x=>x.id)
    .filter((id,i,a)=>a.indexOf(id)!==i).filter((v,i,a)=>a.indexOf(v)===i));
   check(!duplicates.length,'duplicate IDs in '+mode,duplicates);
   await page.screenshot({path:path.join(out,'r77-ui-'+mode+'.png')});
  }

  // Every data-management section must render a real page and keep one active section.
  const sections=['overview','months','health','storage','calendar','roster','rules','templates','records','imports','freezes'];
  for(const section of sections){
   await page.locator('[data-data-section="'+section+'"]').click();
   await page.waitForFunction(s=>state.dataSection===s,section,{timeout:15000});
   await page.waitForTimeout(80);
   const data=await page.evaluate(s=>{
    const active=[...document.querySelectorAll('[data-data-section].active')];
    const pane=document.querySelector('.r71-data-content,.r68-data-studio,.r68-project-workspace,.r74-roster-header,#rawDataTable,.r71-setup');
    const heading=document.querySelector('.r71-content-head h3,.r69-section-title h2,.r74-roster-header .r71-content-head h3');
    return {active:active.map(x=>x.dataset.dataSection),pane:!!pane,heading:heading?.textContent?.trim()||'',
     content:(document.querySelector('.analysis-body')?.innerText||'').trim().length,
     errors:[...document.querySelectorAll('.toast')].map(x=>x.textContent)};
   },section);
   check(data.active.length===1&&data.active[0]===section,'data section active state mismatch',data);
   check(data.pane||data.content>10,'data section is blank: '+section,data);
   if(section==='roster')await page.screenshot({path:path.join(out,'r77-ui-data-roster.png')});
   if(section==='rules')await page.screenshot({path:path.join(out,'r77-ui-data-rules.png')});
   if(section==='overview')await page.screenshot({path:path.join(out,'r77-ui-data-overview.png')});
  }

  // Settings: every tab renders, cancel is non-destructive, Escape closes and restores focus.
  await page.locator('#settingsBtn').click();
  await page.waitForSelector('.settings-overlay:not(.hidden)');
  check(await page.locator('[data-settings-section]').count()===7,'settings categories missing');
  const settingSections=['appearance','matrix','timeline','table','rules','data','advanced'];
  for(const section of settingSections){
   await page.locator('[data-settings-section="'+section+'"]').click();
   await page.waitForFunction(s=>document.querySelector('[data-settings-section="'+s+'"]')?.classList.contains('active'),section);
   const stateView=await page.evaluate(()=>({
    text:document.querySelector('#settingsContent')?.innerText?.trim()||'',
    inputs:document.querySelectorAll('#settingsContent input,#settingsContent select').length
   }));
   check(stateView.text.length>10,'settings tab content missing: '+section,stateView);
   if(section==='advanced'||section==='appearance')await page.screenshot({path:path.join(out,'r77-ui-settings-'+section+'.png')});
  }
  const beforePrefs=await page.evaluate(()=>JSON.stringify(state.prefs));
  await page.keyboard.press('Escape');
  check(await page.locator('.settings-overlay:not(.hidden)').count()===0,'Escape did not close settings');
  check(await page.evaluate(()=>document.activeElement?.id)==='settingsBtn','closing settings did not restore focus');
  check(await page.evaluate(()=>JSON.stringify(state.prefs))===beforePrefs,'closing settings changed preferences');

  // Return to the standard sidebar before checking its visible status picker.
  await page.locator('[data-workspace="all"]').click();
  await page.waitForFunction(()=>document.querySelector('.layout')?.classList.contains('workspace-mode-all'));

  // R77: the combined late/early filter must use the same canonical attendance flags
  // as the personal month strip, and must have its own non-overtime color.
  const lateEarlyCount=await page.evaluate(()=>[...state.analysis.values()].filter(attendanceHasLateEarly).length);
  check(lateEarlyCount>0,'demo analysis has no late/early cases for regression');
  await page.locator('#statusFilterButton').click();
  check(await page.locator('[data-filter-value="lateEarly"]').count()===1,'late/early status filter option missing');
  const filterColor=await page.locator('[data-filter-value="lateEarly"] .status-filter-dot').evaluate(el=>getComputedStyle(el).backgroundColor);
  check(filterColor==='rgb(66, 137, 197)','late/early filter color is not the dedicated blue',filterColor);
  await page.locator('[data-filter-value="lateEarly"]').click();
  await page.waitForFunction(()=>state.filter==='lateEarly');
  const filteredCells=await page.evaluate(()=>({
   count:document.querySelectorAll('#matrix button.s-lateEarly').length,
   allMatch:[...document.querySelectorAll('#matrix button.s-lateEarly')].every(button=>{
    const [id,day]=button.dataset.cell.split('|');
    return attendanceHasLateEarly(state.analysis.get(id+'|'+day));
   }),
   color:document.querySelector('#matrix button.s-lateEarly')?
    getComputedStyle(document.querySelector('#matrix button.s-lateEarly')).backgroundColor:''
  }));
  check(filteredCells.count>0&&filteredCells.allMatch,'late/early filter highlights unrelated cells',filteredCells);
  check(filteredCells.color==='rgb(66, 137, 197)','matrix late/early color differs from the filter swatch',filteredCells);
  await page.locator('#statusFilterButton').click();
  await page.locator('[data-filter-value="main"]').click();
  await page.waitForFunction(()=>state.filter==='main');

  // A real late/early day is marked on the personal month strip. The two top-left
  // markers must remain separately visible if the same day also has overtime.
  const target=await page.evaluate(()=>{
   for(const employee of EMPLOYEES)for(let day=1;day<=monthDays();day++){
    const item=state.analysis.get(employee.id+'|'+day);
    if(attendanceHasLateEarly(item))return {id:employee.id,day,group:groupOf(employee),month:monthKey()};
   }
   return null;
  });
  check(!!target,'could not find a concrete late/early day for personal-strip regression');
  await page.locator('.m-name[data-emp="'+target.id+'"]').click();
  await page.locator('[data-workspace="person"]').click();
  await page.waitForFunction(()=>document.querySelector('.layout')?.classList.contains('workspace-mode-person'));
  const dayMarker=page.locator('.person-day[data-person-day="'+target.day+'"]');
  check(await dayMarker.evaluate(el=>el.classList.contains('has-late-early')),
   'personal month strip omitted the late/early marker',target);
  const dotStyles=await dayMarker.evaluate(el=>{
   const hadOvertime=el.classList.contains('has-auto-overtime');
   el.classList.add('has-auto-overtime');
   const before=getComputedStyle(el,'::before'),after=getComputedStyle(el,'::after');
   const result={beforeContent:before.content,beforeColor:before.backgroundColor,beforeLeft:before.left,
    afterContent:after.content,afterColor:after.backgroundColor,afterLeft:after.left};
   if(!hadOvertime)el.classList.remove('has-auto-overtime');
   return result;
  });
  check(dotStyles.beforeContent!=='none'&&dotStyles.beforeColor==='rgb(66, 137, 197)'&&
   dotStyles.afterContent!=='none'&&dotStyles.beforeLeft==='9px'&&dotStyles.afterLeft==='2px'&&
   dotStyles.beforeColor!==dotStyles.afterColor,'late/early and overtime dots do not coexist distinctly',dotStyles);
  await dayMarker.click();
  await page.waitForFunction(t=>state.workspaceMode==='person'&&state.selection.type==='cell'&&
   state.selection.employeeId===t.id&&state.selection.day===t.day&&state.chartTab==='timeline',target);
  check(await page.locator('#personOverviewButton').count()===1,'single-day personal analysis has no return-to-overview button');
  const beforeReturn=await page.evaluate(()=>({employeeId:state.selection.employeeId,group:groupOf(EMPLOYEES.find(e=>e.id===state.selection.employeeId)),
   month:monthKey(),filter:state.filter,workspace:state.workspaceMode}));
  await page.locator('#personOverviewButton').click();
  await page.waitForFunction(t=>state.workspaceMode==='person'&&state.selection.type==='person'&&
   state.selection.employeeId===t.id&&state.chartTab==='overview'&&state.chartDay===null,target);
  const afterReturn=await page.evaluate(()=>({employeeId:state.selection.employeeId,group:groupOf(EMPLOYEES.find(e=>e.id===state.selection.employeeId)),
   month:monthKey(),filter:state.filter,workspace:state.workspaceMode,dayNav:!!document.querySelector('.person-day-nav')}));
  check(afterReturn.employeeId===beforeReturn.employeeId&&afterReturn.group===beforeReturn.group&&
   afterReturn.month===beforeReturn.month&&afterReturn.filter===beforeReturn.filter&&
   afterReturn.workspace==='person'&&!afterReturn.dayNav,
   'return-to-person-overview changed context or remained in day detail',{beforeReturn,afterReturn});
  await page.screenshot({path:path.join(out,'r77-ui-person-overview.png')});
  // R77: a filter applied inside day detail must return to a consistent month view.
  await dayMarker.click();
  await page.waitForFunction(()=>state.selection.type==='cell'&&state.chartTab==='timeline');
  await page.locator('#statusFilterButton').click();
  await page.locator('[data-filter-value="lateEarly"]').click();
  await page.waitForFunction(()=>state.workspaceMode==='person'&&state.selection.type==='person'&&
    state.chartDay===null&&state.chartTab==='overview'&&state.filter==='lateEarly');
  const monthly=await page.evaluate(()=>{
    const e=state.selection.employeeId,dayButtons=[...document.querySelectorAll('.r77-anomaly-days button')];
    const summary=document.querySelector('.r77-anomaly-summary');
    const all=Array.from({length:monthDays()},(_,i)=>state.analysis.get(e+'|'+(i+1)));
    const work=all.filter(a=>isWorkday(a.day)&&attendanceJudgment(a)!=='rest');
    const flags=work.filter(attendanceHasLateEarly).length;
    const view=analysisViewItems({items:all}).filter(a=>isWorkday(a.day)&&attendanceJudgment(a)!=='rest').length;
    const label=[...document.querySelectorAll('.insight-row')].find(r=>r.querySelector('span')?.textContent==='占工作日');
    return {summary:!!summary,days:dayButtons.length,flags,work:work.length,view,percent:label?.querySelector('strong')?.textContent,
      selected:document.querySelectorAll('.person-day.selected').length};
  });
  check(monthly.summary&&monthly.days===monthly.flags&&monthly.selected===0&&
    monthly.percent===(monthly.work?Math.round(monthly.view/monthly.work*100):0)+'%',
   'R77 monthly filter denominator or anomaly drilldown inconsistent',monthly);
  if(monthly.days){
    await page.locator('.r77-anomaly-days button').first().click();
    await page.waitForFunction(()=>state.selection.type==='cell'&&state.chartTab==='timeline');
    const tip=await page.locator('.person-day.has-late-early').first().getAttribute('title');
    check(/系统检测：/.test(tip)&&/\d{2}:\d{2}/.test(tip),'R77 date tooltip lacks precise flagged time',tip);
  }
  await page.locator('[data-workspace="all"]').click();
  await page.waitForFunction(()=>document.querySelector('.layout')?.classList.contains('workspace-mode-all'));

  // Popovers and import preview must be dismissible by Escape without mutating source data.
  await page.locator('#monthMenuButton').click();
  await page.keyboard.press('Escape');
  check(await page.locator('#monthPopover.open').count()===0,'Escape did not close month picker');
  await page.locator('#statusFilterButton').click();
  await page.keyboard.press('Escape');
  check(await page.locator('#statusFilterMenu.open').count()===0,'Escape did not close status filter');

  await page.locator('#exportMenuButton').click();
  await page.locator('#printReport').click();
  await page.waitForSelector('#r63PdfClose',{timeout:15000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.getElementById('r63PdfPicker')?.hidden===true);
  await page.locator('#projectMenuButton').click();
  await page.locator('#p109ProjectControl').click();
  await page.waitForSelector('.p109-project-overlay',{timeout:15000});
  await page.waitForSelector('#p109ProjectClose',{timeout:15000});
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.p109-project-overlay'));
  const beforeImport=await page.evaluate(()=>JSON.stringify({records:state.records.length,people:EMPLOYEES.length,imports:state.imports.length}));
  await page.locator('#attendanceInput').setInputFiles({
   name:'R77-取消导入.csv',mimeType:'text/csv',
   buffer:Buffer.from('姓名,日期,时间,进出\nUI审计甲,2026-10-22,08:30,进\nUI审计甲,2026-10-22,17:30,出\n','utf8')
  });
  await page.waitForSelector('.r62-overlay',{timeout:20000});
  check(await page.locator('.r62-overlay[role="dialog"][aria-modal="true"]').count()===1,'import preview is not an accessible modal');
  await page.screenshot({path:path.join(out,'r77-ui-import-preview.png')});
  await page.keyboard.press('Escape');
  check(await page.locator('.r62-overlay').count()===0,'Escape did not cancel import preview');
  check(await page.evaluate(()=>JSON.stringify({records:state.records.length,people:EMPLOYEES.length,imports:state.imports.length}))===beforeImport,
   'cancelling import changed records or roster');

  // Verify the visible primary actions have names and the main viewport is not clipped.
  const controls=await page.evaluate(()=>{
   const ids=['asNavBack','asNavForward','monthMenuButton','importBtn','projectMenuButton',
    'saveBtn','exportMenuButton','settingsBtn'];
   return ids.map(id=>{const e=document.getElementById(id);return {id,exists:!!e,
    name:e?([e.getAttribute('aria-label'),e.getAttribute('title'),e.innerText].filter(Boolean).join(' ').trim()):''}});
  });
  check(controls.every(x=>x.exists&&x.name.length>0),'topbar action lacks accessible name',controls.filter(x=>!x.exists||!x.name));
  check(!errors.length,'browser emitted runtime errors',errors);
  fs.writeFileSync(path.join(out,'p109-r77-ui-audit.json'),JSON.stringify({
   version:'R78',viewportGeometry:geometry,workspaces:views.map(x=>x[0]),dataSections:sections,
   settingsSections:settingSections,escapeDismissal:true,cancelledImportNonDestructive:true,
   primaryControlsNamed:true,runtimeErrors:errors
  },null,2));
  console.log('P109_R78_UI_AUDIT_PASS '+JSON.stringify({viewports:geometry.map(x=>x.viewport),workspaces:views.map(x=>x[0]),dataSections:sections.length,settingsSections:settingSections.length,errors:errors.length}));
 }finally{await page.close()}
};
