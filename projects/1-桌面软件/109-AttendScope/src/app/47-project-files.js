/* R80 · session entry and a read-only browser over authorized project handles.
 * Never navigate to or execute imported HTML. Original bytes stay immutable. */
'use strict';
const p109SourceCache=new Map();
let p109DemoSession=null,p109FilesSerial=0,p109SessionMode=null;
function p109ReadMode(){
 if(p109SessionMode)return p109SessionMode;
 try{const mode=localStorage.getItem('p109-session-mode');return ['demo','work'].includes(mode)?mode:null}catch(_){return null}
}
function p109WriteMode(mode){p109SessionMode=mode;try{localStorage.setItem('p109-session-mode',mode)}catch(_){}}
function p109ClearTransientFiles(){
 p109SourceCache.clear();p109FilesSerial++;document.getElementById('p109FilesOverlay')?.remove();
 if(typeof r68UI!=='undefined')Object.assign(r68UI,{chosen:new Set(),fixedChosen:new Set(),search:'',fixedSearch:'',groupFilter:'all',targetGroup:'未分组',recordsView:'files'});
}
function p109ActivateWorkSession(){p109WriteMode('work');p109ClearTransientFiles();document.getElementById('p109ModeOverlay')?.remove()}
function p109BlankWork(){
 const base=p109Clone(p109DemoSession);p109RestoreSession(base);
 EMPLOYEES=[];Object.assign(state,{projectDir:null,isDemo:false,records:[],leaves:[],trips:[],outings:[],overtimeEntries:[],
  imports:[],revisions:[],revisionSeq:0,manualStatuses:{},overtimeReview:{},attendanceReview:{},groups:{},groupCatalog:[],fixedPeople:[],nameAliases:{},
  monthStores:new Map(),projectProfile:null,activeBranch:null,snapshotContext:false,overtimeRuleContexts:{},saved:true,calendarOverrides:{},ignoredPeople:[],statsIncludeIgnored:false,
  importProfile:{rules:R62_DEFAULT_DIRECTIONS.map(r=>({...r})),templates:{}},workspaceMode:'data',dataSection:'overview',selection:{type:'overall'}});
 Object.assign(RULES,P109_DEFAULT_RULES);p109ClearTransientFiles();rememberMonth();reanalyze();render();
}
function p109ShowModeChooser(first=false){
 if(state.importCommitting||r62ImportDraft||r63ReadingImport||p109ConnectionBusy||p109ProjectBusy||state.storageBusy){toast('请先完成当前文件操作',true);return}
 document.getElementById('p109ModeOverlay')?.remove();
 const node=document.createElement('section');node.id='p109ModeOverlay';node.className='p109-recent-overlay r80-mode-overlay';
 node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r80ModeTitle');
 node.innerHTML='<div class="r80-mode-panel"><header><div><h2 id="r80ModeTitle">开始使用考勤</h2><p>连接工作项目后，下次自动继续；未设置时每次选择</p></div>'+
  (!first?'<button id="r80ModeClose" aria-label="关闭模式选择">×</button>':'')+'</header><div class="r80-mode-choices">'+
  '<button id="r80Demo"><span class="r80-mode-symbol">◈</span><strong>Demo · 体验</strong><span>用演示数据了解分析、统计和分组</span></button>'+
  '<button id="r80Work"><span class="r80-mode-symbol">▣</span><strong>Work · 工作</strong><span>新建空白项目，或连接已有项目</span></button></div><footer><button id="r82EntryHelp">先看入门教程</button></footer></div>';
 document.body.appendChild(node);node.addEventListener('keydown',e=>p109TrapDialogFocus(e,node));
 node.querySelector('#r80ModeClose')?.addEventListener('click',()=>node.remove());
 node.querySelector('#r82EntryHelp').onclick=()=>p109ShowHelp('start','overview');
 node.querySelector('#r80Demo').onclick=()=>{
  if(!first&&!p109ConfirmProjectSwitch())return;
  p109ClearTransientFiles();p109RestoreSession(p109Clone(p109DemoSession));p109WriteMode('demo');
  node.remove();reanalyze();render();
 };
 node.querySelector('#r80Work').onclick=async()=>{
  if(state.projectDir){p109WriteMode('work');node.remove();render();return}
  if(!first&&!state.isDemo){p109WriteMode('work');node.remove();p109ShowWorkHome();return}
  if(!first&&!p109ConfirmProjectSwitch())return;
  p109WriteMode('work');p109BlankWork();node.remove();p109RecentState.interacted=false;
  await p109RestoreLastProject({startup:false});
 };
 node.querySelector('#r80Work').focus();
}
function p109ShowWorkHome(){
 if(state.projectDir)return;
 document.getElementById('p109ModeOverlay')?.remove();
 const node=document.createElement('section');node.id='p109ModeOverlay';node.className='p109-recent-overlay r80-mode-overlay';
 node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r80WorkTitle');
 node.innerHTML='<div class="r80-mode-panel"><header><div><h2 id="r80WorkTitle">工作项目</h2><p>程序与项目数据分别存放，可随时切换项目</p></div><button id="r80ModeClose" aria-label="关闭工作入口">×</button></header>'+
  '<div class="r80-work-actions" '+(p109Environment().directory?'':'hidden')+'><button id="r80NewProject"><strong>新建空白项目</strong><span>选择一个独立的空数据文件夹</span></button>'+
  '<button id="r80ConnectProject"><strong>连接已有项目</strong><span>选择包含 project.json 的数据文件夹</span></button></div>'+
  '<div class="r80-work-actions"><button id="r85NewPortable"><strong>新建便携项目</strong><span>保存到本机缓存，可下载 ZIP 备份</span></button><button id="r85OpenPortable"><strong>打开项目 ZIP / 救援 JSON</strong><span>本地读取，在当前页面继续工作</span></button><button id="r102RestoreCache"><strong>恢复上次本机缓存</strong><span>仅手动恢复，不重新选择项目包</span></button></div>'+
  '<footer><button id="r80ChooseAgain">切换 Demo / Work</button><button id="r80MemoryWork">先在空白工作区导入</button></footer></div>';
 document.body.appendChild(node);node.addEventListener('keydown',e=>p109TrapDialogFocus(e,node));
 node.querySelector('#r80ModeClose').onclick=()=>node.remove();
 const open=async action=>{
  node.remove();await action();
  if(!state.projectDir&&!document.querySelector('.p109-project-overlay')&&!document.getElementById('p109ModeOverlay'))p109ShowWorkHome();
 };
 node.querySelector('#r80NewProject').onclick=()=>open(()=>p109InitializeProject());
 node.querySelector('#r80ConnectProject').onclick=()=>open(()=>connectProjectDir());
 node.querySelector('#r102RestoreCache').onclick=()=>open(()=>p109RestoreLocalCacheManually());
 node.querySelector('#r80ChooseAgain').onclick=()=>p109ShowModeChooser();
 node.querySelector('#r80MemoryWork').onclick=()=>{node.remove();toast('当前为临时工作区；保存写入本机缓存，下载项目包可另存备份。')};
 node.querySelector(p109Environment().directory?'#r80NewProject':'#r85NewPortable').focus();
}
function p109CurrentProjectName(){
 if(!state.projectDir)return state.isDemo?'演示项目':'未连接项目';
 if(state.projectDir.__p109Portable)return state.projectDir.name+' · 便携';
 const recent=typeof p109RecentState==='undefined'?null:p109RecentState.items.find(x=>x.id===p109RecentState.lastId);
 return recent?.label||state.projectDir.name;
}
function p109PathAttr(path){return 'data-p109-path="'+encodeURIComponent(JSON.stringify(path))+'"'}
function p109ValidatePath(path){
 if(!Array.isArray(path)||path.some(x=>typeof x!=='string'||!x||x==='.'||x==='..'||/[\\/\0]/.test(x)))throw Error('文件路径无效');
 return path;
}
function p109SourcePath(meta,key=monthKey()){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(key)||!['attendance','leave','trip','outing','overtime'].includes(meta.type)||!meta.id)throw Error('原件索引不完整');
 return p109ValidatePath(['data',...key.split('-'),'raw',meta.type,meta.id,meta.name]);
}
function p109SourceFolderAttr(meta){try{return p109PathAttr(p109SourcePath(meta).slice(0,-1))}catch(_){return null}}
function p109SourceListHtml(){
 const imports=state.imports||[],labels={attendance:'考勤',leave:'请假',trip:'出差',outing:'外出',overtime:'加班'};
 return '<div class="r80-source-intro"><span>'+imports.length+' 个导入原件</span><span>多文件合并 · 原件分别保留</span></div>'+
  (imports.length?'<div class="r80-source-list">'+imports.map(meta=>'<article class="r80-source-row"><span class="r80-file-symbol">▤</span><div class="r80-source-name">'+
   '<button type="button" data-p109-source="'+r68Esc(meta.id)+'">'+r68Esc(meta.name)+'</button><p>'+r68Esc(labels[meta.type]||meta.type)+' · '+Number(meta.count||0)+' 条'+
   (meta.addedCount!=null?' · 新增 '+Number(meta.addedCount)+(meta.mergedCount?' / 重合 '+Number(meta.mergedCount):''):'')+'</p></div>'+
   '<div class="r80-source-actions"><button type="button" data-p109-source="'+r68Esc(meta.id)+'">浏览</button>'+
   (state.projectDir&&p109SourceFolderAttr(meta)?'<button type="button" '+p109SourceFolderAttr(meta)+'>文件夹</button>':'')+'</div></article>').join('')+'</div>':
   '<div class="r68-empty">尚无导入原件。可一次选择多个文件，逐个确认后合并。</div>')+
  (!state.projectDir&&imports.length?'<p class="r80-mapping-hint">当前未连接项目，原件仅在本次页面中可浏览；关闭前请保留原文件。</p>':'');
}
function p109CloseFileBrowser(){p109FilesSerial++;document.getElementById('p109FilesOverlay')?.remove();document.getElementById('p109CurrentProject')?.focus({preventScroll:true})}
function p109FilePanel(title,path=null){
 document.getElementById('p109FilesOverlay')?.remove();const serial=++p109FilesSerial;
 const node=document.createElement('section');node.id='p109FilesOverlay';node.className='p109-recent-overlay r80-files-overlay';
 node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-labelledby','r80FileTitle');
 node.innerHTML='<div class="r80-files-panel"><header><div><h2 id="r80FileTitle">'+r68Esc(title)+'</h2>'+
  (path?'<nav class="r80-file-crumbs" aria-label="文件路径"><button '+p109PathAttr([])+'>'+r68Esc(p109CurrentProjectName())+'</button>'+path.map((part,i)=>'<span>/</span><button '+p109PathAttr(path.slice(0,i+1))+'>'+r68Esc(part)+'</button>').join('')+'</nav>':'')+
  '</div><button id="r80FilesClose" aria-label="关闭文件浏览">×</button></header><div id="r80FileBody" class="r80-file-body" aria-live="polite">正在读取…</div><footer id="r80FileFooter">只读浏览 · 不修改原件</footer></div>';
 document.body.appendChild(node);node.querySelector('#r80FilesClose').onclick=p109CloseFileBrowser;
 node.addEventListener('keydown',e=>p109TrapDialogFocus(e,node));node.querySelector('#r80FilesClose').focus();
 return {node,serial,root:state.projectDir};
}
function p109FilePanelActive(panel){return panel.serial===p109FilesSerial&&panel.node.isConnected&&panel.root===state.projectDir}
async function p109PreviewFile(panel,file){
 const body=panel.node.querySelector('#r80FileBody'),footer=panel.node.querySelector('#r80FileFooter');
 if(!p109FilePanelActive(panel))return;
 footer.innerHTML='<span>'+r68Esc(file.name)+' · '+r68HumanBytes(file.size)+'</span><button id="r80DownloadOriginal" type="button">下载原文件</button>';
 footer.querySelector('button').onclick=()=>downloadBlob(file,file.name);
 if(file.size>40*1024*1024){body.textContent='文件超过 40 MB，请下载后使用本机软件打开。';return}
 if(/\.(csv|xlsx)$/i.test(file.name)){
  const grid=await P109_TABLES.readGrid(file);if(!p109FilePanelActive(panel))return;
  let current=0;const size=100;
  const paint=()=>{
   const rows=grid.rows.slice(current*size,(current+1)*size),width=Math.max(0,...rows.map(r=>r.cells.length));
   body.innerHTML='<div class="r80-preview-toolbar"><span>原文件 · '+r68Esc(grid.sheet||'表格')+' · '+grid.rows.length+' 行（含表头）</span><div><button id="r80FilePrev" '+(!current?'disabled':'')+'>上一页</button><span>'+(current+1)+' / '+Math.max(1,Math.ceil(grid.rows.length/size))+'</span><button id="r80FileNext" '+((current+1)*size>=grid.rows.length?'disabled':'')+'>下一页</button></div></div>'+
    '<div class="r80-original-grid"><table><thead><tr><th>行</th>'+Array.from({length:width},(_,i)=>'<th>'+r62ColumnLabel(i)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr><th>'+row.rowNumber+'</th>'+Array.from({length:width},(_,i)=>'<td>'+r68Esc(row.cells[i]??'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
   body.querySelector('#r80FilePrev').onclick=()=>{current--;paint()};body.querySelector('#r80FileNext').onclick=()=>{current++;paint()};
  };paint();
 }else if(/\.(json|txt|md|log|html?|css|js|svg|xml)$/i.test(file.name)){
  const text=await file.slice(0,1024*1024).text();if(!p109FilePanelActive(panel))return;
  body.innerHTML=(file.size>1024*1024?'<p>仅预览前 1 MB，完整内容请下载。</p>':'')+'<pre class="r80-text-preview"></pre>';
  body.querySelector('pre').textContent=text;
 }else body.textContent='此格式暂不提供页内预览，请下载后使用本机软件打开。';
}
async function p109OpenProjectPath(path=[]){
 let panel;
 try{
  p109ValidatePath(path);if(!state.projectDir){p109ShowWorkHome();return}
  panel=p109FilePanel(path.at(-1)||p109CurrentProjectName(),path);
  let handle=panel.root;
  for(let i=0;i<path.length;i++){
   if(i<path.length-1)handle=await handle.getDirectoryHandle(path[i]);
   else try{handle=await handle.getDirectoryHandle(path[i])}catch(e){if(e.name!=='TypeMismatchError'&&e.name!=='NotFoundError')throw e;handle=await handle.getFileHandle(path[i])}
  }
  if(!p109FilePanelActive(panel))return;
  if(handle.kind==='file'){await p109PreviewFile(panel,await handle.getFile());return}
  const children=(await p109Entries(handle)).sort((a,b)=>a.kind===b.kind?a.name.localeCompare(b.name,'zh-CN'):a.kind==='directory'?-1:1);
  if(!p109FilePanelActive(panel))return;
  panel.node.querySelector('#r80FileBody').innerHTML='<div class="r80-directory-list">'+(children.length?children.slice(0,2000).map(item=>'<button type="button" '+p109PathAttr([...path,item.name])+'><span class="r80-file-symbol">'+(item.kind==='directory'?'▣':'▤')+'</span><strong>'+r68Esc(item.name)+'</strong><span>'+(item.kind==='directory'?'文件夹':'文件')+' ›</span></button>').join(''):'<p class="r68-empty">此文件夹为空</p>')+'</div>'+(children.length>2000?'<p>仅展示前 2000 项</p>':'');
 }catch(e){if(panel&&p109FilePanelActive(panel))panel.node.querySelector('#r80FileBody').textContent='无法读取：'+(e.name==='NotFoundError'?'原文件或文件夹不存在。请确认项目目录完整。':e.message);else toast(e.message,true)}
}
async function p109OpenSource(id){
 const meta=state.imports.find(x=>x.id===id);if(!meta){toast('未找到原件索引',true);return}
 if(state.projectDir){try{await p109OpenProjectPath(p109SourcePath(meta))}catch(e){toast('原件索引不完整，请到存储与文件中浏览实际目录。',true)}return}
 const panel=p109FilePanel(meta.name),file=p109SourceCache.get(id);
 if(!file){panel.node.querySelector('#r80FileBody').textContent='此原件不在当前会话中。请连接保存该原件的项目目录，或重新选择原文件。';return}
 try{await p109PreviewFile(panel,file)}catch(e){if(p109FilePanelActive(panel))panel.node.querySelector('#r80FileBody').textContent='预览失败：'+e.message}
}
function p109OpenRecordSources(kind,id){
 const field={attendance:'records',leave:'leaves',trip:'trips',outing:'outings',overtime:'overtimeEntries'}[kind];
 const row=field&&state[field].find(r=>(kind==='attendance'?r.recordId:r.id)===id);
 if(!row){toast('未找到记录来源',true);return}
 const panel=p109FilePanel('记录来源 · '+row.name),refs=row.sources||[row];
 panel.node.querySelector('#r80FileBody').innerHTML='<div class="r80-directory-list">'+refs.map(ref=>
  '<button type="button" data-p109-source="'+r68Esc(ref.importId||'')+'"><span class="r80-file-symbol">▤</span><strong>'+r68Esc(ref.source||'未知文件')+
  '</strong><span>'+r68Esc(ref.sheet||'表格')+' · 行 '+r68Esc(ref.row||'—')+' ›</span></button>').join('')+'</div>';
 panel.node.querySelector('#r80FileFooter').textContent=refs.length+' 个来源 · 合并保留原记录 ID，所有原件分别保存';
}
document.addEventListener('click',e=>{
 const sources=e.target.closest?.('[data-p109-sources]');if(sources){try{p109OpenRecordSources(...JSON.parse(decodeURIComponent(sources.dataset.p109Sources)))}catch(err){toast('无法读取来源：'+err.message,true)}return}
 const source=e.target.closest?.('[data-p109-source]');if(source){p109OpenSource(source.dataset.p109Source);return}
 const path=e.target.closest?.('[data-p109-path]');if(path){e.preventDefault();e.stopPropagation();try{p109OpenProjectPath(JSON.parse(decodeURIComponent(path.dataset.p109Path)))}catch(err){toast(err.message,true)}return}
 if(e.target.closest?.('#p109CurrentProject')){state.projectDir?p109OpenProjectPath([]):state.isDemo?p109ShowModeChooser():p109ShowWorkHome();return}
 if(e.target.closest?.('#p109ModeSwitch'))p109ShowModeChooser();
});
