/* R67: offline code-only upgrade. Never rewrite data, config, snapshots or original imports. */
'use strict';
function p109Semver(version){
 const m=String(version||'').match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
 if(!m||m.slice(1,4).some(x=>!Number.isSafeInteger(Number(x)))||m[4]?.split('.').some(x=>/^0\d+$/.test(x)))return null;
 return [...m.slice(1,4).map(Number),m[4]||''];
}
function p109CompareVersion(a,b){
 const x=p109Semver(a),y=p109Semver(b);if(!x||!y)return null;
 for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];
 if(x[3]===y[3])return 0;if(!x[3])return 1;if(!y[3])return -1;
 const l=x[3].split('.'),r=y[3].split('.');
 for(let i=0;i<Math.max(l.length,r.length);i++){
  if(l[i]===undefined)return -1;if(r[i]===undefined)return 1;if(l[i]===r[i])continue;
  const ln=/^\d+$/.test(l[i]),rn=/^\d+$/.test(r[i]);
  if(ln&&rn)return l[i].length===r[i].length?(l[i]>r[i]?1:-1):(l[i].length>r[i].length?1:-1);
  if(ln!==rn)return ln?-1:1;return l[i]>r[i]?1:-1;
 }
 return 0;
}
async function p109UpgradePick(){
 if(p109ProjectBusy||p109ConnectionBusy||state.storageBusy||state.importCommitting||r62ImportDraft){toast('请等待当前文件操作完成',true);return}
 if(!p109Environment().directory){p109ShowStorageFallback('当前环境无法原地升级。先下载项目包，再完整解压新版程序到新文件夹，打开新版并载入项目包');return}
 document.getElementById('importPopover')?.classList.remove('open');document.getElementById('importBtn')?.setAttribute('aria-expanded','false');
 const chooser=document.createElement('input');chooser.type='file';chooser.accept='.zip,application/zip';
 chooser.onchange=async()=>{
  const file=chooser.files?.[0];if(file)await p109ShowUpdate(file);
 };
 chooser.click();
}
async function p109ApplyCodeUpdate(file,options={}){
 if(p109ProjectBusy||p109ConnectionBusy||state.storageBusy||state.importCommitting||r62ImportDraft)return false;
 if(p109UnsavedMonths().length){p109Status('更新前请保存所有未保存月份：'+p109UnsavedMonths().join('、'),true);return false}
 p109ProjectBusy=true;
 try{
  const programRoot=options.programRoot||state.projectDir;
  if(!programRoot)throw Error('请先授权程序文件夹');
  await p109RequireWriteAccess(programRoot,true);
  if(state.projectDir)await p109RequireWriteAccess(state.projectDir,true);
  const manifest=await p109InspectUpdate(file),items=await p109ZipRead(file);
  const manifestFile=items.find(x=>x.name==='p109-release-manifest.json');
  const root=state.projectDir||programRoot,meta=state.projectDir?await p109Json(root,'project.json'):null;
  if(meta&&meta.value?.projectId!=='P109-AttendScope')throw Error('目录不是已初始化的考勤项目');
  if(!manifest.supportedDataSchemas.includes(meta?Number(meta.value.schemaVersion):P109_DATA_SCHEMA))
   throw Error('更新版本不支持项目当前数据结构；必须先进行数据迁移');
  const home=await p109File(programRoot,'index.html'),src=await p109Child(programRoot,'src'),app=src&&await p109Child(src,'app'),versionFile=app&&await p109File(app,'00-state.js');
  if(!home||!src||!versionFile||!await p109File(app,'43-project-control.js')||
    !(await (await versionFile.getFile()).text()).includes('P109_APP_VERSION'))
   throw Error('请选择已有的 P109 程序目录，不能选择数据目录或其他软件目录');
  const versionSource=await (await versionFile.getFile()).text(),installed=/const P109_APP_VERSION='([^']+)'/.exec(versionSource)?.[1];
  if(p109CompareVersion(manifest.appVersion,installed)===null||p109CompareVersion(manifest.appVersion,installed)<0)throw Error('所选程序文件夹已安装更新版本或版本无法识别');
  const upgrades=items.filter(x=>x!==manifestFile);
  if(!options.confirmed&&!window.confirm('准备安装 '+manifest.appVersion+'。先备份并核验，然后仅替换程序。请确认安装包来自可信来源。继续？'))return false;
  if(await p109RecoverUpdate(programRoot))throw Error('检测到上次更新中断，已恢复旧程序；请重新打开程序后再升级');
  await p109RememberProgram(programRoot);
  options.onProgress?.('正在创建并核验升级前备份…');
  // Archive is written on disk BEFORE any application file is replaced.
  const files=[],limits={count:0,bytes:0};
  await p109ArchiveWalk(root,'',files,limits);
  const sameDirectory=programRoot===root||(!root.__p109Portable&&!!(await programRoot.isSameEntry?.(root)));
  const backupRoot=root.__p109Portable?programRoot:root;
  {
   for(const name of ['index.html','README.md','p109-release-manifest.json']){
    const h=await p109File(programRoot,name);if(!h)continue;
    const data=new Uint8Array(await (await h.getFile()).arrayBuffer());
    limits.count++;limits.bytes+=data.byteLength;
    if(limits.count>5000||limits.bytes>160*1024*1024)throw Error('升级前备份超过文件数量或大小上限');
    files.push({name:'program/'+name,data});
   }
   await p109ArchiveWalk(src,'program/src/',files,limits);
  }
  const {zip}=await p109ZipBuild(files);
  const archive=new Uint8Array(await zip.arrayBuffer()),backupHash=await p109Hash(archive),
   backupFolder=await dir(backupRoot,'backups'),
   backupName='pre-upgrade-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+p109UniqueId().slice(-8)+'.zip';
  if(await p109File(backupFolder,backupName))throw Error('备份文件已存在，禁止覆盖');
  await writeFile(backupFolder,backupName,archive);
  const persisted=await p109File(backupFolder,backupName);
  if(backupHash!==await p109Hash(new Uint8Array(await (await persisted.getFile()).arrayBuffer())))
   throw Error('升级前项目备份写盘校验失败，未更新任何程序文件');
  if(!sameDirectory&&backupRoot!==programRoot){const backup=await dir(programRoot,'backups');await writeFile(backup,backupName,archive);
   const saved=await p109File(backup,backupName);if(backupHash!==await p109Hash(new Uint8Array(await (await saved.getFile()).arrayBuffer())))throw Error('程序备份副本校验失败');
  }
  const ordered=[...upgrades.filter(f=>f.name!=='index.html'),manifestFile,upgrades.find(f=>f.name==='index.html')];
  const prior=[],completed=[];
  for(const f of ordered){
   const parts=f.name.split('/'),name=parts.pop();let folder=programRoot;
   for(const dirName of parts)folder=await dir(folder,dirName);
   const existing=await p109File(folder,name);
   prior.push({folder,name,path:f.name,exists:!!existing,
    data:existing?new Uint8Array(await (await existing.getFile()).arrayBuffer()):null});
  }
  const journal={schemaVersion:1,projectId:'P109-AttendScope',phase:'writing',from:installed,to:manifest.appVersion,backup:backupName,backupHash,
   prior:prior.map(({path,exists})=>({path,exists}))};
  await writeFile(programRoot,'p109-update-journal.json',JSON.stringify(journal));
  if(JSON.stringify((await p109Json(programRoot,'p109-update-journal.json')).value)!==JSON.stringify(journal))throw Error('恢复日志写盘校验失败');
  try{
   for(let i=0;i<ordered.length;i++){
    const f=ordered[i],dest=prior[i];
    options.onProgress?.('正在更新并核验 '+(i+1)+' / '+ordered.length);
    // Include the attempted file even if write/close itself throws.
    completed.push(dest);
    await writeFile(dest.folder,dest.name,f.data);
    const actual=await p109File(dest.folder,dest.name);
    if((await p109Hash(new Uint8Array(await (await actual.getFile()).arrayBuffer())))!==await p109Hash(f.data))
     throw Error('更新后校验失败：'+f.name);
   }
   await writeFile(programRoot,'p109-update-journal.json',JSON.stringify({...journal,phase:'complete'}));
  }catch(e){
   let rollbackErrors=0;
   for(const dest of [...completed].reverse()){
    try{
     if(dest.exists){await writeFile(dest.folder,dest.name,dest.data);const f=await p109File(dest.folder,dest.name);
      if(await p109Hash(new Uint8Array(await (await f.getFile()).arrayBuffer()))!==await p109Hash(dest.data))throw Error('恢复校验失败');
     }else if(await p109File(dest.folder,dest.name))await dest.folder.removeEntry(dest.name);
    }catch(_){rollbackErrors++}
   }
   if(!rollbackErrors)await writeFile(programRoot,'p109-update-journal.json',JSON.stringify({...journal,phase:'rolled-back'}));
   throw Error('更新失败：'+e.message+'；已尝试恢复旧程序文件'+
    (rollbackErrors?'，'+rollbackErrors+' 个文件需根据备份人工恢复':''));
  }
  p109Status('程序更新已写入，完整备份保留于 backups/'+backupName+'；请重新打开 index.html');
  return true;
 }catch(e){p109Status('更新中止：'+e.message,true);options.onError?.(e.message);return false}
 finally{p109ProjectBusy=false}
}

async function p109CheckUpdateContents(items,manifest){
 const files=new Map(items.map(f=>[f.name,f]));
 for(const name of ['index.html','src/app/00-state.js','src/app/43-project-control.js','src/app/44-upgrade.js','src/core/xlsx-lite.js'])
  if(!files.has(name))throw Error('升级包缺少关键文件：'+name);
 const source=new TextDecoder().decode(files.get('src/app/00-state.js').data);
 if(!source.includes("const P109_APP_VERSION='"+manifest.appVersion+"';"))throw Error('包内版本与清单不一致');
 const html=new DOMParser().parseFromString(new TextDecoder().decode(files.get('index.html').data),'text/html');
 for(const el of html.querySelectorAll('script[src],link[href],img[src]')){
  const ref=el.getAttribute('src')||el.getAttribute('href');
  if(!files.has(ref.replace(/^\.\//,'')))throw Error('入口引用缺失或不允许的资源：'+ref);
 }
}
async function p109InspectUpdate(file){
 if(file.size>45*1024*1024)throw Error('升级包超过 45 MB 上限');
 const items=await p109ZipRead(file),mf=items.find(f=>f.name==='p109-release-manifest.json');
 if(!mf)throw Error('请选择 P109 程序升级 ZIP，不是业务数据或项目备份');
 const m=JSON.parse(new TextDecoder().decode(mf.data)),compare=p109CompareVersion(m.appVersion,P109_APP_VERSION);
 if(m.projectId!=='P109-AttendScope'||m.schemaVersion!==1||!Array.isArray(m.files)||!Array.isArray(m.supportedDataSchemas)||!m.supportedDataSchemas.includes(P109_DATA_SCHEMA))throw Error('程序标识或数据格式不兼容');
 if(compare===null||compare<0)throw Error('禁止安装更旧或无法识别的版本');
 if(m.minimumUpdaterVersion&&(p109CompareVersion(P109_APP_VERSION,m.minimumUpdaterVersion)===null||p109CompareVersion(P109_APP_VERSION,m.minimumUpdaterVersion)<0))throw Error('此升级包需要更新的升级器，请先安装过渡版本 '+m.minimumUpdaterVersion);
 if(m.updateFormat!==undefined&&m.updateFormat!==1)throw Error('升级格式较新，请先更新升级器');
 if(items.length!==m.files.length+1||m.files.length>120||new Set(m.files.map(f=>f.path)).size!==m.files.length)throw Error('程序清单数量或路径不一致');
 for(const f of items.filter(f=>f!==mf)){
  if(!(f.name==='index.html'||f.name==='README.md'||/^src\/[a-zA-Z0-9_.\-/]+$/.test(f.name)))throw Error('禁止覆盖业务数据：'+f.name);
  const ref=m.files.find(x=>x.path===f.name);if(!ref||ref.bytes!==f.data.byteLength||ref.sha256!==await p109Hash(f.data))throw Error('哈希校验失败：'+f.name);
 }
 await p109CheckUpdateContents(items,m);return {...m,compare};
}
async function p109RememberProgram(root){
 try{const db=await p109RecentOpenDb();try{await new Promise((resolve,reject)=>{
  const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(root,'programRoot');
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 })}finally{db.close()}}catch(_){}
}
async function p109ReadProgram(){
 try{const db=await p109RecentOpenDb();try{return await new Promise((resolve,reject)=>{
  const req=db.transaction('settings','readonly').objectStore('settings').get('programRoot');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 })}finally{db.close()}}catch(_){return null}
}
async function p109RecoverUpdate(root){
 const log=await p109Json(root,'p109-update-journal.json');if(log.error)throw Error('恢复日志损坏，请从升级前备份恢复程序');
 const j=log.value;if(!j||j.phase!=='writing')return false;
 if(j.schemaVersion!==1||j.projectId!=='P109-AttendScope'||!/^pre-upgrade-[\w.-]+\.zip$/.test(j.backup)||!Array.isArray(j.prior))throw Error('恢复日志异常，请保留升级前备份');
 const backups=await p109Child(root,'backups'),h=backups&&await p109File(backups,j.backup);if(!h)throw Error('升级前备份缺失');
 const file=await h.getFile(),bytes=new Uint8Array(await file.arrayBuffer());if(await p109Hash(bytes)!==j.backupHash)throw Error('升级前备份校验失败');
 const files=new Map((await p109ZipRead(file)).map(f=>[f.name,f.data]));
 for(const item of [...j.prior].reverse()){
  if(!/^(?:index\.html|README\.md|p109-release-manifest\.json|src\/[a-zA-Z0-9_.\-/]+)$/.test(item.path)||item.path.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('恢复路径异常');
  const parts=item.path.split('/'),name=parts.pop();let folder=root;for(const part of parts)folder=await dir(folder,part);
  if(item.exists){const data=files.get('program/'+item.path);if(!data)throw Error('备份缺少 '+item.path);await writeFile(folder,name,data);
   const actual=await p109File(folder,name);if(await p109Hash(new Uint8Array(await (await actual.getFile()).arrayBuffer()))!==await p109Hash(data))throw Error('恢复后校验失败');
  }else if(await p109File(folder,name))await folder.removeEntry(name);
 }
 await writeFile(root,'p109-update-journal.json',JSON.stringify({...j,phase:'rolled-back'}));return true;
}
async function p109ShowUpdate(file){
 if(document.getElementById('p109UpdateOverlay'))return;
 const panel=document.createElement('section');panel.id='p109UpdateOverlay';panel.className='p109-recent-overlay';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','p109UpdateTitle');
 panel.innerHTML='<div class="p109-update-panel"><header><h2 id="p109UpdateTitle">程序升级</h2><button id="p109UpdateClose" aria-label="关闭升级">×</button></header><div class="p109-update-body"><p id="p109UpdateVersion"></p><p id="p109UpdateStatus" role="status" aria-live="polite">正在校验升级包…</p><ol><li>校验版本、完整文件与兼容性</li><li>自动备份、更新并逐项核验</li><li>完成后重新载入程序</li></ol><p id="p109UpdateDirectory">首次升级需授权包含 index.html 的程序文件夹。</p><button id="p109UpdateChoose">选择程序文件夹</button><p>项目数据保持原位。请使用可信来源的 P109 升级包。</p></div><footer><button id="p109UpdateCancel">取消</button><button class="primary-btn" id="p109UpdateInstall" disabled>校验中…</button></footer></div>';
 document.body.appendChild(panel);let running=false,programRoot=null,bundle=null;
 if(location.protocol!=='file:'){
  const note=document.createElement('p');note.className='p109-update-web-note';
  note.textContent='当前从网站运行。此向导只更新你授权的本地离线程序目录，不会更新网站。网站版本由部署者在 Cloudflare Pages 等托管平台重新部署；本地更新完成后请打开本地 index.html。';
  panel.querySelector('.p109-update-body').prepend(note);
 }
 const status=panel.querySelector('#p109UpdateStatus'),install=panel.querySelector('#p109UpdateInstall'),choose=panel.querySelector('#p109UpdateChoose');
 const close=()=>{if(running)return;if(install.dataset.reload&&location.protocol==='file:'){location.reload();return}panel.remove();document.getElementById('importBtn')?.focus()};
 panel.querySelector('#p109UpdateClose').onclick=close;panel.querySelector('#p109UpdateCancel').onclick=close;
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}else p109TrapDialogFocus(e,panel)});
 const refresh=()=>{const dirty=p109UnsavedMonths();install.disabled=!bundle||!programRoot||!!dirty.length;
  install.textContent=bundle?.compare===0?'修复当前版本':'开始升级';
  if(dirty.length)status.textContent='请先取消升级并保存这些月份：'+dirty.join('、');
 };
 const setRoot=async root=>{
  let recovered=false;if(p109ProjectBusy)throw Error('请等待当前文件操作完成');
  p109ProjectBusy=true;try{recovered=await p109RecoverUpdate(root)}finally{p109ProjectBusy=false}
  if(recovered){status.textContent='已从备份恢复上次中断的更新。请重新载入程序后再升级';install.disabled=false;install.textContent='重新载入';install.dataset.reload='1';return}
  const src=await p109Child(root,'src'),app=src&&await p109Child(src,'app'),f=app&&await p109File(app,'00-state.js');
  if(!f||!await p109File(root,'index.html'))throw Error('请选择包含 index.html 和 src 的程序文件夹');
  const version=/const P109_APP_VERSION='([^']+)'/.exec(await (await f.getFile()).text())?.[1];
  if(p109CompareVersion(version,P109_APP_VERSION)!==0)throw Error('文件夹版本与当前页面不同，请选择当前程序目录');
  programRoot=root;panel.querySelector('#p109UpdateDirectory').textContent='程序文件夹：'+root.name+' · '+version;choose.textContent='更换程序文件夹';await p109RememberProgram(root);refresh();
 };
 choose.onclick=async()=>{try{const root=await showDirectoryPicker({id:'p109-program-update',mode:'readwrite'});await p109RequireWriteAccess(root,true);await setRoot(root)}catch(e){if(e.name!=='AbortError')status.textContent=e.message+'。无法授权时，先下载确认项目包，再把新版完整解压到新文件夹继续。'}};
 install.onclick=async()=>{
  if(install.dataset.reload){close();return}if(running)return;running=true;panel.querySelectorAll('button').forEach(b=>b.disabled=true);
  const ok=await p109ApplyCodeUpdate(file,{programRoot,confirmed:true,onProgress:t=>status.textContent=t,onError:t=>status.textContent=t});
  running=false;panel.querySelector('#p109UpdateClose').disabled=false;panel.querySelector('#p109UpdateCancel').disabled=false;
  if(ok){install.disabled=false;install.textContent='完成并重新载入';install.dataset.reload='1';status.textContent='更新成功，所有文件已核验。升级前备份位于程序目录的 backups 文件夹。'+(state.projectDir?.__p109Portable?'重新载入后，请手动打开已确认下载的最新项目 ZIP。':state.projectDir?'独立项目目录也保留备份。':'');choose.disabled=true;
   if(location.protocol!=='file:'){install.textContent='完成 · 请打开本地程序';status.textContent+='本地程序已更新，当前网站版本保持不变。请打开本地程序文件夹中的 index.html；本按钮仅关闭向导。'}
   panel.querySelector('#p109UpdateCancel').hidden=true;panel.querySelector('#p109UpdateClose').setAttribute('aria-label',location.protocol==='file:'?'完成并重新载入':'完成并关闭向导');
  }
  else{choose.disabled=false;refresh()}
 };
 panel.querySelector('#p109UpdateClose').focus();
 try{bundle=await p109InspectUpdate(file);if(!panel.isConnected)return;
  panel.querySelector('#p109UpdateVersion').textContent='当前 '+P109_APP_VERSION+' → '+bundle.appVersion+(bundle.compare===0?'（同版本修复）':'');status.textContent='完整性与兼容性校验通过';
  refresh();const remembered=await p109ReadProgram();
  if(remembered&&typeof remembered.queryPermission==='function')try{
   if(await remembered.queryPermission({mode:'readwrite'})==='granted')await setRoot(remembered);
  }catch(_){}
 }catch(e){status.textContent=e.message;choose.disabled=true;install.textContent='校验未通过';install.disabled=true}
}
