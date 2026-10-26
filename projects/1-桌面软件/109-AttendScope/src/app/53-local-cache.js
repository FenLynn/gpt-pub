'use strict';
function p109CacheOpen(){
 return new Promise((resolve,reject)=>{
  let request,finished=false;
  const timer=setTimeout(()=>{finished=true;reject(Error('本机缓存未响应，请关闭其他旧页面后重试'))},5000);
  try{request=indexedDB.open('P109-Portable-Cache',1)}catch(e){clearTimeout(timer);reject(e);return}
  request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
  request.onblocked=()=>{finished=true;clearTimeout(timer);reject(Error('本机缓存被其他页面占用'))};
  request.onerror=()=>{finished=true;clearTimeout(timer);reject(request.error)};
  request.onsuccess=()=>{if(finished){request.result.close();return}clearTimeout(timer);resolve(request.result)};
 });
}
async function p109CacheRead(key='current'){
 const db=await p109CacheOpen();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction('snapshots','readonly'),request=tx.objectStore('snapshots').get(key);
  tx.oncomplete=()=>resolve(request.result||null);tx.onerror=tx.onabort=()=>reject(tx.error||Error('缓存读取中断'));
 })}finally{db.close()}
}
async function p109CacheWrite(record,expectedToken){
 const last=await p109CacheRead(),validToken=last&&last.bytes instanceof ArrayBuffer&&last.sha256===await p109Hash(new Uint8Array(last.bytes))?last.token:null;
 const db=await p109CacheOpen();let conflict=false;
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction('snapshots','readwrite'),store=tx.objectStore('snapshots'),request=store.get('current');
  request.onsuccess=()=>{
   const old=request.result;
   if(old&&old.id===record.id&&old.token!==expectedToken){conflict=true;tx.abort();return}
   if(old&&old.token===validToken)store.put(old,'previous');store.put(record,'current');
  };
  tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(conflict?Error('另一个页面已保存此项目，请先下载当前项目包，再重新打开最新缓存'):tx.error||Error('缓存写入中断'));
 })}finally{db.close()}
}
async function p109SaveLocalCache(){
 if(state.storageBusy||state.importCommitting||p109ProjectBusy||p109ConnectionBusy||r62ImportDraft){toast('请先完成当前文件操作',true);return false}
 if(state.isDemo){toast('演示模式请先切换到 Work',true);return false}
 state.storageBusy=true;
 try{
  const origin=state.projectDir,revision=origin?.revision,fingerprint=p109SessionFingerprint(),
   root=await p109PortableFromSession(),files=await p109PortableCollect(root),{zip}=await p109ZipBuild(files),
   bytes=await zip.arrayBuffer(),savedAt=new Date().toISOString(),
   record={schemaVersion:1,appVersion:P109_APP_VERSION,id:origin?.cacheId||p109UniqueId(),token:p109UniqueId(),
    name:root.name,savedAt,bytes,sha256:await p109Hash(new Uint8Array(bytes))};
  if(state.projectDir!==origin||origin&&origin.revision!==revision||p109SessionFingerprint()!==fingerprint)
   throw Error('保存过程中内容发生变化，请再次保存');
  await p109CacheWrite(record,origin?.cacheToken);
  const verified=await p109CacheRead();
  if(!verified||verified.token!==record.token||verified.sha256!==record.sha256||await p109Hash(new Uint8Array(verified.bytes))!==record.sha256)
   throw Error('本机缓存读回校验失败，请下载项目包备份');
  if(state.projectDir!==origin||origin&&origin.revision!==revision||p109SessionFingerprint()!==fingerprint){toast('已保存刚才的内容；后续修改请再次保存',true);return false}
  root.cacheId=record.id;root.cacheToken=record.token;root.cacheSavedAt=savedAt;root.pending=false;
  state.projectDir=root;for(const store of state.monthStores.values())store.saved=true;state.saved=true;rememberMonth();
  if(!origin||!origin.__p109Portable)await p109SetAutoOpenAllowed(true);
  await p109RememberProject(root);p109WriteMode('work');render();
  toast('仅写入本机浏览器缓存，需下载项目包写入磁盘');return true;
 }catch(e){toast('本机缓存保存失败：'+e.message+'。请用“项目 → 下载项目包”备份',true);return false}
 finally{state.storageBusy=false}
}
async function p109RestoreLocalCache(active=()=>true){
 let candidate=null,recovered=false,rejected=null;
 try{
  for(const key of ['current','previous']){
   const record=await p109CacheRead(key);if(!record)continue;
   if(record.schemaVersion!==1||!(record.bytes instanceof ArrayBuffer)||!record.bytes.byteLength)continue;
   if(await p109Hash(new Uint8Array(record.bytes))!==record.sha256){if(key==='current')rejected=record;continue}
   candidate=record;recovered=key==='previous';break;
  }
  if(!candidate||!active()||state.projectDir)return false;
  const ok=await p109OpenPortableFile(new File([candidate.bytes],'cached-project.zip',{type:'application/zip'}),{fromCache:true});
  if(!ok)return false;
  Object.assign(state.projectDir,{name:candidate.name,cacheId:candidate.id,cacheToken:candidate.token,cacheSavedAt:candidate.savedAt});
  if(rejected&&rejected.id===candidate.id)state.projectDir.cacheToken=rejected.token;
  if(recovered){state.projectDir.pending=true;state.saved=false;rememberMonth()}
  render();toast(recovered?'最近缓存校验失败，已恢复上一份有效缓存；请核对并下载备份':'已恢复本机缓存 '+new Date(candidate.savedAt).toLocaleString());return true;
 }catch(_){return false}
}
async function p109RestoreLocalCacheManually(){
 const previous=p109AutoOpenAllowed();await p109SetAutoOpenAllowed(true);
 const ok=await p109RestoreLocalCache();
 if(!ok){await p109SetAutoOpenAllowed(previous);toast('没有可恢复的有效本机缓存',true)}
 return ok;
}
