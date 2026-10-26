/* One portable filesystem adapter keeps import, provenance, snapshots and project
 * readers on the same paths. It is memory, never a claim of durable storage. */
'use strict';
function p109Environment(){
 const supports=fn=>{try{return !!fn()}catch(_){return false}};
 let compressedXlsx=false;try{new DecompressionStream('deflate-raw');compressedXlsx=true}catch(_){}
 return {directory:supports(()=>typeof showDirectoryPicker==='function'),hash:typeof p109Digest==='function',nativeHash:supports(()=>globalThis.crypto?.subtle),
  download:supports(()=>typeof URL.createObjectURL==='function'&&'download' in document.createElement('a')),
  compressedXlsx,clipboard:supports(()=>navigator.clipboard?.writeText),history:supports(()=>globalThis.indexedDB)};
}
async function p109PersistOutput(blob,name,parts){
 const root=state.projectDir;
 if(root){try{
  let folder=root;for(const part of ['data',String(YEAR),pad(MONTH),'output',...parts])folder=await dir(folder,part);
  await writeFile(folder,name,await blob.arrayBuffer());if(root.__p109Portable)render();
  return {mode:root.__p109Portable?'portable':'directory'};
 }catch(e){
  if(!p109Environment().download)throw Error('目录写入失败，且浏览器无法下载：'+e.message+'。文件仍需另行保存');
  downloadBlob(blob,name);return {mode:'download',reason:e.message};
 }}
 if(!p109Environment().download)throw Error('浏览器无法下载文件，请恢复下载能力');
 downloadBlob(blob,name);return {mode:'download'};
}
function p109OutputNotice(result,label){
 return result.mode==='portable'?label+'已加入便携项目；请下载新的完整项目包':result.mode==='directory'?label+'已写入项目目录':
  (result.reason?'目录写入失败，已改为下载'+label:'已发起'+label+'下载')+'；请检查下载文件';
}
function p109MemoryRoot(name='便携项目'){
 const root={name,kind:'directory',__p109Portable:true,pending:true,revision:0,missing:[]};
 const changed=()=>{root.pending=true;root.revision++};
 const valid=n=>{if(typeof n!=='string'||!n||n==='.'||n==='..'||/[\\/\0]/.test(n))throw Error('无效文件名');return n};
 const missing=()=>new DOMException('文件不存在','NotFoundError');
 const folder=(name,tree=new Map())=>({name,kind:'directory',__p109Portable:true,
  async queryPermission(){return 'granted'},async requestPermission(){return 'granted'},async isSameEntry(other){return this===other},
  async getDirectoryHandle(n,opt={}){valid(n);if(!tree.has(n)){if(!opt.create)throw missing();tree.set(n,folder(n));changed()}
   const h=tree.get(n);if(h.kind!=='directory')throw new DOMException('不是文件夹','TypeMismatchError');return h},
  async getFileHandle(n,opt={}){valid(n);if(!tree.has(n)){if(!opt.create)throw missing();let bytes=new Uint8Array();
   tree.set(n,{name:n,kind:'file',async getFile(){return new File([bytes],n)},async createWritable(){let staged=bytes;return {
    async write(data){staged=typeof data==='string'?new TextEncoder().encode(data):data instanceof Blob?new Uint8Array(await data.arrayBuffer()):new Uint8Array(data).slice()},
    async close(){bytes=staged;changed()},async abort(){}}}});changed()}
   const h=tree.get(n);if(h.kind!=='file')throw new DOMException('不是文件','TypeMismatchError');return h},
  async *entries(){yield* tree.entries()},async removeEntry(n,opt={}){valid(n);const h=tree.get(n);if(!h)throw missing();
   if(h.kind==='directory'&&!opt.recursive){for await(const _ of h.entries())throw new DOMException('文件夹不为空','InvalidModificationError')}
   tree.delete(n);changed()}
 });
 return Object.assign(root,folder(name));
}
async function p109PortablePut(root,path,data){
 const parts=p109ValidatePath(path.split('/')),name=parts.pop();let target=root;for(const part of parts)target=await dir(target,part);await writeFile(target,name,data);
}
async function p109PortableCollect(root){const files=[];await p109ArchiveWalk(root,'',files,{count:0,bytes:0});return files}
async function p109PortableFromSession(){
 rememberMonth();const source=state.projectDir,root=p109MemoryRoot(source?.name||attendTitle()+'便携项目');
 if(source?.__p109Portable)for(const key of ['cacheId','cacheToken','cacheSavedAt'])if(source[key])root[key]=source[key];
 // Copy available disk evidence without overwriting or repairing its originals.
 if(source){try{for(const f of await p109PortableCollect(source))await p109PortablePut(root,f.name,f.data)}catch(e){
   // Do not silently claim an incomplete archive is a full backup.
   throw Error('无法读取原项目的完整文件：'+e.message+'。请先重新授权；仍不可读时可下载工作状态救援 JSON。');
 }}
 for(const [key,store] of state.monthStores){
  if(store.isDemo&&key!==monthKey())continue;
  const [year,month]=key.split('-').map(Number),payload={...store,schemaVersion:P109_DATA_SCHEMA,context:'working',year,month,
   savedAt:new Date().toISOString(),appVersion:P109_APP_VERSION,analysisEngineVersion:P109_ENGINE_VERSION,
   branch:store.activeBranch||null};delete payload.saved;delete payload.activeBranch;
  const base='data/'+year+'/'+pad(month),branch=store.activeBranch;
  const working=branch?base+'/branches/'+branch.id+'/working/state.json':base+'/working/state.json';
  await p109PortablePut(root,working,JSON.stringify(payload,null,2));
  for(const meta of store.imports||[]){const path=p109SourcePath(meta,key).join('/'),cached=p109SourceCache.get(meta.id);
   if(cached)await p109PortablePut(root,path,new Uint8Array(await cached.arrayBuffer()));
   let file;try{let h=root;const parts=path.split('/'),name=parts.pop();for(const part of parts)h=await existingDir(h,part);file=await p109File(h,name);if(!file)throw Error('missing')}
   catch(_){root.missing.push(path)}
   if(file&&meta.sha256&&await p109Hash(new Uint8Array(await (await file.getFile()).arrayBuffer()))!==meta.sha256)
    throw Error('导入原件内容与登记哈希不一致：'+meta.name+'。拒绝生成完整包，请检查原件或下载救援 JSON。');
  }
 }
 await p109PortablePut(root,'project.json',JSON.stringify(projectPayload(),null,2));
 if(state.projectProfile)await p109PortablePut(root,'config/project-profile.json',JSON.stringify(state.projectProfile,null,2));
 if(root.missing.length)throw Error('缺少 '+root.missing.length+' 个导入原件，不能生成完整项目包。请重新选择原件或下载救援 JSON。');
 return root;
}
function p109SessionFingerprint(){
 rememberMonth();return JSON.stringify([...state.monthStores].map(([key,m])=>[key,{...m,saved:undefined}]));
}
let p109PortableUrl=null;
function p109CloseTransfer(){document.getElementById('p109TransferOverlay')?.remove();if(p109PortableUrl){URL.revokeObjectURL(p109PortableUrl);p109PortableUrl=null}}
function p109TransferDialog(title,content){
 p109CloseTransfer();const node=document.createElement('section');node.id='p109TransferOverlay';node.className='p109-recent-overlay';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label',title);
 node.innerHTML='<div class="p109-update-panel"><header><h2>'+p109Escape(title)+'</h2><button id="p109TransferClose" aria-label="关闭">×</button></header><div class="p109-update-body">'+content+'</div></div>';
 document.body.appendChild(node);node.querySelector('#p109TransferClose').onclick=p109CloseTransfer;
 node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();p109CloseTransfer()}else p109TrapDialogFocus(e,node)});node.querySelector('button').focus();return node;
}
async function p109ExportPortable({adopt=false}={}){
 if(p109ProjectBusy||p109ConnectionBusy||state.storageBusy||state.importCommitting||r62ImportDraft){toast('请先完成当前文件操作',true);return false}
 p109ProjectBusy=true;
 try{
  if(!p109Environment().download||!p109Environment().hash)throw Error('当前环境无法生成安全项目包，请下载工作状态救援 JSON，或用本地新版浏览器打开');
  const fingerprint=p109SessionFingerprint(),origin=state.projectDir,cached=!!origin?.cacheSavedAt&&!p109UnsavedMonths().length,root=await p109PortableFromSession(),files=await p109PortableCollect(root);
  const {zip}=await p109ZipBuild(files),name=r63FileStem()+'_完整便携项目_'+p109DownloadStamp()+'.zip';
  if(adopt||origin?.__p109Portable){state.projectDir=root;root.pending=!cached;root.revision++;r68UI.latestRoot=null;await p109RememberProject(root);render()}
  const node=p109TransferDialog('下载完整项目包','<p>包含所有工作月份、导入原件、规则、人工处理，以及可读取的冻结和修订。浏览器不能确认文件是否真正落盘。</p><p><a id="p109PortableDownload">点击下载项目 ZIP</a></p><p id="p109TransferState" role="status">下载并检查文件后，再确认。关闭本窗口仍保留未保存提醒。</p><button id="p109ConfirmDownload">我已确认文件下载完成</button>');
  p109PortableUrl=URL.createObjectURL(zip);const link=node.querySelector('a');link.href=p109PortableUrl;link.download=name;
  link.onclick=()=>node.querySelector('#p109TransferState').textContent='已发起下载；请检查下载目录中的文件。';
  const revision=root.revision;
  node.querySelector('#p109ConfirmDownload').onclick=()=>{
   if(p109SessionFingerprint()!==fingerprint||(state.projectDir!==origin&&state.projectDir!==root)||root.revision!==revision){node.querySelector('#p109TransferState').textContent='工作内容在打包后发生变化，请重新下载，旧包未覆盖这些修改。';return}
   if(state.projectDir===root){root.pending=false;for(const m of state.monthStores.values())m.saved=true;state.saved=true;rememberMonth();render()}
   node.querySelector('#p109TransferState').textContent=state.projectDir===root?'已按你的确认记录本次项目包保存。':'已确认项目包下载；原目录中未保存的修改仍需另行保存。';
   node.querySelector('#p109ConfirmDownload').disabled=true;
  };
  link.click();return true;
 }catch(e){p109ShowStorageFallback(e.message);return false}finally{p109ProjectBusy=false}
}
function p109RescueDownload(){
 if(!p109Environment().download){toast('浏览器不允许文件下载，当前工作仍在页面中，请勿关闭；需要更换允许下载的运行环境',true);return false}
 rememberMonth();const data={schemaVersion:1,projectId:'P109-AttendScope',context:'rescue',appVersion:P109_APP_VERSION,
  exportedAt:new Date().toISOString(),project:projectPayload(),months:[...state.monthStores],profile:state.projectProfile||null,
  warning:'工作状态救援包，不包含原始文件字节、未加载的冻结或修订。请继续保留原项目目录和原始文件。'};
 downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),r63FileStem()+'_工作状态救援_'+p109DownloadStamp()+'.json');
 toast('已发起救援 JSON 下载；未确认落盘，未保存提醒继续保留');
}
function p109ShowStorageFallback(reason='当前环境不支持目录写入'){
 const node=p109TransferDialog('保存与环境备用方案','<p id="p109FallbackReason"></p><p>当前工作保留在页面中。完整项目包可在不支持目录写入的环境继续使用；救援 JSON 只保留工作状态，不含原件。</p><p><button id="p109FallbackRetry">重新选择或授权目录</button> <button id="p109FallbackPortable">转为便携模式并下载完整包</button></p><p><button id="p109FallbackOpen">打开已有项目 ZIP / JSON</button> <button id="p109FallbackNew">新建便携项目</button></p><p><button id="p109FallbackRescue">下载工作状态救援 JSON</button></p>');
 node.querySelector('#p109FallbackReason').textContent=reason;
 node.querySelector('#p109FallbackRetry').onclick=async()=>{p109CloseTransfer();await connectProjectDir()};
 node.querySelector('#p109FallbackPortable').onclick=()=>p109ExportPortable({adopt:true});node.querySelector('#p109FallbackRescue').onclick=p109RescueDownload;
}
async function p109OpenPortableFile(file,{fromCache=false}={}){
 if(p109ProjectBusy||state.storageBusy||state.importCommitting||p109ConnectionBusy||r62ImportDraft)return false;
 p109ProjectBusy=true;
 try{
  if(file.size>180*1024*1024)throw Error('项目包超过 180 MB 上限');
  if(/\.json$/i.test(file.name))return await p109OpenRescueFile(file);
  const items=await p109ZipRead(file),mf=items.find(f=>f.name==='p109-backup-manifest.json');if(!mf)throw Error('请选择完整项目 ZIP，不是程序升级包');
  const m=JSON.parse(new TextDecoder().decode(mf.data)),payload=items.filter(f=>f!==mf);
  if(m.projectId!=='P109-AttendScope'||m.schemaVersion!==1||!Array.isArray(m.files)||payload.length!==m.files.length||new Set(m.files.map(x=>x.path)).size!==m.files.length)throw Error('项目包清单不匹配');
  for(const f of payload){const ref=m.files.find(x=>x.path===f.name);if(!ref||ref.bytes!==f.data.byteLength||ref.sha256!==await p109Hash(f.data))throw Error('项目包校验失败：'+f.name)}
  const root=p109MemoryRoot(file.name.replace(/\.zip$/i,''));for(const f of payload)await p109PortablePut(root,f.name,f.data);
  const project=await readJSON(root,'project.json');if(!project)throw Error('包中缺少项目配置');await p109ReadProject(root,project);
  p109ProjectBusy=false;const ok=await connectProjectDir(root);if(ok){root.pending=false;render();p109CloseTransfer();if(!fromCache)toast('已打开便携项目；保存到本机缓存，下载项目包可另存备份')};return ok;
 }catch(e){toast('项目包未打开：'+e.message,true);return false}finally{p109ProjectBusy=false}
}
function p109PickPortable(){
 const input=document.createElement('input');input.type='file';input.accept='.zip,.json,application/zip,application/json';input.onchange=()=>{if(input.files?.[0])p109OpenPortableFile(input.files[0])};input.click();
}
async function p109OpenRescueFile(file){
 const data=JSON.parse(await file.text());
 if(data.schemaVersion!==1||data.projectId!=='P109-AttendScope'||data.context!=='rescue'||!Array.isArray(data.months)||!data.months.length)throw Error('不是有效的工作状态救援 JSON');
 const root=p109MemoryRoot(file.name.replace(/\.json$/i,'')),keys=new Set();
 for(const [key,m] of data.months){
  if(!p109KnownMonth(key)||keys.has(key))throw Error('救援包月份无效或重复');keys.add(key);
  const [year,month]=key.split('-').map(Number),payload={...m,schemaVersion:P109_DATA_SCHEMA,year,month};
  if(!normalizeSavedMonth(payload))throw Error('救援包工作状态无效：'+key);
  const base='data/'+year+'/'+pad(month),folder=m.activeBranch?base+'/branches/'+m.activeBranch.id+'/working':base+'/working';
  await p109PortablePut(root,folder+'/state.json',JSON.stringify(payload));
 }
 // Older rescue files had only the current branch in project.json. Their month
 // stores still carry background branches; preserve those on restoration too.
 const project={...data.project,monthBranches:{...(data.project?.monthBranches||{})}};
 for(const [key,m] of data.months)if(m.activeBranch)project.monthBranches[key]=m.activeBranch;
 await p109PortablePut(root,'project.json',JSON.stringify(project));
 if(data.profile)await p109PortablePut(root,'config/project-profile.json',JSON.stringify(data.profile));
 await p109ReadProject(root,project);p109ProjectBusy=false;
 const ok=await connectProjectDir(root);if(ok){root.rescue=true;root.pending=false;render();p109CloseTransfer();toast('已恢复工作状态；救援 JSON 不包含原件和未加载的冻结，请保留原项目目录',true)}return ok;
}
async function p109UsePortable(){
 if(p109ProjectBusy||state.storageBusy||state.importCommitting||p109ConnectionBusy||r62ImportDraft)return false;
 p109ProjectBusy=true;
 try{const root=await p109PortableFromSession();state.projectDir=root;root.pending=true;r68UI.latestRoot=null;await p109RememberProject(root);render();toast('已转为便携模式；修改后请下载完整项目包');return true}
 catch(e){p109ShowStorageFallback(e.message);return false}finally{p109ProjectBusy=false}
}
async function p109NewPortable(){
 if(p109ProjectBusy||state.storageBusy||state.importCommitting||p109ConnectionBusy||r62ImportDraft)return;
 const ok=await p109InitializeProject(p109MemoryRoot());if(ok)document.getElementById('p109ModeOverlay')?.remove();return ok;
}
function p109EnvironmentHtml(){
 const e=p109Environment(),rows=[['本机缓存',state.projectDir?.cacheSavedAt?new Date(state.projectDir.cacheSavedAt).toLocaleString()+'；不等于独立磁盘备份':'尚未保存项目缓存'],['目录直接保存',e.directory?'支持；实际写入仍需授权':'不可用：保存到本机缓存，下载 ZIP 备份'],['文件下载',e.download?'支持检测；下载后须检查实际文件':'不可用：保留页面并恢复下载/目录权限'],['安全项目包校验',e.nativeHash?'支持原生 SHA-256':'使用兼容 SHA-256 校验'],['压缩 XLSX',e.compressedXlsx?'支持':'请将源表另存 CSV 后导入'],['项目历史',e.history?'支持检测；写入失败时改为手动打开':'请每次手动打开项目包/目录'],['路径复制',e.clipboard?'支持检测；失败后提供手动复制':'使用选中文本手动复制']];
 return '<section class="r82-storage-locations p109-environment"><h3>环境与备用方案</h3><p>当前模式：'+(state.projectDir?.rescue?'救援工作区 · 缺少原件及未加载的冻结':state.projectDir?.__p109Portable?'便携项目 · 保存到本机缓存，下载 ZIP 另存备份':state.projectDir?'本地目录':'临时工作区')+'</p><table><tbody>'+rows.map(([a,b])=>'<tr><th>'+a+'</th><td>'+b+'</td></tr>').join('')+'</tbody></table><p class="p109-transfer-actions"><button id="p109EnvPortable">下载完整项目包</button> <button id="p109EnvOpen">打开项目 ZIP / JSON</button> <button id="p109EnvRescue">救援 JSON</button></p><p>清理浏览器缓存、换浏览器或程序位置后，缓存可能不可用；请定期下载带时间戳的项目 ZIP。升级不能写程序目录时，请将新版程序完整解压到可写的新目录，再打开项目包。</p></section>';
}
document.addEventListener('click',e=>{
 if(e.target.closest?.('#p109PortableOpen,#p109EnvOpen,#r85OpenPortable,#p109FallbackOpen'))p109PickPortable();
 if(e.target.closest?.('#p109PortableExport,#p109EnvPortable'))p109ExportPortable();
 if(e.target.closest?.('#p109PortableNew,#r85NewPortable,#p109FallbackNew'))p109NewPortable();
 if(e.target.closest?.('#p109EnvRescue'))p109RescueDownload();
});
