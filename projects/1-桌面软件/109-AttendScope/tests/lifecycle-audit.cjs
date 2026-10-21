/* R64 independent lifecycle audit: ZIP -> file:// -> import -> save -> freeze -> edit -> reload -> relocate.
 * Uses a Node-backed File System Access shim only because CI cannot automate a native OS directory picker.
 * Its passed checks must NOT be reported as a Windows native picker/permissions test. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
const {pathToFileURL}=require('url');
module.exports=async function runLifecycleAudit({browser,out,root}){
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
   buffer:Buffer.from('姓名,日期,时间,进出\n审计甲,2027-03-10,08:20:00,进\n审计甲,2027-03-10,11:45:00,出\n审计甲,2027-03-10,13:25:00,进\n审计甲,2027-03-10,17:40:00,出\n','utf8')});
  await page.waitForSelector('.r62-overlay',{timeout:20000});
  await page.locator('#r62Validate').click();
  await page.locator('#r62Commit').click();
  await page.waitForFunction(()=>state.records.length===4&&EMPLOYEES.some(e=>e.name==='审计甲'),null,{timeout:45000});
  report.importedRows=await page.evaluate(()=>state.records.length);
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
  await page.evaluate(()=>freezeSnapshot());
  const snRoot=path.join(diskRoot,'data','2027','03','snapshots');
  const folders=fs.readdirSync(snRoot);
  if(folders.length!==1)throw Error('R64 snapshot was not written');
  const frozen=JSON.parse(fs.readFileSync(path.join(snRoot,folders[0],'snapshot.json'),'utf8'));
  report.snapshotBeforeEdit=frozen.working.manualStatuses;
  await page.evaluate(()=>{
   const e=EMPLOYEES.find(e=>e.name==='审计甲');
   state.workspaceMode='person';state.selection={type:'cell',employeeId:e.id,day:10};
   state.chartTab='timeline';setManualStatusForCurrent('absent');
  });
  await page.evaluate(()=>saveWorking());
  const amended=JSON.parse(fs.readFileSync(wpath,'utf8'));
  report.manualAfterEdit=amended.manualStatuses;
  report.previousSaved=fs.existsSync(path.join(diskRoot,'data','2027','03','working','state.previous.json'));
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
  report.oldBundledRulesDoNotMatchRuntime=!(Object.hasOwn(originalConfig,'amStart')&&Object.hasOwn(originalConfig,'pmStart'));
  report.oldBundledRosterStillSample=JSON.parse(fs.readFileSync(path.join(diskRoot,'config','employees.json'),'utf8')).employees.length!==
   JSON.parse(fs.readFileSync(path.join(diskRoot,'data','2027','03','working','state.json'),'utf8')).employees.length;

  // R65 actual clean-install and project health/recovery workflow.
  const fresh=path.join(tmp,'fresh-install','考勤');fs.mkdirSync(fresh,{recursive:true});
  for(const name of ['index.html','src','README.md'])
   fs.cpSync(path.join(root,name),path.join(fresh,name),{recursive:true});
  const cleanZip=path.join(out,'P109-考勤-R65-首次初始化.zip');
  const packed=cp.spawnSync('python3',['-c',zipScript,fresh,cleanZip],{encoding:'utf8'});
  if(packed.status!==0)throw Error('R65 packaging '+packed.stderr);
  diskRoot=fresh;
  await open();
  await page.waitForSelector('#p109CreateBlank');
  report.initializationPrompt=await page.evaluate(()=>!state.projectDir&&!!p109PendingDirectory);
  await page.locator('#p109CreateBlank').click();
  await page.waitForFunction(()=>state.saved&&!state.isDemo&&EMPLOYEES.length===0&&!!state.projectDir,{timeout:45000});
  report.blankProjectCreated=fs.existsSync(path.join(fresh,'project.json'))&&
   JSON.parse(fs.readFileSync(path.join(fresh,'config','employees.json'),'utf8')).employees.length===0;
  await page.locator('#attendanceInput').setInputFiles({name:'审核门禁.csv',mimeType:'text/csv',
   buffer:Buffer.from('姓名,日期,时间,进出\n测试甲,2026-10-08,08:20,进\n测试甲,2026-10-08,18:00,出')});
  await page.waitForSelector('#r65SaveTemplate');
  await page.locator('#r65SaveTemplate').check();
  await page.locator('#r62Validate').click();await page.locator('#r62Commit').click();
  await page.waitForFunction(()=>state.records.length===2&&EMPLOYEES.length===1);
  await page.evaluate(()=>saveWorking());
  report.importTemplateStored=await page.evaluate(()=>!!state.importProfile.templates?.attendance);
  report.healthAfterImport=await page.evaluate(async()=>{
   const a=await p109AuditProject();
   return a.months.some(m=>m.key==='2026-10'&&m.imports===1&&m.raw===1)&&
    !a.issues.some(x=>x.level==='critical')&&a.verifiedRaw===1;
  });
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
   await p109PinDefaults('roster');await p109PinDefaults('import');
   switchMonth(2026,11,true);
  });
  report.pinnedForNextMonth=await page.evaluate(()=>state.projectProfile?.pinRoster&&
   state.projectProfile.pinImport&&EMPLOYEES.length===1&&!!state.importProfile.templates?.attendance);
  if(await page.locator('#p109ProjectClose').count())await page.locator('#p109ProjectClose').click();
  await page.locator('#p109ProjectControl').click();
  await page.waitForSelector('#p109Backup');
  const download=page.waitForEvent('download',{timeout:60000});
  await page.locator('#p109Backup').click();
  const outZip=path.join(tmp,'working-backup.zip');await (await download).saveAs(outZip);
  report.backupZipValid=cp.spawnSync('python3',['-m','zipfile','-t',outZip],{encoding:'utf8'}).status===0;
  const restoreDir=path.join(tmp,'restored','考勤');fs.mkdirSync(restoreDir,{recursive:true});
  diskRoot=restoreDir;
  const choose=page.waitForEvent('filechooser',{timeout:30000});
  await page.locator('#p109RestoreZip').click();
  await (await choose).setFiles({name:'restore.zip',mimeType:'application/zip',buffer:fs.readFileSync(outZip)});
  await page.waitForFunction(()=>document.querySelector('.toast')?.textContent.includes('恢复完成'),null,{timeout:60000});
  report.zipRestoreRaw=fs.existsSync(path.join(restoreDir,'data','2026','10','raw','attendance',impName,'审核门禁.csv'));
  await open();
  report.zipRestoreWorking=await page.evaluate(()=>YEAR===2026&&MONTH===10&&state.records.length===2&&
   EMPLOYEES.some(x=>x.name==='测试甲'));
  if(Object.entries(report).some(([k,v])=>[
   'initializationPrompt','blankProjectCreated','importTemplateStored','healthAfterImport',
   'rawCorruptionDetected','missingIndexDetected','safeIndexFixed','pinnedForNextMonth',
   'backupZipValid','zipRestoreRaw','zipRestoreWorking'].includes(k)&&!v))
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
