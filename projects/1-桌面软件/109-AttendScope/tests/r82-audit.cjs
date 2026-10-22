/* Detailed guide acceptance: actual tutorial downloads/imports, offline manual,
 * reading state, modal geometry and content-driven scroll extents. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,out,root})=>{
 const context=await browser.newContext({viewport:{width:1600,height:900},acceptDownloads:true}),page=await context.newPage();
 const report={revision:'R82',checks:[],geometry:[],scroll:[]},errors=[],remote=[];
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});page.on('dialog',d=>d.accept());
 const openGuide=async(section,id)=>{await page.evaluate(([section,id])=>p109ShowHelp(section,id),[section,id]);await page.waitForSelector('#p109HelpOverlay')};
 const contentSnapshot=()=>page.evaluate(()=>JSON.stringify({records:state.records,leaves:state.leaves,trips:state.trips,outings:state.outings,overtime:state.overtimeEntries,groups:state.groups,manual:state.manualStatuses,imports:state.imports,rules:RULES}));
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);
  await page.locator('#r82EntryHelp').click();
  check(await page.locator('#p109HelpOverlay').isVisible(),'first-use mode choice offers the tutorial before any project is created');
  await page.keyboard.press('Escape');check(await page.locator('#r80Work').isVisible()&&await page.locator('#r82EntryHelp').evaluate(e=>e===document.activeElement),'closing first-use help returns to the required mode choice');
  await page.locator('#r80Work').click();await page.locator('#r80MemoryWork').click();
  check(await page.locator('.r81-project-location,#p109ProgramPath,.r81-program-footer').count()===0,'home contains neither permanent path row nor path footer');
  await openGuide('start','overview');
  for(const [width,height] of [[1280,720],[1366,768],[1600,900],[1920,1080]]){
   await page.setViewportSize({width,height});
   const g=await page.locator('.r82-guide-panel').evaluate(el=>{const r=el.getBoundingClientRect();return{width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,ratio:r.width/innerWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1}});
   report.geometry.push(g);check(g.ratio>.8&&g.ratio<.91&&g.top>=0&&g.bottom<=height+1&&!g.bodyOverflow,'guide uses over 80% width without escaping viewport: '+width+'×'+height);
  }
  await page.setViewportSize({width:1600,height:900});
  await page.locator('[data-help-lesson="first-import"]').click();
  check(await page.locator('#r81HelpArticle [data-guide-download="attendance"]').count()===1&&await page.locator('#r81HelpArticle table').count()>=2,'first-import lesson includes a downloadable example, column mapping and result checks');
  const pictures=await page.locator('#r81HelpArticle img').evaluateAll(images=>images.map(image=>({src:image.getAttribute('src'),complete:image.complete,width:image.naturalWidth})));
  await page.waitForFunction(()=>[...document.querySelectorAll('#r81HelpArticle img')].every(img=>img.complete&&img.naturalWidth>0));
  check(pictures.length>0,'tutorial has actual application screenshots');
  await page.screenshot({path:path.join(out,'r82-guide-first-import.png')});
  await page.locator('#r82GuideSearch').fill('跨日');
  check(await page.locator('[data-guide-link="topics|leave"]').count()>0&&await page.locator('[data-guide-link="topics|overtime"]').count()>0,'full-text search finds different cross-day business rules');
  await page.locator('[data-guide-link="topics|leave"]').click();
  check((await page.locator('#r81HelpArticle').textContent()).includes('请假向导没有“开始日期、结束日期”两个字段'),'leave tutorial corrects the former unsupported start/end-date claim');
  await page.locator('#r82GuideSearch').fill('<img src=x onerror="window.guideAttack=1">');
  check(await page.locator('#p109HelpOverlay [onerror]').count()===0&&await page.evaluate(()=>!window.guideAttack),'search text is inert rather than executable markup');
  await page.locator('[data-guide-clear]').first().click();await page.locator('[data-help-topic="storage"]').click();
  await page.locator('#r81HelpArticle').evaluate(el=>{el.scrollTop=400});const stored=await page.locator('#r81HelpArticle').evaluate(el=>el.scrollTop);
  await page.locator('[data-help-topic="export"]').click();await page.locator('[data-help-topic="storage"]').click();
  check(Math.abs(await page.locator('#r81HelpArticle').evaluate(el=>el.scrollTop)-stored)<2,'chapter navigation preserves its reading position');
  await page.keyboard.press('Escape');await page.locator('#p109Help').click();
  check(await page.locator('[data-help-topic="storage"]').getAttribute('aria-current')==='page'&&Math.abs(await page.locator('#r81HelpArticle').evaluate(el=>el.scrollTop)-stored)<2,'reopening help resumes the chapter and position');
  const beforeRead=await contentSnapshot();
  await page.locator('[data-help-topic="overtime"]').click();await page.locator('[data-help-section="start"]').click();await page.locator('[data-help-lesson="project"]').click();
  check(await contentSnapshot()===beforeRead,'reading and navigation do not mutate business records or rules');
  const manualEvent=page.waitForEvent('download');await page.locator('#r82GuideExport').click();const manual=await manualEvent,manualText=fs.readFileSync(await manual.path(),'utf8');
  check(!/<script\b|<img\b|https?:\/\//i.test(manualText)&&manualText.includes('按症状处理')&&manualText.includes('单日与多日拆分')&&manualText.includes('manual-start-project'),'downloaded detailed manual is readable offline and includes both tutorial tracks');
  fs.writeFileSync(path.join(out,'R82-详细教程.html'),manualText);
  await page.keyboard.press('Escape');
  for(const [kind,count] of [['attendance',8],['leave',1],['trip',1],['outing',1],['overtime',1]]){
   await openGuide('topics',kind);const event=page.waitForEvent('download');await page.locator('[data-guide-download="'+kind+'"]').click();const file=await event;
   const bytes=fs.readFileSync(await file.path());check(bytes.subarray(0,3).equals(Buffer.from([239,187,191])),'tutorial CSV is UTF-8 BOM: '+kind);
   await page.keyboard.press('Escape');await page.locator('#'+kind+'Input').setInputFiles({name:file.suggestedFilename(),mimeType:'text/csv',buffer:bytes});await page.waitForSelector('#r62Commit');
   check(await page.evaluate(count=>r62ImportDraft.validated.rows.length===count&&r62ImportDraft.validated.failed.length===0,count),'downloaded tutorial file validates through real import UI: '+kind);
   const g=await page.locator('.r62-dialog').evaluate(el=>{const r=el.getBoundingClientRect(),button=document.getElementById('r62Commit').getBoundingClientRect();return{ratio:r.width/innerWidth,bottom:r.bottom,button:button.bottom,height:innerHeight}});
   check(g.ratio>.8&&g.ratio<.91&&g.bottom<=g.height+1&&g.button<=g.height,'import preview is wide and its commit action stays on screen: '+kind);
   await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
  }
  check(await page.evaluate(()=>EMPLOYEES.length===2&&!state.isDemo&&state.records.length===8&&state.leaves.length===1&&state.trips.length===1&&state.outings.length===1&&state.overtimeEntries.length===1&&state.imports.length===5),'all five tutorial downloads import as described into an empty Work session');
  check(await page.evaluate(()=>{const d=p109GuideDates().DATE,p=p109ImportPeriod(),base={姓名:'教程甲',日期:d,开始时间:'22:00',结束时间:'02:00'};let leaveRejected=false,outingRejected=false;try{p109ParseBusinessRow('leave',base,0,p)}catch(_){leaveRejected=true}try{p109ParseBusinessRow('outing',{姓名:'教程甲',开始日期:d,开始时间:'22:00',结束时间:'02:00'},0,p)}catch(_){outingRejected=true}return leaveRejected&&outingRejected&&p109ParseBusinessRow('overtime',base,0,p).end==='02:00'}),'documented cross-night differences agree with the actual leave/outing/overtime parsers');
  await page.evaluate(()=>r69NavigateData('storage'));await page.waitForSelector('.r82-storage-locations');
  check(await page.locator('#p109ProgramPath').isVisible(),'both path tools are available in data management storage');
  for(const section of ['overview','roster','records']){
   await page.locator('[data-data-section="'+section+'"]').click();check(await page.locator('.r81-project-location,#p109ProgramPath').count()===0,'path tools do not persist in unrelated data pages: '+section);
  }
  for(const mode of ['all','group','person','stats']){await page.locator('[data-workspace="'+mode+'"]').click();check(await page.locator('.r81-project-location,#p109ProgramPath').count()===0,'path tools do not occupy primary workspace: '+mode)}
  for(const [width,height] of [[1366,768],[1920,1080]]){
   await page.setViewportSize({width,height});
   for(const count of [0,1,20,50,150]){
    const geometry=await page.evaluate(count=>{
     EMPLOYEES=Array.from({length:count},(_,i)=>({id:'scroll-'+i,name:'滚动测试'+(i+1)}));state.groups=Object.fromEntries(EMPLOYEES.map((p,i)=>[p.id,i?'乙组':'甲组']));
     Object.assign(state,{workspaceMode:'all',analyticsPage:'main',selectedGroup:null,scopeSearch:'',attentionOnly:false,records:[],leaves:[],trips:[],outings:[],overtimeEntries:[],selection:{type:'overall'},manualStatuses:{}});reanalyze();render();
     const box=document.getElementById('matrixScroll');return{viewport:innerHeight,body:document.documentElement.scrollHeight,rows:count,people:EMPLOYEES.length,visible:scopeVisibleEmployees().length,attention:state.attentionOnly,query:state.scopeSearch,client:box.clientHeight,scroll:box.scrollHeight};
    },count);report.scroll.push({...geometry,width});
    check(geometry.body<=height+2,'no extra page scroll from empty path bars or fixed viewport heights: '+width+'/'+count);
    check(geometry.client>0,'matrix is visible while checking its scroll extent: '+width+'/'+count);
    if(count<=20)check(geometry.scroll<=geometry.client+1,'short matrix has no empty vertical scroll extent: '+width+'/'+count);
    else{check(geometry.scroll>geometry.client,'long matrix retains necessary scrolling: '+JSON.stringify(geometry));check(await page.evaluate(()=>{const box=document.getElementById('matrixScroll');box.scrollTop=box.scrollHeight;return box.scrollTop>0&&box.scrollTop+box.clientHeight>=box.scrollHeight-1}),'bottom of long matrix remains reachable');}
   }
  }
  await page.evaluate(()=>{EMPLOYEES=EMPLOYEES.slice(0,20);reanalyze();render()});await page.screenshot({path:path.join(out,'r82-matrix-20-no-scroll.png')});
  check(errors.length===0&&remote.length===0,'no script errors or remote requests');
  fs.writeFileSync(path.join(out,'r82-audit.json'),JSON.stringify(report,null,2));console.log('P109_R82_AUDIT_PASS',JSON.stringify(report));
 }finally{await context.close()}
};
