/* R80 acceptance uses real browser OPFS, IndexedDB and file streams. The
 * directory picker is supplied a test handle; native OS picker UI is untested. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
module.exports=async({browser,out,root})=>{
 root=path.resolve(root);const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
 const report={revision:'R80',nativeOpfsVerified:true,nativePickerVerified:false,checks:[]},errors=[];
 const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
  try{res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}catch(_){res.writeHead(404);res.end()}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const check=(ok,label)=>{assert(ok,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='prompt'?d.accept('R80 测试项目'):d.accept());
 const csv=(name,text)=>({name,mimeType:'text/csv',buffer:Buffer.from(text)});
 const upload=async(kind,files)=>{await page.locator('#'+kind+'Input').setInputFiles(files);await page.waitForSelector('#r62Commit')};
 const commit=async()=>{await page.locator('#r62Commit').click();await page.waitForFunction(()=>!state.importCommitting)};
 const done=()=>page.waitForFunction(()=>!r62ImportDraft&&!r63ReadingImport);
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Demo').isVisible()&&await page.locator('#r80Work').isVisible(),'fresh entry offers explicit Demo and Work modes');
  await page.screenshot({path:path.join(out,'r80-mode-entry.png')});await page.locator('#r80Demo').click();
  check(await page.evaluate(()=>state.isDemo&&EMPLOYEES.length===50&&p109ReadMode()==='demo'),'Demo loads explicit sample data');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Demo').isVisible(),'without a default Work project, remembered Demo still offers the mode choice on reload');
  await page.locator('#r80Work').click();await page.waitForSelector('#r80NewProject');
  check(await page.evaluate(()=>EMPLOYEES.length===0&&!state.isDemo&&state.records.length===0),'Work starts empty without carrying sample staff or data');
  await page.evaluate(async()=>{
   const home=await navigator.storage.getDirectory();window.__r80Root=await home.getDirectoryHandle('R80 空白项目 '+crypto.randomUUID(),{create:true});
   window.showDirectoryPicker=async()=>__r80Root;
  });
  await page.locator('#r80NewProject').click();await page.waitForFunction(()=>!!state.projectDir&&!p109ProjectBusy);
  check(await page.evaluate(()=>state.saved&&!document.querySelector('#p109ModeOverlay')&&document.getElementById('p109CurrentProject').textContent.includes(state.projectDir.name)),
   'new Work project is saved separately and its directory name appears in the header');
  await page.locator('#p109CurrentProject').click();await page.waitForSelector('.r80-directory-list');
  check((await page.locator('#r80FileBody').textContent()).includes('project.json'),'header project link opens actual authorized directory contents');
  await page.locator('#r80FilesClose').click();
  const trip1=csv('出差1.csv','姓名,开始日期,地点\n测试甲,2026-10-08,地点甲\n'),
   trip2={name:'出差2.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await page.evaluate(async()=>[...new Uint8Array(await P109_TABLES.writeXlsx([
    {姓名:'测试乙',开始日期:'2026-10-10',地点:'地点乙'},{姓名:'测试甲',开始日期:'2026-10-08',地点:'地点甲'}],'出差原件').arrayBuffer())]))};
  await upload('trip',[trip1,trip2]);
  check(await page.evaluate(()=>r62ImportDraft.mapping.endDate===-1&&r62ImportDraft.validated.rows.length===1&&
   document.querySelector('[data-map="place"] option[value="-1"]').textContent==='无'&&r62ImportDraft.importMode==='merge'),
   'optional mappings offer None and default import mode is additive merge');
  await commit();await page.waitForFunction(()=>r62ImportDraft?.file.name==='出差2.xlsx'&&!r63ReadingImport);
  check(await page.evaluate(()=>state.trips.length===1&&state.imports.length===1),'first queued file commits independently before the next review');
  await commit();await done();
  check(await page.evaluate(()=>state.trips.length===2&&state.imports.length===2&&state.trips.find(r=>r.name==='测试甲').sources.length===2&&state.imports[1].mergedCount===1),
   'second trip file retains earlier data, folds overlaps and records both source rows');
  const original=await page.evaluate(()=>state.imports[0].id);
  await page.evaluate(()=>{navigateWorkspace('data');state.dataSection='records';render()});
  check(await page.locator('.r80-source-row').count()===2&&!await page.locator('#rawDataTable').count(),'data management shows imported originals clearly by default');
  check(await page.locator('#calendar').count()===0,'original file inventory has no ineffective day filter');
  await page.locator('[data-r80-record-view="rows"]').click();await page.waitForSelector('#rawDataTable.tabulator');
  await page.locator('[data-raw-tab="trip"]').click();await page.locator('[data-p109-sources]').first().click();
  check(await page.locator('#r80FileBody [data-p109-source]').count()===2&&(await page.locator('#r80FileBody').textContent()).includes('出差2.xlsx'),
   'combined row exposes every contributing source in a usable source list');
  await page.locator('#r80FilesClose').click();await page.locator('[data-r80-record-view="files"]').click();
  await page.locator('[data-p109-source="'+original+'"]').first().click();await page.waitForSelector('.r80-original-grid');
  check((await page.locator('.r80-original-grid').textContent()).includes('地点甲'),'original preview reads actual saved CSV bytes');
  const downloadPromise=page.waitForEvent('download');await page.locator('#r80DownloadOriginal').click();const download=await downloadPromise;
  const downloadPath=await download.path();check(fs.readFileSync(downloadPath).equals(trip1.buffer),'original download preserves the exact imported bytes');
  await page.keyboard.press('Escape');check(!await page.locator('#p109FilesOverlay').count(),'Escape closes only the file browser');
  await page.locator('.r80-source-row').first().getByText('文件夹',{exact:true}).click();await page.waitForSelector('.r80-directory-list');
  check((await page.locator('#r80FileBody').textContent()).includes('出差1.csv'),'source folder button opens its actual original directory');
  await page.locator('#r80FilesClose').click();
  await page.locator('.r80-source-row').nth(1).locator('[data-p109-source]').first().click();await page.waitForSelector('.r80-original-grid');
  check((await page.locator('.r80-original-grid').textContent()).includes('地点乙'),'original XLSX preview parses saved workbook cells');
  await page.locator('#r80FilesClose').click();
  await upload('attendance',csv('无进出.csv','姓名,打卡时间,备注\n测试甲,2026-10-08 08:25:00,未提供方向\n测试甲,2026-10-08 17:15:00,未提供方向\n'));
  await page.locator('[data-map="direction"]').selectOption('-1');
  check(await page.evaluate(()=>r62ImportDraft.validated.rows.length===2&&!document.querySelector('#r62Commit').disabled),'name and timestamp can import without direction');
  await commit();await done();
  check(await page.evaluate(()=>{
   const e=EMPLOYEES.find(e=>e.name==='测试甲'),a=state.analysis.get(e.id+'|8');
   return state.records.every(r=>r.direction==='未标注')&&a.issues.some(x=>x.includes('进出方向'))&&a.pairs.length===0&&activeAutoOvertimeSegments(a).length===0&&
    r19PunchClusters(a,{start:0,end:1440},800).every(x=>x.direction==='未标注');
  }),'unspecified direction remains neutral, visible and unpaired with no invented overtime');
  await upload('attendance',csv('无方向往返.csv','姓名,打卡时间,进出\n测试甲,2026-10-08 08:25:00,未标注\n'));
  check(await page.evaluate(()=>r62ImportDraft.validated.rows.length===1),'exported unknown-direction value can be imported again without inventing direction');
  await page.locator('#r62Cancel').click();
  for(const [kind,text] of [
   ['leave','姓名,日期,开始时间,结束时间\n测试甲,2026-10-12,无效时间,17:10\n'],
   ['trip','姓名,开始日期,结束日期\n测试甲,2026-10-12,无效日期\n'],
   ['overtime','姓名,日期,开始时间\n测试甲,2026-10-12,18:00\n']]){
   await upload(kind,csv('错误字段.csv',text));
   check(await page.locator('#r62Commit').isDisabled(),'invalid or missing required time/date stays blocked: '+kind);
   await page.locator('#r62Cancel').click();
  }
  await upload('attendance',csv('补充打卡.csv','姓名,打卡时间,进出\n测试乙,2026-10-09 08:25:00,进\n测试乙,2026-10-09 08:25:00,进\n测试乙,2026-10-09 17:15:00,出\n'));
  await commit();await done();
  check(await page.evaluate(()=>state.records.length===5&&state.records.filter(r=>r.direction==='进').length===2),'merge preserves real repeated punches within a file');
  await upload('attendance',csv('重叠打卡.csv','姓名,打卡时间,进出\n测试乙,2026-10-09 08:25:00,进\n测试乙,2026-10-09 17:15:00,出\n'));
  await commit();await done();
  check(await page.evaluate(()=>state.records.length===5&&state.imports.at(-1).mergedCount===2),'cross-file overlaps do not increase punch multiplicity');
  check(await page.evaluate(()=>{
   const before=state.records,e=EMPLOYEES[0];
   state.records=[['18:00','进'],['19:00','未标注'],['20:00','出']].map(([time,direction],i)=>({employeeId:e.id,name:e.name,recordId:'unknown-gap-'+i,datetime:'2026-10-12 '+time,time,direction}));
   reanalyze();const visits=attendanceVisitEvents(e.id);state.records=before;reanalyze();return visits.length===0;
  }),'a known pair cannot bridge an intervening unknown event and fabricate time on site');
  for(const kind of ['leave','outing','overtime']){
   const head=kind==='outing'?'姓名,开始日期,开始时间,结束时间':'姓名,日期,开始时间,结束时间';
   const times=kind==='overtime'?'18:00,20:00':'09:00,10:00';
   await upload(kind,[csv(kind+'1.csv',head+'\n测试甲,2026-10-12,'+times+'\n'),csv(kind+'2.csv',head+'\n测试乙,2026-10-13,'+times+'\n')]);
   await commit();await page.waitForFunction(name=>r62ImportDraft?.file.name===name&&!r63ReadingImport,kind+'2.csv');await commit();await done();
  }
  check(await page.evaluate(()=>state.leaves.length===2&&state.outings.length===2&&state.overtimeEntries.length===2&&state.trips.length===2),
   'all five business types support additive multi-file imports');
  await upload('trip',[trip1,csv('取消后续.csv','姓名,开始日期\n测试丙,2026-10-14\n')]);
  await page.locator('#r80SkipFile').click();await page.waitForFunction(()=>r62ImportDraft?.file.name==='取消后续.csv'&&!r63ReadingImport);
  await page.locator('#r62Cancel').click();
  check(await page.evaluate(()=>state.trips.length===2&&r80ImportQueue===null&&!EMPLOYEES.some(e=>e.name==='测试丙')),'skipping and cancelling queued files preserves all earlier imports');
  // Scroll and selection are checked against actual visible controls after rerenders.
  await page.evaluate(()=>{
   for(let i=0;i<65;i++){const name='名单测试'+String(i).padStart(2,'0'),id=personIdentity(name);EMPLOYEES.push({id,name,department:'未分类'});state.groups[id]='未分组'}
   state.groupCatalog=['甲组','乙组'];state.dataSection='roster';reanalyze();render();
  });
  await page.locator('#r68BulkGroup').selectOption('甲组');
  const pick=async(name)=>{await page.locator('#r68RosterSearch').fill(name);await page.locator('[data-r68-person]').first().check()};
  await pick('名单测试20');await pick('名单测试30');
  check(await page.evaluate(()=>r68UI.chosen.size===2&&document.querySelector('#r68BulkGroup').value==='甲组'),'multi-select survives searches and keeps the target group');
  await page.locator('#r68RosterSearch').fill('');await page.locator('#r73MonthList').evaluate(el=>el.scrollTop=650);
  const before=await page.locator('#r73MonthList').evaluate(el=>el.scrollTop);await page.locator('#r68ApplyGroup').click();
  check(await page.evaluate(top=>document.querySelector('#r73MonthList').scrollTop===top&&r68UI.chosen.size===0&&
   document.querySelector('#r68BulkGroup').value==='甲组'&&groupOf(EMPLOYEES.find(e=>e.name==='名单测试20'))==='甲组'&&groupOf(EMPLOYEES.find(e=>e.name==='名单测试30'))==='甲组',before),
   'batch assignment preserves list scroll, clears the finished selection and retains target group');
  await pick('名单测试40');await page.locator('#r68ApplyGroup').click();
  check(await page.evaluate(()=>groupOf(EMPLOYEES.find(e=>e.name==='名单测试40'))==='甲组'),'another batch can immediately join the same group');
  await page.locator('#r68RosterSearch').fill('');await page.screenshot({path:path.join(out,'r80-roster.png')});
  check(await page.evaluate(()=>saveWorking()),'merged data and roster save successfully');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>!!state.projectDir&&state.records.length===5&&state.trips.length===2&&state.leaves.length===2&&state.imports.length===11&&
   state.trips.find(x=>x.name==='测试甲').sources.length===2),'Work reload automatically restores merged data and full provenance');
  await page.evaluate(()=>{navigateWorkspace('data');state.dataSection='records';render()});await page.screenshot({path:path.join(out,'r80-original-files.png')});
  await page.locator('[data-p109-source="'+original+'"]').first().click();await page.waitForSelector('.r80-original-grid');
  check((await page.locator('.r80-original-grid').textContent()).includes('地点甲'),'saved originals remain browsable after closing and reopening the page');
  await page.screenshot({path:path.join(out,'r80-original-preview.png')});await page.locator('#r80FilesClose').click();
  await page.evaluate(()=>r69NavigateData('storage'));
  await page.locator('.r80-tree-file').filter({hasText:'project.json'}).first().click();await page.waitForSelector('.r80-text-preview');
  check((await page.locator('.r80-text-preview').textContent()).includes('P109-AttendScope'),'actual file tree links open actual JSON as inert text');
  await page.locator('#r80FilesClose').click();await page.locator('#importBtn').click();
  check(await page.locator('.import-menu-row').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=14),'import menu labels are readable at 14px or larger');
  await page.screenshot({path:path.join(out,'r80-import-menu.png')});
  await page.keyboard.press('Escape');
  await page.evaluate(()=>switchMonth(2026,11,true));
  await upload('trip',csv('出差初始.csv','姓名,开始日期\n替换测试甲,2026-11-08\n'));await commit();await done();
  const initial=await page.evaluate(()=>JSON.stringify({trips:state.trips,imports:state.imports}));
  await upload('trip',csv('出差替换.csv','姓名,开始日期\n替换测试乙,2026-11-09\n'));
  await page.locator('#r79Advanced').evaluate(el=>el.open=true);await page.locator('#r80ImportMode').selectOption('replace');
  const reject=d=>d.dismiss();page.removeAllListeners('dialog');page.on('dialog',reject);await commit();
  check(await page.evaluate(()=>JSON.stringify({trips:state.trips,imports:state.imports}))===initial,'cancelled replacement retains existing data and original history');
  page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());await commit();await done();
  check(await page.evaluate(()=>state.trips.length===1&&state.trips[0].name==='替换测试乙'&&state.imports.length===2),'explicit replacement changes only the selected month/type and retains prior originals');
  const blocked=await context.newPage();
  try{
   await blocked.addInitScript(()=>{
    for(const key of ['localStorage','indexedDB'])Object.defineProperty(window,key,{configurable:true,get(){throw new DOMException('Test browser storage unavailable','SecurityError')}});
   });
   await blocked.goto(page.url());await blocked.evaluate(()=>p109RecentReady);await blocked.locator('#r80Work').click();
   await blocked.waitForSelector('#r80NewProject');
   check(await blocked.evaluate(()=>p109ReadMode()==='work'&&!state.isDemo&&EMPLOYEES.length===0),'unavailable browser storage still allows a working empty session without a mode loop');
  }finally{await blocked.close()}
  check(errors.length===0,'no browser script exceptions');
  fs.writeFileSync(path.join(out,'r80-audit.json'),JSON.stringify(report,null,2));console.log('P109_R80_AUDIT_PASS',JSON.stringify(report));
 }finally{await context.close();await new Promise(resolve=>server.close(resolve))}
};
