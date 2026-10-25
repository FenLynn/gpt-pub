/* R64 independent lifecycle audit: ZIP -> file:// -> import -> save -> freeze -> edit -> reload -> relocate.
 * Uses a Node-backed File System Access shim only because CI cannot automate a native OS directory picker.
 * Its passed checks must NOT be reported as a Windows native picker/permissions test. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const {pathToFileURL}=require('url');
module.exports=async function runLifecycleAudit({browser,out,root}){
 const versionSource=fs.readFileSync(path.join(root,'src/app/00-state.js'),'utf8'),
  currentVersion=/const P109_APP_VERSION='([^']+)'/.exec(versionSource)[1],
  currentRevision=/const P109_APP_REVISION='([^']+)'/.exec(versionSource)[1];
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'p109-lifecycle-'));
 const staging=path.join(tmp,'staging','考勤'),unzipped=path.join(tmp,'fresh');
 fs.mkdirSync(staging,{recursive:true});fs.mkdirSync(unzipped,{recursive:true});
 // Reproduce a realistic self-contained offline folder instead of assuming the whole git repository is a release.
 for(const name of ['index.html','src','config','data','project.json','README.md'])
  fs.cpSync(path.join(root,name),path.join(staging,name),{recursive:true});
 const archive=path.join(out,'p109-audit-standalone.zip');
 const zipScript="import pathlib,sys,zipfile\nsrc=pathlib.Path(sys.argv[1]);dest=pathlib.Path(sys.argv[2]);\nwith zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:\n for f in src.rglob('*'):\n  if f.is_file(): z.write(f, '考勤/'+f.relative_to(src).as_posix())\n";
 const makeZip=cp.spawnSync('python3',['-c',zipScript,staging,archive],{encoding:'utf8'});
 if(makeZip.status!==0)throw Error('R64 zip creation: '+makeZip.stderr);
 const unpack=cp.spawnSync('python3',['-m','zipfile','-e',archive,unzipped],{encoding:'utf8'});
 if(unpack.status!==0)throw Error('R64 extraction: '+unpack.stderr);
 let diskRoot=path.join(unzipped,'考勤');
 const originalConfig=JSON.parse(fs.readFileSync(path.join(diskRoot,'config','work_rules.json'),'utf8'));
 const report={source:'p109-exp',releaseProvided:false,testPackageCreated:true,
  nativePickerVerified:false,crossVersionUpgradeVerified:false,
  bundledRuleKeys:Object.keys(originalConfig),
  demoRosterCount:JSON.parse(fs.readFileSync(path.join(diskRoot,'config','employees.json'),'utf8')).employees.length};
 const page=await browser.newPage({viewport:{width:1600,height:900},acceptDownloads:true});
 // Baseline audits explicitly select Demo; R80 separately tests the first-use entry.
 await page.addInitScript(()=>{if(!localStorage.getItem('p109-session-mode'))localStorage.setItem('p109-session-mode','demo')});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',d=>d.accept());
 const leaf=(parts)=>{
  if(!Array.isArray(parts)||parts.some(x=>typeof x!=='string'||!x||x==='.'||x==='..'||x.includes('/')||x.includes('\\')))throw Error('Unsafe FS path');
  const full=path.join(diskRoot,...parts);
  if(!full.startsWith(diskRoot+path.sep))throw Error('Outside audited project folder');
  return full;
 };
 await page.exposeFunction('__auditFs',async ({op,parts=[],create=false,data=null})=>{
  if(op==='list'){
   const at=parts.length?leaf(parts):diskRoot;
   return fs.existsSync(at)?fs.readdirSync(at,{withFileTypes:true}).map(x=>({name:x.name,kind:x.isDirectory()?'directory':'file'})):[];
  }
  const f=leaf(parts);
  if(op==='dir'){
   if(create)fs.mkdirSync(f,{recursive:true});
   else if(!fs.existsSync(f)||!fs.statSync(f).isDirectory())return false;
   return true;
  }
  if(op==='file'){
   if(create){fs.mkdirSync(path.dirname(f),{recursive:true});if(!fs.existsSync(f))fs.writeFileSync(f,'')}
   else if(!fs.existsSync(f))return false;
   return true;
  }
  if(op==='read'){
   if(!fs.existsSync(f))return null;
   return fs.readFileSync(f).toString('base64');
  }
  if(op==='write'){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.from(data,'base64'));return true}
  throw Error('Unknown mock filesystem operation '+op);
 });
 await page.addInitScript(()=>{
  const call=(op,parts=[],create=false,data)=>window.__auditFs({op,parts,create,data});
  const encode=async v=>{
   const bytes=typeof v==='string'?new TextEncoder().encode(v):
    v instanceof Blob?new Uint8Array(await v.arrayBuffer()):new Uint8Array(v);
   let t='';for(let i=0;i<bytes.length;i+=8192)t+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return btoa(t);
  };
  const decode=t=>Uint8Array.from(atob(t),c=>c.charCodeAt(0));
  class FileHandle{
   constructor(parts){this.parts=parts;this.kind='file';this.name=parts.at(-1)}
   async getFile(){const b=await call('read',this.parts);if(b===null)throw new DOMException('Missing','NotFoundError');return new File([decode(b)],this.name)}
   async createWritable(){const parts=this.parts;return {
    async write(v){await call('write',parts,false,await encode(v))},async close(){}};
   }
  }
  class DirHandle{
   constructor(parts=[]){this.parts=parts;this.kind='directory';this.name=parts.at(-1)||'考勤'}
   async getDirectoryHandle(name,opt={}){const p=[...this.parts,name];if(!await call('dir',p,!!opt.create))throw new DOMException('Missing','NotFoundError');return new DirHandle(p)}
   async getFileHandle(name,opt={}){const p=[...this.parts,name];if(!await call('file',p,!!opt.create))throw new DOMException('Missing','NotFoundError');return new FileHandle(p)}
   async *entries(){for(const x of await call('list',this.parts))yield [x.name,x.kind==='file'?
    new FileHandle([...this.parts,x.name]):new DirHandle([...this.parts,x.name])]}
  }
  Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>new DirHandle()});
 });
 const open=async()=>{
  await page.goto(pathToFileURL(path.join(diskRoot,'index.html')).href,{waitUntil:'load',timeout:60000});
  // This helper also boots the exact historical R77 source, before mode entry existed.
  await page.evaluate(async()=>{if(typeof p109RecentReady!=='undefined')await p109RecentReady});
  if(await page.locator('#r80Demo').isVisible())await page.locator('#r80Demo').click();
  await page.waitForFunction(()=>!!document.querySelector('.topbar'),null,{timeout:15000});
  await page.evaluate(()=>connectProjectDir());
 };
 try{
  await open();
  report.unzippedFileBoot=await page.evaluate(()=>state.workspaceMode==='all'&&EMPLOYEES.length===50);
  await page.evaluate(()=>switchMonth(2027,3,true));
  report.emptyNewMonth=await page.evaluate(()=>state.records.length===0&&state.analysis.size===31*EMPLOYEES.length);
  await page.locator('#attendanceInput').setInputFiles({
   name:'新员工门禁.csv',mimeType:'text/csv',
   buffer:Buffer.from('姓名,日期,时间,进出\n审计甲,2027-03-10,08:40:00,进\n审计甲,2027-03-10,11:30:00,出\n审计甲,2027-03-10,13:25:00,进\n审计甲,2027-03-10,17:55:00,出\n','utf8')});
  await page.waitForSelector('.r62-overlay',{timeout:20000});
  await page.locator('#r62Validate').click();
  await page.locator('#r62Commit').click();
  await page.waitForFunction(()=>state.records.length===4&&EMPLOYEES.some(e=>e.name==='审计甲'),null,{timeout:45000});
  report.importedRows=await page.evaluate(()=>state.records.length);
  report.r77ImportedAttendanceFlags=await page.evaluate(()=>{
    const e=EMPLOYEES.find(e=>e.name==='审计甲'),item=state.analysis.get(e.id+'|10');
    return item?.attendanceFlags.some(f=>f.kind==='late'&&f.time.startsWith('08:40'))&&
      item.attendanceFlags.some(f=>f.kind==='early'&&f.time.startsWith('11:30'));
  });
  report.r77OvertimeAndEarlyCoexist=await page.evaluate(()=>{
    const e=EMPLOYEES.find(e=>e.name==='审计甲'),a=state.analysis.get(e.id+'|10');
    return attendanceHasLateEarly(a)&&(a.autoOvertime?.segments?.length||0)>0;
  });
  await page.evaluate(()=>{
   const e=EMPLOYEES.find(e=>e.name==='审计甲');state.groups[e.id]='测试研发组';
   state.saved=false;rememberMonth();render();
  });
  await page.evaluate(()=>saveWorking());
  const wpath=path.join(diskRoot,'data','2027','03','working','state.json');
  const w=JSON.parse(fs.readFileSync(wpath,'utf8'));
  report.savedRecords=w.records.length;report.savedGroup=w.groups[w.employees.find(e=>e.name==='审计甲').id];
  const rawPath=path.join(diskRoot,'data','2027','03','raw','attendance');
  report.rawImportDirectories=fs.readdirSync(rawPath).length;
  report.singleRawImportCopy=report.rawImportDirectories===1;
  await page.evaluate(()=>freezeSnapshot());
  const snRoot=path.join(diskRoot,'data','2027','03','snapshots');
  const folders=fs.readdirSync(snRoot);
  if(folders.length!==1)throw Error('R64 snapshot was not written');
  const frozen=JSON.parse(fs.readFileSync(path.join(snRoot,folders[0],'snapshot.json'),'utf8'));
  report.snapshotBeforeEdit=frozen.working.manualStatuses;
  report.snapshotStartsWithoutManualOverride=Object.keys(report.snapshotBeforeEdit||{}).length===0;
  await page.evaluate(()=>{
   const e=EMPLOYEES.find(e=>e.name==='审计甲');
   state.workspaceMode='person';state.selection={type:'cell',employeeId:e.id,day:10};
   state.chartTab='timeline';setManualStatusForCurrent('absent');
  });
  await page.evaluate(()=>saveWorking());
  const amended=JSON.parse(fs.readFileSync(wpath,'utf8'));
  report.manualAfterEdit=amended.manualStatuses;
  report.manualOverridePersisted=Object.entries(report.manualAfterEdit||{}).some(([key,value])=>key.endsWith('|10')&&value==='absent');
  report.r77ManualKeepsEvidence=await page.evaluate(()=>{
    const e=EMPLOYEES.find(e=>e.name==='审计甲'),a=state.analysis.get(e.id+'|10');
    return attendanceJudgment(a)==='absent'&&attendanceHasLateEarly(a)&&
      personMonthStripHtml().includes('人工已调整判定（系统检测证据保留）');
  });
  report.previousSaved=fs.existsSync(path.join(diskRoot,'data','2027','03','working','state.previous.json'));
  report.previousWorkingPreserved=report.previousSaved;
  report.snapshotUnchanged=fs.readFileSync(path.join(snRoot,folders[0],'snapshot.json'),'utf8')===JSON.stringify(frozen,null,2);
  await page.reload({waitUntil:'load'});
  await page.evaluate(()=>connectProjectDir());
  report.reloadRestores=await page.evaluate(()=>{
   const e=EMPLOYEES.find(e=>e.name==='审计甲');
   return YEAR===2027&&MONTH===3&&state.records.length===4&&state.groups[e.id]==='测试研发组'&&
    state.manualStatuses[e.id+'|10']==='absent';
  });
  const destination=path.join(tmp,'relocated','考勤');fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.cpSync(diskRoot,destination,{recursive:true});fs.rmSync(diskRoot,{recursive:true,force:true});
  diskRoot=destination;
  await open();
  report.relocatedRestores=await page.evaluate(()=>YEAR===2027&&MONTH===3&&state.records.length===4);
  // Replace only application assets (do not touch config, data, or project.json).
  fs.rmSync(path.join(diskRoot,'src'),{recursive:true,force:true});
  fs.cpSync(path.join(root,'src'),path.join(diskRoot,'src'),{recursive:true});
  fs.copyFileSync(path.join(root,'index.html'),path.join(diskRoot,'index.html'));
  await open();
  report.sameVersionCodeOverlayKeepsData=await page.evaluate(()=>YEAR===2027&&MONTH===3&&state.records.length===4);
  report.bundledRulesHaveCurrentKeys=['amStart','amEnd','pmStart','pmEnd','overtimeMinMinutes'].every(k=>Object.hasOwn(originalConfig,k));
  report.bundledRosterIsSeparateFromProjectState=JSON.parse(fs.readFileSync(path.join(diskRoot,'config','employees.json'),'utf8')).employees.length!==
   JSON.parse(fs.readFileSync(path.join(diskRoot,'data','2027','03','working','state.json'),'utf8')).employees.length;

  // R65 actual clean-install and project health/recovery workflow.
  const fresh=path.join(tmp,'fresh-data','考勤'),freshRuntime=path.join(tmp,'fresh-install','考勤');
  fs.mkdirSync(fresh,{recursive:true});fs.mkdirSync(freshRuntime,{recursive:true});
  for(const name of ['index.html','src','README.md'])
   fs.cpSync(path.join(root,name),path.join(freshRuntime,name),{recursive:true});
  const cleanZip=path.join(out,'P109-考勤-R65-首次初始化.zip');
  const packed=cp.spawnSync('python3',['-c',zipScript,freshRuntime,cleanZip],{encoding:'utf8'});
  if(packed.status!==0)throw Error('R65 packaging '+packed.stderr);
  diskRoot=fresh;
  await page.goto(pathToFileURL(path.join(freshRuntime,'index.html')).href,{waitUntil:'load'});
  await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  await page.evaluate(()=>connectProjectDir());
  await page.waitForSelector('#p109CreateBlank');
  report.initializationPrompt=await page.evaluate(()=>!state.projectDir&&!!p109PendingDirectory);
  await page.locator('#p109CreateBlank').click();
  await page.waitForFunction(()=>state.saved&&!state.isDemo&&EMPLOYEES.length===0&&!!state.projectDir,{timeout:45000});
  report.blankProjectCreated=fs.existsSync(path.join(fresh,'project.json'))&&
   JSON.parse(fs.readFileSync(path.join(fresh,'config','employees.json'),'utf8')).employees.length===0;
  report.newProjectDataSeparated=!fs.existsSync(path.join(fresh,'index.html'))&&!fs.existsSync(path.join(fresh,'src'))&&
   !fs.existsSync(path.join(freshRuntime,'data'))&&!fs.existsSync(path.join(freshRuntime,'project.json'));
  // Continue the historical co-located installation/backup/upgrade regression.
  // This fixture copy is not the application's new-project initialization path.
  for(const name of ['index.html','src','README.md'])fs.cpSync(path.join(root,name),path.join(fresh,name),{recursive:true});
  await page.locator('#attendanceInput').setInputFiles({name:'审核门禁.csv',mimeType:'text/csv',
   buffer:Buffer.from('姓名,日期,时间,进出\n测试甲,2026-10-08,08:20,进\n测试甲,2026-10-08,18:00,出')});
  await page.locator('#r79Advanced>summary').click();
  await page.waitForSelector('#r96KeepImport');
  await page.locator('#r96KeepImport').click();
  await page.locator('#r62Validate').click();await page.locator('#r62Commit').click();
  await page.waitForFunction(()=>state.records.length===2&&EMPLOYEES.length===1);
  await page.evaluate(()=>saveWorking());
  report.importTemplateStored=await page.evaluate(()=>!!state.importProfile.templates?.attendance);
  report.healthAfterImport=await page.evaluate(async()=>{
   const a=await p109AuditProject();
   return a.months.some(m=>m.key==='2026-10'&&m.imports===1&&m.raw===1)&&
    !a.issues.some(x=>x.level==='critical')&&a.verifiedRaw===1;
  });

  // R66: edit a frozen revision in a separate folder, never overwrite main working.
  await page.evaluate(()=>freezeSnapshot());
  const frozenBase=path.join(fresh,'data','2026','10','snapshots'),
   freezeId=fs.readdirSync(frozenBase)[0],
   frozenPath=path.join(frozenBase,freezeId,'snapshot.json'),
   frozenBytes=fs.readFileSync(frozenPath),
   mainPath=path.join(fresh,'data','2026','10','working','state.json'),
   mainBytes=fs.readFileSync(mainPath);
  await page.evaluate(id=>p109ForkSnapshot('2026-10',id),freezeId);
  report.branchCreated=await page.evaluate(()=>!!state.activeBranch?.id&&!!state.activeBranch.parentSnapshotId);
  await page.evaluate(()=>{
    const id=EMPLOYEES.find(x=>x.name==='测试甲').id;
    state.selection={type:'cell',employeeId:id,day:8};
    setManualStatusForCurrent('absent');
  });
  await page.evaluate(()=>saveWorking());
  const branchId=await page.evaluate(()=>state.activeBranch.id),
   branchPath=path.join(fresh,'data','2026','10','branches',branchId,'working','state.json');
  report.branchIsolated=fs.existsSync(branchPath)&&
   fs.readFileSync(mainPath).equals(mainBytes)&&
   fs.readFileSync(frozenPath).equals(frozenBytes)&&
   Object.keys(JSON.parse(fs.readFileSync(branchPath,'utf8')).manualStatuses||{}).length===1;
  await page.reload({waitUntil:'load'});await page.evaluate(()=>connectProjectDir());
  report.branchReopened=await page.evaluate(id=>state.activeBranch?.id===id&&!!state.activeBranch?.parentSnapshotId,branchId);
  await page.evaluate(()=>p109ReturnToMain());
  report.backToMain=await page.evaluate(()=>!state.activeBranch&&state.records.length===2&&
    Object.keys(state.manualStatuses).length===0);


  // R69: one data management route owns all project inventory and health categories.
  await page.evaluate(()=>{state.dataSection='overview';navigateWorkspace('data')});
  await page.waitForSelector('.r68-month-row:not(.heading)',{timeout:30000});
  report.projectMonthInventory=await page.evaluate(()=>{
   const m=document.querySelector('.r68-month-table')?.textContent||'';
   return m.includes('2026-10')&&m.includes('已保存')&&
    !document.querySelector('.r68-data-rail')&&!document.querySelector('.r68-filetree')&&
    !document.querySelector('[data-workspace="project"]')&&
    document.querySelectorAll('[data-workspace]').length===5&&
    ['overview','months','health','storage'].every(k=>!!document.querySelector('[data-data-section="'+k+'"]'));
  });
  await page.screenshot({path:path.join(out,'r69-data-project-overview.png')});
  await page.locator('[data-data-section="storage"]').click();
  await page.waitForSelector('.r68-storage-bars .r68-storage-row',{timeout:30000});
  await page.waitForSelector('.r71-tree-section .r68-filetree',{timeout:30000});
  report.projectStorageCategory=await page.evaluate(()=>{
   const tree=document.querySelector('.r71-tree-section .r68-filetree')?.textContent||'';
   return !!document.querySelector('#r68StorageCard')&&tree.includes('state.json')&&
    tree.includes('审核门禁.csv')&&!document.querySelector('.r68-data-rail');
  });
  await page.screenshot({path:path.join(out,'r69-data-storage.png')});
  await page.locator('[data-data-section="health"]').click();
  await page.waitForSelector('#r68HealthCard');
  report.projectHealthCategory=await page.evaluate(()=>!!document.querySelector('#r68HealthCard')&&
   !!document.querySelector('#r68IndexRepair'));
  await page.locator('[data-data-section="months"]').click();
  await page.waitForSelector('.r68-month-row:not(.heading)');
  report.projectMonthsCategory=await page.evaluate(()=>!!document.querySelector('#r68MonthsCard'));
  await page.evaluate(()=>{state.dataSection='roster';navigateWorkspace('data')});
  await page.waitForSelector('.r73-month-pane .r73-person-row');
  report.rosterUi=await page.evaluate(()=>{
   const card=document.querySelector('.r71-data-content');
   return !!card&&!card.querySelector('.data-roster-head')&&
    !!document.querySelector('#r68SelectVisible')&&
    !!document.querySelector('#r68BulkGroup')&&
    !!document.querySelector('#r73FixedList')&&!!document.querySelector('#r72FixSelected')&&
    !document.querySelector('.r68-data-rail')&&!document.querySelector('.r68-filetree');
  });
  await page.evaluate(async()=>{const p=window.prompt;window.prompt=()=> '测试研发组';
    try{await r72CreateGroup()}finally{window.prompt=p}});
  await page.locator('#r68SelectVisible').check();
  await page.locator('#r68BulkGroup').selectOption('测试研发组');
  await page.locator('#r68ApplyGroup').click();
  report.batchGroupWorking=await page.evaluate(()=>{
   const person=EMPLOYEES.find(e=>e.name==='测试甲');
   return person&&!!state.groups[person.id]&&state.saved===false;
  });
  await page.evaluate(()=>saveWorking());
  await page.screenshot({path:path.join(out,'r68-data-roster.png')});
  await page.evaluate(()=>navigateWorkspace('all'));
  await page.waitForSelector('.r68-scope-kpis');
  report.scopeUi=await page.evaluate(()=>
    !!document.querySelector('.r68-stacked-track')&&
    !!document.querySelector('.r68-scope-rank')&&
    !document.querySelector('#scopeStatusChart')&&
    !document.querySelector('#scopeCompareChart'));
  await page.screenshot({path:path.join(out,'r68-all-insights.png')});
  await page.evaluate(()=>{state.selectedGroup=workspaceGroups()[0];navigateWorkspace('group')});
  await page.waitForSelector('.r68-scope-rank');
  await page.screenshot({path:path.join(out,'r68-group-insights.png')});
  await page.evaluate(()=>navigateWorkspace('data'));

  const rawDir=path.join(fresh,'data','2026','10','raw','attendance'),
   impName=fs.readdirSync(rawDir)[0],rawFile=path.join(rawDir,impName,'审核门禁.csv');
  const savedRaw=fs.readFileSync(rawFile);fs.writeFileSync(rawFile,'tampered');
  report.rawCorruptionDetected=await page.evaluate(async()=>
   (await p109AuditProject()).issues.some(x=>x.code==='RAW_HASH_MISMATCH'));
  fs.writeFileSync(rawFile,savedRaw);
  const indexPath=path.join(fresh,'project.json'),meta=JSON.parse(fs.readFileSync(indexPath,'utf8'));
  fs.writeFileSync(indexPath,JSON.stringify({...meta,months:[]}));
  report.missingIndexDetected=await page.evaluate(async()=>
    (await p109AuditProject()).safeIndexRepair.includes('2026-10'));
  await page.evaluate(async()=>p109RepairIndex(await p109AuditProject()));
  report.safeIndexFixed=JSON.parse(fs.readFileSync(indexPath,'utf8')).months.includes('2026-10')&&
   fs.existsSync(path.join(fresh,'project.index.previous.json'));
  await page.evaluate(async()=>{
   p109Audit=await p109AuditProject();
   // R72: only explicitly selected staff are project defaults.
   state.fixedPeople=[EMPLOYEES[0].id];rememberMonth();
   await p109PinDefaults('roster');await p109PinDefaults('import');await p109PinDefaults('rules');
   switchMonth(2026,11,true);
  });
  report.pinnedForNextMonth=await page.evaluate(()=>state.projectProfile?.pinRoster&&
   state.projectProfile.pinImport&&state.projectProfile.pinRules&&
   EMPLOYEES.length===1&&(state.fixedPeople||[]).length===1&&RULES.amEnd==='11:40'&&!!state.importProfile.templates?.attendance);
  if(await page.locator('#p109ProjectClose').count())await page.locator('#p109ProjectClose').click();
  await page.locator('#projectMenuButton').click();
  await page.locator('#p109ProjectControl').click();
  await page.waitForSelector('#p109ProjectClose');
  await page.screenshot({path:path.join(out,'r67-project-health.png')});
  await page.locator('#p109ProjectClose').click();
  await page.locator('#projectMenuButton').click();
  const download=page.waitForEvent('download',{timeout:60000});
  await page.locator('#backupProjectBtn').click();
  const outZip=path.join(tmp,'working-backup.zip');await (await download).saveAs(outZip);
  report.backupZipValid=cp.spawnSync('python3',['-m','zipfile','-t',outZip],{encoding:'utf8'}).status===0;
  const restoreDir=path.join(tmp,'restored','考勤');fs.mkdirSync(restoreDir,{recursive:true});
  diskRoot=restoreDir;
  const choose=page.waitForEvent('filechooser',{timeout:30000});
  await page.locator('#projectMenuButton').click();
  await page.locator('#restoreZipBtn').click();
  await (await choose).setFiles({name:'restore.zip',mimeType:'application/zip',buffer:fs.readFileSync(outZip)});
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('恢复完成'),null,{timeout:60000});
  report.zipRestoreRaw=fs.existsSync(path.join(restoreDir,'data','2026','10','raw','attendance',impName,'审核门禁.csv'));
  await open();
  report.zipRestoreWorking=await page.evaluate(()=>YEAR===2026&&MONTH===10&&state.records.length===2&&
   EMPLOYEES.some(x=>x.name==='测试甲'));

  // R67 update only program assets; verify data remains byte-for-byte intact.
  const releaseZip=path.join(out,'P109-考勤-'+currentRevision+'-可更新离线版.zip'),
   pkg=cp.spawnSync('python3',[path.join(root,'tools','package-release.py'),root,releaseZip],{encoding:'utf8'});
  if(pkg.status!==0)throw Error('R67 package generation '+pkg.stderr);
  const beforeWorking=fs.readFileSync(path.join(restoreDir,'data','2026','10','working','state.json')),
   beforeOriginal=fs.readFileSync(path.join(restoreDir,'data','2026','10','raw','attendance',impName,'审核门禁.csv'));
  await page.locator('#importBtn').click();
  const updateChoice=page.waitForEvent('filechooser',{timeout:30000});
  await page.locator('#upgradeProjectBtn').click();
  await (await updateChoice).setFiles({name:'P109-update.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(()=>document.querySelector('#p109UpdateVersion')?.textContent.includes(P109_APP_VERSION));
  await page.locator('#p109UpdateChoose').click();
  await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  await page.locator('#p109UpdateInstall').click();
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('程序更新已写入'),null,{timeout:60000});
  report.codeUpdateDataUntouched=fs.readFileSync(path.join(restoreDir,'data','2026','10','working','state.json')).equals(beforeWorking)&&
   fs.readFileSync(path.join(restoreDir,'data','2026','10','raw','attendance',impName,'审核门禁.csv')).equals(beforeOriginal);
  report.preUpdateBackup=fs.readdirSync(path.join(restoreDir,'backups')).some(x=>x.startsWith('pre-upgrade-')&&x.endsWith('.zip'));
  const releaseCheck=cp.spawnSync('python3',['-c',
    "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;assert all(p in ('index.html','README.md','p109-release-manifest.json') or p.startswith('src/') for p in z.namelist())",releaseZip],{encoding:'utf8'});
  report.releaseZipNoData=releaseCheck.status===0;

  // R78: use the exact previous application commit, not changed version markers.
  const oldRoot=path.join(tmp,'old-version-install','考勤');
  fs.mkdirSync(path.dirname(oldRoot),{recursive:true});
  fs.cpSync(restoreDir,oldRoot,{recursive:true});
  // Build a synthetic schema-2 fixture ONLY when it contains no later-schema
  // decisions or manual intervals. This is not a production downgrade path.
  const legacyValue=value=>{
   if(!value||typeof value!=='object')return value;
   for(const field of ['manualTempOutings','manualOvertime','tempOutingReview','attendanceReview'])if(field in value){
    if(Object.keys(value[field]||{}).length)throw Error('Cannot turn new manual facts into a legacy fixture');
    delete value[field];
   }
   if(value.schemaVersion>=3)value.schemaVersion=2;
   if(value.workingSchema>=3)value.workingSchema=2;
   for(const key of Object.keys(value))legacyValue(value[key]);return value;
  };
  const legacyFiles=folder=>{
   for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
    const file=path.join(folder,entry.name);
    if(entry.isDirectory()){if(entry.name!=='raw'&&entry.name!=='backups')legacyFiles(file)}
    else if(entry.name.endsWith('.json')){
     const data=JSON.parse(fs.readFileSync(file,'utf8'));fs.writeFileSync(file,JSON.stringify(legacyValue(data)));
    }
   }
  };
  legacyFiles(oldRoot);
  const historicalCommit='71caeaa99b7eb41b71ee457d1334a8bcff2de561';
  const projectPath='projects/1-桌面软件/109-AttendScope/';
  const listing=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',historicalCommit,'--',projectPath],{encoding:'utf8'});
  if(listing.status!==0)throw Error('Historical source listing unavailable: '+listing.stderr);
  const historicalFiles=listing.stdout.trim().split(/\r?\n/).filter(file=>{
    const relative=file.slice(projectPath.length);
    return relative==='index.html'||relative==='README.md'||relative.startsWith('src/');
  });
  if(historicalFiles.length<20)throw Error('Historical application fixture incomplete');
  for(const file of historicalFiles){
    const relative=file.slice(projectPath.length),destination=path.join(oldRoot,relative);
    const original=cp.spawnSync('git',['-C',root,'show',historicalCommit+':'+file],{maxBuffer:16*1024*1024});
    if(original.status!==0)throw Error('Cannot read historical source '+relative);
    fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,original.stdout);
  }
  report.historicalSourceCommit=historicalCommit;
  report.historicalApplicationFiles=historicalFiles.length;
  const oldControl=path.join(oldRoot,'src','app','00-state.js');
  diskRoot=oldRoot;
  await open();
  report.oldVersionInstallBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.3-preview'&&
   YEAR===2026&&MONTH===10&&state.records.length===2&&!!state.projectDir);
  await page.evaluate(()=>saveWorking());
  const oldWorkingPath=path.join(oldRoot,'data','2026','10','working','state.json');
  const oldRawPath=path.join(oldRoot,'data','2026','10','raw','attendance',impName,'审核门禁.csv');
  const oldWorkingBytes=fs.readFileSync(oldWorkingPath),oldRawBytes=fs.readFileSync(oldRawPath);
  // The historical R77 program still exposes project management directly.
  await page.locator('#p109ProjectControl').click();
  await page.waitForSelector('#p109UpgradeCode',{timeout:30000});
  const oldUpgradeChoice=page.waitForEvent('filechooser',{timeout:30000});
  await page.locator('#p109UpgradeCode').click();
  await (await oldUpgradeChoice).setFiles({name:'P109-update-0.2.3.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('程序更新已写入'),null,{timeout:60000});
  report.crossVersionUpgradePreservesData=fs.readFileSync(oldWorkingPath).equals(oldWorkingBytes)&&
   fs.readFileSync(oldRawPath).equals(oldRawBytes);
  report.crossVersionBackupCreated=fs.readdirSync(path.join(oldRoot,'backups')).some(x=>x.startsWith('pre-upgrade-')&&x.endsWith('.zip'));
  report.crossVersionCodeUpdated=fs.readFileSync(oldControl,'utf8').includes("const P109_APP_VERSION='"+currentVersion+"';");
  await open();
  report.crossVersionUpgradeRestoresDataAfterReload=await page.evaluate(version=>P109_APP_VERSION===version&&
   YEAR===2026&&MONTH===10&&state.records.length===2&&EMPLOYEES.some(e=>e.name==='测试甲'),currentVersion);
  report.crossVersionUpgradeVerified=report.oldVersionInstallBoot&&report.crossVersionUpgradePreservesData&&
   report.crossVersionBackupCreated&&report.crossVersionCodeUpdated&&report.crossVersionUpgradeRestoresDataAfterReload;

  // Also exercise the exact R83 updater the user is currently running.
  const r83Commit='ef254f113a4e2e7a17b80b7daea6cbda4f402f5f';
  const r83Listing=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',r83Commit,'--',projectPath],{encoding:'utf8'});
  if(r83Listing.status!==0)throw Error('R83 source listing unavailable');
  const r83Files=r83Listing.stdout.trim().split(/\r?\n/).filter(f=>{const rel=f.slice(projectPath.length);return rel==='index.html'||rel==='README.md'||rel.startsWith('src/')});
  if(r83Files.length<50)throw Error('R83 fixture incomplete');
  for(const file of r83Files){const dest=path.join(oldRoot,file.slice(projectPath.length)),source=cp.spawnSync('git',['-C',root,'show',r83Commit+':'+file],{maxBuffer:16*1024*1024});
   if(source.status!==0)throw Error('Cannot read R83 source');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source.stdout);
  }
  await open();
  report.r83OldVersionBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.9-preview'&&state.records.length===2&&!!state.projectDir);
  await page.evaluate(()=>saveWorking());const r83Working=fs.readFileSync(oldWorkingPath),r83Raw=fs.readFileSync(oldRawPath);
  await page.locator('#projectMenuButton').click();const r83Choice=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();
  await (await r83Choice).setFiles({name:'P109-upgrade.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('程序更新已写入'),null,{timeout:60000});
  report.r83UpdatePreservesData=fs.readFileSync(oldWorkingPath).equals(r83Working)&&fs.readFileSync(oldRawPath).equals(r83Raw);
  await open();report.r83UpdateReload=await page.evaluate(v=>P109_APP_VERSION===v&&state.records.length===2&&EMPLOYEES.some(e=>e.name==='测试甲')&&!!document.querySelector('#importPopover #upgradeProjectBtn'),currentVersion);

  // R86 uses the current upgrade wizard, whereas R77/R83 use older entries.
  const r86Commit='f80c0c145f99618ca3c171dd42e0b440057728bd';
  const installR86=()=>{
   const listing=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',r86Commit,'--',projectPath],{encoding:'utf8'});
   if(listing.status!==0)throw Error('R86 source listing unavailable');
   for(const file of listing.stdout.trim().split(/\r?\n/).filter(f=>{const rel=f.slice(projectPath.length);return rel==='index.html'||rel==='README.md'||rel.startsWith('src/')})){
    const dest=path.join(oldRoot,file.slice(projectPath.length)),source=cp.spawnSync('git',['-C',root,'show',r86Commit+':'+file],{maxBuffer:16*1024*1024});
    if(source.status!==0)throw Error('Cannot read R86 source');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source.stdout);
   }
  };
  installR86();await open();
  report.r86OldVersionBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.12-preview'&&state.records.length===2&&!!state.projectDir);
  const r86Working=fs.readFileSync(oldWorkingPath),r86Raw=fs.readFileSync(oldRawPath);
  // A Node filesystem test handle is not a browser-native structured-cloneable
  // directory. Choose it afresh instead of restoring its serialized plain object.
  await page.evaluate(()=>p109RememberProgram(null));
  await page.locator('#importBtn').click();const r86Choice=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();
  await(await r86Choice).setFiles({name:'P109-upgrade.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(v=>document.querySelector('#p109UpdateVersion')?.textContent.includes(v),currentVersion);
  if(await page.locator('#p109UpdateChoose').isDisabled())throw Error('R86 upgrade validation: '+await page.locator('#p109UpdateStatus').textContent());
  try{await page.locator('#p109UpdateChoose').click({timeout:5000})}catch(e){
   await page.screenshot({path:path.join(out,'r87-legacy-upgrade-failure.png')});
   throw Error('R86 folder choice: '+await page.locator('#p109UpdateStatus').textContent());
  }
  await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  await page.locator('#p109UpdateInstall').click();
  await page.waitForFunction(()=>document.getElementById('p109UpdateInstall')?.dataset.reload==='1',null,{timeout:60000});
  report.r86UpdatePreservesData=fs.readFileSync(oldWorkingPath).equals(r86Working)&&fs.readFileSync(oldRawPath).equals(r86Raw);
  await open();
  report.r86UpgradeReload=await page.evaluate(v=>P109_APP_VERSION===v&&state.records.length===2,currentVersion);
  const r88Commit='e43db9e162546f90951d22c4aa62e07c09eaef32';
  const installR88=()=>{
   const listing=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',r88Commit,'--',projectPath],{encoding:'utf8'});
   if(listing.status!==0)throw Error('R88 source listing unavailable');
   for(const file of listing.stdout.trim().split(/\r?\n/).filter(f=>{const rel=f.slice(projectPath.length);return rel==='index.html'||rel==='README.md'||rel.startsWith('src/')})){
    const dest=path.join(oldRoot,file.slice(projectPath.length)),source=cp.spawnSync('git',['-C',root,'show',r88Commit+':'+file],{maxBuffer:16*1024*1024});
    if(source.status!==0)throw Error('Cannot read R88 source');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source.stdout);
   }
  };
  installR88();await open();
  report.r88OldVersionBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.14-preview'&&state.records.length===2&&!!state.projectDir);
  await page.evaluate(async()=>{
   const employeeId=EMPLOYEES[0].id;
   state.manualTempOutings=[{id:'r88-manual-lunch',employeeId,date:'2026-10-08',start:'11:30',end:'13:45'}];
   state.tempOutingReview={'r88-manual-lunch':'red'};state.calendarOverrides={'2026-10-01':'holiday','2026-10-10':'adjusted-work'};
   state.saved=false;rememberMonth();await saveWorking();p109RememberProgram(null);
  });
  const r88Working=fs.readFileSync(oldWorkingPath),r88Raw=fs.readFileSync(oldRawPath);
  await page.locator('#importBtn').click();const r88Choice=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();
  await(await r88Choice).setFiles({name:'P109-upgrade.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(v=>document.querySelector('#p109UpdateVersion')?.textContent.includes(v),currentVersion);
  await page.locator('#p109UpdateChoose').click();await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  await page.locator('#p109UpdateInstall').click();await page.waitForFunction(()=>document.getElementById('p109UpdateInstall')?.dataset.reload==='1',null,{timeout:60000});
  report.r88UpgradePreservesBytes=fs.readFileSync(oldWorkingPath).equals(r88Working)&&fs.readFileSync(oldRawPath).equals(r88Raw);
  await open();report.r88Migration=await page.evaluate(()=>state.manualTempOutings.length===2&&state.manualTempOutings.every(row=>state.tempOutingReview[row.id]==='red')&&dayType(1)==='rest'&&dayType(10)==='work'&&!state.saved);
  const r92Commit='fe04503b389c1fda805f9a1ed14289efcd35ed4c';
  const installR92=()=>{
   const listing=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',r92Commit,'--',projectPath],{encoding:'utf8'});
   if(listing.status!==0)throw Error('R92 source listing unavailable');
   for(const file of listing.stdout.trim().split(/\r?\n/).filter(f=>{const rel=f.slice(projectPath.length);return rel==='index.html'||rel==='README.md'||rel.startsWith('src/')})){
    const dest=path.join(oldRoot,file.slice(projectPath.length)),source=cp.spawnSync('git',['-C',root,'show',r92Commit+':'+file],{maxBuffer:16*1024*1024});
    if(source.status!==0)throw Error('Cannot read R92 source');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source.stdout);
   }
  };
  installR92();await open();
  report.r92OldVersionBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.18-preview'&&state.records.length===2&&!!state.projectDir);
  await page.evaluate(async()=>{delete RULES.businessRuleVersion;delete RULES.overtimeRuleVersion;delete RULES.overtimeAfterMinutes;delete RULES.overtimeBeforeMinutes;RULES.overtimeMinMinutes=20;state.saved=false;rememberMonth();await saveWorking();p109RememberProgram(null)});
  const r92Working=fs.readFileSync(oldWorkingPath),r92Raw=fs.readFileSync(oldRawPath);
  await page.locator('#importBtn').click();const r92Choice=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();
  await(await r92Choice).setFiles({name:'P109-upgrade.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(v=>document.querySelector('#p109UpdateVersion')?.textContent.includes(v),currentVersion);
  await page.locator('#p109UpdateChoose').click();await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  await page.locator('#p109UpdateInstall').click();await page.waitForFunction(()=>document.getElementById('p109UpdateInstall')?.dataset.reload==='1',null,{timeout:60000});
  report.r92UpgradePreservesBytes=fs.readFileSync(oldWorkingPath).equals(r92Working)&&fs.readFileSync(oldRawPath).equals(r92Raw);
  await open();report.r92Migration=await page.evaluate(()=>RULES.overtimeRuleVersion===2&&RULES.overtimeAfterMinutes===20&&RULES.overtimeBeforeMinutes===5&&RULES.overtimeMinMinutes===5&&state.manualTempOutings.length===2&&!state.saved);
  const r93Commit='b792aef64c5fcc301e4b144fffb5c66368765748';
  const installR93=()=>{
   const listing=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',r93Commit,'--',projectPath],{encoding:'utf8'});
   if(listing.status!==0)throw Error('R93 source listing unavailable');
   for(const file of listing.stdout.trim().split(/\r?\n/).filter(f=>{const rel=f.slice(projectPath.length);return rel==='index.html'||rel==='README.md'||rel.startsWith('src/')})){
    const dest=path.join(oldRoot,file.slice(projectPath.length)),source=cp.spawnSync('git',['-C',root,'show',r93Commit+':'+file],{maxBuffer:16*1024*1024});
    if(source.status!==0)throw Error('Cannot read R93 source');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source.stdout);
   }
  };
  installR93();await open();
  report.r93OldVersionBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.19-preview'&&state.records.length===2&&!!state.projectDir);
  await page.evaluate(async()=>{delete RULES.businessRuleVersion;state.saved=false;rememberMonth();await saveWorking();p109RememberProgram(null)});
  const r93Working=fs.readFileSync(oldWorkingPath),r93Raw=fs.readFileSync(oldRawPath);
  await page.locator('#importBtn').click();const r93Choice=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();
  await(await r93Choice).setFiles({name:'P109-upgrade.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(v=>document.querySelector('#p109UpdateVersion')?.textContent.includes(v),currentVersion);
  await page.locator('#p109UpdateChoose').click();await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  await page.locator('#p109UpdateInstall').click();await page.waitForFunction(()=>document.getElementById('p109UpdateInstall')?.dataset.reload==='1',null,{timeout:60000});
  report.r93UpgradePreservesBytes=fs.readFileSync(oldWorkingPath).equals(r93Working)&&fs.readFileSync(oldRawPath).equals(r93Raw);
  await open();report.r93Migration=await page.evaluate(()=>RULES.businessRuleVersion===2&&RULES.overtimeRuleVersion===2&&state.manualTempOutings.length===2&&!state.saved);
  await page.evaluate(async()=>{
   state.manualOvertime=[{id:'manual-overtime:legacy-test',employeeId:EMPLOYEES[0].id,date:'2026-10-08',start:'18:00',end:'19:00'}];
   state.saved=false;rememberMonth();await saveWorking();
  });
  report.newWorkingHasCurrentSchema=JSON.parse(fs.readFileSync(oldWorkingPath,'utf8')).schemaVersion===6;
  const r94Commit='c16d468cf3f879599203c7ffbd244ae07c32f360';
  const listingR94=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',r94Commit,'--',projectPath],{encoding:'utf8'});
  if(listingR94.status!==0)throw Error('R94 source listing unavailable');
  for(const file of listingR94.stdout.trim().split(/\r?\n/).filter(f=>{const rel=f.slice(projectPath.length);return rel==='index.html'||rel==='README.md'||rel.startsWith('src/')})){
   const dest=path.join(oldRoot,file.slice(projectPath.length)),source=cp.spawnSync('git',['-C',root,'show',r94Commit+':'+file],{maxBuffer:16*1024*1024});
   if(source.status!==0)throw Error('Cannot read R94 source');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source.stdout);
  }
  await open();report.r94OldVersionBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.20-preview'&&!!state.projectDir&&RULES.businessRuleVersion===2);
  await page.evaluate(async()=>{state.saved=false;rememberMonth();await saveWorking();p109RememberProgram(null)});
  const r94Working=fs.readFileSync(oldWorkingPath),r94Raw=fs.readFileSync(oldRawPath);
  await page.locator('#importBtn').click();const r94Choice=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();
  await(await r94Choice).setFiles({name:'P109-upgrade.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(v=>document.querySelector('#p109UpdateVersion')?.textContent.includes(v),currentVersion);
  await page.locator('#p109UpdateChoose').click();await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  await page.locator('#p109UpdateInstall').click();await page.waitForFunction(()=>document.getElementById('p109UpdateInstall')?.dataset.reload==='1',null,{timeout:60000});
  report.r94UpgradePreservesBytes=fs.readFileSync(oldWorkingPath).equals(r94Working)&&fs.readFileSync(oldRawPath).equals(r94Raw);
  await open();report.r94ReopensWithoutMigration=await page.evaluate(v=>P109_APP_VERSION===v&&!!state.projectDir&&state.saved&&RULES.businessRuleVersion===2,currentVersion);
  const r95Commit='b35d0aa48fe1464ceb371f292abdf210502e307b';
  const listingR95=cp.spawnSync('git',['-C',root,'-c','core.quotepath=false','ls-tree','--full-tree','-r','--name-only',r95Commit,'--',projectPath],{encoding:'utf8'});
  if(listingR95.status!==0)throw Error('R95 source listing unavailable');
  for(const file of listingR95.stdout.trim().split(/\r?\n/).filter(f=>{const rel=f.slice(projectPath.length);return rel==='index.html'||rel==='README.md'||rel.startsWith('src/')})){
   const dest=path.join(oldRoot,file.slice(projectPath.length)),source=cp.spawnSync('git',['-C',root,'show',r95Commit+':'+file],{maxBuffer:16*1024*1024});
   if(source.status!==0)throw Error('Cannot read R95 source');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,source.stdout);
  }
  await open();report.r95OldVersionBoot=await page.evaluate(()=>P109_APP_VERSION==='0.2.21-preview'&&!!state.projectDir);
  await page.evaluate(async()=>{state.importProfile.templates={leave:{header:true,skip:0,mapping:{name:0,startDate:1,start:2,endDate:3,end:4,type:-1,note:-1},labels:['姓名','开始日期','开始时间','结束日期','结束时间'],startMode:'split',endMode:'split'}};state.saved=false;rememberMonth();await saveWorking();p109RememberProgram(null)});
  const r95Working=fs.readFileSync(oldWorkingPath),r95Raw=fs.readFileSync(oldRawPath);
  await page.locator('#importBtn').click();const r95Choice=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();
  await(await r95Choice).setFiles({name:'P109-upgrade.zip',mimeType:'application/zip',buffer:fs.readFileSync(releaseZip)});
  await page.waitForFunction(v=>document.querySelector('#p109UpdateVersion')?.textContent.includes(v),currentVersion);
  await page.locator('#p109UpdateChoose').click();await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  await page.locator('#p109UpdateInstall').click();await page.waitForFunction(()=>document.getElementById('p109UpdateInstall')?.dataset.reload==='1',null,{timeout:60000});
  report.r95UpgradePreservesBytes=fs.readFileSync(oldWorkingPath).equals(r95Working)&&fs.readFileSync(oldRawPath).equals(r95Raw);
  await open();report.r95TemplateRestored=await page.evaluate(v=>P109_APP_VERSION===v&&state.saved&&r96SavedImportSettings('leave').mapping.type===-1&&r96SavedImportSettings('leave').startMode==='split',currentVersion);
  installR86();await open();
  report.oldProgramRejectsNewSchema=await page.evaluate(()=>!state.projectDir&&document.body.textContent.includes('更新的数据版本'));
  installR88();await open();
  report.r88RejectsNewSchema=await page.evaluate(()=>!state.projectDir&&document.body.textContent.includes('更新的数据版本'));
  installR92();await open();report.r92RejectsNewSchema=await page.evaluate(()=>!state.projectDir&&document.body.textContent.includes('更新的数据版本'));

  installR93();await open();report.r93RejectsNewSchema=await page.evaluate(()=>!state.projectDir&&document.body.textContent.includes('更新的数据版本'));

  const requiredTrue=[
   'r95OldVersionBoot','r95UpgradePreservesBytes','r95TemplateRestored',
   'r94OldVersionBoot','r94UpgradePreservesBytes','r94ReopensWithoutMigration',
   'r93OldVersionBoot','r93UpgradePreservesBytes','r93Migration','r93RejectsNewSchema',
   'r86OldVersionBoot','r86UpdatePreservesData','r86UpgradeReload','newWorkingHasCurrentSchema','oldProgramRejectsNewSchema',
   'r88OldVersionBoot','r88UpgradePreservesBytes','r88Migration','r88RejectsNewSchema',
   'r92OldVersionBoot','r92UpgradePreservesBytes','r92Migration','r92RejectsNewSchema',
   'r83OldVersionBoot','r83UpdatePreservesData','r83UpdateReload',
   'r77ImportedAttendanceFlags','r77OvertimeAndEarlyCoexist','r77ManualKeepsEvidence',
   'unzippedFileBoot','emptyNewMonth','singleRawImportCopy','snapshotStartsWithoutManualOverride',
   'manualOverridePersisted','previousWorkingPreserved','snapshotUnchanged','reloadRestores',
   'relocatedRestores','sameVersionCodeOverlayKeepsData','bundledRulesHaveCurrentKeys',
   'bundledRosterIsSeparateFromProjectState','initializationPrompt','blankProjectCreated','newProjectDataSeparated',
   'importTemplateStored','healthAfterImport','branchCreated','branchIsolated','branchReopened',
   'backToMain','projectMonthInventory','projectStorageCategory','projectHealthCategory',
   'projectMonthsCategory','rosterUi','batchGroupWorking','scopeUi','rawCorruptionDetected',
   'missingIndexDetected','safeIndexFixed','pinnedForNextMonth','backupZipValid','zipRestoreRaw',
   'zipRestoreWorking','codeUpdateDataUntouched','preUpdateBackup','releaseZipNoData',
   'oldVersionInstallBoot','crossVersionUpgradePreservesData','crossVersionBackupCreated',
   'crossVersionCodeUpdated','crossVersionUpgradeRestoresDataAfterReload','crossVersionUpgradeVerified'
  ];
  const missing=requiredTrue.filter(k=>report[k]!==true);
  if(missing.length||report.importedRows!==4||report.savedRecords!==4||report.savedGroup!=='测试研发组')
   throw Error('R77 full lifecycle audit failed '+JSON.stringify({missing,report}));

  if(Object.entries(report).some(([k,v])=>[
   'initializationPrompt','blankProjectCreated','importTemplateStored','healthAfterImport',
   'rawCorruptionDetected','missingIndexDetected','safeIndexFixed','pinnedForNextMonth',
   'backupZipValid','zipRestoreRaw','zipRestoreWorking','codeUpdateDataUntouched','preUpdateBackup','releaseZipNoData','projectMonthInventory','projectStorageCategory','projectHealthCategory','projectMonthsCategory','rosterUi','batchGroupWorking','scopeUi','branchCreated','branchIsolated','branchReopened','backToMain'].includes(k)&&!v))
   throw Error('R65 lifecycle failed '+JSON.stringify(report));

  if(!report.unzippedFileBoot||!report.emptyNewMonth||report.savedRecords!==4||
   !report.snapshotUnchanged||!report.reloadRestores||!report.relocatedRestores||
   !report.sameVersionCodeOverlayKeepsData||errors.length)throw Error('R64 lifecycle failure '+JSON.stringify({report,errors}));
  fs.writeFileSync(path.join(out,'p109-lifecycle-audit.json'),JSON.stringify(report,null,2));
  process.stdout.write('P109_LIFECYCLE_AUDIT_PASS '+JSON.stringify(report)+'\n');
 }finally{
  await page.close();
  fs.rmSync(tmp,{recursive:true,force:true});
 }
};
