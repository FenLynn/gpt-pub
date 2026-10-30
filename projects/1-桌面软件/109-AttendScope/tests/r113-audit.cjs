'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
module.exports=async({browser,root,out})=>{
 const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[],checks={};
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const check=(ok,name)=>{checks[name]=!!ok;assert(ok,'R113: '+name)};
 try{
  await page.goto(pathToFileURL(path.join(root,'index.html')).href);await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  const morning=await page.evaluate(async()=>{
   p109BlankWork();YEAR=2026;MONTH=10;const e={id:personIdentity('上午边界核查'),name:'上午边界核查'},date='2026-10-08';EMPLOYEES=[e];
   const base=[['08:50:00','进'],['11:40:00','出'],['13:30:00','进'],['17:10:00','出']],night=[['00:10:00','进'],['00:30:00','出']],checks={},
    run=(events,options={})=>{
     Object.assign(RULES,P109_DEFAULT_RULES,options.rules||{});Object.assign(state,{records:events.map(([time,direction],i)=>({employeeId:e.id,name:e.name,recordId:'r113:'+i,datetime:time.length>10?time:date+' '+time,time:time.slice(-8),direction})),
      leaves:(options.leaves||[]).map(([start,end],i)=>({id:'leave:'+i,employeeId:e.id,date,start,end})),trips:options.trip?[{id:'trip',employeeId:e.id,startDate:date,endDate:date}]:[],outings:(options.outings||[]).map(([start,end],i)=>({id:'outing:'+i,employeeId:e.id,startDate:date,endDate:date,start,end})),
      overtimeEntries:[],manualTempOutings:[],manualOvertime:[],attendanceReview:{},tempOutingReview:{},overtimeReview:{},manualStatuses:{},monthStores:new Map(),calendarOverrides:{[date]:'work'},snapshotContext:false,activeBranch:null,imports:[],revisions:[],revisionSeq:0,prefs:{},saved:false});reanalyze();return state.analysis.get(e.id+'|8');
    },late=a=>a.attendanceFlags.some(f=>f.label==='迟到'),missing=a=>a.issues.some(s=>s.includes('上午缺少完整出勤证据'));
   let a=run(base);checks.lateBaseline=late(a);
   a=run([...night,...base]);checks.completedNightDoesNotMaskLate=late(a)&&a.attendanceFlags.some(f=>f.time==='08:50:00');checks.wholeDayFirstInUnchanged=a.firstIn==='00:10:00';
   const raw=JSON.stringify(state.records),presence=a.presence,work=a.workMinutes,outs=JSON.stringify(a.temporaryOutings);
   RULES.morningEvidenceRuleVersion=1;reanalyze();const old=state.analysis.get(e.id+'|8');checks.onlyJudgmentChanges=JSON.stringify(state.records)===raw&&old.presence===presence&&old.workMinutes===work&&JSON.stringify(old.temporaryOutings)===outs&&!late(old);
   a=run([...night,...base.slice(2)]);checks.nightDoesNotMaskMissingMorning=missing(a)&&a.severity==='suspect';
   a=run(night);checks.nightOnlyNeedsMorningReview=missing(a);
   a=run([['08:00:00','进'],['08:10:00','出'],...base]);checks.completedPreShiftVisitDoesNotMaskLate=late(a);
   a=run([['00:10:00','进'],['11:40:00','出'],...base.slice(2)]);checks.realOvernightCoverValid=!late(a)&&!missing(a);
   a=run([['2026-10-07 23:50:00','进'],['11:40:00','出'],...base.slice(2)]);checks.previousDayCoverValid=!late(a)&&!missing(a);
   a=run([['08:20:00','进'],['08:50:00','进'],...base.slice(1)]);checks.unclosedEarlyEvidenceNotDiscarded=!late(a)&&a.issues.some(s=>s.includes('连续进'));
   a=run([...night,...base],{trip:true});checks.tripPriorityPreserved=!late(a)&&!missing(a)&&a.severity==='excused';
   a=run([...night,...base],{leaves:[['08:30','08:50']]});checks.leavePriorityPreserved=!late(a);
   a=run([...night,...base],{outings:[['08:30','08:50']]});checks.outingPriorityPreserved=!late(a);
   a=run([...night,...base],{leaves:[['08:30','08:40']]});checks.leaveReturnStillTemporaryOnly=!late(a)&&a.temporaryOutings.some(r=>Math.abs(r.minutes-10)<1e-8&&r.status==='green');
   a=run([...night,['08:35:00','进'],...base.slice(1)]);checks.graceBoundaryPreserved=!late(a);
   a=run([...night,['08:35:01','进'],...base.slice(1)]);checks.graceSecondAfterBoundary=late(a);
   a=run([...night,...base]);state.manualStatuses[e.id+'|8']='normal';reanalyze();a=state.analysis.get(e.id+'|8');checks.manualNormalStillOverrides=attendanceJudgment(a)==='normal'&&!attendanceHasLateEarly(a);
   const rules={...P109_DEFAULT_RULES};delete rules.morningEvidenceRuleVersion;
   const payload={schemaVersion:14,year:2026,month:10,records:[],rules},live=normalizeSavedMonth(payload),frozen=normalizeSavedMonth(payload,true);
   checks.workingMigrates=live.rules.morningEvidenceRuleVersion===2&&!live.saved;checks.frozenKeepsLegacy=frozen.rules.morningEvidenceRuleVersion===1;
   checks.invalidRuleRejected=!p109ValidOvertimeRules({...P109_DEFAULT_RULES,morningEvidenceRuleVersion:3});
   run([...night,...base]);state.projectDir=p109MemoryRoot('边界核查');await saveWorking();const bytes=(await p109CacheRead()).bytes,expected=JSON.stringify(state.records);
   state.projectDir=null;const ok=await p109OpenPortableFile(new File([bytes],'roundtrip.zip'));
   checks.zipPreservesRulesAndRaw=ok&&RULES.morningEvidenceRuleVersion===2&&JSON.stringify(state.records)===expected&&late(state.analysis.get(e.id+'|8'));
   state.workspaceMode='person';state.selection={type:'cell',employeeId:e.id,day:8};state.chartDay=8;state.chartTab='timeline';render();
   return {checks,flags:state.analysis.get(e.id+'|8').attendanceFlags.map(f=>({label:f.label,time:f.time}))};
  });for(const [name,ok] of Object.entries(morning.checks))check(ok,name);
  await page.screenshot({path:path.join(out,'r113-morning.png')});
  const cache=await page.evaluate(async()=>{
   const good=await p109CacheRead(),checks={},put=async(current,previous)=>{
    const db=await p109CacheOpen();try{await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite'),s=tx.objectStore('snapshots');if(current)s.put(current,'current');else s.delete('current');if(previous)s.put(previous,'previous');else s.delete('previous');tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error)})}finally{db.close()}
   },reset=()=>{p109BlankWork();state.projectDir=null;state.monthStores=new Map();state.saved=true},
    rows=await p109ZipRead(new File([good.bytes],'good.zip')),td=new TextDecoder(),te=new TextEncoder(),
    project=rows.find(r=>r.name==='project.json'),meta=JSON.parse(td.decode(project.data));meta.months=['not-a-month'];project.data=te.encode(JSON.stringify(meta));
   const mf=rows.find(r=>r.name==='p109-backup-manifest.json'),manifest=JSON.parse(td.decode(mf.data));
   for(const row of rows.filter(r=>r!==mf)){const ref=manifest.files.find(f=>f.path===row.name);ref.bytes=row.data.byteLength;ref.sha256=await p109Hash(row.data)}
   mf.data=te.encode(JSON.stringify(manifest));const bytes=P109_TABLES.writeArchive(rows).buffer,bad={...good,token:'broken-structure',bytes,sha256:await p109Hash(new Uint8Array(bytes))};
   await put(bad,good);reset();checks.structureInvalidRecoversPrevious=await p109RestoreLocalCache();
   checks.recoveryDirtyAndTraceable=state.projectDir?.pending&&!state.saved&&state.projectDir.cacheToken===bad.token&&state.projectDir.cacheRejectedToken===bad.token&&state.records.length===6;
   checks.failedCandidateNotOverwritten=(await p109CacheRead()).token===bad.token;
   checks.saveRecoveredSucceeds=await saveWorking();checks.goodPreviousSurvivesSave=(await p109CacheRead('previous')).token===good.token;
   const saved=await p109CacheRead();reset();checks.reopenRecoveredCurrent=await p109RestoreLocalCache()&&state.records.length===6&&state.saved;
   await put({...bad,bytes:new ArrayBuffer(3)},good);reset();checks.hashInvalidStillRecovers=await p109RestoreLocalCache()&&state.projectDir.pending;
   await put(bad,{...good,id:'another-project'});reset();checks.otherProjectNotSilentlyRestored=!await p109RestoreLocalCache()&&!state.projectDir;
   await put(bad,bad);reset();checks.bothInvalidLeaveCacheIntact=!await p109RestoreLocalCache()&&!state.projectDir&&(await p109CacheRead('previous')).token===bad.token;
   await put({...bad,appVersion:'99.0.0'},good);reset();checks.newerCacheNotSilentlyRolledBack=!await p109RestoreLocalCache()&&!state.projectDir;
   await put({...good,schemaVersion:2},good);reset();checks.newerCacheFormatNotSilentlyRolledBack=!await p109RestoreLocalCache()&&!state.projectDir;
   await put(saved,good);reset();checks.cancelledRestoreNoMutation=!await p109RestoreLocalCache(()=>false)&&!state.projectDir;
   const baseRead=p109ReadProject;let active=true;
   p109ReadProject=async(...args)=>{const result=await baseRead(...args);active=false;return result};
   try{checks.cancelledAfterReadNoMutation=!await p109RestoreLocalCache(()=>active)&&!state.projectDir}finally{p109ReadProject=baseRead}
   checks.finalRestore=await p109RestoreLocalCache();return checks;
  });for(const [name,ok] of Object.entries(cache))check(ok,name);
  const files=[];for(const name of ['index.html','README.md',...walk(path.join(root,'src')).map(p=>'src/'+p)])files.push({name,bytes:[...fs.readFileSync(path.join(root,name))]});
  await page.evaluate(async files=>{
   const rows=files.map(f=>({name:f.name,data:Uint8Array.from(f.bytes)})),manifest={schemaVersion:1,projectId:'P109-AttendScope',appVersion:P109_APP_VERSION,updateFormat:1,minimumUpdaterVersion:'0.2.8-preview',supportedDataSchemas:Array.from({length:P109_DATA_SCHEMA},(_,i)=>i+1),files:[]};
   for(const r of rows)manifest.files.push({path:r.name,bytes:r.data.byteLength,sha256:await p109Hash(r.data)});
   rows.push({name:'p109-release-manifest.json',data:new TextEncoder().encode(JSON.stringify(manifest))});window.__r113Bundle=new File([P109_TABLES.writeArchive(rows)],'upgrade.zip');
   window.showDirectoryPicker=undefined;await p109ShowUpdate(__r113Bundle);
  },files);
  check(await page.locator('#p109UpdateManual').isVisible(),'manualUpgradeVisible');
  check(!await page.locator('#p109UpdateChoose').isVisible()&&!await page.locator('#p109UpdateInstall').isVisible(),'unsupportedActionsHidden');
  check((await page.locator('#p109UpdateStatus').innerText()).includes('校验通过'),'manualUpgradeStillValidated');
  check((await page.locator('#p109UpdateManual').innerText()).includes('新文件夹'),'manualUpgradeInstructionsComplete');
  await page.screenshot({path:path.join(out,'r113-manual-upgrade.png')});
  const download=page.waitForEvent('download');await page.locator('#p109UpdateBackup').click();const backup=await download;
  await backup.saveAs(path.join(out,'r113-upgrade-data-backup.zip'));check(fs.statSync(path.join(out,'r113-upgrade-data-backup.zip')).size>1000,'manualUpgradeBackupDownload');
  await page.locator('#p109TransferClose').click();
  check(await page.evaluate(()=>state.records.length===6),'backupDoesNotChangeRaw');
  check(await page.evaluate(async()=>{
   const rows=await p109ZipRead(__r113Bundle);rows.find(r=>r.name==='index.html').data[0]^=1;await p109ShowUpdate(new File([P109_TABLES.writeArchive(rows)],'bad.zip'));return document.querySelector('#p109UpdateManual').hidden&&document.querySelector('#p109UpdateInstall').disabled;
  }),'invalidUpgradeCannotUseFallback');
  await page.locator('#p109UpdateClose').click();
  await page.evaluate(async()=>{window.showDirectoryPicker=async()=>{throw new DOMException('denied','NotAllowedError')};await p109ShowUpdate(__r113Bundle)});
  await page.locator('#p109UpdateChoose').click();check(await page.locator('#p109UpdateManual').isVisible(),'deniedWriteShowsManualFallback');
  check(!(await page.locator('#p109UpdateStatus').innerText()).includes('denied'),'permissionFallbackHasReadableExplanation');
  await page.evaluate(async()=>{
   const root=p109MemoryRoot('程序'),rows=await p109ZipRead(__r113Bundle);for(const row of rows)await p109PortablePut(root,row.name,row.data);window.showDirectoryPicker=async()=>root;
  });await page.locator('#p109UpdateChoose').click();await page.waitForFunction(()=>document.querySelector('#p109UpdateManual').hidden&&!document.querySelector('#p109UpdateInstall').disabled);
  check(!await page.locator('#p109UpdateManual').isVisible()&&await page.locator('#p109UpdateInstall').isEnabled(),'authorizedRetryRestoresNormalUpgrade');
  await page.locator('#p109UpdateClose').click();check(await page.evaluate(()=>state.records.length===6),'cancelUpgradeKeepsData');
  check(!errors.length,'noRuntimeErrors');
  fs.writeFileSync(path.join(out,'r113-audit.json'),JSON.stringify({checks,morning,errors},null,2));console.log('P109_R113_AUDIT_PASS '+JSON.stringify({checks:Object.keys(checks).length}));
 }finally{await context.close()}
};
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)).map(p=>e.name+'/'+p):[e.name])}
