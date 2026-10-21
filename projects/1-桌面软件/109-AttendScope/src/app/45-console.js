/* P109 R68 · data studio and on-disk inventory. Always read file handles, never
 * invent stored files from current analysis. Scanner is read-only; mutations are explicit. */
'use strict';
const R68_SECTIONS={records:'原始记录',roster:'名册与分组',rules:'工作规则',
 templates:'导入模板',imports:'导入历史',freezes:'冻结与修订'};
const r68UI={chosen:new Set(),search:'',rosterFilter:'all',projectSerial:0,treeSerial:0,rankMode:'issue'};
function r68Esc(s){return escapeNameChar(String(s??''))}
function r68HumanBytes(bytes){return bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toFixed(1)+' KB':(bytes/1048576).toFixed(2)+' MB'}
function r68Pill(text,kind='neutral'){return '<span class="r68-pill '+kind+'">'+r68Esc(text)+'</span>'}
function r71Hint(text){
 return '<button class="r71-help" type="button" title="'+r68Esc(text)+
  '" aria-label="说明：'+r68Esc(text)+'">ⓘ</button>';
}
function r68SidebarHeader(title,subtitle,actions=''){
 return '<header class="r68-cardhead r71-content-head"><h3>'+title+'</h3>'+
  (subtitle?r71Hint(subtitle):'')+'<div class="r71-heading-actions">'+actions+'</div></header>';
}
function r68RosterRows(){
 const query=r68UI.search.trim().toLocaleLowerCase();
 return EMPLOYEES.filter(e=>{
  const g=state.groups?.[e.id]||'未分组';
  if(r68UI.rosterFilter==='ungrouped'&&groupOf(e)!=='未分组')return false;
  if(r68UI.rosterFilter==='fixed'&&!(state.fixedPeople||[]).includes(e.id))return false;
  if(r68UI.rosterFilter==='temporary'&&(state.fixedPeople||[]).includes(e.id))return false;
  if(r68UI.rosterFilter==='new'&&!(state.imports||[]).some(x=>
   state.records.some(r=>r.employeeId===e.id&&r.importId===x.id)))return false;
  return !query||(e.name+' '+g).toLocaleLowerCase().includes(query);
 });
}
/* R72 roster: unique names, explicit groups, month membership and project-wide fixed staff. */
function r68RosterHtml(){
 const rows=r68RosterRows(),groups=workspaceGroups().filter(g=>g!=='未分组'),
  catalog=state.groupCatalog||[],chosen=[...r68UI.chosen].filter(id=>EMPLOYEES.some(e=>e.id===id)),
  fixed=new Set(state.fixedPeople||[]);
 const options='<option value="未分组">未分组</option>'+
  groups.map(g=>'<option value="'+r68Esc(g)+'">'+r68Esc(g)+'</option>').join('');
 return r68SidebarHeader('人员与分组','导入自动发现人员；姓名唯一，固定人员自动进入新月份。',
  '<button type="button" class="r68-btn" id="r72AddPerson">+ 新增人员</button>')+
  '<div class="r68-roster-tools r72-roster-tools"><input id="r68RosterSearch" aria-label="搜索姓名或组别" placeholder="搜索姓名或组别" value="'+r68Esc(r68UI.search)+'">'+
  '<select id="r68RosterFilter" aria-label="人员筛选">'+
   [['all','所有人员'],['ungrouped','未分组'],['new','本月导入'],['fixed','固定人员'],['temporary','非固定人员']].map(([v,t])=>
    '<option value="'+v+'" '+(r68UI.rosterFilter===v?'selected':'')+'>'+t+'</option>').join('')+'</select>'+
  '<span>'+rows.length+' 人 · 固定 '+fixed.size+' 人</span></div>'+
  '<div class="r72-group-manager"><strong>组别</strong>'+
   '<select id="r72GroupToRemove" aria-label="管理已有组别"><option value="">选择组别…</option>'+
   catalog.map(g=>'<option value="'+r68Esc(g)+'">'+r68Esc(g)+'</option>').join('')+'</select>'+
   '<button type="button" class="r68-btn" id="r72AddGroup">+ 新增组别</button>'+
   '<button type="button" class="r68-btn" id="r72DeleteGroup">删除组别</button></div>'+
  '<div class="r68-roster-bulk r72-roster-bulk"><label><input id="r68SelectVisible" type="checkbox" '+
   (rows.length&&rows.every(e=>r68UI.chosen.has(e.id))?'checked':'')+'> 全选当前筛选</label>'+
   '<span>已选 '+chosen.length+' 人</span>'+
   '<select id="r68BulkGroup" aria-label="批量分组">'+options+'</select>'+
   '<button type="button" class="r68-btn" id="r68ApplyGroup" '+(!chosen.length?'disabled':'')+'>应用组别</button>'+
   '<button type="button" class="r68-btn" id="r72FixSelected" '+(!chosen.length?'disabled':'')+'>设为固定</button>'+
   '<button type="button" class="r68-btn" id="r72UnfixSelected" '+(!chosen.length?'disabled':'')+'>移出固定</button></div>'+
  '<div class="r68-roster-list r72-roster-list" role="table" aria-label="人员名册">'+
   '<div class="r68-roster-entry r68-roster-columns" role="row"><span></span><span>姓名</span><span>所属组别</span><span>固定</span><span>来源</span><span>操作</span></div>'+
   (rows.length?rows.map(e=>{
    const detected=state.records.some(r=>r.employeeId===e.id&&String(r.recordId||'').startsWith('import:'));
    return '<div class="r68-roster-entry" role="row">'+
     '<input type="checkbox" data-r68-person="'+r68Esc(e.id)+'" aria-label="选择 '+r68Esc(e.name)+'" '+
      (r68UI.chosen.has(e.id)?'checked':'')+'><strong title="'+r68Esc(e.name)+'">'+r68Esc(e.name)+'</strong>'+
     '<select data-r72-person-group="'+r68Esc(e.id)+'" aria-label="'+r68Esc(e.name)+'的组别">'+
      '<option value="未分组" '+(groupOf(e)==='未分组'?'selected':'')+'>未分组</option>'+
      groups.map(g=>'<option value="'+r68Esc(g)+'" '+(groupOf(e)===g?'selected':'')+'>'+r68Esc(g)+'</option>').join('')+
     '</select>'+
     '<button type="button" class="r72-fixed-toggle '+(fixed.has(e.id)?'is-fixed':'')+'" data-r72-toggle-fixed="'+r68Esc(e.id)+'" aria-pressed="'+fixed.has(e.id)+'">'+
      (fixed.has(e.id)?'已固定':'临时')+'</button>'+
     '<small>'+(detected?'本月导入':'已有名册')+'</small>'+
     '<button type="button" class="r68-inline" data-r72-rename="'+r68Esc(e.id)+'">改名</button></div>';
   }).join(''):'<div class="r68-empty">暂无人员。导入文件会自动识别姓名，也可手动新增。</div>')+
  '</div>';
}
function r72MarkDirty(action,details={}){
 state.revisions.push({id:'R'+(++state.revisionSeq),key:'roster',action,...details,
  time:new Date().toISOString()});
 state.saved=false;rememberMonth();reanalyze();render();
}
/* Fixed staff are a project default, not a deletion or replacement of current
 * month observations. Never touch frozen snapshots or previously saved months. */
async function r72PersistRoster(){
 const ids=new Set(state.fixedPeople||[]);
 const selected=EMPLOYEES.filter(e=>ids.has(e.id));
 const profile={...(state.projectProfile||{}),schemaVersion:1,pinRoster:true,
  employees:selected.map(e=>({...e})),fixedPeople:selected.map(e=>e.id),
  groups:Object.fromEntries(selected.map(e=>[e.id,groupOf(e)])),
  groupCatalog:[...(state.groupCatalog||[])],savedAt:new Date().toISOString()};
 if(!state.projectDir){state.projectProfile=profile;return}
 try{
  const config=await dir(state.projectDir,'config');
  // Re-read to preserve external changes to import/rules defaults.
  const disk=await readJSON(config,'project-profile.json')||{};
  const merged={...disk,...profile};
  await writeFile(config,'project-profile.json',JSON.stringify(merged,null,2));
  state.projectProfile=merged;
 }catch(e){toast('当前月份已更新，但固定名册写入项目目录失败：'+e.message,true)}
}
async function r72FixedPeople(ids,makeFixed){
 const selected=new Set(state.fixedPeople||[]);
 for(const id of ids)if(EMPLOYEES.some(e=>e.id===id)){
  if(makeFixed)selected.add(id);else selected.delete(id);
 }
 state.fixedPeople=[...selected];
 r72MarkDirty(makeFixed?'fix-people':'unfix-people',{employees:[...ids]});
 await r72PersistRoster();
}
function r72AddPerson(){
 const input=window.prompt('新增人员姓名（姓名唯一）','');if(input===null)return;
 const name=normalizedPerson(input);
 if(!name||name.length>50){toast('姓名须为 1–50 个字符',true);return}
 if(EMPLOYEES.some(e=>normalizedPerson(e.name)===name)){toast('这个姓名已经存在',true);return}
 EMPLOYEES.push({id:personIdentity(name),name,department:'未分类'});
 state.groups[personIdentity(name)]='未分组';state.isDemo=false;
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
 employee.id=newId;employee.name=name;
 state.groups[newId]=state.groups[id]||'未分组';if(id!==newId)delete state.groups[id];
 state.fixedPeople=(state.fixedPeople||[]).map(x=>x===id?newId:x);
 state.manualStatuses=Object.fromEntries(Object.entries(state.manualStatuses||{}).map(([key,v])=>
  [key.startsWith(id+'|')?newId+key.slice(id.length):key,v]));
 state.overtimeReview=Object.fromEntries(Object.entries(state.overtimeReview||{}).map(([key,v])=>
  [key.replace('auto-visit:'+id+':','auto-visit:'+newId+':').replace('auto:'+id+':','auto:'+newId+':'),v]));
 if(state.selection.employeeId===id)state.selection.employeeId=newId;
 r68UI.chosen=new Set([...r68UI.chosen].map(x=>x===id?newId:x));
 r72MarkDirty('rename-person',{employeeId:newId,from:oldName,to:name});
 if((state.fixedPeople||[]).includes(newId))r72PersistRoster();
}
async function r72CreateGroup(){
 const input=window.prompt('新组别名称（1–24 字）','');if(input===null)return;
 const group=String(input).trim();
 if(!group||group.length>24||group==='未分组'||(state.groupCatalog||[]).includes(group)){
  toast('组别名称无效或已经存在',true);return;
 }
 state.groupCatalog=[...(state.groupCatalog||[]),group];
 r72MarkDirty('create-group',{group});await r72PersistRoster();
}
async function r72DeleteGroup(group){
 if(!group||!(state.groupCatalog||[]).includes(group))return;
 const n=EMPLOYEES.filter(e=>groupOf(e)===group).length;
 if(!window.confirm('删除组别「'+group+'」？'+n+' 位现有成员将改为未分组；原始记录不会删除。'))return;
 state.groupCatalog=state.groupCatalog.filter(g=>g!==group);
 for(const e of EMPLOYEES)if(groupOf(e)===group)state.groups[e.id]='未分组';
 if(state.selectedGroup===group)state.selectedGroup='未分组';
 r72MarkDirty('delete-group',{group,reassigned:n});await r72PersistRoster();
}
function r68RulesHtml(){
 const items=[
 ['上午班次',RULES.amStart+' — '+RULES.amEnd],
 ['下午班次',RULES.pmStart+' — '+RULES.pmEnd],
 ['上午打卡容差',RULES.graceAmStart+' / '+RULES.graceAmEnd+' 分钟'],
 ['下午打卡容差',RULES.gracePmStart+' / '+RULES.gracePmEnd+' 分钟'],
 ['重复打卡识别',RULES.dupSeconds+' 秒'],
 ['自动加班保护','晚 '+RULES.overtimeMinMinutes+' 分钟后才计整段'],
 ['手工修订',state.revisions.length+' 次'],
 ['日历调整',Object.keys(state.calendarOverrides||{}).filter(k=>k.startsWith(monthKey())).length+' 天']
 ];
 return r68SidebarHeader('班次与规则','规则按月保存；固定为项目默认后，新月份可直接继承。',
  '<button class="r68-btn" id="r68EditRules">编辑考勤规则</button>')+
  '<div class="r68-rule-grid">'+items.map(([title,value])=>
   '<div><span>'+r68Esc(title)+'</span><strong>'+r68Esc(value)+'</strong></div>').join('')+'</div>'+
  '<div class="r68-note">自动加班：12:00 / 17:30（含）前离开不计；超过门槛后，从 11:40 / 17:10 起完整计时，不扣除 20 分钟。连续跨午休的工作不能当作午间加班。</div>'+
  '<button class="r68-btn" id="r68PinRules">固定本月规则为项目默认</button>';
}
function r68TemplatesHtml(){
 const profile=r62ImportProfile(),templates=profile.templates||{};
 return r68SidebarHeader('导入模板','同列名自动复用映射，不同结构重新识别并可人工指定。')+
  '<div class="r68-template-grid">'+[
   ['attendance','考勤打卡'],['leave','请假'],['trip','出差'],['outing','外出'],['overtime','登记加班']
  ].map(([key,title])=>{
   const t=templates[key];
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
   '<div class="r68-history-row"><span class="r68-history-icon">↧</span><div><strong>'+r68Esc(r.name||'未知文件')+'</strong>'+
   '<small>'+r68Esc(r.type)+' · '+r68Esc(r.importedAt||'时间未知')+'</small></div><span>'+Number(r.count||0)+' 条</span>'+
   r68Pill(r.sha256?'已记录哈希':'无哈希',r.sha256?'healthy':'warning')+'</div>').join('')+'</div>':
   '<div class="r68-empty">本月尚未导入真实文件。模拟数据不会冒充已保存的原件。</div>');
}
function r68FreezeHtml(){
 const month=monthKey(),detail=(r68UI.latestRoot===state.projectDir?r68UI.latestReport:null)?.months?.find(x=>x.key===month);
 const list=detail?.snapshots||[],branches=detail?.branches||[];
 return r68SidebarHeader('冻结与修订','不可变冻结作为基准，派生副本后修改不会覆盖主 working。',
  '<button class="r68-btn" id="r68FreezeNow">冻结当前月</button>')+
  '<div class="r68-snapshot-list">'+(list.length?list.map(s=>
  '<div class="r68-snapshot-row"><div><strong>'+r68Esc(s.id)+'</strong><small>'+r68Esc(s.createdAt||'时间未知')+'</small></div>'+
   r68Pill(s.valid?'已冻结':'已损坏',s.valid?'healthy':'critical')+
   (s.valid?'<button class="r68-inline" data-r68-fork="'+month+'|'+r68Esc(s.id)+'">派生修订</button>':'')+
  '</div>').join(''):'<div class="r68-empty">此月暂无磁盘冻结。请先连接本地项目目录。</div>')+'</div>'+
  '<div class="r68-subtitle">独立修订副本 · '+branches.length+'</div>'+
  branches.map(b=>'<div class="r68-snapshot-row"><strong>'+r68Esc(b.id)+'</strong>'+r68Pill(b.valid?'正常':'损坏',b.valid?'healthy':'critical')+'</div>').join('')+
  '<button class="r68-btn" id="r68OpenProject">查看所有月份与存储</button>';
}
function r68RecordsHtml(){return '<div class="r68-records-head">'+r68SidebarHeader('原始记录','查看实际导入后的各类型表格；不在这里更改原始文件。')+'</div>'+
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
 if(state.workspaceMode==='data')r68RenderData();
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
 const buttons=connected?'<button class="r68-btn" type="button" id="r68ScanAgain">重新扫描</button>'+
  '<button class="r68-btn" type="button" id="r68ProjectBackup">备份 ZIP</button>'+
  '<button class="r68-btn" type="button" id="r68OpenProjectControl">管理项目</button>':'';
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
    '<span><em>'+n+'</em><strong>'+v+'</strong></span>').join('')+'</div>'+
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
  '<div class="r71-project-actions">'+buttons+'</div></header>'+content;
 node.querySelector('#r68ScanAgain')?.addEventListener('click',r69RefreshInventory);
 node.querySelector('#r68ProjectBackup')?.addEventListener('click',()=>p109BackupProject());
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
 if(r69IsProjectSection(section))return '<div class="r71-data-shell">'+
  '<main id="r69ProjectPane" class="r71-data-main"><div class="r68-loading">正在读取项目…</div></main></div>';
 return '<div class="r71-data-shell"><main class="r71-data-main">'+
  '<section id="r68DataContent" class="r71-data-content">'+
  (section==='roster'?r68RosterHtml():section==='rules'?r68RulesHtml():
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
function r68RenderData(){
 const body=document.getElementById('analysisBody');if(!body)return;
 const head=document.getElementById('analysisTitle');if(head)head.textContent='数据管理 · '+monthKey();
 const tools=document.getElementById('analysisHeadTools');if(tools)tools.textContent='';
 if(typeof disposeRawTable==='function')disposeRawTable();
 body.innerHTML=r68DataMarkup();
 const root=body;
 root.querySelector('#r68RosterSearch')?.addEventListener('input',e=>{r68UI.search=e.target.value;r68RefreshDataContent()});
 root.querySelector('#r68RosterFilter')?.addEventListener('change',e=>{r68UI.rosterFilter=e.target.value;r68RefreshDataContent()});
 root.querySelectorAll('[data-r68-person]').forEach(c=>c.onchange=()=>{
  if(c.checked)r68UI.chosen.add(c.dataset.r68Person);else r68UI.chosen.delete(c.dataset.r68Person);
  r68RefreshDataContent()
 });
 root.querySelector('#r68SelectVisible')?.addEventListener('change',e=>{
  r68RosterRows().forEach(p=>e.target.checked?r68UI.chosen.add(p.id):r68UI.chosen.delete(p.id));r68RefreshDataContent()
 });
 root.querySelector('#r68ApplyGroup')?.addEventListener('click',()=>{
  const ids=[...r68UI.chosen].filter(id=>EMPLOYEES.some(e=>e.id===id)),g=root.querySelector('#r68BulkGroup')?.value;
  if(!ids.length||!g)return;
  if(g!=='未分组'&&!(state.groupCatalog||[]).includes(g)){toast('请先创建组别',true);return}
  for(const id of ids)state.groups[id]=g;
  r72MarkDirty('bulk-group',{to:g,employees:ids});
 });
 root.querySelectorAll('[data-r72-person-group]').forEach(select=>select.onchange=()=>{
  const group=select.value;
  if(group!=='未分组'&&!(state.groupCatalog||[]).includes(group))return;
  state.groups[select.dataset.r72PersonGroup]=group;
  r72MarkDirty('assign-group',{employeeId:select.dataset.r72PersonGroup,to:group});
 });
 root.querySelector('#r72AddPerson')?.addEventListener('click',r72AddPerson);
 root.querySelector('#r72AddGroup')?.addEventListener('click',()=>r72CreateGroup());
 root.querySelector('#r72DeleteGroup')?.addEventListener('click',()=>
  r72DeleteGroup(root.querySelector('#r72GroupToRemove')?.value));
 root.querySelector('#r72FixSelected')?.addEventListener('click',()=>
  r72FixedPeople([...r68UI.chosen],true));
 root.querySelector('#r72UnfixSelected')?.addEventListener('click',()=>
  r72FixedPeople([...r68UI.chosen],false));
 root.querySelectorAll('[data-r72-toggle-fixed]').forEach(b=>b.onclick=()=>r72FixedPeople(
  [b.dataset.r72ToggleFixed],!(state.fixedPeople||[]).includes(b.dataset.r72ToggleFixed)));
 root.querySelectorAll('[data-r72-rename]').forEach(b=>b.onclick=()=>r72RenamePerson(b.dataset.r72Rename));
 root.querySelector('#r68EditRules')?.addEventListener('click',()=>document.getElementById('settingsBtn').click());
 for(const [id,kind] of [['r68PinRoster','roster'],['r68PinImport','import'],['r68PinRules','rules']]){
  root.querySelector('#'+id)?.addEventListener('click',async()=>{p109Audit=await p109AuditProject();await p109PinDefaults(kind)});
 }
 root.querySelector('#r68FreezeNow')?.addEventListener('click',()=>freezeSnapshot());
 root.querySelector('#r68OpenProject')?.addEventListener('click',()=>r69NavigateData('months'));
 root.querySelectorAll('[data-r68-fork]').forEach(b=>b.onclick=()=>{
  const [month,id]=b.dataset.r68Fork.split('|');return p109ForkSnapshot(month,id)
 });
 root.querySelector('#r68RailProject')?.addEventListener('click',()=>r69NavigateData('overview'));
 if((state.dataSection||'records')==='records')mountRawTable(state.selection.type==='date'?
  {type:'date',day:state.selection.day,items:[]}:{type:'overall',items:workAnalyses()});
 root.querySelectorAll('.r68-note').forEach(note=>{
  const btn=document.createElement('button');btn.type='button';
  btn.className='r71-help r71-note-help';btn.textContent='ⓘ 说明';
  btn.title=note.textContent.trim();
  btn.setAttribute('aria-label','说明：'+note.textContent.trim());
  note.replaceWith(btn);
 });
 r68FillDataRail();
}
function r68RefreshDataContent(){
 const input=document.activeElement,caret=input?.id==='r68RosterSearch'?input.selectionStart:null;
 r68RenderData();
 if(caret!==null){const next=document.getElementById('r68RosterSearch');next?.focus();next?.setSelectionRange(caret,caret)}
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
    list.push('<details class="r68-tree-dir" '+(depth<1?'open':'')+'><summary>'+r68TreeLine(item.name,'directory')+'</summary>'+
     '<div class="r68-tree-children">'+nested+'</div></details>');
   }else{
    const file=await item.handle.getFile(),size=file.size;
    files++;totalBytes+=size;buckets[bucket]+=size;
    list.push('<div class="r68-tree-file" title="'+r68Esc(pathname)+'">'+r68TreeLine(item.name,'file',r68HumanBytes(size))+'</div>');
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
  else if(tab==='freezes'&&state.dataSection==='freezes')r68RenderData();
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
    '<span>'+m.employees+'</span><span>'+m.raw+'</span><span>'+
     r68Pill(!m.hasWorking?'缺失':m.key===monthKey()&&!state.saved?'待保存':'已保存',m.hasWorking&&(m.key!==monthKey()||state.saved)?'healthy':'warning')+'</span>'+
    '<span>'+r68Pill(m.hasPrevious?'有':'无',m.hasPrevious?'neutral':'warning')+'</span>'+
    '<span>'+m.snapshots.length+'</span><span>'+m.branches.length+'</span>'+
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
   '<div class="r68-filetree r68-overview-tree">'+(connected?r68TreeLine(state.projectDir.name,'directory')+
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
renderDataWorkspace=r68RenderData;
