/* R82 · storage-only directory tools and synchronous close protection. */
'use strict';
function p109UnsavedMonths(){
 const result=[];
 if(!state.saved&&!state.isDemo)result.push(monthKey());
 for(const [key,month] of state.monthStores)if(key!==monthKey()&&!month.saved&&!month.isDemo)result.push(key);
 if(state.projectDir?.__p109Portable&&state.projectDir.pending&&!result.includes(monthKey()))result.push(monthKey());
 return result;
}
function p109BeforeUnload(event){
 if(!p109UnsavedMonths().length&&!state.storageBusy&&!state.importCommitting&&!p109ProjectBusy)return;
 event.preventDefault();event.returnValue='';
}
window.addEventListener('beforeunload',p109BeforeUnload);
function p109ProgramLocation(){
 if(location.protocol!=='file:')return '网页运行 · 浏览器未提供本机程序路径';
 const url=new URL('.',location.href),path=decodeURIComponent(url.pathname);
 return url.hostname?'\\\\'+url.hostname+path.replaceAll('/','\\'):/^\/[A-Za-z]:\//.test(path)?path.slice(1).replaceAll('/','\\'):path;
}
function p109ProgramLocationHtml(){
 const path=p109ProgramLocation(),dirty=p109UnsavedMonths();
 return '<div class="r81-program-location"><strong class="r81-location-label">程序目录</strong><span id="p109ProgramPath" title="'+escapeNameChar(path)+'">'+escapeNameChar(path)+'</span>'+
  (location.protocol==='file:'?'<button id="r81CopyProgram" type="button">复制路径</button>':'')+
  '</div>'+(dirty.length?'<div class="r82-location-unsaved">未保存月份：'+dirty.join('、')+'<button id="r81SaveReminder" type="button">保存当前月</button></div>':'');
}
function p109StorageLocationsHtml(){return '<section class="r82-storage-locations" aria-label="目录位置"><h3>目录位置</h3>'+p109ProjectLocationHtml()+p109ProgramLocationHtml()+'<p>项目路径仅作本机备注；点击目录名可在页面中浏览实际项目文件。</p></section>'+(typeof p109EnvironmentHtml==='function'?p109EnvironmentHtml():'')}
const p109DirectoryNotes=new WeakMap();
function p109ActiveRecent(){return typeof p109RecentState==='undefined'?null:p109RecentState.items.find(x=>x.handle===state.projectDir)}
function p109ProjectDirectoryNote(){return state.projectDir?(p109DirectoryNotes.get(state.projectDir)||p109ActiveRecent()?.directoryPath||''):''}
function p109ProjectLocationHtml(){
 if(state.projectDir?.__p109Portable)return '<div class="r81-project-location"><strong>便携项目</strong><span>数据在当前页面内存中；关闭前请下载完整项目包</span></div>';
 const connected=!!state.projectDir,note=p109ProjectDirectoryNote(),label=connected?(note||state.projectDir.name):(state.isDemo?'Demo · 演示数据':'尚未连接项目');
 return '<div class="r81-project-location"><strong>项目数据目录</strong><button id="r81ProjectBrowse" type="button" title="'+escapeNameChar(label)+' · 点击浏览项目文件">'+escapeNameChar(label)+'</button>'+
  (connected?'<span class="r81-path-origin">'+(note?'手动记录':'浏览器仅提供目录名')+'</span><button id="r81CopyProject" class="r81-copy" type="button">复制路径</button>'+
   (note?'<button id="r81EditProjectPath" type="button" aria-label="编辑手动记录的项目目录路径">编辑路径</button>':''):'')+'</div>';
}
async function p109CopyDirectory(path){
 try{
  if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(path);
  else{
   const input=document.createElement('textarea');input.value=path;input.setAttribute('readonly','');input.style.cssText='position:fixed;opacity:0';document.body.appendChild(input);input.select();
   let ok;try{ok=document.execCommand('copy')}finally{input.remove()}
   if(!ok)throw Error('浏览器未允许复制');
  }
  toast('已复制目录路径');return true;
 }catch(_){p109ShowCopyFallback(path);return false}
}
function p109ShowCopyFallback(path){
 document.getElementById('r81CopyOverlay')?.remove();const node=document.createElement('section');node.id='r81CopyOverlay';node.className='p109-recent-overlay r81-path-overlay';
 node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label','复制目录路径');
 node.innerHTML='<div class="r81-path-panel"><h2>复制目录路径</h2><p>浏览器未允许自动复制，请按 Ctrl+C 复制下方内容。</p><textarea readonly aria-label="目录路径"></textarea><footer><button id="r81CopyClose">完成</button></footer></div>';
 document.body.appendChild(node);node.querySelector('textarea').value=path;node.querySelector('textarea').select();node.querySelector('#r81CopyClose').onclick=()=>node.remove();
 node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();node.remove()}else p109TrapDialogFocus(e,node)});
}
function p109ValidateDirectoryNote(text,name){
 const value=text.trim().replace(/^"(.*)"$/,'$1').replace(/[\\/]+$/,'');
 if(!value)return '';
 if(!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+|\/)/.test(value)||/[\0\r\n<>"|?*]/.test(value)||/(^|[\\/])\.\.?([\\/]|$)/.test(value)||/^C:\\fakepath\\/i.test(value))throw Error('请粘贴文件夹的完整绝对路径，不要包含文件名。');
 if(value.split(/[\\/]/).filter(Boolean).at(-1)?.normalize('NFKC').toLocaleLowerCase()!==name.normalize('NFKC').toLocaleLowerCase())throw Error('路径最后一级应为当前项目文件夹“'+name+'”，不要包含文件名。');
 return value;
}
function p109ShowProjectPath(copyAfter=false){
 if(!state.projectDir)return;document.getElementById('r81PathOverlay')?.remove();const handle=state.projectDir,node=document.createElement('section');
 node.id='r81PathOverlay';node.className='p109-recent-overlay r81-path-overlay';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r81PathTitle');
 node.innerHTML='<form class="r81-path-panel"><h2 id="r81PathTitle">记录项目目录路径</h2><p>浏览器只提供文件夹名称。请在系统文件管理器中复制此文件夹的地址，粘贴到这里，方便以后复制。</p><label for="r81PathInput">'+escapeNameChar(handle.name)+' · 完整文件夹路径</label><input id="r81PathInput" autocomplete="off" spellcheck="false"><p class="r81-path-note">仅在本机浏览器记录，不会移动文件或改变连接；完整路径无法由页面核实。</p><p id="r81PathError" role="alert"></p><footer><button type="button" id="r81PathCancel">取消</button><button type="submit">'+(copyAfter?'记录并复制':'保存路径')+'</button></footer></form>';
 document.body.appendChild(node);const input=node.querySelector('input');input.value=p109ProjectDirectoryNote();input.focus();
 node.querySelector('#r81PathCancel').onclick=()=>node.remove();
 node.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();node.remove()}else p109TrapDialogFocus(e,node)});
 node.querySelector('form').onsubmit=async e=>{
  e.preventDefault();if(state.projectDir!==handle){node.remove();return}
  const status=node.querySelector('#r81PathError');
  try{
   const path=p109ValidateDirectoryNote(input.value,handle.name);if(copyAfter&&!path)throw Error('请先填写完整文件夹路径。');
   const item=p109ActiveRecent();let persisted=!!item;
   if(item){const updated={...item,directoryPath:path};try{await p109RecentWrite(updated,p109RecentState.lastId)}catch(_){persisted=false}p109RecentState.items=p109RecentState.items.map(x=>x.id===item.id?updated:x)}
   p109DirectoryNotes.set(handle,path);
   if(!node.isConnected||state.projectDir!==handle)return;
   node.remove();render();if(copyAfter)await p109CopyDirectory(path);
   if(!persisted)toast('路径仅在本次页面中记录；浏览器未允许持久保存，下次需要重新填写。',true);
  }catch(err){status.textContent=err.message}
 };
}
document.addEventListener('click',e=>{
 if(e.target.closest?.('#p109Help'))p109ShowHelp();
 if(e.target.closest?.('#r81SaveReminder'))saveWorking();
 if(e.target.closest?.('#r81CopyProgram'))p109CopyDirectory(p109ProgramLocation());
 if(e.target.closest?.('#r81CopyProject')){const path=p109ProjectDirectoryNote();path?p109CopyDirectory(path):p109ShowProjectPath(true)}
 if(e.target.closest?.('#r81EditProjectPath'))p109ShowProjectPath();
 if(e.target.closest?.('#r81ProjectBrowse'))state.projectDir?p109OpenProjectPath([]):p109ShowModeChooser();
});
