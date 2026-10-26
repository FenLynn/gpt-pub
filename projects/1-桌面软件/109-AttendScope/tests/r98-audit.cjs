'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 root=path.resolve(root);
 const report={checks:[],errors:[]},contexts=[],servers=[],check=(ok,label)=>{assert(ok,label);report.checks.push(label)},url=pathToFileURL(path.join(root,'index.html')).href;
 const legacy=async(noStorage=false)=>{
  const context=await browser.newContext({viewport:{width:1366,height:768},acceptDownloads:true});contexts.push(context);
  await context.addInitScript(noStorage=>{
   for(const key of ['structuredClone','showDirectoryPicker','DecompressionStream'])Object.defineProperty(window,key,{configurable:true,value:undefined});
   Object.defineProperty(crypto,'subtle',{configurable:true,value:undefined});
   Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined});
   delete Array.prototype.at;delete Object.hasOwn;
   if(noStorage){Object.defineProperty(window,'indexedDB',{configurable:true,value:undefined});Object.defineProperty(window,'localStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError')}})}
  },noStorage);
  return context;
 };
 const watch=page=>page.on('pageerror',e=>report.errors.push(e.message));
 const upload=async(page,content,name='边界测试.csv')=>{
  await page.locator('#attendanceInput').setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(content)});
  await page.waitForFunction(()=>r62ImportDraft?.validated?.rows.length>0);await page.locator('#r62Commit').click();await page.waitForFunction(()=>!r62ImportDraft&&!state.importCommitting);
 };
 const csv='姓名,打卡时间,进出\n纳入甲,2026-10-08 08:25:00,进\n纳入甲,2026-10-08 17:40:00,出\n忽略乙,2026-10-08 09:20:00,进\n忽略乙,2026-10-08 16:00:00,出';
 try{
  const context=await legacy(),page=await context.newPage();watch(page);page.on('dialog',d=>d.accept());
  await page.goto(url);await page.evaluate(()=>p109RecentReady);
  check(await page.locator('#r80Demo').isVisible(),'welcome appears without structuredClone, at, hasOwn, native hash or directory picker');
  check(await page.evaluate(()=>{
   const shared={value:3},original={map:new Map([['x',shared]]),set:new Set([shared]),date:new Date(1234),bytes:new Uint8Array([1,2])};original.self=original;
   const cloned=p109Clone(original);cloned.map.get('x').value=9;
   return cloned.self===cloned&&cloned.map instanceof Map&&cloned.set.has(cloned.map.get('x'))&&cloned.date.getTime()===1234&&cloned.bytes[1]===2&&shared.value===3;
  }),'compatibility clone retains maps, sets, cycles, dates, typed arrays and independent objects');
  check(await page.evaluate(async()=>await p109Hash(new TextEncoder().encode('abc'))==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),'compatibility SHA-256 matches known vector');
  await page.locator('#r80Work').click();check(!await page.locator('#r80NewProject').isVisible(),'unsupported directory actions are hidden');
  await page.locator('#r85NewPortable').click();await page.waitForFunction(()=>state.projectDir?.__p109Portable&&!p109ProjectBusy);
  await upload(page,csv);
  await page.evaluate(()=>{state.dataSection='roster';navigateWorkspace('data')});
  await page.locator('[data-roster-tab="ignored"]').click();
  const id=await page.evaluate(()=>EMPLOYEES.find(e=>e.name==='忽略乙').id);
  await page.locator('[data-r68-person="'+id+'"]').check();await page.locator('#r72FixSelected').click();
  check(await page.evaluate(id=>p109Ignored(id)&&state.records.length===4&&state.ignoredPeople.length===1,id),'roster tab ignores selected staff without removing punches');
  check(await page.locator('[data-ignored-view="'+id+'"]').count()===1,'ignored roster provides a direct view action');
  await page.screenshot({path:path.join(out,'r98-ignored-roster.png')});
  await page.locator('[data-ignored-view="'+id+'"]').click();
  check(await page.evaluate(id=>state.workspaceMode==='person'&&state.selection.employeeId===id&&state.analysis.has(id+'|8'),id),'ignored staff remain accessible in personal analysis');
  await page.evaluate(()=>navigateWorkspace('all'));
  check(await page.locator('.m-name').count()===1&&!await page.locator('.m-name[data-emp="'+id+'"]').count(),'home hides ignored staff');
  check(await page.evaluate(()=>traditionalRows().length===monthDays()&&workAnalyses().every(a=>!p109Ignored(a.employee.id))),'daily reports and overall work statistics exclude ignored staff');
  check(await page.evaluate(()=>{
   const labels=[],original=captureLabel;captureLabel=(g,label,...args)=>{labels.push(String(label));return original(g,label,...args)};
   try{captureMatrixCanvas();return labels.includes('纳入甲')&&!labels.includes('忽略乙')}finally{captureLabel=original}
  }),'matrix image/PDF source omits ignored staff using the same visible population');
  await page.evaluate(()=>{state.statsConfig={family:'punch',metric:'count',compare:'groups',aggregate:'total',limit:'all',sort:'desc'};navigateWorkspace('stats')});
  check(await page.evaluate(()=>asStatRows().grand===2&&asStatRows().people.length===1&&asStatRows().rows.reduce((n,r)=>n+r.peopleCount,0)===1),'statistics numerators and denominators exclude ignored staff');
  await page.locator('#asStatsIgnored').selectOption('include');
  check(await page.evaluate(()=>asStatRows().grand===4&&asStatRows().people.length===2&&asStatExportRows().every(r=>r.统计范围.includes('包含忽略人员'))),'explicit statistics option includes staff and exports the inclusion policy');
  await page.screenshot({path:path.join(out,'r98-statistics-include.png')});
  await page.locator('#asStatsIgnored').selectOption('exclude');
  let downloads=0;page.on('download',()=>downloads++);
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.storageBusy&&!!state.projectDir.cacheSavedAt);
  check(downloads===0&&await page.evaluate(()=>state.saved&&!state.projectDir.pending&&!p109UnsavedMonths().length),'save commits a complete project to browser cache without downloading');
  check((await page.locator('.toast').last().textContent()).includes('仅写入本机浏览器缓存，需下载项目包写入磁盘'),'save toast explicitly distinguishes cache from disk backup');
  const record=await page.evaluate(async()=>{const r=await p109CacheRead();return {bytes:r.bytes.byteLength,valid:await p109Hash(new Uint8Array(r.bytes))===r.sha256}});
  check(record.bytes>csv.length&&record.valid,'cache contains a verified complete archive including original files');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(id=>state.projectDir?.cacheSavedAt&&p109Ignored(id)&&state.records.length===4&&!state.statsIncludeIgnored,id),'reopen automatically restores project and ignored staff, with statistics exclusion default');
  check(await page.evaluate(async content=>{const parts=p109SourcePath(state.imports[0]),name=parts.pop();let h=state.projectDir;for(const n of parts)h=await existingDir(h,n);return (await (await h.getFileHandle(name)).getFile()).text().then(text=>text===content)},csv),'cache restoration preserves exact original CSV bytes');
  await page.evaluate(()=>{state.groups[EMPLOYEES[0].id]='缓存新组';state.saved=false});
  check(await page.evaluate(()=>saveWorking()),'second cache save succeeds');
  check(await page.evaluate(async()=>!!await p109CacheRead('previous')),'previous cache remains available');
  await page.evaluate(()=>switchMonth(2026,11,true));await upload(page,csv.replaceAll('2026-10-','2026-11-'),'十一月.csv');
  check(await page.evaluate(()=>saveWorking()),'all months are cached together');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(id=>{const ok=MONTH===11&&state.monthStores.size===2&&p109Ignored(id);switchMonth(2026,10);return ok&&state.records.length===4&&state.groups[EMPLOYEES[0].id]==='缓存新组'},id),'cache restore retains current month, other months, groups and ignored policy');
  const peer=await context.newPage();watch(peer);peer.on('dialog',d=>d.accept());await peer.goto(url);await peer.evaluate(()=>p109RecentReady);
  await page.evaluate(()=>{state.manualStatuses[EMPLOYEES[0].id+'|8']='normal';state.saved=false});check(await page.evaluate(()=>saveWorking()),'first page saves updated work');
  await peer.evaluate(()=>{state.groups[EMPLOYEES[0].id]='冲突修改';state.saved=false});
  check(await peer.evaluate(()=>saveWorking())===false&&await peer.evaluate(()=>!state.saved),'stale page cannot overwrite a newer cache');await peer.close();
  await page.evaluate(()=>{window.__cacheWrite=p109CacheWrite;p109CacheWrite=async()=>{throw new DOMException('quota','QuotaExceededError')};state.saved=false});
  const old=await page.evaluate(async()=> (await p109CacheRead()).sha256);
  check(await page.evaluate(()=>saveWorking())===false&&await page.evaluate(async hash=>!state.saved&&(await p109CacheRead()).sha256===hash,old),'quota failure preserves old cache and unsaved work');
  await page.evaluate(()=>{p109CacheWrite=__cacheWrite});check(await page.evaluate(()=>saveWorking()),'cache can retry after failure');
  const download=page.waitForEvent('download');await page.evaluate(()=>p109ExportPortable());const file=await download;
  check(/_\d{8}-\d{6}-\d{3}\.zip$/.test(file.suggestedFilename()),'downloaded ZIP includes local date, time, seconds and milliseconds');
  const filename=path.join(out,'r98-portable.zip');await file.saveAs(filename);await page.locator('#p109ConfirmDownload').click();await page.locator('#p109TransferClose').click();
  check(await page.evaluate(()=>p109DownloadStamp()!==p109DownloadStamp()),'two immediate downloads receive distinct timestamp identifiers');
  const other=await legacy(),p=await other.newPage();watch(p);p.on('dialog',d=>d.accept());await p.goto(url);await p.evaluate(()=>p109RecentReady);await p.locator('#r80Work').click();
  check(await p.evaluate(async bytes=>p109OpenPortableFile(new File([Uint8Array.from(bytes)],'imported.zip')),[...fs.readFileSync(filename)]),'complete ZIP opens without native clone or native hash');
  check(await p.evaluate(id=>p109Ignored(id)&&state.records.length===4&&P109_DATA_SCHEMA===7,id),'ZIP carries ignored population and current schema');
  await p.evaluate(()=>{state.dataSection='roster';navigateWorkspace('data')});await p.locator('[data-roster-tab="ignored"]').click();
  await p.locator('[data-r73-fixed-person="'+id+'"]').check();await p.locator('#r72UnfixSelected').click();
  check(await p.evaluate(id=>!p109Ignored(id)&&p109ActivePeople().length===2&&state.records.length===4,id),'restore to all staff re-includes person without changing original data');
  check(await p.evaluate(()=>{p109SetIgnored(EMPLOYEES.map(e=>e.id),true);return p109ActivePeople().length===0&&asStatRows().grand===0&&asStatRows().scheduled===0&&traditionalRows().length===0}),'ignoring every person produces zero totals and no synthetic denominator');
  check(await p.evaluate(id=>{p109SetIgnored([EMPLOYEES.find(e=>e.id!==id).id],false);switchMonth(2026,11,true);const kept=p109Ignored(id);switchMonth(2026,10);return kept&&p109Ignored(id)},id),'ignored roster carries across live months');
  const frozen=await p.evaluate(async()=>{
   await freezeSnapshot();let h=await monthDirectory();h=await existingDir(h,'snapshots');for(const item of await p109Entries(h)){const file=await existingDir(h,item.name),text=await readJSON(file,'snapshot.json');return {name:item.name,text:JSON.stringify(text)}}
  });
  check(await p.evaluate(async({id,frozen})=>{
   p109SetIgnored([id],false);await restoreWorkingFile(new File([frozen.text],'snapshot.json'));
   const kept=p109Ignored(id),profile=[...(state.projectProfile.ignoredPeople||[])];p109SetIgnored([id],false);
   const source=await readJSON(await existingDir(await existingDir(await monthDirectory(),'snapshots'),frozen.name),'snapshot.json');
   return kept&&JSON.stringify(source)===frozen.text&&JSON.stringify(state.projectProfile.ignoredPeople||[])===JSON.stringify(profile);
  },{id,frozen}),'frozen roster survives later defaults and editing its revision never rewrites snapshot or project defaults');
  const server=http.createServer((req,res)=>{
   const target=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
   if(!target.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
   try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(target)]||'application/octet-stream');res.end(fs.readFileSync(target))}catch(_){res.writeHead(404);res.end()}
  });servers.push(server);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(49152+Math.floor(Math.random()*12000),'127.0.0.1',resolve)});
  await p.goto('http://127.0.0.1:'+server.address().port+'/index.html');await p.evaluate(()=>p109RecentReady);await p.locator('#r80Demo').click();
  check(await p.evaluate(async()=>{
   const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle('r98-native-'+p109UniqueId(),{create:true});window.__r98Disk=dir;return p109InitializeProject(dir);
  }),'native project remains available through the shared filesystem adapter');
  await upload(p,csv,'native.csv');
  check(await p.evaluate(async id=>{p109SetIgnored([id],true);if(!await saveWorking())return false;const payload=await readJSON(await existingDir(await monthDirectory(),'working'),'state.json'),profile=await readJSON(await existingDir(state.projectDir,'config'),'project-profile.json');return payload.ignoredPeople.includes(id)&&profile.ignoredPeople.includes(id)&&payload.schemaVersion===7},id),'native save persists ignored roster into working and project defaults');
  check(await p.evaluate(async id=>{p109BlankWork();return await connectProjectDir(__r98Disk)&&p109Ignored(id)&&p109ActivePeople().length===1},id),'native project reopen retains the same default population');
  await page.evaluate(async()=>{const db=await p109CacheOpen();await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),s=tx.objectStore('snapshots'),r=s.get('current');r.onsuccess=()=>s.put({...r.result,bytes:new ArrayBuffer(4)},'current');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)});db.close()});
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>state.projectDir?.pending&&!state.saved&&state.records.length===4),'corrupt latest cache recovers previous version and requires saving');
  check(await page.evaluate(()=>saveWorking()),'recovered cache can be saved over corrupt current while retaining previous valid copy');
  const blocked=await legacy(true),b=await blocked.newPage();watch(b);b.on('dialog',d=>d.accept());await b.goto(url);await b.evaluate(()=>p109RecentReady);
  await b.locator('#r80Work').click();await b.locator('#r85NewPortable').click();await b.waitForFunction(()=>state.projectDir?.__p109Portable&&!p109ProjectBusy);await upload(b,csv);
  check(await b.evaluate(()=>saveWorking())===false&&await b.evaluate(()=>!state.saved&&p109UnsavedMonths().length>0),'blocked browser storage never claims successful cache save');
  const fallback=b.waitForEvent('download');check(await b.evaluate(()=>p109ExportPortable()),'download remains usable when all browser storage is blocked');await (await fallback).saveAs(path.join(out,'r98-blocked-storage.zip'));
  check(!report.errors.length,'all scenarios have zero runtime errors');
  fs.writeFileSync(path.join(out,'r98-audit.json'),JSON.stringify(report,null,2));console.log('P109_R98_AUDIT_PASS '+JSON.stringify({checks:report.checks.length}));
 }catch(e){fs.writeFileSync(path.join(out,'r98-failure.json'),JSON.stringify({error:e.stack,...report},null,2));throw e}
 finally{for(const context of contexts)await context.close();for(const server of servers)await new Promise(resolve=>server.close(resolve))}
};
