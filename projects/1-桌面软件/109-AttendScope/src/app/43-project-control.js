/* P109 R65: offline-first project control. Audit is read-only; repairs are opt-in.
 * All data and native folder operations occur on the user's device. */
'use strict';
const P109_DATA_SCHEMA=2;
const P109_APP_VERSION='0.2.1-preview';
let p109Audit=null,p109PendingDirectory=null,p109ProjectBusy=false;
function p109Escape(x){return escapeNameChar(String(x??''))}
function p109Status(msg,error=false){toast(msg,error)}
function p109Issue(issues,level,code,where,message,fix=''){
 issues.push({level,code,where,message,fix});
}
async function p109Entries(handle){
 if(!handle)return [];
 const entries=[];for await(const [name,item] of handle.entries())entries.push({name,kind:item.kind,handle:item});
 return entries;
}
async function p109Child(handle,name){try{return await handle.getDirectoryHandle(name,{create:false})}
 catch(e){if(e.name==='NotFoundError')return null;throw e}}
async function p109File(handle,name){try{return await handle.getFileHandle(name,{create:false})}
 catch(e){if(e.name==='NotFoundError')return null;throw e}}
async function p109Json(handle,name){
 const h=handle&&await p109File(handle,name);
 if(!h)return {exists:false,value:null};
 try{return {exists:true,value:JSON.parse(await (await h.getFile()).text())}}
 catch(e){return {exists:true,error:'JSON 无法解析：'+e.message,value:null}}
}
function p109KnownMonth(x){return /^\d{4}-(0[1-9]|1[0-2])$/.test(x)}
function p109Same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
async function p109AuditProject(root=state.projectDir){
 const report={at:new Date().toISOString(),connected:!!root,initialized:false,months:[],
  issues:[],orphans:[],monthIndex:[],detectedMonths:[],snapshotCount:0,rawFileCount:0,
  rootName:root?.name||'',appVersion:P109_APP_VERSION,safeIndexRepair:[],configuration:{},verifiedRaw:0,unverifiedRaw:0};
 if(!root){p109Issue(report.issues,'info','NO_DIRECTORY','项目','尚未连接本地项目目录','连接或初始化项目');return report}
 const [project,data,config]=await Promise.all([p109Json(root,'project.json'),p109Child(root,'data'),p109Child(root,'config')]);
 if(!project.exists){
  const entries=await p109Entries(root);
  p109Issue(report.issues,entries.length?'warning':'info','UNINITIALIZED','项目',
   entries.length?'目录里有文件，但缺少 project.json；请检查是否选对项目根目录':'尚未初始化项目',
   '先确认目录用途，再执行初始化。不会覆盖任何现有文件');
  return report;
 }
 if(project.error){p109Issue(report.issues,'critical','INVALID_PROJECT','project.json',project.error,'手动恢复有效版本');return report}
 const meta=project.value;
 if(meta?.projectId!=='P109-AttendScope'){
  p109Issue(report.issues,'critical','WRONG_PROJECT','project.json','项目身份不符，拒绝整理和修改');return report
 }
 report.initialized=true;report.meta=meta;report.activeBranch=meta.activeBranch||null;report.monthIndex=Array.isArray(meta.months)?
  meta.months.filter(p109KnownMonth):[];
 report.schemaVersion=meta.schemaVersion;
 if(Number(meta.schemaVersion)>P109_DATA_SCHEMA)
  p109Issue(report.issues,'critical','NEWER_SCHEMA','project.json','数据结构版本高于本软件支持版本，请换用较新软件');
 if(!data)p109Issue(report.issues,'warning','NO_DATA','data/','缺少数据目录，可从备份恢复或建立空白月份');
 const rules=await p109Json(config,'work_rules.json'),people=await p109Json(config,'employees.json'),profile=await p109Json(config,'project-profile.json');
 report.configuration={legacyRules:!!rules.exists,legacyPeople:!!people.exists,
   pinnedRoster:profile.value?.pinRoster===true,pinnedImport:profile.value?.pinImport===true,pinnedRules:profile.value?.pinRules===true,
   template:profile.value?.importProfile?.templates?Object.keys(profile.value.importProfile.templates):[]};
 for(const [name,obj] of [['work_rules.json',rules],['employees.json',people],['project-profile.json',profile]])
  if(obj.error)p109Issue(report.issues,'warning','BROKEN_CONFIG','config/'+name,obj.error);
 if(rules.value?.morning&&!rules.value.amStart)
  p109Issue(report.issues,'warning','LEGACY_RULES','config/work_rules.json',
   '发现旧版嵌套班次配置，当前程序可能使用 working 中的规则。以月份 working 为准，升级前需核对');
 const years=await p109Entries(data),discovered=new Set();
 for(const yr of years.filter(x=>x.kind==='directory'&&/^\d{4}$/.test(x.name))){
  for(const mn of (await p109Entries(yr.handle)).filter(x=>x.kind==='directory'&&/^(0[1-9]|1[0-2])$/.test(x.name))){
   const key=yr.name+'-'+mn.name;discovered.add(key);
   const m={key,hasWorking:false,hasPrevious:false,raw:0,snapshots:[],branches:[],revisions:0,
    imports:0,employees:0,issues:[],state:'无工作状态'};
   const work=await p109Child(mn.handle,'working'),raw=await p109Child(mn.handle,'raw'),
    snapshots=await p109Child(mn.handle,'snapshots'),branches=await p109Child(mn.handle,'branches');
   const current=await p109Json(work,'state.json'),previous=await p109Json(work,'state.previous.json');
   m.hasWorking=current.exists&&!current.error&&!!current.value?.records;
   m.hasPrevious=previous.exists&&!previous.error&&!!previous.value?.records;
   if(current.error)p109Issue(report.issues,'critical','BROKEN_WORKING',
    'data/'+yr.name+'/'+mn.name+'/working/state.json',current.error,
    m.hasPrevious?'存在上次保存版本，请检查后手动恢复':'请使用完整项目备份恢复');
   if(previous.error)p109Issue(report.issues,'warning','BROKEN_PREVIOUS',key,previous.error);
   let payload=m.hasWorking?current.value:m.hasPrevious?previous.value:null;
   if(payload){
    m.imports=Array.isArray(payload.imports)?payload.imports.length:0;
    m.employees=Array.isArray(payload.employees)?payload.employees.length:0;
    m.revisions=Array.isArray(payload.revisions)?payload.revisions.length:0;
    m.state=m.hasWorking?'已保存': '仅有备用状态';
    if(Number(payload.schemaVersion)>P109_DATA_SCHEMA)p109Issue(report.issues,'critical','NEWER_MONTH',key,'此月工作状态来自更高数据版本');
    if(payload.year!==Number(yr.name)||payload.month!==Number(mn.name))
     p109Issue(report.issues,'critical','MONTH_MISMATCH',key,'工作文件内部年月与所在文件夹不一致');
    if(!Array.isArray(payload.employees))
     p109Issue(report.issues,'warning','NO_ROSTER',key,'工作文件缺少人员名册');
    const names=new Set(),ids=new Set();
    for(const e of payload.employees||[]){
     const normalized=String(e.name||'').normalize('NFKC').trim();
     if(!normalized||names.has(normalized)||ids.has(e.id))
      p109Issue(report.issues,'warning','DUPLICATE_NAME',key,'人员名册存在空姓名/重复姓名或重复 ID，请人工检查');
     names.add(normalized);ids.add(e.id);
    }
   }else if(current.exists||previous.exists){m.state='工作状态损坏'}
   if(!payload){
    p109Issue(report.issues,'warning','MISSING_WORKING',key,'存在月份目录但没有可读取的 working 状态');
   }
   if(raw)for(const type of (await p109Entries(raw)).filter(x=>x.kind==='directory')){
    for(const imp of (await p109Entries(type.handle)).filter(x=>x.kind==='directory')){
     const originals=(await p109Entries(imp.handle)).filter(x=>x.kind==='file');
     m.raw+=originals.length;report.rawFileCount+=originals.length;
     const listed=payload?.imports?.some(z=>z.id===imp.name&&z.type===type.name);
     if(payload&&!listed){
      report.orphans.push({month:key,type:type.name,id:imp.name,files:originals.map(x=>x.name)});
      p109Issue(report.issues,'warning','UNLISTED_RAW',key,
       '发现未登记原始目录 '+type.name+'/'+imp.name+'；只提示，不自动删改');
     }
    }
   }
   for(const imp of payload?.imports||[]){
    const sub=raw&&await p109Child(raw,imp.type),folder=sub&&await p109Child(sub,imp.id);
    const original=folder&&await p109File(folder,imp.name);
    if(!original)p109Issue(report.issues,'critical','MISSING_RAW',key,
     '导入清单缺失原文件 '+imp.type+'/'+imp.id+'/'+imp.name,'从完整备份找回');
    else if(imp.sha256){
     const file=await original.getFile();
     if(file.size<=16*1024*1024&&report.verifiedRaw<120){
      const digest=await p109Hash(new Uint8Array(await file.arrayBuffer()));report.verifiedRaw++;
      if(digest!==imp.sha256)p109Issue(report.issues,'critical','RAW_HASH_MISMATCH',key,
       '原文件校验不一致：'+imp.name,'检查历史完整备份，不要覆盖');
     }else report.unverifiedRaw++;
    }else report.unverifiedRaw++;
   }
   if(snapshots)for(const item of (await p109Entries(snapshots)).filter(x=>x.kind==='directory')){
    const snap=await p109Json(item.handle,'snapshot.json');
    m.snapshots.push({id:item.name,valid:!!snap.value?.working&&!snap.error,createdAt:snap.value?.manifest?.createdAt||'',parent:snap.value?.manifest?.parentSnapshot||null});
    report.snapshotCount++;
    if(!snap.value?.working||snap.error)
     p109Issue(report.issues,'critical','BROKEN_SNAPSHOT',key+'/'+item.name,'冻结文件无效或损坏');
    else if(snap.value.manifest?.snapshotId!==item.name||
      snap.value.manifest?.year!==Number(yr.name)||snap.value.manifest?.month!==Number(mn.name))
     p109Issue(report.issues,'warning','SNAPSHOT_MISMATCH',key+'/'+item.name,'快照标识或月份元数据不一致');
   }
   if(branches)for(const br of (await p109Entries(branches)).filter(x=>x.kind==='directory')){
    const work=await p109Child(br.handle,'working'),saved=await p109Json(work,'state.json');
    m.branches.push({id:br.name,valid:!!saved.value?.records&&!saved.error});
    if(!saved.value?.records||saved.error)p109Issue(report.issues,'warning','BROKEN_BRANCH',key+'/'+br.name,
      '独立修订工作区损坏或没有保存文件');
   }
   if(meta.activeBranch?.month===key&&!m.branches.some(x=>x.id===meta.activeBranch.id&&x.valid))
    p109Issue(report.issues,'critical','MISSING_ACTIVE_BRANCH',key,'当前选中的独立修订分支缺失');
   report.months.push(m);
  }
 }
 report.detectedMonths=[...discovered].sort();
 report.safeIndexRepair=report.detectedMonths.filter(x=>!report.monthIndex.includes(x)&&
  report.months.find(m=>m.key===x)?.hasWorking);
 for(const key of report.safeIndexRepair)
  p109Issue(report.issues,'warning','UNINDEXED_MONTH',key,'存在有效工作状态，但项目月份索引没有登记','可以安全补全项目索引');
 for(const key of report.monthIndex.filter(x=>!discovered.has(x)))
  p109Issue(report.issues,'warning','MISSING_MONTH_DIRECTORY',key,'项目月份索引列出了不存在的目录；不会自动删除索引');
 if(meta.current){
  const active=meta.current.year+'-'+pad(meta.current.month);
  if(!discovered.has(active))p109Issue(report.issues,'warning','MISSING_CURRENT',active,'首页当前月份在磁盘上不存在');
 }
 report.months.sort((a,b)=>b.key.localeCompare(a.key));
 report.level=report.issues.some(i=>i.level==='critical')?'critical':
  report.issues.some(i=>i.level==='warning')?'warning':'healthy';
 return report;
}
function p109Count(report,level){return report.issues.filter(i=>i.level===level).length}
function p109ProjectView(report){
 const level=report.level||(!report.initialized?'uninitialized':'healthy');
 const name={critical:'有严重问题',warning:'需要检查',healthy:'状态正常',uninitialized:'等待初始化'}[level]||'未连接';
 return '<section class="p109-project-overlay" role="dialog" aria-modal="true" aria-labelledby="p109ProjectHeading">'+
  '<div class="p109-project-panel"><header><div><strong id="p109ProjectHeading">项目管理</strong>'+
  '<p>项目状态 · 只读健康扫描 · 备份与恢复</p></div><button type="button" id="p109ProjectClose" aria-label="关闭">×</button></header>'+
  '<div class="p109-project-body"><div class="p109-project-summary"><span class="p109-health '+p109Escape(level)+'">'+p109Escape(name)+'</span>'+
   '<strong>'+report.months.length+' 个月份</strong><strong>'+report.snapshotCount+' 个冻结</strong>'+
   '<strong>'+report.rawFileCount+' 份原文件</strong></div>'+
  '<p class="p109-project-desc">'+(report.connected?'当前目录：'+p109Escape(report.rootName)+' · '+periodText()+' '+(state.saved?'工作已保存':'有未保存修改')+' · 原文件校验 '+report.verifiedRaw+' / 未核 '+report.unverifiedRaw:
   '未连接本地目录。当前为演示/内存工作区，无法确定磁盘上有哪些工作状态。')+'</p>'+
  (!report.initialized?'<div class="p109-project-init"><p>本项目尚未初始化。可创建空白工作区，或连接已有项目目录；不修改任何未识别文件。</p>'+
   '<div class="p109-project-actions"><button id="p109CreateBlank" type="button" class="primary-btn" '+(!report.connected?'disabled':'')+'>初始化空白项目</button>'+
   '<button id="p109PickExisting" type="button">选择项目目录</button></div></div>':'')+
  '<div class="p109-project-section"><div class="p109-project-rowtitle"><b>月份与冻结状态</b><span>'+report.months.length+' 个月份</span></div>'+
   (report.months.length?'<div class="p109-project-months">'+report.months.map(m=>
    '<div class="p109-project-month"><b>'+p109Escape(m.key)+'</b><span>'+p109Escape(m.state)+'</span>'+
    '<small>'+m.employees+' 人 · '+m.imports+' 次导入 · '+m.revisions+' 项修订 · '+(m.hasPrevious?'有上次保存 · ':'无备用状态 · ')+m.snapshots.length+' 次冻结'+
    (m.branches.length?' · '+m.branches.length+' 个修订副本':'')+'</small>'+
    (m.snapshots.length?'<details class="p109-snapshots"><summary>查看冻结版本（'+m.snapshots.length+'）</summary>'+
       m.snapshots.map(s=>'<div class="p109-snapshot-row"><code>'+p109Escape(s.id)+'</code><small>'+
        p109Escape(s.createdAt? s.createdAt.slice(0,19).replace('T',' ') : '日期未知')+
        (s.parent?' · 源于 '+p109Escape(s.parent):'')+'</small>'+
        (s.valid?'<button type="button" data-p109-fork="'+p109Escape(m.key)+'|'+p109Escape(s.id)+'">派生修订</button>':'<span>损坏</span>')+'</div>').join('')+'</details>':'')+
    '</div>').join('')+'</div>':
    '<p class="p109-empty">没有在本地项目目录中发现已保存的月份。</p>')+'</div>'+
  '<div class="p109-project-section"><div class="p109-project-rowtitle"><b>健康检查</b><span>'+
    p109Count(report,'critical')+' 严重 · '+p109Count(report,'warning')+' 提醒</span></div>'+
   (report.issues.length?'<div class="p109-project-issues">'+report.issues.map(x=>
    '<div class="p109-project-issue '+p109Escape(x.level)+'"><b>'+p109Escape(x.message)+'</b>'+
    '<small>'+p109Escape(x.where)+(x.fix?' · '+p109Escape(x.fix):'')+'</small></div>').join('')+'</div>':
    '<p class="p109-empty">未发现已检查项目结构的问题。原文件哈希与 Windows 权限须单独验证。</p>')+'</div>'+
  '<div class="p109-project-section"><div class="p109-project-rowtitle"><b>下月默认配置</b><span>可选固定，不强制</span></div>'+
   '<div class="p109-project-actions"><button id="p109PinRoster" type="button" '+(!report.initialized?'disabled':'')+'>'+
    (report.configuration.pinnedRoster?'✓ 名册已固定 · 更新':'固定当前名册')+'</button>'+
    '<button id="p109PinImport" type="button" '+(!report.initialized?'disabled':'')+'>'+
    (report.configuration.pinnedImport?'✓ 导入规则已固定 · 更新':'固定当前导入规则')+'</button>'+ 
    '<button id="p109PinRules" type="button" '+(!report.initialized?'disabled':'')+'>'+ 
    (report.configuration.pinnedRules?'✓ 考勤规则已固定 · 更新':'固定当前考勤规则')+'</button></div>'+
    '<p class="p109-project-desc">固定后供新建月份使用；不会回写历史月份或修改原始文件。仅点击确认时保存。</p></div>'+
  (report.activeBranch?'<div class="p109-branch-status">当前正在编辑独立修订副本 '+
   p109Escape(report.activeBranch.id)+' · 不覆盖原月份 working <button type="button" id="p109ReturnMain">返回主工作状态</button></div>':'')+
  '<div class="p109-project-section"><div class="p109-project-rowtitle"><b>安全管理</b><span>不会自动改写原始记录或冻结</span></div>'+
   '<div class="p109-project-actions"><button id="p109Rescan" type="button">重新检测</button>'+
    '<button id="p109Backup" type="button" '+(!report.initialized?'disabled':'')+'>备份整个项目 ZIP</button>'+
    '<button id="p109RestoreZip" type="button">从 ZIP 恢复</button>'+ 
    '<button id="p109UpgradeCode" type="button" '+(!report.initialized?'disabled':'')+'>安全更新程序</button>'+
    '<button id="p109RepairIndex" type="button" '+(!report.safeIndexRepair.length?'disabled':'')+'>补全月份索引（'+report.safeIndexRepair.length+'）</button></div>'+
    '<p class="p109-project-desc">自动整理仅补充确认存在的有效月份索引；缺失原件、数据冲突、损坏快照均只报告，不擅自合并。</p></div>'+
  '</div><footer><span>运行版本 '+P109_APP_VERSION+' · 数据结构 v'+P109_DATA_SCHEMA+'</span>'+
   '<button type="button" id="p109ProjectDone">完成</button></footer></div></section>';
}
async function openProjectControl(mode='scan'){
 if(p109ProjectBusy)return;
 document.querySelector('.p109-project-overlay')?.remove();
 const parent=document.createElement('div');parent.className='p109-project-overlay';
 parent.innerHTML='<div class="p109-project-loading">正在检查项目目录…</div>';document.body.appendChild(parent);
 try{
  const report=await p109AuditProject(p109PendingDirectory||state.projectDir);
  p109Audit=report;
  parent.outerHTML=p109ProjectView(report);
  const root=document.querySelector('.p109-project-overlay');
  const close=()=>root?.remove();
  root.querySelector('#p109ProjectClose').onclick=close;
  root.querySelector('#p109ProjectDone').onclick=close;
  root.querySelector('#p109Rescan').onclick=()=>openProjectControl();
  root.querySelector('#p109PickExisting')?.addEventListener('click',async()=>{close();await connectProjectDir()});
  root.querySelector('#p109CreateBlank')?.addEventListener('click',async()=>{
   close();await p109InitializeProject(p109PendingDirectory||state.projectDir)
  });
  root.querySelector('#p109Backup').onclick=()=>p109BackupProject();
  root.querySelector('#p109PinRoster').onclick=()=>p109PinDefaults('roster');
  root.querySelector('#p109PinImport').onclick=()=>p109PinDefaults('import');
  root.querySelector('#p109PinRules').onclick=()=>p109PinDefaults('rules');
  root.querySelector('#p109RestoreZip').onclick=()=>p109RestoreArchive();
  root.querySelector('#p109UpgradeCode').onclick=()=>p109UpgradePick();
  root.querySelector('#p109RepairIndex').onclick=()=>p109RepairIndex(report);
  root.querySelectorAll('[data-p109-fork]').forEach(btn=>btn.onclick=async()=>{
    const [month,id]=btn.dataset.p109Fork.split('|');await p109ForkSnapshot(month,id)
  });
  root.querySelector('#p109ReturnMain')?.addEventListener('click',()=>p109ReturnToMain());
  root.addEventListener('click',e=>{if(e.target===root)close()});
 }catch(e){document.querySelector('.p109-project-overlay')?.remove();p109Status('项目扫描失败：'+e.message,true)}
}
async function p109InitializeProject(root){
 if(!root){p109Status('请先选择用于存放项目的文件夹',true);return}
 const entries=await p109Entries(root);
 const known=await p109Json(root,'project.json');
 if(known.exists){p109Status('这个文件夹已有 project.json，请使用「目录」连接，不能重复初始化',true);return}
 if(entries.length&&!window.confirm('目标文件夹不为空，且缺少项目标识。只新增项目所需文件，绝不覆盖现有文件。确定继续初始化？'))return;
 if(!window.confirm('建立全新的空白考勤项目？演示员工与考勤不会复制到新项目。'))return;
 p109ProjectBusy=true;
 try{
  state.projectDir=root; p109PendingDirectory=null;
  EMPLOYEES=[];state.records=[];state.leaves=[];state.trips=[];state.outings=[];
  state.overtimeEntries=[];state.imports=[];state.revisions=[];state.revisionSeq=0;
  state.manualStatuses={};state.overtimeReview={};state.groups={};state.fixedPeople=[];state.nameAliases={};state.groupCatalog=[];state.projectProfile=null;state.isDemo=false;
  state.monthStores=new Map();state.saved=false;
  state.importProfile={rules:R62_DEFAULT_DIRECTIONS.map(x=>({...x})),templates:{}};
  state.calendarOverrides={};state.selection={type:'overall'};
  rememberMonth();reanalyze();
  await ensureProjectSkeleton();
  const cfg=await dir(root,'config');
  await writeFile(cfg,'employees.json',JSON.stringify({schemaVersion:2,employees:[]},null,2));
  await writeFile(cfg,'work_rules.json',JSON.stringify({schemaVersion:1,...RULES},null,2));
  await writeFile(cfg,'project-profile.json',JSON.stringify({schemaVersion:1,pinRoster:false,pinImport:false},null,2));
  await saveWorking();
  render();p109Status('空白项目已初始化并保存，可以开始导入'); 
 }catch(e){p109Status('初始化失败，请检查目录权限：'+e.message,true)}
 finally{p109ProjectBusy=false}
}


async function p109ForkSnapshot(month,snapshotId){
 if(!state.projectDir||!p109KnownMonth(month)||!/^F[a-z0-9-]+$/i.test(snapshotId))return;
 if(!state.saved&&!window.confirm('当前存在未保存工作，请先保存；放弃这些修改并从冻结版本建立独立副本？'))return;
 if(!window.confirm('根据 '+month+' 的冻结 '+snapshotId+' 创建独立修订工作区？主 working 和原快照将保持不变。'))return;
 try{
  const [yr,mo]=month.split('-'),m=await monthDirectory(Number(yr),Number(mo)),
   snaps=await existingDir(m,'snapshots'),folder=await existingDir(snaps,snapshotId),
   snap=await readJSON(folder,'snapshot.json');
  if(!snap?.working||snap.manifest?.snapshotId!==snapshotId||
    snap.manifest.year!==Number(yr)||snap.manifest.month!==Number(mo))
   throw Error('冻结来源不合法或已经损坏');
  const normalized=normalizeSavedMonth(snap.working);
  if(!normalized)throw Error('快照数据结构不兼容，不能派生副本');
  const branches=await dir(m,'branches'),id='B'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),
   ref={id,month,parentSnapshotId:snapshotId};
  const exists=await p109Child(branches,id);if(exists)throw Error('修订标识发生冲突，已中止');
  const branch=await dir(branches,id),work=await dir(branch,'working');
  const manifest={schemaVersion:1,...ref,createdAt:new Date().toISOString(),appVersion:P109_APP_VERSION};
  await writeFile(branch,'branch.json',JSON.stringify(manifest,null,2));
  await writeFile(work,'state.json',JSON.stringify({...snap.working,context:'branch',branch:ref},null,2));
  rememberMonth();
  state.monthStores.set(month,{...normalized,activeBranch:ref,saved:true});
  switchMonth(Number(yr),Number(mo),false,false);
  state.activeBranch=ref;
  await writeFile(state.projectDir,'project.json',JSON.stringify(projectPayload(),null,2));
  document.querySelector('.p109-project-overlay')?.remove();
  p109Status('已创建独立修订 '+id+'，后续保存不会修改原工作状态');
 }catch(e){p109Status('派生快照失败：'+e.message,true)}
}
async function p109ReturnToMain(){
 const ref=state.activeBranch;
 if(!ref||!state.projectDir)return;
 if(!state.saved&&!window.confirm('独立副本有未保存修改；放弃并返回主工作状态？'))return;
 try{
  const [y,m]=ref.month.split('-'),folder=await monthDirectory(Number(y),Number(m)),
   working=await existingDir(folder,'working'),source=await readJSON(working,'state.json'),
   main=normalizeSavedMonth(source);
  if(!main)throw Error('主 working 不完整，拒绝切换');
  rememberMonth();
  state.monthStores.set(ref.month,{...main,activeBranch:null,saved:true});
  switchMonth(Number(y),Number(m),false,false);
  state.activeBranch=null;
  await writeFile(state.projectDir,'project.json',JSON.stringify(projectPayload(),null,2));
  document.querySelector('.p109-project-overlay')?.remove();
  p109Status('已返回主工作状态，独立修订副本仍保存在磁盘');
 }catch(e){p109Status('返回主状态失败：'+e.message,true)}
}

async function p109PinDefaults(kind){
 if(!state.projectDir||!p109Audit?.initialized)return;
 const label=kind==='roster'?'已选固定人员和组别':kind==='rules'?'考勤时段与加班规则':'导入关键字及列映射模板';
 if(!window.confirm('将本月'+label+'固定为以后新建月份的默认配置？历史月份保持原样。'))return;
 try{
  const config=await dir(state.projectDir,'config');
  const profile=(await p109Json(config,'project-profile.json')).value||{schemaVersion:1};
  if(kind==='roster'){
   profile.pinRoster=true;profile.employees=EMPLOYEES.filter(e=>(state.fixedPeople||[]).includes(e.id)).map(e=>({...e}));
   profile.fixedPeople=profile.employees.map(e=>e.id);
   profile.groups=Object.fromEntries(profile.employees.map(e=>[e.id,groupOf(e)]));
   profile.groupCatalog=[...(state.groupCatalog||[])];
  }else if(kind==='rules'){
   profile.pinRules=true;profile.workRules={...RULES};
  }else{
   profile.pinImport=true;
   profile.importProfile=structuredClone(r62ImportProfile());
  }
  profile.savedAt=new Date().toISOString();
  await writeFile(config,'project-profile.json',JSON.stringify(profile,null,2));
  state.projectProfile=profile;
  p109Status('已固定当前'+label+'，可在后续月份复用');
  await openProjectControl();
 }catch(e){p109Status('固定配置失败：'+e.message,true)}
}

async function p109RepairIndex(report=p109Audit){
 if(!report?.initialized||!report.safeIndexRepair?.length||!state.projectDir)return;
 const targets=report.safeIndexRepair.slice();
 if(!window.confirm('即将把磁盘上已存在的 '+targets.length+' 个有效月份补入 project.json 索引。不会删除其他月份或修改任何 working/raw/snapshot。是否继续？'))return;
 try{
  const root=state.projectDir,meta=await p109Json(root,'project.json');
  if(!meta.value||meta.value.projectId!=='P109-AttendScope')throw Error('项目身份验证失败');
  const current=new Set((meta.value.months||[]).filter(p109KnownMonth));
  targets.forEach(x=>current.add(x));
  const previous=await p109File(root,'project.index.previous.json');
  if(previous)throw Error('已有索引安全备份，请人工保存并移走后再次整理，避免覆盖旧备份');
  await writeFile(root,'project.index.previous.json',JSON.stringify(meta.value,null,2));
  await writeFile(root,'project.json',JSON.stringify({...meta.value,months:[...current].sort(),updatedAt:new Date().toISOString()},null,2));
  p109Status('已补全 '+targets.length+' 个月份索引，原始数据未修改');
  await openProjectControl();
 }catch(e){p109Status('整理失败：'+e.message,true)}
}
async function p109ArchiveWalk(folder,prefix,files,limits){
 for(const item of await p109Entries(folder)){
  if(item.name==='.'||item.name==='..'||item.name.includes('/')||item.name.includes('\\'))throw Error('不安全的文件名');
  if(item.kind==='directory'){
   if(!prefix&&item.name==='backups')continue; // no recursive backup amplification
   await p109ArchiveWalk(item.handle,prefix+item.name+'/',files,limits);continue
  }
  const file=await item.handle.getFile();limits.bytes+=file.size;limits.count++;
  if(limits.count>5000||limits.bytes>160*1024*1024)throw Error('项目过大（上限 5000 文件或 160 MB），请通过系统文件管理器整体压缩');
  files.push({name:prefix+item.name,data:new Uint8Array(await file.arrayBuffer())});
 }
}
async function p109BackupProject(){
 if(!state.projectDir||p109ProjectBusy)return;
 p109ProjectBusy=true;
 try{
  const audit=await p109AuditProject();
  if(!audit.initialized)throw Error('项目尚未初始化');
  if(!state.saved&&
   !window.confirm('当前月份仍有未保存修改。备份只包含磁盘上已保存的内容，建议先保存。继续备份？'))return;
  const files=[],limits={count:0,bytes:0};
  await p109ArchiveWalk(state.projectDir,'',files,limits);
  const {zip,manifest}=await p109ZipBuild(files);
  downloadBlob(zip,r63FileStem()+'_项目备份_'+new Date().toISOString().slice(0,10)+'.zip');
  p109Status('已导出完整项目备份：'+limits.count+' 个文件（包含代码时可直接迁移）');
  return manifest;
 }catch(e){p109Status('备份失败：'+e.message,true)}
 finally{p109ProjectBusy=false}
}
async function p109RestoreArchive(){
 if(!window.showDirectoryPicker){p109Status('该浏览器不支持写入本地目录',true);return}
 let target;
 try{target=await showDirectoryPicker({mode:'readwrite'});
  if((await p109Entries(target)).length)throw Error('恢复仅允许选择空目录，防止覆盖已有项目');
 }catch(e){if(e.name!=='AbortError')p109Status('选择恢复目录失败：'+e.message,true);return}
 const chooser=document.createElement('input');chooser.type='file';chooser.accept='.zip,application/zip';
 chooser.onchange=async()=>{
  const file=chooser.files?.[0];if(!file)return;
  p109ProjectBusy=true;
  try{
   if(file.size>180*1024*1024)throw Error('备份包过大，请先通过系统文件管理器处理');
   const unpacked=await p109ZipRead(file);
   const manifest=unpacked.find(x=>x.name==='p109-backup-manifest.json');
   if(!manifest)throw Error('缺少 P109 完整备份清单，拒绝恢复普通 ZIP');
   const info=JSON.parse(new TextDecoder().decode(manifest.data));
   if(info.projectId!=='P109-AttendScope'||info.schemaVersion!==1)throw Error('备份项目标识或格式不匹配');
   const payload=unpacked.filter(x=>x!==manifest);
   if(payload.length!==info.files.length)throw Error('文件数量不一致');
   for(const f of payload){
    const entry=info.files.find(x=>x.path===f.name);
    if(!entry||entry.bytes!==f.data.byteLength||entry.sha256!==(await p109Hash(f.data)))throw Error('备份校验失败：'+f.name);
   }
   const root=target;
   if((await p109Entries(root)).length)throw Error('恢复目录不再为空，拒绝覆盖');
   if(!window.confirm('已校验备份 '+payload.length+' 个文件。即将恢复到所选空目录。继续？'))return;
   for(const f of payload){
    const parts=f.name.split('/'),fileName=parts.pop();let folder=root;
    for(const part of parts)folder=await dir(folder,part);
    await writeFile(folder,fileName,f.data);
   }
   p109PendingDirectory=null;state.projectDir=null;
   p109Status('完整备份恢复完成。请用「目录」重新连接恢复后的项目');
  }catch(e){p109Status('恢复中止：'+e.message,true)}
  finally{p109ProjectBusy=false}
 };
 chooser.click();
}
async function p109Hash(bytes){
 if(!crypto?.subtle)throw Error('当前浏览器不支持 SHA-256，无法安全备份或还原');
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function p109ZipBuild(files){
 const manifest={schemaVersion:1,projectId:'P109-AttendScope',exportedAt:new Date().toISOString(),
  files:[]};
 for(const f of files)manifest.files.push({path:f.name,bytes:f.data.length,sha256:await p109Hash(f.data)});
 const body=XLSX.writeArchive([...files,{name:'p109-backup-manifest.json',data:JSON.stringify(manifest,null,2)}]);
 return {zip:new Blob([body],{type:'application/zip'}),manifest};
}
async function p109ZipRead(file){
 const data=new Uint8Array(await file.arrayBuffer()),view=new DataView(data.buffer);
 const td=new TextDecoder(),files=[],unique=new Set();let cursor=0;
 const u16=x=>view.getUint16(x,true),u32=x=>view.getUint32(x,true);
 while(cursor+4<data.length&&u32(cursor)===0x04034b50){
  if(cursor+30>data.length)throw Error('ZIP 头部损坏');
  const flags=u16(cursor+6),method=u16(cursor+8),compressed=u32(cursor+18),
   namelen=u16(cursor+26),extra=u16(cursor+28),size=u32(cursor+22);
  if(method!==0||(flags&8)||size!==compressed)throw Error('仅接受本软件生成的无压缩完整项目备份');
  const begin=cursor+30+namelen+extra;
  if(begin>data.length||begin+size>data.length)throw Error('ZIP 文件长度异常');
  const name=td.decode(data.subarray(cursor+30,cursor+30+namelen));
  if(!name||name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..')||/^[A-Za-z]:/.test(name))throw Error('ZIP 包含不安全路径');
  if(unique.has(name))throw Error('ZIP 内存在重复文件路径：'+name);
  unique.add(name);
  if(files.length>=5000)throw Error('超过恢复文件数上限');
  files.push({name,data:data.slice(begin,begin+size)});
  cursor=begin+size;
 }
 if(!files.length)throw Error('没有识别到备份文件');
 return files;
}
