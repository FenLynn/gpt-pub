/* P109 R37: four workspaces share the existing analyses, model and evidence table.
   No separate data copy or duplicate timeline implementation. */
const WORKSPACE_ITEMS=[
 ['all','全员分析','users'],
 ['group','分组分析','layers'],
 ['person','个人分析','person'],
 ['data','数据管理','database']
];
function workspaceGroups(){
 return [...new Set(EMPLOYEES.map(e=>groupOf(e)))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
}
function workspaceNavHtml(){
 return WORKSPACE_ITEMS.map(([id,label])=>
  '<button type="button" data-workspace="'+id+'" class="'+(state.workspaceMode===id?'active':'')+'" aria-current="'+(state.workspaceMode===id?'page':'false')+'">'+label+'</button>'
 ).join('');
}

/* Modern pages reuse one data model and route page-scoped controls into the sidebar. */
function scopeVisibleEmployees(){
 const query=String(state.scopeSearch||'').trim().toLocaleLowerCase();
 let people=state.workspaceMode==='group'?EMPLOYEES.filter(e=>groupOf(e)===state.selectedGroup):EMPLOYEES;
 if(query)people=people.filter(e=>(e.name+' '+e.id+' '+e.department+' '+groupOf(e)).toLocaleLowerCase().includes(query));
 if(state.attentionOnly)people=people.filter(e=>[...state.analysis.values()].some(a=>a.employee.id===e.id&&isWorkday(a.day)&&['anomaly','absent'].includes(attendanceJudgment(a))));
 return people;
}
function sidebarFilterHtml(){
 const options=[['main','常规'],['normal','正常'],['anomaly','异常'],['absent','缺勤'],['overtime','加班'],['leave','请假'],['trip','出差'],['outing','外出']];
 return '<section class="side-filter state-select-wrap"><label class="side-label" for="statusFilter">状态筛选</label>'+
  '<div class="status-filter-control"><button type="button" id="statusFilterButton" class="status-filter-button" aria-expanded="false">'+statusFilterLabel(state.filter)+'</button>'+
  '<div id="statusFilterMenu" class="status-filter-menu" role="listbox">'+statusFilterMenuHtml()+'</div>'+
  '<select id="statusFilter" class="status-filter-native" aria-label="状态筛选">'+
  options.map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select></div>'+
  '<div class="side-label">判定视图</div><div class="judgment-mode-switch" id="judgmentModeSwitch" aria-label="判断显示模式">'+
  '<button type="button" data-judgment-mode="initial" class="'+(state.judgmentMode!=='manual'?'active':'')+'">初始</button>'+
  '<button type="button" data-judgment-mode="manual" class="'+(state.judgmentMode==='manual'?'active':'')+'" '+(hasManualStatuses()?'':'disabled')+'>人工</button></div></section>';
}

/* Shared month-strip palette: work/rest/holiday use exactly the calendar dayType;
   status and manual override are sourced from the common analyzed facts. */
function personMonthStripHtml(){
 const id=state.selection.employeeId||EMPLOYEES[0]?.id;
 if(!id)return '';
 const selected=state.chartDay||state.selection.day||1;
 const days=Array.from({length:monthDays()},(_,i)=>{
  const day=i+1,info=state.analysis.get(id+'|'+day),type=dayType(day);
  const rawManual=info?manualStatusFor(info):null;
  const final=rawManual||attendanceJudgmentSystem(info);
  const tone=final==='normal'?'normal':final==='anomaly'?'anomaly':final==='absent'?'absent':'rest';
  const title=isoDate(day)+' · '+dayTypeText(type)+' · '+({normal:'正常',anomaly:'异常',absent:'缺勤',rest:'休息'}[final]||final)+(rawManual?' · 人工修正':'');
  return '<button type="button" class="person-day '+type+' '+(selected===day?'selected':'')+
    '" data-person-day="'+day+'" title="'+escapeNameChar(title)+'" aria-current="'+(selected===day?'date':'false')+'">'+
    '<span class="person-day-number">'+pad(day)+'</span>'+
    (rawManual?'<span class="person-day-check" aria-label="人工修正">✓</span>':'')+
    '<span class="person-day-status '+tone+'"></span></button>';
 }).join('');
 return '<div class="person-strip" aria-label="个人整月考勤"><span class="person-strip-label">月度考勤</span>'+
  '<div class="person-days">'+days+'</div></div>';
}
function workspaceSidebarHtml(){
 const mode=state.workspaceMode||'all',groups=workspaceGroups();
 const groupOptions=groups.map(g=>'<option value="'+escapeNameChar(g)+'" '+(mode==='group'&&g===state.selectedGroup?'selected':'')+'>'+escapeNameChar(g)+'</option>').join('');
 const context=mode==='all'?'<label class="side-label" for="workspaceScopeGroup">组别</label>'+
  '<select class="side-select" id="workspaceScopeGroup"><option value="">全部组别</option>'+groupOptions+'</select>'
 :mode==='group'?'<label class="side-label" for="workspaceGroup">当前组别</label>'+
  '<select class="side-select" id="workspaceGroup">'+groupOptions+'</select>'
 :mode==='person'?'<label class="side-label" for="workspacePerson">当前员工</label><select class="side-select" id="workspacePerson">'+
  EMPLOYEES.map(e=>'<option value="'+escapeNameChar(e.id)+'" '+(e.id===(state.selection.employeeId||EMPLOYEES[0]?.id)?'selected':'')+'>'+escapeNameChar(e.name)+' · '+escapeNameChar(groupOf(e))+'</option>').join('')+'</select>'
 :'';
 const search=mode==='all'||mode==='group'?'<label class="side-label" for="workspaceSearch">查找人员</label>'+
  '<input id="workspaceSearch" class="side-search" type="search" autocomplete="off" placeholder="姓名或编号" value="'+escapeNameChar(state.scopeSearch||'')+'">'+
  '<button id="scopeAttentionToggle" class="side-attention '+(state.attentionOnly?'active':'')+'" type="button">仅显示待核查人员 <span>›</span></button>':'';
 const sub=mode==='person'?'<div class="side-label">分析视图</div><div class="side-subnav">'+
  CHART_TABS.map(([id,name])=>'<button data-sidebar-chart="'+id+'" type="button" class="'+(state.chartTab===id?'active':'')+'">'+name+'</button>').join('')+'</div>'
 :mode==='data'?'<div class="side-label">管理内容</div><div class="side-subnav">'+
  [['records','原始记录'],['roster','员工名册'],['rules','工作规则'],['imports','导入与快照']].map(([id,name])=>'<button type="button" data-data-section="'+id+'" class="'+((state.dataSection||'records')===id?'active':'')+'">'+name+'</button>').join('')+'</div>':'';
 return '<div class="side-controls"><div class="side-current">'+({all:'全员范围',group:'组别范围',person:'人员分析',data:'数据管理'}[mode]||'当前视图')+'</div>'+
  context+search+sub+(mode==='data'?'<div class="side-hidden-filters">'+sidebarFilterHtml()+'</div>':sidebarFilterHtml())+'</div>'+
  '<section class="side-calendar calendar-section"><div class="calendar-caption"><span>月历</span><button class="quiet-link" id="clearSelection">全部</button></div>'+
  '<div id="calendar" class="calendar-grid"></div><div class="calendar-key"><span><i class="work"></i>工作日</span><span><i class="rest"></i>休息日</span>'+
  '<span><i class="adjust"></i>调休上班</span></div></section>';
}
function workspaceToolbarHtml(){
 const mode=state.workspaceMode||'all';
 if(mode==='all'||mode==='group')return '<div class="workspace-toolbar"><div><strong>'+(mode==='all'?'全员考勤':'分组考勤')+'</strong>'+
  '<span>'+periodText()+' · '+(mode==='group'?escapeNameChar(state.selectedGroup||'未分组'):'全部员工')+'</span></div>'+
  '<span class="workspace-hint">'+scopeVisibleEmployees().length+' 位人员</span></div><section id="scopeSummary" class="scope-summary"></section>';
 if(mode==='person')return '<div class="workspace-toolbar"><div><strong>个人分析</strong><span>'+periodText()+' · 详细核查与证据</span></div></div>';
 if(mode==='data')return '<div class="workspace-toolbar"><div><strong>数据管理</strong><span>'+periodText()+' · 原始记录、员工与规则</span></div></div>';
 return '';
}
function bindWorkspaceNavigation(){
 document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>navigateWorkspace(b.dataset.workspace));
 document.querySelectorAll('[data-person-day]').forEach(b=>b.onclick=()=>changePersonalDay(b.dataset.personDay));
 const scope=document.getElementById('workspaceScopeGroup');
 if(scope)scope.onchange=()=>{if(scope.value){state.workspaceMode='group';state.selectedGroup=scope.value;state.scopeSearch='';state.attentionOnly=false;render()}};
 const g=document.getElementById('workspaceGroup');
 if(g)g.onchange=()=>{state.selectedGroup=g.value;state.selection={type:'overall'};render()};
 const person=document.getElementById('workspacePerson');
 if(person)person.onchange=()=>state.workspaceMode==='person'?selectPerson(person.value):selectMatrixRow(person.value);
 const search=document.getElementById('workspaceSearch');
 if(search)search.oninput=()=>{state.scopeSearch=search.value;renderMatrix();renderScopeSummary()};
 const attention=document.getElementById('scopeAttentionToggle');
 if(attention)attention.onclick=()=>{state.attentionOnly=!state.attentionOnly;render()};
 document.querySelectorAll('[data-sidebar-chart]').forEach(b=>b.onclick=()=>{
  state.chartTab=b.dataset.sidebarChart;
  document.querySelectorAll('[data-sidebar-chart]').forEach(x=>x.classList.toggle('active',x.dataset.sidebarChart===state.chartTab));
  renderAnalysisPanel();
 });
 document.querySelectorAll('.side-controls [data-data-section]').forEach(b=>b.onclick=()=>{
  state.dataSection=b.dataset.dataSection;
  document.querySelectorAll('.side-controls [data-data-section]').forEach(x=>x.classList.toggle('active',x.dataset.dataSection===state.dataSection));
  renderDataWorkspace();
 });
}
function navigateWorkspace(mode){
 if(!WORKSPACE_ITEMS.some(x=>x[0]===mode))return;
 state.workspaceMode=mode;state.scopeSearch='';state.attentionOnly=false;
 if(mode==='all'||mode==='group'||mode==='data'){state.selection={type:'overall'};state.chartTab='overview'}
 if(mode==='group'&&!workspaceGroups().includes(state.selectedGroup))state.selectedGroup=workspaceGroups()[0]||'未分组';
 if(mode==='person'&&!['person','cell'].includes(state.selection.type)){
  const e=EMPLOYEES[0];if(e){state.selection={type:'person',employeeId:e.id};state.chartDay=nearestRecordedDay(e.id)}
  state.chartTab='timeline';state.timelineRange=null;
 }
 render();
}
function scopeAnalysisItems(){
 const people=scopeVisibleEmployees(),ids=new Set(people.map(e=>e.id));
 let items=workAnalyses().filter(a=>ids.has(a.employee.id));
 if(state.selection.type==='date')items=items.filter(a=>a.day===state.selection.day);
 return {people,items};
}
function renderScopeSummary(){
 const el=document.getElementById('scopeSummary');if(!el)return;
 const {people,items}=scopeAnalysisItems(),counts={normal:0,anomaly:0,absent:0};
 const hint=document.querySelector('.workspace-toolbar .workspace-hint');if(hint)hint.textContent=people.length+' 位人员';
 for(const a of items){const status=attendanceJudgment(a);if(status in counts)counts[status]++}
 const metrics=[['人员',people.length,'人',''],['正常',counts.normal,'人日','normal'],['异常',counts.anomaly,'人日','anomaly'],['缺勤',counts.absent,'人日','absent']];
 el.innerHTML='<div class="scope-stat-inline" aria-label="考勤摘要">'+metrics.map(([name,value,unit,tone])=>
  '<span class="scope-metric '+tone+'"><small>'+name+'</small><strong>'+value+'</strong><small>'+unit+'</small></span>').join('')+
  '<span class="scope-stat-caption">当前范围 · 单位：人日</span></div>'+
  '<div class="matrix-toolbar"><strong>月度考勤矩阵</strong><span class="matrix-toolbar-legend">'+
  '<span><i class="normal"></i>正常</span><span><i class="anomaly"></i>异常</span><span><i class="absent"></i>缺勤</span></span>'+
  '<span class="matrix-toolbar-summary">待核查 '+(counts.anomaly+counts.absent)+' 人日</span></div>';
 const details=document.getElementById('scopeDetails');
 if(details){
  const peopleRows=people.map(e=>{const rows=workAnalyses().filter(a=>a.employee.id===e.id);
   return {e,normal:rows.filter(a=>attendanceJudgment(a)==='normal').length,
    anomaly:rows.filter(a=>attendanceJudgment(a)==='anomaly').length,absent:rows.filter(a=>attendanceJudgment(a)==='absent').length};
  }).sort((x,y)=>(y.anomaly+y.absent)-(x.anomaly+x.absent));
  details.innerHTML='<div class="scope-subheading">组内人员 <small>按异常与缺勤人日排序，点击核查个人</small></div>'+
   '<div class="scope-member-list">'+peopleRows.map(x=>'<button data-member-id="'+escapeNameChar(x.e.id)+'"><strong>'+
    escapeNameChar(x.e.name)+'</strong><span>正常 '+x.normal+'</span><span class="warn">异常 '+x.anomaly+
    '</span><span class="danger">缺勤 '+x.absent+'</span><b aria-hidden="true">›</b></button>').join('')+'</div>';
  details.querySelectorAll('[data-member-id]').forEach(b=>b.onclick=()=>selectPerson(b.dataset.memberId));
 }
}
function dataPanelHtml(section){
 if(section==='roster'){
  return '<div class="data-note">员工 ID 是记录关联的唯一键。组别可编辑；对于同名人员，请在正式导入前确认身份。</div>'+
  '<div class="data-roster-table"><div class="data-roster-head"><span>人员 ID</span><span>姓名</span><span>部门</span><span>组别</span><span>操作</span></div>'+
  EMPLOYEES.map(e=>'<div class="data-roster-row"><span>'+escapeNameChar(e.id)+'</span><strong>'+escapeNameChar(e.name)+'</strong>'+
   '<span>'+escapeNameChar(e.department)+'</span><span>'+escapeNameChar(groupOf(e))+'</span>'+
   '<button data-edit-roster-group="'+escapeNameChar(e.id)+'">修改组别</button></div>').join('')+'</div>';
 }
 if(section==='rules'){
  return '<div class="data-note">以下为当前月份使用的规则；修改时将重新计算系统判定，不修改原始打卡。</div>'+
    '<div class="data-rules-grid">'+[
      ['上午时段',RULES.amStart+'–'+RULES.amEnd],
      ['下午时段',RULES.pmStart+'–'+RULES.pmEnd],
      ['迟到宽限',RULES.grace+' 分钟'],
      ['重复打卡',RULES.dupSeconds+' 秒'],
      ['日历调整',Object.keys(state.calendarOverrides||{}).filter(k=>k.startsWith(monthKey()+'-')).length+' 天'],
      ['人工判定',Object.keys(state.manualStatuses||{}).length+' 个']
    ].map(([label,value])=>'<div><span>'+label+'</span><strong>'+escapeNameChar(value)+'</strong></div>').join('')+
    '</div><button class="data-rule-edit" id="dataEditRules">在设置中修改班次与规则</button>';
 }
 if(section==='imports'){
  const imports=state.imports||[];
  return '<div class="data-note">原始导入文件与本月工作状态分开保存。冻结快照用于保留当时的完整工作副本。</div>'+
   '<div class="data-import-history"><div class="scope-subheading">本月导入记录 <small>'+imports.length+' 份</small></div>'+
   (imports.length?imports.map(x=>'<div class="data-import-item"><strong>'+escapeNameChar(x.name||'未命名')+'</strong>'+
    '<span>'+escapeNameChar(x.type||'')+' · '+Number(x.count||0)+' 条</span><small>'+escapeNameChar(x.importedAt||'')+'</small></div>').join('')
    :'<p>当前月份尚无真实文件导入。演示数据不作为真实导入记录。</p>')+'</div>';
 }
 return '<section class="inspector-bottom" id="rawPane"><div class="raw-toolbar"><strong>原始记录</strong><div class="raw-tabs">'+
   [['attendance','考勤'],['trip','出差'],['leave','请假'],['outing','外出'],['overtime','加班']].map(([id,name])=>'<button data-raw-tab="'+id+'">'+name+'</button>').join('')+
  '</div><span class="raw-count" id="rawRowCount"></span><button class="raw-float-btn" id="rawFloat" title="弹出原始表格">⛶</button></div>'+
  '<div id="rawDataTable" class="raw-table" aria-label="原始表格"></div></section>';
}
function dataWorkspaceHtml(){
 const section=state.dataSection||'records';
 return '<div class="data-management"><div class="data-stat-inline">'+
  '<span>人员 <strong>'+EMPLOYEES.length+'</strong></span><span>打卡 <strong>'+state.records.length.toLocaleString()+'</strong></span>'+
  '<span>请假 <strong>'+state.leaves.length+'</strong></span><span>出差 <strong>'+state.trips.length+'</strong></span>'+
  '<span class="data-dir-state">'+(state.selection.type==='date'?'仅显示 '+isoDate(state.selection.day)+' · ':'')+(state.projectDir?'已连接本地目录':'本地目录未连接')+'</span></div>'+
  '<div class="data-section-panel">'+dataPanelHtml(section)+'</div></div>';
}
function renderDataWorkspace(){
 const body=document.getElementById('analysisBody');if(!body)return;
 const heading=document.getElementById('analysisTitle');if(heading)heading.textContent='数据管理 · '+monthKey();
 const tools=document.getElementById('analysisHeadTools');if(tools)tools.textContent='';
 if(typeof disposeRawTable==='function')disposeRawTable();
 body.innerHTML=dataWorkspaceHtml();
 body.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.open).click());
 body.querySelectorAll('[data-edit-roster-group]').forEach(b=>b.onclick=()=>setPersonGroup(b.dataset.editRosterGroup));
 const edit=body.querySelector('#dataEditRules');if(edit)edit.onclick=()=>document.getElementById('settingsBtn').click();
 if((state.dataSection||'records')==='records')mountRawTable(state.selection.type==='date'?{type:'date',day:state.selection.day,items:[]}: {type:'overall',items:workAnalyses()});
}
