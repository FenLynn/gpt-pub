/* Authorized directory handles only. Business data remains in its own directory. */
'use strict';
const P109_AUTO_OPEN_STORAGE='p109-project-auto-open-v1';
const p109RecentState={items:[],lastId:null,available:true,error:'',interacted:false,serial:0,detachedCurrent:false,autoOpen:null};
function p109AutoOpenAllowed(){if(typeof p109RecentState.autoOpen==='boolean')return p109RecentState.autoOpen;try{return localStorage.getItem(P109_AUTO_OPEN_STORAGE)!=='off'}catch(_){return true}}
function p109SetAutoOpenAllowed(enabled){
 p109RecentState.autoOpen=!!enabled;
 try{if(enabled)localStorage.removeItem(P109_AUTO_OPEN_STORAGE);else localStorage.setItem(P109_AUTO_OPEN_STORAGE,'off')}catch(_){}
 if(enabled)p109RecentState.detachedCurrent=false;
 return p109RecentAutoWrite(!!enabled).catch(()=>false);
}
function p109RecentOpenDb(){
 return new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){reject(Error('当前浏览器无法保存项目历史'));return}
  const request=indexedDB.open('P109-Project-History',1);
  const timer=setTimeout(()=>reject(Error('项目历史暂不可用')),5000);
  request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('projects',{keyPath:'id'});db.createObjectStore('settings')};
  request.onerror=()=>{clearTimeout(timer);reject(request.error)};
  request.onblocked=()=>{clearTimeout(timer);reject(Error('请关闭旧页面后重试项目历史'))};
  request.onsuccess=()=>{clearTimeout(timer);resolve(request.result)};
 });
}
async function p109RecentRead(){
 const db=await p109RecentOpenDb();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(['projects','settings'],'readonly'),items=tx.objectStore('projects').getAll(),settings=tx.objectStore('settings'),last=settings.get('lastId'),auto=settings.get('autoOpen');
  tx.oncomplete=()=>resolve({items:items.result,lastId:last.result||null,autoOpen:typeof auto.result==='boolean'?auto.result:null});tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 })}finally{db.close()}
}
async function p109RecentAutoWrite(enabled){
 const db=await p109RecentOpenDb();
 try{await new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(!!enabled,'autoOpen');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error)})}finally{db.close()}
 return true;
}
async function p109RecentWrite(item,lastId,removeId=null){
 const db=await p109RecentOpenDb();
 try{await new Promise((resolve,reject)=>{
  const tx=db.transaction(['projects','settings'],'readwrite');
  if(item)tx.objectStore('projects').put(item);
  if(removeId)tx.objectStore('projects').delete(removeId);
  tx.objectStore('settings').put(lastId,'lastId');
  tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
 })}finally{db.close()}
}
function p109RecentSorted(){return [...p109RecentState.items].sort((a,b)=>b.openedAt-a.openedAt)}
async function p109RememberProject(handle,projectName='',options={}){
 if(options.explicit){await p109SetAutoOpenAllowed(true);p109RecentState.detachedCurrent=false}
 if(handle?.__p109Portable){
  p109RecentState.serial++;p109RecentState.lastId=null;
  try{localStorage.setItem('p109-last-work-mode','portable')}catch(_){}
  // Keep recent native directories, but none is the default for a portable session.
  // IndexedDB is independent of localStorage and may remain available when it is blocked.
  try{await p109RecentWrite(null,null)}catch(_){}
  p109RefreshRecentMenu();return;
 }
 try{localStorage.removeItem('p109-last-work-mode')}catch(_){}
 p109RecentState.serial++;
 let existing;
 for(const item of p109RecentState.items){
  try{if(item.handle===handle||await handle.isSameEntry?.(item.handle)){existing=item;break}}catch(_){}
 }
 const item={...existing,id:existing?.id||p109UniqueId(),handle,name:handle.name,
  projectName:String(projectName||attendTitle()).slice(0,80),openedAt:Date.now()};
 p109RecentState.items=p109RecentState.items.filter(x=>x.id!==item.id).concat(item);p109RecentState.lastId=item.id;
 try{await p109RecentWrite(item,item.id);p109RecentState.available=true;p109RecentState.error=''}
 catch(e){p109RecentState.available=false;p109RecentState.error='浏览器未能记住目录，下次需重新选择。'+e.message}
 p109RefreshRecentMenu();
}
function p109RecentName(item){return item.label||item.name||item.projectName||'未命名项目'}
function p109RecentMenuHtml(){
 const items=p109RecentSorted();
 return '<div class="system-menu-divider"></div><span class="system-menu-caption">最近项目</span>'+
  (items.length?items.slice(0,5).map(x=>'<button type="button" role="menuitem" data-p109-recent="'+p109Escape(x.id)+'" title="'+p109Escape(x.projectName+' · '+x.name)+'">'+
   (x.id===p109RecentState.lastId?'✓ ':'')+p109Escape(p109RecentName(x))+'</button>').join(''):'<span class="system-menu-caption">尚未打开项目</span>')+
  '<button type="button" id="p109RecentManage" role="menuitem">管理已打开的项目</button>';
}
function p109BindRecentMenu(){
 document.querySelectorAll('[data-p109-recent]').forEach(button=>button.onclick=()=>{
  p109CloseSystemMenus();p109OpenRecentProject(button.dataset.p109Recent);
 });
 document.getElementById('p109RecentManage')?.addEventListener('click',()=>{p109CloseSystemMenus();p109ShowRecentProjects()});
}
function p109RefreshRecentMenu(){
 if(document.querySelector('.r81-project-location'))document.querySelector('.r81-project-location').outerHTML=p109ProjectLocationHtml();
 const label=document.getElementById('p109CurrentProject');
 if(label){label.textContent=p109CurrentProjectName()+' ↗';label.title=p109CurrentProjectName()+' · 点击浏览项目'}
 const menu=document.getElementById('p109RecentList');if(!menu)return;
 menu.innerHTML=p109RecentMenuHtml();p109BindRecentMenu();
}
async function p109OpenRecentProject(id){
 p109RecentState.interacted=true;
 const item=p109RecentState.items.find(x=>x.id===id);if(!item)return false;
 const status=document.getElementById('p109RecentStatus');
 if(status)status.textContent='正在打开 '+p109RecentName(item)+'…';
 const ok=await connectProjectDir(item.handle);
 if(ok)document.getElementById('p109RecentOverlay')?.remove();
 else if(status)status.textContent='未能打开。请允许目录读写；目录移动或删除后，可重新选择。当前工作已保留。';
 return ok;
}
function p109ShowRecentProjects(message=''){
 document.getElementById('p109RecentOverlay')?.remove();
 const panel=document.createElement('section');panel.id='p109RecentOverlay';panel.className='p109-recent-overlay';
 panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','p109RecentTitle');
 const items=p109RecentSorted(),duplicates=name=>items.filter(x=>p109RecentName(x)===name).length>1,
  detached=!!state.projectDir&&(!p109AutoOpenAllowed()||p109RecentState.detachedCurrent),
  portableCurrent=!!state.projectDir?.__p109Portable,
  detachedHtml=detached?'<div class="p109-recent-row p109-current-detached"><div><strong>'+p109Escape(p109CurrentProjectName())+'</strong><p>当前页面继续使用 · 下次打开不自动载入</p></div><div class="p109-recent-actions"><button id="p109RecentRestoreAuto">恢复自动载入</button></div></div>':
   portableCurrent?'<div class="p109-recent-row"><div><strong>'+p109Escape(p109CurrentProjectName())+'</strong><p>当前便携项目 · 已保存内容仍保留在本机缓存</p></div><div class="p109-recent-actions"><button id="p109RecentDetachCurrent">移除</button></div></div>':'';
 panel.innerHTML='<div class="p109-recent-panel"><header><div><h2 id="p109RecentTitle">最近项目</h2><p>一套程序，切换独立的数据目录</p></div><button id="p109RecentClose" aria-label="关闭项目列表">×</button></header>'+
  '<div class="p109-recent-body"><p id="p109RecentStatus" role="status">'+p109Escape(message||p109RecentState.error||'选择项目继续工作。移除记录不会删除目录或数据。')+'</p>'+
  '<div class="p109-recent-list">'+detachedHtml+(items.length?items.map(x=>'<div class="p109-recent-row"><div><strong>'+p109Escape(p109RecentName(x))+'</strong>'+
   '<p>'+p109Escape(x.projectName+' · '+x.name)+(duplicates(p109RecentName(x))?' · '+p109Escape(x.id.slice(-6)):'')+'</p><time>'+p109Escape(new Date(x.openedAt).toLocaleString('zh-CN'))+'</time></div>'+
   '<div class="p109-recent-actions"><button data-recent-open="'+p109Escape(x.id)+'">'+(x.id===p109RecentState.lastId?'继续打开':'打开')+'</button>'+
   '<button data-recent-rename="'+p109Escape(x.id)+'">改名</button><button data-recent-remove="'+p109Escape(x.id)+'">移除</button></div></div>').join(''):'<p class="p109-recent-empty">'+(detachedHtml?'没有其他最近项目。':'首次连接项目后，这里会自动记录。')+'</p>')+'</div></div>'+
  '<footer><button id="p109RecentPick">选择其他项目目录</button><button id="p109RecentNew">新建空白项目</button></footer></div>';
 document.body.appendChild(panel);
 const close=()=>{panel.remove();document.getElementById('projectMenuButton')?.focus()};
 panel.querySelector('#p109RecentClose').onclick=close;
 panel.querySelector('#p109RecentPick').onclick=async()=>{close();await connectProjectDir()};
 panel.querySelector('#p109RecentNew').onclick=async()=>{close();await p109InitializeProject()};
 panel.querySelector('#p109RecentRestoreAuto')?.addEventListener('click',async()=>{
  try{await p109SetAutoOpenAllowed(true);if(state.projectDir)await p109RememberProject(state.projectDir,attendTitle(),{explicit:true});p109RefreshRecentMenu();p109ShowRecentProjects('已恢复当前项目的自动载入。')}
  catch(e){panel.querySelector('#p109RecentStatus').textContent='自动载入未能恢复：'+e.message}
 });
 panel.querySelector('#p109RecentDetachCurrent')?.addEventListener('click',async()=>{
  await p109SetAutoOpenAllowed(false);p109RecentState.detachedCurrent=true;p109RefreshRecentMenu();
  p109ShowRecentProjects('已移除项目记录；当前页面继续使用，下次打开不会自动载入。');
 });
 panel.querySelectorAll('[data-recent-open]').forEach(b=>b.onclick=()=>p109OpenRecentProject(b.dataset.recentOpen));
 panel.querySelectorAll('[data-recent-rename]').forEach(b=>b.onclick=async()=>{
  const item=p109RecentState.items.find(x=>x.id===b.dataset.recentRename);if(!item)return;
  const label=window.prompt('项目显示名称（不改变实际目录名）',p109RecentName(item));if(label===null)return;
  const updated={...item,label:label.trim().slice(0,60)};
  try{await p109RecentWrite(updated,p109RecentState.lastId);p109RecentState.items=p109RecentState.items.map(x=>x.id===updated.id?updated:x);p109RefreshRecentMenu();p109ShowRecentProjects()}
  catch(e){panel.querySelector('#p109RecentStatus').textContent='名称未能保存：'+e.message}
 });
 panel.querySelectorAll('[data-recent-remove]').forEach(b=>b.onclick=async()=>{
  const id=b.dataset.recentRemove,item=p109RecentState.items.find(x=>x.id===id),last=p109RecentState.lastId===id?null:p109RecentState.lastId;
  let current=false;
  try{current=!!item&&!!state.projectDir&&(item.handle===state.projectDir||await item.handle?.isSameEntry?.(state.projectDir))}catch(_){}
  try{await p109RecentWrite(null,last,id);p109RecentState.items=p109RecentState.items.filter(x=>x.id!==id);p109RecentState.lastId=last;
   if(current){await p109SetAutoOpenAllowed(false);p109RecentState.detachedCurrent=true}
   p109RefreshRecentMenu();p109ShowRecentProjects(current?'已移除项目记录；当前页面继续使用，下次打开不会自动载入。':'项目记录已移除；当前工作不受影响。')}
  catch(e){panel.querySelector('#p109RecentStatus').textContent='记录未能移除：'+e.message}
 });
 panel.addEventListener('click',e=>{if(e.target===panel)close()});
 panel.addEventListener('keydown',e=>p109TrapDialogFocus(e,panel));
 panel.querySelector('[data-recent-open],#p109RecentPick')?.focus();
}
async function p109RestoreLastProject({startup=true}={}){
 const serial=p109RecentState.serial;
 const mark=()=>{p109RecentState.interacted=true};
 document.addEventListener('pointerdown',mark,{once:true,capture:true});document.addEventListener('keydown',mark,{once:true,capture:true});
 try{
  const data=await p109RecentRead();
  if(serial!==p109RecentState.serial)return;
  p109RecentState.items=data.items.filter(x=>x.handle?.kind==='directory'&&typeof x.handle.getDirectoryHandle==='function');p109RecentState.lastId=data.lastId;
  if(typeof data.autoOpen==='boolean')p109RecentState.autoOpen=data.autoOpen;p109RefreshRecentMenu();
  if(!p109AutoOpenAllowed()){
   if(!state.projectDir&&!p109RecentState.interacted){if(startup)p109ShowModeChooser(true);else p109ShowWorkHome()}
   return;
  }
  const item=p109RecentState.items.find(x=>x.id===data.lastId);
  if(!item&&await p109RestoreLocalCache(()=>serial===p109RecentState.serial&&!p109RecentState.interacted))return;
  let portable=false;try{portable=localStorage.getItem('p109-last-work-mode')==='portable'}catch(_){}
  if(portable&&!state.projectDir&&!p109RecentState.interacted){if(startup)p109ShowModeChooser(true);else{p109BlankWork();p109ShowWorkHome()}return}
  if(startup&&!item&&!state.projectDir&&!p109RecentState.interacted){p109ShowModeChooser(true);return}
  if(startup&&item&&!state.projectDir&&!p109RecentState.interacted)p109BlankWork();
  if(!item&&!state.projectDir&&!p109RecentState.interacted){p109ShowWorkHome();return}
  if(!item||state.projectDir||p109RecentState.interacted)return;
  const permission=await item.handle.queryPermission({mode:'readwrite'});
  if(state.projectDir||p109RecentState.interacted)return;
  if(permission==='granted'){
   const ok=await connectProjectDir(item.handle,{automatic:true});
   if(!ok)p109ShowRecentProjects('上次项目未能载入，请重新授权或选择目录。');
  }else p109ShowRecentProjects('上次项目：'+p109RecentName(item)+'。点击“继续打开”重新授权，无需再次寻找目录。');
 }catch(e){p109RecentState.available=false;p109RecentState.error='无法读取项目历史：'+e.message;p109RefreshRecentMenu();
  if(p109AutoOpenAllowed()&&await p109RestoreLocalCache(()=>serial===p109RecentState.serial&&!p109RecentState.interacted))return;
  if(!state.projectDir&&!p109RecentState.interacted){if(startup)p109ShowModeChooser(true);else p109ShowWorkHome()}}
 finally{document.removeEventListener('pointerdown',mark,true);document.removeEventListener('keydown',mark,true)}
}
p109RefreshRecentMenu();
const p109RecentReady=(async()=>{
 try{
  await p109LoadFixedCalendar();
  p109DemoSession=p109Clone(p109CaptureSession());
  if(p109ReadMode()==='work')p109BlankWork();
  await p109RestoreLastProject();
 }catch(e){p109ShowModeChooser(true);toast('启动未完成：'+e.message,true)}
})();
