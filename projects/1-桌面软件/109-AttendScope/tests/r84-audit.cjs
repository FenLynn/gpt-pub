/* Upgrade acceptance uses real browser OPFS streams and IndexedDB handles.
 * External Windows picker/permission dialogs are not simulated as verified. */
'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),cp=require('child_process'),assert=require('assert/strict');
module.exports=async({browser,out,root})=>{
 root=path.resolve(root);
 const report={revision:'R84',nativeStreams:true,externalPickerVerified:false,checks:[]},errors=[];
 const check=(v,label)=>{assert(v,label);report.checks.push(label)};
 const zip=path.join(out,'P109-R84-upgrade.zip'),pack=cp.spawnSync('python3',[path.join(root,'tools/package-release.py'),root,zip],{encoding:'utf8'});
 if(pack.status!==0)throw Error(pack.stderr);
 const previous='ef254f113a4e2e7a17b80b7daea6cbda4f402f5f';
 const old=cp.spawnSync('git',['-C',root,'show',previous+':projects/1-桌面软件/109-AttendScope/src/app/00-state.js'],{encoding:'utf8',maxBuffer:1024*1024});
 if(old.status!==0)throw Error('Exact R83 source unavailable');
 const server=http.createServer((req,res)=>{
  const p=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!p.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(p)]||'application/octet-stream');res.end(fs.readFileSync(p))}catch(_){res.writeHead(404);res.end()}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');await page.evaluate(()=>p109RecentReady);await page.locator('#r80Demo').click();
  check(await page.locator('#importPopover #upgradeProjectBtn').count()===1&&await page.locator('#projectMenu #upgradeProjectBtn').count()===0,'one upgrade entry belongs to the top-right Import menu and works before connecting data');
  check(await page.evaluate(()=>p109CompareVersion('1.0.0','1.0.0-rc.9')>0&&p109CompareVersion('1.0.0-rc.10','1.0.0-rc.2')>0&&p109CompareVersion('1.0.0-preview','1.0.0-alpha')>0&&p109CompareVersion('1.0.0+build.2','1.0.0+build.1')===0&&p109CompareVersion('1.2.3junk','1.2.3')===null&&p109CompareVersion('1.2.3-01','1.2.3')===null),'strict semantic versions handle prerelease order, build metadata and malformed versions');
  check(await page.evaluate(()=>{
   const records=state.records,box=document.createElement('div');box.id='timelineEvidence';document.body.appendChild(box);
   const text='<img src=x onerror="window.__r84Injected=true">';state.records=[{recordId:'r84-text',name:text,time:text,direction:text,row:text,source:text}];
   try{showRecord('r84-text');return !box.querySelector('img')&&box.textContent.includes(text)&&!window.__r84Injected}finally{state.records=records;box.remove()}
  }),'record evidence renders imported names, times and row labels as inert text');
  await page.evaluate(async({bytes,old})=>{
   window.__updateFile=new File([Uint8Array.from(bytes)],'P109-upgrade.zip');
   const base=await (await navigator.storage.getDirectory()).getDirectoryHandle('r84-'+crypto.randomUUID(),{create:true});
   window.__runtime=await base.getDirectoryHandle('程序 中文 (1)',{create:true});window.__data=await base.getDirectoryHandle('数据 中文 (2)',{create:true});
   const app=await (await __runtime.getDirectoryHandle('src',{create:true})).getDirectoryHandle('app',{create:true});
   await writeFile(__runtime,'index.html','<!doctype html><title>Exact R83 version fixture</title>');await writeFile(app,'00-state.js',old);await writeFile(app,'43-project-control.js','// P109 R83 fixture');
   await p109InitializeProject(__data);await saveWorking();
   window.__before=await (await (await (await (await __data.getDirectoryHandle('data')).getDirectoryHandle('2026')).getDirectoryHandle('10')).getDirectoryHandle('working')).getFileHandle('state.json').then(h=>h.getFile()).then(f=>f.text());
   window.__oldVersion=old;
  },{bytes:[...fs.readFileSync(zip)],old:old.stdout});
  const invalid=await page.evaluate(async()=>{
   const items=await p109ZipRead(__updateFile),td=new TextDecoder(),te=new TextEncoder();
   const make=mutate=>{const rows=items.map(f=>({...f,data:f.data.slice()})),mf=rows.find(f=>f.name==='p109-release-manifest.json'),m=JSON.parse(td.decode(mf.data));mutate(rows,m);mf.data=te.encode(JSON.stringify(m));return new File([XLSX.writeArchive(rows)],'bad.zip')};
   const results={};
   const reject=async(name,file)=>{try{await p109InspectUpdate(file);results[name]=false}catch(_){results[name]=true}};
   await reject('downgrade',make((rows,m)=>m.appVersion='0.1.0'));
   await reject('foreign',make((rows,m)=>m.projectId='AnotherProduct'));
   await reject('schema',make((rows,m)=>m.supportedDataSchemas=[99]));
   await reject('updater',make((rows,m)=>m.minimumUpdaterVersion='99.0.0'));
   await reject('format',make((rows,m)=>m.updateFormat=99));
   await reject('corrupt',make(rows=>rows.find(f=>f.name==='index.html').data[0]^=1));
   await reject('missing',make((rows,m)=>{const name='src/css/r83.css';rows.splice(rows.findIndex(f=>f.name===name),1);m.files=m.files.filter(f=>f.path!==name)}));
   await reject('dataPath',make((rows,m)=>{rows.push({name:'data/secret.json',data:te.encode('{}')});m.files.push({path:'data/secret.json',bytes:2,sha256:'bad'})}));
   await reject('unsafePath',make(rows=>rows.push({name:'src/../data.json',data:te.encode('{}')})));
   const dirty={saved:false,isDemo:false};state.monthStores.set('2026-09',dirty);
   results.unsavedBackground=await p109ApplyCodeUpdate(__updateFile,{programRoot:__runtime,confirmed:true})===false;
   state.monthStores.delete('2026-09');return results;
  });for(const [name,v] of Object.entries(invalid))check(v,'reject before mutation: '+name);
  check(await page.evaluate(async()=>{
   const baseWrite=writeFile;let failed=false;window.__order=[];
   writeFile=async(handle,name,data)=>{__order.push(name);if(name==='00-state.js'&&!failed){failed=true;await baseWrite(handle,name,'partial write');throw Error('injected partial write failure')}return baseWrite(handle,name,data)};
   let ok;try{ok=await p109ApplyCodeUpdate(__updateFile,{programRoot:__runtime,confirmed:true})}finally{writeFile=baseWrite}
   const app=await (await __runtime.getDirectoryHandle('src')).getDirectoryHandle('app');
   return !ok&&failed&&(await (await app.getFileHandle('00-state.js')).getFile().then(f=>f.text()))===__oldVersion&&
    (await p109Json(__runtime,'p109-update-journal.json')).value.phase==='rolled-back'&&
    !await p109File(__runtime,'README.md')&&!await p109File(__runtime,'p109-release-manifest.json');
  }),'a partially written failing file is restored and new program files are removed');
  check(await page.evaluate(async()=>{
   const original=writeFile;window.__order=[];writeFile=async(h,n,d)=>{__order.push(n);return original(h,n,d)};
   let ok;try{ok=await p109ApplyCodeUpdate(__updateFile,{programRoot:__runtime,confirmed:true})}finally{writeFile=original}
   const mf=(await p109Json(__runtime,'p109-release-manifest.json')).value;
   for(const entry of mf.files){let dir=__runtime;const parts=entry.path.split('/'),name=parts.pop();for(const part of parts)dir=await dir.getDirectoryHandle(part);
    const data=new Uint8Array(await (await dir.getFileHandle(name)).getFile().then(f=>f.arrayBuffer()));if(await p109Hash(data)!==entry.sha256)return false;
   }
   const data=await (await (await (await (await __data.getDirectoryHandle('data')).getDirectoryHandle('2026')).getDirectoryHandle('10')).getDirectoryHandle('working')).getFileHandle('state.json').then(h=>h.getFile()).then(f=>f.text());
   return ok&&data===__before&&mf.appVersion===P109_APP_VERSION&&__order.at(-2)==='index.html'&&
    (await p109Json(__runtime,'p109-update-journal.json')).value.phase==='complete';
  }),'exact R83 version fixture updates to current files, updates its manifest, writes entry last and preserves working bytes');
  check(await page.evaluate(async()=>{
   const j=(await p109Json(__runtime,'p109-update-journal.json')).value;await writeFile(__runtime,'p109-update-journal.json',JSON.stringify({...j,phase:'writing'}));
   const ok=await p109RecoverUpdate(__runtime),app=await (await __runtime.getDirectoryHandle('src')).getDirectoryHandle('app');
   return ok&&(await (await app.getFileHandle('00-state.js')).getFile().then(f=>f.text()))===__oldVersion;
  }),'interrupted transaction is recovered from its hash-verified durable backup');
  // Install current again, then exercise the actual file chooser, directory step and wizard.
  check(await page.evaluate(()=>p109ApplyCodeUpdate(__updateFile,{programRoot:__runtime,confirmed:true})),'reinstall after recovery');
  await page.evaluate(()=>p109RememberProgram({name:'invalid remembered folder',kind:'directory'}));
  await page.locator('#importBtn').click();const chooser=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();await (await chooser).setFiles(zip);
  await page.waitForFunction(()=>document.querySelector('#p109UpdateVersion')?.textContent.includes(P109_APP_VERSION));
  check(await page.locator('#p109UpdateInstall').isDisabled(),'wizard requires explicit program-folder authorization on first use');
  await page.evaluate(()=>p109ReadProgram());
  check(await page.locator('#p109UpdateChoose').isEnabled(),'an unusable remembered directory never disables fresh folder authorization');
  await page.evaluate(()=>{window.showDirectoryPicker=async()=>__runtime});await page.locator('#p109UpdateChoose').click();await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall').disabled);
  for(const [width,height] of [[1280,720],[1366,768],[1920,1080]]){await page.setViewportSize({width,height});check(await page.locator('.p109-update-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.width/innerWidth>.8&&r.top>=0&&r.bottom<=innerHeight}),'upgrade dialog fits viewport and exceeds 80% width: '+width)}
  await page.setViewportSize({width:1366,height:768});await page.screenshot({path:path.join(out,'r84-upgrade-ready.png')});
  await page.locator('#p109UpdateClose').focus();await page.keyboard.press('Shift+Tab');check(await page.locator('#p109UpdateInstall').evaluate(e=>e===document.activeElement),'wizard traps keyboard focus');
  await page.locator('#p109UpdateInstall').click();await page.waitForFunction(()=>document.getElementById('p109UpdateInstall')?.dataset.reload==='1',null,{timeout:60000});
  check((await page.locator('#p109UpdateStatus').textContent()).includes('更新成功'),'one install action automatically backs up, writes and verifies all files');
  await page.screenshot({path:path.join(out,'r84-upgrade-complete.png')});
  const beforeUrl=page.url();await page.locator('#p109UpdateInstall').click();
  check(await page.locator('#p109UpdateOverlay').count()===0&&page.url()===beforeUrl,'web completion closes the local upgrade wizard without claiming to update the hosted site');
  await page.reload();await page.evaluate(()=>p109RecentReady);
  check(await page.evaluate(()=>!!state.projectDir&&state.saved),'an explicit hosted-page reload restores the saved project independently of local code updates');
  await page.locator('#importBtn').click();const again=page.waitForEvent('filechooser');await page.locator('#upgradeProjectBtn').click();await (await again).setFiles(zip);
  await page.waitForFunction(()=>!document.getElementById('p109UpdateInstall')?.disabled);
  check((await page.locator('#p109UpdateDirectory').textContent()).includes('程序 中文 (1)'),'authorized native program handle is remembered in IndexedDB');
  await page.keyboard.press('Escape');check(await page.locator('#p109UpdateOverlay').count()===0,'Escape closes wizard without changing business data');
  check(!errors.length,'no browser script exceptions');
  fs.writeFileSync(path.join(out,'r84-audit.json'),JSON.stringify(report,null,2));console.log('P109_R84_AUDIT_PASS '+JSON.stringify(report));
 }finally{await context.close();await new Promise(r=>server.close(r))}
};
