/* P109 R68 · data studio and on-disk inventory. Always read file handles, never
 * invent stored files from current analysis. Scanner is read-only; mutations are explicit. */
'use strict';
const R68_SECTIONS={records:'原始记录',calendar:'工作日管理',roster:'名册与分组',rules:'工作规则',
 templates:'导入模板',imports:'导入历史',freezes:'冻结与修订'};
const r68UI={chosen:new Set(),fixedChosen:new Set(),rosterTab:'fixed',search:'',fixedSearch:'',groupFilter:'all',targetGroup:'未分组',recordsView:'files',groupEditorOpen:false,projectSerial:0,treeSerial:0,rankMode:'issue'};
function r68Esc(s){return escapeNameChar(String(s??''))}
function r68HumanBytes(bytes){return bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KB':(bytes/1048576).toFixed(2)+' MB'}
function r68Pill(text,kind='neutral'){return '<span class="r68-pill '+kind+'">'+r68Esc(text)+'</span>'}
function r71Hint(text){
 const tip=r68Esc(text);
 return '<button class="r71-help r73-help" type="button" data-r73-tip="'+tip+
 '" aria-label="说明：'+tip+'">'+
 '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
 '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/></svg></button>';
}
/* R73: one properly positioned accessible tooltip above all panels, never native title.
   Delegation survives app rerenders; focus and pointer work identically. */
let r73TipTarget=null,r73TipNode=null,r73TipInstalled=false;
function r73HideTooltip(){
 if(r73TipTarget?.getAttribute('aria-describedby')==='r73FloatingTip')
  r73TipTarget.removeAttribute('aria-describedby');
 r73TipTarget=null;
 if(r73TipNode)r73TipNode.classList.remove('is-visible');
}
function r73ShowTooltip(target){
 const label=target?.dataset?.r73Tip;if(!label)return;
 if(!r73TipNode){
  r73TipNode=document.createElement('div');r73TipNode.id='r73FloatingTip';
  r73TipNode.className='r73-floating-tip';r73TipNode.setAttribute('role','tooltip');
  document.body.appendChild(r73TipNode);
 }
 if(r73TipTarget!==target)r73HideTooltip();
 r73TipTarget=target;r73TipNode.textContent=label;
 target.setAttribute('aria-describedby','r73FloatingTip');
 r73TipNode.style.left='0px';r73TipNode.style.top='0px';
 r73TipNode.classList.add('is-visible');
 const rects=[target.getBoundingClientRect()];
 if(target.matches('.r74-attendance-tag'))rects.push(...[...target.querySelectorAll('button')].map(n=>n.getBoundingClientRect()));
 const r={left:Math.min(...rects.map(x=>x.left)),right:Math.max(...rects.map(x=>x.right)),top:Math.min(...rects.map(x=>x.top)),bottom:Math.max(...rects.map(x=>x.bottom))};r.width=r.right-r.left;r.height=r.bottom-r.top;
 const w=r73TipNode.offsetWidth,h=r73TipNode.offsetHeight;
 let x=r.left+r.width/2-w/2, y=r.top-h-12,below=false,side='';
 // A heading tooltip must never cover the app header or page title.
 // When space allows, dock it beside the info symbol instead of above it.
 if(r.top<180&&r.right+w+25<window.innerWidth){
  side='right';x=r.right+15;y=r.top+r.height/2-h/2;
 }else if(r.top<180&&r.left>w+25){
  side='left';x=r.left-w-15;y=r.top+r.height/2-h/2;
 }else{
  x=Math.max(12,Math.min(window.innerWidth-w-12,x));
  if(y<75){y=r.bottom+13;below=true}
 }
 x=Math.max(12,Math.min(window.innerWidth-w-12,x));
 y=Math.max(12,Math.min(window.innerHeight-h-12,y));
 r73TipNode.style.left=x+'px';r73TipNode.style.top=y+'px';
 r73TipNode.classList.toggle('is-below',below);
 r73TipNode.classList.toggle('is-side-right',side==='right');
 r73TipNode.classList.toggle('is-side-left',side==='left');
 r73TipNode.style.setProperty('--r73-arrow-x',Math.max(16,Math.min(w-16,r.left+r.width/2-x))+'px');
 r73TipNode.style.setProperty('--r73-arrow-y',Math.max(14,Math.min(h-14,r.top+r.height/2-y))+'px');
}
function r73WireTooltips(){
 if(r73TipInstalled)return;r73TipInstalled=true;
 document.addEventListener('pointerover',e=>{
  if(e.target.closest?.('.r74-attendance-tag button')){r73HideTooltip();return}
  const target=e.target.closest?.('[data-r73-tip]');
  if(target&&target!==r73TipTarget)r73ShowTooltip(target)
 });
 document.addEventListener('pointerout',e=>{
  if(r73TipTarget&&r73TipTarget.contains(e.target)&&
   !r73TipTarget.contains(e.relatedTarget))r73HideTooltip()
 });
 document.addEventListener('focusin',e=>{
  if(e.target.closest?.('.r74-attendance-tag button')){r73HideTooltip();return}
  if(e.target.matches?.('[data-r73-tip]'))r73ShowTooltip(e.target)
 });
 document.addEventListener('focusout',e=>{
  if(e.target===r73TipTarget)r73HideTooltip()
 });
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
   if(r68UI.groupEditorOpen){r73ToggleGroupEditor(false);e.preventDefault()}
   else r73HideTooltip()
  }
 });
 document.addEventListener('scroll',r73HideTooltip,true);
 window.addEventListener('resize',r73HideTooltip);
}
function r68SidebarHeader(title,subtitle,actions=''){
 return '<header class="r68-cardhead r71-content-head"><h3>'+title+'</h3>'+
  (subtitle?r71Hint(subtitle):'')+'<div class="r71-heading-actions">'+actions+'</div></header>';
}
/* R73: two distinct populations. Left = current month's observations; right =
   durable fixed roster (including people not occurring in the current month). */
function r73FixedRoster(){
 const ids=new Set(state.fixedPeople||[]);
 const candidates=new Map();
 for(const e of state.projectProfile?.employees||[])if(e?.id)candidates.set(e.id,e);
 for(const e of EMPLOYEES)if(e?.id)candidates.set(e.id,e);
 return [...ids].map(id=>candidates.get(id)).filter(Boolean).sort((a,b)=>
  a.name.localeCompare(b.name,'zh-CN'));
}
function r68RosterRows(){
 const term=r68UI.search.trim().toLocaleLowerCase();
 return EMPLOYEES.filter(e=>
  (r68UI.groupFilter==='all'||groupOf(e)===r68UI.groupFilter)&&
  (!term||(e.name+' '+groupOf(e)).toLocaleLowerCase().includes(term)));
}
function r73GroupEditorHtml(){
 if(!r68UI.groupEditorOpen)return '';
 const groups=(state.groupCatalog||[]);
 return '<div class="r73-modal-backdrop" id="r73GroupBackdrop">'+
  '<section class="r73-modal" role="dialog" aria-modal="true" aria-labelledby="r73ModalTitle">'+
  '<header><div><h3 id="r73ModalTitle">编辑组别</h3><p>组别由手动创建，不随导入自动生成。</p></div>'+
  '<button type="button" class="r73-icon-btn" id="r73CloseGroups" aria-label="关闭组别编辑">×</button></header>'+
  '<div class="r73-editor-list">'+(groups.length?groups.map(g=>
   '<div class="r73-editor-row" data-r73-group="'+r68Esc(g)+'">'+
   '<input aria-label="组别名称" maxlength="24" value="'+r68Esc(g)+'">'+
   '<button type="button" data-r73-save-group="'+r68Esc(g)+'">保存</button>'+
   '<button type="button" class="danger" data-r73-delete-group="'+r68Esc(g)+'">删除</button></div>').join(''):
   '<p class="r73-editor-empty">还没有自定义组别</p>')+'</div>'+
  '<form id="r73GroupCreateForm" class="r73-group-create"><input id="r73NewGroup" maxlength="24" placeholder="输入新组别名称" aria-label="新组别名称" required>'+
  '<button type="submit">新增组别</button></form>'+
  '<footer>删除组别只会将其成员调整为“未分组”，不会删除人员和原始记录。</footer>'+
  '</section></div>';
}
function r68RosterHtml(){
 const ignoredTab=r68UI.rosterTab==='ignored',monthly=r68RosterRows(),fixed=ignoredTab?p109IgnoredRoster():r73FixedRoster(),fixedIds=new Set(ignoredTab?state.ignoredPeople||[]:state.fixedPeople||[]),
  selected=[...r68UI.chosen].filter(id=>EMPLOYEES.some(e=>e.id===id)),
  selectedFixed=[...r68UI.fixedChosen].filter(id=>fixedIds.has(id)),
  groups=workspaceGroups().filter(g=>g!=='未分组'),catalog=state.groupCatalog||[],
  fixedShown=fixed.filter(e=>!r68UI.fixedSearch||e.name.toLocaleLowerCase().includes(r68UI.fixedSearch.toLocaleLowerCase())),
  choices=['未分组',...groups].map(g=>'<option value="'+r68Esc(g)+'" '+(r68UI.targetGroup===g?'selected':'')+'>'+r68Esc(g)+'</option>').join('');
 return '<div class="r74-roster-header">'+r68SidebarHeader('人员与分组','长期固定人员供新建月份复用；忽略人员默认不在首页和统计中出现，原始数据保留。')+
  '<div class="r73-roster-top">'+
   '<div class="r73-roster-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>'+
   '<input id="r68RosterSearch" aria-label="搜索当月姓名" placeholder="搜索当月姓名" value="'+r68Esc(r68UI.search)+'"></div>'+
   '<div class="r73-filter-group"><select id="r73GroupFilter" aria-label="筛选组别">'+
   '<option value="all">全部组别</option><option value="未分组" '+(r68UI.groupFilter==='未分组'?'selected':'')+'>未分组</option>'+
   catalog.map(g=>'<option value="'+r68Esc(g)+'" '+(r68UI.groupFilter===g?'selected':'')+'>'+r68Esc(g)+'</option>').join('')+
   '</select><button type="button" id="r73EditGroups" class="r73-text-btn">编辑</button></div>'+
   '<button type="button" class="r73-main-btn" id="r72AddPerson">+ 新增人员</button></div></div>'+
  '<div class="r73-transfer-shell">'+
   '<section class="r73-roster-pane r73-month-pane" aria-label="当月人员">'+
    '<header class="r73-pane-title"><div><strong>当月人员</strong><span>'+monthly.length+' / '+EMPLOYEES.length+' 人</span></div>'+
     '<label><input id="r68SelectVisible" type="checkbox" '+(monthly.length&&monthly.every(e=>r68UI.chosen.has(e.id))?'checked':'')+'>全选</label></header>'+
    '<div class="r73-assign-tools"><span>已选 '+selected.length+'</span>'+
     '<select id="r68BulkGroup" aria-label="为选中人员指定组别">'+choices+'</select>'+
     '<button type="button" id="r68ApplyGroup" '+(!selected.length?'disabled':'')+'>加入组别</button><button type="button" id="r80ClearPeople" '+(!selected.length?'disabled':'')+'>清空选择</button></div>'+
    '<div class="r73-roster-scroll" id="r73MonthList" role="table" aria-label="当月人员名单">'+
     (monthly.length?monthly.map(e=>{
      const currentGroup=groupOf(e);
      return '<div class="r73-person-row" role="row">'+
       '<input type="checkbox" data-r68-person="'+r68Esc(e.id)+'" aria-label="选择 '+r68Esc(e.name)+'" '+(r68UI.chosen.has(e.id)?'checked':'')+'>'+
       '<strong>'+r68Esc(e.name)+'</strong>'+
       '<span class="r73-group-tag">'+r68Esc(currentGroup)+'</span>'+
       (!ignoredTab&&fixedIds.has(e.id)?'<span class="r73-pinned-mark" '+ 'data-r73-tip="已加入长期固定人员">✓</span>':'')+
       '<button class="r73-rename" type="button" data-r72-rename="'+r68Esc(e.id)+'" aria-label="修改 '+r68Esc(e.name)+'的姓名">改名</button></div>';
     }).join(''):'<div class="r73-list-empty">当前筛选没有人员</div>')+'</div>'+
   '</section>'+
   '<nav class="r73-transfer-controls" aria-label="固定名单操作">'+
    '<button type="button" class="r73-transfer-add" id="r72FixSelected" '+(!selected.some(id=>!fixedIds.has(id))?'disabled':'')+
       ' data-r73-tip="'+(ignoredTab?'不加入全员，原始数据保留':'将左侧选中的人员添加到长期固定名单')+'"><span aria-hidden="true">→</span><small>'+(ignoredTab?'忽略':'添加')+'</small></button>'+
    '<button type="button" class="r73-transfer-remove" id="r72UnfixSelected" '+(!selectedFixed.length?'disabled':'')+
       ' data-r73-tip="'+(ignoredTab?'加入全员，恢复首页显示和默认统计':'从长期固定名单移除右侧选中的人员，不删除当月人员或打卡')+'"><span aria-hidden="true">←</span><small>'+(ignoredTab?'加入全员':'移除')+'</small></button>'+
   '</nav>'+
   '<section class="r73-roster-pane r73-fixed-pane" aria-label="'+(ignoredTab?'忽略人员':'长期固定人员')+'">'+
    '<nav class="p109-roster-tabs" aria-label="人员名单">'+[['fixed','长期固定人员'],['ignored','忽略人员名单']].map(([id,label])=>'<button type="button" data-roster-tab="'+id+'" aria-pressed="'+(r68UI.rosterTab===id)+'">'+label+'</button>').join('')+'</nav>'+
    '<header class="r73-pane-title"><div><strong>'+(ignoredTab?'忽略人员':'长期固定人员')+'</strong><span>'+fixed.length+' 人</span></div>'+
     '<label><input id="r73SelectFixed" type="checkbox" '+(fixedShown.length&&fixedShown.every(e=>r68UI.fixedChosen.has(e.id))?'checked':'')+'>全选</label></header>'+
    '<div class="r73-fixed-filter"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>'+
     '<input id="r73FixedSearch" aria-label="'+(ignoredTab?'搜索忽略人员':'搜索固定人员')+'" placeholder="'+(ignoredTab?'搜索忽略姓名':'搜索固定姓名')+'" value="'+r68Esc(r68UI.fixedSearch)+'"></div>'+
    '<div class="r73-roster-scroll" id="r73FixedList" role="table" aria-label="'+(ignoredTab?'忽略人员名单':'长期固定人员名单')+'">'+
     (fixedShown.length?fixedShown.map(e=>{
       const exists=EMPLOYEES.some(p=>p.id===e.id),
         group=state.groups?.[e.id]||state.projectProfile?.groups?.[e.id]||'未分组';
       return '<div class="r73-person-row r73-fixed-row" role="row">'+
        '<input type="checkbox" data-r73-fixed-person="'+r68Esc(e.id)+'" aria-label="选择'+(ignoredTab?'忽略人员 ':'固定人员 ')+r68Esc(e.name)+'" '+(r68UI.fixedChosen.has(e.id)?'checked':'')+'>'+
        '<strong>'+r68Esc(e.name)+'</strong><span class="r73-group-tag">'+r68Esc(group)+'</span>'+
        (!exists?'<span class="r73-other-month">跨月</span>':'')+
        (ignoredTab&&exists?'<button type="button" class="r73-rename" data-ignored-view="'+r68Esc(e.id)+'">查看</button>':'')+
        '</div>';
     }).join(''):'<div class="r73-list-empty">'+(fixed.length?'未找到匹配人员':'选择左侧人员，点击“添加 →”')+'</div>')+
    '</div>'+
   '</section></div>'+r73GroupEditorHtml();
}
function r72MarkDirty(action,details={}){
 state.revisions.push({id:'R'+(++state.revisionSeq),key:'roster',action,...details,
  time:new Date().toISOString()});
 const view=r80CaptureRosterView();state.saved=false;rememberMonth();reanalyze();render();r80RestoreRosterView(view);
}
/* Fixed staff are a project default, not a deletion or replacement of current
 * month observations. Never touch frozen snapshots or previously saved months. */
async function r72PersistRoster(){
 const ids=new Set(state.fixedPeople||[]),catalog=new Map();
 for(const e of state.projectProfile?.employees||[])if(e?.id)catalog.set(e.id,{...e});
 for(const e of EMPLOYEES)if(e?.id)catalog.set(e.id,{...e});
 const people=[...ids].map(id=>catalog.get(id)).filter(Boolean);
 const groups=Object.fromEntries(people.map(e=>{
  const g=state.groups?.[e.id]??state.projectProfile?.groups?.[e.id]??'未分组';
  return [e.id,(state.groupCatalog||[]).includes(g)?g:'未分组'];
 }));
 const next={...(state.projectProfile||{}),schemaVersion:1,pinRoster:true,
  employees:people,fixedPeople:people.map(e=>e.id),groups,ignoredPeople:[...(state.ignoredPeople||[])],ignoredEmployees:p109IgnoredRoster(),
  groupCatalog:[...(state.groupCatalog||[])],nameAliases:{...(state.nameAliases||{})},
  savedAt:new Date().toISOString()};
 if(!state.projectDir){state.projectProfile=next;return}
 try{
  const config=await dir(state.projectDir,'config');
  const disk=await readJSON(config,'project-profile.json')||{};
  const merged={...disk,...next};
  await writeFile(config,'project-profile.json',JSON.stringify(merged,null,2));
  state.projectProfile=merged;
 }catch(e){toast('固定名单已在界面更新，但项目目录写入失败：'+e.message,true)}
}
async function r72FixedPeople(ids,makeFixed){
 const next=new Set(state.fixedPeople||[]),monthIds=new Set(EMPLOYEES.map(e=>e.id));
 const globalIds=new Set(r73FixedRoster().map(e=>e.id));
 const eligible=ids.filter(id=>makeFixed?monthIds.has(id):globalIds.has(id));
 if(!eligible.length)return;
 for(const id of eligible)if(makeFixed)next.add(id);else next.delete(id);
 state.fixedPeople=[...next];
 r68UI.chosen=new Set([...r68UI.chosen].filter(id=>!eligible.includes(id)));
 r68UI.fixedChosen=new Set([...r68UI.fixedChosen].filter(id=>!eligible.includes(id)));
 r72MarkDirty(makeFixed?'fix-people':'unfix-people',{employees:eligible});
 await r72PersistRoster();
}
function r72AddPerson(){
 const input=window.prompt('新增人员姓名（姓名唯一）','');if(input===null)return;
 const name=normalizedPerson(input);
 if(!name||name.length>50){toast('姓名须为 1–50 个字符',true);return}
 if(EMPLOYEES.some(e=>normalizedPerson(e.name)===name)){toast('这个姓名已经存在',true);return}
 if(state.isDemo){
  if(!window.confirm('当前是演示数据。新增真实人员前需要清空演示人员与记录，是否继续？'))return;
  EMPLOYEES=[];state.records=[];state.leaves=[];state.trips=[];state.outings=[];
  state.overtimeEntries=[];state.groups={};state.groupCatalog=[];state.fixedPeople=[];
  state.nameAliases={};state.imports=[];state.manualStatuses={};state.overtimeReview={};state.tempOutingReview={};state.manualTempOutings=[];state.manualOvertime=[];
  state.revisions=[];state.revisionSeq=0;state.isDemo=false;
 }
 EMPLOYEES.push({id:personIdentity(name),name,department:'未分类'});
 state.groups[personIdentity(name)]='未分组';
 r72MarkDirty('add-person',{employeeId:personIdentity(name),name});
}
function r72RenamePerson(id){
 const employee=EMPLOYEES.find(e=>e.id===id);if(!employee)return;
 const input=window.prompt('修改姓名（必须唯一；本月关联记录会同步更名）',employee.name);
 if(input===null)return;
 const name=normalizedPerson(input);
 if(!name||name.length>50||EMPLOYEES.some(e=>e.id!==id&&normalizedPerson(e.name)===name)){
  toast('姓名不能为空、超过 50 字或与已有姓名重复',true);return;
 }
 if(name===employee.name)return;
 if(!window.confirm('将「'+employee.name+'」改为「'+name+'」？本月打卡、业务记录和人工判定将按新身份关联，磁盘原件和已冻结快照不会改动。'))return;
 const newId=personIdentity(name),oldName=employee.name;
 for(const list of [state.records,state.leaves,state.trips,state.outings,state.overtimeEntries]){
  for(const row of list||[])if(row.employeeId===id){
   row.employeeId=newId;
   if(row.name){if(!row.sourceName)row.sourceName=row.name;row.name=name}
  }
 }
 state.nameAliases={...(state.nameAliases||{})};
 for(const [original,current] of Object.entries(state.nameAliases)){
  if(normalizedPerson(current)===oldName)state.nameAliases[original]=name;
 }
 state.nameAliases[oldName]=name;
 employee.id=newId;employee.name=name;
 state.groups[newId]=state.groups[id]||'未分组';if(id!==newId)delete state.groups[id];
 state.fixedPeople=(state.fixedPeople||[]).map(x=>x===id?newId:x);
 state.ignoredPeople=(state.ignoredPeople||[]).map(x=>x===id?newId:x);
 if(state.projectProfile?.ignoredPeople){state.projectProfile.ignoredPeople=state.projectProfile.ignoredPeople.map(x=>x===id?newId:x);state.projectProfile.ignoredEmployees=p109IgnoredRoster()}
 state.manualStatuses=Object.fromEntries(Object.entries(state.manualStatuses||{}).map(([key,v])=>
  [key.startsWith(id+'|')?newId+key.slice(id.length):key,v]));
 state.overtimeReview=Object.fromEntries(Object.entries(state.overtimeReview||{}).map(([key,v])=>
  [key.replace('auto-visit:'+id+':','auto-visit:'+newId+':').replace('auto:'+id+':','auto:'+newId+':'),v]));
 p109RenameIntervalState(state,id,newId);
 if(state.selection.employeeId===id)state.selection.employeeId=newId;
 r68UI.chosen=new Set([...r68UI.chosen].map(x=>x===id?newId:x));
 r72MarkDirty('rename-person',{employeeId:newId,from:oldName,to:name});
 if((state.fixedPeople||[]).includes(newId))r72PersistRoster();
}
function r73ToggleGroupEditor(open){
 r68UI.groupEditorOpen=!!open;r68RefreshDataContent();
 if(open)document.getElementById('r73NewGroup')?.focus();
 else document.getElementById('r73EditGroups')?.focus();
}
async function r72CreateGroup(value){
 const input=value===undefined?window.prompt('新组别名称（1–24 字）',''):value;if(input===null)return;
 const group=String(input).trim();
 if(!group||group.length>24||group==='未分组'||(state.groupCatalog||[]).includes(group)){
  toast('组别名称无效或已经存在',true);return;
 }
 state.groupCatalog=[...(state.groupCatalog||[]),group];
 r72MarkDirty('create-group',{group});await r72PersistRoster();
}
async function r72RenameGroup(group,value){
 if(!group||!(state.groupCatalog||[]).includes(group))return;
 const input=value===undefined?window.prompt('修改组别名称（旧月份内容保持不变）',group):value;
 if(input===null)return;
 const next=String(input).trim();
 if(!next||next.length>24||next==='未分组'||
  (next!==group&&(state.groupCatalog||[]).includes(next))){
  toast('组别无效或已经存在',true);return;
 }
 if(next===group)return;
 state.groupCatalog=state.groupCatalog.map(g=>g===group?next:g);
 for(const e of EMPLOYEES)if(groupOf(e)===group)state.groups[e.id]=next;
 if(state.projectProfile?.groups){
  state.projectProfile.groups=Object.fromEntries(Object.entries(state.projectProfile.groups)
   .map(([id,g])=>[id,g===group?next:g]));
 }
 if(state.selectedGroup===group)state.selectedGroup=next;
 if(r68UI.targetGroup===group)r68UI.targetGroup=next;
 if(r68UI.groupFilter===group)r68UI.groupFilter=next;
 r72MarkDirty('rename-group',{from:group,to:next});
 await r72PersistRoster();
}
async function r72DeleteGroup(group){
 if(!group||!(state.groupCatalog||[]).includes(group))return;
 const n=EMPLOYEES.filter(e=>groupOf(e)===group).length;
 if(!window.confirm('删除组别「'+group+'」？'+n+' 位现有成员将改为未分组；原始记录不会删除。'))return;
 state.groupCatalog=state.groupCatalog.filter(g=>g!==group);
 for(const e of EMPLOYEES)if(groupOf(e)===group)state.groups[e.id]='未分组';
 if(state.projectProfile?.groups){
  state.projectProfile.groups=Object.fromEntries(Object.entries(state.projectProfile.groups)
   .map(([id,g])=>[id,g===group?'未分组':g]));
 }
 if(state.selectedGroup===group)state.selectedGroup='未分组';
 if(r68UI.targetGroup===group)r68UI.targetGroup='未分组';
 if(r68UI.groupFilter===group)r68UI.groupFilter='未分组';
 r72MarkDirty('delete-group',{group,reassigned:n});await r72PersistRoster();
}
function r68RulesHtml(){
 const items=[
 ['上午班次',RULES.amStart+' — '+RULES.amEnd],
 ['下午班次',RULES.pmStart+' — '+RULES.pmEnd],
 ['上午打卡容差',RULES.graceAmStart+' / '+RULES.graceAmEnd+' 分钟'],
 ['下午打卡容差',RULES.gracePmStart+' / '+RULES.gracePmEnd+' 分钟'],
 ['重复打卡识别',RULES.dupSeconds+' 秒'],
 ['自动加班口径',RULES.overtimeRuleVersion===1?'历史口径：超过 '+RULES.overtimeMinMinutes+' 分钟计整段':'班后扣 '+RULES.overtimeAfterMinutes+' 分钟；班前门槛 '+RULES.overtimeBeforeMinutes+' 分钟；最低 '+RULES.overtimeMinMinutes+' 分钟'],
 ['报备与加班边界',p109BusinessPriority()?'出差/请假优先；班内不计加班，班外取并集':'历史冻结口径；编辑规则可将独立修订切换到新口径'],
 ['临时外出短时限额',p109TempRules().limit+' 分钟'],
 ['临时外出冗余',p109TempRules().grace+' 分钟（报备起止各允许）'],
 ['手工修订',state.revisions.length+' 次'],
 ['日历调整',Object.keys(state.calendarOverrides||{}).filter(k=>k.startsWith(monthKey())).length+' 天']
 ];
 return r68SidebarHeader('班次与规则','规则按月保存；固定为项目默认后，新月份可直接继承。',
  '<button class="r68-btn" id="r68EditRules">编辑考勤规则</button>')+
  '<div class="r68-rule-grid">'+items.map(([title,value])=>
   '<div><span>'+r68Esc(title)+'</span><strong>'+r68Esc(value)+'</strong></div>').join('')+'</div>'+
  '<div class="r68-note">'+(RULES.overtimeRuleVersion===1?'历史冻结口径：严格超过门槛后计完整时段，连续跨午休不自动计午间加班。编辑规则并应用可将独立修订切换到新口径，原冻结不变。':'自动加班按上列三个参数核查：班后先扣不计时长；班前达到门槛后计完整提前时长；连续有效区间达到最低值才计入。连续在岗跨午休也计算，默认12:00–13:30共90分钟。跨午夜先判断完整区间，再按日分摊。')+'</div>'+
  '<button class="r68-btn" id="r68PinRules">固定本月规则为项目默认</button> '+
  '<button class="r68-btn" type="button" data-calendar-editor>打开工作日管理</button>';
}
function r68TemplatesHtml(){
 const profile=r62ImportProfile();
 return r68SidebarHeader('导入模板','各类独立记忆；列结构变化时重新核对。')+
  '<div class="r68-template-grid">'+[
   ['attendance','考勤打卡'],['leave','请假'],['trip','出差'],['outing','外出'],['overtime','登记加班']
  ].map(([key,title])=>{
   const t=r96SavedImportSettings(key);
   return '<div class="r68-template-row"><div><strong>'+title+'</strong><small>'+
    (t?'已保存列映射 · '+Object.keys(t.mapping||{}).length+' 个字段':'自动识别（尚未固定映射）')+
    '</small></div>'+r68Pill(t?'已配置':'默认',t?'healthy':'neutral')+'</div>';
  }).join('')+'</div>'+
  '<div class="r68-note">进 / 出关键字规则 '+(profile.rules||[]).length+' 条；规则支持完全匹配与部分匹配，可在下次导入时调整。</div>'+
  '<button class="r68-btn" id="r68PinImport">固定当前模板为项目默认</button>';
}
function r68ImportsHtml(){
 const imports=state.imports||[];
 return r68SidebarHeader('导入历史','本月文件与解析结果；原件按导入 ID 单独保留。')+
  (imports.length?'<div class="r68-history">'+imports.map(r=>
   '<div class="r68-history-row"><span class="r68-history-icon">↧</span><div><button type="button" class="r80-file-link" data-p109-source="'+r68Esc(r.id)+'">'+r68Esc(r.name||'未知文件')+'</button>'+
   '<small>'+r68Esc(r.type)+' · '+r68Esc(r.importedAt||'时间未知')+'</small></div><span>'+Number(r.count||0)+' 条</span>'+
   r68Pill(r.sha256?'已记录哈希':'无哈希',r.sha256?'healthy':'warning')+'</div>').join('')+'</div>':
   '<div class="r68-empty">本月尚未导入真实文件。模拟数据不会冒充已保存的原件。</div>');
}
function r68FreezeHtml(){
 const month=monthKey(),detail=(r68UI.latestRoot===state.projectDir?r68UI.latestReport:null)?.months?.find(x=>x.key===month);
 const list=detail?.snapshots||[],branches=detail?.branches||[];
 return r68SidebarHeader('冻结与修订','「项目 → 冻结当前月」创建不可变基准；派生修订不会覆盖主 working。')+
  '<div class="r68-snapshot-list">'+(list.length?list.map(s=>
  '<div class="r68-snapshot-row"><div><strong>'+r68Esc(s.id)+'</strong><small>'+r68Esc(s.createdAt||'时间未知')+'</small></div>'+
   r68Pill(s.valid?'已冻结':'已损坏',s.valid?'healthy':'critical')+
   (s.valid?'<button class="r68-inline" data-r68-fork="'+month+'|'+r68Esc(s.id)+'">派生修订</button>':'')+
  '</div>').join(''):'<div class="r68-empty">此月暂无磁盘冻结。请先连接本地项目目录。</div>')+'</div>'+
  '<div class="r68-subtitle">独立修订副本 · '+branches.length+'</div>'+
  branches.map(b=>'<div class="r68-snapshot-row"><strong>'+r68Esc(b.id)+'</strong>'+r68Pill(b.valid?'正常':'损坏',b.valid?'healthy':'critical')+'</div>').join('')+
  '<button class="r68-btn" id="r68OpenProject">查看所有月份与存储</button>';
}
function r68RecordsHtml(){
 const tabs='<div class="r80-record-views" role="group" aria-label="记录视图"><button type="button" data-r80-record-view="files" class="'+(r68UI.recordsView!=='rows'?'active':'')+'">导入原件</button><button type="button" data-r80-record-view="rows" class="'+(r68UI.recordsView==='rows'?'active':'')+'">合并数据</button></div>';
 if(r68UI.recordsView!=='rows')return r68SidebarHeader('原始文件','浏览保存的原文件；合并数据在另一视图中展示。')+tabs+p109SourceListHtml();
 return tabs+'<div class="r68-records-head">'+r68SidebarHeader('原始记录','查看实际导入后的各类型表格；不在这里更改原始文件。')+'</div>'+
  '<div class="r68-records-frame"><section class="inspector-bottom" id="rawPane"><div class="raw-toolbar"><strong>数据来源</strong><div class="raw-tabs">'+
  [['attendance','考勤'],['trip','出差'],['leave','请假'],['outing','外出'],['overtime','加班']].map(([id,t])=>
   '<button data-raw-tab="'+id+'">'+t+'</button>').join('')+'</div><span id="rawRowCount"></span>'+
  '<button id="rawFloat" class="raw-float-btn" title="弹出原始表格">⛶</button></div>'+
  '<div id="rawDataTable" class="raw-table" aria-label="原始表格"></div></section></div>';
}
/* R69 · The project inventory is a CATEGORY of Data Management, never a top-level route. */
const R69_PROJECT_SECTIONS=new Set(['overview','months','health','storage']);
function r69IsProjectSection(key){return R69_PROJECT_SECTIONS.has(key)}
function r69NavigateData(section='overview'){
 state.dataSection=R69_PROJECT_SECTIONS.has(section)?section:'overview';
 if(state.workspaceMode==='data'){
  document.querySelectorAll('[data-data-section]').forEach(b=>b.classList.toggle('active',b.dataset.dataSection===state.dataSection));
  renderDataWorkspace();
 }else navigateWorkspace('data');
}
function r69ProjectError(err){
 const node=document.getElementById('r69ProjectPane');
 if(node&&r69IsProjectSection(state.dataSection))
  node.innerHTML='<section class="r68-studio-card"><p class="r68-note">项目扫描失败：'+r68Esc(err.message)+'</p>'+
   '<button class="r68-btn" id="r69Retry">重新检测</button></section>';
 node?.querySelector('#r69Retry')?.addEventListener('click',()=>r69RefreshInventory());
}
async function r69RefreshInventory(){
 r68UI.latestScanAt=0;r68UI.latestReport=null;r68UI.latestTree=null;
 r68UI.treeSerial++;
 if(state.workspaceMode==='data')renderDataWorkspace();
}
function r69PaintProjectSection(report,tree){
 const node=document.getElementById('r69ProjectPane');
 if(!node||!r69IsProjectSection(state.dataSection))return;
 const tab=state.dataSection,connected=!!state.projectDir;
 const captions={overview:['项目概况','查看真实保存的月份、冻结状态与健康问题'],
  months:['月份库存','月份内容来自项目磁盘，而非临时浏览器状态'],
  health:['健康检测','只读检测，不自动覆盖用户的原始记录或冻结'],
  storage:['存储与文件','实际磁盘大小与文件目录，不修改原文件']};
 const [title,description]=captions[tab];
 let content='';
 if(!connected){
  content='<div class="r70-project-intro r71-setup" role="region" aria-label="项目连接">'+
   '<h3>连接项目，开始使用</h3><div class="r71-setup-actions">'+
   '<button class="r68-btn primary" type="button" id="r68OpenProjectControl">连接 / 初始化</button>'+
   '<button class="r68-btn" type="button" id="r71RestoreZip">恢复 ZIP 备份</button></div></div>';
 }else{
  const host=document.createElement('div');host.innerHTML=r68ProjectMarkup(report,tree);
  const pick=selector=>host.querySelector(selector)?.outerHTML||'';
  const months=report.months||[],issues=report.issues||[];
  if(tab==='overview'){
   const facts=[['月份',months.length],['原始文件',report.rawFileCount||0],
    ['冻结',report.snapshotCount||0],['修订',months.reduce((n,m)=>n+m.branches.length,0)],
    ['占用',r68HumanBytes(tree?.totalBytes||0)]];
   content='<div class="r70-project-facts r71-facts">'+facts.map(([n,v])=>
    '<button type="button" '+p109PathAttr(n==='月份'||n==='原始文件'||n==='冻结'||n==='修订'?['data']:[])+'><em>'+n+'</em><strong>'+v+'</strong></button>').join('')+'</div>'+
    pick('#r68MonthsCard')+(issues.length?pick('#r68HealthCard'):'');
  }else if(tab==='months')content=pick('#r68MonthsCard');
  else if(tab==='health')content=pick('#r68HealthCard');
  else content=pick('#r68StorageCard')+
    '<section class="r71-tree-section"><div class="r71-tree-heading"><h3>实际文件树</h3>'+
    r71Hint('展开文件夹查看已连接目录的真实文件')+'</div>'+
    (host.querySelector('#r68ProjectTree .r68-filetree')?.outerHTML||
    '<div class="r68-empty">目录扫描中…</div>')+'</section>';
 }
 const level=report?.level==='critical'?'严重问题':report?.level==='warning'?'需要检查':'正常';
 node.innerHTML='<header class="r69-section-title r71-section-title"><h2>'+title+'</h2>'+
  r71Hint(description)+(connected?'<span class="r71-project-status '+(report.level||'')+'">'+level+'</span>':'')+
  '</header>'+content;
 node.querySelector('#r68OpenProjectControl')?.addEventListener('click',()=>openProjectControl());
 node.querySelector('#r71RestoreZip')?.addEventListener('click',()=>p109RestoreArchive());
 node.querySelector('#r68IndexRepair')?.addEventListener('click',async()=>{
  await p109RepairIndex(report);await r69RefreshInventory();
 });
 node.querySelectorAll('[data-r68-month]').forEach(b=>b.onclick=()=>{
  const [year,month]=b.dataset.r68Month.split('-').map(Number);
  if(monthExists(year,month)){state.dataSection='records';switchMonth(year,month);render()}
  else toast('磁盘存在此月份，但尚未载入；请重新连接项目目录',true);
 });
}
function r68DataMarkup(){
 const section=state.dataSection||'records';
 if(r69IsProjectSection(section))return '<div class="r71-data-shell r78-project-shell">'+
  '<div class="r78-project-tools"><span>'+r68Esc(state.projectDir?.name||'尚未连接项目')+'</span>'+
  '<button type="button" class="r68-btn" id="r68ScanAgain">重新扫描</button></div>'+
  (section==='storage'?p109StorageLocationsHtml():'')+
  '<main id="r69ProjectPane" class="r71-data-main"><div class="r68-loading">正在读取项目…</div></main></div>';
 return '<div class="r71-data-shell"><main class="r71-data-main">'+
  '<section id="r68DataContent" class="r71-data-content">'+
  (section==='calendar'?p109CalendarPageHtml():section==='roster'?r68RosterHtml():section==='rules'?r68RulesHtml():
   section==='templates'?r68TemplatesHtml():section==='imports'?r68ImportsHtml():
   section==='freezes'?r68FreezeHtml():r68RecordsHtml())+
  '</section></main></div>';
}
function r68RailPlaceholder(){
 if(state.projectDir&&r68UI.latestRoot===state.projectDir&&r68UI.latestTree&&r68UI.latestReport){
  const report=r68UI.latestReport,tree=r68UI.latestTree;
  return '<section class="r68-rail-card"><div class="r68-rail-heading"><h3>项目状态</h3>'+
   r68Pill(report.level==='critical'?'严重问题':report.level==='warning'?'需检查':'健康',
   report.level==='critical'?'critical':report.level==='warning'?'warning':'healthy')+'</div>'+
   '<div class="r68-rail-metrics"><div>月份 <strong>'+report.months.length+'</strong></div>'+
   '<div>冻结 <strong>'+report.snapshotCount+'</strong></div>'+
   '<div>修订 <strong>'+report.months.reduce((x,m)=>x+m.branches.length,0)+'</strong></div>'+
   '<div>原件 <strong>'+report.rawFileCount+'</strong></div></div>'+
   '<button class="r68-btn" id="r68RailProject">查看月份与健康 →</button></section>'+
   '<section class="r68-rail-card"><div class="r68-rail-heading"><h3>文件树</h3><span>'+tree.files+
   ' 文件 · '+r68HumanBytes(tree.totalBytes)+'</span></div>'+
   '<div class="r68-filetree">'+r68TreeLine(state.projectDir.name,'directory')+
   '<div class="r68-tree-children">'+tree.html+'</div></div></section>';
 }
 return '<section class="r68-rail-card"><h3>项目状态</h3><p>'+(state.projectDir?'正在读取本地文件…':'尚未连接项目目录')+'</p>'+
  '<button class="r68-btn" id="r68RailProject">查看项目状态</button></section>'+
  '<section class="r68-rail-card"><h3>文件树</h3><div id="r68RailTree" class="r68-tree-placeholder">'+(state.projectDir?'正在读取文件结构…':'连接目录后显示实际文件树')+'</div></section>';
}
function renderDataWorkspace(){
 const body=document.getElementById('analysisBody');if(!body)return;
 const head=document.getElementById('analysisTitle');if(head)head.textContent='数据管理 · '+monthKey();
 const tools=document.getElementById('analysisHeadTools');if(tools)tools.textContent='';
 if(typeof disposeRawTable==='function')disposeRawTable();
 body.innerHTML=r68DataMarkup();
 const root=body;
 root.querySelector('#r68ScanAgain')?.addEventListener('click',r69RefreshInventory);
 root.querySelector('#r68RosterSearch')?.addEventListener('input',e=>{
  r68UI.search=e.target.value;r68RefreshDataContent('r68RosterSearch',e.target.selectionStart)
 });
 root.querySelector('#r73FixedSearch')?.addEventListener('input',e=>{
  r68UI.fixedSearch=e.target.value;r68RefreshDataContent('r73FixedSearch',e.target.selectionStart)
 });
 root.querySelector('#r73GroupFilter')?.addEventListener('change',e=>{
  r68UI.groupFilter=e.target.value;r68RefreshDataContent()
 });
 root.querySelectorAll('[data-r68-person]').forEach(c=>c.onchange=()=>{
  if(c.checked)r68UI.chosen.add(c.dataset.r68Person);else r68UI.chosen.delete(c.dataset.r68Person);
  r68RefreshDataContent()
 });
 root.querySelector('#r68SelectVisible')?.addEventListener('change',e=>{
  r68RosterRows().forEach(p=>e.target.checked?r68UI.chosen.add(p.id):r68UI.chosen.delete(p.id));
  r68RefreshDataContent()
 });
 root.querySelectorAll('[data-r73-fixed-person]').forEach(c=>c.onchange=()=>{
  if(c.checked)r68UI.fixedChosen.add(c.dataset.r73FixedPerson);
  else r68UI.fixedChosen.delete(c.dataset.r73FixedPerson);
  r68RefreshDataContent()
 });
 root.querySelector('#r73SelectFixed')?.addEventListener('change',e=>{
  const term=r68UI.fixedSearch.toLocaleLowerCase();
  (r68UI.rosterTab==='ignored'?p109IgnoredRoster():r73FixedRoster()).filter(p=>!term||p.name.toLocaleLowerCase().includes(term)).forEach(p=>
   e.target.checked?r68UI.fixedChosen.add(p.id):r68UI.fixedChosen.delete(p.id));
  r68RefreshDataContent()
 });
 root.querySelector('#r68BulkGroup')?.addEventListener('change',e=>{r68UI.targetGroup=e.target.value});
 root.querySelector('#r80ClearPeople')?.addEventListener('click',()=>{r68UI.chosen.clear();r68RefreshDataContent()});
 root.querySelector('#r68ApplyGroup')?.addEventListener('click',()=>{
  const ids=[...r68UI.chosen].filter(id=>EMPLOYEES.some(e=>e.id===id)),g=root.querySelector('#r68BulkGroup')?.value;
  if(!ids.length||!g)return;
  if(g!=='未分组'&&!(state.groupCatalog||[]).includes(g)){toast('请先在组别编辑里创建该组别',true);return}
  for(const id of ids)state.groups[id]=g;
  r68UI.targetGroup=g;r68UI.chosen.clear();
  r72MarkDirty('bulk-group',{to:g,employees:ids});
  if(ids.some(id=>(state.fixedPeople||[]).includes(id)))r72PersistRoster();
 });
 root.querySelector('#r72AddPerson')?.addEventListener('click',r72AddPerson);
 root.querySelectorAll('[data-r72-rename]').forEach(b=>b.onclick=()=>r72RenamePerson(b.dataset.r72Rename));
 root.querySelectorAll('[data-roster-tab]').forEach(b=>b.onclick=()=>{r68UI.rosterTab=b.dataset.rosterTab;r68UI.fixedChosen.clear();r68UI.fixedSearch='';r68RefreshDataContent()});
 root.querySelectorAll('[data-ignored-view]').forEach(b=>b.onclick=()=>{state.selection={type:'person',employeeId:b.dataset.ignoredView};navigateWorkspace('person')});
 root.querySelector('#r72FixSelected')?.addEventListener('click',()=>r68UI.rosterTab==='ignored'?p109SetIgnored([...r68UI.chosen],true):r72FixedPeople([...r68UI.chosen],true));
 root.querySelector('#r72UnfixSelected')?.addEventListener('click',()=>r68UI.rosterTab==='ignored'?p109SetIgnored([...r68UI.fixedChosen],false):r72FixedPeople([...r68UI.fixedChosen],false));
 root.querySelector('#r73EditGroups')?.addEventListener('click',()=>r73ToggleGroupEditor(true));
 root.querySelector('#r73CloseGroups')?.addEventListener('click',()=>r73ToggleGroupEditor(false));
 root.querySelector('#r73GroupBackdrop')?.addEventListener('click',e=>{
  if(e.target.id==='r73GroupBackdrop')r73ToggleGroupEditor(false)
 });
 root.querySelector('#r73GroupCreateForm')?.addEventListener('submit',async e=>{
  e.preventDefault();await r72CreateGroup(root.querySelector('#r73NewGroup')?.value||'');
 });
 root.querySelectorAll('[data-r73-save-group]').forEach(b=>b.onclick=async()=>{
  const group=b.dataset.r73SaveGroup;
  await r72RenameGroup(group,b.closest('.r73-editor-row')?.querySelector('input')?.value);
 });
 root.querySelectorAll('[data-r73-delete-group]').forEach(b=>b.onclick=()=>r72DeleteGroup(b.dataset.r73DeleteGroup));
 if((state.dataSection||'records')==='calendar')p109WireCalendarPage(root);
 root.querySelector('#r68EditRules')?.addEventListener('click',()=>document.getElementById('settingsBtn').click());
 for(const [id,kind] of [['r68PinRoster','roster'],['r68PinImport','import'],['r68PinRules','rules']]){
  root.querySelector('#'+id)?.addEventListener('click',async()=>{p109Audit=await p109AuditProject();await p109PinDefaults(kind)});
 }
 root.querySelector('#r68OpenProject')?.addEventListener('click',()=>r69NavigateData('months'));
 root.querySelectorAll('[data-r68-fork]').forEach(b=>b.onclick=()=>{
  const [month,id]=b.dataset.r68Fork.split('|');return p109ForkSnapshot(month,id)
 });
 root.querySelector('#r68RailProject')?.addEventListener('click',()=>r69NavigateData('overview'));
 root.querySelectorAll('[data-r80-record-view]').forEach(b=>b.onclick=()=>{r68UI.recordsView=b.dataset.r80RecordView;
  if(r68UI.recordsView!=='rows')state.selection={type:'overall'};render()});
 if((state.dataSection||'records')==='records'&&r68UI.recordsView==='rows')mountRawTable(state.selection.type==='date'?
  {type:'date',day:state.selection.day,items:[]}:{type:'overall',items:workAnalyses()});
 root.querySelectorAll('.r68-note').forEach(note=>{
  const btn=document.createElement('button');btn.type='button';
  btn.className='r71-help r71-note-help';btn.textContent='ⓘ 说明';
  btn.dataset.r73Tip=note.textContent.trim();
  btn.setAttribute('aria-label','说明：'+note.textContent.trim());
  note.replaceWith(btn);
 });
 r68FillDataRail();r73WireTooltips();
}
function r80CaptureRosterView(){
 const active=document.activeElement;
 return {scroll:['#r73MonthList','#r73FixedList','#analysisBody','.r71-data-main'].map(selector=>({selector,top:document.querySelector(selector)?.scrollTop||0})),
  x:scrollX,y:scrollY,id:active?.id,person:active?.dataset?.r68Person,fixed:active?.dataset?.r73FixedPerson,
  caret:['r68RosterSearch','r73FixedSearch'].includes(active?.id)?active.selectionStart:null};
}
function r80RestoreRosterView(view){
 if(!view)return;
 const focus=view.id?document.getElementById(view.id):view.person?[...document.querySelectorAll('[data-r68-person]')].find(el=>el.dataset.r68Person===view.person):
  view.fixed?[...document.querySelectorAll('[data-r73-fixed-person]')].find(el=>el.dataset.r73FixedPerson===view.fixed):null;
 focus?.focus({preventScroll:true});if(view.caret!=null)focus?.setSelectionRange(view.caret,view.caret);
 for(const {selector,top} of view.scroll){const el=document.querySelector(selector);if(el)el.scrollTop=top}
 window.scrollTo(view.x,view.y);
}
function r68RefreshDataContent(focusId,position){
 const view=r80CaptureRosterView();if(focusId)view.id=focusId;if(position!=null)view.caret=position;
 renderDataWorkspace();r80RestoreRosterView(view);
}
function r68TreeLine(name,kind,detail=''){
 return '<span class="r68-tree-icon '+kind+'">'+(kind==='directory'?'▣':'▤')+'</span>'+
  '<span class="r68-tree-name">'+r68Esc(name)+'</span>'+(detail?'<span class="r68-tree-detail">'+r68Esc(detail)+'</span>':'');
}
async function r68PhysicalTree(root,limit=1600){
 if(!root)return {html:'<div class="r68-empty">无目录权限，无法读取本地文件。</div>',totalBytes:0,files:0};
 let files=0,totalBytes=0,nodes=0;
 const buckets={code:0,raw:0,working:0,snapshots:0,branches:0,backups:0,config:0,output:0,other:0};
 const entries=async(dir,prefix='',depth=0)=>{
  if(depth>8||nodes>=limit)return '<div class="r68-tree-truncated">已达到扫描展示上限</div>';
  const children=(await p109Entries(dir)).sort((a,b)=>(a.kind===b.kind? a.name.localeCompare(b.name,'zh-CN'):a.kind==='directory'?-1:1));
  const list=[];
  for(const item of children){
   if(++nodes>limit){list.push('<div class="r68-tree-truncated">仅展示前 '+limit+' 个节点</div>');break}
   const pathname=prefix+'/'+item.name,bucket=pathname.startsWith('/src/')||pathname==='/index.html'?'code':
    /\/raw\//.test(pathname)?'raw':/\/working\//.test(pathname)?'working':
    /\/snapshots\//.test(pathname)?'snapshots':/\/branches\//.test(pathname)?'branches':
    pathname.startsWith('/backups/')?'backups':pathname.startsWith('/config/')?'config':
    /\/output\//.test(pathname)?'output':'other';
   if(item.kind==='directory'){
    const nested=await entries(item.handle,pathname,depth+1);
    list.push('<details class="r68-tree-dir" '+(depth<1?'open':'')+'><summary>'+r68TreeLine(item.name,'directory')+'<button type="button" class="r80-tree-open" '+p109PathAttr(pathname.split('/').filter(Boolean))+' aria-label="浏览文件夹 '+r68Esc(item.name)+'">浏览</button></summary>'+
     '<div class="r68-tree-children">'+nested+'</div></details>');
   }else{
    const file=await item.handle.getFile(),size=file.size;
    files++;totalBytes+=size;buckets[bucket]+=size;
    list.push('<button type="button" class="r68-tree-file r80-tree-file" '+p109PathAttr(pathname.split('/').filter(Boolean))+' title="'+r68Esc(pathname)+'">'+r68TreeLine(item.name,'file',r68HumanBytes(size))+'</button>');
   }
  }
  return list.join('');
 };
 const html=await entries(root);
 return {html,totalBytes,files,buckets,limited:nodes>=limit};
}
function r68StorageBars(tree){
 if(!tree?.totalBytes)return '<p class="r68-empty">连接本地项目后显示磁盘占用。</p>';
 const names={raw:'原始文件',working:'工作状态',snapshots:'冻结快照',branches:'独立修订',
  config:'项目配置',backups:'备份',output:'输出文件',code:'程序代码',other:'其他'};
 const colors={raw:'#88b5e3',working:'#89c8b0',snapshots:'#d6b47a',branches:'#aaaddb',
  config:'#94c7df',backups:'#e3abac',output:'#bbc9d7',code:'#c9c6d9',other:'#d4dce5'};
 return Object.entries(names).filter(([id])=>tree.buckets[id]>0).map(([id,label])=>
 '<div class="r68-storage-row"><div><span>'+label+'</span><strong>'+r68HumanBytes(tree.buckets[id])+'</strong></div>'+
 '<div class="r68-storage-track"><i style="width:'+Math.max(1,100*tree.buckets[id]/tree.totalBytes).toFixed(2)+'%;background:'+colors[id]+'"></i></div></div>').join('');
}
/* R71: the only file-tree view is in Storage & Files, not every data subpage. */
async function r68FillDataRail(){
 const tab=state.dataSection||'records',project=r69IsProjectSection(tab);
 if(!project&&tab!=='freezes')return;
 const root=state.projectDir,token=++r68UI.treeSerial;
 if(r68UI.latestRoot===root&&r68UI.latestReport&&Date.now()-(r68UI.latestScanAt||0)<3000){
  if(project)r69PaintProjectSection(r68UI.latestReport,r68UI.latestTree);
  return;
 }
 try{
  const [report,tree]=await Promise.all([p109AuditProject(root),
   root&&project?r68PhysicalTree(root):Promise.resolve(null)]);
  if(token!==r68UI.treeSerial||state.projectDir!==root||state.workspaceMode!=='data')return;
  r68UI.latestRoot=root;r68UI.latestReport=report;
  if(tree)r68UI.latestTree=tree;
  if(!root)r68UI.latestTree=null;
  r68UI.latestScanAt=Date.now();
  if(project)r69PaintProjectSection(report,tree||r68UI.latestTree);
  else if(tab==='freezes'&&state.dataSection==='freezes')renderDataWorkspace();
 }catch(e){if(token===r68UI.treeSerial&&project)r69ProjectError(e)}
}
function r68ProjectMarkup(report,tree){
 const months=report?.months||[],issues=report?.issues||[],connected=!!state.projectDir;
 const status=report?.level==='critical'?'严重问题':report?.level==='warning'?'需检查':!connected?'未连接':'状态正常';
 return '<div class="r68-project-layout"><div class="r68-project-main">'+
  '<div class="r68-overview-cards">'+[
   ['已保存月份',months.length],['原始文件',report?.rawFileCount||0],
   ['冻结快照',report?.snapshotCount||0],
   ['修订副本',months.reduce((n,m)=>n+m.branches.length,0)],
   ['项目文件',tree?.files||0],['总占用',r68HumanBytes(tree?.totalBytes||0)]
  ].map(([name,v])=>'<div><span>'+name+'</span><strong>'+v+'</strong></div>').join('')+'</div>'+
  '<section id="r68MonthsCard" class="r68-studio-card">'+r68SidebarHeader('月份状态','按实际磁盘文件展示，不以浏览器内存模拟持久化数据。',
   r68Pill(status,report?.level==='critical'?'critical':report?.level==='warning'?'warning':'healthy'))+
  '<div class="r68-month-table"><div class="r68-month-row heading"><span>月份</span><span>员工</span><span>原件</span><span>工作状态</span>'+
   '<span>上次保存</span><span>冻结</span><span>修订副本</span><span>操作</span></div>'+
   (months.length?months.map(m=>'<div class="r68-month-row"><strong>'+r68Esc(m.key)+'</strong>'+
    '<span>'+m.employees+'</span><span><button class="r80-file-link" '+p109PathAttr(['data',...m.key.split('-'),'raw'])+'>'+m.raw+'</button></span><span>'+
     r68Pill(!m.hasWorking?'缺失':m.key===monthKey()&&!state.saved?'待保存':'已保存',m.hasWorking&&(m.key!==monthKey()||state.saved)?'healthy':'warning')+'</span>'+
    '<span>'+r68Pill(m.hasPrevious?'有':'无',m.hasPrevious?'neutral':'warning')+'</span>'+
    '<span><button class="r80-file-link" '+p109PathAttr(['data',...m.key.split('-'),'snapshots'])+'>'+m.snapshots.length+'</button></span><span><button class="r80-file-link" '+p109PathAttr(['data',...m.key.split('-'),'branches'])+'>'+m.branches.length+'</button></span>'+
    '<button class="r68-inline" data-r68-month="'+m.key+'">查看月份</button></div>').join(''):
    '<div class="r68-empty">目录内暂无保存过的月份。新项目请先导入并保存。</div>')+'</div></section>'+
  '<section id="r68HealthCard" class="r68-studio-card">'+r68SidebarHeader('项目健康','只读检测 · 提醒缺失与冲突，绝不擅自覆盖原始打卡和冻结。')+
   '<div class="r68-health-list">'+(issues.length?issues.map(i=>
    '<div class="r68-health-item">'+r68Pill(i.level==='critical'?'严重':i.level==='warning'?'提醒':'提示',
    i.level)+'<div><strong>'+r68Esc(i.message)+'</strong><small>'+r68Esc(i.where||'项目')+
     (i.fix?' · '+r68Esc(i.fix):'')+'</small></div></div>').join(''):
    '<div class="r68-empty">未发现本次扫描覆盖范围内的问题。</div>')+'</div>'+
   '<button class="r68-btn" id="r68IndexRepair" '+(!report?.safeIndexRepair?.length?'disabled':'')+'>补全有效月份索引（'+(report?.safeIndexRepair?.length||0)+'）</button></section>'+
  '<section id="r68StorageCard" class="r68-studio-card">'+r68SidebarHeader('存储构成','实际读取已连接目录中的文件大小；不包含未知的外部磁盘空间。')+
    '<div class="r68-storage-bars">'+r68StorageBars(tree)+'</div></section>'+
  '</div><aside class="r68-project-rail"><section id="r68ProjectTree" class="r68-studio-card">'+
   r68SidebarHeader('项目文件树','展开目录浏览实际文件，不修改任何内容。')+
   '<div class="r68-filetree r68-overview-tree">'+(connected?'<button type="button" class="r80-tree-root" '+p109PathAttr([])+'>'+r68TreeLine(state.projectDir.name,'directory')+'</button>'+
   '<div class="r68-tree-children">'+(tree?.html||'')+'</div>':
   '<div class="r68-empty">未连接本地目录。点击顶部「目录」选择已有项目或初始化。</div>')+
   '</div></section><section class="r68-studio-card">'+r68SidebarHeader('安全操作','离线存储 · 用户确认后执行。')+
   '<div class="r68-project-actions"><button class="r68-btn" id="r68ScanAgain">重新检测</button>'+
   '<button class="r68-btn" id="r68ProjectBackup" '+(!connected?'disabled':'')+'>完整 ZIP 备份</button>'+
   '<button class="r68-btn" id="r68OpenProjectControl">更多项目操作</button></div>'+
   '</section></aside></div>';
}
async function r68RenderProject(){
 const node=document.getElementById('r68ProjectWorkspace');if(!node)return;
 const token=++r68UI.projectSerial,sourceRoot=state.projectDir;
 node.innerHTML='<div class="r68-loading">正在清点项目月份、工作状态与文件树…</div>';
 if(!state.projectDir){
  const report=await p109AuditProject();
  if(token===r68UI.projectSerial&&node.isConnected&&state.projectDir===sourceRoot)node.innerHTML=r68ProjectMarkup(report,null);
 }else try{
  const [report,tree]=await Promise.all([p109AuditProject(),r68PhysicalTree(state.projectDir)]);
  if(token!==r68UI.projectSerial||!node.isConnected||state.projectDir!==sourceRoot)return;
  if(typeof p109MaybeWarnProjectSize==='function')p109MaybeWarnProjectSize(tree.totalBytes);
  r68UI.latestRoot=sourceRoot;r68UI.latestReport=report;r68UI.latestTree=tree;r68UI.latestScanAt=Date.now();
  node.innerHTML=r68ProjectMarkup(report,tree);
 }catch(e){
  if(token===r68UI.projectSerial&&node.isConnected)node.innerHTML='<div class="r68-note">读取项目失败：'+r68Esc(e.message)+'</div>';
 }
 if(!node.isConnected)return;
 node.querySelector('#r68ScanAgain')?.addEventListener('click',r68RenderProject);
 node.querySelector('#r68ProjectBackup')?.addEventListener('click',()=>p109BackupProject());
 node.querySelector('#r68OpenProjectControl')?.addEventListener('click',()=>openProjectControl());
 node.querySelector('#r68IndexRepair')?.addEventListener('click',async()=>{
  await p109RepairIndex(r68UI.latestReport);await r68RenderProject();
 });
 node.querySelectorAll('[data-r68-month]').forEach(b=>b.onclick=()=>{
  const [year,month]=b.dataset.r68Month.split('-').map(Number);
  if(monthExists(year,month)){switchMonth(year,month);navigateWorkspace('data');}
  else toast('此月份存在磁盘工作状态，请先用「目录」重新载入项目',true)
 });
 document.getElementById('r68RefreshProject')?.addEventListener('click',r68RenderProject);
 document.querySelectorAll('[data-project-scroll]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.projectScroll)?.scrollIntoView({behavior:'smooth',block:'start'}));
}
