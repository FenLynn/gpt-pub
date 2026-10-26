/* Native browser OPFS handles exercise IndexedDB serialization and real streams.
 * This does not claim to test the OS picker or external-directory permission UI. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),cp=require('child_process'),assert=require('assert/strict');
module.exports=async({browser,out,root})=>{
 root=path.resolve(root);
 const currentVersion=/const P109_APP_VERSION='([^']+)'/.exec(fs.readFileSync(path.join(root,'src/app/00-state.js'),'utf8'))[1];
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 // Baseline audits explicitly select Demo; R80 separately tests the first-use entry.
 await page.addInitScript(()=>{if(!localStorage.getItem('p109-session-mode'))localStorage.setItem('p109-session-mode','demo')});
 const report={revision:'R79',nativeOpfsVerified:true,nativePickerVerified:false,historyHarness:'local HTTP (OPFS disallowed on file origins); file runtime separately covered by full smoke',checks:[]},errors=[];
 const server=http.createServer((req,res)=>{
  const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(target!==root&&!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
  try{res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}
  catch(_){res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const check=(value,label)=>{assert(value,label);report.checks.push(label)};
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.type()==='prompt'?d.accept('项目甲'):d.accept());
 const attendance='姓名,打卡时间,进出\n测试甲,2026-10-08 08:25:00,进\n测试甲,2026-10-08 11:45:00,出\n测试甲,2026-10-08 13:25:00,进\n测试甲,2026-10-08 17:15:00,出\n';
 const upload=async(content=attendance)=>{
  await page.locator('#attendanceInput').setInputFiles({name:'测试考勤.xlsx.csv',mimeType:'text/csv',buffer:Buffer.from(content)});
  await page.waitForSelector('#r62Commit');
 };
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.evaluate(()=>p109RecentReady);
  await page.locator('#r80Demo').click();
  check(await page.evaluate(async()=>{
   const root=await navigator.storage.getDirectory(),parent=await root.getDirectoryHandle('r79-'+crypto.randomUUID(),{create:true});
   const a=await parent.getDirectoryHandle('A',{create:true}),b=await parent.getDirectoryHandle('B',{create:true});
   window.__r79A=await a.getDirectoryHandle('同名项目',{create:true});window.__r79B=await b.getDirectoryHandle('同名项目',{create:true});
   return await p109InitializeProject(window.__r79A);
  }),'initialize independent project using real browser directory/file streams');
  check(await page.evaluate(()=>EMPLOYEES.length===0&&!state.isDemo&&state.saved),'new project contains zero demo employees');
  await page.evaluate(()=>switchMonth(2026,9,true));await upload();
  check(await page.evaluate(()=>MONTH===9&&r62ImportDraft.validated.rows.length===0&&
   document.querySelector('#r62Commit').disabled&&document.querySelector('#r79ImportErrors').textContent.includes('2026-09')&&
   document.querySelector('#r79UseFileMonth').dataset.month==='2026-10'),'September target rejects October rows before confirmation and offers file month');
  await page.screenshot({path:path.join(out,'r79-import-month-mismatch.png')});
  await page.locator('#r79UseFileMonth').click();
  check(await page.evaluate(()=>MONTH===9&&r62ImportDraft.targetMonth==='2026-10'&&r62ImportDraft.validated.rows.length===4),
   'choosing target month validates without changing the live month');
  await page.locator('#r62Cancel').click();
  check(await page.evaluate(()=>MONTH===9&&state.records.length===0&&state.imports.length===0),'cancel leaves live month and records intact');
  await upload();await page.locator('#r79UseFileMonth').click();
  await page.locator('#r79ImportMonth').focus();await page.keyboard.press('Shift+Tab');
  check(await page.evaluate(()=>document.activeElement.id==='r62Commit'),'Shift+Tab stays inside import dialog');
  await page.keyboard.press('Tab');
  check(await page.evaluate(()=>document.activeElement.id==='r79ImportMonth'),'Tab wraps to first import dialog control');
  await page.screenshot({path:path.join(out,'r79-import-ready.png')});
  await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
  check(await page.evaluate(async()=>{
   const month=await (await (await state.projectDir.getDirectoryHandle('data')).getDirectoryHandle('2026')).getDirectoryHandle('10'),
    raw=await (await month.getDirectoryHandle('raw')).getDirectoryHandle('attendance'),folder=await raw.getDirectoryHandle(state.imports[0].id);
   return MONTH===10&&state.records.length===4&&EMPLOYEES.length===1&&
    (await (await folder.getFileHandle('测试考勤.xlsx.csv')).getFile()).size>0;
  }),'actual target-month commit persists original bytes and roster');
  check(await page.evaluate(()=>saveWorking()),'save imported project');
  const firstId=await page.evaluate(()=>p109RecentState.lastId);
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>!!state.projectDir&&state.records.length===4&&EMPLOYEES[0].name==='测试甲'&&MONTH===10),
   'reload automatically restores last project from IndexedDB native handle');
  check(await page.evaluate(async()=>{
   const root=await navigator.storage.getDirectory();
   // Retrieve the test sibling through its stored native parent relationship.
   for await(const [name,parent] of root.entries())if(name.startsWith('r79-')){
    const b=await parent.getDirectoryHandle('B');window.__r79B=await b.getDirectoryHandle('同名项目');
    return await p109InitializeProject(window.__r79B);
   }
   return false;
  }),'initialize second independent project');
  check(await page.evaluate(()=>p109RecentState.items.length===2&&EMPLOYEES.length===0&&state.records.length===0),
   'different directories with same basename remain distinct and isolated');
  check(await page.evaluate(id=>p109OpenRecentProject(id),firstId),'switch via remembered native directory without picker');
  check(await page.evaluate(()=>state.records.length===4&&EMPLOYEES[0].name==='测试甲'&&p109RecentState.items.length===2),
   'reopening same native directory deduplicates history and restores its own data');
  await page.evaluate(()=>p109ShowRecentProjects());await page.screenshot({path:path.join(out,'r79-project-history.png')});
  await page.locator('[data-recent-rename="'+firstId+'"]').click();
  check(await page.evaluate(async id=>(await p109RecentRead()).items.find(x=>x.id===id).label==='项目甲',firstId),'history display-name change is persisted without renaming directory');
  const secondId=await page.evaluate(id=>p109RecentState.items.find(x=>x.id!==id).id,firstId);
  await page.locator('[data-recent-remove="'+secondId+'"]').click();
  await page.waitForFunction(()=>p109RecentState.items.length===1);
  check(await page.evaluate(async()=>p109RecentState.items.length===1&&!!(await __r79B.getFileHandle('project.json'))),
   'removing history entry leaves actual project files intact');
  await page.locator('#p109RecentClose').click();
  await page.addInitScript(()=>{
   const query=FileSystemHandle.prototype.queryPermission,request=FileSystemHandle.prototype.requestPermission;
   FileSystemHandle.prototype.queryPermission=function(options){return sessionStorage.getItem('r79-prompt')==='1'?Promise.resolve('prompt'):query.call(this,options)};
   FileSystemHandle.prototype.requestPermission=function(options){
    if(sessionStorage.getItem('r79-prompt')==='1'){sessionStorage.removeItem('r79-prompt');window.__r79RequestCount=(window.__r79RequestCount||0)+1;return Promise.resolve('granted')}
    return request.call(this,options);
   };
  });
  await page.evaluate(()=>sessionStorage.setItem('r79-prompt','1'));await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>!state.projectDir&&!!document.getElementById('p109RecentOverlay')&&!window.__r79RequestCount),
   'startup with prompt permission retains remembered project and never requests without a user gesture');
  await page.locator('[data-recent-open="'+firstId+'"]').click();await page.waitForFunction(()=>!!state.projectDir&&!document.getElementById('p109RecentOverlay'));
  check(await page.evaluate(()=>state.records.length===4&&window.__r79RequestCount===1),'one explicit click requests access and resumes stored project');
  // External permission loss is simulated; directory data remains native OPFS.
  await page.evaluate(()=>{
   window.__r79Root=state.projectDir;window.__r79Permission='denied';
   const root=state.projectDir;
   state.projectDir={kind:'directory',name:root.name,queryPermission:async()=>window.__r79Permission,
    requestPermission:async()=>window.__r79Permission,getDirectoryHandle:root.getDirectoryHandle.bind(root),
    getFileHandle:root.getFileHandle.bind(root),entries:root.entries.bind(root)};
  });
  await upload(attendance.replace('17:15:00','17:20:00'));await page.locator('#r62Commit').click();
  await page.waitForFunction(()=>!state.importCommitting&&!!r62ImportDraft.error);
  check(await page.evaluate(()=>state.records.length===4&&state.imports.length===1&&
   document.querySelector('#r62Validation').textContent.includes('写入权限')&&!document.querySelector('#r62Commit').disabled),
   'permission failure leaves inline error and unchanged data; retry stays available');
  await page.evaluate(()=>{window.__r79Permission='granted';state.projectDir=window.__r79Root});
  await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
  check(await page.evaluate(()=>state.records.length===5&&state.imports.length===2),'retry after permission restoration merges exactly once');
  const parser=await page.evaluate(()=>{
   const dt=(Date.UTC(2026,9,27,19)-Date.UTC(1899,11,30))/86400000;
   const grid={kind:'attendance',rows:[{rowNumber:1,cells:['姓名','日期','时间','进出']},
    {rowNumber:2,cells:['数值日期测试',Math.floor(dt),19/24,'进']}]};
   const mapping=r62InferColumns(grid,true);
   return {serial:excelSerialToDateTime(dt),mapping};
  });
  check(parser.serial==='2026-10-27 19:00:00'&&parser.mapping.datetime===-1&&parser.mapping.date===1&&parser.mapping.time===2,
   'Excel serial seconds and explicit split-date/time inference preserve exact time');
  check(await page.evaluate(async()=>{
   const value=(Date.UTC(2026,9,27,19)-Date.UTC(1899,11,30))/86400000,
    items=await p109ZipRead(new File([P109_TABLES.writeXlsx([{姓名:'命名空间测试',打卡时间:value,进出:'进'}])],'source.xlsx'));
   for(const item of items)if(item.name.endsWith('.xml')||item.name.endsWith('.rels')){
    item.data=new TextEncoder().encode(new TextDecoder().decode(item.data).replace('xmlns=','xmlns:x=').replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s>/])/g,'<$1x:$2'));
   }
   await r62OpenImport(new File([P109_TABLES.writeArchive(items)],'带命名空间前缀.xlsx'),'attendance');
   const ok=r62ImportDraft.validated.rows.length===1&&r62ImportDraft.validated.rows[0]['打卡时间']==='2026-10-27 19:00:00';
   document.getElementById('r62Cancel').click();return ok;
  }),'prefixed workbook, relationships and worksheet XML import with exact numeric timestamp');
  check(await page.evaluate(()=>{
   const e=EMPLOYEES[0],rows=[['2026-10-14','08:25','进'],['2026-10-14','11:45','出'],['2026-10-14','13:25','进'],
    ['2026-10-15','08:25','进'],['2026-10-15','11:45','出'],['2026-10-15','13:25','进'],['2026-10-15','17:15','出']];
   state.records=rows.map(([date,time,direction],i)=>({recordId:'missing-'+i,employeeId:e.id,name:e.name,datetime:date+' '+time,time,direction}));
   state.leaves=[];state.trips=[];state.outings=[];state.overtimeEntries=[];state.monthStores.clear();reanalyze();
   const a=state.analysis.get(e.id+'|14');return a.severity==='suspect'&&activeAutoOvertimeSegments(a).length===0&&!a.attendanceFlags.length;
  }),'missing evening exit followed by next-day entry cannot create fabricated overnight overtime or definite early departure');
  await page.setViewportSize({width:960,height:720});await upload();
  check(await page.evaluate(()=>{
   const box=document.querySelector('.r62-dialog').getBoundingClientRect(),footer=document.querySelector('.r62-dialog>footer').getBoundingClientRect();
   return box.top>=0&&box.bottom<=innerHeight&&footer.bottom<=innerHeight&&!document.getElementById('r79Advanced').open;
  }),'compact import keeps primary action visible with advanced options collapsed');
  await page.screenshot({path:path.join(out,'r79-import-960.png')});await page.locator('#r62Cancel').click();
  const zip=path.join(out,'r79-separated-update.zip'),pack=cp.spawnSync(process.env.P109_PYTHON||'python3',[path.join(root,'tools/package-release.py'),root,zip],{encoding:'utf8'});
  if(pack.status!==0)throw Error('Cannot build update fixture: '+pack.stderr);
  check(await page.evaluate(()=>saveWorking()),'save all edited work before updating code');
  check(await page.evaluate(async({bytes,currentVersion})=>{
   const original=JSON.stringify(workingPayload()),workingFile=await (await (await (await state.projectDir.getDirectoryHandle('data')).getDirectoryHandle('2026')).getDirectoryHandle('10')).getDirectoryHandle('working'),
    diskBefore=await (await workingFile.getFileHandle('state.json')).getFile().then(f=>f.text()),
    runtime=await (await navigator.storage.getDirectory()).getDirectoryHandle('runtime-'+crypto.randomUUID(),{create:true}),
    app=await (await runtime.getDirectoryHandle('src',{create:true})).getDirectoryHandle('app',{create:true});
   await writeFile(runtime,'index.html','<!doctype html><title>P109 test runtime</title>');
   await writeFile(app,'00-state.js',"const P109_APP_VERSION='0.2.4-preview';");await writeFile(app,'43-project-control.js','// P109 fixture');
   const ok=await p109ApplyCodeUpdate(new File([Uint8Array.from(bytes)],'update.zip'),{programRoot:runtime});
   const stateNow=await (await workingFile.getFileHandle('state.json')).getFile().then(f=>f.text()),
    newVersion=await (await app.getFileHandle('00-state.js')).getFile().then(f=>f.text());
   let codeInData=false;try{await state.projectDir.getFileHandle('index.html');codeInData=true}catch(e){if(e.name!=='NotFoundError')throw e}
   const backups=await state.projectDir.getDirectoryHandle('backups');let backupOk=false;
   for await(const [name,h] of backups.entries())if(name.startsWith('pre-upgrade-')){
    const files=await p109ZipRead(await h.getFile());backupOk=files.some(f=>f.name==='program/index.html')&&files.some(f=>f.name==='data/2026/10/working/state.json');
   }
   return ok&&newVersion.includes("const P109_APP_VERSION='"+currentVersion+"';")&&!codeInData&&stateNow===diskBefore&&backupOk&&original.length>0;
  },{bytes:[...fs.readFileSync(zip)],currentVersion}),'separate program-folder update changes only code, preserves data bytes and backs up both roots');
  check(!errors.length,'no browser runtime exceptions');
  fs.writeFileSync(path.join(out,'r79-audit.json'),JSON.stringify(report,null,2));
  console.log('P109_R79_AUDIT_PASS '+JSON.stringify(report));
 }finally{await context.close();await new Promise(resolve=>server.close(resolve))}
};
